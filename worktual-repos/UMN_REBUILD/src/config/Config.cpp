#include "config/Config.h"

#include <nlohmann/json.hpp>

#include <cstdlib>
#include <fstream>
#include <string>
#include <string_view>

namespace urs {
namespace {

RedisEndpointConfig parse_endpoint(const nlohmann::json& j, std::uint16_t default_port) {
  RedisEndpointConfig ep;
  ep.host = j.value("host", ep.host);
  ep.port = static_cast<std::uint16_t>(j.value("port", static_cast<int>(default_port)));
  ep.password = j.value("password", ep.password);
  return ep;
}

void apply_env_string(const char* name, std::string& dest) {
  if (const char* v = std::getenv(name); v != nullptr && v[0] != '\0') {
    dest = v;
  }
}

void apply_env_port(const char* name, std::uint16_t& dest) {
  if (const char* v = std::getenv(name); v != nullptr && v[0] != '\0') {
    const int p = std::atoi(v);
    if (p >= 1 && p <= 65535) {
      dest = static_cast<std::uint16_t>(p);
    }
  }
}

// "host:port" → port (default if missing). IPv6 with brackets not supported here.
std::string port_from_listen(const std::string& host_port, const char* fallback) {
  const auto pos = host_port.rfind(':');
  if (pos == std::string::npos || pos + 1 >= host_port.size()) {
    return fallback;
  }
  // Ambiguous IPv6 (multiple ':') without brackets — keep fallback port.
  if (host_port.find(':') != pos) {
    return fallback;
  }
  return host_port.substr(pos + 1);
}

std::string replace_host_keep_port(const std::string& host_port, const std::string& host,
                                   const char* default_port) {
  return host + ":" + port_from_listen(host_port, default_port);
}

void apply_sip_host_override(AppConfig& cfg, const std::string& host) {
  cfg.sip.udp_listen = replace_host_keep_port(cfg.sip.udp_listen, host, "5060");
  cfg.sip.tcp_listen = replace_host_keep_port(cfg.sip.tcp_listen, host, "5060");
  cfg.sip.tls_listen = replace_host_keep_port(cfg.sip.tls_listen, host, "5061");
  if (!cfg.sip.wss_listen.empty()) {
    cfg.sip.wss_listen = replace_host_keep_port(cfg.sip.wss_listen, host, "57344");
  }
  cfg.sip.contact_wss_host = host;
}

void apply_env_overrides(AppConfig& cfg) {
  apply_env_string("UR_REDIS_PUBSUB_HOST", cfg.redis.pubsub.host);
  apply_env_port("UR_REDIS_PUBSUB_PORT", cfg.redis.pubsub.port);
  apply_env_string("UR_REDIS_PUBSUB_PASSWORD", cfg.redis.pubsub.password);

  apply_env_string("UR_REDIS_STORE_HOST", cfg.redis.store.host);
  apply_env_port("UR_REDIS_STORE_PORT", cfg.redis.store.port);
  apply_env_string("UR_REDIS_STORE_PASSWORD", cfg.redis.store.password);

  apply_env_string("UR_REDIS_PUBSUB_CHANNEL", cfg.redis.pubsub_channel);

  // Rewrite all sip.* hosts from one IP (staging/prod). Per-field env wins after.
  if (const char* host = std::getenv("UR_SIP_HOST"); host != nullptr && host[0] != '\0') {
    apply_sip_host_override(cfg, host);
  }
  apply_env_string("UR_SIP_UDP_LISTEN", cfg.sip.udp_listen);
  apply_env_string("UR_SIP_TCP_LISTEN", cfg.sip.tcp_listen);
  apply_env_string("UR_SIP_TLS_LISTEN", cfg.sip.tls_listen);
  apply_env_string("UR_SIP_WSS_LISTEN", cfg.sip.wss_listen);
  apply_env_string("UR_SIP_CERTIFICATE_DIR", cfg.sip.certificate_dir);
  apply_env_string("UR_SIP_CONTACT_WSS_HOST", cfg.sip.contact_wss_host);
}

bool is_valid_log_level(std::string_view level) {
  return level == "debug" || level == "info" || level == "warn" || level == "warning" ||
         level == "error";
}

bool port_ok(std::uint16_t port) { return port >= 1; }

Result<void> validate_endpoint(const RedisEndpointConfig& ep, const char* label) {
  if (ep.host.empty()) {
    return Result<void>::err(std::string("missing required field redis.") + label + ".host");
  }
  if (!port_ok(ep.port)) {
    return Result<void>::err(std::string("invalid redis.") + label +
                             ".port (expected 1..65535)");
  }
  return Result<void>::ok();
}

Result<void> validate(const AppConfig& cfg) {
  if (!is_valid_log_level(cfg.logging.level)) {
    return Result<void>::err("invalid logging.level (expected debug|info|warn|warning|error)");
  }

  if (auto ok = validate_endpoint(cfg.redis.pubsub, "pubsub"); !ok) {
    return ok;
  }
  if (auto ok = validate_endpoint(cfg.redis.store, "store"); !ok) {
    return ok;
  }

  if (cfg.redis.pubsub_channel.empty()) {
    return Result<void>::err("missing required field redis.pubsub_channel");
  }
  if (cfg.redis.pbx_alive_ttl_sec == 0) {
    return Result<void>::err("invalid redis.pbx_alive_ttl_sec (must be > 0)");
  }
  if (cfg.redis.call_live_ttl_sec == 0) {
    return Result<void>::err("invalid redis.call_live_ttl_sec (must be > 0)");
  }

  if (cfg.pbx.snapshot_path.empty()) {
    return Result<void>::err("missing required field pbx.snapshot_path");
  }

  if (cfg.sip.udp_listen.empty()) {
    return Result<void>::err("missing required field sip.udp_listen");
  }
  if (cfg.sip.tcp_listen.empty()) {
    return Result<void>::err("missing required field sip.tcp_listen");
  }
  if (cfg.sip.tls_listen.empty()) {
    return Result<void>::err("missing required field sip.tls_listen");
  }
  if (!cfg.sip.wss_listen.empty() && cfg.sip.certificate_dir.empty()) {
    return Result<void>::err(
        "sip.wss_listen set but sip.certificate_dir is empty "
        "(Sofia needs agent.pem directory)");
  }

  return Result<void>::ok();
}

}  // namespace

Result<AppConfig> Config::load(const std::string& path) {
  std::ifstream in(path);
  if (!in) {
    return Result<AppConfig>::err("failed to open config: " + path);
  }

  nlohmann::json root;
  try {
    in >> root;
  } catch (const nlohmann::json::exception& ex) {
    return Result<AppConfig>::err(std::string("JSON parse error: ") + ex.what());
  }

  AppConfig cfg;
  cfg.version = root.value("version", cfg.version);

  if (root.contains("logging") && root["logging"].is_object()) {
    const auto& logging = root["logging"];
    cfg.logging.level = logging.value("level", cfg.logging.level);
    cfg.logging.file = logging.value("file", cfg.logging.file);
  }

  if (root.contains("redis") && root["redis"].is_object()) {
    const auto& redis = root["redis"];
    if (redis.contains("pubsub") && redis["pubsub"].is_object()) {
      cfg.redis.pubsub = parse_endpoint(redis["pubsub"], 6379);
    }
    if (redis.contains("store") && redis["store"].is_object()) {
      cfg.redis.store = parse_endpoint(redis["store"], 6379);
    }
    cfg.redis.pubsub_channel = redis.value("pubsub_channel", cfg.redis.pubsub_channel);
    cfg.redis.pbx_alive_ttl_sec =
        redis.value("pbx_alive_ttl_sec", cfg.redis.pbx_alive_ttl_sec);
    cfg.redis.call_live_ttl_sec =
        redis.value("call_live_ttl_sec", cfg.redis.call_live_ttl_sec);
  }

  if (root.contains("pbx") && root["pbx"].is_object()) {
    const auto& pbx = root["pbx"];
    cfg.pbx.snapshot_path = pbx.value("snapshot_path", cfg.pbx.snapshot_path);
    if (pbx.contains("allowed_ips") && pbx["allowed_ips"].is_array()) {
      cfg.pbx.allowed_ips.clear();
      for (const auto& entry : pbx["allowed_ips"]) {
        if (entry.is_string()) {
          const auto ip = entry.get<std::string>();
          if (!ip.empty()) {
            cfg.pbx.allowed_ips.push_back(ip);
          }
        }
      }
    }
  }

  if (root.contains("sip") && root["sip"].is_object()) {
    const auto& sip = root["sip"];
    cfg.sip.udp_listen = sip.value("udp_listen", cfg.sip.udp_listen);
    cfg.sip.tcp_listen = sip.value("tcp_listen", cfg.sip.tcp_listen);
    cfg.sip.tls_listen = sip.value("tls_listen", cfg.sip.tls_listen);
    cfg.sip.wss_listen = sip.value("wss_listen", cfg.sip.wss_listen);
    cfg.sip.certificate_dir =
        sip.value("certificate_dir", cfg.sip.certificate_dir);
    cfg.sip.contact_wss_host =
        sip.value("contact_wss_host", cfg.sip.contact_wss_host);
  }

  apply_env_overrides(cfg);

  if (auto ok = validate(cfg); !ok) {
    return Result<AppConfig>::err(ok.error());
  }

  return Result<AppConfig>::ok(std::move(cfg));
}

}  // namespace urs
