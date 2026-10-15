#include "common/Messages.h"
#include "config/Config.h"
#include "controller/Controller.h"
#include "interrogator/InterrogatorService.h"
#include "logging/Logger.h"
#include "redis/LiveCallStore.h"
#include "redis/PbxPresenceStore.h"
#include "redis/RedisClient.h"

#include <nlohmann/json.hpp>

#include <cstdlib>
#include <iostream>
#include <string>

// Exit 2 → script SKIP (Redis unavailable).
int main(int argc, char** argv) {
  const std::string config_path =
      argc > 1 ? argv[1] : "configs/ur-signaling.conf.json";

  auto loaded = urs::Config::load(config_path);
  if (!loaded) {
    std::cerr << "config load failed: " << loaded.error() << '\n';
    return 1;
  }
  if (auto ok =
          urs::Logger::instance().init(loaded.value().logging.level, "");
      !ok) {
    std::cerr << "logger init failed: " << ok.error() << '\n';
    return 1;
  }

  urs::RedisClient redis;
  if (auto ok = redis.connect(loaded.value().redis); !ok) {
    std::cerr << "redis connect failed: " << ok.error() << '\n';
    return 2;
  }

  urs::PbxPresenceStore presence(redis);
  urs::LiveCallStore live(redis);
  urs::InterrogatorService interrogator(redis, presence, live);
  if (auto ok = interrogator.start(loaded.value()); !ok) {
    std::cerr << "interrogator start failed: " << ok.error() << '\n';
    return 1;
  }

  interrogator.handlePubSubMessage(
      R"({"msg_type":"pbx-call-load-statistics","pbx_addr":"10.55.55.55","cpu_usage":"1","memory_usage":"2","network_io_usage":"3","cps":"1"})");

  urs::Controller controller;
  controller.setInterrogator(&interrogator);
  if (auto ok = controller.init(); !ok) {
    std::cerr << "controller init failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = controller.start(); !ok) {
    std::cerr << "controller start failed: " << ok.error() << '\n';
    return 1;
  }

  urs::ModuleMessage invite;
  invite.src = urs::ModuleId::Sip;
  invite.dst = urs::ModuleId::Controller;
  invite.type = urs::MessageType::InviteRoute;
  invite.payload =
      R"({"msg_type":"INVITE_REQ","trans_id":"t-redis","call_id":"c-redis","calling_party":"100","called_party":"200","calling_party_domain":"ex.com","called_party_domain":"ex.com","key":""})";

  auto resp = controller.request(std::move(invite));
  if (!resp) {
    std::cerr << "InviteRoute failed: " << resp.error() << '\n';
    return 1;
  }
  const auto j = nlohmann::json::parse(resp.value().payload);
  if (!j.value("ok", false) || j.value("route_pbx_ip", "") != "10.55.55.55") {
    std::cerr << "unexpected InviteRoute response: " << resp.value().payload
              << '\n';
    return 1;
  }

  controller.clearInterrogator();
  controller.stop();
  interrogator.stop();
  redis.disconnect();

  std::cout << "controller_interrogator_redis_smoke OK route_pbx_ip="
            << j["route_pbx_ip"].get<std::string>() << '\n';
  return 0;
}
