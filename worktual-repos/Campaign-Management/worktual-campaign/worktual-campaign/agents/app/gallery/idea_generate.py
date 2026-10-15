"""Automatic Template Gallery — industry campaign ideas (no audience required)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from app.agents.template_library.shared import get_llm, parse_json_object

_log = logging.getLogger(__name__)

_IDEA_SYSTEM = """You are a senior B2B/B2C campaign strategist for Worktual Campaign.
Generate distinct marketing campaign IDEAS for the Template Gallery.

Rules:
- Output JSON only: {"ideas":[{"title":"...","summary":"...","goal":"..."}, ...]}
- Generate exactly the requested count of ideas.
- Ideas must fit the company industry and mode (B2B or B2C).
- Do NOT include target audience segments, contact lists, or personas.
- Each idea must be clearly different (theme, offer type, season, product angle).
- Summaries are 1-2 sentences. Goals are short outcome phrases.
- No markdown, no commentary outside JSON.
"""


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return (s[:80] or "campaign-idea").strip("-")


def _normalize_ideas(raw: list[Any], *, start_index: int = 0) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        summary = str(row.get("summary") or row.get("description") or "").strip()
        goal = str(row.get("goal") or "Engagement").strip()
        idea_key = str(row.get("idea_key") or row.get("ideaKey") or "").strip()
        if not idea_key:
            idea_key = f"{_slugify(title)}-{start_index + i + 1:02d}"
        out.append(
            {
                "idea_key": idea_key[:120],
                "title": title[:200],
                "summary": summary[:2000],
                "goal": goal[:200],
            }
        )
    return out


def _llm_text(raw: Any) -> str:
    """OpenAILLM.run returns {content, reasoning, tool_calls} — not a plain string."""
    if isinstance(raw, dict):
        return str(raw.get("content") or "").strip()
    return str(raw or "").strip()


async def generate_gallery_campaign_ideas(
    *,
    count: int,
    industry: str,
    industry_type: str,
    pack_id: str,
    mode: str,
    company_name: str,
    existing_titles: list[str] | None = None,
) -> dict[str, Any]:
    """LLM-only idea generation — no audience, no regex intent parsing."""
    target = max(1, min(int(count or 10), 20))
    existing = [str(t).strip() for t in (existing_titles or []) if str(t).strip()]
    avoid = ""
    if existing:
        avoid = "\nAvoid duplicating these existing idea titles:\n- " + "\n- ".join(
            existing[:30]
        )

    user = (
        f"Company: {company_name}\n"
        f"Mode: {mode}\n"
        f"Industry pack: {pack_id}\n"
        f"Industry type: {industry_type or industry or 'general'}\n"
        f"Generate {target} campaign ideas.{avoid}"
    )

    try:
        llm = get_llm()
        raw = await asyncio.to_thread(
            llm.run,
            [
                {"role": "system", "content": _IDEA_SYSTEM},
                {"role": "user", "content": user},
            ],
            max_tokens=2048,
        )
        content = _llm_text(raw)
        parsed = parse_json_object(content)
        ideas_raw = parsed.get("ideas") if isinstance(parsed, dict) else []
        if not isinstance(ideas_raw, list):
            ideas_raw = []
        ideas = _normalize_ideas(ideas_raw, start_index=len(existing))
        if not ideas:
            _log.warning(
                "gallery ideas parse empty target=%s content_len=%s",
                target,
                len(content),
            )
            return {
                "ok": False,
                "error": "LLM returned no parseable campaign ideas",
                "ideas": [],
            }
        if len(ideas) < target:
            _log.warning(
                "gallery ideas under target got=%s want=%s", len(ideas), target
            )
        return {"ok": True, "ideas": ideas[:target]}
    except Exception as exc:  # noqa: BLE001
        _log.exception("gallery idea generation failed")
        return {"ok": False, "error": str(exc), "ideas": []}
