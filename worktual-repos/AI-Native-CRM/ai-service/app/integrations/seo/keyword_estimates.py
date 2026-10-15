"""LLM keyword estimates — related terms and Semrush fallback. Not live Semrush."""

from __future__ import annotations

from typing import Any

from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.integrations.semrush.keywords import normalize_keyword_rows

LLM_SOURCE = "llm_estimate"


def tag_estimate_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        term = str(row.get("term") or "").strip()
        if not term:
            continue
        tagged = dict(row)
        tagged["term"] = term
        tagged["source"] = LLM_SOURCE
        out.append(tagged)
    return out


def rows_from_llm_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw = payload.get("rows")
    if isinstance(raw, list):
        normalized = normalize_keyword_rows({"data": raw})
        if normalized:
            return tag_estimate_rows(normalized)
        tagged = tag_estimate_rows([r for r in raw if isinstance(r, dict)])
        if tagged:
            return tagged
    normalized = normalize_keyword_rows(payload)
    return tag_estimate_rows(normalized)


async def estimate_keywords_llm(
    *,
    seed: str,
    location: str = "us",
    language: str = "en",
) -> dict[str, Any]:
    system = sectioned_system_prompt(
        role="You estimate search-demand keywords for a Digital Marketing workspace.",
        goal="Return a JSON object of related keywords with estimated metrics.",
        instructions=(
            "Propose 12–18 realistic related keywords for the seed. "
            "Metrics are estimates for planning only — not Semrush, Google Ads, or "
            "any paid tool. Keep volume/KD/CPC internally consistent for the locale."
        ),
        context=f"seed={seed}; location={location}; language={language}",
        output=(
            '{"rows":[{"term":"...","intent":"informational|commercial|transactional|'
            'navigational","volume":1234,"kd":12,"cpc":1.2,"competition":0.4,'
            '"opportunity":70}]}'
        ),
        guardrails=(
            "JSON object only. No markdown. Do not claim the numbers are from Semrush. "
            "Do not invent tenant or credential fields."
        ),
    )
    user = (
        f"Seed keyword/topic: {seed}\n"
        f"Market: {location}\n"
        f"Language: {language}\n"
        "Return rows now."
    )

    def validate(parsed: dict[str, Any]) -> dict[str, Any]:
        rows = rows_from_llm_payload(parsed)
        if len(rows) < 3:
            raise ValueError("need at least 3 keyword rows")
        return {"rows": rows}

    parsed, reason = await generate_json_with_retries(
        system=system,
        user=user,
        max_tokens=2200,
        attempts=2,
        validate=validate,
    )
    if not parsed:
        return {
            "ok": False,
            "rows": [],
            "source": LLM_SOURCE,
            "error": f"LLM keyword estimates failed ({reason or 'unknown'}).",
        }
    rows = parsed.get("rows") if isinstance(parsed, dict) else None
    if not isinstance(rows, list):
        rows = []
    return {
        "ok": True,
        "rows": rows,
        "source": LLM_SOURCE,
        "error": None,
    }
