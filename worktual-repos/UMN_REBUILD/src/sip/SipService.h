#pragma once

#include "common/Result.h"
#include "config/Config.h"
#include "controller/Controller.h"
#include "sip/sofia/SofiaAdapter.h"

#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>

namespace urs {

// SIP worker — Sofia callbacks enqueue INVITE here; REGISTER is handled sync on Sofia thread.
class SipService {
public:
  SipService();
  ~SipService();

  SipService(const SipService&) = delete;
  SipService& operator=(const SipService&) = delete;

  void set_controller(Controller* controller) noexcept;

  [[nodiscard]] Result<void> init(const SipConfig& config);
  [[nodiscard]] Result<void> start();
  void stop();

  [[nodiscard]] Result<void> sendInvite(const std::string& call_id,
                                        const std::string& pbx_ip,
                                        const std::string& called_user,
                                        const std::string& calling_user);

  [[nodiscard]] SofiaAdapter& adapter() noexcept { return *adapter_; }
  [[nodiscard]] const SofiaAdapter& adapter() const noexcept { return *adapter_; }

private:
  void worker_loop();
  void on_inbound(SofiaAdapter::InboundInvite invite);
  void handle_invite(SofiaAdapter::InboundInvite invite);
  [[nodiscard]] SofiaAdapter::RegisterDecision process_register(
      const SofiaAdapter::InboundRegister& reg);

  Controller* controller_{nullptr};
  SipConfig config_;
  std::unique_ptr<SofiaAdapter> adapter_;

  std::mutex queue_mu_;
  std::condition_variable queue_cv_;
  std::queue<SofiaAdapter::InboundInvite> inbound_;
  std::thread worker_;
  std::atomic<bool> running_{false};
  bool initialized_{false};
};

}  // namespace urs
