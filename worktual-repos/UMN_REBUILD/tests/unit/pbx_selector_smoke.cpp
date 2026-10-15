#include "interrogator/PbxSelector.h"

#include <filesystem>
#include <iostream>
#include <string>

int main() {
  urs::PbxSelector sel;

  // Empty selector
  if (sel.nextRoundRobin()) {
    std::cerr << "empty RR should fail\n";
    return 1;
  }
  if (sel.size() != 0) {
    std::cerr << "expected empty size\n";
    return 1;
  }

  // Missing snapshot path is OK (empty)
  if (auto ok = sel.loadSnapshot("/tmp/ur-pbx-selector-missing-noexist.json"); !ok) {
    std::cerr << "missing snapshot should succeed empty: " << ok.error() << '\n';
    return 1;
  }

  urs::PbxRecord a{.ip = "10.0.0.1",
                   .cpu_usage = "1",
                   .memory_usage = "2",
                   .network_io_usage = "3",
                   .cps = "4"};
  urs::PbxRecord b = a;
  b.ip = "10.0.0.2";

  sel.upsert(a);
  sel.upsert(b);
  if (sel.size() != 2) {
    std::cerr << "expected size 2\n";
    return 1;
  }

  // Empty IP upsert ignored
  urs::PbxRecord empty_ip = a;
  empty_ip.ip.clear();
  sel.upsert(empty_ip);
  if (sel.size() != 2) {
    std::cerr << "empty ip upsert should be ignored\n";
    return 1;
  }

  auto ip1 = sel.nextRoundRobin();
  auto ip2 = sel.nextRoundRobin();
  auto ip3 = sel.nextRoundRobin();
  if (!ip1 || !ip2 || !ip3) {
    std::cerr << "RR failed\n";
    return 1;
  }
  if (ip1.value() == ip2.value()) {
    std::cerr << "RR should advance\n";
    return 1;
  }
  if (ip3.value() != ip1.value()) {
    std::cerr << "RR should wrap\n";
    return 1;
  }

  const std::string path = "/tmp/ur-pbx-selector-smoke.json";
  if (auto ok = sel.saveSnapshot(path); !ok) {
    std::cerr << "save failed: " << ok.error() << '\n';
    return 1;
  }

  urs::PbxSelector loaded;
  if (auto ok = loaded.loadSnapshot(path); !ok) {
    std::cerr << "load failed: " << ok.error() << '\n';
    return 1;
  }
  if (loaded.size() != 2 || !loaded.contains("10.0.0.1") || !loaded.contains("10.0.0.2")) {
    std::cerr << "snapshot round-trip failed\n";
    return 1;
  }

  // Reload into cleared selector
  loaded.clear();
  if (loaded.size() != 0) {
    std::cerr << "clear failed\n";
    return 1;
  }
  if (auto ok = loaded.loadSnapshot(path); !ok || loaded.size() != 2) {
    std::cerr << "reload after clear failed\n";
    return 1;
  }

  sel.remove("10.0.0.1");
  if (sel.contains("10.0.0.1") || sel.size() != 1) {
    std::cerr << "remove failed\n";
    return 1;
  }
  auto after_remove = sel.nextRoundRobin();
  if (!after_remove || after_remove.value() != "10.0.0.2") {
    std::cerr << "RR after remove should return remaining PBX\n";
    return 1;
  }

  sel.remove("10.0.0.2");
  if (sel.nextRoundRobin()) {
    std::cerr << "RR after removing all should fail\n";
    return 1;
  }

  std::filesystem::remove(path);
  std::cout << "pbx_selector_smoke OK\n";
  return 0;
}
