#pragma once

#include "common/Result.h"

#include <fstream>
#include <mutex>
#include <string>
#include <string_view>

namespace urs {

enum class LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
};

class Logger {
public:
  static Logger& instance();

  // Fail if file path is non-empty but cannot be opened.
  [[nodiscard]] Result<void> init(std::string_view level, std::string_view file_path);

  void set_level(LogLevel level) noexcept { min_level_ = level; }

  void debug(std::string_view msg);
  void info(std::string_view msg);
  void warn(std::string_view msg);
  void error(std::string_view msg);

  // Mask password/secret-like key/value pairs. Never log raw secrets.
  [[nodiscard]] static std::string redact(std::string_view message);

  [[nodiscard]] static LogLevel parse_level(std::string_view level);
  [[nodiscard]] static bool is_valid_level(std::string_view level);

private:
  Logger() = default;
  void log(LogLevel level, std::string_view msg);

  std::mutex mutex_;
  LogLevel min_level_{LogLevel::Info};
  std::ofstream file_;
  bool initialized_{false};
};

}  // namespace urs