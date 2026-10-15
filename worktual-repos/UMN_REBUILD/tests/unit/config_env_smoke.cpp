#include "config/Config.h"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>

namespace {

void write_temp_config(const std::string& path) {
  std::ofstream out(path);
  out << R"({
  "version": "0.1.0",
  "logging": { "level": "info", "file": "" },
  "redis": {
    "pubsub": { "host": "10.180.2.106", "port": 6379, "password": "" },
    "store": { "host": "10.180.2.109", "port": 6379, "password": "" },
    "pubsub_channel": "InterrogatorEventPREPRO",
    "pbx_alive_ttl_sec": 30,
    "call_live_ttl_sec": 3600
  },
  "pbx": { "snapshot_path": "data/pbx_snapshot.json" },
  "sip": {
    "udp_listen": "192.168.13.190:15060",
    "tcp_listen": "192.168.13.190:15060",
    "tls_listen": "192.168.13.190:15061"
  }
})";
}

}  // namespace

int main() {
  const std::string path = "/tmp/ur-signaling-config-env-smoke.json";
  write_temp_config(path);

  ::setenv("UR_REDIS_PUBSUB_HOST", "10.2.2.2", 1);
  ::setenv("UR_REDIS_PUBSUB_PORT", "6400", 1);
  ::setenv("UR_REDIS_PUBSUB_PASSWORD", "pubsub-secret", 1);
  ::setenv("UR_REDIS_STORE_HOST", "10.3.3.3", 1);
  ::setenv("UR_REDIS_STORE_PORT", "6401", 1);
  ::setenv("UR_REDIS_STORE_PASSWORD", "store-secret", 1);
  ::setenv("UR_REDIS_PUBSUB_CHANNEL", "InterrogatorEventCI", 1);
  ::setenv("UR_SIP_HOST", "82.113.92.89", 1);

  auto loaded = urs::Config::load(path);

  ::unsetenv("UR_REDIS_PUBSUB_HOST");
  ::unsetenv("UR_REDIS_PUBSUB_PORT");
  ::unsetenv("UR_REDIS_PUBSUB_PASSWORD");
  ::unsetenv("UR_REDIS_STORE_HOST");
  ::unsetenv("UR_REDIS_STORE_PORT");
  ::unsetenv("UR_REDIS_STORE_PASSWORD");
  ::unsetenv("UR_REDIS_PUBSUB_CHANNEL");
  ::unsetenv("UR_SIP_HOST");

  if (!loaded) {
    std::cerr << "config load failed: " << loaded.error() << '\n';
    return 1;
  }
  const auto& cfg = loaded.value();
  if (cfg.redis.pubsub.host != "10.2.2.2" || cfg.redis.pubsub.port != 6400 ||
      cfg.redis.pubsub.password != "pubsub-secret") {
    std::cerr << "pubsub env override failed\n";
    return 1;
  }
  if (cfg.redis.store.host != "10.3.3.3" || cfg.redis.store.port != 6401 ||
      cfg.redis.store.password != "store-secret") {
    std::cerr << "store env override failed\n";
    return 1;
  }
  if (cfg.redis.pubsub_channel != "InterrogatorEventCI") {
    std::cerr << "pubsub_channel env override failed\n";
    return 1;
  }
  if (cfg.sip.udp_listen != "82.113.92.89:15060" ||
      cfg.sip.tcp_listen != "82.113.92.89:15060" ||
      cfg.sip.tls_listen != "82.113.92.89:15061" ||
      cfg.sip.contact_wss_host != "82.113.92.89") {
    std::cerr << "UR_SIP_HOST override failed udp=" << cfg.sip.udp_listen << '\n';
    return 1;
  }

  std::cout << "config_env_smoke OK\n";
  return 0;
}
