#include "interrogator/InterrogatorService.h"

#include "logging/Logger.h"
#include "sip/DigestAuth.h"

#include <nlohmann/json.hpp>

#include <chrono>
#include <ctime>
#include <utility>

namespace urs {
namespace {

constexpr auto kNonceTtl = std::chrono::seconds(120);

std::string nowLocalTimeString() {
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
  localtime_r(&t, &tm);
  char buf[32];
  std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm);
  return buf;
}

}  // namespace

InterrogatorService::InterrogatorService(RedisClient& redis,
                                         PbxPresenceStore& presence,
                                         LiveCallStore& live_calls)
    : redis_(redis),
      presence_(presence),
      live_calls_(live_calls),
      registration_(redis) {}

InterrogatorService::~InterrogatorService() { stop(); }

Result<void> InterrogatorService::start(const AppConfig& config) {
  std::lock_guard lock(start_mutex_);
  if (running_.load()) {
    return Result<void>::ok();
  }

  config_ = config;
  auto& log = Logger::instance();

  // 1) load snapshot
  if (auto ok = selector_.loadSnapshot(config_.pbx.snapshot_path); !ok) {
    return Result<void>::err("snapshot load failed: " + ok.error());
  }
  log.info("Interrogator loaded snapshot path=" + config_.pbx.snapshot_path +
           " pbx_count=" + std::to_string(selector_.size()));

  // 2) drop IPs outside allowlist (if configured)
  pruneDisallowedPbx();

  // 3) drop expired TTL
  reconcileExpiredTtl();
  log.info("Interrogator after TTL reconcile pbx_count=" +
           std::to_string(selector_.size()));

  // 4) subscribe
  if (auto ok = redis_.subscribe(
          config_.redis.pubsub_channel,
          [this](std::string_view channel, std::string_view payload) {
            onMessage(channel, payload);
          });
      !ok) {
    return Result<void>::err("subscribe failed: " + ok.error());
  }

  // 5) periodic snapshot
  snapshot_stop_.store(false);
  snapshot_thread_ = std::thread([this] { snapshotLoop(); });

  running_.store(true);
  log.info("InterrogatorService started channel=" + config_.redis.pubsub_channel);
  return Result<void>::ok();
}

void InterrogatorService::stop() {
  std::lock_guard lock(start_mutex_);
  if (!running_.exchange(false) && !snapshot_thread_.joinable()) {
    return;
  }

  snapshot_stop_.store(true);
  if (snapshot_thread_.joinable()) {
    snapshot_thread_.join();
  }

  redis_.unsubscribe();
  saveSnapshotNow();
  Logger::instance().info("InterrogatorService stopped");
}

bool InterrogatorService::isAllowedPbx(const PbxIp& ip) const {
  if (config_.pbx.allowed_ips.empty()) {
    return true;
  }
  for (const auto& allowed : config_.pbx.allowed_ips) {
    if (allowed == ip) {
      return true;
    }
  }
  return false;
}

void InterrogatorService::pruneDisallowedPbx() {
  if (config_.pbx.allowed_ips.empty()) {
    return;
  }
  const auto records = selector_.list();
  for (const auto& rec : records) {
    if (!isAllowedPbx(rec.ip)) {
      Logger::instance().info("Dropping PBX not in allowlist: " + rec.ip);
      selector_.remove(rec.ip);
    }
  }
}

void InterrogatorService::reconcileExpiredTtl() {
  const auto records = selector_.list();
  for (const auto& rec : records) {
    auto alive = presence_.isAlive(rec.ip);
    if (!alive) {
      Logger::instance().warn("TTL check failed for " + rec.ip + ": " + alive.error() +
                              " — keeping snapshot entry");
      continue;
    }
    if (!alive.value()) {
      Logger::instance().info("Dropping PBX with expired TTL: " + rec.ip);
      selector_.remove(rec.ip);
    }
  }
}

