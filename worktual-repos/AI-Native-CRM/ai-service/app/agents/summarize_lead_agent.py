"""
Lead Summary Agent (LangGraph).

LLM-only executive summary from enrichment + Fit/Intent score facts.
Never invents facts; never falls back to heuristic narrative copy.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.agent_md import agent_md_path, load_agent_md
from app.agents.native_pipeline import run_steps

from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.agents.step_trace import traced_step
from app.crm_client import CrmClient
from app.llm import LLM_JOB_TIMEOUT_MS, is_ai_configured
from app.agents.crm_tools import effective_contact_type
from app.agents.score_lead_agent import clamp_outreach_to_crm_channels

SUMMARY_MODULE_PATH = "summary"
SUMMARY_AGENT = "lead_summary"
CITABLE_ACTIVITY_TYPES = ("email", "call", "meeting", "sms")

_SECTIONS = load_agent_md(agent_md_path(__file__, "lead-summary"))
SUMMARY_SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)

UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.I,
)
CUID_RE = re.compile(r"\b[cC][a-z0-9]{20,}\b")


class SummaryState(TypedDict, total=False):
    contact_id: str
    organization_id: Optional[str]
    job_id: str
    force: bool
    context: dict[str, Any]
    summary: str
    intent: str
    source: str
    recommended_action: Optional[str]
    flags: dict[str, Any]
    status: str
    reason: Optional[str]
    persist_result: dict[str, Any]


_LABELED_ID_RE = re.compile(
    r"\s*\(\s*(?:run|campaign|message|batch|ticket|recipient|contact|conversation|event|source)\s+id\s*[:#]?\s*[A-Za-z0-9_-]+\s*\)"
    r"|\b(?:run|campaign|message|batch|ticket|recipient|contact|conversation|event|source)\s+id\s*[:#]?\s*[A-Za-z0-9_-]+\b"
    r"|\bid\s*[:#]\s*\d{2,}\b",
    re.I,
)


def _strip_ids(text: str) -> str:
    text = UUID_RE.sub("", text)
    text = CUID_RE.sub("", text)
    text = _LABELED_ID_RE.sub("", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"[ \t]+([.,;:])", r"\1", text)
    return text.strip()


_URL_RE = re.compile(r"https?://\S+|\bwww\.\S+", re.I)
_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
_PASTE_RE = re.compile(
    r"<!doctype|<html|charset\s*=|xmlns\s*=|meet\.google|calendar/event|"
    r"google\.com/calendar|\beid=|@[a-z0-9.-]+\.[a-z]{2,}|"
    r"(?:^|\n)\s*(?:from|to|cc):\s|sent via gmail|join with google meet|"
    r"invitation from google calendar",
    re.I,
)
_CDP_ID_RE = re.compile(r"\bCDP-[\w.-]+", re.I)
_CONV_ID_RE = re.compile(
    r"\bconversation(?:Id|\s+id)\s*[:#]?\s*[A-Za-z0-9_-]{3,}\b",
    re.I,
)


def _clean_summary_text(text: str) -> str:
    """Clamp model text: no tags, links, or internal ids."""
    text = re.sub(r"(?is)<script\b[^>]*>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style\b[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(?:p|div|li|tr|h[1-6])>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = _URL_RE.sub("", text)
    text = _EMAIL_RE.sub("", text)
    text = _CDP_ID_RE.sub("", text)
    text = _CONV_ID_RE.sub("", text)
    text = _strip_ids(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _derive_intent(ctx: dict[str, Any]) -> str:
    activities = ctx.get("activities") or []
    meetings = [a for a in activities if a.get("type") == "meeting"]
    now = datetime.now(timezone.utc).timestamp() * 1000
    upcoming = False
    for m in meetings:
        due = m.get("dueAt")
        if due:
            try:
                ts = datetime.fromisoformat(due.replace("Z", "+00:00")).timestamp() * 1000
                if ts > now:
                    upcoming = True
            except Exception:
                pass
    bant = ctx.get("bant") or {}
    bant_score = sum(
        1 for k in ("budget", "authority", "need", "timeline") if bant.get(k)
    )
    if ctx.get("leadStatus") == "converted":
        return "Converted"
    if ctx.get("leadStatus") == "disqualified":
        return "Disqualified"
    band = (ctx.get("band") or "").lower()
    if band == "hot" or (ctx.get("deals") or []) or upcoming or bant_score >= 3:
        return "High buying intent"
    if band == "warm" or meetings or any(a.get("type") == "call" for a in activities):
        return "Active engagement"
    if activities:
        return "Exploratory"
    return "New lead"


def _fact_line(label: str, value: Any) -> str:
    if value is None or value == "":
        return f"{label}: unknown"
    return f"{label}: {value}"


def _build_facts(ctx: dict[str, Any]) -> list[str]:
    facts = [
        _fact_line("Name", ctx.get("displayName")),
        _fact_line("Title", ctx.get("title")),
        _fact_line("Company", ctx.get("companyName")),
        _fact_line("Industry", ctx.get("industry")),
        _fact_line("What the company does", ctx.get("companyDescription")),
        _fact_line("Their products", ctx.get("products")),
        _fact_line("Company size (employees)", ctx.get("employeeCount")),
        _fact_line("Domain", ctx.get("domain")),
        _fact_line("Geography", ", ".join(
            filter(None, [ctx.get("city"), ctx.get("country")])
        ) or None),
        _fact_line("Lifecycle stage", effective_contact_type(ctx.get("contactType"))),
        _fact_line("Lead status", ctx.get("leadStatus")),
        _fact_line("Lead source", ctx.get("leadSource")),
        (
            "BANT — "
            f"budget:{bool((ctx.get('bant') or {}).get('budget'))} "
            f"authority:{bool((ctx.get('bant') or {}).get('authority'))} "
            f"need:{bool((ctx.get('bant') or {}).get('need'))} "
            f"timeline:{bool((ctx.get('bant') or {}).get('timeline'))}"
        ),
        _fact_line("Total score", ctx.get("score")),
        _fact_line("Fit score", ctx.get("fitScore")),
        _fact_line("Intent score", ctx.get("intentScore")),
        _fact_line("Score band", ctx.get("band")),
        # Score rationale is background only — do not treat it as a citable source.
        # Passing it to the model caused "no recent activity" lines that contradict
        # nurture voice calls and CCaaS touches already on the timeline.
        _fact_line("Next best action (system)", ctx.get("nextBestAction")),
        _fact_line("Has email (CRM can send email)", ctx.get("hasEmail")),
        _fact_line("Has phone (CRM can call)", ctx.get("hasPhone")),
        "CRM outbound channels: email and call only. Never recommend WhatsApp, Instagram, SMS, or social.",
    ]
    breakdown = ctx.get("scoreBreakdown")
    if isinstance(breakdown, dict) and breakdown:
        parts = [f"{k}={v}" for k, v in breakdown.items()]
        facts.append("Score breakdown: " + ", ".join(parts))
    else:
        facts.append("Score breakdown: unknown")

    deals = ctx.get("deals") or []
    if deals:
        facts.append(
            "Deals: "
            + "; ".join(
                f"{d.get('title')} [{d.get('stage')}"
                + (f", {d.get('amount')}" if d.get("amount") else "")
                + "]"
                for d in deals
            )
        )
    else:
        facts.append("Deals: none")

    acts = ctx.get("activities") or []
    timeline = " | ".join(
        f"{a.get('type')}: {a.get('subject')}"
        + (
            f" — {_clean_summary_text(str(a.get('body') or ''))[:160]}"
            if a.get("body")
            else ""
        )
        for a in acts[:12]
    ) or "no activities yet"
    facts.append(f"Timeline (most recent first): {timeline}")
    facts.append("Citable sources (use only these ids):")
    citable = _citable_activities(ctx)
    if not citable:
        facts.append("No email, call, meeting, or message activities.")
    for activity in citable:
        body = _clean_summary_text(str(activity.get("body") or ""))[:400]
        transcript = str(activity.get("transcriptText") or "").strip()[:800]
        line = (
            f"- id={activity.get('id')} type={activity.get('type')} "
            f"subject={activity.get('subject') or ''}"
        )
        if body:
            line += f" body={body}"
        if transcript:
            line += f" transcript={transcript}"
        facts.append(line)
    omni = str(ctx.get("omniChannelSummary") or "").strip()
    if omni:
        facts.append("Omni-channel summary (CCaaS), sourceKind=omni:")
        facts.append(omni[:4000])
    else:
        facts.append("Omni-channel summary: none")
    manual_reason = str(ctx.get("manualScoreReason") or "").strip()
    if manual_reason:
        facts.append("Manual score reason, sourceKind=score:")
        facts.append(manual_reason[:1000])
    else:
        facts.append("Manual score reason: none")
    return facts


def _citable_activities(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for activity in ctx.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        if activity.get("type") not in CITABLE_ACTIVITY_TYPES:
            continue
        if not str(activity.get("id") or "").strip():
            continue
        rows.append(activity)
    return rows[:15]


_RAW_FACT = re.compile(r"^[a-z][A-Za-z0-9]*:\s*\d+\s*$")
_NO_ACTIVITY_CLAIM = re.compile(
    r"(?i)\b("
    r"no recorded recent activity|"
    r"no recent activity|"
    r"no signals of intent|"
    r"no engagement|"
    r"no emails?,?\s*calls?|"
    r"without any (recent )?(activity|engagement)"
    r")\b"
)


def _clamp_overview(raw: Any) -> str:
    """Keep the model's engagement paragraph. Cap it at five lines."""
    text = _clean_summary_text(str(raw or ""))
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines[:5])[:900]


