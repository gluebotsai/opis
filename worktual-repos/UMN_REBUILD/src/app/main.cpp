#include "app/Application.h"
#include "config/Config.h"
#include "logging/Logger.h"

#include <atomic>
#include <csignal>
#include <iostream>
#include <string>

#ifndef UR_SIGNALING_VERSION
#define UR_SIGNALING_VERSION "0.1.0"
#endif

namespace {

constexpr const char* kDefaultConfigPath = "configs/ur-signaling.conf.json";

// Written only from signal handler — keep handler async-signal-safe.
std::atomic<bool> g_signal_shutdown{false};

void on_signal(int /*sig*/) {
  g_signal_shutdown.store(true, std::memory_order_release);
}

bool install_signal_handlers() {
  struct sigaction sa {};
  sa.sa_handler = on_signal;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = 0;
  if (sigaction(SIGINT, &sa, nullptr) != 0) {
    return false;
  }
  if (sigaction(SIGTERM, &sa, nullptr) != 0) {
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string config_path =
      (argc > 1) ? argv[1] : std::string(kDefaultConfigPath);

  std::cout << "ur-signaling " << UR_SIGNALING_VERSION << '\n' << std::flush;

  auto loaded = urs::Config::load(config_path);
  if (!loaded) {
    std::cerr << "FATAL: config init failed: " << loaded.error() << '\n';
    return 1;
  }
  auto config = std::move(loaded.value());

  if (auto log_ok =
          urs::Logger::instance().init(config.logging.level, config.logging.file);
      !log_ok) {
    std::cerr << "FATAL: logger init failed: " << log_ok.error() << '\n';
    return 1;
  }

  urs::Logger::instance().info("loaded config from " + config_path);

  if (!install_signal_handlers()) {
    urs::Logger::instance().error("FATAL: failed to install signal handlers");
    return 1;
  }

  urs::Application app(std::move(config));

  if (auto started = app.start(); !started) {
    urs::Logger::instance().error("FATAL: application start failed: " + started.error());
    return 1;
  }

  app.wait_for_shutdown(g_signal_shutdown);
  app.stop();

  urs::Logger::instance().info("exiting 0");
  return 0;
}