#include "redis/LiveCallStore.h"

#include <nlohmann/json.hpp>

namespace urs {
namespace {

bool is_wrong_type(const std::string& err) {
  return err.find("WRONGTYPE") != std::string::npos ||
         err.find("wrong kind of value") != std::string::npos;
}

}  // namespace

LiveCallStore::LiveCallStore(RedisClient& redis) : redis_(redis) {}

std::string LiveCallStore::keyFor(const CallUid& uid) {
  return "call:live:" + uid;
}

Result<std::unordered_map<std::string, std::string>> LiveCallStore::hgetall(const CallUid& uid) {
  if (uid.empty()) {
    return Result<std::unordered_map<std::string, std::string>>::err("hgetall: empty uid");
  }
  return redis_.hgetall(keyFor(uid));
}

Result<std::optional<std::string>> LiveCallStore::getRaw(const CallUid& uid) {
  if (uid.empty()) {
    return Result<std::optional<std::string>>::err("getRaw: empty uid");
  }
  return redis_.get(keyFor(uid));
}

Result<std::optional<LiveCallInfo>> LiveCallStore::get(const CallUid& uid) {
  if (uid.empty()) {
    return Result<std::optional<LiveCallInfo>>::err("get: empty uid");
  }

  const std::string key = keyFor(uid);

  // String form first (common smoke / simple PBX SET).
  auto raw = redis_.get(key);
  if (raw) {
    if (!raw.value()) {
      // Missing as string — try hash.
    } else {
      LiveCallInfo info;
      info.uid = uid;
      info.client_call_info_json = *raw.value();
      return Result<std::optional<LiveCallInfo>>::ok(std::optional<LiveCallInfo>(std::move(info)));
    }
  } else if (!is_wrong_type(raw.error())) {
    return Result<std::optional<LiveCallInfo>>::err(raw.error());
  }

  auto hash = redis_.hgetall(key);
  if (!hash) {
    if (is_wrong_type(hash.error()) && raw && !raw.value()) {
      return Result<std::optional<LiveCallInfo>>::ok(std::nullopt);
    }
    return Result<std::optional<LiveCallInfo>>::err(hash.error());
  }

  if (hash.value().empty()) {
    return Result<std::optional<LiveCallInfo>>::ok(std::nullopt);
  }

  LiveCallInfo info;
  info.uid = uid;
  const auto& m = hash.value();
  if (auto it = m.find("client-call-info"); it != m.end()) {
    info.client_call_info_json = it->second;
  }
  if (auto it = m.find("client_call_info"); it != m.end() && info.client_call_info_json.empty()) {
    info.client_call_info_json = it->second;
  }
  if (auto it = m.find("call-hosted-info"); it != m.end()) {
    info.call_hosted_info_json = it->second;
  }
  if (auto it = m.find("call_hosted_info"); it != m.end() && info.call_hosted_info_json.empty()) {
    info.call_hosted_info_json = it->second;
  }
  if (info.client_call_info_json.empty() && info.call_hosted_info_json.empty()) {
    info.client_call_info_json = nlohmann::json(m).dump();
  }
  return Result<std::optional<LiveCallInfo>>::ok(std::optional<LiveCallInfo>(std::move(info)));
}

}  // namespace urs