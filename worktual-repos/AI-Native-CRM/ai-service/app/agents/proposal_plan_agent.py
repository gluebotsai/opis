"""LLM: extract commercial plan lines from the BRD. Prices stay in TypeScript."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_schemas import DealPlan
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured
from app.services.proposal_gemini import (
    format_gemini_error,
    generate_json,
    is_gemini_unavailable,
    proposal_gemini_configured,
)

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role="You extract a commercial plan from one requirement document.",
    goal="List products and quantities the customer asked for. Do not invent prices.",
    instructions=(
        "- lines[].productName must match ALLOWED PRODUCTS when possible.\n"
        "- quantity is a number from the BRD (seats, licenses, bots). Use 0 if unknown.\n"
        "- Do not output money, discounts, or list prices.\n"
        "- risks and assumptions are short factual notes from the BRD."
    ),
    context="Requirement text and allowed catalog names.",
    output="Return JSON matching DealPlan.",
    guardrails="Never invent catalog prices or SKUs that are not allowed.",
)


def _fallback_lines(body: dict[str, Any]) -> list[dict[str, Any]]:
    products = body.get("products")
    rows = products if isinstance(products, list) else []
    req = str(body.get("requirementText") or "")
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        qty = 0.0
        match = re.search(
            rf"(\d+)\s+(?:x\s+)?{re.escape(name)}",
            req,
            flags=re.I,
        )
        if not match:
            match = re.search(
                rf"{re.escape(name)}[^\n]{{0,40}}?(\d+)",
                req,
                flags=re.I,
            )
        if match:
            try:
                qty = float(match.group(1))
            except (TypeError, ValueError):
                qty = 0.0
        out.append(
            {
                "productName": name,
                "sku": str(row.get("sku") or ""),
                "productId": str(row.get("id") or ""),
                "quantity": qty,
                "notes": "",
            }
        )
    return out[:16]


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    lines = _fallback_lines(body)
    fallback = {
        "ok": True,
        "status": "ok",
        "lines": lines,
        "risks": [],
        "assumptions": [],
    }
    extra = json.dumps(
        {
            "requirementText": str(body.get("requirementText") or "")[:8000],
            "products": body.get("products") or [],
            "profile": body.get("profile") or {},
        },
        ensure_ascii=False,
        default=str,
    )[:12_000]
    payload: dict[str, Any] = {}
    if proposal_gemini_configured():
        try:
            model = await generate_json(
                SYSTEM + "\n\nExtract the commercial plan. No prices.",
                DealPlan,
                extra_text=extra,
            )
            payload = model.model_dump()
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-plan Gemini failed: %s", exc)
            if is_gemini_unavailable(exc):
                return label_fallback(fallback, "gemini_unavailable")
            return label_fallback(fallback, f"llm_error:{format_gemini_error(exc)}")
    elif is_ai_configured():
        try:
            text = await generate_ai_text(
                system=SYSTEM,
                user=f"Extract the commercial plan. No prices.\n{extra}",
                max_tokens=800,
                timeout_ms=60_000,
            )
            payload = extract_json(text or "") or {}
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-plan LLM failed")
            return label_fallback(fallback, f"llm_error:{type(exc).__name__}")
    else:
        return label_fallback(fallback, "llm_unconfigured")

    out_lines = payload.get("lines") if isinstance(payload.get("lines"), list) else lines
    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "lines": out_lines,
            "risks": payload.get("risks") or [],
            "assumptions": payload.get("assumptions") or [],
        }
    )
