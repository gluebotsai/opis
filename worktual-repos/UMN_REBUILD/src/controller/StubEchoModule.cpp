#include "controller/StubEchoModule.h"

#include "logging/Logger.h"

#include <string>

namespace urs {

Result<void> StubEchoModule::init() {
  initialized_ = true;
  Logger::instance().info("StubEchoModule initialized");
  return Result<void>::ok();
}

Result<void> StubEchoModule::pushMsg(ModuleMessage msg) {
  if (!initialized_) {
    return Result<void>::err("StubEchoModule not initialized");
  }

  Logger::instance().info(
      std::string("StubEchoModule received type=") + std::string(to_string(msg.type)) +
      " src=" + std::string(to_string(msg.src)) + " payload=" + msg.payload);

  {
    std::lock_guard lock(mutex_);
    last_ = std::move(msg);
  }
  return Result<void>::ok();
}

std::optional<ModuleMessage> StubEchoModule::last_message() const {
  std::lock_guard lock(mutex_);
  return last_;
}

}  // namespace urs