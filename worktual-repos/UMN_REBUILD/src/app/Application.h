#pragma once

#include "config/Config.h"
#include "controller/Controller.h"
#include "controller/StubEchoModule.h"
#include "interrogator/InterrogatorService.h"
#include "redis/LiveCallStore.h"
#include "redis/PbxPresenceStore.h"
#include "redis/RedisClient.h"
#include "sip/SipService.h"

#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <optional>

namespace urs {

class Application {
public:
  explicit Application(AppConfig config);

  [[nodiscard]] Result<void> start();
  void stop();

  void request_shutdown() noexcept;
  void wait_for_shutdown(const std::atomic<bool>& signal_shutdown);

  [[nodiscard]] const AppConfig& config() const noexcept { return config_; }
  [[nodiscard]] bool running() const noexcept { return running_.load(); }
  [[nodiscard]] Controller& controller() noexcept { return controller_; }
  [[nodiscard]] InterrogatorService* interrogator() noexcept {
    return interrogator_ ? &*interrogator_ : nullptr;
  }
  [[nodiscard]] SipService* sip() noexcept {
    return sip_ ? &*sip_ : nullptr;
  }

private:
  AppConfig config_;
  RedisClient redis_;
  std::optional<PbxPresenceStore> presence_;
  std::optional<LiveCallStore> live_calls_;
  std::optional<InterrogatorService> interrogator_;
  Controller controller_;
  std::shared_ptr<StubEchoModule> stub_echo_;
  std::optional<SipService> sip_;
  std::atomic<bool> running_{false};
  std::atomic<bool> shutdown_requested_{false};
  std::mutex wait_mutex_;
  std::condition_variable wait_cv_;
};

}  // namespace urs
