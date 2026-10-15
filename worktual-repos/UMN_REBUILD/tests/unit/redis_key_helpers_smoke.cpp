#include "redis/LiveCallStore.h"
#include "redis/PbxPresenceStore.h"

#include <iostream>
#include <string>

int main() {
  const std::string pbx = urs::PbxPresenceStore::keyFor("10.0.0.5");
  if (pbx != "pbx:alive:10.0.0.5") {
    std::cerr << "unexpected pbx key: " << pbx << '\n';
    return 1;
  }

  const std::string call = urs::LiveCallStore::keyFor("uid-abc");
  if (call != "call:live:uid-abc") {
    std::cerr << "unexpected call key: " << call << '\n';
    return 1;
  }

  std::cout << "redis_key_helpers_smoke OK\n";
  return 0;
}