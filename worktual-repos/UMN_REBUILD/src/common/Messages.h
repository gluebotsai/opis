#pragma once

#include "common/ModuleIds.h"

#include <cstdint>
#include <string>
#include <string_view>

namespace urs {

enum class MessageType : std::uint8_t {
  Dummy = 0,           // Phase 2 smoke
  InviteRoute = 1,     // Phase 5: INVITE → getNextPbxIp (in-process)
  Register = 2,        // planned: registration path
  LiveCallLookup = 3,  // planned: call:live:<uid> read
};

struct ModuleMessage {
  ModuleId src{ModuleId::Unknown};
  ModuleId dst{ModuleId::Unknown};
  MessageType type{MessageType::Dummy};
  std::string payload;  // opaque JSON/text for now
};

[[nodiscard]] std::string_view to_string(MessageType type);

}  // namespace urs