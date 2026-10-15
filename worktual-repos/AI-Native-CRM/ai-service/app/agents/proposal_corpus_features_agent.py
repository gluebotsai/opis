"""Gemini: extract feature/theme ontology and table row slots from corpus pages."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import (
    LLM_JOB_TIMEOUT_MS,
    generate_proposal_ai_text as generate_ai_text,
    is_ai_configured,
    proposal_llm_source_tag as llm_source_tag,
)

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role=(
        "You extract a reusable feature and table schema from a historical "
        "B2B requirement or winning proposal PDF."
    ),
    goal=(
        "Learn which themes, products, and table row slots this document family "
        "uses so a later generate step can fill the same tables for a NEW customer. "
        "Never copy old prices, customer names, or paragraph prose."
    ),
    instructions=(
        "- Requirement side: list themes, products/solutions named, constraints, "
        "and requested capability labels as printed (short phrases).\n"
        "- Proposal side: for every table, record exact header columns in order, "
        "row kinds (feature, comparison, commercials, totals), and rowSlots "
        "the generate step should fill. rowSlots.id is a slug; label is the "
        "row title as a reusable capability name (not a customer-specific value); "
        "fillFrom is requirement|products|kb|computed.\n"
        "- Do not store old prices, SKUs unique to that deal, or customer names "
        "in rowSlots.label.\n"
        "- tables[].key must match a learned section key when possible "
        "(commercials, comparison, features, scope).\n"
        "- requestedFeatures are capability phrases the requirement asked for.\n"
        "- products are solution names evidenced in this document only."
    ),
    context="Kind, deep-read sections, and page excerpts are in the user message.",
    output=(
        'Return ONLY JSON: {"themes":["..."],"products":["..."],'
        '"constraints":["..."],"requestedFeatures":["..."],'
        '"tables":[{"key":"commercials","columns":["Feature","Requested","Recommended"],'
        '"rowKind":"comparison","rowSlots":[{"id":"omnichannel","label":"Omnichannel routing",'
        '"fillFrom":"requirement"}]}],'
        '"source":"gemini_features"}'
    ),
    guardrails=(
        "No customer company or person names. No prices. rowSlots are reusable "
        "capability placeholders, not copied deal values."
    ),
)


def _page_snip(pages: list[Any], *, limit: int = 8) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in pages[:limit]:
        if not isinstance(p, dict):
            continue
        out.append(
            {
                "n": p.get("n"),
                "text": str(p.get("text") or "")[:900],
                "pageHtml": str(p.get("pageHtml") or "")[:3500],
            }
        )
    return out


def _section_snip(sections: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for section in sections[:16]:
        if not isinstance(section, dict):
            continue
        table = section.get("tableSpec") if isinstance(section.get("tableSpec"), dict) else {}
        out.append(
            {
                "key": section.get("key"),
                "title": section.get("title"),
                "intent": str(section.get("intent") or "")[:200],
                "tableSpec": {
                    "shape": table.get("shape"),
                    "columns": table.get("columns") if isinstance(table.get("columns"), list) else [],
                    "notes": str(table.get("notes") or "")[:240],
                },
            }
        )
    return out


def _string_list(value: Any, *, limit: int, width: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        s = str(item or "").strip()
        if s:
            out.append(s[:width])
        if len(out) >= limit:
            break
    return out


def _normalize_row_slots(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw[:40]:
        if not isinstance(item, dict):
            continue
        slot_id = str(item.get("id") or item.get("label") or "").strip().lower()
        slot_id = "".join(ch if ch.isalnum() else "_" for ch in slot_id).strip("_")
        label = str(item.get("label") or slot_id).strip()[:120]
        fill_from = str(item.get("fillFrom") or "requirement").strip().lower()
        if fill_from not in {"requirement", "products", "kb", "computed"}:
            fill_from = "requirement"
        if not slot_id or slot_id in seen:
            continue
        seen.add(slot_id)
        out.append({"id": slot_id[:80], "label": label, "fillFrom": fill_from})
    return out


def _normalize_tables(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:12]:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip().lower().replace(" ", "_")
        columns = _string_list(item.get("columns"), limit=12, width=80)
        if not key and not columns:
            continue
        row_kind = str(item.get("rowKind") or item.get("shape") or "feature").strip()[:40]
        out.append(
            {
                "key": key or "table",
                "columns": columns,
                "rowKind": row_kind or "feature",
                "rowSlots": _normalize_row_slots(item.get("rowSlots")),
            }
        )
    return out


def _heuristic_schema(kind: str, sections: list[Any]) -> dict[str, Any]:
    tables: list[dict[str, Any]] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        table = section.get("tableSpec") if isinstance(section.get("tableSpec"), dict) else {}
        columns = table.get("columns") if isinstance(table.get("columns"), list) else []
        cols = [str(c).strip() for c in columns if str(c).strip()]
        if not cols:
            continue
        tables.append(
            {
                "key": str(section.get("key") or "table"),
                "columns": cols[:12],
                "rowKind": str(table.get("shape") or "feature"),
                "rowSlots": [],
            }
        )
    return {
        "themes": [],
        "products": [],
        "constraints": [],
        "requestedFeatures": [],
        "tables": tables,
        "source": "heuristic",
        "kind": kind,
    }


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    item_id = str(body.get("itemId") or "")
    kind = str(body.get("kind") or "proposal").strip().lower() or "proposal"
    pages = body.get("pages") if isinstance(body.get("pages"), list) else []
    sections = body.get("sections") if isinstance(body.get("sections"), list) else []
    fallback = _heuristic_schema(kind, sections)

    if not is_ai_configured():
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "featureSchema": fallback,
            "source": "heuristic",
            "reason": "llm_not_configured",
        }

    user = (
        f"Item id: {item_id}\n"
        f"Document kind: {kind}\n"
        f"Deep-read sections:\n{json.dumps(_section_snip(sections), ensure_ascii=False)[:8000]}\n\n"
        f"Pages:\n{json.dumps(_page_snip(pages), ensure_ascii=False)[:18000]}\n\n"
        "Extract themes, products, requestedFeatures, and table columns/rowSlots. "
        "Do not copy prices or customer names."
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=4000,
            timeout_ms=LLM_JOB_TIMEOUT_MS,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-features Gemini failed")
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "featureSchema": fallback,
            "source": "heuristic",
            "reason": f"llm_error:{exc}",
        }

    tables = _normalize_tables(payload.get("tables"))
    if not tables:
        tables = fallback["tables"]
    schema = {
        "themes": _string_list(payload.get("themes"), limit=12, width=80),
        "products": _string_list(payload.get("products"), limit=12, width=80),
        "constraints": _string_list(payload.get("constraints"), limit=12, width=160),
        "requestedFeatures": _string_list(
            payload.get("requestedFeatures"), limit=24, width=120
        ),
        "tables": tables,
        "source": "ai",
        "kind": kind,
    }
    return {
        "ok": True,
        "status": "ok",
        "itemId": item_id,
        "featureSchema": schema,
        "source": llm_source_tag(),
    }
