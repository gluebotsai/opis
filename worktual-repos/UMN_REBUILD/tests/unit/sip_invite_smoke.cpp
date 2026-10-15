#include "config/Config.h"
#include "controller/Controller.h"
#include "interrogator/InterrogatorService.h"
#include "logging/Logger.h"
#include "redis/LiveCallStore.h"
#include "redis/PbxPresenceStore.h"
#include "redis/RedisClient.h"
#include "sip/SipService.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

namespace {

// Minimal SIP UAC over UDP (avoids second nua fighting the UAS in-process).
bool send_test_invite_udp(const std::string& host, int port) {
  const int fd = ::socket(AF_INET, SOCK_DGRAM, 0);
  if (fd < 0) {
    std::cerr << "UAC socket failed\n";
    return false;
  }

  sockaddr_in local{};
  local.sin_family = AF_INET;
  local.sin_port = htons(15070);
  if (::inet_pton(AF_INET, host.c_str(), &local.sin_addr) != 1) {
    std::cerr << "UAC local inet_pton failed for " << host << '\n';
    ::close(fd);
    return false;
  }
  if (::bind(fd, reinterpret_cast<sockaddr*>(&local), sizeof(local)) != 0) {
    std::cerr << "UAC bind " << host << ":15070 failed\n";
    ::close(fd);
    return false;
  }

  const std::string call_id = "smoke-call-id-1@" + host;
  const std::string branch = "z9hG4bKsmoke1";
  const std::string msg =
      "INVITE sip:200@" + host + ":" + std::to_string(port) + " SIP/2.0\r\n"
      "Via: SIP/2.0/UDP " + host + ":15070;branch=" + branch + ";rport\r\n"
      "Max-Forwards: 70\r\n"
      "From: <sip:100@" + host + ">;tag=smoke-from\r\n"
      "To: <sip:200@" + host + ":" + std::to_string(port) + ">\r\n"
      "Call-ID: " + call_id + "\r\n"
      "CSeq: 1 INVITE\r\n"
      "Contact: <sip:100@" + host + ":15070>\r\n"
      "Content-Length: 0\r\n"
      "\r\n";

  sockaddr_in dest{};
  dest.sin_family = AF_INET;
  dest.sin_port = htons(static_cast<uint16_t>(port));
  if (::inet_pton(AF_INET, host.c_str(), &dest.sin_addr) != 1) {
    std::cerr << "UAC inet_pton failed for " << host << '\n';
    ::close(fd);
    return false;
  }

  std::cerr << "UAC UDP INVITE → " << host << ":" << port << '\n';
  const ssize_t n = ::sendto(fd, msg.data(), msg.size(), 0,
                             reinterpret_cast<sockaddr*>(&dest), sizeof(dest));
  if (n < 0) {
    std::cerr << "UAC sendto failed\n";
    ::close(fd);
    return false;
  }

  // Optional: read 100 Trying (best-effort).
  char buf[2048];
  timeval tv{};
  tv.tv_sec = 2;
  tv.tv_usec = 0;
  ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
  sockaddr_in from{};
  socklen_t fromlen = sizeof(from);
  const ssize_t r =
      ::recvfrom(fd, buf, sizeof(buf) - 1, 0, reinterpret_cast<sockaddr*>(&from),
                 &fromlen);
  if (r > 0) {
    buf[r] = '\0';
    std::cerr << "UAC got response (" << r << " bytes)\n";
  }
  ::close(fd);
  return true;
}

bool parse_host_port(const std::string& listen, std::string& host, int& port) {
  const auto colon = listen.rfind(':');
  if (colon == std::string::npos) {
    return false;
  }
  host = listen.substr(0, colon);
  port = std::atoi(listen.substr(colon + 1).c_str());
  return !host.empty() && port > 0;
}

}  // namespace

// Exit 2 → script SKIP (Redis unavailable).
int main(int argc, char** argv) {
  const std::string config_path =
      argc > 1 ? argv[1]
               : std::string("configs/ur-signaling.sip-smoke.conf.json");

  if (auto ok = urs::Logger::instance().init("info", ""); !ok) {
    std::cerr << "logger init failed: " << ok.error() << '\n';
    return 1;
  }

  auto loaded = urs::Config::load(config_path);
  if (!loaded) {
    std::cerr << "config load failed: " << loaded.error() << '\n';
    return 1;
  }
  auto cfg = loaded.value();

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

  // Real prepro PBXs (also present on Redis pubsub / snapshot).
  const std::string pbx_a = "10.180.1.75";
  const std::string pbx_b = "10.180.2.70";
  for (const auto& pbx_ip : {pbx_a, pbx_b}) {
    interrogator.handlePubSubMessage(
        R"({"msg_type":"pbx-call-load-statistics","pbx_addr":")" + pbx_ip +
        R"(","cpu_usage":"1","memory_usage":"2","network_io_usage":"3","cps":"1"})");
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

  urs::SipService sip;
  sip.set_controller(&controller);
  if (auto ok = sip.init(cfg.sip); !ok) {
    std::cerr << "sip init failed: " << ok.error() << '\n';
    return 1;
  }
  if (auto ok = sip.start(); !ok) {
    std::cerr << "sip start failed: " << ok.error() << '\n';
    return 1;
  }

  // Brief settle for Sofia bind.
  std::this_thread::sleep_for(std::chrono::milliseconds(200));

  std::string host;
  int port = 0;
  if (!parse_host_port(cfg.sip.udp_listen, host, port)) {
    std::cerr << "bad sip.udp_listen: " << cfg.sip.udp_listen << '\n';
    sip.stop();
    return 1;
  }
  if (!send_test_invite_udp(host, port)) {
    std::cerr << "UAC INVITE failed toward " << host << ":" << port << '\n';
    sip.stop();
    return 1;
  }

  // Wait for worker → InviteRoute → DialOut toward a real PBX.
  auto is_real_pbx = [&](const std::string& ip) {
    return ip == pbx_a || ip == pbx_b;
  };

  bool saw_outbound = false;
  std::string routed_pbx;
  for (int i = 0; i < 80; ++i) {
    if (sip.adapter().outbound_invite_count() > 0 &&
        is_real_pbx(sip.adapter().last_outbound_pbx_ip())) {
      saw_outbound = true;
      routed_pbx = sip.adapter().last_outbound_pbx_ip();
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  // Give real PBX time to answer (100/180) so sngrep can capture B-leg.
  if (saw_outbound) {
    std::this_thread::sleep_for(std::chrono::seconds(8));
  }

  sip.stop();
  controller.clearInterrogator();
  controller.stop();
  interrogator.stop();
  redis.disconnect();

  if (!saw_outbound) {
    std::cerr << "expected outbound INVITE toward " << pbx_a << " or " << pbx_b
              << " count=" << sip.adapter().outbound_invite_count()
              << " last=" << sip.adapter().last_outbound_pbx_ip() << '\n';
    return 1;
  }

  std::cout << "sip_invite_smoke OK route_pbx_ip=" << routed_pbx
            << " (real PBX; redis pubsub=" << cfg.redis.pubsub.host
            << " store=" << cfg.redis.store.host << ")\n";
  return 0;
}
