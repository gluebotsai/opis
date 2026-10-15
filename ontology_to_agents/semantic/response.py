"""Shape API success payloads: rows + status + threshold."""

from __future__ import annotations

from typing import Any

from semantic.thresholds import build_interpretation


def shape_client_response(
    rows: list[dict],
    *,
    metric_ids: list[str] | None = None,
    organization_id: int | None = None,
) -> dict[str, Any]:
    """Return client-facing body without sql/scope/timing."""
    if not metric_ids or organization_id is None:
        return {
            "rows": rows,
            "status": "not_applicable",
            "threshold": None,
        }

    interp = build_interpretation(metric_ids, rows, organization_id)
    if len(metric_ids) == 1:
        mid = metric_ids[0]
        row = interp[mid]
        return {
            "rows": rows,
            "status": row["status"],
            "threshold": row["threshold"],
        }

    return {
        "rows": rows,
        "status": {mid: interp[mid]["status"] for mid in metric_ids},
        "threshold": {mid: interp[mid]["threshold"] for mid in metric_ids},
    }
