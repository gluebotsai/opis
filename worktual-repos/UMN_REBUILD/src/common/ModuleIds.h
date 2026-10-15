#pragma once

#include <cstdint>
#include <string_view>

namespace urs {

enum class ModuleId : std::uint8_t {
  Unknown = 0,
  Controller = 1,
  Sip = 2,
  Interrogator = 3,
  StubEcho = 4,  // Phase 2 smoke / test only
};

[[nodiscard]] inline std::string_view to_string(ModuleId id) {
  switch (id) {
    case ModuleId::Controller:
      return "Controller";
    case ModuleId::Sip:
      return "Sip";
    case ModuleId::Interrogator:
      return "Interrogator";
    case ModuleId::StubEcho:
      return "StubEcho";
    case ModuleId::Unknown:
      break;
  }
  return "Unknown";
}

}  // namespace urs