"""Deterministic layout merge, cover normalize, catalog prices, content template."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

NUMERIC_LAYOUT_KEYS = (
    "brand_font_pt",
    "title_font_pt",
    "prepared_font_pt",
    "date_font_pt",
    "heading_font_pt",
    "body_font_pt",
    "table_font_pt",
    "space_after_brand_pt",
    "space_after_title_pt",
    "space_after_prepared_pt",
    "space_after_date_pt",
    "space_after_tags_pt",
    "space_before_heading_pt",
    "space_after_heading_pt",
    "body_line_gap_pt",
    "list_indent_pt",
    "paragraph_gap_pt",
)

ALIGN_LAYOUT_KEYS = (
    "cover_align",
    "brand_align",
    "title_align",
    "prepared_align",
    "date_align",
    "tags_layout",
    "tags_align",
    "heading_align",
    "body_align",
)

_GAP_CAPS = {
    "space_after_heading_pt": 16,
    "space_before_heading_pt": 36,
    "paragraph_gap_pt": 22,
}

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_MONEY_RE = re.compile(
    r"(?:₹|rs\.?|inr|usd|\$)\s*[\d,]+(?:\.\d+)?|\b[\d,]+\.\d{2}\b",
    re.I,
)
_GOLD_META_LABELS = {
    "client",
    "document",
    "validity",
    "prepared for",
    "prepared by",
    "date",
    "quotation validity",
    "document title",
    "customer",
    "vendor",
}
_BRD_META_LABELS = {
    "client name",
    "industry",
    "website",
    "lead source",
    "objectives",
    "pain points",
    "channels",
    "languages",
    "integrations",
    "overview",
}
_INTERNAL_DOC_META_LABELS = {
    "document owner",
    "document classification",
    "classification",
    "version",
    "effective date",
    "review cycle",
    "organization",
    "products covered",
    "primary audience",
    "confidentiality",
}


def _label_key(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (label or "").strip().lower()).strip()


def is_brd_cover_meta(rows: list[Any] | None) -> bool:
    """True when the cover table is a BRD dump, not gold Client/Document/Validity."""
    keys = {
        _label_key(str(row.get("label") or ""))
        for row in (rows or [])
        if isinstance(row, dict)
    }
    keys.discard("")
    if not keys:
        return False
    return bool(keys & _BRD_META_LABELS) and not (keys & _GOLD_META_LABELS)


def is_internal_doc_cover_meta(rows: list[Any] | None) -> bool:
    """True when the cover table is product-knowledge chrome, not Client/Document/Validity."""
    keys = {
        _label_key(str(row.get("label") or ""))
        for row in (rows or [])
        if isinstance(row, dict)
    }
    keys.discard("")
    if not keys:
        return False
    return bool(keys & _INTERNAL_DOC_META_LABELS) and not (keys & _GOLD_META_LABELS)


_DOCUMENT_TYPE_TITLE_RE = re.compile(
    r"proposal|quotation|\bquote\b|commercial",
    re.I,
)
_GENERIC_COVER_TITLE_RE = re.compile(
    r"^(commercial\s+proposal(?:\s*&\s*quotation)?|quotation|quote)\s*$",
    re.I,
)


def is_document_type_title(title: str | None) -> bool:
    """True when the cover H1 is the document type (Commercial Proposal), not a SKU list."""
    text = str(title or "").strip()
    if not text or len(text) > 80:
        return False
    return bool(_DOCUMENT_TYPE_TITLE_RE.search(text))


def is_generic_cover_title(title: str | None) -> bool:
    """True for frozen document-type phrases that must not be the generated H1."""
    return bool(_GENERIC_COVER_TITLE_RE.match(str(title or "").strip()))


def _meta_value_token(label: str, gold_value: str) -> str:
    key = _label_key(label)
    if key in {"client", "prepared for", "customer", "client name"}:
        return "{{customerName}}"
    if key in {"document", "document title"}:
        return gold_value if is_document_type_title(gold_value) else "{{documentTitle}}"
    if key == "date":
        return "{{date}}"
    if key in {"prepared by", "vendor", "from"}:
        return "{{vendorName}}"
    return gold_value


def skeleton_cover_from_gold(
    gold_cover: dict[str, Any] | None,
    template: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Cover slots for a frozen skeleton: gold structure, this-deal tokens."""
    gold = dict(gold_cover or {}) if isinstance(gold_cover, dict) else {}
    tmpl_cover = (
        (template or {}).get("cover")
        if isinstance((template or {}).get("cover"), dict)
        else {}
    )
    title = str(gold.get("title") or tmpl_cover.get("title") or "").strip()
    cover_title = title if is_document_type_title(title) else "{{documentTitle}}"
    meta_rows: list[dict[str, str]] = []
    for row in gold.get("meta_rows") or []:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "").strip()
        if not label:
            continue
        meta_rows.append(
            {
                "label": label,
                "value": _meta_value_token(label, str(row.get("value") or "")),
            }
        )
    tag_layout = str(
        gold.get("tag_layout")
        or tmpl_cover.get("tag_layout")
        or "centered_wrap"
    )
    gold_tags = [
        str(t).strip()
        for t in (gold.get("product_tags") or [])
        if str(t).strip()
    ]
    return {
        "brand": "{{vendorName}}",
        "title": cover_title or "Commercial Proposal",
        "prepared_for": "Prepared for {{customerName}}",
        "date": "{{date}}",
        "tag_layout": tag_layout,
        "product_tags": [],
        "has_tag_slot": bool(gold_tags),
        "meta_rows": meta_rows,
        "brand_align": gold.get("brand_align") or tmpl_cover.get("brand_align") or "center",
        "cover_align": gold.get("cover_align")
        or tmpl_cover.get("cover_align")
        or gold.get("title_align")
        or gold.get("brand_align")
        or "center",
    }