def _is_pasted_activity(raw: str, cleaned: str) -> bool:
    """An activity line that is still the message or the invite is not a summary."""
    if _PASTE_RE.search(raw) or _PASTE_RE.search(cleaned):
        return True
    return len(cleaned.split()) > 45


def _is_readable_signal(text: str) -> bool:
    """Keep salesperson takeaways. Drop raw counters."""
    if _RAW_FACT.match(text):
        return False
    return 2 <= len(text.split()) <= 220


def _ctx_has_engagement(ctx: dict[str, Any]) -> bool:
    if _citable_activities(ctx):
        return True
    if str(ctx.get("omniChannelSummary") or "").strip():
        return True
    return False


def clamp_summary_lines(
    raw: Any,
    ctx: dict[str, Any],
) -> list[dict[str, Any]]:
    """Keep only lines backed by a real activity, CCaaS, or manual score reason."""
    if not isinstance(raw, list):
        raise ValueError("lines_missing")
    allowed = {str(a.get("id")): a for a in _citable_activities(ctx)}
    omni = str(ctx.get("omniChannelSummary") or "")
    has_engagement = _ctx_has_engagement(ctx)
    lines: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        raw_text = str(item.get("text") or "")
        text = _clean_summary_text(raw_text)
        if not text or not _is_readable_signal(text):
            continue
        if has_engagement and _NO_ACTIVITY_CLAIM.search(text):
            continue
        kind = str(item.get("sourceKind") or "").strip()
        if kind == "activity" and _is_pasted_activity(raw_text, text):
            continue
        text = text[:320] if kind == "activity" else text[:1200]
        if kind == "activity":
            source_id = str(item.get("sourceId") or "").strip()
            activity = allowed.get(source_id)
            if not activity:
                continue
            lines.append(
                {
                    "text": text,
                    "sourceKind": "activity",
                    "sourceId": source_id,
                    "activityType": activity.get("type"),
                    "conversationId": None,
                }
            )
        elif kind == "omni":
            if not omni.strip():
                continue
            lines.append(
                {
                    "text": text,
                    "sourceKind": "omni",
                    "sourceId": None,
                    "activityType": None,
                    "conversationId": None,
                }
            )
        elif kind == "score":
            if not str(ctx.get("manualScoreReason") or "").strip():
                continue
            lines.append(
                {
                    "text": text,
                    "sourceKind": "score",
                    "sourceId": None,
                    "activityType": None,
                    "conversationId": None,
                }
            )
    if not lines:
        raise ValueError("no_cited_lines")
    return lines[:20]


