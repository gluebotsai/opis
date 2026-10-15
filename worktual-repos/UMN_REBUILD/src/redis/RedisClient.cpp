#include "redis/RedisClient.h"

#include "logging/Logger.h"

#include <sw/redis++/redis++.h>

#include <chrono>
#include <utility>

namespace urs {
namespace {

sw::redis::ConnectionOptions make_options(const RedisEndpointConfig& ep) {
  sw::redis::ConnectionOptions opts;
  opts.host = ep.host;
  opts.port = static_cast<int>(ep.port);
  if (!ep.password.empty()) {
    opts.password = ep.password;
  }
  opts.socket_timeout = std::chrono::milliseconds(2000);
  opts.connect_timeout = std::chrono::milliseconds(2000);
  return opts;
}

}  // namespace

RedisClient::RedisClient() = default;

RedisClient::~RedisClient() { disconnect(); }

Result<std::unique_ptr<sw::redis::Redis>> RedisClient::connectEndpoint(
    const RedisEndpointConfig& ep, const char* role_label) {
  try {
    auto redis = std::make_unique<sw::redis::Redis>(make_options(ep));
    const auto pong = redis->ping();
    if (pong != "PONG" && pong != "pong") {
      return Result<std::unique_ptr<sw::redis::Redis>>::err(
          std::string("redis ping unexpected response (") + role_label + ")");
    }
    Logger::instance().info(std::string("RedisClient connected to ") + ep.host + ":" +
                            std::to_string(ep.port) + " (" + role_label + ")");
    return Result<std::unique_ptr<sw::redis::Redis>>::ok(std::move(redis));
  } catch (const sw::redis::Error& ex) {
    return Result<std::unique_ptr<sw::redis::Redis>>::err(
        std::string("redis connect failed (") + role_label + "): " + ex.what());
  }
}

Result<void> RedisClient::connect(const RedisConfig& config) {
  config_ = config;
  connected_.store(false);

  auto store = connectEndpoint(config_.store, "store");
  if (!store) {
    return Result<void>::err(store.error());
  }
  auto pubsub = connectEndpoint(config_.pubsub, "pubsub");
  if (!pubsub) {
    return Result<void>::err(pubsub.error());
  }

  {
    std::lock_guard lock_store(store_mutex_);
    store_ = std::move(store.value());
  }
  {
    std::lock_guard lock_pubsub(pubsub_mutex_);
    pubsub_ = std::move(pubsub.value());
  }
  connected_.store(true);
  return Result<void>::ok();
}

void RedisClient::disconnect() {
  unsubscribe();
  {
    std::lock_guard lock(store_mutex_);
    store_.reset();
  }
  {
    std::lock_guard lock(pubsub_mutex_);
    pubsub_.reset();
  }
  connected_.store(false);
}

Result<void> RedisClient::ensureStore() {
  if (connected_.load() && store_) {
    return Result<void>::ok();
  }
  return Result<void>::err("RedisClient store not connected");
}

Result<void> RedisClient::ensurePubsub() {
  if (connected_.load() && pubsub_) {
    return Result<void>::ok();
  }
  return Result<void>::err("RedisClient pubsub not connected");
}

Result<void> RedisClient::set(std::string_view key, std::string_view value) {
  if (auto ok = ensureStore(); !ok) {
    return ok;
  }
  try {
    std::lock_guard lock(store_mutex_);
    store_->set(key, value);
    return Result<void>::ok();
  } catch (const sw::redis::Error& ex) {
    return Result<void>::err(ex.what());
  }
}

Result<void> RedisClient::setEx(std::string_view key, std::string_view value, std::uint32_t ttl_sec) {
  if (auto ok = ensureStore(); !ok) {
    return ok;
  }
  try {
    std::lock_guard lock(store_mutex_);
    store_->set(key, value, std::chrono::seconds(ttl_sec));
    return Result<void>::ok();
  } catch (const sw::redis::Error& ex) {
    return Result<void>::err(ex.what());
  }
}

Result<std::optional<std::string>> RedisClient::get(std::string_view key) {
  if (auto ok = ensureStore(); !ok) {
    return Result<std::optional<std::string>>::err(ok.error());
  }
  try {
    std::lock_guard lock(store_mutex_);
    auto val = store_->get(key);
    if (!val) {
      return Result<std::optional<std::string>>::ok(std::nullopt);
    }
    return Result<std::optional<std::string>>::ok(std::optional<std::string>(*val));
  } catch (const sw::redis::Error& ex) {
    return Result<std::optional<std::string>>::err(ex.what());
  }
}

Result<void> RedisClient::del(std::string_view key) {
  if (auto ok = ensureStore(); !ok) {
    return ok;
  }
  try {
    std::lock_guard lock(store_mutex_);
    store_->del(key);
    return Result<void>::ok();
  } catch (const sw::redis::Error& ex) {
    return Result<void>::err(ex.what());
  }
}

Result<void> RedisClient::expire(std::string_view key, std::uint32_t ttl_sec) {
  if (auto ok = ensureStore(); !ok) {
    return ok;
  }
  try {
    std::lock_guard lock(store_mutex_);
    store_->expire(key, static_cast<long long>(ttl_sec));
    return Result<void>::ok();
  } catch (const sw::redis::Error& ex) {
    return Result<void>::err(ex.what());
  }
}

Result<void> RedisClient::hset(std::string_view key, std::string_view field,
                               std::string_view value) {
  if (auto ok = ensureStore(); !ok) {
    return ok;
  }
  try {
    std::lock_guard lock(store_mutex_);
    store_->hset(key, field, value);
    return Result<void>::ok();
  } catch (const sw::redis::Error& ex) {
    return Result<void>::err(ex.what());
  }
}

Result<std::unordered_map<std::string, std::string>> RedisClient::hgetall(std::string_view key) {
  if (auto ok = ensureStore(); !ok) {
    return Result<std::unordered_map<std::string, std::string>>::err(ok.error());
  }
  try {
    std::lock_guard lock(store_mutex_);
    std::unordered_map<std::string, std::string> out;
    store_->hgetall(key, std::inserter(out, out.begin()));
    return Result<std::unordered_map<std::string, std::string>>::ok(std::move(out));
  } catch (const sw::redis::Error& ex) {
    return Result<std::unordered_map<std::string, std::string>>::err(ex.what());
  }
}

Result<long long> RedisClient::publish(std::string_view channel, std::string_view payload) {
  if (auto ok = ensurePubsub(); !ok) {
    return Result<long long>::err(ok.error());
  }
  try {
    std::lock_guard lock(pubsub_mutex_);
    const long long n = pubsub_->publish(channel, payload);
    if (payload != "__urs_unsubscribe__") {
      Logger::instance().info("Redis PUBLISH channel=" + std::string(channel) +
                              " receivers=" + std::to_string(n) +
                              " payload=" + std::string(payload));
    }
    return Result<long long>::ok(n);
  } catch (const sw::redis::Error& ex) {
    return Result<long long>::err(ex.what());
  }
}

Result<void> RedisClient::subscribe(std::string_view channel, MessageHandler handler) {
  if (!handler) {
    return Result<void>::err("subscribe: null handler");
  }
  if (sub_running_.load()) {
    return Result<void>::err("subscribe: already subscribed");
  }
  if (config_.pubsub.host.empty()) {
    return Result<void>::err("subscribe: no redis config (call connect first)");
  }

  sub_stop_.store(false);
  sub_ready_.store(false);
  sub_channel_ = std::string(channel);
  sub_handler_ = std::move(handler);

  const RedisEndpointConfig ep = config_.pubsub;

  sub_thread_ = std::thread([this, ep]() {
    sub_running_.store(true);
    try {
      sw::redis::ConnectionOptions opts = make_options(ep);
      // Remote Redis needs a longer timeout for SUBSCRIBE handshake; keep
      // consume() interruptible for unsubscribe.
      opts.connect_timeout = std::chrono::milliseconds(5000);
      opts.socket_timeout = std::chrono::milliseconds(1000);
      sw::redis::Redis redis(opts);
      auto sub = redis.subscriber();
      sub.on_message([this](std::string chan, std::string msg) {
        if (msg == "__urs_unsubscribe__") {
          return;
        }
        Logger::instance().info("Redis SUBSCRIBE recv channel=" + chan + " payload=" + msg);
        if (sub_handler_) {
          sub_handler_(chan, msg);
        }
      });
      sub.subscribe(sub_channel_);
      sub_ready_.store(true, std::memory_order_release);
      Logger::instance().info("RedisClient subscribed to " + sub_channel_ + " (pubsub)");
      while (!sub_stop_.load()) {
        try {
          sub.consume();
        } catch (const sw::redis::TimeoutError&) {
          // idle wake
        } catch (const sw::redis::Error& ex) {
          const std::string msg = ex.what();
          // Some redis++/hiredis builds surface EAGAIN as Error, not TimeoutError.
          if (msg.find("Resource temporarily unavailable") != std::string::npos ||
              msg.find("errno: 11") != std::string::npos) {
            continue;
          }
          if (!sub_stop_.load()) {
            Logger::instance().error(std::string("subscriber consume error: ") + ex.what());
          }
          break;
        }
      }
    } catch (const sw::redis::Error& ex) {
      Logger::instance().error(std::string("subscriber thread failed: ") + ex.what());
    }
    sub_ready_.store(false);
    sub_running_.store(false);
  });

  for (int i = 0; i < 300 && !sub_ready_.load(std::memory_order_acquire); ++i) {
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  if (!sub_ready_.load(std::memory_order_acquire)) {
    unsubscribe();
    return Result<void>::err("subscribe: timed out waiting for subscriber ready");
  }

  return Result<void>::ok();
}

void RedisClient::unsubscribe() {
  sub_stop_.store(true);
  if (sub_thread_.joinable()) {
    try {
      if (connected_.load() && !sub_channel_.empty() && pubsub_) {
        std::lock_guard lock(pubsub_mutex_);
        if (pubsub_) {
          pubsub_->publish(sub_channel_, "__urs_unsubscribe__");
        }
      }
    } catch (...) {
    }
    sub_thread_.join();
  }
  sub_handler_ = nullptr;
  sub_channel_.clear();
  sub_running_.store(false);
}

}  // namespace urs
