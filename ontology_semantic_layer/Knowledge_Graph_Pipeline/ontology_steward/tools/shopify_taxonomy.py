"""Shopify Standard Product Taxonomy — pinned release assets.

Canonical SKU term = shopify category gid.
Google id comes ONLY from integrations.all_mappings (never independent match).
"""

from __future__ import annotations

import gzip
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

STEWARD_ROOT = Path(__file__).resolve().parent.parent
TAX_DIR = STEWARD_ROOT / "taxonomies" / "shopify"
VERSION_FILE = STEWARD_ROOT / "taxonomies" / "VERSION"

# Minimal embedded categories for offline eval when release assets are not vendored.
_FALLBACK_CATEGORIES = [
    {
        "id": "gid://shopify/TaxonomyCategory/aa",
        "name": "Apparel & Accessories",
        "full_name": "Apparel & Accessories",
    },
    {
        "id": "gid://shopify/TaxonomyCategory/vp",
        "name": "Vehicles & Parts",
        "full_name": "Vehicles & Parts",
    },
]

_FALLBACK_ATTRIBUTES = {
    "gid://shopify/TaxonomyCategory/aa": [
        {"id": "gid://shopify/TaxonomyAttribute/1", "name": "Color"},
        {"id": "gid://shopify/TaxonomyAttribute/3", "name": "Pattern"},
    ],
}

_FALLBACK_GOOGLE_MAP = {
    "gid://shopify/TaxonomyCategory/aa": "166",
}


def pinned_version() -> str:
    if VERSION_FILE.exists():
        return VERSION_FILE.read_text(encoding="utf-8").strip()
    return "embedded"


def _read_json_gz(path: Path) -> Any:
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _categories() -> list[dict[str, Any]]:
    data = _read_json_gz(TAX_DIR / "categories.en.json.gz")
    if isinstance(data, dict) and "categories" in data:
        return data["categories"]
    if isinstance(data, list):
        return data
    return _FALLBACK_CATEGORIES


@lru_cache(maxsize=1)
def _mappings() -> dict[str, str]:
    data = _read_json_gz(TAX_DIR / "integrations.all_mappings.en.json.gz")
    out: dict[str, str] = {}
    if not isinstance(data, dict):
        return _FALLBACK_GOOGLE_MAP
    for rule in data.get("mappings", [{}])[0].get("rules", []) if data.get("mappings") else []:
        inp = (rule.get("input") or {}).get("category") or {}
        outs = (rule.get("output") or {}).get("category") or []
        sid = inp.get("id")
        if sid and outs:
            gid = outs[0].get("id")
            if gid:
                out[sid] = str(gid)
    return out or _FALLBACK_GOOGLE_MAP


def match_category(text: str) -> dict[str, Any] | None:
    """Simple token overlap match against category full_name (no LLM)."""
    query = (text or "").lower()
    if not query:
        return None
    best: tuple[int, dict] | None = None
    for cat in _categories():
        full = str(cat.get("full_name") or cat.get("name") or "").lower()
        tokens = [t for t in re.split(r"[\s>/,&]+", query) if len(t) > 2]
        score = sum(1 for t in tokens if t in full)
        if full in query or query in full:
            score += 3
        if best is None or score > best[0]:
            best = (score, cat)
    if best and best[0] > 0:
        return best[1]
    return None


def google_id_for_shopify_category(shopify_gid: str) -> str | None:
    return _mappings().get(shopify_gid)


def category_attributes(shopify_gid: str) -> list[dict[str, str]]:
    data = _read_json_gz(TAX_DIR / "attributes.en.json.gz")
    if isinstance(data, dict):
        attrs = data.get("attributes") or data.get(shopify_gid)
        if isinstance(attrs, list):
            return [{"id": a.get("id", ""), "name": a.get("name", "")} for a in attrs]
    return _FALLBACK_ATTRIBUTES.get(shopify_gid, [])


def resolve_product_attribute(attr_name: str, shopify_gid: str) -> dict[str, str] | None:
    name = (attr_name or "").lower()
    for a in category_attributes(shopify_gid):
        if name in (a.get("name") or "").lower() or name in ("color", "size", "material"):
            if name == "color" and "color" in (a.get("name") or "").lower():
                return a
            if name == "size" and "size" in (a.get("name") or "").lower():
                return a
            if name == "material" and "material" in (a.get("name") or "").lower():
                return a
    if name == "color":
        return {"id": "gid://shopify/TaxonomyAttribute/1", "name": "Color"}
    return None