async def load_context(state: SummaryState) -> SummaryState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_summary_context(state["contact_id"])
    # CRM envelope may include statusCode/message — keep agent fields usable.
    if isinstance(ctx, dict):
        ctx = {k: v for k, v in ctx.items() if k not in {"statusCode", "message"}}
    return {**state, "context": ctx}


async def generate(state: SummaryState) -> SummaryState:
    ctx = state.get("context") or {}
    if not ctx or not ctx.get("contactId") and not ctx.get("displayName"):
        # contactId may only be in envelope; displayName is the real signal
        if not ctx.get("displayName") and not ctx.get("firstName"):
            return {
                **state,
                "status": "failed",
                "reason": "contact_not_found",
                "summary": "",
                "intent": "New lead",
                "source": "ai",
            }

    if not is_ai_configured():
        return {
            **state,
            "status": "failed",
            "reason": "llm_not_configured",
            "summary": "",
            "intent": _derive_intent(ctx),
            "source": "ai",
        }

    facts = _build_facts(ctx)

    def validate(payload: dict[str, Any]) -> dict[str, Any]:
        lines = clamp_summary_lines(payload.get("lines"), ctx)
        intent = str(payload.get("intent") or "").strip()[:80] or None
        action = str(payload.get("recommendedAction") or "").strip()[:240] or None
        if action:
            action = clamp_outreach_to_crm_channels(
                action,
                has_email=bool(ctx.get("hasEmail")),
                has_phone=bool(ctx.get("hasPhone")),
            )
        overview = _clamp_overview(payload.get("overview"))
        return {
            "lines": lines,
            "overview": overview,
            "intent": intent,
            "recommendedAction": action,
        }

    parsed, reason = await generate_json_with_retries(
        system=SUMMARY_SYSTEM,
        user="\n".join(facts),
        max_tokens=1800,
        timeout_ms=LLM_JOB_TIMEOUT_MS,
        validate=validate,
    )
    if not parsed or not parsed.get("lines"):
        return {
            **state,
            "status": "failed",
            "reason": reason or "llm_empty_response",
            "summary": "",
            "intent": None,
            "source": "ai",
        }

    lines = parsed["lines"]
    flags = {
        "fitScore": ctx.get("fitScore"),
        "intentScore": ctx.get("intentScore"),
        "band": ctx.get("band"),
        "score": ctx.get("score"),
        "citations": lines,
        "overview": parsed.get("overview") or "",
        "overviewReady": True,
    }
    return {
        **state,
        "summary": "\n\n".join(line["text"] for line in lines),
        "intent": parsed.get("intent"),
        "source": "ai",
        "recommended_action": parsed.get("recommendedAction") or ctx.get("nextBestAction"),
        "flags": flags,
        "status": "ok",
        "reason": None,
    }


