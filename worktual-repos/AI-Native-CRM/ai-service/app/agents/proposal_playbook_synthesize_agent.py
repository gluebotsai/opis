"""LLM: synthesize org-level proposal writing pattern from case studies."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_schemas import ContentPlaybookSynthesis
from app.agents.proposal_section_keys import canonicalize_section_key
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured
from app.services.proposal_gemini import generate_json, proposal_gemini_configured

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role=(
        "You synthesize an organization-level proposal writing playbook from "
        "many case studies of how past BRDs became winning proposals."
    ),
    goal=(
        "Generalize authoring rules: per-section purpose, tone, target word range, "
        "a length model from requirement size/complexity to proposal length, "
        "anonymized exemplar snippets, and a variance log of length/tone spread."
    ),
    instructions=(
        "- Do not copy customer names, dates, prices, or emails into exemplars.\n"
        "- sectionSpecs is a list; each item.key must match a case-study sectionKey.\n"
        "- targetWordRange is [min, max] words.\n"
        "- lengthModel.coefficients: intercept (pages), perThousandWords, perComplexityPoint.\n"
        "- varianceLog is a list; per sectionKey note word-count min/max/mean and tone spread.\n"
        "- If case studies disagree strongly (bimodal length or tone), record that in varianceLog."
    ),
    context="Case studies are in the user message.",
    output="Return JSON matching ContentPlaybookSynthesis.",
    guardrails="Never include real customer or contact names. Never invent product prices.",
)


def compact_case_studies(case_studies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep synthesize payload small so Gemini returns schema JSON, not thought-only."""
    out: list[dict[str, Any]] = []
    for study in case_studies[:12]:
        if not isinstance(study, dict):
            continue
        analysis: list[dict[str, Any]] = []
        rows = study.get("sectionAnalysis")
        if isinstance(rows, list):
            for row in rows[:16]:
                if not isinstance(row, dict):
                    continue
                key = canonicalize_section_key(str(row.get("sectionKey") or "").strip())
                if not key:
                    continue
                refs = row.get("sourceRequirementRefs")
                analysis.append(
                    {
                        "sectionKey": key[:80],
                        "wordCount": int(row.get("wordCount") or 0),
                        "toneRegister": str(row.get("toneRegister") or "")[:40],
                        "specificityLevel": str(row.get("specificityLevel") or "")[:20],
                        "elaborationSignal": str(row.get("elaborationSignal") or "")[:20],
                        "sourceRequirementRefs": [
                            str(r)[:120] for r in refs[:4]
                        ]
                        if isinstance(refs, list)
                        else [],
                    }
                )
        length = study.get("lengthAnalysis") if isinstance(study.get("lengthAnalysis"), dict) else {}
        out.append(
            {
                "id": str(study.get("id") or ""),
                "pairingConfidence": study.get("pairingConfidence"),
                "lengthAnalysis": {
                    "requirementWordCount": int(length.get("requirementWordCount") or 0),
                    "requirementComplexityScore": float(
                        length.get("requirementComplexityScore") or 0.5
                    ),
                    "proposalPageCount": int(length.get("proposalPageCount") or 0),
                    "proposalWordCount": int(length.get("proposalWordCount") or 0),
                },
                "sectionAnalysis": analysis,
            }
        )
    return out


def specs_to_map(raw: Any) -> dict[str, Any]:
    """Accept list or dict (including a nested sectionSpecs wrapper)."""
    if isinstance(raw, dict):
        nested = raw.get("sectionSpecs")
        if isinstance(nested, dict) and nested:
            raw = nested
        elif isinstance(nested, list):
            raw = nested
        if isinstance(raw, dict):
            out: dict[str, Any] = {}
            for key, value in raw.items():
                if key == "sectionSpecs" or not isinstance(value, dict):
                    continue
                name = canonicalize_section_key(str(value.get("key") or key).strip())
                if name:
                    out[name] = {**value, "key": name}
            if out:
                return out
    if isinstance(raw, list):
        out = {}
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = canonicalize_section_key(str(row.get("key") or row.get("sectionKey") or "").strip())
            if name:
                out[name] = {**row, "key": name}
        return out
    return {}


def variance_to_map(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict) and raw:
        nested = raw.get("varianceLog")
        if isinstance(nested, dict) and nested:
            return {str(k): v for k, v in nested.items() if isinstance(v, dict)}
        return {
            str(k): v
            for k, v in raw.items()
            if isinstance(v, dict) and k != "varianceLog"
        }
    if isinstance(raw, list):
        out: dict[str, Any] = {}
        for row in raw:
            if not isinstance(row, dict):
                continue
            key = canonicalize_section_key(str(row.get("sectionKey") or row.get("key") or "").strip())
            if key:
                out[key] = row
        return out
    return {}


