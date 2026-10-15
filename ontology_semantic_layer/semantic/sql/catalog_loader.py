"""Load semantic/catalog YAML for SQL agent allowlists."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML required") from exc

CATALOG_DIR = Path(__file__).resolve().parents[1] / "catalog"
_cache: dict[str, dict[str, Any]] = {}


def load_product_catalog(product: str) -> dict[str, Any]:
    from semantic.sql.product_aliases import normalize_sql_catalog_product

    key = normalize_sql_catalog_product(product)
    if key in _cache:
        return _cache[key]
    path = CATALOG_DIR / f"{key}.yaml"
    if not path.is_file():
        raise ValueError(f"No SQL catalog for product '{product}'")
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    _cache[key] = data
    return data


def get_table(product: str, table_name: str) -> dict[str, Any]:
    cat = load_product_catalog(product)
    for tbl in cat.get("tables") or []:
        if tbl.get("name") == table_name:
            return tbl
    raise ValueError(f"Table '{table_name}' not in catalog for {product}")


def allowed_columns(table: dict[str, Any]) -> set[str]:
    cols: set[str] = set()
    for c in table.get("columns") or []:
        if isinstance(c, dict):
            cols.add(str(c.get("name")))
        else:
            cols.add(str(c))
    for d in table.get("semantic_dimensions") or []:
        cols.add(str(d))
    return {c for c in cols if c}


def table_has_column(product: str, table_name: str, column: str) -> bool:
    """True when the catalog table exposes column (physical or semantic dimension)."""
    if not table_name or not column:
        return False
    try:
        tbl = get_table(product, table_name)
    except ValueError:
        return False
    return column in allowed_columns(tbl)


def expand_entitled_channel_literals(channels: list[str]) -> list[str]:
    """Map entitlement terms to mart literals (call↔voice, web_chat↔webchat)."""
    out: set[str] = set()
    for ch in channels:
        low = str(ch).lower()
        out.add(low)
        if low == "call":
            out.add("voice")
        elif low == "voice":
            out.add("call")
        elif low in ("web_chat", "webchat"):
            out.update({"webchat", "web_chat"})
    return sorted(out)


def resolve_channel_filter(
    product: str,
    table_name: str,
    *,
    channel_scoped: bool,
    channels: list[str],
    channel_column: str = "channel",
) -> tuple[list[str], str | None]:
    """Do not apply entitlement channel filters. Instruction channel filters still apply."""
    return [], None
