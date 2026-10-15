#include "logging/Logger.h"

#include <iostream>
#include <string>

int main() {
  const std::string json_pw =
      urs::Logger::redact(R"({"user":"a","password":"s3cret","ok":true})");
  if (json_pw.find("s3cret") != std::string::npos ||
      json_pw.find("***") == std::string::npos) {
    std::cerr << "JSON password not redacted: " << json_pw << '\n';
    return 1;
  }

  const std::string json_token =
      urs::Logger::redact(R"({"token":"abc123","x":1})");
  if (json_token.find("abc123") != std::string::npos) {
    std::cerr << "JSON token not redacted: " << json_token << '\n';
    return 1;
  }

  const std::string json_auth =
      urs::Logger::redact(R"({"authorization":"Bearer xyz"})");
  if (json_auth.find("Bearer xyz") != std::string::npos) {
    std::cerr << "JSON authorization not redacted: " << json_auth << '\n';
    return 1;
  }

  const std::string kv = urs::Logger::redact("password=hunter2 host=127.0.0.1");
  if (kv.find("hunter2") != std::string::npos || kv.find("***") == std::string::npos) {
    std::cerr << "kv password not redacted: " << kv << '\n';
    return 1;
  }

  const std::string kv2 = urs::Logger::redact("secret: topsecret");
  if (kv2.find("topsecret") != std::string::npos) {
    std::cerr << "kv secret not redacted: " << kv2 << '\n';
    return 1;
  }

  // Non-secret keys unchanged.
  const std::string plain = urs::Logger::redact("route_pbx_ip=10.1.1.1");
  if (plain.find("10.1.1.1") == std::string::npos) {
    std::cerr << "non-secret mangled: " << plain << '\n';
    return 1;
  }

  std::cout << "logger_redact_smoke OK\n";
  return 0;
}