void InterrogatorService::snapshotLoop() {
  while (!snapshot_stop_.load()) {
    for (int i = 0; i < 100 && !snapshot_stop_.load(); ++i) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    if (snapshot_stop_.load()) {
      break;
    }
    saveSnapshotNow();
  }
}

void InterrogatorService::saveSnapshotNow() {
  if (auto ok = selector_.saveSnapshot(config_.pbx.snapshot_path); !ok) {
    Logger::instance().error("snapshot save failed: " + ok.error());
  }
}

void InterrogatorService::onMessage(std::string_view /*channel*/, std::string_view payload) {
  handlePubSubMessage(payload);
}

void InterrogatorService::handlePubSubMessage(std::string_view payload) {
  if (payload.empty() || payload == "__urs_unsubscribe__") {
    return;
  }

  Logger::instance().info("Interrogator pubsub handle payload=" +
                          std::string(payload));

  nlohmann::json root;
  try {
    root = nlohmann::json::parse(payload);
  } catch (const nlohmann::json::exception& ex) {
    Logger::instance().warn(std::string("pubsub JSON parse failed: ") + ex.what());
    return;
  }

  if (!root.is_object()) {
    return;
  }

  const std::string msg_type = root.value("msg_type", "");
  if (msg_type == "pbx-call-load-statistics") {
    handleUpsert(root);
  } else if (msg_type == "pbx-call-load-statistics-delete") {
    handleDelete(root);
  }
  // Ignore client-call-info* and other types — live calls stay in Redis.
}

void InterrogatorService::handleUpsert(const nlohmann::json& object) {
  PbxRecord rec;
  rec.ip = object.value("pbx_addr", "");
  if (rec.ip.empty()) {
    Logger::instance().warn("pbx-call-load-statistics missing pbx_addr");
    return;
  }
  if (!isAllowedPbx(rec.ip)) {
    Logger::instance().info("Ignoring PBX outside allowlist: " + rec.ip);
    return;
  }
  if (!object.contains("cpu_usage") || !object.contains("memory_usage") ||
      !object.contains("network_io_usage") || !object.contains("cps")) {
    Logger::instance().warn("pbx-call-load-statistics missing required load fields for " +
                            rec.ip);
    return;
  }
  rec.cpu_usage = object.value("cpu_usage", "");
  rec.memory_usage = object.value("memory_usage", "");
  rec.network_io_usage = object.value("network_io_usage", "");
  rec.cps = object.value("cps", "");

  selector_.upsert(rec);
  if (auto ok = presence_.refreshAlive(rec.ip, config_.redis.pbx_alive_ttl_sec); !ok) {
    Logger::instance().warn("refreshAlive failed for " + rec.ip + ": " + ok.error());
  }
  saveSnapshotNow();
  Logger::instance().info("PBX upserted " + rec.ip +
                          " memory_count=" + std::to_string(selector_.size()));
}

void InterrogatorService::handleDelete(const nlohmann::json& object) {
  const PbxIp ip = object.value("pbx_addr", "");
  if (ip.empty()) {
    Logger::instance().warn("pbx-call-load-statistics-delete missing pbx_addr");
    return;
  }
  if (!isAllowedPbx(ip)) {
    Logger::instance().info("Ignoring PBX delete outside allowlist: " + ip);
    return;
  }
  selector_.remove(ip);
  if (auto ok = presence_.clearAlive(ip); !ok) {
    Logger::instance().warn("clearAlive failed for " + ip + ": " + ok.error());
  }
  saveSnapshotNow();
  Logger::instance().info("PBX deleted " + ip +
                          " memory_count=" + std::to_string(selector_.size()));
}

Result<PbxIp> InterrogatorService::getNextPbxIp() {
  return selector_.nextRoundRobin();
}

Result<std::optional<LiveCallInfo>> InterrogatorService::lookupLiveCall(const CallUid& uid) {
  return live_calls_.get(uid);
}

