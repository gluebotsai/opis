#pragma once

#include "common/Result.h"
#include "common/Types.h"

#include <cstdint>
#include <string>
#include <vector>

namespace urs {

struct RedisEndpointConfig {
  std::string host;
  std::uint16_t port{6379};
  // Prefer UR_REDIS_PUBSUB_* / UR_REDIS_STORE_* env in deploy; never log.
  std::string password;
};

// Dual Redis: pubsub for SUBSCRIBE/PUBLISH; store for SET/GET/HGETALL (no HA fallback).
struct RedisConfig {
  RedisEndpointConfig pubsub;
  RedisEndpointConfig store;
  std::string pubsub_channel{"InterrogatorEventPREPRO"};
  std::uint32_t pbx_alive_ttl_sec{30};
  std::uint32_t call_live_ttl_sec{3600};
};

struct LoggingConfig {
  std::string level{"info"};
  std::string file;
};

struct PbxConfig {
  std::string snapshot_path{"data/pbx_snapshot.json"};
  // When non-empty, only these PBX IPs may enter the in-memory pool (pubsub + snapshot).
  std::vector<std::string> allowed_ips;
};

struct SipConfig {
  std::string udp_listen{"192.168.13.190:15060"};
  std::string tcp_listen{"192.168.13.190:15060"};
  std::string tls_listen{"192.168.13.190:15061"};
  // Empty = WSS disabled. Format host:port → sips:host:port;transport=wss
  std::string wss_listen;
  // Directory with Sofia agent.pem (cert+key). Required when wss_listen set.
  std::string certificate_dir;
  // Optional public host used in REGISTER Contact / binding Ipaddress for WSS.
  std::string contact_wss_host;
};

struct AppConfig {
  std::string version{"0.1.0"};
  LoggingConfig logging;
  RedisConfig redis;
  PbxConfig pbx;
  SipConfig sip;
};

class Config {
public:
  // Loads JSON then applies env overrides:
  // UR_REDIS_PUBSUB_* / UR_REDIS_STORE_*, UR_SIP_HOST (rewrites sip.* hosts),
  // UR_SIP_UDP_LISTEN / TCP / TLS / WSS, UR_SIP_CERTIFICATE_DIR,
  // UR_SIP_CONTACT_WSS_HOST.
  [[nodiscard]] static Result<AppConfig> load(const std::string& path);
};

}  // namespace urs
