"""Platform + org metric thresholds and status evaluation on query results."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

from semantic.tenant_overlay import threshold_overlays

SEMANTIC_DIR = Path(__file__).resolve().parent
THRESHOLDS_PATH = SEMANTIC_DIR / "metric_thresholds.yml"

_cache: dict[str, Any] | None = None


def _load_platform() -> dict[str, Any]:
    global _cache
    if _cache is None:
        with THRESHOLDS_PATH.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        _cache = data.get("metrics") or {}
    return _cache


def clear_thresholds_cache() -> None:
    """Drop cached metric_thresholds.yml (reload on next merge_threshold)."""
    global _cache
    _cache = None


def warm_thresholds_cache() -> None:
    """Load metric_thresholds.yml into memory (API startup)."""
    _load_platform()


def get_platform_threshold_row(metric_id: str) -> dict[str, Any]:
    platform = _load_platform()
    row = platform.get(metric_id)
    if row is None:
        from semantic.lookup import resolve_metric_alias

        alias = resolve_metric_alias(metric_id)
        if alias != metric_id:
            row = platform.get(alias)
    if row is None:
        raise ValueError(f"No platform threshold row for metric '{metric_id}'")
    return dict(row)


def merge_threshold(metric_id: str, organization_id: int | None = None) -> dict[str, Any]:
    """Platform defaults merged with org overlay (org wins on threshold key only)."""
    platform = get_platform_threshold_row(metric_id)
    merged = {
        "kind": platform.get("kind"),
        "direction": platform.get("direction"),
        "unit": platform.get("unit"),
        "source": platform.get("source"),
        "threshold": platform.get("threshold"),
    }
    if organization_id is not None:
        tenant = f"org{organization_id}"
        org_row = threshold_overlays(tenant).get(metric_id) or {}
        if org_row.get("threshold") is not None:
            merged["threshold"] = org_row["threshold"]
            merged["source"] = f"org overlay ({tenant})"
    return merged


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _percent_value(value: float, unit: str | None) -> float:
    """Normalize ratio 0-1 to percent when unit is ratio."""
    if unit == "ratio" and 0 <= value <= 1:
        return value * 100.0
    return value


def evaluate_status(value: float | None, threshold: dict[str, Any] | None, direction: str | None, unit: str | None) -> str:
    if value is None:
        return "unknown"
    if not threshold:
        return "not_applicable"

    v = _percent_value(value, unit)

    # Lower is worse (scores, floor rates)
    if "critical_lt" in threshold:
        crit = float(threshold["critical_lt"])
        if v <= crit:
            return "critical"
    if "warn_lt" in threshold:
        warn = float(threshold["warn_lt"])
        if v <= warn:
            return "warn"

    if "critical_lt_percent" in threshold:
        if v <= float(threshold["critical_lt_percent"]):
            return "critical"
    if "warn_lt_percent" in threshold:
        if v <= float(threshold["warn_lt_percent"]):
            return "warn"

    # Higher is worse
    if "critical" in threshold:
        if v >= float(threshold["critical"]):
            return "critical"
    if "warn" in threshold:
        if v >= float(threshold["warn"]):
            return "warn"

    if "critical_percent" in threshold:
        if v >= float(threshold["critical_percent"]):
            return "critical"
    if "warn_percent" in threshold:
        if v >= float(threshold["warn_percent"]):
            return "warn"

    # higher_is_better with only lt keys already handled; if direction says higher is better
    # and we had warn_lt_percent, values above warn are ok
    return "ok"


def _extract_metric_value(
    rows: list[dict],
    metric_id: str,
    *,
    kind: str | None = None,
    unit: str | None = None,
) -> float | None:
    if not rows:
        return None
    values: list[float] = []
    for row in rows:
        if metric_id in row:
            fv = _to_float(row[metric_id])
            if fv is not None:
                values.append(fv)
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    # Multi-row series: summing rates/ratios is meaningless (e.g. daily rates).
    if kind in ("rate", "ratio") or unit == "ratio":
        return None
    return sum(values)


def build_interpretation(
    metric_ids: list[str],
    rows: list[dict],
    organization_id: int,
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for mid in metric_ids:
        merged = merge_threshold(mid, organization_id)
        value = _extract_metric_value(
            rows,
            mid,
            kind=merged.get("kind"),
            unit=merged.get("unit"),
        )
        th = merged.get("threshold")
        status = evaluate_status(
            value,
            th if isinstance(th, dict) else None,
            merged.get("direction"),
            merged.get("unit"),
        )
        out[mid] = {
            "value": value,
            "kind": merged.get("kind"),
            "unit": merged.get("unit"),
            "direction": merged.get("direction"),
            "threshold": th,
            "status": status,
            "source": merged.get("source"),
        }
    return out


def list_missing_platform_rows(registry_metric_ids: list[str]) -> list[str]:
    platform = _load_platform()
    return sorted(set(registry_metric_ids) - set(platform.keys()))
