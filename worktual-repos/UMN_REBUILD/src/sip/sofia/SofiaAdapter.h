#pragma once

#include "common/Result.h"
#include "config/Config.h"

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace urs {

// Sofia-SIP adapter — Receiver thread owns nua/su_root. No routing logic here.
class SofiaAdapter {
public:
  struct InboundInvite {
    std::string call_id;
    std::string calling_party;
    std::string called_party;
    std::string calling_domain;
    std::string called_domain;
  };

  struct InboundRegister {
    std::string call_id;
    std::string username;
    std::string domain;
    std::string contact_address;  // host:port
    std::string contact_uri;
    std::string device_type;
    std::string app_type;
    std::string transport_type;
    int expires{3600};
    bool has_auth{false};
    std::string auth_username;
    std::string auth_realm;
    std::string auth_nonce;
    std::string auth_uri;
    std::string auth_response;
  };

  struct RegisterDecision {
    int status{500};  // 200 / 401 / 403 / 500
    std::string phrase;
    std::string www_authenticate;  // for 401
    std::string contact;           // for 200
    std::string detail;
  };

  using InboundHandler = std::function<void(InboundInvite)>;
  // Called on Sofia thread for every REGISTER (challenge or digest verify).
  using RegisterProcessor =
      std::function<RegisterDecision(const InboundRegister&)>;

  SofiaAdapter();
  ~SofiaAdapter();

  SofiaAdapter(const SofiaAdapter&) = delete;
  SofiaAdapter& operator=(const SofiaAdapter&) = delete;

  void set_inbound_handler(InboundHandler handler);
  void set_register_processor(RegisterProcessor processor);

  // Starts Sofia thread; binds UDP always. When sip.wss_listen + certificate_dir
  // are set (and binary linked to WSS Sofia), also binds WSS + TLS.
  [[nodiscard]] Result<void> start(const SipConfig& config);
  void shutdown();

  // Marshaled onto Sofia thread (like SGW WriteToReceiver → GetProcessEvent).
  void dial_out(std::string call_id, std::string pbx_ip, std::string called_user,
                std::string calling_user);
  void respond(std::string call_id, int status, std::string phrase);
  void destroy_call(std::string call_id);

  // Test / smoke hooks (set when outbound nua_invite is issued).
  [[nodiscard]] std::string last_outbound_pbx_ip() const;
  [[nodiscard]] std::uint64_t outbound_invite_count() const noexcept;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace urs
