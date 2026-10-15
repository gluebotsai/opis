// Redis-free snapshot unit coverage for PbxSelector (TTL reconcile stays in
// scripts/interrogator-smoke.sh against Redis).
#include "interrogator/PbxSelector.h"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

int main() {
  const std::string path = "/tmp/ur-pbx-snapshot-unit.json";
  std::filesystem::remove(path);

  urs::PbxSelector sel;
  urs::PbxRecord r{.ip = "10.1.1.1",
                   .cpu_usage = "10",
                   .memory_usage = "20",
                   .network_io_usage = "30",
                   .cps = "5"};
  sel.upsert(r);
  r.ip = "10.1.1.2";
  sel.upsert(r);

  if (auto ok = sel.saveSnapshot(path); !ok) {
    std::cerr << "saveSnapshot failed: " << ok.error() << '\n';
    return 1;
  }

  // Snapshot is a JSON array of PBX records.
  {
    std::ifstream in(path);
    nlohmann::json root;
    in >> root;
    if (!root.is_array() || root.size() != 2) {
      std::cerr << "unexpected snapshot shape\n";
      return 1;
    }
  }

  urs::PbxSelector other;
  if (auto ok = other.loadSnapshot(path); !ok) {
    std::cerr << "loadSnapshot failed: " << ok.error() << '\n';
    return 1;
  }
  if (other.size() != 2 || !other.contains("10.1.1.1") || !other.contains("10.1.1.2")) {
    std::cerr << "snapshot content mismatch\n";
    return 1;
  }

  // Overwrite snapshot with one IP and reload.
  urs::PbxSelector one;
  one.upsert(urs::PbxRecord{.ip = "10.9.9.9",
                            .cpu_usage = "1",
                            .memory_usage = "1",
                            .network_io_usage = "1",
                            .cps = "1"});
  if (auto ok = one.saveSnapshot(path); !ok) {
    std::cerr << "overwrite save failed\n";
    return 1;
  }
  other.clear();
  if (auto ok = other.loadSnapshot(path); !ok || other.size() != 1 ||
                                            !other.contains("10.9.9.9")) {
    std::cerr << "overwrite reload failed\n";
    return 1;
  }

  std::filesystem::remove(path);
  std::cout << "interrogator_ttl_snapshot_unit OK (snapshot; TTL via interrogator-smoke)\n";
  return 0;
}
