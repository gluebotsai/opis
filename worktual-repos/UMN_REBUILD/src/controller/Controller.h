#pragma once

#include "common/IModule.h"
#include "common/Messages.h"
#include "common/Result.h"
#include "interrogator/api/InterrogatorApi.h"

#include <map>
#include <memory>
#include <mutex>
#include <vector>

namespace urs {

// Mediator — routes modules + in-process InterrogatorApi (no NetIO TCP).
class Controller {
public:
  Controller() = default;
  ~Controller() = default;

  Controller(const Controller&) = delete;
  Controller& operator=(const Controller&) = delete;

  // Non-owning; Application clears before destroying InterrogatorService.
  void setInterrogator(InterrogatorApi* api) noexcept;
  void clearInterrogator() noexcept;

  [[nodiscard]] Result<void> registerModule(std::shared_ptr<IModule> module);

  [[nodiscard]] Result<void> init();
  [[nodiscard]] Result<void> start();
  void stop();

  // Route by destination (SGW handleModuleCallbackMsg behaviour).
  [[nodiscard]] Result<void> handleModuleCallbackMsg(ModuleMessage message);
  [[nodiscard]] Result<void> push(ModuleMessage message);

  // Synchronous in-process Interrogator requests (InviteRoute / LiveCallLookup / Register).
  [[nodiscard]] Result<ModuleMessage> request(ModuleMessage req);

private:
  [[nodiscard]] Result<void> handleLocal(ModuleMessage message);
  [[nodiscard]] Result<ModuleMessage> handleInviteRoute(ModuleMessage req);
  [[nodiscard]] Result<ModuleMessage> handleLiveCallLookup(ModuleMessage req);
  [[nodiscard]] Result<ModuleMessage> handleRegister(ModuleMessage req);

  mutable std::mutex mutex_;
  std::map<ModuleId, std::shared_ptr<IModule>> modules_;
  std::vector<std::shared_ptr<IModule>> init_order_;
  InterrogatorApi* interrogator_{nullptr};
  bool initialized_{false};
  bool running_{false};
};

}  // namespace urs