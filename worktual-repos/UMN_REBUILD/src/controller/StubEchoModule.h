#pragma once

#include "common/IModule.h"

#include <mutex>
#include <optional>

namespace urs {

// Phase 2 smoke stub — records last message for tests / Application demo.
class StubEchoModule final : public IModule {
public:
  StubEchoModule() = default;

  [[nodiscard]] Result<void> init() override;
  [[nodiscard]] Result<void> pushMsg(ModuleMessage msg) override;
  [[nodiscard]] std::string_view name() const override { return "StubEcho"; }
  [[nodiscard]] ModuleId id() const override { return ModuleId::StubEcho; }

  [[nodiscard]] std::optional<ModuleMessage> last_message() const;

private:
  mutable std::mutex mutex_;
  bool initialized_{false};
  std::optional<ModuleMessage> last_;
};

}  // namespace urs