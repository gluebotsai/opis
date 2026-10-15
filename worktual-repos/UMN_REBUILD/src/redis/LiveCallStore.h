#pragma once

#include "common/Result.h"
#include "common/Types.h"
#include "interrogator/api/InterrogatorApi.h"
#include "redis/RedisClient.h"

#include <optional>
#include <string>
#include <unordered_map>

namespace urs {

// READ-ONLY access to call:live:<uid>. PBX writes only — no write/delete APIs here.
class LiveCallStore {
public:
  explicit LiveCallStore(RedisClient& redis);

  [[nodiscard]] static std::string keyFor(const CallUid& uid);

  [[nodiscard]] Result<std::optional<LiveCallInfo>> get(const CallUid& uid);
  [[nodiscard]] Result<std::optional<std::string>> getRaw(const CallUid& uid);
  [[nodiscard]] Result<std::unordered_map<std::string, std::string>> hgetall(const CallUid& uid);

private:
  RedisClient& redis_;
};

}  // namespace urs