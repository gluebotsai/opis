#include "sip/DigestAuth.h"

#include <openssl/md5.h>
#include <openssl/rand.h>

#include <cstdio>
#include <iomanip>
#include <sstream>

namespace urs {
namespace {

std::string toHex(const unsigned char* data, std::size_t len) {
  std::ostringstream oss;
  oss << std::hex << std::setfill('0');
  for (std::size_t i = 0; i < len; ++i) {
    oss << std::setw(2) << static_cast<unsigned>(data[i]);
  }
  return oss.str();
}

}  // namespace

std::string md5Hex(const std::string& data) {
  unsigned char digest[MD5_DIGEST_LENGTH];
  MD5(reinterpret_cast<const unsigned char*>(data.data()), data.size(), digest);
  return toHex(digest, MD5_DIGEST_LENGTH);
}

std::string digestHa1(const std::string& username, const std::string& realm,
                      const std::string& password) {
  return md5Hex(username + ":" + realm + ":" + password);
}

std::string digestResponse(const std::string& ha1, const std::string& nonce,
                           const std::string& method, const std::string& uri) {
  const std::string ha2 = md5Hex(method + ":" + uri);
  return md5Hex(ha1 + ":" + nonce + ":" + ha2);
}

bool verifyDigestResponse(const std::string& username, const std::string& realm,
                          const std::string& password, const std::string& nonce,
                          const std::string& method, const std::string& uri,
                          const std::string& response) {
  if (username.empty() || realm.empty() || password.empty() || nonce.empty() ||
      method.empty() || uri.empty() || response.empty()) {
    return false;
  }
  const std::string ha1 = digestHa1(username, realm, password);
  const std::string expected = digestResponse(ha1, nonce, method, uri);
  return expected == response;
}

std::string makeDigestNonce() {
  unsigned char buf[16];
  if (RAND_bytes(buf, sizeof(buf)) != 1) {
    // Fallback: not cryptographically ideal, but avoids hard fail.
    for (std::size_t i = 0; i < sizeof(buf); ++i) {
      buf[i] = static_cast<unsigned char>(i * 17 + 3);
    }
  }
  return toHex(buf, sizeof(buf));
}

std::string wwwAuthenticateHeader(const std::string& realm,
                                  const std::string& nonce) {
  // Leading space matches legacy SGW / Sofia SIPTAG_WWW_AUTHENTICATE_STR usage.
  return " Digest realm=\"" + realm + "\",nonce=\"" + nonce + "\"";
}

}  // namespace urs
