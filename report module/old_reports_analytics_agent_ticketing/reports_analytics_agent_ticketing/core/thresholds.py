"""Compare a KPI value to tenant thresholds. No invented bands in Python."""

from __future__ import annotations

from typing import Any, Literal

Level = Literal["ok", "warning", "critical"]


def evaluate(spec: dict[str, Any] | None, value: float | None, *, segment: str | None = None) -> Level:
    if spec is None or value is None:
        return "ok"
    band = spec
    if segment and isinstance(spec.get("by_segment"), dict):
        band = spec["by_segment"].get(segment) or spec
    if "critical_below" in band and value < float(band["critical_below"]):
        return "critical"
    if "critical_above" in band and value > float(band["critical_above"]):
        return "critical"
    if "warn_below" in band and value < float(band["warn_below"]):
        return "warning"
    if "warn_above" in band and value > float(band["warn_above"]):
        return "warning"
    return "ok"
