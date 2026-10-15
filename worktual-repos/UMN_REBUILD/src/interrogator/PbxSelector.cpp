#include "interrogator/PbxSelector.h"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <iterator>

namespace urs {

void PbxSelector::upsert(const PbxRecord& record) {
  if (record.ip.empty()) {
    return;
  }
  std::lock_guard lock(mutex_);
  records_[record.ip] = record;
}

void PbxSelector::remove(const PbxIp& ip) {
  std::lock_guard lock(mutex_);
  records_.erase(ip);
  if (records_.empty()) {
    rr_index_ = 0;
  } else if (rr_index_ >= records_.size()) {
    rr_index_ = 0;
  }
}

void PbxSelector::clear() {
  std::lock_guard lock(mutex_);
  records_.clear();
  rr_index_ = 0;
}

Result<PbxIp> PbxSelector::nextRoundRobin() {
  std::lock_guard lock(mutex_);
  if (records_.empty()) {
    return Result<PbxIp>::err("no PBX available");
  }
  if (rr_index_ >= records_.size()) {
    rr_index_ = 0;
  }
  auto it = records_.begin();
  std::advance(it, static_cast<std::ptrdiff_t>(rr_index_));
  const PbxIp ip = it->first;
  rr_index_ = (rr_index_ + 1) % records_.size();
  return Result<PbxIp>::ok(ip);
}

std::vector<PbxRecord> PbxSelector::list() const {
  std::lock_guard lock(mutex_);
  std::vector<PbxRecord> out;
  out.reserve(records_.size());
  for (const auto& [_, rec] : records_) {
    out.push_back(rec);
  }
  return out;
}

std::size_t PbxSelector::size() const {
  std::lock_guard lock(mutex_);
  return records_.size();
}

bool PbxSelector::contains(const PbxIp& ip) const {
  std::lock_guard lock(mutex_);
  return records_.contains(ip);
}

Result<void> PbxSelector::loadSnapshot(const std::string& path) {
  if (!std::filesystem::exists(path)) {
    return Result<void>::ok();  // missing file = empty OK
  }

  std::ifstream in(path);
  if (!in) {
    return Result<void>::err("failed to open snapshot: " + path);
  }

  nlohmann::json root;
  try {
    in >> root;
  } catch (const nlohmann::json::exception& ex) {
    return Result<void>::err(std::string("snapshot parse error: ") + ex.what());
  }

  if (!root.is_array()) {
    return Result<void>::err("snapshot root must be a JSON array");
  }

  std::map<PbxIp, PbxRecord> loaded;
  for (const auto& item : root) {
    if (!item.is_object()) {
      continue;
    }
    PbxRecord rec;
    rec.ip = item.value("pbx_addr", "");
    if (rec.ip.empty()) {
      continue;
    }
    rec.cpu_usage = item.value("cpu_usage", "");
    rec.memory_usage = item.value("memory_usage", "");
    rec.network_io_usage = item.value("network_io_usage", "");
    rec.cps = item.value("cps", "");
    loaded[rec.ip] = std::move(rec);
  }

  std::lock_guard lock(mutex_);
  records_ = std::move(loaded);
  rr_index_ = 0;
  return Result<void>::ok();
}

Result<void> PbxSelector::saveSnapshot(const std::string& path) const {
  nlohmann::json arr = nlohmann::json::array();
  {
    std::lock_guard lock(mutex_);
    for (const auto& [_, rec] : records_) {
      arr.push_back({
          {"pbx_addr", rec.ip},
          {"cpu_usage", rec.cpu_usage},
          {"memory_usage", rec.memory_usage},
          {"network_io_usage", rec.network_io_usage},
          {"cps", rec.cps},
      });
    }
  }

  try {
    const std::filesystem::path dest(path);
    if (dest.has_parent_path()) {
      std::filesystem::create_directories(dest.parent_path());
    }
    const std::filesystem::path tmp = dest.string() + ".tmp";
    {
      std::ofstream out(tmp, std::ios::trunc);
      if (!out) {
        return Result<void>::err("failed to write snapshot temp: " + tmp.string());
      }
      out << arr.dump(2);
    }
    std::filesystem::rename(tmp, dest);
  } catch (const std::exception& ex) {
    return Result<void>::err(std::string("snapshot save failed: ") + ex.what());
  }
  return Result<void>::ok();
}

}  // namespace urs