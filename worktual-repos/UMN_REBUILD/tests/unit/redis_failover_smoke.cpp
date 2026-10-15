#include "config/Config.h"
#include "logging/Logger.h"
#include "redis/LiveCallStore.h"
#include "redis/RedisClient.h"

#include <atomic>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>

// Dual Redis smoke: store SET/GET + pubsub PUBLISH/SUBSCRIBE.
// Exit 2 → script SKIP (Redis unreachable).
int main(int argc, char** argv) {
  const std::string config_path =
      argc > 1 ? argv[1] : std::string("configs/ur-signaling.conf.json");

  if (auto ok = urs::Logger::instance().init("info", ""); !ok) {
    std::cerr << "logger init failed: " << ok.error() << '\n';
    return 1;
  }

  auto loaded = urs::Config::load(config_path);
  if (!loaded) {
    std::cerr << "config failed: " << loaded.error() << '\n';
    return 1;
  }
  const urs::RedisConfig& rc = loaded.value().redis;

  urs::RedisClient redis;
  if (auto ok = redis.connect(rc); !ok) {
    std::cerr << "redis connect failed: " << ok.error() << '\n';
    return 2;
  }

  const std::string uid = "dual-redis-smoke-uid";
  const std::string key = urs::LiveCallStore::keyFor(uid);
  (void)redis.del(key);
  if (auto ok = redis.setEx(key, R"({"call_uid":"dual-redis-smoke-uid","note":"store"})",
                            rc.call_live_ttl_sec);
      !ok) {
    std::cerr << "store setEx failed: " << ok.error() << '\n';
    return 1;
  }

  urs::LiveCallStore live(redis);
  auto got = live.get(uid);
  if (!got || !got.value() ||
      got.value()->client_call_info_json.find("store") == std::string::npos) {
    std::cerr << "LiveCallStore get on store Redis failed\n";
    return 1;
  }
  (void)redis.del(key);

  std::atomic<bool> got_msg{false};
  if (auto ok = redis.subscribe(rc.pubsub_channel,
                                [&](std::string_view, std::string_view payload) {
                                  if (payload.find("dual-redis-smoke-ping") != std::string::npos) {
                                    got_msg.store(true);
                                  }
                                });
      !ok) {
    std::cerr << "subscribe failed: " << ok.error() << '\n';
    return 1;
  }

  const std::string payload =
      R"({"msg_type":"pbx-call-load-statistics","pbx_addr":"10.1.1.1","smoke":"dual-redis-smoke-ping"})";
  if (auto ok = redis.publish(rc.pubsub_channel, payload); !ok) {
    std::cerr << "publish failed: " << ok.error() << '\n';
    redis.unsubscribe();
    return 1;
  }

  for (int i = 0; i < 50 && !got_msg.load(); ++i) {
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  redis.unsubscribe();

  if (!got_msg.load()) {
    std::cerr << "did not receive pubsub message on channel " << rc.pubsub_channel << '\n';
    return 1;
  }

  redis.disconnect();
  std::cout << "redis_dual_smoke OK store=" << rc.store.host << " pubsub=" << rc.pubsub.host
            << " channel=" << rc.pubsub_channel << '\n';
  return 0;
}
