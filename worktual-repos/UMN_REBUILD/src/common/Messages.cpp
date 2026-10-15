#include "common/Messages.h"

namespace urs {

std::string_view to_string(MessageType type) {
  switch (type) {
    case MessageType::Dummy:
      return "Dummy";
    case MessageType::InviteRoute:
      return "InviteRoute";
    case MessageType::Register:
      return "Register";
    case MessageType::LiveCallLookup:
      return "LiveCallLookup";
  }
  return "Unknown";
}

}  // namespace urs