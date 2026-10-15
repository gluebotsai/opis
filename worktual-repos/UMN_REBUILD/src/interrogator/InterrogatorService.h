#pragma once

#include "config/Config.h"
#include "interrogator/PbxSelector.h"
#include "interrogator/api/InterrogatorApi.h"
#include "redis/LiveCallStore.h"
#include "redis/PbxPresenceStore.h"
#include "redis/RedisClient.h"
#include "redis/RegistrationStore.h"

#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>

namespace urs {

class InterrogatorService final : public InterrogatorApi {
public:
  InterrogatorService(RedisClient& redis,
                      PbxPresenceStore& presence,
                      LiveCallStore& live_calls);

  ~InterrogatorService() override;

  InterrogatorService(const InterrogatorService&) = delete;
  InterrogatorService& operator=(const InterrogatorService&) = delete;

  [[nodiscard]] Result<void> start(const AppConfig& config);
  void stop();

  [[nodiscard]] Result<PbxIp> getNextPbxIp() override;
  [[nodiscard]] Result<std::optional<LiveCallInfo>> lookupLiveCall(
      const CallUid& uid) override;
  [[nodiscard]] Result<RegisterResponse> handleRegister(
      const RegisterRequest& request) override;

  [[nodiscard]] PbxSelector& selector() noexcept { return selector_; }
  [[nodiscard]] const PbxSelector& selector() const noexcept { return selector_; }

  // Test helper: process a pub/sub payload without going through Redis subscribe.
  void handlePubSubMessage(std::string_view payload);

private:
  void onMessage(std::string_view channel, std::string_view payload);
  void handleUpsert(const nlohmann::json& object);
  void handleDelete(const nlohmann::json& object);
  [[nodiscard]] bool isAllowedPbx(const PbxIp& ip) const;
  void pruneDisallowedPbx();
  void reconcileExpiredTtl();
  void snapshotLoop();
  void saveSnapshotNow();

  RedisClient& redis_;
  PbxPresenceStore& presence_;
  LiveCallStore& live_calls_;
  RegistrationStore registration_;
  PbxSelector selector_;

  AppConfig config_;
  std::atomic<bool> running_{false};
  std::atomic<bool> snapshot_stop_{false};
  std::thread snapshot_thread_;
  mutable std::mutex start_mutex_;

  // Digest nonce → aor (user@domain), issued for 401 challenges.
  struct NonceEntry {
    std::string aor;
    std::chrono::steady_clock::time_point issued_at{};
  };
  mutable std::mutex nonce_mutex_;
  std::unordered_map<std::string, NonceEntry> digests_nonces_;
};

}  // namespace urs