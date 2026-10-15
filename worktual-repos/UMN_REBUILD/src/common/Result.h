#pragma once

#include <string>
#include <utility>
#include <variant>

namespace urs {

struct ErrorMessage {
  std::string message;
};

template <typename T>
class Result {
public:
  static Result ok(T value) { return Result(std::move(value)); }
  static Result err(std::string message) {
    return Result(ErrorMessage{std::move(message)});
  }

  [[nodiscard]] bool has_value() const noexcept {
    return std::holds_alternative<T>(storage_);
  }
  [[nodiscard]] explicit operator bool() const noexcept { return has_value(); }

  [[nodiscard]] T& value() & { return std::get<T>(storage_); }
  [[nodiscard]] const T& value() const& { return std::get<T>(storage_); }
  [[nodiscard]] T&& value() && { return std::get<T>(std::move(storage_)); }

  [[nodiscard]] const std::string& error() const {
    return std::get<ErrorMessage>(storage_).message;
  }

private:
  explicit Result(T value) : storage_(std::move(value)) {}
  explicit Result(ErrorMessage err) : storage_(std::move(err)) {}

  std::variant<T, ErrorMessage> storage_;
};

template <>
class Result<void> {
public:
  static Result ok() { return Result(true); }
  static Result err(std::string message) { return Result(std::move(message)); }

  [[nodiscard]] bool has_value() const noexcept { return ok_; }
  [[nodiscard]] explicit operator bool() const noexcept { return ok_; }

  [[nodiscard]] const std::string& error() const { return message_; }

private:
  explicit Result(bool ok) : ok_(ok) {}
  explicit Result(std::string message) : ok_(false), message_(std::move(message)) {}

  bool ok_{false};
  std::string message_;
};

}  // namespace urs