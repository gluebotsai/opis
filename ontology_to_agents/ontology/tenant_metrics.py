"""Load per-org metric overlays from tenants/org{id}/overlay.yml (+ legacy org{id}_metrics.yaml)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

PROJECT_DIR = Path(__file__).resolve().parents[1]
TENANTS_DIR = PROJECT_DIR / "tenants"


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def org_metrics_path(tenant_id: str) -> Path:
    """Path to org{id}_metrics.yaml for tenant folder org{id}."""
    return TENANTS_DIR / tenant_id / f"{tenant_id}_metrics.yaml"


def load_org_metrics(tenant_id: str | None) -> dict[str, Any]:
    """Return metrics overlay dict for tenant, or {} if file missing."""
    if not tenant_id:
        return {}
    from semantic.tenant_overlay import extra_metric_defs

    return extra_metric_defs(tenant_id)
