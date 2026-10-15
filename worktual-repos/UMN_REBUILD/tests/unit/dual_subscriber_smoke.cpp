#include "config/Config.h"
#include "logging/Logger.h"
#include "redis/RedisClient.h"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

// Exit 2 → script SKIP (Redis unavailable).
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
  const auto& cfg = loaded.value();
  const std::string channel = cfg.redis.pubsub_channel;
  const std::string marker = "phase7-dual-sub-ping";

  urs::RedisClient node_a;
  urs::RedisClient node_b;
  urs::RedisClient publisher;

  if (auto ok = node_a.connect(cfg.redis); !ok) {
    std::cerr << "node_a connect failed: " << ok.error() << '\n';
    return 2;
  }
  if (auto ok = node_b.connect(cfg.redis); !ok) {
    std::cerr << "node_b connect failed: " << ok.error() << '\n';
    return 2;
  }
  if (auto ok = publisher.connect(cfg.redis); !ok) {
    std::cerr << "publisher connect failed: " << ok.error() << '\n';
    return 2;
  }

  std::atomic<int> hits_a{0};
  std::atomic<int> hits_b{0};

  if (auto ok = node_a.subscribe(channel, [&](std::string_view /*ch*/, std::string_view payload) {
        if (payload.find(marker) != std::string_view::npos) {
          hits_a.fetch_add(1);
        }
      });
      !ok) {
    std::cerr << "node_a subscribe failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = node_b.subscribe(channel, [&](std::string_view /*ch*/, std::string_view payload) {
        if (payload.find(marker) != std::string_view::npos) {
          hits_b.fetch_add(1);
        }
      });
      !ok) {
    std::cerr << "node_b subscribe failed: " << ok.error() << '\n';
    return 1;
  }

  // Wait until both subscribe threads are ready (RedisClient waits internally).
  std::this_thread::sleep_for(std::chrono::milliseconds(200));

  const std::string payload =
      R"({"msg_type":"pbx-call-load-statistics","pbx_addr":"10.99.99.99","cpu_usage":"1","memory_usage":"2","network_io_usage":"3","cps":"1","smoke":")" +
      marker + R"("})";

  if (auto ok = publisher.publish(channel, payload); !ok) {
    std::cerr << "publish failed: " << ok.error() << '\n';
    return 1;
  }

  for (int i = 0; i < 80 && (hits_a.load() < 1 || hits_b.load() < 1); ++i) {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }

  node_a.unsubscribe();
  node_b.unsubscribe();
  node_a.disconnect();
  node_b.disconnect();
  publisher.disconnect();

  if (hits_a.load() < 1 || hits_b.load() < 1) {
    std::cerr << "dual subscribe failed hits_a=" << hits_a.load()
              << " hits_b=" << hits_b.load() << '\n';
    return 1;
  }

  std::cout << "dual_subscriber_smoke OK hits_a=" << hits_a.load()
            << " hits_b=" << hits_b.load() << '\n';
  return 0;
}
