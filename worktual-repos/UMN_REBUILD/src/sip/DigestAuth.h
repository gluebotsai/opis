#pragma once

#include <string>

namespace urs {

// RFC 2617 Digest (MD5) helpers for SIP REGISTER — never log password.
[[nodiscard]] std::string md5Hex(const std::string& data);
[[nodiscard]] std::string digestHa1(const std::string& username,
                                    const std::string& realm,
                                    const std::string& password);
[[nodiscard]] std::string digestResponse(const std::string& ha1,
                                         const std::string& nonce,
                                         const std::string& method,
                                         const std::string& uri);
[[nodiscard]] bool verifyDigestResponse(const std::string& username,
                                        const std::string& realm,
                                        const std::string& password,
                                        const std::string& nonce,
                                        const std::string& method,
                                        const std::string& uri,
                                        const std::string& response);
[[nodiscard]] std::string makeDigestNonce();
[[nodiscard]] std::string wwwAuthenticateHeader(const std::string& realm,
                                                const std::string& nonce);

}  // namespace urs
