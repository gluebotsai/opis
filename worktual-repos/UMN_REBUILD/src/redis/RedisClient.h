#pragma once

#include "common/Result.h"
#include "config/Config.h"

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>

namespace sw::redis {
class Redis;
}

namespace urs {

// Dual Redis: store (SET/GET/H*) + pubsub (SUBSCRIBE/PUBLISH). Never log passwords.
class RedisClient {
public:
  using MessageHandler = std::function<void(std::string_view channel, std::string_view payload)>;

  RedisClient();
  ~RedisClient();

  RedisClient(const RedisClient&) = delete;
  RedisClient& operator=(const RedisClient&) = delete;

  [[nodiscard]] Result<void> connect(const RedisConfig& config);
  void disconnect();

  [[nodiscard]] bool connected() const noexcept { return connected_.load(); }
  [[nodiscard]] const RedisConfig& config() const noexcept { return config_; }

  // Store Redis (GET/SET/HGETALL / pbx:alive / call:live).
  [[nodiscard]] Result<void> set(std::string_view key, std::string_view value);
  [[nodiscard]] Result<void> setEx(std::string_view key, std::string_view value, std::uint32_t ttl_sec);
  [[nodiscard]] Result<std::optional<std::string>> get(std::string_view key);
  [[nodiscard]] Result<void> del(std::string_view key);
  [[nodiscard]] Result<void> expire(std::string_view key, std::uint32_t ttl_sec);
  [[nodiscard]] Result<void> hset(std::string_view key, std::string_view field,
                                  std::string_view value);
  [[nodiscard]] Result<std::unordered_map<std::string, std::string>> hgetall(std::string_view key);

  // Pub/Sub Redis.
  [[nodiscard]] Result<long long> publish(std::string_view channel, std::string_view payload);
  [[nodiscard]] Result<void> subscribe(std::string_view channel, MessageHandler handler);
  void unsubscribe();

private:
  [[nodiscard]] Result<std::unique_ptr<sw::redis::Redis>> connectEndpoint(
      const RedisEndpointConfig& ep, const char* role_label);
  [[nodiscard]] Result<void> ensureStore();
  [[nodiscard]] Result<void> ensurePubsub();

  RedisConfig config_;
  std::unique_ptr<sw::redis::Redis> store_;
  std::unique_ptr<sw::redis::Redis> pubsub_;
  std::mutex store_mutex_;
  std::mutex pubsub_mutex_;
  std::atomic<bool> connected_{false};

  std::thread sub_thread_;
  std::atomic<bool> sub_stop_{false};
  std::atomic<bool> sub_running_{false};
  std::atomic<bool> sub_ready_{false};
  std::string sub_channel_;
  MessageHandler sub_handler_;
};

}  // namespace urs
