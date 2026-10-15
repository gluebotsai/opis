#include "sip/sofia/SofiaAdapter.h"

#include "logging/Logger.h"
#include "sip/DigestAuth.h"

#include <sofia-sip/auth_common.h>
#include <sofia-sip/msg_header.h>
#include <sofia-sip/nua.h>
#include <sofia-sip/sip.h>
#include <sofia-sip/sip_header.h>
#include <sofia-sip/sip_status.h>
#include <sofia-sip/soa_tag.h>
#include <sofia-sip/su.h>
#include <sofia-sip/su_log.h>
#include <sofia-sip/su_wait.h>

#include <strings.h>

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <queue>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace urs {
namespace {

std::string listen_to_sip_url(const std::string& host_port) {
  // Config is "host:port" → Sofia NUTAG_URL wants sip:host:port
  if (host_port.starts_with("sip:") || host_port.starts_with("sips:")) {
    return host_port;
  }
  return "sip:" + host_port;
}

std::string listen_to_sips_url(const std::string& host_port) {
  // Legacy SGW: sips:*:5061;transport=tls — without transport=tls Sofia binds
  // transport=* on the TLS port and also tries WSS there, which fails nua_create.
  if (host_port.find("transport=") != std::string::npos) {
    if (host_port.starts_with("sips:") || host_port.starts_with("sip:")) {
      return host_port;
    }
    return "sips:" + host_port;
  }
  if (host_port.starts_with("sips:") || host_port.starts_with("sip:")) {
    return host_port + ";transport=tls";
  }
  return "sips:" + host_port + ";transport=tls";
}

std::string listen_to_wss_url(const std::string& host_port) {
  // Legacy SGW: sips:*:57344;transport=wss (do not reuse listen_to_sips_url —
  // that appends transport=tls).
  if (host_port.find("transport=") != std::string::npos) {
    if (host_port.starts_with("sips:") || host_port.starts_with("sip:")) {
      return host_port;
    }
    return "sips:" + host_port;
  }
  if (host_port.starts_with("sips:") || host_port.starts_with("sip:")) {
    return host_port + ";transport=wss";
  }
  return "sips:" + host_port + ";transport=wss";
}

bool env_udp_only() {
  const char* v = std::getenv("UR_SIP_UDP_ONLY");
  return v && v[0] == '1';
}

// Legacy SGW: "UnifiedRingEngine Signaling Gateway" (SofiaSiphandler XGATE_USER_AGENT).
constexpr const char* kUserAgent = "Worktual Signalling Gateway";

std::string transport_from_via(sip_t const* sip) {
  if (!sip || !sip->sip_via || !sip->sip_via->v_protocol) {
    return {};
  }
  const char* proto = sip->sip_via->v_protocol;
  if (std::strstr(proto, "WSS") != nullptr) {
    return "wss";
  }
  if (std::strstr(proto, "TLS") != nullptr) {
    return "tls";
  }
  if (std::strstr(proto, "TCP") != nullptr) {
    return "tcp";
  }
  if (std::strstr(proto, "UDP") != nullptr) {
    return "udp";
  }
  return {};
}

std::string safe_cstr(const char* s) { return s ? std::string(s) : std::string(); }

// Legacy SGW CreateSofiaRegobj: Contact_address = client host + port the
// REGISTER was received on (prefer Via rport, else Contact url_port).
std::string contact_address_from_register(sip_t const* sip) {
  if (!sip) {
    return {};
  }

  std::string contact_host;
  if (sip->sip_contact && sip->sip_contact->m_url[0].url_host) {
    contact_host = safe_cstr(sip->sip_contact->m_url[0].url_host);
  }

  std::string host = contact_host;
  if (sip->sip_via) {
    const std::string received = safe_cstr(sip->sip_via->v_received);
    const std::string via_host = safe_cstr(sip->sip_via->v_host);
    if (!received.empty()) {
      // Same as Contact → keep Contact; else NAT: use Via received (legacy SGW).
      if (!contact_host.empty() && received == contact_host) {
        host = contact_host;
      } else {
        host = received;
      }
    } else if (host.empty()) {
      host = via_host;
    }
  }

  std::string port;
  if (sip->sip_via && sip->sip_via->v_rport && sip->sip_via->v_rport[0]) {
    port = safe_cstr(sip->sip_via->v_rport);
  } else if (sip->sip_contact && sip->sip_contact->m_url[0].url_port) {
    port = safe_cstr(sip->sip_contact->m_url[0].url_port);
  } else if (sip->sip_via && sip->sip_via->v_port && sip->sip_via->v_port[0]) {
    // Last resort: Via sent-by port (still "from the request", not inventing).
    port = safe_cstr(sip->sip_via->v_port);
  }

  if (host.empty()) {
    return {};
  }
  if (port.empty()) {
    return host;
  }
  return host + ":" + port;
}

// udp_listen is "host:port" (IPv4). Strip port for SIP From host.
std::string host_from_listen(const std::string& host_port) {
  if (host_port.empty()) {
    return "127.0.0.1";
  }
  const auto pos = host_port.rfind(':');
  if (pos == std::string::npos || host_port.find(':') != pos) {
    // No port, or likely IPv6 — use as-is.
    return host_port;
  }
  return host_port.substr(0, pos);
}

std::string minimal_sdp(const std::string& ip4) {
  return "v=0\r\n"
         "o=- 0 0 IN IP4 " +
         ip4 +
         "\r\n"
         "s=-\r\n"
         "c=IN IP4 " +
         ip4 +
         "\r\n"
         "t=0 0\r\n"
         "m=audio 40000 RTP/AVP 0 8\r\n"
         "a=rtpmap:0 PCMU/8000\r\n"
         "a=rtpmap:8 PCMA/8000\r\n";
}

bool extract_digest_param(const std::string& header, const std::string& key,
                          std::string& out) {
  const std::string needle = key + "=\"";
  auto pos = header.find(needle);
  if (pos == std::string::npos) {
    return false;
  }
  pos += needle.size();
  const auto end = header.find('"', pos);
  if (end == std::string::npos) {
    return false;
  }
  out = header.substr(pos, end - pos);
  return true;
}

void map_device_from_ua(const std::string& ua, std::string& device_type,
                        std::string& app_type) {
  // Align with legacy SofiaSiphandler CreateSofiaRegobj device/app mapping.
  // Unknown desktop clients (MicroSIP / sofia-sip UA) → URDESK with empty app
  // → Redis key suffix "@URDESK:".
  device_type = "URDESK";
  app_type.clear();

  if (ua.empty()) {
    return;
  }

  if (ua.find("VIDEO") != std::string::npos) {
    app_type = "VIDEO";
    if (ua.find("IOS") != std::string::npos) {
      device_type = "URIOS";
    } else if (ua.find("AND") != std::string::npos) {
      device_type = "URAND";
    } else if (ua.find("WEB") != std::string::npos ||
               ua.find("TPI") != std::string::npos) {
      device_type = "URWEB";
    } else if (ua.find("CCAAS") != std::string::npos) {
      device_type = "CCAAS";
    }
    return;
  }

  if (ua.find("URAPP") != std::string::npos) {
    device_type = "URAPP";
  } else if (ua.find("URWEB") != std::string::npos) {
    device_type = "URWEB";
  } else if (ua.find("CCAAS") != std::string::npos) {
    device_type = "CCAAS";
  } else {
    device_type = "URDESK";
  }

  if (ua.find("IOS") != std::string::npos) {
    app_type = "IOS";
  } else if (ua.find("AND") != std::string::npos) {
    app_type = "AND";
  } else if (ua.find("URWEB:WEB") != std::string::npos) {
    app_type = "WEB";
  } else if (ua.find("CCAAS:BROWSER") != std::string::npos) {
    app_type = "BROWSER";
  } else if (ua.find("URWEB:TPI") != std::string::npos ||
             ua.find("CCAAS:TPI") != std::string::npos) {
    app_type = "TPI";
  }
}

bool fill_auth_from_params(msg_param_t const* params, su_home_t* home,
                           SofiaAdapter::InboundRegister& reg) {
  if (!params) {
    return false;
  }
  char const* username = nullptr;
  char const* realm = nullptr;
  char const* nonce = nullptr;
  char const* uri = nullptr;
  char const* response = nullptr;
  auth_get_params(home, params, "username=", &username, "realm=", &realm,
                  "nonce=", &nonce, "uri=", &uri, "response=", &response,
                  nullptr);
  if (!response || !*response) {
    return false;
  }
  reg.has_auth = true;
  reg.auth_username = safe_cstr(username);
  reg.auth_realm = safe_cstr(realm);
  reg.auth_nonce = safe_cstr(nonce);
  reg.auth_uri = safe_cstr(uri);
  reg.auth_response = safe_cstr(response);
  return true;
}

bool fill_auth_from_header_string(const std::string& hdr,
                                  SofiaAdapter::InboundRegister& reg) {
  if (!extract_digest_param(hdr, "response", reg.auth_response)) {
    return false;
  }
  reg.has_auth = true;
  extract_digest_param(hdr, "username", reg.auth_username);
  extract_digest_param(hdr, "realm", reg.auth_realm);
  extract_digest_param(hdr, "nonce", reg.auth_nonce);
  extract_digest_param(hdr, "uri", reg.auth_uri);
  return true;
}

void parse_register_authorization(nua_t* nua, sip_t const* sip_in, su_home_t* home,
                                  SofiaAdapter::InboundRegister& reg) {
  sip_t const* sip = sip_in;
  if (nua) {
    if (msg_t* msg = nua_current_request(nua)) {
      if (sip_t* from_msg = sip_object(msg)) {
        sip = from_msg;
      }
    }
  }
  if (!sip) {
    return;
  }

  msg_auth_t* au = sip->sip_authorization;
  if (!au) {
    au = sip->sip_proxy_authorization;
  }
  if (au && fill_auth_from_params(au->au_params, home, reg)) {
    return;
  }
  if (au) {
    if (char* auth_raw = sip_header_as_string(
            home, reinterpret_cast<sip_header_t*>(au))) {
      if (fill_auth_from_header_string(auth_raw, reg)) {
        return;
      }
    }
  }

  // Fallback: Authorization may land in unknown headers depending on mclass.
  for (msg_unknown_t* u = sip->sip_unknown; u; u = u->un_next) {
    if (!u->un_name || !u->un_value) {
      continue;
    }
    if (strcasecmp(u->un_name, "Authorization") != 0 &&
        strcasecmp(u->un_name, "Proxy-Authorization") != 0) {
      continue;
    }
    if (fill_auth_from_header_string(safe_cstr(u->un_value), reg)) {
      return;
    }
  }
}

}  // namespace

struct SofiaAdapter::Impl {
  enum class CmdType { DialOut, Respond, Destroy, Shutdown };

  struct Command {
    CmdType type{CmdType::Shutdown};
    std::string call_id;
    std::string pbx_ip;
    std::string called_user;
    std::string calling_user;
    int status{0};
    std::string phrase;
    std::string sdp;  // optional body for Respond (2xx needs offer/answer)
    std::string www_authenticate;
    std::string contact;
    bool is_register{false};
    bool destroy_after{false};
  };

  struct CallSession {
    nua_handle_t* leg_a{nullptr};
    nua_handle_t* leg_b{nullptr};
    bool leg_a_destroyed{false};
    bool leg_b_destroyed{false};
    std::string called_user;
    std::string calling_user;
    bool is_register{false};
  };

  InboundHandler handler;
  RegisterProcessor register_processor;
  SipConfig config;

  std::thread sofia_thread;
  std::atomic<bool> stop{false};
  std::atomic<bool> running{false};
  std::atomic<bool> nua_shutdown_done{false};
  bool shutdown_requested{false};

  std::mutex ready_mu;
  std::condition_variable ready_cv;
  bool ready{false};
  std::string ready_error;

  std::mutex cmd_mu;
  std::queue<Command> commands;

  std::mutex sess_mu;
  std::unordered_map<std::string, CallSession> sessions;

  nua_t* nua{nullptr};
  su_root_t* root{nullptr};
  su_home_t home{};

  std::mutex hook_mu;
  std::string last_pbx;
  std::atomic<std::uint64_t> outbound_count{0};

  void post(Command cmd) {
    {
      std::lock_guard lock(cmd_mu);
      commands.push(std::move(cmd));
    }
  }

  void drain_commands() {
    std::vector<Command> batch;
    {
      std::lock_guard lock(cmd_mu);
      while (!commands.empty()) {
        batch.push_back(std::move(commands.front()));
        commands.pop();
      }
    }
    for (auto& cmd : batch) {
      apply(std::move(cmd));
    }
  }

  CallSession* find_session(const std::string& call_id) {
    auto it = sessions.find(call_id);
    if (it == sessions.end()) {
      return nullptr;
    }
    return &it->second;
  }

  void destroy_handle_once(nua_handle_t*& nh, bool& destroyed_flag) {
    if (destroyed_flag || !nh) {
      return;
    }
    nua_handle_destroy(nh);
    nh = nullptr;
    destroyed_flag = true;
  }

  void apply(Command cmd) {
    switch (cmd.type) {
      case CmdType::Shutdown:
        if (!shutdown_requested && nua) {
          shutdown_requested = true;
          nua_shutdown(nua);
        } else if (!nua) {
          stop.store(true);
          nua_shutdown_done.store(true);
        }
        break;

      case CmdType::Respond: {
        nua_handle_t* leg_a = nullptr;
        {
          std::lock_guard lock(sess_mu);
          auto* s = find_session(cmd.call_id);
          if (!s || !s->leg_a || s->leg_a_destroyed) {
            return;
          }
          leg_a = s->leg_a;
        }
        // Use Sofia status macros / sip_status_phrase — durable C strings.
        char const* ph = sip_status_phrase(cmd.status);
        if (!ph) {
          ph = cmd.phrase.empty() ? "OK" : cmd.phrase.c_str();
        }
        char const* sdp_ptr = nullptr;
        if (!cmd.sdp.empty()) {
          sdp_ptr = su_strdup(&home, cmd.sdp.c_str());
        }
        char const* www_ptr = nullptr;
        if (!cmd.www_authenticate.empty()) {
          www_ptr = su_strdup(&home, cmd.www_authenticate.c_str());
        }
        char const* contact_ptr = nullptr;
        if (!cmd.contact.empty()) {
          contact_ptr = su_strdup(&home, cmd.contact.c_str());
        }

        if (cmd.is_register) {
          // NUTAG_WITH_THIS required for reliable REGISTER responses (legacy SGW).
          if (www_ptr && contact_ptr) {
            nua_respond(leg_a, cmd.status, ph,
                        SIPTAG_WWW_AUTHENTICATE_STR(www_ptr),
                        SIPTAG_CONTACT_STR(contact_ptr), SIPTAG_SUPPORTED_STR(""),
                        NUTAG_WITH_THIS(nua), TAG_END());
          } else if (www_ptr) {
            nua_respond(leg_a, cmd.status, ph,
                        SIPTAG_WWW_AUTHENTICATE_STR(www_ptr),
                        SIPTAG_SUPPORTED_STR(""), NUTAG_WITH_THIS(nua),
                        TAG_END());
          } else if (contact_ptr) {
            nua_respond(leg_a, cmd.status, ph, SIPTAG_CONTACT_STR(contact_ptr),
                        SIPTAG_SUPPORTED_STR(""), NUTAG_WITH_THIS(nua),
                        TAG_END());
          } else {
            nua_respond(leg_a, cmd.status, ph, SIPTAG_SUPPORTED_STR(""),
                        NUTAG_WITH_THIS(nua), TAG_END());
          }
          if (cmd.destroy_after) {
            std::lock_guard lock(sess_mu);
            auto it = sessions.find(cmd.call_id);
            if (it != sessions.end()) {
              destroy_handle_once(it->second.leg_a, it->second.leg_a_destroyed);
              sessions.erase(it);
            }
          }
        } else if (sdp_ptr) {
          nua_respond(leg_a, cmd.status, ph, SOATAG_USER_SDP_STR(sdp_ptr),
                      TAG_END());
        } else {
          nua_respond(leg_a, cmd.status, ph, TAG_END());
        }
        break;
      }

      case CmdType::Destroy: {
        std::lock_guard lock(sess_mu);
        auto it = sessions.find(cmd.call_id);
        if (it == sessions.end()) {
          return;
        }
        // Destroy each leg once — never free Leg-B with Leg-A handle (SGW bug).
        destroy_handle_once(it->second.leg_b, it->second.leg_b_destroyed);
        destroy_handle_once(it->second.leg_a, it->second.leg_a_destroyed);
        sessions.erase(it);
        break;
      }

      case CmdType::DialOut: {
        if (!nua) {
          return;
        }
        nua_handle_t* nh = nullptr;
        {
          std::lock_guard lock(sess_mu);
          auto* s = find_session(cmd.call_id);
          if (!s) {
            Logger::instance().warn("DialOut: unknown call_id=" + cmd.call_id);
            return;
          }
          if (s->leg_b && !s->leg_b_destroyed) {
            Logger::instance().warn("DialOut: Leg-B already exists call_id=" +
                                    cmd.call_id);
            return;
          }
        }

        const std::string host = host_from_listen(config.udp_listen);
        const std::string to = "sip:" + cmd.called_user + "@" + cmd.pbx_ip;
        const std::string from = "sip:" + cmd.calling_user + "@" + host;
        const std::string contact =
            "sip:" + cmd.calling_user + "@" +
            (config.udp_listen.empty() ? host : config.udp_listen);
        const std::string sdp = minimal_sdp(host);

        nh = nua_handle(nua, nullptr, SIPTAG_TO_STR(to.c_str()),
                        SIPTAG_FROM_STR(from.c_str()),
                        SIPTAG_CONTACT_STR(contact.c_str()), TAG_END());
        if (!nh) {
          Logger::instance().error("DialOut: nua_handle failed for " + to);
          return;
        }

        {
          std::lock_guard lock(sess_mu);
          auto* s = find_session(cmd.call_id);
          if (!s) {
            nua_handle_destroy(nh);
            return;
          }
          s->leg_b = nh;
          s->leg_b_destroyed = false;
        }

        // Sofia SOA requires an offer for INVITE; missing SDP → nua 900.
        nua_invite(nh, NUTAG_AUTOACK(1), NUTAG_INVITE_TIMER(15),
                   SOATAG_USER_SDP_STR(sdp.c_str()), TAG_END());

        {
          std::lock_guard lock(hook_mu);
          last_pbx = cmd.pbx_ip;
        }
        outbound_count.fetch_add(1, std::memory_order_relaxed);
        Logger::instance().info("[SGW] Sofia DialOut call_id=" + cmd.call_id +
                                " route_pbx_ip=" + cmd.pbx_ip + " to=" + to);
        break;
      }
    }
  }

  void on_invite(nua_handle_t* nh, sip_t const* sip) {
    if (!sip) {
      return;
    }

    InboundInvite inv;
    if (sip->sip_call_id && sip->sip_call_id->i_id) {
      inv.call_id = safe_cstr(sip->sip_call_id->i_id);
    }
    if (sip->sip_from) {
      inv.calling_party = safe_cstr(sip->sip_from->a_url[0].url_user);
      inv.calling_domain = safe_cstr(sip->sip_from->a_url[0].url_host);
    }
    if (sip->sip_to) {
      inv.called_party = safe_cstr(sip->sip_to->a_url[0].url_user);
      inv.called_domain = safe_cstr(sip->sip_to->a_url[0].url_host);
    }
    if (inv.called_party.empty() && sip->sip_request) {
      inv.called_party = safe_cstr(sip->sip_request->rq_url[0].url_user);
      if (inv.called_domain.empty()) {
        inv.called_domain = safe_cstr(sip->sip_request->rq_url[0].url_host);
      }
    }
    if (inv.call_id.empty()) {
      Logger::instance().warn("inbound INVITE missing Call-ID");
      nua_respond(nh, 400, "Bad Request", TAG_END());
      nua_handle_destroy(nh);
      return;
    }
    if (inv.called_party.empty()) {
      inv.called_party = "unknown";
    }
    if (inv.calling_party.empty()) {
      inv.calling_party = "anonymous";
    }

    {
      std::lock_guard lock(sess_mu);
      auto& s = sessions[inv.call_id];
      if (s.leg_a && !s.leg_a_destroyed) {
        // Re-INVITE / duplicate — ignore routing for Phase 6 slice.
        Logger::instance().info("[SGW] inbound re-INVITE call_id=" + inv.call_id);
        nua_respond(nh, 100, "Trying", TAG_END());
        return;
      }
      s.leg_a = nh;
      s.leg_a_destroyed = false;
      s.called_user = inv.called_party;
      s.calling_user = inv.calling_party;
    }

    nua_respond(nh, 100, "Trying", TAG_END());
    Logger::instance().info("[SGW] SofiaCallBack nua_i_invite call_id=" +
                            inv.call_id + " from=" + inv.calling_party +
                            " to=" + inv.called_party);

    if (handler) {
      handler(std::move(inv));
    }
  }

  void on_register(nua_t* nua_ptr, nua_handle_t* nh, sip_t const* sip_in) {
    sip_t const* sip = sip_in;
    if (nua_ptr) {
      if (msg_t* msg = nua_current_request(nua_ptr)) {
        if (sip_t* from_msg = sip_object(msg)) {
          sip = from_msg;
        }
      }
    }
    if (!sip) {
      return;
    }

    InboundRegister reg;
    if (sip->sip_call_id && sip->sip_call_id->i_id) {
      reg.call_id = safe_cstr(sip->sip_call_id->i_id);
    }
    if (sip->sip_to) {
      reg.username = safe_cstr(sip->sip_to->a_url[0].url_user);
      reg.domain = safe_cstr(sip->sip_to->a_url[0].url_host);
    }
    if (reg.username.empty() && sip->sip_from) {
      reg.username = safe_cstr(sip->sip_from->a_url[0].url_user);
      if (reg.domain.empty()) {
        reg.domain = safe_cstr(sip->sip_from->a_url[0].url_host);
      }
    }
    // Prefer Via (legacy SGW) for WSS/TLS; Contact transport= is fallback.
    reg.transport_type = transport_from_via(sip);
    // Redis Contact_address: host + received peer port (Via rport), like SGW.
    reg.contact_address = contact_address_from_register(sip);
    if (sip->sip_contact) {
      const auto& u = sip->sip_contact->m_url[0];
      const std::string user = safe_cstr(u.url_user);
      // 200 OK Contact must echo REGISTER Contact user@host (not To user,
      // not Via rport). Redis still uses contact_address (host:rport).
      std::string echo_host = safe_cstr(u.url_host);
      if (u.url_port && u.url_port[0]) {
        echo_host += ":";
        echo_host += safe_cstr(u.url_port);
      }
      if (reg.transport_type.empty() && u.url_params) {
        const std::string params = safe_cstr(u.url_params);
        const auto tpos = params.find("transport=");
        if (tpos != std::string::npos) {
          auto end = params.find(';', tpos);
          reg.transport_type =
              params.substr(tpos + std::strlen("transport="),
                            end == std::string::npos ? std::string::npos
                                                     : end - (tpos + 10));
        }
      }
      // sip:user@host[;transport=…] — matches request Contact addr-spec.
      reg.contact_uri = "sip:" + user + "@" + echo_host;
      if (!reg.transport_type.empty() && reg.transport_type != "udp") {
        reg.contact_uri += ";transport=" + reg.transport_type;
      }
    }
    if (reg.transport_type.empty()) {
      reg.transport_type = "udp";
    }
    if (sip->sip_expires) {
      reg.expires = static_cast<int>(sip->sip_expires->ex_delta);
    } else if (sip->sip_contact && sip->sip_contact->m_expires) {
      reg.expires = std::atoi(sip->sip_contact->m_expires);
    }

    std::string ua;
    if (sip->sip_user_agent && sip->sip_user_agent->g_string) {
      ua = safe_cstr(sip->sip_user_agent->g_string);
    }
    map_device_from_ua(ua, reg.device_type, reg.app_type);

    parse_register_authorization(nua_ptr, sip, &home, reg);
    if (reg.auth_username.empty()) {
      reg.auth_username = reg.username;
    }
    if (reg.auth_realm.empty()) {
      reg.auth_realm = reg.domain;
    }

    if (reg.call_id.empty() || reg.username.empty() || reg.domain.empty()) {
      Logger::instance().warn("inbound REGISTER missing Call-ID/user/domain");
      nua_respond(nh, 400, "Bad Request", NUTAG_WITH_THIS(nua_ptr), TAG_END());
      nua_handle_destroy(nh);
      return;
    }

    Logger::instance().info(
        "[SGW] SofiaCallBack nua_i_register call_id=" + reg.call_id +
        " aor=" + reg.username + "@" + reg.domain +
        " expires=" + std::to_string(reg.expires) +
        (reg.has_auth ? " has_authorization" : " no_authorization"));

    RegisterDecision decision;
    decision.status = 500;
    decision.phrase = "Server Internal Error";
    if (register_processor) {
      decision = register_processor(reg);
    } else {
      Logger::instance().error("REGISTER processor not set");
    }

    char const* ph = sip_status_phrase(decision.status);
    if (!ph) {
      ph = decision.phrase.empty() ? "OK" : decision.phrase.c_str();
    }
    char const* www_ptr = nullptr;
    if (!decision.www_authenticate.empty()) {
      www_ptr = su_strdup(&home, decision.www_authenticate.c_str());
    }
    char const* contact_ptr = nullptr;
    if (!decision.contact.empty()) {
      contact_ptr = su_strdup(&home, decision.contact.c_str());
    }

    if (www_ptr && contact_ptr) {
      nua_respond(nh, decision.status, ph, SIPTAG_WWW_AUTHENTICATE_STR(www_ptr),
                  SIPTAG_CONTACT_STR(contact_ptr), SIPTAG_SUPPORTED_STR(""),
                  NUTAG_WITH_THIS(nua_ptr), TAG_END());
    } else if (www_ptr) {
      nua_respond(nh, decision.status, ph, SIPTAG_WWW_AUTHENTICATE_STR(www_ptr),
                  SIPTAG_SUPPORTED_STR(""), NUTAG_WITH_THIS(nua_ptr), TAG_END());
    } else if (contact_ptr) {
      nua_respond(nh, decision.status, ph, SIPTAG_CONTACT_STR(contact_ptr),
                  SIPTAG_SUPPORTED_STR(""), NUTAG_WITH_THIS(nua_ptr), TAG_END());
    } else {
      nua_respond(nh, decision.status, ph, SIPTAG_SUPPORTED_STR(""),
                  NUTAG_WITH_THIS(nua_ptr), TAG_END());
    }

    Logger::instance().info(
        "[SGW] REGISTER response status=" + std::to_string(decision.status) +
        " aor=" + reg.username + "@" + reg.domain +
        (decision.detail.empty() ? "" : " detail=" + decision.detail));
    nua_handle_destroy(nh);
  }

  static void callback(nua_event_t event, int status, char const* phrase, nua_t* nua,
                       nua_magic_t* magic, nua_handle_t* nh, nua_hmagic_t* /*hmagic*/,
                       sip_t const* sip, tagi_t /*tags*/[]) {
    auto* self = static_cast<Impl*>(magic);
    if (!self) {
      return;
    }

    switch (event) {
      case nua_i_invite:
        self->on_invite(nh, sip);
        break;

      case nua_i_register:
        self->on_register(nua, nh, sip);
        break;

      case nua_r_shutdown:
        Logger::instance().info("Sofia nua_r_shutdown status=" +
                                std::to_string(status));
        // Wait until Sofia reports shutdown complete (status 200).
        if (status >= 200) {
          self->nua_shutdown_done.store(true);
          self->stop.store(true);
        }
        break;

      case nua_r_invite: {
        Logger::instance().info(
            std::string("[SGW] SofiaCallBack nua_r_invite status=") +
            std::to_string(status) + " " + (phrase ? phrase : ""));
        // Relay B-leg final responses to A-leg via command queue.
        // Do not touch sip->sip_payload here — pointer can be invalid → SIGSEGV.
        // Provisional 18x skipped; 2xx uses locally generated SDP offer.
        if (nh && status >= 200) {
          std::string call_id;
          {
            std::lock_guard lock(self->sess_mu);
            for (auto& [cid, s] : self->sessions) {
              if (s.leg_b == nh && s.leg_a && !s.leg_a_destroyed) {
                call_id = cid;
                break;
              }
            }
          }

          if (!call_id.empty()) {
            Command c;
            c.type = CmdType::Respond;
            c.call_id = call_id;
            c.status = status;
            c.phrase = phrase ? std::string(phrase) : std::string();
            if (status < 300) {
              c.sdp = minimal_sdp(host_from_listen(self->config.udp_listen));
            }
            self->post(std::move(c));
            if (status >= 300) {
              Command d;
              d.type = CmdType::Destroy;
              d.call_id = call_id;
              self->post(std::move(d));
            }
          }
        }
        break;
      }

      case nua_i_bye:
      case nua_i_cancel:
        if (sip && sip->sip_call_id && sip->sip_call_id->i_id) {
          Command c;
          c.type = CmdType::Destroy;
          c.call_id = safe_cstr(sip->sip_call_id->i_id);
          self->post(std::move(c));
        }
        break;

      default:
        (void)nua;
        (void)status;
        break;
    }
  }

  void thread_main() {
    su_init();
    su_home_init(&home);

    root = su_root_create(this);
    if (!root) {
      {
        std::lock_guard lock(ready_mu);
        ready_error = "su_root_create failed";
        ready = true;
      }
      ready_cv.notify_all();
      su_deinit();
      return;
    }

    sip_update_default_mclass(sip_extend_mclass(nullptr));

    const std::string url = listen_to_sip_url(config.udp_listen);
    const bool want_wss =
        !config.wss_listen.empty() && !config.certificate_dir.empty() &&
        !env_udp_only();
#if !defined(UR_SIGNALING_HAVE_SOFIA_WSS)
    if (want_wss) {
      std::lock_guard lock(ready_mu);
      ready_error =
          "sip.wss_listen configured but binary built without WSS Sofia "
          "(set UR_SOFIA_PREFIX to a Sofia with NUTAG_WSS_URL and rebuild)";
      ready = true;
      ready_cv.notify_all();
      su_root_destroy(root);
      root = nullptr;
      su_home_deinit(&home);
      su_deinit();
      return;
    }
#endif

    // NUTAG_ALLOW + NUTAG_APPL_METHOD("REGISTER") required — without them Sofia
    // answers inbound REGISTER with 405 Method Not Allowed (legacy SGW SETPARAM).
#if defined(UR_SIGNALING_HAVE_SOFIA_WSS)
    if (want_wss) {
      const std::string wss_url = listen_to_wss_url(config.wss_listen);
      const std::string sips_url = listen_to_sips_url(config.tls_listen);
      nua = nua_create(
          root, callback, this, NUTAG_URL(url.c_str()),
          NUTAG_WSS_URL(wss_url.c_str()), NUTAG_SIPS_URL(sips_url.c_str()),
          NUTAG_CERTIFICATE_DIR(config.certificate_dir.c_str()),
          NUTAG_AUTOACK(1), NUTAG_AUTOANSWER(0),
          SIPTAG_USER_AGENT_STR(kUserAgent),
          SIPTAG_ALLOW_STR("INVITE, ACK, BYE, CANCEL, OPTIONS, REGISTER"),
          NUTAG_ALLOW("REGISTER"), NUTAG_ALLOW("INVITE"), NUTAG_ALLOW("ACK"),
          NUTAG_ALLOW("CANCEL"), NUTAG_ALLOW("OPTIONS"), NUTAG_ALLOW("BYE"),
          NUTAG_APPL_METHOD("REGISTER"), NUTAG_APPL_METHOD("OPTIONS"),
          TAG_END());
      if (nua) {
        Logger::instance().info("SofiaAdapter listening " + url + " wss=" +
                                wss_url + " tls=" + sips_url + " certs=" +
                                config.certificate_dir);
      }
    } else
#endif
    {
      if (!config.wss_listen.empty() && env_udp_only()) {
        Logger::instance().info(
            "UR_SIP_UDP_ONLY=1 — skipping WSS/TLS bind (UDP only)");
      }
      nua = nua_create(
          root, callback, this, NUTAG_URL(url.c_str()), NUTAG_AUTOACK(1),
          NUTAG_AUTOANSWER(0),
          SIPTAG_USER_AGENT_STR(kUserAgent),
          SIPTAG_ALLOW_STR("INVITE, ACK, BYE, CANCEL, OPTIONS, REGISTER"),
          NUTAG_ALLOW("REGISTER"), NUTAG_ALLOW("INVITE"), NUTAG_ALLOW("ACK"),
          NUTAG_ALLOW("CANCEL"), NUTAG_ALLOW("OPTIONS"), NUTAG_ALLOW("BYE"),
          NUTAG_APPL_METHOD("REGISTER"), NUTAG_APPL_METHOD("OPTIONS"),
          TAG_END());
      if (nua) {
        Logger::instance().info("SofiaAdapter listening " + url);
      }
    }
    if (!nua) {
      {
        std::lock_guard lock(ready_mu);
        ready_error = "nua_create failed for " + url +
                      (want_wss ? " (+wss/tls)" : "");
        ready = true;
      }
      ready_cv.notify_all();
      su_root_destroy(root);
      root = nullptr;
      su_home_deinit(&home);
      su_deinit();
      return;
    }

    nua_set_params(
        nua, NUTAG_AUTOANSWER(0),
        SIPTAG_USER_AGENT_STR(kUserAgent),
        SIPTAG_ALLOW_STR("INVITE, ACK, BYE, CANCEL, OPTIONS, REGISTER"),
        NUTAG_ALLOW("REGISTER"), NUTAG_ALLOW("INVITE"), NUTAG_ALLOW("ACK"),
        NUTAG_ALLOW("CANCEL"), NUTAG_ALLOW("OPTIONS"), NUTAG_ALLOW("BYE"),
        NUTAG_APPL_METHOD("REGISTER"), NUTAG_APPL_METHOD("OPTIONS"), TAG_END());

    {
      std::lock_guard lock(ready_mu);
      ready = true;
      ready_error.clear();
    }
    ready_cv.notify_all();

    while (!stop.load(std::memory_order_acquire)) {
      drain_commands();
      su_root_step(root, 50);  // 50ms
    }

    drain_commands();

    // Tear down sessions on Sofia thread only — before nua_destroy.
    {
      std::lock_guard lock(sess_mu);
      for (auto& [id, s] : sessions) {
        destroy_handle_once(s.leg_b, s.leg_b_destroyed);
        destroy_handle_once(s.leg_a, s.leg_a_destroyed);
        (void)id;
      }
      sessions.clear();
    }

    // Ensure nua_shutdown completed (required before nua_destroy).
    if (nua && !nua_shutdown_done.load()) {
      if (!shutdown_requested) {
        shutdown_requested = true;
        nua_shutdown(nua);
      }
      for (int i = 0; i < 100 && !nua_shutdown_done.load(); ++i) {
        su_root_step(root, 50);
      }
    }

    if (nua) {
      nua_destroy(nua);
      nua = nullptr;
    }
    if (root) {
      su_root_destroy(root);
      root = nullptr;
    }
    su_home_deinit(&home);
    su_deinit();
    running.store(false);
    Logger::instance().info("SofiaAdapter thread exited");
  }
};

SofiaAdapter::SofiaAdapter() : impl_(std::make_unique<Impl>()) {}

SofiaAdapter::~SofiaAdapter() { shutdown(); }

void SofiaAdapter::set_inbound_handler(InboundHandler handler) {
  impl_->handler = std::move(handler);
}

void SofiaAdapter::set_register_processor(RegisterProcessor processor) {
  impl_->register_processor = std::move(processor);
}

Result<void> SofiaAdapter::start(const SipConfig& config) {
  if (impl_->running.load()) {
    return Result<void>::ok();
  }
  impl_->config = config;
  impl_->stop.store(false);
  {
    std::lock_guard lock(impl_->ready_mu);
    impl_->ready = false;
    impl_->ready_error.clear();
  }

  impl_->running.store(true);
  impl_->sofia_thread = std::thread([this] { impl_->thread_main(); });

  std::unique_lock lock(impl_->ready_mu);
  impl_->ready_cv.wait_for(lock, std::chrono::seconds(5),
                           [this] { return impl_->ready; });
  if (!impl_->ready) {
    shutdown();
    return Result<void>::err("SofiaAdapter start timeout");
  }
  if (!impl_->ready_error.empty()) {
    const std::string err = impl_->ready_error;
    shutdown();
    return Result<void>::err(err);
  }
  return Result<void>::ok();
}

void SofiaAdapter::shutdown() {
  if (!impl_) {
    return;
  }
  if (!impl_->running.load() && !impl_->sofia_thread.joinable()) {
    return;
  }
  {
    Impl::Command c;
    c.type = Impl::CmdType::Shutdown;
    impl_->post(std::move(c));
  }
  // Do not force-stop the Sofia loop here — wait for nua_r_shutdown via join.
  if (impl_->sofia_thread.joinable()) {
    impl_->sofia_thread.join();
  }
  impl_->running.store(false);
}

void SofiaAdapter::dial_out(std::string call_id, std::string pbx_ip,
                           std::string called_user, std::string calling_user) {
  Impl::Command cmd;
  cmd.type = Impl::CmdType::DialOut;
  cmd.call_id = std::move(call_id);
  cmd.pbx_ip = std::move(pbx_ip);
  cmd.called_user = std::move(called_user);
  cmd.calling_user = std::move(calling_user);
  impl_->post(std::move(cmd));
}

void SofiaAdapter::respond(std::string call_id, int status, std::string phrase) {
  Impl::Command cmd;
  cmd.type = Impl::CmdType::Respond;
  cmd.call_id = std::move(call_id);
  cmd.status = status;
  cmd.phrase = std::move(phrase);
  impl_->post(std::move(cmd));
}

void SofiaAdapter::destroy_call(std::string call_id) {
  Impl::Command cmd;
  cmd.type = Impl::CmdType::Destroy;
  cmd.call_id = std::move(call_id);
  impl_->post(std::move(cmd));
}

std::string SofiaAdapter::last_outbound_pbx_ip() const {
  std::lock_guard lock(impl_->hook_mu);
  return impl_->last_pbx;
}

std::uint64_t SofiaAdapter::outbound_invite_count() const noexcept {
  return impl_->outbound_count.load(std::memory_order_relaxed);
}

}  // namespace urs
