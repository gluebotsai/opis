#include "redis/RegistrationStore.h"

#include <nlohmann/json.hpp>

namespace urs {

RegistrationStore::RegistrationStore(RedisClient& redis) : redis_(redis) {}

std::string RegistrationStore::credentialsKey(const std::string& user,
                                              const std::string& domain) {
  return user + "@" + domain;
}

std::string RegistrationStore::bindingKey(const std::string& user,
                                          const std::string& domain,
                                          const std::string& device_type,
                                          const std::string& app_type) {
  return user + "@" + domain + "@" + device_type + ":" + app_type;
}

Result<std::optional<UserCredentials>> RegistrationStore::getCredentials(
    const std::string& user, const std::string& domain) {
  auto got = redis_.get(credentialsKey(user, domain));
  if (!got) {
    return Result<std::optional<UserCredentials>>::err(got.error());
  }
  if (!got.value()) {
    return Result<std::optional<UserCredentials>>::ok(std::nullopt);
  }

  try {
    const auto j = nlohmann::json::parse(*got.value());
    UserCredentials cred;
    cred.user_id = j.value("user_id", "");
    cred.domain_id = j.value("domain_id", "");
    cred.password = j.value("password", "");
    cred.caller_name = j.value("callerName", "");
    cred.sip_login_id = j.value("sip_login_id", "");
    if (cred.password.empty()) {
      return Result<std::optional<UserCredentials>>::err(
          "credentials missing password");
    }
    return Result<std::optional<UserCredentials>>::ok(std::move(cred));
  } catch (const nlohmann::json::exception& ex) {
    return Result<std::optional<UserCredentials>>::err(
        std::string("credentials JSON: ") + ex.what());
  }
}

Result<void> RegistrationStore::setBinding(const std::string& key,
                                           const std::string& json_value) {
  return redis_.set(key, json_value);
}

Result<void> RegistrationStore::deleteBinding(const std::string& key) {
  return redis_.del(key);
}

}  // namespace urs
