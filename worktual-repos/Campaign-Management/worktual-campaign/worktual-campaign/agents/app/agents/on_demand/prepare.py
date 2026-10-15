"""On-demand request: analyse operator intent, then LLM-generate channel templates.

The operator message is an instruction (who/why), NOT the recipient-facing copy.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.agents.on_demand.audience_identity import (
    collect_audience_identity,
    extract_customer_ids,
    extract_emails,
    extract_phones,
    missing_contact_identity_error,
)
from app.agents.template_library import run_creation_agent
from app.agents.template_library.shared import get_llm, parse_json_object
from app.config import get_settings
from app.llm import GEN_MAX_TOKENS, GEN_REASONING_EFFORT

_log = logging.getLogger(__name__)

_ANALYZE_SYSTEM = """You analyse on-demand campaign send requests from marketing operators.

The user message is an OPERATOR INSTRUCTION (who to reach and why). It is NOT the
message that should be sent to the customer.

Return ONLY a JSON object with:
{
  "emails": ["..."],
  "phones": ["..."],
  "customer_ids": ["..."],
  "channels": ["email"],
  "campaign_name": "short campaign name",
  "goal": "one-line marketing goal",
  "objective": "one-line objective",
  "insight": "why we are contacting them, in plain language for copywriters",
  "audience_summary": "who the audience is",
  "thoughts": ["short bullet of what you understood", "..."]
}

Rules:
- Default channels to ["email"] only (prefer_primary — 1 channel at T0).
  Add push/web/whatsapp only when the operator explicitly asks for those channels.
