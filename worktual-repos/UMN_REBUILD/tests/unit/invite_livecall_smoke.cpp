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
      argc > 1 ? argv[1] : std::string("configs/ur-signaling.conf.json");

  if (auto ok = urs::Logger::instance().init("info", ""); !ok) {
    std::cerr << "logger init failed: " << ok.error() << '\n';
    return 1;
  }

  auto loaded = urs::Config::load(config_path);
  if (!loaded) {
    std::cerr << "config failed: " << loaded.error() << '\n';
    return 1;
  }
  const auto& cfg = loaded.value();

  urs::RedisClient redis;
  if (auto ok = redis.connect(cfg.redis); !ok) {
    std::cerr << "redis connect failed: " << ok.error() << '\n';
    return 2;
  }

  urs::PbxPresenceStore presence(redis);
  urs::LiveCallStore live(redis);
  urs::InterrogatorService interrogator(redis, presence, live);
  if (auto ok = interrogator.start(cfg); !ok) {
    std::cerr << "interrogator start failed: " << ok.error() << '\n';
    return 1;
  }

  const std::string pbx_ip = "10.44.44.44";
  interrogator.handlePubSubMessage(
      R"({"msg_type":"pbx-call-load-statistics","pbx_addr":")" + pbx_ip +
      R"(","cpu_usage":"1","memory_usage":"2","network_io_usage":"3","cps":"1"})");

  urs::Controller controller;
  controller.setInterrogator(&interrogator);
  if (auto ok = controller.init(); !ok) {
    std::cerr << "controller init failed\n";
    return 1;
  }
  if (auto ok = controller.start(); !ok) {
    std::cerr << "controller start failed\n";
    return 1;
  }

  // InviteRoute
  {
    urs::ModuleMessage invite;
    invite.src = urs::ModuleId::Sip;
    invite.dst = urs::ModuleId::Controller;
    invite.type = urs::MessageType::InviteRoute;
    invite.payload =
        R"({"msg_type":"INVITE_REQ","trans_id":"t-il","call_id":"c-il","calling_party":"100","called_party":"200","calling_party_domain":"ex.com","called_party_domain":"ex.com","key":""})";
    auto resp = controller.request(std::move(invite));
    if (!resp) {
      std::cerr << "InviteRoute failed: " << resp.error() << '\n';
      return 1;
    }
    const auto j = nlohmann::json::parse(resp.value().payload);
    if (!j.value("ok", false) || j.value("route_pbx_ip", "") != pbx_ip ||
        j.contains("password")) {
      std::cerr << "unexpected InviteRoute: " << resp.value().payload << '\n';
      return 1;
    }
  }

  // LiveCallLookup (PBX mock HSET)
  const std::string uid = "phase8-il-uid";
  const std::string key = urs::LiveCallStore::keyFor(uid);
  (void)redis.del(key);
  const std::string hosted =
      R"({"call_uid":"phase8-il-uid","domain_name":"ex.com","pbx-addr":"10.44.44.44","mgw-addr":"10.44.44.1"})";
  if (auto ok = redis.hset(key, "call-hosted-info", hosted); !ok) {
    std::cerr << "hset failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = redis.hset(key, "client-call-info",
                           R"({"call_uid":"phase8-il-uid","master_key":"100@ex.com"})");
      !ok) {
    std::cerr << "hset client failed: " << ok.error() << '\n';
    return 1;
  }
  (void)redis.expire(key, cfg.redis.call_live_ttl_sec);

  {
    urs::ModuleMessage lookup;
    lookup.src = urs::ModuleId::Sip;
    lookup.dst = urs::ModuleId::Controller;
    lookup.type = urs::MessageType::LiveCallLookup;
    lookup.payload = R"({"msg_type":"LIVE_CALL_LOOKUP","call_uid":"phase8-il-uid"})";
    auto resp = controller.request(std::move(lookup));
    if (!resp) {
      std::cerr << "LiveCallLookup failed: " << resp.error() << '\n';
      return 1;
    }
    const auto j = nlohmann::json::parse(resp.value().payload);
    if (!j.value("found", false) ||
        j.value("call_hosted_info", std::string()).find("10.44.44.44") ==
            std::string::npos) {
      std::cerr << "unexpected LiveCallLookup: " << resp.value().payload << '\n';
      return 1;
    }
  }

  controller.clearInterrogator();
  controller.stop();
  interrogator.stop();
  (void)redis.del(key);
  redis.disconnect();

  std::cout << "invite_livecall_smoke OK route_pbx_ip=" << pbx_ip << '\n';
  return 0;
}
