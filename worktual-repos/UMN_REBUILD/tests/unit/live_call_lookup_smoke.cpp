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

  const std::string uid = "phase7-live-uid-1";
  const std::string key = urs::LiveCallStore::keyFor(uid);
  (void)redis.del(key);

  const std::string client_json =
      R"({"call_id":"c1","call_uid":"phase7-live-uid-1","sub_key":"s1","extension":"100","device_type":"sip","master_key":"100@example.com"})";
  const std::string hosted_json =
      R"({"call_uid":"phase7-live-uid-1","domain_name":"example.com","pbx-addr":"10.88.88.88","mgw-addr":"10.88.88.1"})";

  // PBX mock writer (not LiveCallStore).
  if (auto ok = redis.hset(key, "client-call-info", client_json); !ok) {
    std::cerr << "hset client-call-info failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = redis.hset(key, "call-hosted-info", hosted_json); !ok) {
    std::cerr << "hset call-hosted-info failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = redis.expire(key, cfg.redis.call_live_ttl_sec); !ok) {
    std::cerr << "expire failed: " << ok.error() << '\n';
    return 1;
  }

  urs::PbxPresenceStore presence(redis);
  urs::LiveCallStore live_a(redis);
  urs::LiveCallStore live_b(redis);  // second "node" reader on same Redis

  auto direct = live_a.get(uid);
  if (!direct || !direct.value()) {
    std::cerr << "LiveCallStore A get miss\n";
    return 1;
  }
  auto direct_b = live_b.get(uid);
  if (!direct_b || !direct_b.value()) {
    std::cerr << "LiveCallStore B get miss\n";
    return 1;
  }
  if (direct_b.value()->call_hosted_info_json.find("10.88.88.88") == std::string::npos) {
    std::cerr << "node B hosted info missing pbx-addr\n";
    return 1;
  }

  urs::InterrogatorService interrogator(redis, presence, live_a);
  if (auto ok = interrogator.start(cfg); !ok) {
    std::cerr << "interrogator start failed: " << ok.error() << '\n';
    return 1;
  }

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

  urs::ModuleMessage req;
  req.src = urs::ModuleId::Sip;
  req.dst = urs::ModuleId::Controller;
  req.type = urs::MessageType::LiveCallLookup;
  req.payload = R"({"msg_type":"LIVE_CALL_LOOKUP","call_uid":"phase7-live-uid-1"})";

  auto resp = controller.request(std::move(req));
  if (!resp) {
    std::cerr << "LiveCallLookup failed: " << resp.error() << '\n';
    return 1;
  }

  nlohmann::json out;
  try {
    out = nlohmann::json::parse(resp.value().payload);
  } catch (const nlohmann::json::exception& ex) {
    std::cerr << "response JSON: " << ex.what() << '\n';
    return 1;
  }

  if (out.value("msg_type", "") != "LIVE_CALL_LOOKUP_RES" || !out.value("found", false) ||
      out.value("call_uid", "") != uid) {
    std::cerr << "unexpected lookup response: " << resp.value().payload << '\n';
    return 1;
  }
  const std::string hosted = out.value("call_hosted_info", "");
  if (hosted.find("pbx-addr") == std::string::npos ||
      hosted.find("10.88.88.88") == std::string::npos) {
    std::cerr << "call_hosted_info missing pbx-addr: " << hosted << '\n';
    return 1;
  }

  controller.clearInterrogator();
  controller.stop();
  interrogator.stop();
  (void)redis.del(key);
  redis.disconnect();

  std::cout << "live_call_lookup_smoke OK pbx-addr=10.88.88.88\n";
  return 0;
}
