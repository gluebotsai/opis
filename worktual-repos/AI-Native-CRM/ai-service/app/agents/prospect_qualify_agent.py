"""Prospect qualify agent — LLM ranks candidates vs ICP / competitor / product fit."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

PROSPECT_QUALIFY_AGENT = "prospect_qualify"

SYSTEM = sectioned_system_prompt(
    role=(
        "You are a B2B prospecting analyst for Worktual CRM. You rank external "
        "lead candidates before they are imported — you never invent emails or "
        "companies that are not in the candidate list."
    ),
    goal=(
        "Select the best N candidates that match ICP, competitor/tech signals, "
        "and product-fit hints. Explain each pick briefly."
    ),
    instructions=(
        "- Use ONLY the provided candidates; never invent new people or domains.\n"
        "- Prefer candidates with email when available.\n"
        "- Score higher when industry/geo/size match ICP, when technographics "
        "overlap competitors, or when productFitHint clearly applies.\n"
        "- Return exactly up to limit ids (0-based indexes into the candidates array).\n"
        "- reasons: 1–3 short bullets per selected index."
    ),
    context="Candidates, ICP, competitors, catalog products, and limit are in the user message.",
    output=(
        'Return ONLY JSON: {"ranked":[{"index":0,"score":0-100,'
        '"reasons":["..."]},...]}'
    ),
    guardrails=(
        "Never invent contact emails, phones, or company names. "
        "Never recommend contacting without a human review."
    ),
)


def _heuristic_rank(
    candidates: list[dict[str, Any]],
    *,
    limit: int,
    icp: dict[str, Any],
    competitors: list[str],
    product_fit: str | None,
) -> list[dict[str, Any]]:
    target_ind = {
        s.lower() for s in (icp.get("targetIndustries") or []) if isinstance(s, str)
    }
    geos = {
        s.lower() for s in (icp.get("serviceableGeos") or []) if isinstance(s, str)
    }
    comps = {s.lower() for s in competitors if s}
    scored: list[tuple[int, int, list[str]]] = []
    for i, c in enumerate(candidates):
        score = 40
        reasons: list[str] = []
        ind = str(c.get("industry") or "").lower()
        if target_ind and any(t in ind for t in target_ind):
            score += 20
            reasons.append("Matches target industry")
        country = str(c.get("country") or "").lower()
        if geos and any(g in country for g in geos):
            score += 15
            reasons.append("In serviceable geo")
        tech = [str(t).lower() for t in (c.get("technographics") or [])]
        if comps and any(any(comp in t for t in tech) for comp in comps):
            score += 20
            reasons.append("Uses competitor / target tech stack")
        if c.get("email"):
            score += 10
            reasons.append("Has email")
        if product_fit and product_fit.lower() in json.dumps(c).lower():
            score += 10
            reasons.append("Aligns with product-fit hint")
        if not reasons:
            reasons.append("General ICP proximity")
        scored.append((score, i, reasons))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [
        {"index": i, "score": min(100, score), "reasons": reasons}
        for score, i, reasons in scored[:limit]
    ]


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    job_id = str(body.get("jobId") or "")
    candidates = body.get("candidates") if isinstance(body.get("candidates"), list) else []
    limit = int(body.get("limit") or 10)
    limit = max(1, min(25, limit))
    icp = body.get("icp") if isinstance(body.get("icp"), dict) else {}
    competitors = (
        body.get("competitors")
        if isinstance(body.get("competitors"), list)
        else []
    )
    catalog = (
        body.get("catalogProducts")
        if isinstance(body.get("catalogProducts"), list)
        else []
    )
    product_fit = body.get("productFitHint")
    if not isinstance(product_fit, str):
        product_fit = (body.get("criteria") or {}).get("productFitHint") if isinstance(body.get("criteria"), dict) else None

    ranked_meta = _heuristic_rank(
        candidates,
        limit=limit,
        icp=icp,
        competitors=[str(x) for x in competitors],
        product_fit=product_fit if isinstance(product_fit, str) else None,
    )
    source = "heuristic"

    if is_ai_configured() and candidates:
        slim = []
        for i, c in enumerate(candidates[:100]):
            slim.append(
                {
                    "index": i,
                    "companyName": c.get("companyName"),
                    "companyDomain": c.get("companyDomain"),
                    "industry": c.get("industry"),
                    "employeeCount": c.get("employeeCount"),
                    "country": c.get("country"),
                    "title": c.get("title"),
                    "hasEmail": bool(c.get("email")),
                    "technographics": c.get("technographics") or [],
                    "sourcesFoundIn": c.get("sourcesFoundIn") or [],
                }
            )
        user = json.dumps(
            {
                "limit": limit,
                "icp": icp,
                "competitors": competitors,
                "catalogProducts": catalog[:30],
                "productFitHint": product_fit,
                "candidates": slim,
            },
            ensure_ascii=False,
        )
        try:
            text = await generate_ai_text(
                system=SYSTEM,
                user=user,
                temperature=0.2,
            )
            parsed = extract_json(text) or {}
            ranked = parsed.get("ranked") if isinstance(parsed, dict) else None
            if isinstance(ranked, list) and ranked:
                cleaned = []
                for item in ranked:
                    if not isinstance(item, dict):
                        continue
                    idx = item.get("index")
                    if not isinstance(idx, int) or idx < 0 or idx >= len(candidates):
                        continue
                    reasons = item.get("reasons") if isinstance(item.get("reasons"), list) else []
                    score = item.get("score")
                    cleaned.append(
                        {
                            "index": idx,
                            "score": int(score) if isinstance(score, (int, float)) else 50,
                            "reasons": [str(r) for r in reasons][:3],
                        }
                    )
                if cleaned:
                    ranked_meta = cleaned[:limit]
                    source = "llm"
        except Exception as exc:  # noqa: BLE001
            logger.warning("prospect qualify llm failed: %s", exc)

    out_candidates: list[dict[str, Any]] = []
    for rank_i, meta in enumerate(ranked_meta):
        idx = int(meta["index"])
        row = dict(candidates[idx])
        row["qualifyScore"] = int(meta.get("score") or 0)
        row["qualifyReasons"] = list(meta.get("reasons") or [])
        row["rank"] = rank_i + 1
        out_candidates.append(row)

    return {
        "ok": True,
        "jobId": job_id,
        "agent": PROSPECT_QUALIFY_AGENT,
        "source": source,
        "candidates": out_candidates,
        "count": len(out_candidates),
    }
