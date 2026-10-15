#pragma once

#include "common/Messages.h"
#include "common/ModuleIds.h"
#include "common/Result.h"

#include <string_view>

namespace urs {

// Simplified from SGW IURModule — no ACE, no raw IURModuleMsg*, no unitModule debt.
class IModule {
public:
  virtual ~IModule() = default;

  [[nodiscard]] virtual Result<void> init() = 0;
  [[nodiscard]] virtual Result<void> pushMsg(ModuleMessage msg) = 0;
  [[nodiscard]] virtual std::string_view name() const = 0;
  [[nodiscard]] virtual ModuleId id() const = 0;
};

}  // namespace urs