"""Prospect personnel agent — fill missing contacts via Lusha/Apollo."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import generate_ai_text, is_ai_configured
from app.providers import fill_personnel_providers
from app.providers.prospect_types import PROVIDERS, ResearchProviderId

logger = logging.getLogger(__name__)

PROSPECT_PERSONNEL_AGENT = "prospect_personnel"

SYSTEM = sectioned_system_prompt(
    role=(
        "You are a B2B personnel researcher for Worktual CRM. You pick the best "
        "buyer titles for accounts that still lack a named contact."
    ),
    goal="Suggest preferred job titles for person lookup on incomplete candidates.",
    instructions=(
        "- Prefer economic buyers for B2B sales (VP Sales, CRO, Head of Sales, Founder).\n"
        "- Return at most 5 titles.\n"
        "- Do not invent people."
    ),
    context="Criteria and incomplete candidate companies are in the user message.",
    output='Return ONLY JSON: {"titles":["VP Sales","Head of Sales"]}',
    guardrails="Never invent emails or names.",
)


def _as_credentials(raw: Any) -> dict[ResearchProviderId, dict[str, Any]]:
    out: dict[ResearchProviderId, dict[str, Any]] = {}
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        pid = str(row.get("provider") or "").strip().lower()
        if pid not in PROVIDERS:
            continue
        out[pid] = {  # type: ignore[index]
            "apiKey": row.get("apiKey"),
            "settings": row.get("settings")
            if isinstance(row.get("settings"), dict)
            else None,
        }
    return out


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    job_id = str(body.get("jobId") or "")
    candidates = body.get("candidates") if isinstance(body.get("candidates"), list) else []
    credentials = _as_credentials(body.get("credentials"))
    criteria = body.get("criteria") if isinstance(body.get("criteria"), dict) else {}
    titles = criteria.get("titles") if isinstance(criteria.get("titles"), list) else None
    titles = [str(t) for t in (titles or []) if str(t).strip()] or None

    incomplete = [
        c
        for c in candidates
        if isinstance(c, dict) and not (c.get("email") or "").strip()
    ]
    if incomplete and is_ai_configured() and not titles:
        try:
            user = json.dumps(
                {
                    "companies": [
                        {
                            "companyName": c.get("companyName"),
                            "companyDomain": c.get("companyDomain"),
                            "industry": c.get("industry"),
                        }
                        for c in incomplete[:20]
                    ]
                },
                ensure_ascii=False,
            )
            text = await generate_ai_text(system=SYSTEM, user=user)
            parsed = extract_json(text) or {}
            raw_titles = parsed.get("titles") if isinstance(parsed, dict) else None
            if isinstance(raw_titles, list) and raw_titles:
                titles = [str(t) for t in raw_titles if str(t).strip()][:5]
        except Exception as exc:  # noqa: BLE001
            logger.warning("personnel title llm failed: %s", exc)

    if not titles:
        titles = ["VP Sales", "Head of Sales", "Chief Revenue Officer"]

    filled = await fill_personnel_providers(
        candidates=[c for c in candidates if isinstance(c, dict)],
        credentials=credentials,
        titles=titles,
    )
    return {
        "ok": True,
        "jobId": job_id,
        "agent": PROSPECT_PERSONNEL_AGENT,
        "titlesUsed": titles,
        "candidates": filled,
        "count": len(filled),
        "filledCount": sum(1 for c in filled if (c.get("email") or "").strip()),
    }
