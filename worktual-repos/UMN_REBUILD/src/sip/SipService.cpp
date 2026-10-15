#include "sip/SipService.h"

#include "common/Messages.h"
#include "logging/Logger.h"
#include "sip/DigestAuth.h"

#include <nlohmann/json.hpp>

#include <utility>

namespace urs {
namespace {

std::string host_from_listen(const std::string& host_port) {
  if (host_port.empty()) {
    return "127.0.0.1";
  }
  const auto pos = host_port.rfind(':');
  if (pos == std::string::npos || host_port.find(':') != pos) {
    return host_port;
  }
  return host_port.substr(0, pos);
}

// Contact URI is "sip:user@host[:port][;params]" — user matches REGISTER Contact.
std::string user_from_contact_uri(const std::string& uri) {
  const auto scheme = uri.find(':');
  if (scheme == std::string::npos) {
    return {};
  }
  const auto at = uri.find('@', scheme + 1);
  if (at == std::string::npos || at <= scheme + 1) {
    return {};
  }
  return uri.substr(scheme + 1, at - scheme - 1);
}

}  // namespace

SipService::SipService() : adapter_(std::make_unique<SofiaAdapter>()) {}

SipService::~SipService() { stop(); }

void SipService::set_controller(Controller* controller) noexcept {
  controller_ = controller;
}

Result<void> SipService::init(const SipConfig& config) {
  if (initialized_) {
    return Result<void>::ok();
  }
  if (!controller_) {
    return Result<void>::err("SipService: controller not set");
  }
  config_ = config;
  adapter_->set_inbound_handler(
      [this](SofiaAdapter::InboundInvite inv) { on_inbound(std::move(inv)); });
  adapter_->set_register_processor(
      [this](const SofiaAdapter::InboundRegister& reg) {
        return process_register(reg);
      });
  initialized_ = true;
  return Result<void>::ok();
}

Result<void> SipService::start() {
  if (running_.exchange(true)) {
    return Result<void>::ok();
  }
  if (!initialized_) {
    running_.store(false);
    return Result<void>::err("SipService::start before init");
  }

  worker_ = std::thread([this] { worker_loop(); });

  if (auto ok = adapter_->start(config_); !ok) {
    stop();
    return Result<void>::err("SofiaAdapter start failed: " + ok.error());
  }

  Logger::instance().info("[SGW] SipService started");
  return Result<void>::ok();
}

void SipService::stop() {
  if (!running_.exchange(false) && !worker_.joinable()) {
    adapter_->shutdown();
    return;
  }
  running_.store(false);
  queue_cv_.notify_all();
  if (worker_.joinable()) {
    worker_.join();
  }
  adapter_->shutdown();
  Logger::instance().info("[SGW] SipService stopped");
}

Result<void> SipService::sendInvite(const std::string& call_id,
                                    const std::string& pbx_ip,
                                    const std::string& called_user,
                                    const std::string& calling_user) {
  if (!running_.load()) {
    return Result<void>::err("SipService not running");
  }
  adapter_->dial_out(call_id, pbx_ip, called_user, calling_user);
  return Result<void>::ok();
}

void SipService::on_inbound(SofiaAdapter::InboundInvite invite) {
  {
    std::lock_guard lock(queue_mu_);
    inbound_.push(std::move(invite));
  }
  queue_cv_.notify_one();
}

void SipService::worker_loop() {
  while (true) {
    SofiaAdapter::InboundInvite inv;
    {
      std::unique_lock lock(queue_mu_);
      queue_cv_.wait(lock, [this] {
        return !running_.load() || !inbound_.empty();
      });
      if (!running_.load() && inbound_.empty()) {
        break;
      }
      inv = std::move(inbound_.front());
      inbound_.pop();
    }
    handle_invite(std::move(inv));
  }
}

void SipService::handle_invite(SofiaAdapter::InboundInvite invite) {
  // Mirrors old SGW: OnInviteRequest → controller → DialOut (no secrets).
  Logger::instance().info(
      "[SGW] OnInviteRequest call_id=" + invite.call_id +
      " from=" + invite.calling_party + "@" + invite.calling_domain +
      " to=" + invite.called_party + "@" + invite.called_domain);

  if (!controller_) {
    Logger::instance().error("[SGW] OnInviteRequest: no controller");
    adapter_->respond(invite.call_id, 500, "Server Internal Error");
    adapter_->destroy_call(invite.call_id);
    return;
  }

  nlohmann::json req;
  req["msg_type"] = "INVITE_REQ";
  req["trans_id"] = invite.call_id;
  req["call_id"] = invite.call_id;
  req["calling_party"] = invite.calling_party;
  req["called_party"] = invite.called_party;
  req["calling_party_domain"] = invite.calling_domain;
  req["called_party_domain"] = invite.called_domain;
  req["key"] = "";

  ModuleMessage msg;
  msg.src = ModuleId::Sip;
  msg.dst = ModuleId::Controller;
  msg.type = MessageType::InviteRoute;
  msg.payload = req.dump();

  Logger::instance().info(
      "[SGW] SIP_EVENT_INVITE_REQUEST → Controller InviteRoute call_id=" +
      invite.call_id);

  auto resp = controller_->request(std::move(msg));
  if (!resp) {
    Logger::instance().warn("[SGW] InviteRoute failed: " + resp.error());
    adapter_->respond(invite.call_id, 503, "Service Unavailable");
    adapter_->destroy_call(invite.call_id);
    return;
  }

  nlohmann::json out;
  try {
    out = nlohmann::json::parse(resp.value().payload);
  } catch (const nlohmann::json::exception& ex) {
    Logger::instance().warn(std::string("[SGW] InviteRoute parse: ") + ex.what());
    adapter_->respond(invite.call_id, 500, "Server Internal Error");
    adapter_->destroy_call(invite.call_id);
    return;
  }

  if (!out.value("ok", false)) {
    Logger::instance().warn(
        "[SGW] InviteRoute denied: " +
        out.value("error_reason", std::string("unknown")));
    adapter_->respond(invite.call_id, 503, "Service Unavailable");
    adapter_->destroy_call(invite.call_id);
    return;
  }

  const std::string pbx = out.value("route_pbx_ip", "");
  if (pbx.empty()) {
    Logger::instance().warn("[SGW] InviteRoute ok but empty route_pbx_ip call_id=" +
                            invite.call_id);
    adapter_->respond(invite.call_id, 503, "Service Unavailable");
    adapter_->destroy_call(invite.call_id);
    return;
  }

  Logger::instance().info("[SGW] DialOut call_id=" + invite.call_id +
                          " route_pbx_ip=" + pbx + " called=" +
                          invite.called_party + " calling=" +
                          invite.calling_party);

  if (auto ok = sendInvite(invite.call_id, pbx, invite.called_party,
                           invite.calling_party);
      !ok) {
    Logger::instance().warn("[SGW] sendInvite failed: " + ok.error());
    adapter_->respond(invite.call_id, 500, "Server Internal Error");
    adapter_->destroy_call(invite.call_id);
  }
}

SofiaAdapter::RegisterDecision SipService::process_register(
    const SofiaAdapter::InboundRegister& reg) {
  // Mirrors old SGW: OnRegistrationRequest / handleRegRequestWOAuth (no secrets).
  SofiaAdapter::RegisterDecision d;
  d.status = 500;
  d.phrase = "Server Internal Error";

  Logger::instance().info(
      "[SGW] OnRegistrationRequest aor=" + reg.username + "@" + reg.domain +
      " call_id=" + reg.call_id + " transport=" + reg.transport_type +
      " device=" + reg.device_type + "/" + reg.app_type +
      " contact_address=" + reg.contact_address +
      " contact_uri=" + reg.contact_uri +
      " expires=" + std::to_string(reg.expires) +
      (reg.has_auth ? " with_auth" : " without_auth"));

  if (!controller_) {
    d.detail = "no controller";
    Logger::instance().error("[SGW] OnRegistrationRequest: no controller");
    return d;
  }

  nlohmann::json req;
  req["msg_type"] = "REGISTER_REQ";
  req["call_id"] = reg.call_id;
  req["username"] = reg.username;
  req["domain"] = reg.domain;
  req["device_type"] = reg.device_type;
  req["app_type"] = reg.app_type;
  req["contact_address"] = reg.contact_address;
  req["contact_uri"] = reg.contact_uri;
  req["transport_type"] = reg.transport_type;
  req["expires"] = reg.expires;
  if (reg.transport_type == "wss") {
    if (!config_.contact_wss_host.empty()) {
      req["sgw_ip"] = config_.contact_wss_host;
    } else if (!config_.wss_listen.empty()) {
      req["sgw_ip"] = host_from_listen(config_.wss_listen);
    } else {
      req["sgw_ip"] = host_from_listen(config_.udp_listen);
    }
  } else {
    req["sgw_ip"] = host_from_listen(config_.udp_listen);
  }
  // 200 OK / Redis proxy_username = Contact user (legacy SGW), not To username.
  {
    const std::string contact_user = user_from_contact_uri(reg.contact_uri);
    req["proxy_username"] = contact_user.empty() ? reg.username : contact_user;
  }
  if (reg.has_auth) {
    req["authorization"] = {
        {"username", reg.auth_username},
        {"realm", reg.auth_realm},
        {"nonce", reg.auth_nonce},
        {"uri", reg.auth_uri},
        {"response", reg.auth_response},
    };
  }

  ModuleMessage msg;
  msg.src = ModuleId::Sip;
  msg.dst = ModuleId::Controller;
  msg.type = MessageType::Register;
  msg.payload = req.dump();

  Logger::instance().info(
      "[SGW] SIP_EVENT_DO_USER_REG_REQ → Controller aor=" + reg.username + "@" +
      reg.domain);

  auto resp = controller_->request(std::move(msg));
  if (!resp) {
    d.detail = resp.error();
    Logger::instance().warn("[SGW] Register request failed: " + d.detail);
    return d;
  }

  nlohmann::json out;
  try {
    out = nlohmann::json::parse(resp.value().payload);
  } catch (const nlohmann::json::exception& ex) {
    d.detail = ex.what();
    Logger::instance().warn(std::string("[SGW] Register response parse: ") +
                            ex.what());
    return d;
  }

  if (out.value("need_challenge", false)) {
    d.status = 401;
    d.phrase = "Unauthorized";
    d.www_authenticate = wwwAuthenticateHeader(out.value("realm", reg.domain),
                                               out.value("nonce", ""));
    d.detail = out.value("detail", "challenge");
    Logger::instance().info(
        "[SGW] handleRegRequestWOAuth → send 401 Unauthorized aor=" +
        reg.username + "@" + reg.domain);
    return d;
  }

  if (!out.value("accepted", false)) {
    d.status = 403;
    d.phrase = "Forbidden";
    d.detail = out.value("detail", "denied");
    Logger::instance().warn("[SGW] Registration denied aor=" + reg.username +
                            "@" + reg.domain + " detail=" + d.detail);
    return d;
  }

  d.status = 200;
  d.phrase = "OK";
  d.contact = out.value("contact", "");
  d.detail = out.value("detail", "registered");
  Logger::instance().info(
      "[SGW] Registration accepted aor=" + reg.username + "@" + reg.domain +
      " status=200 contact=" + d.contact + " detail=" + d.detail);
  return d;
}

}  // namespace urs
