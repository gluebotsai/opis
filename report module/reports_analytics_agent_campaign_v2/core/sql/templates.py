"""Fill certified KPI templates. Dimensions come from product/dimensions.yml."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from ..loader import PRODUCT_DIR

TRUE = "TRUE"


@lru_cache(maxsize=4)
def _dimensions(product_dir: str) -> dict[str, Any]:
    path = Path(product_dir) / "dimensions.yml"
    data = yaml.safe_load(path.read_text()) or {}
    return data if isinstance(data, dict) else {}


def alias_dimension(raw: str | None, product_dir: Path = PRODUCT_DIR) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if text in {"", "null", "none"}:
        return None
    doc = _dimensions(str(product_dir))
    aliases = {str(k).lower(): str(v).lower() for k, v in (doc.get("aliases") or {}).items()}
    return aliases.get(text, text)


def _expr_for(dim_id: str, grain: str | None, product_dir: Path) -> str | None:
    dims = (_dimensions(str(product_dir)).get("dimensions") or {})
    spec = dims.get(dim_id) or {}
    exprs = spec.get("sql_expr") or {}
    if grain and grain in exprs:
        return str(exprs[grain])
    if "default" in exprs:
        return str(exprs["default"])
    return None


def dimension_slots(
    dimensions: list[str] | str | None,
    allowed: list | None,
    *,
    grain: str | None = None,
    product_dir: Path = PRODUCT_DIR,
) -> tuple[str, str, str]:
    if not dimensions:
        return "", "", ""
    raw_list = [dimensions] if isinstance(dimensions, str) else list(dimensions)
    raw_list = [d for d in raw_list if d]
    if not raw_list:
        return "", "", ""
    if len(raw_list) > 2:
        raise ValueError("unknown dimension: at most two group-by dimensions are supported")
    allowed_ids = {str(a).strip().lower() for a in (allowed or []) if a}
    selects: list[str] = []
    groups: list[str] = []
    for raw in raw_list:
        dim = alias_dimension(raw, product_dir)
        if not dim:
            continue
        if allowed_ids and dim not in allowed_ids:
            raise ValueError(
                f"unknown dimension: '{raw}' is not allowed on this KPI. "
                f"Allowed: {sorted(allowed_ids)}"
            )
        expr = _expr_for(dim, grain, product_dir)
        if not expr:
            raise ValueError(
                f"unknown dimension: '{raw}' (resolved '{dim}') has no SQL expression for grain '{grain}'."
            )
        selects.append(f"{expr} AS {dim}")
        groups.append(expr)
    if not selects:
        return "", "", ""
    select_sql = ", ".join(selects) + ","
    group_sql = "GROUP BY " + ", ".join(groups) + " ORDER BY 2 DESC NULLS LAST"
    tail = ", " + ", ".join(groups)
    return select_sql, group_sql, tail


def fill_slots(sql: str, slots: dict[str, str], *, base_campaign: str | None = None) -> str:
    out = sql
    if base_campaign is not None:
        out = out.replace("{{base_campaign}}", base_campaign)
    mapping = {
        "org_id": slots["org_id"],
        "branch_id": slots.get("branch_id", "0"),
        "user_id": slots.get("user_id", "0"),
        "tenant_sql": slots.get("tenant_sql", f"organization_id = {slots['org_id']}"),
        "scope_sql": slots.get("scope_sql", TRUE),
        "time_sql": slots.get("time_sql", TRUE),
        "segment_sql": slots.get("segment_sql", TRUE),
        "filters_sql": slots.get("filters_sql", TRUE),
        "ppc_exclude_sql": slots.get("ppc_exclude_sql", TRUE),
        "dimension_select": slots.get("dimension_select", ""),
        "group_by_sql": slots.get("group_by_sql", ""),
        "group_by_tail": slots.get("group_by_tail", ""),
        "channel_join": slots.get("channel_join", ""),
        "limit_sql": slots.get("limit_sql", ""),
        "start_date": slots.get("start_date", "1970-01-01"),
        "end_date": slots.get("end_date", "9999-12-31"),
    }
    for key, value in mapping.items():
        out = out.replace("{{" + key + "}}", value)
    if "{{" in out:
        raise ValueError(f"unfilled SQL slots remain: {out}")
    return out
