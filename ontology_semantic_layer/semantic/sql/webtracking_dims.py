"""Webtracking dimension aliases and ClickHouse-safe filter helpers."""

from __future__ import annotations

import os
import re
from typing import Any

# Docs / harness prefixes → short column names on marts.
_PREFIX_MAP: dict[str, str] = {
    "web_sessions": "",
    "session": "",
    "page_views": "",
    "page_view": "",
    "interaction_events": "",
    "interaction_event": "",
    "form_events": "",
    "form_event": "",
    "conversion_events": "",
    "conversion": "",
    "product_interactions": "",
    "interaction": "",
}

_DIM_RENAMES: dict[str, str] = {
    "conversion_goal_type": "conversion_type",
}

# Harness / dashboard sometimes send country display names; marts store ISO codes.
_COUNTRY_ALIASES: dict[str, str] = {
    "india": "IN",
    "united states": "US",
    "united states of america": "US",
    "usa": "US",
    "uk": "GB",
    "united kingdom": "GB",
    "great britain": "GB",
    "uae": "AE",
    "united arab emirates": "AE",
}


def normalize_webtracking_dim(name: str) -> str:
    """Map docs-style dim ids to short mart column names."""
    raw = str(name or "").strip()
    if not raw:
        return raw
    if "__" in raw:
        prefix, suffix = raw.split("__", 1)
        if prefix in _PREFIX_MAP:
            raw = suffix
    return _DIM_RENAMES.get(raw, raw)


def normalize_webtracking_dims(names: list[str] | None) -> list[str]:
    return [normalize_webtracking_dim(n) for n in (names or [])]


def normalize_webtracking_filter_value(dimension: str, value: Any) -> Any:
    """Normalize filter values for known webtracking dims (e.g. India → IN)."""
    dim = normalize_webtracking_dim(dimension)
    if dim != "country" or value is None:
        return value
    text = str(value).strip()
    if not text:
        return value
    if len(text) == 2 and text.isalpha():
        return text.upper()
    mapped = _COUNTRY_ALIASES.get(text.lower())
    return mapped if mapped is not None else value


def normalize_webtracking_filters(
    filters: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Normalize dim names and values on user filters."""
    out: list[dict[str, Any]] = []
    for flt in filters or []:
        f2 = dict(flt)
        dim = str(f2.get("dimension") or "")
        if dim:
            f2["dimension"] = normalize_webtracking_dim(dim)
        vals = f2.get("values")
        if vals is not None:
            f2["values"] = [
                normalize_webtracking_filter_value(f2.get("dimension") or dim, v)
                for v in vals
            ]
        elif f2.get("value") is not None:
            f2["value"] = normalize_webtracking_filter_value(
                f2.get("dimension") or dim, f2.get("value")
            )
        out.append(f2)
    return out


def resolve_website_id(prepared: dict[str, Any] | None) -> int | None:
    """website_id from request, filter, or WEBTRACKING_WEBSITE_ID env."""
    prepared = prepared or {}
    for key in ("websiteId", "website_id"):
        val = prepared.get(key)
        if val is not None and str(val).strip() != "":
            try:
                return int(val)
            except (TypeError, ValueError):
                pass
    for flt in prepared.get("user_filters") or []:
        dim = normalize_webtracking_dim(str(flt.get("dimension") or ""))
        if dim == "website_id":
            vals = flt.get("values") or []
            if vals:
                try:
                    return int(vals[0])
                except (TypeError, ValueError):
                    pass
    env = os.environ.get("WEBTRACKING_WEBSITE_ID") or os.environ.get("webtracking_website_id")
    if env and str(env).strip():
        try:
            return int(env)
        except (TypeError, ValueError):
            pass
    return None


_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def assert_safe_ident(name: str) -> str:
    col = normalize_webtracking_dim(name)
    if not _IDENT_RE.match(col):
        raise ValueError(f"Unsafe dimension/column name: {name!r}")
    return col
