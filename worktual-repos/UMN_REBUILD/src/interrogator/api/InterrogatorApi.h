#pragma once

#include "common/Result.h"
#include "common/Types.h"

#include <optional>
#include <string>

namespace urs {

struct LiveCallInfo {
  CallUid uid;
  std::string client_call_info_json;
  std::string call_hosted_info_json;
};

struct RegisterRequest {
  std::string raw_json;
};

struct RegisterResponse {
  bool accepted{false};
  bool need_challenge{false};
  std::string detail;
  std::string realm;
  std::string nonce;
  std::string contact;  // Contact for 200 OK
};

// In-process facade — Controller calls this; NOT NetIO/TCP.
class InterrogatorApi {
public:
  virtual ~InterrogatorApi() = default;

  [[nodiscard]] virtual Result<PbxIp> getNextPbxIp() = 0;
  [[nodiscard]] virtual Result<std::optional<LiveCallInfo>> lookupLiveCall(
      const CallUid& uid) = 0;
  [[nodiscard]] virtual Result<RegisterResponse> handleRegister(
      const RegisterRequest& request) = 0;
};

}  // namespace urs