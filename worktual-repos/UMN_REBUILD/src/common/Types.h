#pragma once

#include <cstdint>
#include <string>

namespace urs {

using PbxIp = std::string;
using CallUid = std::string;
using RedisChannel = std::string;

struct Endpoint {
  std::string host;
  std::uint16_t port{0};
};

}  // namespace urs