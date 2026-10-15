#include "common/Messages.h"
#include "controller/Controller.h"
#include "interrogator/api/InterrogatorApi.h"
#include "logging/Logger.h"

#include <nlohmann/json.hpp>

#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>

namespace {

class FakeInterrogator final : public urs::InterrogatorApi {
public:
  [[nodiscard]] urs::Result<urs::PbxIp> getNextPbxIp() override {
    return urs::Result<urs::PbxIp>::ok("10.9.9.9");
  }

  [[nodiscard]] urs::Result<std::optional<urs::LiveCallInfo>> lookupLiveCall(
      const urs::CallUid& uid) override {
    if (uid != "call-uid-1") {
      return urs::Result<std::optional<urs::LiveCallInfo>>::ok(std::nullopt);
    }
    urs::LiveCallInfo info;
    info.uid = uid;
    info.client_call_info_json = R"({"a":1})";
    info.call_hosted_info_json = R"({"pbx":"10.9.9.9"})";
    return urs::Result<std::optional<urs::LiveCallInfo>>::ok(std::move(info));
  }

  [[nodiscard]] urs::Result<urs::RegisterResponse> handleRegister(
      const urs::RegisterRequest& /*request*/) override {
    urs::RegisterResponse resp;
    resp.accepted = false;
    resp.detail = "not implemented";
    return urs::Result<urs::RegisterResponse>::ok(std::move(resp));
  }
};

}  // namespace

int main() {
  if (auto ok = urs::Logger::instance().init("info", ""); !ok) {
    std::cerr << "logger init failed: " << ok.error() << '\n';
    return 1;
  }

  FakeInterrogator fake;
  urs::Controller controller;
  controller.setInterrogator(&fake);

  if (auto ok = controller.init(); !ok) {
    std::cerr << "init failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = controller.start(); !ok) {
    std::cerr << "start failed: " << ok.error() << '\n';
    return 1;
  }

  // InviteRoute
  {
    urs::ModuleMessage req;
    req.src = urs::ModuleId::Sip;
    req.dst = urs::ModuleId::Controller;
    req.type = urs::MessageType::InviteRoute;
    req.payload =
        R"({"msg_type":"INVITE_REQ","trans_id":"t1","call_id":"c1","calling_party":"100","called_party":"200","calling_party_domain":"ex.com","called_party_domain":"ex.com","key":""})";

    auto resp = controller.request(std::move(req));
    if (!resp) {
      std::cerr << "InviteRoute failed: " << resp.error() << '\n';
      return 1;
    }
    const auto j = nlohmann::json::parse(resp.value().payload);
    if (j.value("msg_type", "") != "INVITE_RES" || !j.value("ok", false) ||
        j.value("route_pbx_ip", "") != "10.9.9.9" ||
        j.value("trans_id", "") != "t1" || j.value("call_id", "") != "c1" ||
        j.contains("password")) {
      std::cerr << "InviteRoute unexpected payload: " << resp.value().payload
                << '\n';
      return 1;
    }
    if (resp.value().src != urs::ModuleId::Controller ||
        resp.value().dst != urs::ModuleId::Sip) {
      std::cerr << "InviteRoute unexpected routing fields\n";
      return 1;
    }
  }

  // LiveCallLookup found
  {
    urs::ModuleMessage req;
    req.src = urs::ModuleId::Sip;
    req.dst = urs::ModuleId::Controller;
    req.type = urs::MessageType::LiveCallLookup;
    req.payload = R"({"msg_type":"LIVE_CALL_LOOKUP","call_uid":"call-uid-1"})";

    auto resp = controller.request(std::move(req));
    if (!resp) {
      std::cerr << "LiveCallLookup failed: " << resp.error() << '\n';
      return 1;
    }
    const auto j = nlohmann::json::parse(resp.value().payload);
    if (j.value("msg_type", "") != "LIVE_CALL_LOOKUP_RES" ||
        !j.value("found", false) ||
        j.value("call_uid", "") != "call-uid-1" ||
        j.value("client_call_info", "") != R"({"a":1})" ||
        j.value("call_hosted_info", "") != R"({"pbx":"10.9.9.9"})") {
      std::cerr << "LiveCallLookup unexpected payload: " << resp.value().payload
                << '\n';
      return 1;
    }
  }

  // Register stub
  {
    urs::ModuleMessage req;
    req.src = urs::ModuleId::Sip;
    req.dst = urs::ModuleId::Controller;
    req.type = urs::MessageType::Register;
    req.payload = R"({"msg_type":"REGISTER_REQ"})";

    auto resp = controller.request(std::move(req));
    if (!resp) {
      std::cerr << "Register failed: " << resp.error() << '\n';
      return 1;
    }
    const auto j = nlohmann::json::parse(resp.value().payload);
    if (j.value("msg_type", "") != "REGISTER_RES" || j.value("accepted", true) ||
        j.value("detail", "") != "not implemented") {
      std::cerr << "Register unexpected payload: " << resp.value().payload
                << '\n';
      return 1;
    }
  }

  // Unwired after clear
  controller.clearInterrogator();
  {
    urs::ModuleMessage req;
    req.src = urs::ModuleId::Sip;
    req.dst = urs::ModuleId::Controller;
    req.type = urs::MessageType::InviteRoute;
    req.payload = "{}";
    if (controller.request(std::move(req))) {
      std::cerr << "expected interrogator not wired\n";
      return 1;
    }
  }

  controller.stop();
  std::cout << "controller_interrogator_smoke OK\n";
  return 0;
}