def preferred_cover_meta(
    cover_rows: list[Any] | None,
    parser_rows: list[Any] | None,
) -> list[dict[str, Any]]:
    parser = [
        row
        for row in (parser_rows or [])
        if isinstance(row, dict) and (row.get("label") or row.get("value"))
    ]
    if parser:
        return list(parser)
    cover = [
        row
        for row in (cover_rows or [])
        if isinstance(row, dict) and (row.get("label") or row.get("value"))
    ]
    if is_brd_cover_meta(cover) or is_internal_doc_cover_meta(cover):
        return []
    return cover


def merge_layout(parser: dict[str, Any] | None, llm: dict[str, Any] | None) -> dict[str, Any]:
    """Parser measurements win on non-zero numbers and detected alignments."""
    merged = dict(llm or {})
    parser = parser or {}
    for key in NUMERIC_LAYOUT_KEYS:
        val = parser.get(key)
        if isinstance(val, (int, float)) and float(val) > 0:
            merged[key] = float(val)
    for key in ALIGN_LAYOUT_KEYS:
        if parser.get(key):
            merged[key] = parser[key]
    if "has_cover_meta_table" in parser:
        merged["has_cover_meta_table"] = bool(parser["has_cover_meta_table"])
    if "prepared_bold" in parser:
        merged["prepared_bold"] = bool(parser["prepared_bold"])
    if parser.get("meta_rows"):
        merged["meta_rows"] = parser["meta_rows"]
    if parser.get("tag_color"):
        merged["tag_color"] = parser["tag_color"]
    if parser.get("cover_rule"):
        merged["cover_rule"] = True
        if parser.get("cover_rule_color"):
            merged["cover_rule_color"] = parser["cover_rule_color"]
    if "prepared_has_label" in parser:
        merged["prepared_has_label"] = bool(parser["prepared_has_label"])
    for key, cap in _GAP_CAPS.items():
        val = merged.get(key)
        if isinstance(val, (int, float)) and float(val) > cap:
            merged[key] = float(cap)
    return merged


def apply_layout_to_tokens(
    tokens: dict[str, Any] | None, layout: dict[str, Any] | None
) -> dict[str, Any]:
    out = dict(tokens or {})
    fonts = dict(out.get("fonts") or {})

    def set_size(role: str, layout_key: str) -> None:
        role_d = dict(fonts.get(role) or {})
        if layout and layout.get(layout_key):
            role_d["size"] = layout[layout_key]
        fonts[role] = role_d

    layout = layout or {}
    set_size("brand", "brand_font_pt")
    set_size("title", "title_font_pt")
    set_size("h1", "heading_font_pt")
    set_size("h2", "heading_font_pt")
    set_size("body", "body_font_pt")
    set_size("table_header", "table_font_pt")
    set_size("table_cell", "table_font_pt")
    out["fonts"] = fonts
    out["layout"] = layout
    return out


