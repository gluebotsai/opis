#pragma once

#include "common/Result.h"
#include "common/Types.h"

#include <cstddef>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace urs {

struct PbxRecord {
  PbxIp ip;
  std::string cpu_usage;
  std::string memory_usage;
  std::string network_io_usage;
  std::string cps;
};

// In-memory PBX map + round-robin + JSON snapshot (not a Redis registry).
class PbxSelector {
public:
  PbxSelector() = default;

  void upsert(const PbxRecord& record);
  void remove(const PbxIp& ip);
  void clear();

  [[nodiscard]] Result<PbxIp> nextRoundRobin();
  [[nodiscard]] std::vector<PbxRecord> list() const;
  [[nodiscard]] std::size_t size() const;
  [[nodiscard]] bool contains(const PbxIp& ip) const;

  [[nodiscard]] Result<void> loadSnapshot(const std::string& path);
  [[nodiscard]] Result<void> saveSnapshot(const std::string& path) const;

private:
  mutable std::mutex mutex_;
  std::map<PbxIp, PbxRecord> records_;
  std::size_t rr_index_{0};
};

}  // namespace urs