def _heuristic(case_studies: list[dict[str, Any]]) -> dict[str, Any]:
    specs: dict[str, Any] = {}
    bank: list[dict[str, Any]] = []
    variance: dict[str, Any] = {}
    words: dict[str, list[int]] = {}
    for study in case_studies:
        analysis = study.get("sectionAnalysis") if isinstance(study.get("sectionAnalysis"), list) else []
        for row in analysis:
            if not isinstance(row, dict):
                continue
            key = canonicalize_section_key(str(row.get("sectionKey") or "").strip())
            if not key:
                continue
            wc = int(row.get("wordCount") or 0)
            words.setdefault(key, []).append(wc)
            specs.setdefault(
                key,
                {
                    "purpose": str(row.get("sourceRequirementRefs") or key)[:240],
                    "targetWordRange": [max(80, wc // 2), max(120, wc + 80)],
                    "tone": str(row.get("toneRegister") or "consultative"),
                    "specificityExpectation": str(row.get("specificityLevel") or "high"),
                },
            )
            snippet = str(row.get("toneRegister") or "")
            if snippet and len(bank) < 8:
                bank.append(
                    {
                        "sectionKey": key,
                        "requirementTheme": key,
                        "redactedSnippet": "the customer",
                        "sourceCaseStudyId": str(study.get("id") or ""),
                    }
                )
    for key, series in words.items():
        variance[key] = {
            "wordMin": min(series),
            "wordMax": max(series),
            "wordMean": round(sum(series) / len(series)),
            "toneSpread": "unknown",
        }
    return {
        "sectionSpecs": specs,
        "lengthModel": {
            "type": "linear",
            "basis": "requirementWordCount + requirementComplexityScore",
            "coefficients": {
                "intercept": 4,
                "perThousandWords": 1.2,
                "perComplexityPoint": 3,
            },
            "fallback": "proportional: pages = requirementWordCount / 400",
        },
        "exemplarBank": bank,
        "varianceLog": variance,
    }


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    case_studies = (
        body.get("caseStudies") if isinstance(body.get("caseStudies"), list) else []
    )
    fallback = _heuristic(case_studies)
    if not is_ai_configured() and not proposal_gemini_configured():
        return label_fallback(
            {"ok": True, "status": "ok", **fallback},
            "llm_not_configured",
        )

    compact = compact_case_studies(case_studies)
    extra = (
        f"Vendor: {body.get('organizationName') or 'Vendor'}\n"
        f"Case studies ({len(compact)}):\n"
        f"{json.dumps(compact, ensure_ascii=False, default=str)[:18_000]}"
    )
    payload: dict[str, Any] = {}

    if proposal_gemini_configured():
        try:
            model = await generate_json(
                SYSTEM + "\n\nFill ContentPlaybookSynthesis from these case studies.",
                ContentPlaybookSynthesis,
                extra_text=extra,
            )
            payload = model.model_dump()
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-playbook-synthesize schema JSON failed: %s", exc)

    if not specs_to_map(payload.get("sectionSpecs")):
        try:
            text = await generate_ai_text(
                system=SYSTEM,
                user=extra + "\nReturn ContentPlaybookSynthesis JSON only.",
                max_tokens=6000,
                timeout_ms=90_000,
            )
            payload = extract_json(text or "") or payload
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-playbook-synthesize LLM failed")
            return label_fallback(
                {"ok": True, "status": "ok", **fallback},
                f"llm_error:{exc}",
            )

    specs = specs_to_map(payload.get("sectionSpecs"))
    if not specs:
        logger.warning(
            "proposal-playbook-synthesize unusable_json keys=%s",
            list(payload.keys())[:12],
        )
        return label_fallback(
            {"ok": True, "status": "ok", **fallback},
            "unusable_json",
        )

    exemplars = payload.get("exemplarBank")
    variance = variance_to_map(payload.get("varianceLog")) or fallback["varianceLog"]
    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "sectionSpecs": specs,
            "lengthModel": payload.get("lengthModel") or fallback["lengthModel"],
            "exemplarBank": exemplars
            if isinstance(exemplars, list)
            else fallback["exemplarBank"],
            "varianceLog": variance,
        }
    )
