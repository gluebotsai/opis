"""LLM: pick the best learned playbook for a requirement profile."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role="You select which proposal playbook best matches a requirement profile.",
    goal="Return exactly one playbookId from the provided list with a short rationale.",
    instructions=(
        "- Use ONLY ids from the playbooks list.\n"
        "- Prefer content.matchTags / tags overlap with requirement themes and products.\n"
        "- Prefer section-outline fit over visual/PDF similarity.\n"
        "- Always pick one id. Playbooks are writing/layout templates, not industry "
        "classifiers — a weak thematic overlap is still a valid pick.\n"
        "- confidence = how sure this id is the best of THIS list (use >= 0.7 when "
        "the list has one playbook, or it is clearly the top retrieveScore). "
        "Do not score industry mismatch as near-zero confidence."
    ),
    context="Profile and playbooks are in the user message.",
    output='Return ONLY JSON: {"playbookId":"...","confidence":0.0,"rationale":"..."}',
    guardrails="Never invent a playbook id.",
)


def _floor_match_confidence(
    confidence: float, *, playbook_count: int, retrieve_score: float = 0.0
) -> float:
    """Keep a usable rank score when the LLM down-scores industry mismatch."""
    value = max(0.0, min(1.0, confidence))
    if playbook_count <= 1:
        return max(value, 0.7)
    if retrieve_score >= 0.25:
        return max(value, min(0.85, retrieve_score))
    return value


def _score(profile: dict[str, Any], playbook: dict[str, Any]) -> float:
    content = playbook.get("content") if isinstance(playbook.get("content"), dict) else {}
    tag_values = list(playbook.get("tags") or []) + list(content.get("matchTags") or [])
    tags = {
        str(t).lower()
        for t in tag_values
        if isinstance(t, str)
    }
    themes = {str(t).lower() for t in (profile.get("themes") or []) if isinstance(t, str)}
    products = {
        str(p).lower() for p in (profile.get("products") or []) if isinstance(p, str)
    }
    score = 0.1
    if tags & themes:
        score += 0.4
    if tags & products:
        score += 0.3
    name = str(playbook.get("name") or "").lower()
    if "general" in tags or "standard" in name:
        score += 0.05
    blob = " ".join(themes | products)
    if blob and any(b in name for b in blob.split() if len(b) > 4):
        score += 0.1
    return min(1.0, score)


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    profile = body.get("profile") if isinstance(body.get("profile"), dict) else {}
    playbooks = body.get("playbooks") if isinstance(body.get("playbooks"), list) else []

    if not playbooks:
        return {
            "ok": False,
            "status": "failed",
            "reason": "no_playbooks",
            "playbookId": None,
        }

    scored = sorted(
        (
            (_score(profile, p if isinstance(p, dict) else {}), p)
            for p in playbooks
            if isinstance(p, dict) and p.get("id")
        ),
        key=lambda x: -x[0],
    )
    best_score, best = scored[0]
    try:
        best_retrieve = float(best.get("retrieveScore") or 0)
    except (TypeError, ValueError):
        best_retrieve = 0.0
    fallback = {
        "playbookId": str(best.get("id")),
        "confidence": _floor_match_confidence(
            best_score,
            playbook_count=len(scored),
            retrieve_score=best_retrieve,
        ),
        "rationale": "Best tag/theme overlap (heuristic).",
        "source": "heuristic",
    }

    if not is_ai_configured():
        return {"ok": True, "status": "ok", **fallback, "reason": "llm_not_configured"}

    slim = [
        {
            "id": str(p.get("id")),
            "name": p.get("name"),
            "tags": p.get("tags") or p.get("tagsJson") or [],
            "sectionKeys": p.get("sectionKeys")
            or [
                s.get("key")
                for s in (p.get("sections") or p.get("sectionsJson") or [])
                if isinstance(s, dict)
            ][:12],
            "blurb": str(p.get("blurb") or "")[:280],
            "retrieveScore": p.get("retrieveScore"),
        }
        for p in playbooks
        if isinstance(p, dict)
    ]
    # Cap list length, not total JSON — shortlist should already be <= 5.
    slim = slim[:8]
    user = (
        f"Profile:\n{json.dumps(profile, ensure_ascii=False)[:4000]}\n\n"
        f"Playbook shortlist (pick exactly one id):\n"
        f"{json.dumps(slim, ensure_ascii=False)[:12000]}"
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=800,
            timeout_ms=45_000,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-playbook-match LLM failed")
        return {"ok": True, "status": "ok", **fallback, "reason": f"llm_error:{exc}"}

    ids = {str(p.get("id")) for p in playbooks if isinstance(p, dict)}
    pid = str(payload.get("playbookId") or "")
    if pid not in ids:
        try:
            retry_text = await generate_ai_text(
                system=SYSTEM,
                user=(
                    user
                    + "\n\nYour previous answer did not contain one exact provided id. "
                    "Return only the JSON object with one id copied verbatim from the list."
                ),
                max_tokens=800,
                timeout_ms=45_000,
            )
            payload = extract_json(retry_text or "") or {}
            pid = str(payload.get("playbookId") or "")
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-playbook-match retry failed")
            return {
                "ok": True,
                "status": "ok",
                **fallback,
                "reason": f"llm_retry_error:{exc}",
            }
        if pid not in ids:
            return {
                "ok": True,
                "status": "ok",
                **fallback,
                "reason": "invalid_id_after_retry",
            }

    try:
        confidence = float(
            payload.get("confidence")
            if payload.get("confidence") is not None
            else best_score
        )
    except (TypeError, ValueError):
        confidence = best_score

    retrieve = 0.0
    chosen = next((p for p in playbooks if str(p.get("id")) == pid), None)
    if isinstance(chosen, dict):
        try:
            retrieve = float(chosen.get("retrieveScore") or 0)
        except (TypeError, ValueError):
            retrieve = 0.0
    confidence = _floor_match_confidence(
        confidence, playbook_count=len(ids), retrieve_score=retrieve
    )

    return {
        "ok": True,
        "status": "ok",
        "playbookId": pid,
        "confidence": confidence,
        "rationale": str(payload.get("rationale") or "")[:400],
        "source": "ai",
    }