- insight must NEVER say "create a campaign" or repeat the operator command verbatim.
- Extract product/context (e.g. viewed CRM twice) into insight for template writers.
- emails/phones/customer_ids: only those present in the request.
"""


def _heuristic_analyze(request_text: str) -> dict[str, Any]:
    text = (request_text or "").strip()
    emails = extract_emails(text)
    phones = extract_phones(text)
    customer_ids = extract_customer_ids(text)

    insight = text
    for pat in (
        r"(?i)^create\s+a\s+campaign\s+and\s+send\s+for\s+\S+\s*",
        r"(?i)^send\s+(an?\s+)?(email|message)\s+to\s+\S+\s*",
        r"(?i)^email\s+\S+\s*",
    ):
        insight = re.sub(pat, "", insight).strip()
    insight = re.sub(r"(?i)^because\s+", "", insight).strip(" ,.-")
    if not insight or len(insight) < 8:
        insight = "Re-engage this contact with a helpful product follow-up."

    name_hint = (
        emails[0].split("@")[0]
        if emails
        else (customer_ids[0] if customer_ids else "contact")
    )
    audience_bits = emails[:5] + phones[:3] + customer_ids[:3]
    return {
        "emails": emails,
        "phones": phones,
        "customer_ids": customer_ids,
        "channels": ["email"],
        "campaign_name": f"On-demand follow-up — {name_hint}",
        "goal": "Re-engage based on recent product interest",
        "objective": insight[:240],
        "insight": insight[:500],
        "audience_summary": (
            ", ".join(audience_bits)
            if audience_bits
            else "Named contacts from request"
        ),
        "thoughts": [
            f"Contacts: {', '.join(emails[:5] + customer_ids[:3]) or 'none parsed'}",
            f"Insight for copy: {insight[:160]}",
            "Will generate recipient-facing templates (not the operator instruction)",
        ],
        "analysis_source": "heuristic",
    }


async def analyze_on_demand_request(request_text: str) -> dict[str, Any]:
    text = (request_text or "").strip()
    if not text:
        return {
            "ok": False,
            "error": "request_text is required",
            **_heuristic_analyze(""),
        }

    fallback = _heuristic_analyze(text)
    try:
        settings = get_settings()
        llm = get_llm()
        import asyncio

        raw = await asyncio.to_thread(
            lambda: llm.run(
                [
                    {"role": "system", "content": _ANALYZE_SYSTEM},
                    {"role": "user", "content": text},
                ],
                tools=None,
                reasoning_effort=GEN_REASONING_EFFORT,
                max_tokens=min(GEN_MAX_TOKENS, 1024),
                temperature=0.2,
            )
        )
        content = ""
        if isinstance(raw, dict):
            content = str(raw.get("content") or "").strip()
        parsed = parse_json_object(content) if content else None
        if not isinstance(parsed, dict):
            return {**fallback, "ok": True}
        emails = parsed.get("emails") if isinstance(parsed.get("emails"), list) else []
        phones = parsed.get("phones") if isinstance(parsed.get("phones"), list) else []
        customer_ids = (
            parsed.get("customer_ids")
            if isinstance(parsed.get("customer_ids"), list)
            else []
        )
        emails = [str(e).lower().strip() for e in emails if str(e).strip()]
        phones = [str(p).strip() for p in phones if str(p).strip()]
        customer_ids = [str(c).strip() for c in customer_ids if str(c).strip()]
        if not emails:
            emails = fallback["emails"]
        if not phones:
            phones = fallback["phones"]
        if not customer_ids:
            customer_ids = fallback.get("customer_ids") or []
        channels = parsed.get("channels") if isinstance(parsed.get("channels"), list) else []
        channels = [
            str(c).strip().lower()
            for c in channels
            if str(c).strip().lower() in {"email", "push", "web", "whatsapp"}
        ] or fallback["channels"]
        thoughts = parsed.get("thoughts") if isinstance(parsed.get("thoughts"), list) else []
        thoughts = [str(t) for t in thoughts if str(t).strip()] or fallback["thoughts"]
        return {
            "ok": True,
            "emails": emails,
            "phones": phones,
            "customer_ids": customer_ids,
            "channels": channels,
            "campaign_name": str(
                parsed.get("campaign_name") or fallback["campaign_name"]
            ).strip()[:200],
            "goal": str(parsed.get("goal") or fallback["goal"]).strip()[:300],
            "objective": str(
                parsed.get("objective") or fallback["objective"]
            ).strip()[:500],
            "insight": str(parsed.get("insight") or fallback["insight"]).strip()[:800],
            "audience_summary": str(
                parsed.get("audience_summary") or fallback["audience_summary"]
            ).strip()[:400],
            "thoughts": thoughts[:8],
            "analysis_source": "llm",
            "model": getattr(settings, "llm_model", None),
        }
    except Exception as exc:  # noqa: BLE001
        _log.warning("on-demand analyse LLM failed: %s", exc)
        return {**fallback, "ok": True, "analysis_warning": str(exc)}


async def prepare_on_demand_send(payload: dict[str, Any]) -> dict[str, Any]:
    """Analyse request + generate per-channel templates via creation agents.

    Uses the same Email/Push/Web/WhatsApp channel agents as create-campaign.
    Does NOT return stub fallback copy as a successful template set.
    Aborts before template generation when no contact identity is present.
    """
    request_text = str(payload.get("request_text") or "").strip()
    analysis = await analyze_on_demand_request(request_text)
    if analysis.get("ok") is False and analysis.get("error"):
        return analysis

    identity = collect_audience_identity(analysis, payload)
    # Keep analysis lists aligned with merged identity for downstream launch.
    analysis["emails"] = identity["emails"]
    analysis["phones"] = identity["phones"]
    analysis["customer_ids"] = identity["customer_ids"]

    abort = missing_contact_identity_error(identity)
    if abort:
        thoughts = list(analysis.get("thoughts") or [])
        thoughts.insert(0, "Abort: no contact identity — plan dropped before templates.")
        analysis["thoughts"] = thoughts[:8]
        return {
            "ok": False,
            "error": abort,
            "error_code": "missing_contact_identity",
            "analysis": analysis,
            "campaign": {
                "name": str(
                    payload.get("name") or analysis.get("campaign_name") or "On-demand"
                ),
                "goal": str(payload.get("goal") or analysis.get("goal") or ""),
                "objective": str(
                    payload.get("objective") or analysis.get("objective") or ""
                ),
            },
            "channels": list(analysis.get("channels") or ["email"]),
            "templates": [],
            "aborted": True,
        }

    channels = list(payload.get("channels") or analysis.get("channels") or [])
    channels = [
        str(c).strip().lower()
        for c in channels
        if str(c).strip().lower() in {"email", "push", "web", "whatsapp"}
    ] or ["email"]

    insight = str(analysis.get("insight") or analysis.get("objective") or "").strip()
    campaign = {
        "name": str(payload.get("name") or analysis.get("campaign_name") or "On-demand"),
        "goal": str(payload.get("goal") or analysis.get("goal") or "Re-engage interested contacts"),
        "objective": str(
            payload.get("objective")
            or analysis.get("objective")
            or insight
            or "Helpful follow-up after product interest"
        ),
    }
    audience_bits = (
        identity["emails"][:5] + identity["phones"][:3] + identity["customer_ids"][:3]
    )
    # Shape matches create-campaign audience summary for context_block()
    audience = {
        "matched_count": max(len(audience_bits), 1),
        "description": (
            f"On-demand audience. Operator insight (INTERNAL, paraphrase into "
            f"customer copy — never paste): {insight or 'product interest follow-up'}. "
            f"Contacts: {', '.join(audience_bits) or analysis.get('audience_summary') or 'named contacts'}."
        ),
        "filters": analysis.get("audience_summary") or "",
        "summary": ", ".join(audience_bits) or (analysis.get("audience_summary") or ""),
        "insight": insight,
        "emails": identity["emails"],
    }

    channel_plans = [
        {
            "channel": ch,
            "how_it_works": (
                f"On-demand {ch}: write polished recipient-facing copy for this "
                f"insight. Do not mention 'create a campaign' or operator instructions."
            ),
        }
        for ch in channels
    ]

    try:
        org_id = str(
            payload.get("organization_id") or payload.get("organizationId") or ""
        )
        created = await run_creation_agent(
            campaign=campaign,
            audience=audience,
            channels=channels,
            channel_plans=channel_plans,
            user_request=request_text,
            session={"organization_id": org_id} if org_id else None,
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("on-demand run_creation_agent failed")
        return {
            "ok": False,
            "error": f"Template creation agent failed: {exc}",
            "analysis": analysis,
            "campaign": campaign,
            "channels": channels,
            "templates": [],
        }

    templates_out: list[dict[str, Any]] = []
    by_channel: dict[str, dict[str, Any]] = {}
    for row in created.get("templates") or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        if not ch or not fields:
            continue
        # Reject obvious stub / empty email
        if ch == "email":
            subject = str(fields.get("subject") or "").strip()
            paras = fields.get("paragraphs") if isinstance(fields.get("paragraphs"), list) else []
            sections = (
                fields.get("sections")
                if isinstance(fields.get("sections"), list)
                else []
            )
            if not subject or subject.startswith("Still exploring?"):
                continue
            html = str(fields.get("compiled_html") or "").strip()
            has_body = (
                any(str(p).strip() for p in paras)
                or bool(sections)
                or len(html) > 40
            )
            if not has_body:
                continue
        by_channel[ch] = {
            "channel": ch,
            "fields": fields,
            "how_it_works": row.get("how_it_works") or f"On-demand {ch}",
            "fallback": False,
        }

    missing: list[str] = []
    for ch in channels:
        if ch in by_channel:
            templates_out.append(by_channel[ch])
        else:
            missing.append(ch)

    gen_errors = list(created.get("errors") or [])
    if missing:
        return {
            "ok": False,
            "error": (
                "Creation agent did not produce usable templates for: "
                + ", ".join(missing)
                + (
                    f" ({'; '.join(gen_errors[:3])})"
                    if gen_errors
                    else ". Check agents LLM / restart agents service."
                )
            ),
            "analysis": analysis,
            "campaign": campaign,
            "channels": channels,
            "templates": templates_out,
            "missing_channels": missing,
            "generation": {
                "ok": False,
                "errors": gen_errors,
            },
        }

    if not templates_out:
        return {
            "ok": False,
            "error": "Creation agent returned no templates. Restart agents and retry.",
            "analysis": analysis,
            "campaign": campaign,
            "channels": channels,
            "templates": [],
            "generation": {
                "ok": bool(created.get("ok")),
                "errors": gen_errors,
            },
        }

    return {
        "ok": True,
        "analysis": analysis,
        "campaign": campaign,
        "channels": channels,
        "templates": templates_out,
        "generation": {
            "ok": bool(created.get("ok")),
            "errors": gen_errors,
        },
    }
