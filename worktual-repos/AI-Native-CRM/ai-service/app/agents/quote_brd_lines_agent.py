"""LLM: fill a whole quote or invoice sheet from a BRD or order, and list priced lines."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

MAX_ROWS = 80
MAX_COLS = 16

SYSTEM = sectioned_system_prompt(
    role="You fill one uploaded quotation or invoice spreadsheet from a source document.",
    goal=(
        "Return the same sheet, same rows and same cells per row, with the source "
        "written into the cells that the sample left for this customer."
    ),
    instructions=(
        "- sheet is the uploaded sample. Return every row. Each row has the same number of cells.\n"
        "- This is a form: labels stay in their cells (Owner, Product, Plan, Charges, channel names). "
        "Values go in the cells beside those labels.\n"
        "- Replace the sample customer, company, and deal with customerName, companyName, and dealTitle.\n"
        "- Write quantities, session counts, plans, prices, fees, and Yes/No answers from sourceText. "
        "Leave a cell as in the sample when the source says nothing about it.\n"
        "- Use ‹br› inside a cell for a line break. Do not add or drop columns.\n"
        "- lines must list every priced charge written into the sheet. "
        "A cell with several prices, such as three session tiers, is one line per price. "
        "quantity and unitPrice come from the source. Use a catalog price only when the source has no price. "
        "Do not return only the last fee."
    ),
    context="The user message has the full sample sheet, the source text, the real customer, and catalog prices.",
    output=(
        'Return ONLY JSON: {"sheet":[["cell","cell"]],'
        '"lines":[{"productName":"...","quantity":1,"unitPrice":0}]}'
    ),
    guardrails=(
        "Do not invent rows, prices, or Yes/No answers that the source does not support. "
        "Do not return a new column layout. Do not drop label rows."
    ),
)


def _grid(raw: object) -> list[list[str]]:
    if not isinstance(raw, list):
        return []
    rows: list[list[str]] = []
    width = 0
    for row in raw[:MAX_ROWS]:
        if not isinstance(row, list):
            continue
        cells = [str(c if c is not None else "").replace("|", "/").strip() for c in row[:MAX_COLS]]
        width = max(width, len(cells))
        rows.append(cells)
    if not rows:
        return []
    return [row + [""] * (width - len(row)) for row in rows]


def _align(template: list[list[str]], filled: list[list[str]]) -> list[list[str]]:
    if not template:
        return filled
    width = max(len(row) for row in template)
    out: list[list[str]] = []
    for index, src in enumerate(template):
        base = list(src) + [""] * (width - len(src))
        got = filled[index] if index < len(filled) else base
        clean = [str(c).replace("|", "/").strip() for c in got[:width]]
        while len(clean) < width:
            clean.append("")
        out.append(clean if any(cell.strip() for cell in clean) else base)
    return out


def _lines(raw: object) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    lines: list[dict[str, Any]] = []
    for row in raw[:40]:
        if not isinstance(row, dict):
            continue
        name = str(row.get("productName") or "").strip()
        if not name:
            continue
        try:
            qty = float(row.get("quantity") or 1)
        except (TypeError, ValueError):
            qty = 1
        try:
            price = float(row.get("unitPrice") if row.get("unitPrice") is not None else 0)
        except (TypeError, ValueError):
            price = 0
        lines.append(
            {
                "productName": name[:200],
                "quantity": qty if qty > 0 else 1,
                "unitPrice": price if price >= 0 else 0,
            }
        )
    return lines


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    source = str(body.get("requirementText") or body.get("sourceText") or "").strip()
    template = _grid(body.get("sheet"))
    if len(source) < 8:
        return label_fallback(
            {"ok": False, "sheet": template, "lines": [], "reason": "requirement_too_short"},
            "requirement_too_short",
        )
    if not is_ai_configured():
        return label_fallback(
            {"ok": False, "sheet": template, "lines": [], "reason": "llm_not_configured"},
            "llm_not_configured",
        )
    catalog = body.get("catalogProducts") if isinstance(body.get("catalogProducts"), list) else []
    user = json.dumps(
        {
            "kind": str(body.get("kind") or "quote"),
            "customerName": str(body.get("customerName") or ""),
            "companyName": str(body.get("companyName") or ""),
            "dealTitle": str(body.get("dealTitle") or ""),
            "sheet": template,
            "sourceText": source[:20_000],
            "catalogProducts": catalog[:40],
        },
        ensure_ascii=False,
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=8000,
            timeout_ms=90_000,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("commercial sheet fill failed")
        return label_fallback(
            {"ok": False, "sheet": template, "lines": [], "reason": f"llm_error:{exc}"},
            "llm_error",
        )
    sheet = _align(template, _grid(payload.get("sheet")))
    lines = _lines(payload.get("lines"))
    if template and not sheet:
        return label_fallback(
            {"ok": False, "sheet": template, "lines": lines, "reason": "no_sheet"},
            "no_sheet",
        )
    if not template and not lines:
        return label_fallback(
            {"ok": False, "sheet": [], "lines": [], "reason": "no_rows"},
            "no_rows",
        )
    return label_ai({"ok": True, "sheet": sheet, "lines": lines})