def normalize_cover(
    cover: dict[str, Any] | None, layout: dict[str, Any] | None
) -> dict[str, Any]:
    cover = dict(cover or {})
    layout = layout or {}
    title = (cover.get("title") or "").strip()
    subtitle = (cover.get("subtitle") or "").strip()
    brand = (cover.get("brand") or "").strip()
    if title and brand and title.upper() == brand.upper() and subtitle:
        cover["title"] = subtitle
        cover["subtitle"] = ""
        title = subtitle
        subtitle = ""
    if not title and subtitle:
        cover["title"] = subtitle
        cover["subtitle"] = ""
        title = subtitle
    if not cover.get("title"):
        cover["title"] = "Commercial Proposal"
    cover["tag_layout"] = (
        cover.get("tag_layout") or layout.get("tags_layout") or "centered_wrap"
    )
    cover["brand_align"] = cover.get("brand_align") or layout.get("brand_align") or "center"
    cover["cover_align"] = (
        cover.get("cover_align")
        or layout.get("cover_align")
        or layout.get("title_align")
        or cover.get("brand_align")
        or "center"
    )
    cover["meta_rows"] = preferred_cover_meta(
        cover.get("meta_rows"),
        layout.get("meta_rows"),
    )
    return cover


def apply_frozen_cover(
    cover: dict[str, Any] | None,
    frozen_cover: dict[str, Any] | None,
    brd: dict[str, Any] | None,
    *,
    vendor_name: str = "",
    content_template: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fill current-client slots into the gold cover structure. Same as the lab."""
    cover = dict(cover or {})
    frozen_cover = frozen_cover or {}
    brd = brd or {}
    tmpl_cover = (
        (content_template or {}).get("cover")
        if isinstance((content_template or {}).get("cover"), dict)
        else {}
    )
    client = str((brd.get("client") or {}).get("name") or "").strip()
    llm_title = str(cover.get("title") or "").strip()
    brand = str(
        frozen_cover.get("brand") or cover.get("brand") or ""
    ).strip()
    if frozen_cover.get("brand"):
        cover["brand"] = frozen_cover["brand"]
    if is_generic_cover_title(llm_title) or (
        llm_title and brand and llm_title.upper() == brand.upper()
    ):
        llm_title = ""
    cover["title"] = llm_title
    if not cover.get("date"):
        cover["date"] = datetime.now(timezone.utc).strftime("%d %B %Y").lstrip("0")
    cover["tag_layout"] = (
        frozen_cover.get("tag_layout")
        or (frozen_cover.get("layout") or {}).get("tags_layout")
        or tmpl_cover.get("tag_layout")
        or cover.get("tag_layout")
        or "centered_wrap"
    )
    cover["brand_align"] = frozen_cover.get("brand_align") or cover.get("brand_align") or "center"
    cover["cover_align"] = frozen_cover.get("cover_align") or cover.get("cover_align") or frozen_cover.get("brand_align") or "center"
    frozen_meta = [
        row
        for row in (frozen_cover.get("meta_rows") or [])
        if isinstance(row, dict) and str(row.get("label") or "").strip()
    ]
    if not frozen_meta:
        labels = tmpl_cover.get("meta_row_labels") or []
        frozen_meta = [
            {"label": str(lab), "value": ""}
            for lab in labels
            if str(lab).strip()
        ]
    new_meta = cover.get("meta_rows") or []
    layout = (
        frozen_cover.get("layout")
        if isinstance(frozen_cover.get("layout"), dict)
        else {}
    )
    skip_meta = (
        layout.get("has_cover_meta_table") is False
        or is_internal_doc_cover_meta(frozen_meta)
        or is_brd_cover_meta(frozen_meta)
    )
    if skip_meta:
        cover["meta_rows"] = []
    elif frozen_meta:
        by_lab = {
            _label_key(str(r.get("label") or "")): r
            for r in new_meta
            if isinstance(r, dict)
        }
        merged = []
        for fr in frozen_meta:
            lab = str(fr.get("label") or "")
            key = _label_key(lab)
            hit = by_lab.get(key) or {}
            val = str(hit.get("value") or "").strip()
            if not val:
                if key in {"client", "prepared for", "customer"}:
                    val = client
                elif key in {"document", "document title"}:
                    val = str(cover.get("title") or "")
                elif key == "date":
                    val = str(cover.get("date") or "")
                elif key in {"prepared by", "vendor"}:
                    val = vendor_name or str(cover.get("brand") or "")
                else:
                    val = str(fr.get("value") or "")
            merged.append({"label": lab, "value": val})
        cover["meta_rows"] = merged
    elif is_brd_cover_meta(new_meta):
        cover["meta_rows"] = []
    if client:
        cover["prepared_for"] = f"Prepared for {client}"
    return cover


def select_cover_product_tags(
    incoming: list[Any] | None,
    *,
    allowed_names: list[str],
    gold_tags: list[Any] | None = None,
) -> list[str]:
    """Use this draft's chips only. Never copy gold cover tags or dump the catalog."""
    del gold_tags
    del allowed_names
    return [
        str(t).strip()
        for t in (incoming or [])
        if str(t).strip()
    ][:6]


def _slug(text: str, fallback: str) -> str:
    raw = _SLUG_RE.sub("_", (text or "").strip().lower()).strip("_")
    return raw[:48] or fallback


def _table_comparison_kind(table: dict[str, Any] | None) -> str:
    """narrative vs spec_rows, grounded in the gold instance's own table
    structure — not an LLM guess. A genuine side-by-side comparison matrix
    has >=2 columns and >=2 data rows; anything thinner (a one-row divider,
    a single label column) is closer to narrative content than a real grid."""
    if not isinstance(table, dict):
        return "narrative"
    headers = table.get("headers") if isinstance(table.get("headers"), list) else []
    rows = table.get("rows") if isinstance(table.get("rows"), list) else []
    if len(headers) >= 2 and len(rows) >= 2:
        return "spec_rows"
    return "narrative"


def infer_content_template(instances: list[dict[str, Any]]) -> dict[str, Any]:
    """Infer a content template from gold proposal instance(s). No prices."""
    sections: list[dict[str, Any]] = []
    table_types: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    seen_tables: set[str] = set()
    cover_template: dict[str, Any] = {
        "title": "Commercial Proposal",
        "tag_layout": "centered_wrap",
        "meta_row_labels": [],
    }
    for inst in instances:
        if not isinstance(inst, dict):
            continue
        gold_cover = inst.get("cover") if isinstance(inst.get("cover"), dict) else {}
        if gold_cover and not cover_template.get("meta_row_labels"):
            labels = [
                str(r.get("label") or "").strip()
                for r in (gold_cover.get("meta_rows") or [])
                if isinstance(r, dict) and str(r.get("label") or "").strip()
            ]
            cover_template = {
                "title": gold_cover.get("title") or cover_template["title"],
                "tag_layout": gold_cover.get("tag_layout") or cover_template["tag_layout"],
                "brand_align": gold_cover.get("brand_align") or "center",
                "cover_align": gold_cover.get("cover_align")
                or gold_cover.get("brand_align")
                or "center",
                "meta_row_labels": labels,
            }
        for i, sec in enumerate(inst.get("sections") or []):
            if not isinstance(sec, dict):
                continue
            heading = str(sec.get("heading") or "").strip()
            key = _slug(str(sec.get("id") or heading), f"section_{i + 1}")
            if key in seen_keys:
                continue
            seen_keys.add(key)
            kind = str(sec.get("kind") or "prose")
            table_id = ""
            for block in sec.get("blocks") or []:
                if isinstance(block, dict) and block.get("table_id"):
                    table_id = str(block.get("table_id") or "")
                    break
            sections.append(
                {
                    "id": key,
                    "key": key,
                    "title": heading or key.replace("_", " ").title(),
                    "heading_pattern": heading,
                    "kind": kind if kind in {"prose", "bullets", "table", "mixed"} else "prose",
                    "required": True,
                    "table_id": table_id,
                    "intent": f"Write {heading or key} for this customer.",
                    "tone": "formal",
                    "contentPattern": "medium",
                    **(
                        {
                            "tableSpec": {
                                "shape": "grid",
                                "columns": [],
                                # Refined below once the matching table (if
                                # any) is resolved; "table" kind with no
                                # linked table yet is provisionally spec_rows,
                                # "mixed" (prose + maybe a table) starts
                                # narrative until proven otherwise.
                                "comparisonKind": "spec_rows" if kind == "table" else "narrative",
                            }
                        }
                        if kind in {"table", "mixed"} or table_id
                        else {}
                    ),
                }
            )
        for table in inst.get("tables") or []:
            if not isinstance(table, dict):
                continue
            tid = str(table.get("id") or "").strip()
            if not tid or tid in seen_tables:
                continue
            seen_tables.add(tid)
            headers = [
                str(h).strip()
                for h in (table.get("headers") or [])
                if str(h).strip()
            ]
            table_types.append(
                {
                    "id": tid,
                    "title_pattern": str(table.get("title") or ""),
                    "headers": headers,
                    "emphasize_last_col": bool(table.get("emphasize_last_col")),
                }
            )
            for sec in sections:
                if sec.get("table_id") == tid and headers:
                    spec = dict(sec.get("tableSpec") or {"shape": "grid"})
                    spec["columns"] = headers
                    spec["comparisonKind"] = _table_comparison_kind(table)
                    sec["tableSpec"] = spec
    return {
        "sections": sections,
        "table_types": table_types,
        "boilerplate": [],
        "slots": ["vendorName", "customerName", "date", "dealTitle"],
        "commercial_flags": {"has_price_table": bool(table_types)},
        "cover": cover_template,
    }


def _catalog_index(products: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_id: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    for product in products:
        if not isinstance(product, dict):
            continue
        pid = str(product.get("id") or "").strip()
        name = str(product.get("name") or "").strip()
        sku = str(product.get("sku") or "").strip()
        if pid:
            by_id[pid] = product
        if name:
            by_name[name.lower()] = product
        if sku:
            by_name[sku.lower()] = product
    return by_id, by_name


_CCAAS_NEEDLES = (
    "lola",
    "voicebot",
    "chatbot",
    "voice bot",
    "chat bot",
    "contact centre",
    "contact center",
    "contact cent",
    "ccaas",
)


def _catalog_blob(product: dict[str, Any]) -> str:
    return " ".join(
        str(product.get(key) or "")
        for key in ("name", "tagline", "description", "category", "sku")
    ).lower()


def _mentions_ccaas(text: str) -> bool:
    hay = text.lower()
    return any(needle in hay for needle in _CCAAS_NEEDLES)


def _match_catalog_product(
    sku_name: str,
    products: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    by_name: dict[str, dict[str, Any]],
    product_id: str = "",
) -> dict[str, Any] | None:
    hit = by_id.get((product_id or "").strip()) or by_name.get(sku_name.strip().lower())
    if hit:
        return hit
    needle = sku_name.strip().lower()
    if len(needle) < 4:
        return None
    for product in products:
        if not isinstance(product, dict):
            continue
        name = str(product.get("name") or "").strip().lower()
        if not name:
            continue
        if needle in name or name in needle:
            return product
    if _mentions_ccaas(needle):
        ccaas = [
            product
            for product in products
            if isinstance(product, dict) and _mentions_ccaas(_catalog_blob(product))
        ]
        for product in ccaas:
            blob = _catalog_blob(product)
            if "contact cent" in blob or "ccaas" in blob:
                return product
        if ccaas:
            return ccaas[0]
    return None


def _format_price(product: dict[str, Any]) -> str:
    price = product.get("price")
    if price is None or price == "":
        return ""
    currency = str(product.get("currency") or "").strip()
    if currency:
        return f"{currency} {price}"
    return str(price)


def apply_catalog_prices(
    price_lines: list[dict[str, Any]],
    products: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fill unit_price from inventory.products only. Never invent amounts."""
    by_id, by_name = _catalog_index(products)
    out: list[dict[str, Any]] = []
    for line in price_lines:
        if not isinstance(line, dict):
            continue
        row = dict(line)
        sku = str(row.get("sku_name") or "").strip()
        match = _match_catalog_product(
            sku,
            products,
            by_id,
            by_name,
            str(row.get("product_id") or ""),
        )
        if not match:
            row["unit_price"] = ""
            row["requested_amount"] = ""
            row["recommended_amount"] = ""
            out.append(row)
            continue
        catalog_price = _format_price(match)
        if not catalog_price:
            row["unit_price"] = ""
            row["requested_amount"] = ""
            row["recommended_amount"] = ""
        else:
            row["unit_price"] = catalog_price
            qty_raw = str(row.get("qty") or "1").replace(",", "").strip()
            try:
                qty = float(qty_raw) if qty_raw else 1.0
            except ValueError:
                qty = 1.0
            try:
                unit = float(str(match.get("price")))
                amount = f"{unit * qty:g}"
                currency = str(match.get("currency") or "").strip()
                row["recommended_amount"] = f"{currency} {amount}".strip()
            except (TypeError, ValueError):
                row["recommended_amount"] = catalog_price
        out.append(row)
    return out


def scrub_invented_prices(
    tables: list[dict[str, Any]],
    products: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Drop monetary cells that are not a catalog product price."""
    known: set[str] = set()
    for product in products:
        if not isinstance(product, dict):
            continue
        formatted = _format_price(product)
        if formatted:
            known.add(formatted.lower().replace(" ", ""))
            known.add(str(product.get("price")).lower().replace(" ", ""))
    cleaned: list[dict[str, Any]] = []
    for table in tables:
        if not isinstance(table, dict):
            continue
        rows_out: list[list[str]] = []
        for row in table.get("rows") or []:
            if not isinstance(row, list):
                continue
            cells: list[str] = []
            for cell in row:
                text = str(cell)
                if _MONEY_RE.search(text):
                    compact = re.sub(r"[\s,]", "", text).lower()
                    if not any(k and k in compact for k in known):
                        text = _MONEY_RE.sub("", text).strip()
                cells.append(text)
            rows_out.append(cells)
        cleaned.append({**table, "rows": rows_out})
    return cleaned


def clamp_requested_solutions(
    brd: dict[str, Any],
    products: list[dict[str, Any]],
    allowed_names: list[str] | None = None,
) -> dict[str, Any]:
    """Keep requested solutions on catalog / allowed names. Seed from catalog if empty."""
    by_id, by_name = _catalog_index(products)
    extras = [str(n).strip() for n in (allowed_names or []) if str(n).strip()]
    sols_in = (
        brd.get("requested_solutions")
        if isinstance(brd.get("requested_solutions"), list)
        else []
    )
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(name: str, extra: dict[str, Any] | None = None) -> None:
        key = name.strip().lower()
        if not name.strip() or key in seen:
            return
        seen.add(key)
        row = dict(extra or {})
        row["name"] = name.strip()
        out.append(row)

    for sol in sols_in:
        if not isinstance(sol, dict):
            continue
        name = str(sol.get("name") or "").strip()
        match = _match_catalog_product(name, products, by_id, by_name)
        if match:
            _add(str(match.get("name") or name), sol)
            continue
        hit = next(
            (
                extra
                for extra in extras
                if extra.lower() == name.lower()
                or (
                    len(name) >= 4
                    and (
                        extra.lower() in name.lower() or name.lower() in extra.lower()
                    )
                )
            ),
            None,
        )
        if hit:
            _add(hit, sol)

    if not out:
        for product in products:
            if not isinstance(product, dict):
                continue
            name = str(product.get("name") or "").strip()
            details = str(
                product.get("description") or product.get("tagline") or ""
            ).strip()
            _add(name, {"details": details, "quantities": {}})
        for extra in extras:
            _add(extra, {"details": "", "quantities": {}})

    return {**brd, "requested_solutions": out}


def seed_price_lines_from_catalog(
    lines: list[dict[str, Any]],
    products: list[dict[str, Any]],
    brd: dict[str, Any] | None = None,
    quote_lines: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Ensure every catalog product has a price line. Qty from BRD/quote when present."""
    filled = apply_catalog_prices(lines, products)
    have = {
        str(row.get("sku_name") or "").strip().lower()
        for row in filled
        if str(row.get("sku_name") or "").strip()
    }
    qty_by_name: dict[str, str] = {}
    qty_by_id: dict[str, str] = {}
    for sol in (brd or {}).get("requested_solutions") or []:
        if not isinstance(sol, dict):
            continue
        name = str(sol.get("name") or "").strip()
        if not name:
            continue
        qty = "1"
        quantities = sol.get("quantities")
        if isinstance(quantities, dict):
            for value in quantities.values():
                if value not in (None, ""):
                    qty = str(value)
                    break
        qty_by_name[name.lower()] = qty
    for line in quote_lines or []:
        if not isinstance(line, dict):
            continue
        name = str(line.get("name") or "").strip()
        qty = line.get("quantity")
        pid = str(line.get("productId") or line.get("product_id") or "").strip()
        if name and qty not in (None, ""):
            qty_by_name[name.lower()] = str(qty)
        if pid and qty not in (None, ""):
            qty_by_id[pid] = str(qty)
    for product in products:
        if not isinstance(product, dict):
            continue
        name = str(product.get("name") or "").strip()
        if not name or name.lower() in have:
            continue
        filled.append(
            {
                "sku_name": name,
                "qty": qty_by_name.get(name.lower())
                or qty_by_id.get(str(product.get("id") or ""), "1"),
                "unit_price": "",
                "product_id": str(product.get("id") or ""),
            }
        )
        have.add(name.lower())
    return apply_catalog_prices(filled, products)


_PRICE_HEADER_RE = re.compile(r"\b(unit\s*price|price|amount|rate|fee|cost)\b", re.I)


def fill_commercial_table_prices(
    tables: list[dict[str, Any]],
    products: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fill empty price cells from inventory.products. Never invent amounts."""
    by_id, by_name = _catalog_index(products)
    out: list[dict[str, Any]] = []
    for table in tables:
        if not isinstance(table, dict):
            continue
        if table.get("emphasize_last_col"):
            out.append(table)
            continue
        headers = [str(h) for h in (table.get("headers") or [])]
        price_idx = next(
            (i for i, header in enumerate(headers) if _PRICE_HEADER_RE.search(header)),
            None,
        )
        if price_idx is None:
            out.append(table)
            continue
        rows_out: list[list[str]] = []
        for row in table.get("rows") or []:
            if not isinstance(row, list):
                continue
            cells = [str(c) for c in row]
            while len(cells) < len(headers):
                cells.append("")
            name = cells[0].strip() if cells else ""
            match = _match_catalog_product(name, products, by_id, by_name)
            catalog_price = _format_price(match) if match else ""
            current = cells[price_idx].strip() if price_idx < len(cells) else ""
            if catalog_price and (not current or not _MONEY_RE.search(current)):
                cells[price_idx] = catalog_price
            rows_out.append(cells)
        out.append({**table, "rows": rows_out})
    return out


def content_to_crm_sections(
    content: dict[str, Any],
    skeleton: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Map generated content JSON onto CRM section rows (body + tableRows)."""
    tables = {
        str(t.get("id") or ""): t
        for t in (content.get("tables") or [])
        if isinstance(t, dict) and t.get("id")
    }
    generated = content.get("sections") if isinstance(content.get("sections"), list) else []
    by_id = {
        str(s.get("id") or "").strip(): s
        for s in generated
        if isinstance(s, dict) and s.get("id")
    }
    by_heading = {
        _slug(str(s.get("heading") or ""), ""): s
        for s in generated
        if isinstance(s, dict)
    }
    source = skeleton if skeleton else generated
    out: list[dict[str, Any]] = []
    for i, src in enumerate(source):
        if not isinstance(src, dict):
            continue
        key = str(src.get("key") or src.get("id") or f"section_{i + 1}")
        gen = by_id.get(str(src.get("id") or key)) or by_heading.get(_slug(key, ""))
        if gen is None and i < len(generated) and isinstance(generated[i], dict):
            gen = generated[i]
        gen = gen if isinstance(gen, dict) else src
        heading = str(gen.get("heading") or src.get("title") or src.get("heading") or key)
        bodies: list[str] = []
        table_rows: list[dict[str, Any]] = []
        for block in gen.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            kind = str(block.get("kind") or "prose")
            if kind == "bullets":
                items = [str(x) for x in (block.get("items") or []) if str(x).strip()]
                if items:
                    bodies.append("\n".join(f"- {item}" for item in items))
            elif kind == "table":
                tid = str(block.get("table_id") or "")
                table = tables.get(tid)
                if table:
                    for row in table.get("rows") or []:
                        if isinstance(row, list):
                            table_rows.append({"cells": [str(c) for c in row[:16]]})
            else:
                text = str(block.get("text") or "").strip()
                if text:
                    bodies.append(text)
        if not table_rows:
            for table in content.get("tables") or []:
                if not isinstance(table, dict):
                    continue
                if _slug(str(table.get("id") or table.get("title") or ""), "") == _slug(
                    key, ""
                ):
                    for row in table.get("rows") or []:
                        if isinstance(row, list):
                            table_rows.append({"cells": [str(c) for c in row[:16]]})
        out.append(
            {
                "id": src.get("id") or key,
                "key": key,
                "title": heading,
                "body": "\n\n".join(bodies),
                "sortOrder": src.get("sortOrder", i + 1),
                **({"tableRows": table_rows} if table_rows else {}),
            }
        )
    return out
