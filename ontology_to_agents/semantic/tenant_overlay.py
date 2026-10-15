"""Per-tenant overlay: thresholds, extra metric defs, grant overrides (not SKU/channel)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

ROOT = Path(__file__).resolve().parents[1]
TENANTS_DIR = ROOT / "tenants"


def _tenant_dir(tenant: str) -> Path:
    tid = str(tenant).strip()
    if not tid.startswith("org"):
        tid = f"org{tid}"
    return TENANTS_DIR / tid


def _load_overlay(tenant: str) -> dict[str, Any]:
    path = _tenant_dir(tenant) / "overlay.yml"
    if not path.is_file():
        legacy = _tenant_dir(tenant) / f"{tenant.replace('org', 'org')}_metrics.yaml"
        if legacy.is_file():
            data = yaml.safe_load(legacy.read_text(encoding="utf-8")) or {}
            return {
                "thresholds": data.get("metrics") or {},
            }
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


@lru_cache(maxsize=32)
def _overlay_cached(tenant: str) -> dict[str, Any]:
    return _load_overlay(tenant)


def clear_tenant_overlay_cache() -> None:
    _overlay_cached.cache_clear()


def threshold_overlays(tenant: str) -> dict[str, Any]:
    return dict((_overlay_cached(tenant).get("thresholds") or {}))


def grant_overrides(tenant: str) -> dict[str, dict[str, Any]]:
    raw = _overlay_cached(tenant).get("grants") or {}
    return {str(k): dict(v) for k, v in raw.items() if isinstance(v, dict)}


def extra_metric_defs(tenant: str) -> dict[str, Any]:
    return dict((_overlay_cached(tenant).get("metrics") or {}))
