#include "config/Config.h"
#include "interrogator/InterrogatorService.h"
#include "logging/Logger.h"
#include "redis/LiveCallStore.h"
#include "redis/PbxPresenceStore.h"
#include "redis/RedisClient.h"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>

namespace {

std::string load_msg(const std::string& ip) {
  return R"({"msg_type":"pbx-call-load-statistics","pbx_addr":")" + ip +
         R"(","cpu_usage":"10","memory_usage":"20","network_io_usage":"30","cps":"1"})";
}

std::string delete_msg(const std::string& ip) {
  return R"({"msg_type":"pbx-call-load-statistics-delete","pbx_addr":")" + ip + R"("})";
}

}  // namespace

int main(int argc, char** argv) {
  const std::string config_path =
      (argc > 1) ? argv[1] : std::string("configs/ur-signaling.conf.json");

  if (auto log_ok = urs::Logger::instance().init("info", ""); !log_ok) {
    std::cerr << "logger init failed\n";
    return 1;
  }

  auto loaded = urs::Config::load(config_path);
  if (!loaded) {
    std::cerr << "config failed: " << loaded.error() << '\n';
    return 1;
  }
  auto cfg = std::move(loaded.value());
  cfg.pbx.snapshot_path = "/tmp/ur-interrogator-smoke-snapshot.json";
  std::filesystem::remove(cfg.pbx.snapshot_path);

  urs::RedisClient redis;
  if (auto ok = redis.connect(cfg.redis); !ok) {
    std::cerr << "SKIP_CONNECT: " << ok.error() << '\n';
    return 2;
  }

  urs::PbxPresenceStore presence(redis);
  urs::LiveCallStore live(redis);
  urs::InterrogatorService interrogator(redis, presence, live);

  if (auto ok = interrogator.start(cfg); !ok) {
    std::cerr << "start failed: " << ok.error() << '\n';
    return 1;
  }

  const std::string ip = "10.55.55.55";
  if (auto ok = redis.publish(cfg.redis.pubsub_channel, load_msg(ip)); !ok) {
    std::cerr << "publish failed: " << ok.error() << '\n';
    return 1;
  }

  bool seen = false;
  for (int i = 0; i < 50; ++i) {
    if (interrogator.selector().contains(ip)) {
      seen = true;
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  if (!seen) {
    std::cerr << "PBX not upserted from pub/sub\n";
    return 1;
  }

  auto next = interrogator.getNextPbxIp();
  if (!next || next.value() != ip) {
    std::cerr << "getNextPbxIp expected " << ip << '\n';
    return 1;
  }

  if (auto ok = redis.publish(cfg.redis.pubsub_channel, delete_msg(ip)); !ok) {
    std::cerr << "delete publish failed\n";
    return 1;
  }
  for (int i = 0; i < 50 && interrogator.selector().contains(ip); ++i) {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  if (interrogator.selector().contains(ip)) {
    std::cerr << "PBX not removed after delete\n";
    return 1;
  }

  // Snapshot + TTL drop: upsert, stop (saves snapshot), clear presence, restart.
  interrogator.handlePubSubMessage(load_msg(ip));
  if (!interrogator.selector().contains(ip)) {
    std::cerr << "direct upsert failed\n";
    return 1;
  }
  interrogator.stop();

  if (!std::filesystem::exists(cfg.pbx.snapshot_path)) {
    std::cerr << "snapshot missing after stop\n";
    return 1;
  }

  (void)presence.clearAlive(ip);

  urs::InterrogatorService interrogator2(redis, presence, live);
  if (auto ok = interrogator2.start(cfg); !ok) {
    std::cerr << "restart failed: " << ok.error() << '\n';
    return 1;
  }
  if (interrogator2.selector().contains(ip)) {
    std::cerr << "expected TTL drop to remove snapshot PBX\n";
    return 1;
  }

  // Alive path: upsert, stop with TTL key present, restart keeps it.
  interrogator2.handlePubSubMessage(load_msg(ip));
  interrogator2.stop();
  urs::InterrogatorService interrogator3(redis, presence, live);
  if (auto ok = interrogator3.start(cfg); !ok) {
    std::cerr << "restart3 failed\n";
    return 1;
  }
  if (!interrogator3.selector().contains(ip)) {
    std::cerr << "expected snapshot+TTL keep PBX\n";
    return 1;
  }

  interrogator3.stop();
  redis.disconnect();
  std::filesystem::remove(cfg.pbx.snapshot_path);
  std::cout << "interrogator_pubsub_smoke OK\n";
  return 0;
}