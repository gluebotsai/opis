#include "common/Messages.h"
#include "controller/Controller.h"
#include "controller/StubEchoModule.h"
#include "logging/Logger.h"

#include <cstdlib>
#include <iostream>
#include <memory>

int main() {
  // Minimal logger so module logs don't crash; levels still apply.
  if (auto ok = urs::Logger::instance().init("info", ""); !ok) {
    std::cerr << "logger init failed: " << ok.error() << '\n';
    return 1;
  }

  urs::Controller controller;
  auto echo = std::make_shared<urs::StubEchoModule>();

  if (auto ok = controller.registerModule(echo); !ok) {
    std::cerr << "register failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = controller.init(); !ok) {
    std::cerr << "init failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = controller.start(); !ok) {
    std::cerr << "start failed: " << ok.error() << '\n';
    return 1;
  }

  urs::ModuleMessage msg;
  msg.src = urs::ModuleId::Controller;
  msg.dst = urs::ModuleId::StubEcho;
  msg.type = urs::MessageType::Dummy;
  msg.payload = "ping";

  if (auto ok = controller.push(std::move(msg)); !ok) {
    std::cerr << "push failed: " << ok.error() << '\n';
    return 1;
  }

  const auto last = echo->last_message();
  if (!last || last->payload != "ping" || last->type != urs::MessageType::Dummy) {
    std::cerr << "StubEcho did not receive expected Dummy/ping message\n";
    return 1;
  }

  // Unknown destination must fail cleanly.
  urs::ModuleMessage bad;
  bad.src = urs::ModuleId::Controller;
  bad.dst = urs::ModuleId::Sip;  // not registered
  bad.type = urs::MessageType::Dummy;
  bad.payload = "nope";
  if (controller.push(std::move(bad))) {
    std::cerr << "expected unknown destination to fail\n";
    return 1;
  }

  // Unwired interrogator: InviteRoute must fail (not crash).
  urs::ModuleMessage invite;
  invite.src = urs::ModuleId::Sip;
  invite.dst = urs::ModuleId::Controller;
  invite.type = urs::MessageType::InviteRoute;
  invite.payload = R"({"msg_type":"INVITE_REQ","trans_id":"t","call_id":"c"})";
  auto invite_resp = controller.request(std::move(invite));
  if (invite_resp) {
    std::cerr << "expected InviteRoute to fail when interrogator unwired\n";
    return 1;
  }
  if (invite_resp.error().find("interrogator not wired") == std::string::npos) {
    std::cerr << "unexpected InviteRoute error: " << invite_resp.error() << '\n';
    return 1;
  }

  // Unsupported Dummy via request()
  urs::ModuleMessage dummy_req;
  dummy_req.src = urs::ModuleId::Sip;
  dummy_req.dst = urs::ModuleId::Controller;
  dummy_req.type = urs::MessageType::Dummy;
  dummy_req.payload = "x";
  if (controller.request(std::move(dummy_req))) {
    std::cerr << "expected Dummy request() to fail as unsupported\n";
    return 1;
  }

  controller.stop();
  std::cout << "controller_route_smoke OK\n";
  return 0;
}