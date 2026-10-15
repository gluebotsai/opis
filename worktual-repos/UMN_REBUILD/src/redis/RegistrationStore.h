#pragma once

#include "common/Result.h"
#include "redis/RedisClient.h"

#include <optional>
#include <string>

namespace urs {

struct UserCredentials {
  std::string user_id;
  std::string domain_id;
  std::string password;
  std::string caller_name;
  std::string sip_login_id;
};

// Store Redis registration helpers.
// Credentials key:  user@domain
// Binding key:      user@domain@deviceType:appType
class RegistrationStore {
public:
  explicit RegistrationStore(RedisClient& redis);

  [[nodiscard]] static std::string credentialsKey(const std::string& user,
                                                  const std::string& domain);
  [[nodiscard]] static std::string bindingKey(const std::string& user,
                                              const std::string& domain,
                                              const std::string& device_type,
                                              const std::string& app_type);

  [[nodiscard]] Result<std::optional<UserCredentials>> getCredentials(
      const std::string& user, const std::string& domain);

  [[nodiscard]] Result<void> setBinding(const std::string& key,
                                        const std::string& json_value);
  [[nodiscard]] Result<void> deleteBinding(const std::string& key);

private:
  RedisClient& redis_;
};

}  // namespace urs
