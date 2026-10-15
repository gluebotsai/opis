#include "app/Application.h"

#include "common/Messages.h"
#include "logging/Logger.h"

#include <chrono>
#include <string>

namespace urs {

Application::Application(AppConfig config) : config_(std::move(config)) {}

Result<void> Application::start() {
  if (running_.exchange(true)) {
    return Result<void>::ok();
  }

  auto& log = Logger::instance();

  // Non-secret config summary only — never passwords.
  log.info("config version=" + config_.version);
  log.info("redis pubsub=" + config_.redis.pubsub.host + ":" +
           std::to_string(config_.redis.pubsub.port) +
           " store=" + config_.redis.store.host + ":" +
           std::to_string(config_.redis.store.port) +
           " channel=" + config_.redis.pubsub_channel +
           " pbx_alive_ttl_sec=" + std::to_string(config_.redis.pbx_alive_ttl_sec) +
           " call_live_ttl_sec=" + std::to_string(config_.redis.call_live_ttl_sec));
  {
    std::string allowed = "pbx allowed_ips=";
    if (config_.pbx.allowed_ips.empty()) {
      allowed += "(any)";
    } else {
      for (std::size_t i = 0; i < config_.pbx.allowed_ips.size(); ++i) {
        if (i > 0) {
          allowed += ',';
        }
        allowed += config_.pbx.allowed_ips[i];
      }
    }
    log.info("pbx snapshot_path=" + config_.pbx.snapshot_path + " " + allowed);
  }
  log.info("sip udp=" + config_.sip.udp_listen + " tcp=" + config_.sip.tcp_listen +
           " tls=" + config_.sip.tls_listen +
           (config_.sip.wss_listen.empty()
                ? " wss=(disabled)"
                : " wss=" + config_.sip.wss_listen) +
           (config_.sip.certificate_dir.empty()
                ? ""
                : " certs=" + config_.sip.certificate_dir));

  // Redis then Interrogator (in-process; no NetIO TCP).
  if (auto ok = redis_.connect(config_.redis); !ok) {
    running_.store(false);
    return Result<void>::err("Redis connect failed: " + ok.error());
  }

  presence_.emplace(redis_);
  live_calls_.emplace(redis_);
  interrogator_.emplace(redis_, *presence_, *live_calls_);
  if (auto ok = interrogator_->start(config_); !ok) {
    stop();
    return Result<void>::err("Interrogator start failed: " + ok.error());
  }

  // Wire Controller → InterrogatorApi (replaces SGW CreateTcpClient / sendMsgToInterrogator).
  controller_.setInterrogator(&*interrogator_);

  stub_echo_ = std::make_shared<StubEchoModule>();
  if (auto ok = controller_.registerModule(stub_echo_); !ok) {
    stop();
    return Result<void>::err("register StubEcho failed: " + ok.error());
  }
  if (auto ok = controller_.init(); !ok) {
    stop();
    return Result<void>::err(ok.error());
  }
  if (auto ok = controller_.start(); !ok) {
    stop();
    return Result<void>::err(ok.error());
  }

  ModuleMessage ping;
  ping.src = ModuleId::Controller;
  ping.dst = ModuleId::StubEcho;
  ping.type = MessageType::Dummy;
  ping.payload = "ping";
  if (auto ok = controller_.push(std::move(ping)); !ok) {
    stop();
    return Result<void>::err("dummy route failed: " + ok.error());
  }
  log.info("dummy ModuleMessage routed Controller → StubEcho");

  // Seed allowlisted PBXs so DialOut has a pool even if Redis TTL dropped the snapshot.
  for (const auto& pbx_ip : config_.pbx.allowed_ips) {
    interrogator_->handlePubSubMessage(
        R"({"msg_type":"pbx-call-load-statistics","pbx_addr":")" + pbx_ip +
        R"(","cpu_usage":"1","memory_usage":"2","network_io_usage":"3","cps":"1"})");
  }

  // SIP stack: Sofia thread + worker → Controller InviteRoute (no SIP→Redis).
  sip_.emplace();
  sip_->set_controller(&controller_);
  if (auto ok = sip_->init(config_.sip); !ok) {
    stop();
    return Result<void>::err(ok.error());
  }
  if (auto ok = sip_->start(); !ok) {
    stop();
    return Result<void>::err(ok.error());
  }

  log.info("Phase6 ready");
  return Result<void>::ok();
}

void Application::stop() {
  running_.store(false);

  if (sip_) {
    sip_->stop();
    sip_.reset();
  }

  controller_.clearInterrogator();
  controller_.stop();
  stub_echo_.reset();

  if (interrogator_) {
    interrogator_->stop();
    interrogator_.reset();
  }
  live_calls_.reset();
  presence_.reset();
  redis_.disconnect();

  Logger::instance().info("Application shutting down");
  request_shutdown();
}

void Application::request_shutdown() noexcept {
  shutdown_requested_.store(true, std::memory_order_release);
  wait_cv_.notify_all();
}

void Application::wait_for_shutdown(const std::atomic<bool>& signal_shutdown) {
  std::unique_lock lock(wait_mutex_);
  while (!shutdown_requested_.load(std::memory_order_acquire) &&
         !signal_shutdown.load(std::memory_order_acquire)) {
    wait_cv_.wait_for(lock, std::chrono::milliseconds(200));
  }
  shutdown_requested_.store(true, std::memory_order_release);
}

}  // namespace urs