Result<RegisterResponse> InterrogatorService::handleRegister(
    const RegisterRequest& request) {
  RegisterResponse resp;

  nlohmann::json root;
  try {
    root = nlohmann::json::parse(request.raw_json.empty() ? "{}" : request.raw_json);
  } catch (const nlohmann::json::exception& ex) {
    resp.detail = std::string("bad REGISTER JSON: ") + ex.what();
    return Result<RegisterResponse>::ok(std::move(resp));
  }

  const std::string username = root.value("username", "");
  const std::string domain = root.value("domain", "");
  const std::string device_type = root.value("device_type", "URDESK");
  const std::string app_type = root.value("app_type", "");
  const std::string contact_address = root.value("contact_address", "");
  const std::string contact_uri = root.value("contact_uri", "");
  const std::string call_id = root.value("call_id", "");
  const std::string transport_type = root.value("transport_type", "udp");
  const std::string sgw_ip = root.value("sgw_ip", "");
  const std::string proxy_username = root.value("proxy_username", username);
  const int expires = root.value("expires", 3600);

  if (username.empty() || domain.empty()) {
    resp.detail = "missing username/domain";
    return Result<RegisterResponse>::ok(std::move(resp));
  }

  const std::string aor = RegistrationStore::credentialsKey(username, domain);
  const std::string realm = domain;

  const bool has_auth =
      root.contains("authorization") && root["authorization"].is_object() &&
      !root["authorization"].value("response", "").empty();

  if (!has_auth) {
    const std::string nonce = makeDigestNonce();
    {
      std::lock_guard lock(nonce_mutex_);
      digests_nonces_[nonce] = NonceEntry{aor, std::chrono::steady_clock::now()};
    }
    resp.need_challenge = true;
    resp.realm = realm;
    resp.nonce = nonce;
    resp.detail = "challenge";
    Logger::instance().info("REGISTER challenge aor=" + aor);
    return Result<RegisterResponse>::ok(std::move(resp));
  }

  const auto& auth = root["authorization"];
  const std::string auth_user = auth.value("username", username);
  const std::string auth_realm = auth.value("realm", realm);
  const std::string auth_nonce = auth.value("nonce", "");
  const std::string auth_uri = auth.value("uri", "");
  const std::string auth_response = auth.value("response", "");

  {
    std::lock_guard lock(nonce_mutex_);
    auto it = digests_nonces_.find(auth_nonce);
    if (it == digests_nonces_.end()) {
      resp.need_challenge = true;
      resp.realm = realm;
      resp.nonce = makeDigestNonce();
      digests_nonces_[resp.nonce] =
          NonceEntry{aor, std::chrono::steady_clock::now()};
      resp.detail = "unknown nonce";
      return Result<RegisterResponse>::ok(std::move(resp));
    }
    if (it->second.aor != aor) {
      resp.detail = "nonce aor mismatch";
      return Result<RegisterResponse>::ok(std::move(resp));
    }
    if (std::chrono::steady_clock::now() - it->second.issued_at > kNonceTtl) {
      digests_nonces_.erase(it);
      resp.need_challenge = true;
      resp.realm = realm;
      resp.nonce = makeDigestNonce();
      digests_nonces_[resp.nonce] =
          NonceEntry{aor, std::chrono::steady_clock::now()};
      resp.detail = "nonce expired";
      return Result<RegisterResponse>::ok(std::move(resp));
    }
  }

  auto creds = registration_.getCredentials(username, domain);
  if (!creds) {
    resp.detail = "credentials read failed: " + creds.error();
    return Result<RegisterResponse>::ok(std::move(resp));
  }
  if (!creds.value()) {
    resp.detail = "user not found";
    return Result<RegisterResponse>::ok(std::move(resp));
  }

  if (!verifyDigestResponse(auth_user, auth_realm, creds.value()->password,
                            auth_nonce, "REGISTER", auth_uri, auth_response)) {
    // Re-challenge with a fresh nonce (legacy SGW also re-issues 401 on fail).
    resp.need_challenge = true;
    resp.realm = realm;
    resp.nonce = makeDigestNonce();
    {
      std::lock_guard lock(nonce_mutex_);
      digests_nonces_[resp.nonce] =
          NonceEntry{aor, std::chrono::steady_clock::now()};
    }
    resp.detail = "digest mismatch";
    Logger::instance().warn(
        "REGISTER digest failed aor=" + aor + " auth_user=" + auth_user +
        " realm=" + auth_realm + " uri=" + auth_uri);
    return Result<RegisterResponse>::ok(std::move(resp));
  }

  {
    std::lock_guard lock(nonce_mutex_);
    digests_nonces_.erase(auth_nonce);
  }

  const std::string bkey =
      RegistrationStore::bindingKey(username, domain, device_type, app_type);

  const std::string contact_host =
      contact_address.empty() ? domain : contact_address;
  std::string transport_param;
  if (!transport_type.empty() && transport_type != "udp") {
    transport_param = ";transport=" + transport_type;
  }

  // 200 OK Contact = same addr-spec as REGISTER Contact (contact_uri), with
  // expires as a header param: <sip:user@host;transport=wss>;expires=N
  // (legacy SGW generate_reg_contact). Do not use To AOR username.
  const auto strip_expires_param = [](std::string uri) {
    constexpr const char* kExp = ";expires=";
    for (;;) {
      const auto pos = uri.rfind(kExp);
      if (pos == std::string::npos) {
        break;
      }
      // Only strip trailing ;expires=… (keep ;transport= inside URI).
      const auto after = uri.substr(pos + std::strlen(kExp));
      if (after.find(';') != std::string::npos) {
        break;
      }
      uri.erase(pos);
    }
    return uri;
  };
  const auto make_response_contact = [&](int exp) {
    std::string base;
    if (!contact_uri.empty()) {
      base = strip_expires_param(contact_uri);
    } else {
      const std::string user =
          proxy_username.empty() ? username : proxy_username;
      // Fallback: Contact user @ Contact host (contact_address may include rport
      // for Redis only — prefer host without inventing when uri missing).
      base = "sip:" + user + "@" + contact_host + transport_param;
    }
    // Strip accidental outer brackets before re-wrapping.
    if (!base.empty() && base.front() == '<' && base.back() == '>') {
      base = base.substr(1, base.size() - 2);
    }
    return "<" + base + ">;expires=" + std::to_string(exp);
  };

  if (expires == 0) {
    if (auto ok = registration_.deleteBinding(bkey); !ok) {
      resp.detail = "unregister del failed: " + ok.error();
      return Result<RegisterResponse>::ok(std::move(resp));
    }
    resp.accepted = true;
    resp.contact = make_response_contact(0);
    resp.detail = "unregistered";
    Logger::instance().info("REGISTER unregister ok key=" + bkey);
    return Result<RegisterResponse>::ok(std::move(resp));
  }

  nlohmann::json binding;
  binding["Call_id"] = call_id;
  binding["Contact_address"] = contact_address;
  binding["Ipaddress"] = sgw_ip;
  binding["proxy_username"] =
      proxy_username.empty() ? username : proxy_username;
  binding["transport_type"] = transport_type;
  binding["device_type"] = device_type + ":" + app_type;
  binding["Registered_time"] = nowLocalTimeString();
  binding["user_status"] = "";

  if (auto ok = registration_.setBinding(bkey, binding.dump()); !ok) {
    resp.detail = "binding set failed: " + ok.error();
    return Result<RegisterResponse>::ok(std::move(resp));
  }

  resp.accepted = true;
  resp.contact = make_response_contact(expires);
  resp.detail = "registered";
  Logger::instance().info("REGISTER ok key=" + bkey +
                          " contact=" + resp.contact +
                          " transport=" + transport_type);
  return Result<RegisterResponse>::ok(std::move(resp));
}

}  // namespace urs