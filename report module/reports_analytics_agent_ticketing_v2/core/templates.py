"""Fill named slots. Dimension expressions load from product/dimensions.yml."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .loader import PRODUCT_DIR

TRUE = "TRUE"


@lru_cache(maxsize=1)
def load_dimensions(product_dir: str | None = None) -> dict[str, Any]:
    root = Path(product_dir) if product_dir else PRODUCT_DIR
    path = root / "dimensions.yml"
    data = yaml.safe_load(path.read_text()) or {}
    dims = data.get("dimensions") or {}
    aliases = {str(k).strip().lower(): str(v).strip().lower() for k, v in (data.get("aliases") or {}).items()}
    exprs = {str(k).strip().lower(): str(card.get("sql") or k) for k, card in dims.items()}
    return {"dimensions": dims, "aliases": aliases, "exprs": exprs}


def dimension_requested(dimension: str | None) -> bool:
    raw = str(dimension or "").strip().lower()
    return raw not in {"", "null", "none"}


def dimension_slots(dimension: str | None, allowed: list | None) -> tuple[str, str]:
    """Certified KPI GROUP BY expressions. Empty when no dimension is requested."""
    if not dimension_requested(dimension):
        return "", ""
    raw = str(dimension).strip().lower()
    spec = load_dimensions()
    dim = spec["aliases"].get(raw, raw)
    allowed_ids = {str(a).strip().lower() for a in (allowed or []) if a}
    allowed_ids = {spec["aliases"].get(a, a) for a in allowed_ids}
    if not allowed_ids or dim not in allowed_ids:
        return "", ""
    expr = spec["exprs"].get(dim)
    if not expr:
        return "", ""
    return f"{expr} AS {dim},", f"GROUP BY {expr} ORDER BY 2 DESC NULLS LAST"


def fill_slots(sql: str, slots: dict[str, str], *, base_ticket: str | None = None) -> str:
    out = sql
    if base_ticket is not None:
        out = out.replace("{{base_ticket}}", base_ticket)
    mapping = {
        "org_id": slots["org_id"],
        "tenant_sql": slots.get("tenant_sql", f"organization_id = {slots['org_id']}"),
        "scope_sql": slots.get("scope_sql", TRUE),
        "time_sql": slots.get("time_sql", TRUE),
        "segment_sql": slots.get("segment_sql", TRUE),
        "filters_sql": slots.get("filters_sql", TRUE),
        "dimension_select": slots.get("dimension_select", ""),
        "group_by_sql": slots.get("group_by_sql", ""),
        "window_days": slots.get("window_days", "1"),
        "window_days_sql": slots.get("window_days_sql", "1"),
        "segment_predicate": slots.get("segment_predicate", slots.get("segment_sql", TRUE)),
        "limit_sql": slots.get("limit_sql", ""),
    }
    for key, value in mapping.items():
        out = out.replace("{{" + key + "}}", value)
    if "{{" in out:
        raise ValueError(f"unfilled SQL slots remain: {out}")
    return out


def load_sql(path: Path) -> str:
    return path.read_text()


def fill_named(text: str, slots: dict[str, str]) -> str:
    out = text
    for key, value in slots.items():
        out = out.replace("{{" + key + "}}", str(value))
    if "{{" in out:
        raise ValueError(f"unfilled slots remain: {out}")
    return out