async def persist(state: SummaryState) -> SummaryState:
    if state.get("status") != "ok":
        return state
    if state.get("source") != "ai" or not (state.get("summary") or "").strip():
        return {
            **state,
            "status": "failed",
            "reason": "refusing_non_ai_persist",
        }
    client = CrmClient(state.get("organization_id"))
    try:
        result = await client.persist_summary(
            state["contact_id"],
            {
                "contactId": state["contact_id"],
                "summary": state.get("summary"),
                "intent": state.get("intent"),
                "source": "ai",
                "force": bool(state.get("force")),
                "recommendedAction": state.get("recommended_action"),
                "flags": state.get("flags"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return {
            **state,
            "status": "failed",
            "reason": f"persist_failed:{type(exc).__name__}",
        }
    return {**state, "persist_result": result}


def _detail_load_context(_before: SummaryState, after: SummaryState) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {"hasCompany": bool(ctx.get("companyName")), "activityCount": len(ctx.get("activities") or [])}


def _detail_generate(_before: SummaryState, after: SummaryState) -> dict[str, Any] | None:
    return {"intent": after.get("intent"), "source": after.get("source")}


def _detail_persist(_before: SummaryState, after: SummaryState) -> dict[str, Any] | None:
    return {"persisted": bool(after.get("persist_result"))}


_PIPELINE_STEPS = (
    traced_step(
            SUMMARY_MODULE_PATH,
            SUMMARY_AGENT,
            "load_context",
            "Loading contact, score & activity context",
            _detail_load_context,
            job_id_field="job_id",
        )(load_context),
    traced_step(
            SUMMARY_MODULE_PATH,
            SUMMARY_AGENT,
            "generate",
            "Writing the executive summary",
            _detail_generate,
            job_id_field="job_id",
        )(generate),
    traced_step(
            SUMMARY_MODULE_PATH,
            SUMMARY_AGENT,
            "persist",
            "Saving the summary to the contact",
            _detail_persist,
            job_id_field="job_id",
        )(persist),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    contact_id: str,
    organization_id: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "contact_id": contact_id,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "force": force,
            "status": "running",
        }
    )
    return {
        "contactId": contact_id,
        "status": result.get("status") or "failed",
        "reason": result.get("reason"),
        "summary": result.get("summary") or "",
        "intent": result.get("intent") or "New lead",
        "source": result.get("source") or "ai",
        "recommendedAction": result.get("recommended_action"),
        "flags": result.get("flags"),
        "persistResult": result.get("persist_result"),
    }
