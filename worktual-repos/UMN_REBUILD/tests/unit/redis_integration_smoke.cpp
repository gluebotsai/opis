#include "config/Config.h"
#include "logging/Logger.h"
#include "redis/LiveCallStore.h"
#include "redis/PbxPresenceStore.h"
#include "redis/RedisClient.h"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

int main(int argc, char** argv) {
  const std::string config_path =
      (argc > 1) ? argv[1] : std::string("configs/ur-signaling.conf.json");

  if (auto log_ok = urs::Logger::instance().init("info", ""); !log_ok) {
    std::cerr << "logger init failed: " << log_ok.error() << '\n';
    return 1;
  }

  auto loaded = urs::Config::load(config_path);
  if (!loaded) {
    std::cerr << "config failed: " << loaded.error() << '\n';
    return 1;
  }
  const auto& cfg = loaded.value();

  urs::RedisClient redis;
  if (auto ok = redis.connect(cfg.redis); !ok) {
    std::cerr << "SKIP_CONNECT: " << ok.error() << '\n';
    return 2;  // script treats as skip
  }

  urs::PbxPresenceStore presence(redis);
  const std::string ip = "192.168.13.190";
  if (auto ok = presence.refreshAlive(ip, cfg.redis.pbx_alive_ttl_sec); !ok) {
    std::cerr << "refreshAlive failed: " << ok.error() << '\n';
    return 1;
  }
  auto alive = presence.isAlive(ip);
  if (!alive || !alive.value()) {
    std::cerr << "isAlive expected true\n";
    return 1;
  }

  // LiveCallStore is read-only: seed via RedisClient (simulating PBX writer).
  const std::string uid = "smoke-uid-1";
  const std::string key = urs::LiveCallStore::keyFor(uid);
  if (auto ok = redis.setEx(key, R"({"call_uid":"smoke-uid-1"})", cfg.redis.call_live_ttl_sec);
      !ok) {
    std::cerr << "seed call:live failed: " << ok.error() << '\n';
    return 1;
  }
  urs::LiveCallStore calls(redis);
  auto got = calls.get(uid);
  if (!got || !got.value() || got.value()->client_call_info_json.empty()) {
    std::cerr << "LiveCallStore get failed\n";
    return 1;
  }

  std::atomic<bool> got_msg{false};
  if (auto ok = redis.subscribe(cfg.redis.pubsub_channel,
                                [&](std::string_view /*ch*/, std::string_view payload) {
                                  if (payload == "smoke-ping") {
                                    got_msg.store(true);
                                  }
                                });
      !ok) {
    std::cerr << "subscribe failed: " << ok.error() << '\n';
    return 1;
  }
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  if (auto ok = redis.publish(cfg.redis.pubsub_channel, "smoke-ping"); !ok) {
    std::cerr << "publish failed: " << ok.error() << '\n';
    return 1;
  }
  for (int i = 0; i < 50 && !got_msg.load(); ++i) {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  redis.unsubscribe();

  if (!got_msg.load()) {
    std::cerr << "did not receive pub/sub smoke-ping\n";
    return 1;
  }

  (void)presence.clearAlive(ip);
  (void)redis.del(key);
  redis.disconnect();

  std::cout << "redis_integration_smoke OK\n";
  return 0;
}