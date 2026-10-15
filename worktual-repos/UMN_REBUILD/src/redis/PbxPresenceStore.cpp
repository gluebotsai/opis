#include "redis/PbxPresenceStore.h"

namespace urs {

PbxPresenceStore::PbxPresenceStore(RedisClient& redis) : redis_(redis) {}

std::string PbxPresenceStore::keyFor(const PbxIp& ip) {
  return "pbx:alive:" + ip;
}

Result<void> PbxPresenceStore::refreshAlive(const PbxIp& ip, std::uint32_t ttl_sec) {
  if (ip.empty()) {
    return Result<void>::err("refreshAlive: empty ip");
  }
  if (ttl_sec == 0) {
    return Result<void>::err("refreshAlive: ttl_sec must be > 0");
  }
  return redis_.setEx(keyFor(ip), "1", ttl_sec);
}

Result<bool> PbxPresenceStore::isAlive(const PbxIp& ip) {
  if (ip.empty()) {
    return Result<bool>::err("isAlive: empty ip");
  }
  auto got = redis_.get(keyFor(ip));
  if (!got) {
    return Result<bool>::err(got.error());
  }
  return Result<bool>::ok(got.value().has_value());
}

Result<void> PbxPresenceStore::clearAlive(const PbxIp& ip) {
  if (ip.empty()) {
    return Result<void>::err("clearAlive: empty ip");
  }
  return redis_.del(keyFor(ip));
}

}  // namespace urs