#include "logging/Logger.h"

#include <chrono>
#include <ctime>
#include <iostream>
#include <regex>

namespace urs {
namespace {

const char* level_name(LogLevel level) {
  switch (level) {
    case LogLevel::Debug:
      return "DEBUG";
    case LogLevel::Info:
      return "INFO";
    case LogLevel::Warn:
      return "WARN";
    case LogLevel::Error:
      return "ERROR";
  }
  return "INFO";
}

std::string timestamp_now() {
  using clock = std::chrono::system_clock;
  const auto now = clock::now();
  const std::time_t t = clock::to_time_t(now);
  std::tm tm{};
  localtime_r(&t, &tm);
  char buf[32];
  std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm);
  return buf;
}

}  // namespace

Logger& Logger::instance() {
  static Logger logger;
  return logger;
}

bool Logger::is_valid_level(std::string_view level) {
  return level == "debug" || level == "info" || level == "warn" || level == "warning" ||
         level == "error";
}

LogLevel Logger::parse_level(std::string_view level) {
  if (level == "debug") {
    return LogLevel::Debug;
  }
  if (level == "warn" || level == "warning") {
    return LogLevel::Warn;
  }
  if (level == "error") {
    return LogLevel::Error;
  }
  return LogLevel::Info;
}

std::string Logger::redact(std::string_view message) {
  std::string out(message);

  // JSON-style: "password": "value" / "token":"value"
  static const std::regex kJsonSecret(
      R"regex(("(?:password|passwd|secret|auth|token|authorization)"\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\s}\]]+))regex",
      std::regex::icase | std::regex::ECMAScript);

  // key=value / key: value (non-JSON)
  static const std::regex kKvSecret(
      R"regex(((?:password|passwd|secret|auth|token|authorization)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+))regex",
      std::regex::icase | std::regex::ECMAScript);

  out = std::regex_replace(out, kJsonSecret, "$1***");
  out = std::regex_replace(out, kKvSecret, "$1***");
  return out;
}

Result<void> Logger::init(std::string_view level, std::string_view file_path) {
  std::lock_guard lock(mutex_);

  if (!is_valid_level(level)) {
    return Result<void>::err("invalid log level");
  }

  min_level_ = parse_level(level);

  if (file_.is_open()) {
    file_.close();
  }

  if (!file_path.empty()) {
    file_.open(std::string(file_path), std::ios::app);
    if (!file_.is_open()) {
      return Result<void>::err("failed to open log file: " + std::string(file_path));
    }
  }

  initialized_ = true;
  return Result<void>::ok();
}

void Logger::debug(std::string_view msg) { log(LogLevel::Debug, msg); }
void Logger::info(std::string_view msg) { log(LogLevel::Info, msg); }
void Logger::warn(std::string_view msg) { log(LogLevel::Warn, msg); }
void Logger::error(std::string_view msg) { log(LogLevel::Error, msg); }

void Logger::log(LogLevel level, std::string_view msg) {
  const std::string safe = redact(msg);
  std::lock_guard lock(mutex_);
  if (level < min_level_) {
    return;
  }
  const std::string line =
      timestamp_now() + " [" + level_name(level) + "] " + safe;
  std::ostream& out = (level >= LogLevel::Warn) ? std::cerr : std::cout;
  out << line << '\n';
  out.flush();
  if (file_.is_open()) {
    file_ << line << '\n';
    file_.flush();
  }
}

}  // namespace urs