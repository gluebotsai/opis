#pragma once

#include "common/Result.h"
#include "common/Types.h"
#include "redis/RedisClient.h"

#include <cstdint>
#include <string>

namespace urs {

// ONLY pbx:alive:<ip> TTL presence — not a full PBX registry in Redis.
class PbxPresenceStore {
public:
  explicit PbxPresenceStore(RedisClient& redis);

  [[nodiscard]] static std::string keyFor(const PbxIp& ip);

  [[nodiscard]] Result<void> refreshAlive(const PbxIp& ip, std::uint32_t ttl_sec);
  [[nodiscard]] Result<bool> isAlive(const PbxIp& ip);
  [[nodiscard]] Result<void> clearAlive(const PbxIp& ip);

private:
  RedisClient& redis_;
};

}  // namespace urs