#include "controller/Controller.h"

#include "logging/Logger.h"

#include <nlohmann/json.hpp>

#include <string>

namespace urs {
namespace {

ModuleMessage make_response(const ModuleMessage& req, std::string payload) {
  ModuleMessage resp;
  resp.src = ModuleId::Controller;
  resp.dst = req.src;
  resp.type = req.type;
  resp.payload = std::move(payload);
  return resp;
}

}  // namespace

void Controller::setInterrogator(InterrogatorApi* api) noexcept {
  std::lock_guard lock(mutex_);
  interrogator_ = api;
}

void Controller::clearInterrogator() noexcept {
  std::lock_guard lock(mutex_);
  interrogator_ = nullptr;
}

Result<void> Controller::registerModule(std::shared_ptr<IModule> module) {
  if (!module) {
    return Result<void>::err("registerModule: null module");
  }
  if (initialized_) {
    return Result<void>::err("registerModule: already initialized");
  }

  const ModuleId id = module->id();
  if (id == ModuleId::Unknown || id == ModuleId::Controller) {
    return Result<void>::err("registerModule: invalid module id");
  }

  std::lock_guard lock(mutex_);
  if (modules_.contains(id)) {
    return Result<void>::err(std::string("registerModule: duplicate id ") +
                             std::string(to_string(id)));
  }

  modules_.emplace(id, module);
  init_order_.push_back(std::move(module));
  return Result<void>::ok();
}

Result<void> Controller::init() {
  std::lock_guard lock(mutex_);
  if (initialized_) {
    return Result<void>::ok();
  }

  for (const auto& module : init_order_) {
    if (auto ok = module->init(); !ok) {
      return Result<void>::err(std::string("module init failed: ") +
                               std::string(module->name()) + ": " + ok.error());
    }
  }

  initialized_ = true;
  Logger::instance().info("Controller initialized (" +
                          std::to_string(init_order_.size()) + " modules)");
  return Result<void>::ok();
}

Result<void> Controller::start() {
  std::lock_guard lock(mutex_);
  if (!initialized_) {
    return Result<void>::err("Controller::start before init");
  }
  running_ = true;
  Logger::instance().info("Controller started");
  return Result<void>::ok();
}

void Controller::stop() {
  std::lock_guard lock(mutex_);
  if (!running_ && !initialized_) {
    return;
  }
  running_ = false;
  Logger::instance().info("Controller stopped");
  initialized_ = false;
}

Result<void> Controller::handleLocal(ModuleMessage message) {
  Logger::instance().info(
      std::string("Controller local message type=") +
      std::string(to_string(message.type)) +
      " src=" + std::string(to_string(message.src)) +
      " payload=" + message.payload);
  return Result<void>::ok();
}

Result<void> Controller::handleModuleCallbackMsg(ModuleMessage message) {
  if (message.dst == ModuleId::Controller) {
    return handleLocal(std::move(message));
  }

  std::shared_ptr<IModule> target;
  {
    std::lock_guard lock(mutex_);
    if (!initialized_ || !running_) {
      return Result<void>::err("Controller not running");
    }
    auto it = modules_.find(message.dst);
    if (it == modules_.end() || !it->second) {
      return Result<void>::err(
          std::string("handleModuleCallbackMsg: unknown destination ") +
          std::string(to_string(message.dst)));
    }
    target = it->second;
  }

  return target->pushMsg(std::move(message));
}

Result<void> Controller::push(ModuleMessage message) {
  return handleModuleCallbackMsg(std::move(message));
}

Result<ModuleMessage> Controller::request(ModuleMessage req) {
  InterrogatorApi* api = nullptr;
  {
    std::lock_guard lock(mutex_);
    if (!initialized_ || !running_) {
      return Result<ModuleMessage>::err("Controller not running");
    }
    api = interrogator_;
  }
  if (!api) {
    return Result<ModuleMessage>::err("interrogator not wired");
  }

  switch (req.type) {
    case MessageType::InviteRoute:
      return handleInviteRoute(std::move(req));
    case MessageType::LiveCallLookup:
      return handleLiveCallLookup(std::move(req));
    case MessageType::Register:
      return handleRegister(std::move(req));
    case MessageType::Dummy:
      break;
  }
  return Result<ModuleMessage>::err("request: unsupported message type");
}

Result<ModuleMessage> Controller::handleInviteRoute(ModuleMessage req) {
  InterrogatorApi* api = nullptr;
  {
    std::lock_guard lock(mutex_);
    api = interrogator_;
  }
  if (!api) {
    return Result<ModuleMessage>::err("interrogator not wired");
  }

  nlohmann::json in = nlohmann::json::object();
  if (!req.payload.empty()) {
    try {
      in = nlohmann::json::parse(req.payload);
    } catch (const nlohmann::json::exception& ex) {
      return Result<ModuleMessage>::err(std::string("InviteRoute JSON parse: ") +
                                        ex.what());
    }
  }

  const std::string trans_id = in.value("trans_id", "");
  const std::string call_id = in.value("call_id", "");
  const std::string calling = in.value("calling_party", "");
  const std::string called = in.value("called_party", "");

  Logger::instance().info(
      "[SGW] Controller handling SIP_EVENT_INVITE_REQUEST call_id=" + call_id +
      " from=" + calling + " to=" + called);

  // Phase 5: new-invite path only — getNextPbxIp() (no TCP Interrogator).
  auto pbx = api->getNextPbxIp();
  nlohmann::json out;
  out["msg_type"] = "INVITE_RES";
  out["trans_id"] = trans_id;
  if (pbx) {
    out["call_id"] = call_id;
    out["route_pbx_ip"] = pbx.value();
    out["ok"] = true;
    // Intentionally omit password (old INVITE_RES field).
    Logger::instance().info("[SGW] InviteRoute → route_pbx_ip=" + pbx.value() +
                            " call_id=" + call_id);
  } else {
    out["error_reason"] = pbx.error().empty() ? "No PBX found" : pbx.error();
    out["ok"] = false;
    Logger::instance().warn(
        "[SGW] InviteRoute failed: " +
        out["error_reason"].get<std::string>() + " call_id=" + call_id);
  }

  return Result<ModuleMessage>::ok(make_response(req, out.dump()));
}

Result<ModuleMessage> Controller::handleLiveCallLookup(ModuleMessage req) {
  InterrogatorApi* api = nullptr;
  {
    std::lock_guard lock(mutex_);
    api = interrogator_;
  }
  if (!api) {
    return Result<ModuleMessage>::err("interrogator not wired");
  }

  nlohmann::json in = nlohmann::json::object();
  if (!req.payload.empty()) {
    try {
      in = nlohmann::json::parse(req.payload);
    } catch (const nlohmann::json::exception& ex) {
      return Result<ModuleMessage>::err(
          std::string("LiveCallLookup JSON parse: ") + ex.what());
    }
  }

  const std::string call_uid = in.value("call_uid", "");
  if (call_uid.empty()) {
    return Result<ModuleMessage>::err("LiveCallLookup missing call_uid");
  }

  auto looked = api->lookupLiveCall(call_uid);
  if (!looked) {
    return Result<ModuleMessage>::err(looked.error());
  }

  nlohmann::json out;
  out["msg_type"] = "LIVE_CALL_LOOKUP_RES";
  out["call_uid"] = call_uid;
  if (looked.value()) {
    out["found"] = true;
    out["client_call_info"] = looked.value()->client_call_info_json;
    out["call_hosted_info"] = looked.value()->call_hosted_info_json;
  } else {
    out["found"] = false;
  }

  return Result<ModuleMessage>::ok(make_response(req, out.dump()));
}

Result<ModuleMessage> Controller::handleRegister(ModuleMessage req) {
  InterrogatorApi* api = nullptr;
  {
    std::lock_guard lock(mutex_);
    api = interrogator_;
  }
  if (!api) {
    return Result<ModuleMessage>::err("interrogator not wired");
  }

  std::string aor_hint;
  try {
    const auto in = nlohmann::json::parse(req.payload);
    aor_hint = in.value("username", "") + "@" + in.value("domain", "");
  } catch (...) {
  }

  Logger::instance().info(
      "[SGW] Controller handling SIP_EVENT_DO_USER_REG_REQ aor=" + aor_hint);

  RegisterRequest reg;
  reg.raw_json = req.payload;
  auto resp = api->handleRegister(reg);
  if (!resp) {
    Logger::instance().warn("[SGW] Register → Interrogator failed: " +
                            resp.error());
    return Result<ModuleMessage>::err(resp.error());
  }

  nlohmann::json out;
  out["msg_type"] = "REGISTER_RES";
  out["accepted"] = resp.value().accepted;
  out["need_challenge"] = resp.value().need_challenge;
  out["detail"] = resp.value().detail;
  if (!resp.value().realm.empty()) {
    out["realm"] = resp.value().realm;
  }
  if (!resp.value().nonce.empty()) {
    out["nonce"] = resp.value().nonce;
  }
  if (!resp.value().contact.empty()) {
    out["contact"] = resp.value().contact;
  }

  if (resp.value().need_challenge) {
    Logger::instance().info(
        "[SGW] Controller REGISTER_RES challenge(401) aor=" + aor_hint);
  } else if (resp.value().accepted) {
    Logger::instance().info(
        "[SGW] Controller REGISTER_RES accepted(200) aor=" + aor_hint +
        " detail=" + resp.value().detail);
  } else {
    Logger::instance().warn(
        "[SGW] Controller REGISTER_RES denied aor=" + aor_hint +
        " detail=" + resp.value().detail);
  }

  return Result<ModuleMessage>::ok(make_response(req, out.dump()));
}

}  // namespace urs