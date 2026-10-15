"""
Auto-reply Email Agent (LangGraph).

Three paths for inbound customer mail:
1. Demo / appointment — categories demo_ask_slot / demo_check_slot /
   demo_confirm_slot; CRM books on the mailbox recipient's Google Calendar
   (FreeBusy).
2. Product / help reply — infer implied need (they may not name a product),
   retrieve sales KB only when that need requires product/capability facts,
   extract relevant passages, and answer. Courtesy / ack mail skips KB.
3. Escalate — only real pricing/quote/invoice, legal/contract, payment
   disputes, confidential data, or serious complaints/security.

Intent is decided from the latest inbound email (quoted history ignored);
prior thread messages are supporting context only. Auto-reply and manual
escalation share this same classify → compose decision path.

Graph: load_context → classify → compose_or_escalate → persist → END
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, TypedDict, Optional
from zoneinfo import ZoneInfo

from app.agents.native_pipeline import run_steps

from app.agents.compose_email_agent import sanitize_email_closing
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.agents.step_trace import traced_step
from app.crm_client import CrmClient
from app.llm import generate_ai_text, is_ai_configured
from app.services.knowledge_base import get_sales_knowledge
from app.agents.crm_tools import effective_contact_type

logger = logging.getLogger(__name__)

AUTO_REPLY_MODULE_PATH = "auto-reply"
AUTO_REPLY_AGENT = "email_auto_reply"

SAFE = "safe_auto_reply"
SENSITIVE = "sensitive_escalate"
SKIP = "skip"

DEMO_TZ = ZoneInfo("Asia/Kolkata")

SENSITIVE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"\b(lawsuit|litigation|attorney|solicitor|legal counsel|cease and desist"
            r"|subpoena|court order|breach of contract|indemnif\w*|liabilit\w*)\b",
            re.I,
        ),
        "legal",
    ),
    (
        re.compile(
            r"\b(nda|non-?disclosure|msa|master service agreement|dpa"
            r"|data processing agreement|contract (?:review|amendment|termination)"
            r"|terms and conditions|sign(?:ed|ature) (?:the )?agreement"
            r"|legal (?:review|counsel|terms)|compliance (?:review|audit))\b",
            re.I,
        ),
        "contract",
    ),
    (
        re.compile(
            r"\b(gdpr|ccpa|hipaa|soc ?2|data (?:breach|deletion) request"
            r"|right to be forgotten|privacy complaint|compliance audit)\b",
            re.I,
        ),
        "compliance",
    ),
    (
        re.compile(
            r"\b(refund|chargeback|dispute|overcharged|billing error"
            r"|unauthori[sz]ed (?:charge|payment)|invoice discrepanc\w*"
            r"|billing dispute)\b",
            re.I,
        ),
        "billing_dispute",
    ),
    (
        re.compile(
            r"(?:send\s+(?:me\s+)?(?:a\s+)?(?:quote|quotation|proposal|invoice)"
            r"|\bhow much (?:does|do|is|are|would)\b|\bpricing\b|\bprice list\b"
            r"|\bunit price\b|\bprice per\b|\bquotation\b|\brfq\b"
            r"|we want to buy|proceed with purchase|start (?:a )?contract)",
            re.I,
        ),
        "pricing",
    ),
    (
        re.compile(
            r"\b(api[_ ]?key|password|credentials|access token"
            r"|(?:send|share|export|leak|dump)\w*\s+(?:me\s+)?(?:the\s+)?"
            r"(?:customer|client|internal)\s+data"
            r"|financial report|delete account|change ownership)\b",
            re.I,
        ),
        "confidential",
    ),
    (
        re.compile(
            r"\b(complaint|escalat\w+|unacceptable|extremely disappointed"
            r"|report you to|take (?:this|it) further)\b",
            re.I,
        ),
        "complaint",
    ),
    (
        re.compile(
            r"\b(security (?:incident|vulnerability)|penetration test|pen ?test"
            r"|breach notification)\b",
            re.I,
        ),
        "security",
    ),
]

NO_REPLY_RE = re.compile(
    r"\b(no-?reply|do-?not-?reply|mailer-daemon|postmaster|automated message"
    r"|out of office|auto(?:matic)? reply|delivery status notification|undeliverable)\b",
    re.I,
)

BULK_MAIL_RE = re.compile(
    r"(unsubscribe|manage (?:your )?(?:email )?preferences|update your preferences"
    r"|view (?:this email )?in (?:your )?browser"
    r"|you(?:'re| are) receiving this (?:email|message)"
    r"|verification code|security code|one-?time (?:password|code)|\botp\b"
    r"|\d-digit code|password reset|reset your (?:\w+ ){0,3}password|confirm your email"
    r"|weekly (?:summary|digest|report)|your receipt|payment (?:successful|received)"
    r"|do not share this code|usage (?:limit|alert)|bandwidth limit)",
    re.I,
)

DEMO_INTENT_RE = re.compile(
    r"\b(demo|product (?:demo|walkthrough|tour)|schedule (?:a )?(?:call|meeting|demo)"
    r"|book (?:a )?(?:demo|call)|walk ?through|show me (?:the )?product)\b",
    re.I,
)

# Routine capability questions — never escalate these as "sensitive".
PRODUCT_HELP_RE = re.compile(
    r"\b(?:which|what|how)\b.{0,100}\b(?:tool|tools|product|products|help|"
    r"offer|offering|solution|solutions|grow|growth|benefit|benefits)\b"
    r"|\bhow (?:can|do|would) (?:you|we|your (?:team|product|platform))\b"
    r"|\bwhat do you (?:offer|provide|sell|do)\b"
    r"|\bwhich (?:tool|product)s?\b",
    re.I,
)

COURTESY_ONLY_RE = re.compile(
    r"^\s*(thanks|thank you|thx|ok|okay|got it|received|noted|will do|"
    r"sounds good|perfect|great|sure)\s*[.!]?\s*$",
    re.I,
)

# Short buying-interest confirmations — not confidential, not a demo booking.
INTEREST_RE = re.compile(
    r"^\s*(?:yes[,.]?\s+)?(?:i(?:['’]?m| am)\s+)?interested\b"
    r"|^\s*yes[,.]?\s+(?:please|i(?:['’]?m| am) interested)\b"
    r"|^\s*count me in\b",
    re.I,
)

PROPOSAL_ACCEPT_RE = re.compile(
    r"\b(?:i\s+)?(?:accept(?:ed|ance)?|approve(?:d)?)\s+(?:the\s+)?"
    r"(?:proposal|quote|quotation)\b",
    re.I,
)

SLOT_CONFIRM_RE = re.compile(
    r"^\s*(?:yes[,.]?\s*)?(?:(?:it['’]?s|that(?:['’]?s)?|this)\s+)?"
    r"(?:fine|ok|okay|good|works?|perfect|great|sure|confirmed|alright|"
    r"all right|book it|let['’]?s do (?:it|that))\b",
    re.I,
)

_OUTBOUND_DEMO_OFFER_RE = re.compile(
    r"\b(demo|meeting|call|schedule|slot|calendar|invite|walkthrough)\b",
    re.I,
)

_IMPLIED_HELP_RE = re.compile(
    r"\b(grow|growth|revenue|scale|efficien|automat|streamline|"
    r"customer experience|how (?:can|do) you help|"
    r"what (?:can|do) you (?:do|offer|provide))\b",
    re.I,
)

_INTERNAL_KB_RE = re.compile(
    r"(?i)\b(product module|centralized repository for managing|pipeline: lead)\b"
)

_QUOTE_SPLIT_RE = re.compile(
    r"\n[ \t\u00A0\u202F]*>?[ \t]*On[\s\S]{5,320}?\bwrote:\s*",
    re.I,
)
_QUOTE_ONLY_RE = re.compile(r"^On\b[\s\S]{5,320}?\bwrote:\s*", re.I)
_FWD_SPLIT_RE = re.compile(
    r"\n(?:From:\s.+\n(?:Sent|Date):|-{2,}\s*Original Message)",
    re.I,
)
_HTML_QUOTE_RE = re.compile(
    r"(<div[^>]*\bclass=\"[^\"]*\bgmail_quote\b[^\"]*\"[^>]*>|"
    r"<div[^>]*\bid=\"divRplyFwdMsg\"[^>]*>|"
    r"<blockquote\b[^>]*>)",
    re.I,
)
_SYNC_HEADER_RE = re.compile(
    r"^From:\s*.+\nTo:\s*.+(?:\nCc:\s*.+)?\n+",
    re.I | re.M,
)


def _strip_inbound_sync_headers(text: str) -> str:
    """Drop Gmail-sync From/To/Cc block so short HTML replies stay readable."""
    stripped = _SYNC_HEADER_RE.sub("", text, count=1).strip()
    return stripped or text.strip()


class AutoReplyState(TypedDict, total=False):
    activity_id: str
    contact_id: str
    organization_id: Optional[str]
    context: dict[str, Any]
    decision: str
    sensitivity: str
    category: Optional[str]
    reason: Optional[str]
    reply_subject: Optional[str]
    reply_body: Optional[str]
    requested_start_iso: Optional[str]
    chosen_slot_iso: Optional[str]
    time_zone: Optional[str]
    status: str
    source: str
    persist_result: dict[str, Any]


def should_retrieve_kb(text: str) -> bool:
    """True when implied meaning needs product/capability facts — not every mail."""
    t = (text or "").strip()
    if not t or COURTESY_ONLY_RE.match(t):
        return False
    if re.search(r"\b(address|phone|office hours|unsubscribe)\b", t, re.I):
        return False
    if PRODUCT_HELP_RE.search(t) or _IMPLIED_HELP_RE.search(t):
        return True
    return bool(
        re.search(
            r"\b(tool|tools|product|products|feature|features|capabilit|"
            r"platform|solution|solutions|crm|offering)\b",
            t,
            re.I,
        )
    )


def heuristic_kb_query(
    latest: str,
    catalog: str = "",
    *,
    industry: str = "",
    title: str = "",
) -> str:
    """Semantic retrieve query from implied need — never the raw email."""
    names: list[str] = []
    for line in (catalog or "").splitlines():
        name = line.split(":", 1)[0].strip(" -•\t")
        if name and 2 <= len(name) <= 80:
            names.append(name)
    low = (latest or "").lower()
    themes: list[str] = []
    if re.search(r"\b(grow|growth|revenue|scale)\b", low):
        themes.append("company growth revenue scale")
    if re.search(r"\b(efficien|automat|streamline|process)\b", low):
        themes.append("automation efficiency processes")
    if re.search(r"\b(customer|support|service|experience)\b", low):
        themes.append("customer experience support")
    if not themes:
        themes.append("CRM AI products solutions customer benefits features")
    who = " ".join(p for p in (industry.strip(), title.strip()) if p)
    return " ".join(
        [
            "Worktual",
            " ".join(names[:6]),
            who,
            " ".join(themes),
            "capabilities benefits how it helps",
        ]
    ).strip()[:280]


def _clean_retrieved_kb(raw: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+|\n+", raw or "")
    kept: list[str] = []
    for part in parts:
        s = re.sub(r"\s+", " ", (part or "").strip())
        if len(s) < 40:
            continue
        if _INTERNAL_KB_RE.search(s):
            continue
        if re.match(r"(?i)^passage\s*:", s):
            s = re.sub(r"(?i)^passage\s*:\s*", "", s).strip()
        if s:
            kept.append(s)
        if len(" ".join(kept)) >= 3500:
            break
    return " ".join(kept)[:6000]


def _enrichment_map(ctx: dict[str, Any]) -> dict[str, Any]:
    raw = ctx.get("enrichment")
    return raw if isinstance(raw, dict) else {}


def customer_context_block(ctx: dict[str, Any]) -> str:
    """Lead enrichment + stored summary — who they are and what they do."""
    enr = _enrichment_map(ctx)
    lines = [
        f"Name: {ctx.get('contactName') or '—'}",
        f"Title: {ctx.get('contactTitle') or '—'}",
        f"Company: {ctx.get('companyName') or enr.get('companyName') or '—'}",
        f"Industry: {enr.get('industry') or ctx.get('companyIndustry') or '—'}",
        f"What they do: {enr.get('companyDescription') or '—'}",
        f"Their products: {enr.get('products') or '—'}",
        f"Company size: {enr.get('companySize') or '—'}",
        f"Geography: {enr.get('geography') or '—'}",
        f"Seniority: {enr.get('seniorityTier') or '—'}",
        f"Lifecycle: {effective_contact_type(ctx.get('contactType'))}",
        f"Lead status: {ctx.get('leadStatus') or '—'}",
        f"Lead intent: {ctx.get('leadIntent') or '—'}",
        f"Headline: {ctx.get('leadHeadline') or '—'}",
        f"Recommended action: {ctx.get('recommendedAction') or '—'}",
    ]
    summary = str(ctx.get("leadSummary") or "").strip()
    block = "CUSTOMER PROFILE (from lead enrichment + summary — do not invent beyond this):\n"
    block += "\n".join(f"- {line}" for line in lines)
    if summary:
        block += f"\nLead summary:\n{summary[:1800]}"
    else:
        block += "\nLead summary: (none stored yet)"
    return block


async def plan_kb_retrieve(
    latest: str,
    catalog: str = "",
    ctx: dict[str, Any] | None = None,
) -> tuple[bool, str, str]:
    """Decide whether to call KB and with which semantic query.

    Heuristic gate only — the compose LLM still writes the reply. An extra
    plan-LLM round-trip was blowing the CRM job timeout so persist never ran.
    """
    ctx = ctx or {}
    enr = _enrichment_map(ctx)
    industry = str(enr.get("industry") or ctx.get("companyIndustry") or "")
    title = str(ctx.get("contactTitle") or "")
    heuristic_need = should_retrieve_kb(latest)
    if not heuristic_need:
        return False, "", ""
    return (
        True,
        heuristic_kb_query(latest, catalog, industry=industry, title=title),
        "product help",
    )


def latest_inbound_text(ctx: dict[str, Any] | str | None) -> str:
    """Customer-written part of the latest inbound — ignore Gmail quote history."""
    if isinstance(ctx, dict):
        body = (ctx.get("body") or "").strip()
    else:
        body = (ctx or "").strip()
    if not body:
        return ""

    html_cut = _HTML_QUOTE_RE.search(body)
    if html_cut and html_cut.start() > 8:
        snippet = body[: html_cut.start()]
        snippet = re.sub(r"<[^>]+>", " ", snippet)
        snippet = re.sub(r"\s+", " ", snippet).strip()
        snippet = _strip_inbound_sync_headers(snippet)
        if snippet:
            return snippet

    if _QUOTE_ONLY_RE.search(body) and ("\n>" in body or ">" in body):
        return ""
    split = _QUOTE_SPLIT_RE.search(body)
    if split and split.start() > 0:
        return _strip_inbound_sync_headers(body[: split.start()].strip())
    fwd = _FWD_SPLIT_RE.search(body)
    if fwd and fwd.start() > 20:
        return _strip_inbound_sync_headers(body[: fwd.start()].strip())
    plain = _strip_inbound_sync_headers(body)
    if re.search(r"<[a-z][\s/>]", plain, re.I):
        plain = re.sub(r"<[^>]+>", " ", plain)
        plain = re.sub(r"\s+", " ", plain).strip()
    return plain


def _first_name(full_name: str | None) -> str:
    name = (full_name or "").strip()
    return name.split(" ")[0] if name else "there"


def _sender_org_name(ctx: dict[str, Any]) -> str:
    org = str(
        ctx.get("senderOrganizationName")
        or ctx.get("organizationName")
        or ""
    ).strip()
    customer = str(ctx.get("companyName") or "").strip()
    if org and customer and org.lower() == customer.lower():
        return "Worktual"
    return org or "Worktual"


def _support_signoff(ctx: dict[str, Any]) -> str:
    return f"Best regards,\n{_sender_org_name(ctx)}"


def _tz_name(ctx: dict[str, Any]) -> str:
    return (ctx.get("timezone") or "Asia/Kolkata").strip() or "Asia/Kolkata"


def _parse_preferred_dt(
    text: str,
    tz_name: str = "Asia/Kolkata",
    *,
    allow_past: bool = False,
) -> datetime | None:
    """Best-effort local datetime → aware UTC datetime."""
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw:
        return None
    try:
        tz = ZoneInfo(tz_name)
    except Exception:  # noqa: BLE001
        tz = DEMO_TZ

    now = datetime.now(tz)

    iso = re.search(
        r"\b(20\d{2})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\b", raw
    )
    if iso:
        try:
            local = datetime(
                int(iso.group(1)),
                int(iso.group(2)),
                int(iso.group(3)),
                int(iso.group(4)),
                int(iso.group(5)),
                tzinfo=tz,
            )
            if local > now - timedelta(minutes=1):
                return local.astimezone(timezone.utc)
        except ValueError:
            pass

    day_offset = 0
    if re.search(r"\btomorrow\b", raw, re.I):
        day_offset = 1
    elif re.search(r"\bday after tomorrow\b", raw, re.I):
        day_offset = 2
    elif re.search(r"\btoday\b", raw, re.I):
        day_offset = 0

    hour: int | None = None
    minute = 0
    ampm = ""
    tm = re.search(
        r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b", raw, re.I
    )
    tm24 = re.search(r"\bat\s+(\d{1,2}):(\d{2})\b", raw, re.I)
    dotted = re.search(
        r"(?<!\d)(\d{1,2})\.(\d{1,2})(?!\d)(?:\s*(am|pm|a\.m\.|p\.m\.))?",
        raw,
        re.I,
    )
    dotted_decimal_time = (
        dotted
        and tm
        and tm.start() > 0
        and raw[tm.start() - 1] == "."
    )
    if dotted and (dotted_decimal_time or not tm or not tm.group(2)):
        hour = int(dotted.group(1))
        frac_raw = dotted.group(2)
        frac = int(frac_raw)
        minute = 30 if len(frac_raw) == 1 and frac == 5 else (
            frac * 10 if len(frac_raw) == 1 else frac
        )
        if minute >= 60:
            return None
        ampm = (dotted.group(3) or "").replace(".", "").lower()
    elif tm:
        hour = int(tm.group(1))
        minute = int(tm.group(2) or 0)
        ampm = tm.group(3).replace(".", "").lower()
    elif tm24:
        hour = int(tm24.group(1))
        minute = int(tm24.group(2))
    elif dotted:
        hour = int(dotted.group(1))
        frac_raw = dotted.group(2)
        frac = int(frac_raw)
        minute = 30 if len(frac_raw) == 1 and frac == 5 else (
            frac * 10 if len(frac_raw) == 1 else frac
        )
        if minute >= 60:
            return None
        ampm = (dotted.group(3) or "").replace(".", "").lower()
    if hour is not None:
        if ampm.startswith("p") and hour < 12:
            hour += 12
        elif ampm.startswith("a") and hour == 12:
            hour = 0
        elif not ampm and 1 <= hour <= 7:
            hour += 12
        if hour >= 24:
            day_offset += hour // 24
            hour %= 24

    if hour is None:
        if day_offset == 0 and not re.search(r"\btoday\b|\btomorrow\b", raw, re.I):
            return None
        hour = 10

    try:
        base = (now + timedelta(days=day_offset)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
    except ValueError:
        return None
    if base <= now - timedelta(minutes=1):
        if allow_past:
            return base.astimezone(timezone.utc)
        return None
    return base.astimezone(timezone.utc)


def _demo_ask_body(ctx: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Hi {_first_name(ctx.get('contactName'))},",
            "",
            "Thanks for your interest — we'd be happy to schedule a product demo.",
            "",
            "Could you share your preferred date and time (with timezone if you're "
            "not on IST)? We'll check availability and confirm a slot.",
            "",
            _support_signoff(ctx),
        ]
    )


def _reply_subject(subject: str | None) -> str:
    clean = (subject or "your message").strip()
    if not re.match(r"^re:", clean, re.I):
        clean = f"Re: {clean}"
    return clean[:180]


def _latest_outbound_demo_offer_iso(ctx: dict[str, Any]) -> str | None:
    tz_name = _tz_name(ctx)
    messages = ctx.get("thread") or []
    outbounds = [m for m in messages if m.get("direction") == "outbound"][-6:]
    for m in reversed(outbounds):
        body = str(m.get("body") or "")
        if not _OUTBOUND_DEMO_OFFER_RE.search(body):
            continue
        parsed = _parse_preferred_dt(body, tz_name, allow_past=True)
        if parsed:
            return parsed.isoformat().replace("+00:00", "Z")
    return None


def _thread_offered_demo(ctx: dict[str, Any]) -> bool:
    for m in ctx.get("thread") or []:
        if m.get("direction") != "outbound":
            continue
        if _OUTBOUND_DEMO_OFFER_RE.search(str(m.get("body") or "")):
            return True
    return False


def _scheduling_thread_active(ctx: dict[str, Any]) -> bool:
    """True when this thread (not another contact thread) is in demo scheduling."""
    return _thread_offered_demo(ctx) or bool(_latest_outbound_demo_offer_iso(ctx))


def _guard_demo_booking(guard: dict[str, Any]) -> bool:
    category = str(guard.get("category") or "")
    return category.startswith("demo_") or bool(
        guard.get("requestedStartIso") or guard.get("chosenSlotIso")
    )


def heuristic_classify(ctx: dict[str, Any]) -> dict[str, Any]:
    """Deterministic guardrail — also the fallback when no LLM is configured.

    Intent signals come from the latest inbound subject+body only (quoted
    history is ignored). Open demoState is the sole thread-level exception.
    """
    full_body = (ctx.get("body") or "").strip()
    latest = latest_inbound_text(ctx)
    subject = ctx.get("subject") or ""
    haystack = f"{subject}\n{latest}"
    tz_name = _tz_name(ctx)
    demo_state = ctx.get("demoState") or None

    if len(full_body) < 8:
        return {"decision": SKIP, "sensitivity": "unknown", "reason": "empty_body"}
    if not latest.strip() and not (
        isinstance(demo_state, dict) and demo_state.get("phase") not in (None, "booked")
    ):
        return {"decision": SKIP, "sensitivity": "unknown", "reason": "quote_only_body"}

    if NO_REPLY_RE.search(haystack) or NO_REPLY_RE.search(ctx.get("contactEmail") or ""):
        return {
            "decision": SKIP,
            "sensitivity": "unknown",
            "reason": "automated_sender",
        }

    if BULK_MAIL_RE.search(haystack):
        return {
            "decision": SKIP,
            "sensitivity": "unknown",
            "reason": "bulk_or_transactional_mail",
        }

    for pattern, category in SENSITIVE_PATTERNS:
        if pattern.search(latest):
            label = category.replace("_", " ")
            return {
                "decision": SENSITIVE,
                "sensitivity": "sensitive",
                "category": category,
                "reason": f"Detected {label} language that needs a human response.",
            }

    outbound_offer = _latest_outbound_demo_offer_iso(ctx)
    scheduling_ctx = _scheduling_thread_active(ctx)
    parsed_latest = _parse_preferred_dt(latest, tz_name, allow_past=scheduling_ctx)
    if outbound_offer and (
        SLOT_CONFIRM_RE.search(latest.strip()) or INTEREST_RE.search(latest.strip())
    ):
        return {
            "decision": SAFE,
            "sensitivity": "safe",
            "category": "demo_confirm_slot",
            "reason": "Lead confirmed the proposed demo time.",
            "chosenSlotIso": outbound_offer,
            "timeZone": tz_name,
        }

    if INTEREST_RE.search(latest.strip()):
        return {
            "decision": SAFE,
            "sensitivity": "safe",
            "category": "general",
            "reason": "Customer confirmed interest — continue the conversation.",
        }

    if PROPOSAL_ACCEPT_RE.search(latest.strip()):
        return {
            "decision": SAFE,
            "sensitivity": "safe",
            "category": "general",
            "reason": "Customer accepted the proposal — continue the conversation.",
        }

    parsed = parsed_latest or _parse_preferred_dt(
        haystack, tz_name, allow_past=scheduling_ctx
    )
    open_demo_on_thread = (
        isinstance(demo_state, dict)
        and demo_state.get("phase") not in (None, "booked")
        and _thread_offered_demo(ctx)
    )
    if parsed_latest and (
        DEMO_INTENT_RE.search(latest)
        or _thread_offered_demo(ctx)
        or open_demo_on_thread
    ):
        return {
            "decision": SAFE,
            "sensitivity": "safe",
            "category": "demo_check_slot",
            "reason": "Lead shared a preferred demo date/time.",
            "requestedStartIso": parsed_latest.isoformat().replace("+00:00", "Z"),
            "timeZone": tz_name,
        }

    if open_demo_on_thread:
        proposed = demo_state.get("proposedSlots") or []
        if demo_state.get("phase") == "propose_alts" and proposed:
            num = re.search(r"\b([1-3])\b", haystack)
            if num:
                idx = int(num.group(1)) - 1
                if 0 <= idx < len(proposed):
                    return {
                        "decision": SAFE,
                        "sensitivity": "safe",
                        "category": "demo_confirm_slot",
                        "reason": "Lead confirmed a proposed demo slot.",
                        "chosenSlotIso": proposed[idx],
                        "timeZone": tz_name,
                    }
        if parsed:
            return {
                "decision": SAFE,
                "sensitivity": "safe",
                "category": "demo_check_slot",
                "reason": "Lead shared a preferred demo date/time.",
                "requestedStartIso": parsed.isoformat().replace("+00:00", "Z"),
                "timeZone": tz_name,
            }
        return {
            "decision": SAFE,
            "sensitivity": "safe",
            "category": "demo_ask_slot",
            "reason": "Still waiting for a preferred demo date/time.",
            "timeZone": tz_name,
            "replySubject": _reply_subject(subject),
            "replyBody": _demo_ask_body(ctx),
        }

    if DEMO_INTENT_RE.search(latest):
        if parsed:
            return {
                "decision": SAFE,
                "sensitivity": "safe",
                "category": "demo_check_slot",
                "reason": "Demo request includes a preferred date/time.",
                "requestedStartIso": parsed.isoformat().replace("+00:00", "Z"),
                "timeZone": tz_name,
            }
        return {
            "decision": SAFE,
            "sensitivity": "safe",
            "category": "demo_ask_slot",
            "reason": "Demo request — ask for preferred date and time.",
            "timeZone": tz_name,
            "replySubject": _reply_subject(subject),
            "replyBody": _demo_ask_body(ctx),
        }

    return {
        "decision": SAFE,
        "sensitivity": "safe",
        "category": "general",
        "reason": "Routine inbound message with no sensitive signals.",
    }


def heuristic_reply(_ctx: dict[str, Any]) -> dict[str, str] | None:
    """No invented fallback — caller must escalate when this returns None."""
    return None


def _thread_digest(ctx: dict[str, Any], limit: int = 6) -> str:
    messages = (ctx.get("thread") or [])[-limit:]
    lines: list[str] = []
    for m in messages:
        who = "Customer" if m.get("direction") == "inbound" else "Us"
        text = (m.get("body") or "").strip().replace("\n", " ")[:400]
        lines.append(f"{who}: {text}")
    return "\n".join(lines) or "(no prior messages)"


def _classify_system(demo_hint: str = "", customer_block: str = "") -> str:
    context_parts = [
        customer_block.strip()
        or "No lead summary/enrichment stored yet — use name/company from the email only.",
        demo_hint.strip() or "No open demo booking on this thread.",
    ]
    return sectioned_system_prompt(
        role=(
            "You are Worktual's inbound email triage agent. You already know "
            "this lead from CRM enrichment and their lead summary."
        ),
        goal=(
            "Decide whether we can auto-reply, book a demo, skip, or escalate "
            "to a human. Use the customer profile to understand who they are "
            "and what they do; decide intent only from the latest message."
        ),
        instructions=(
            "Decide intent ONLY from the Latest message (body + subject).\n"
            "Use the customer profile (title, company, industry, lead summary) "
            "as background — e.g. they sell customer support software — not as "
            "a reason to escalate.\n"
            "Prior conversation is supporting context only (pronouns, short "
            '"yes" / "option 2"). Never let an older topic override what they '
            "ask now.\n"
            "Decision tree for the Latest message:\n"
            "1) skip — automated / bulk / no-reply mail ONLY. Never skip when "
            "an open demo booking is noted and the latest message is a date, "
            "time, yes/ok, or slot number.\n"
            "2) Demo — they explicitly want a meeting, call, or demo, OR an open "
            "demo booking is noted and they are picking a slot / sharing a time, "
            "OR they reply yes/ok/it's fine after we proposed a time, OR they "
            "send only a time (today 6.30, 6.18) after we offered to schedule. "
            "Categories: demo_ask_slot / demo_check_slot / demo_confirm_slot. "
            "decision=safe_auto_reply.\n"
            "3) sensitive_escalate — they clearly ask for a price, quote, "
            "quotation, proposal, invoice, payment/billing dispute, "
            "legal/contract/compliance review, confidential credentials, a "
            "security incident, or a serious complaint.\n"
            "4) safe_auto_reply + category general — product/help/how-you-help/"
            "growth questions, onboarding, and short interest confirmations "
            '("yes I am interested"). Not demo unless they ask to meet.'
        ),
        context="\n\n".join(context_parts),
        output=(
            "Return ONLY JSON: "
            '{"decision":"safe_auto_reply"|"sensitive_escalate"|"skip",'
            '"category":"short_snake_case","reason":"one short sentence",'
            '"requestedStartIso":"ISO8601 or null","chosenSlotIso":"ISO8601 or null",'
            '"timeZone":"IANA timezone"}.'
        ),
        guardrails=(
            "Do not escalate merely because an older thread message was sensitive.\n"
            'Do not escalate "how can you help", "which tools", "how do you help '
            'us grow", or "yes I am interested".\n'
            "Ignore quoted/forwarded history. Our own pitch mentioning "
            '"customer data" is not confidential.\n'
            "Do not invent facts about their company beyond the profile.\n"
            "When an open demo booking is active, short replies like "
            '"today 8 pm", "8pm", or "tomorrow 3" are slot picks — never skip '
            "as empty.\n"
            "When unsure between general help vs sensitive: choose "
            "safe_auto_reply unless they clearly asked for price, legal, or "
            "confidential credentials."
        ),
    )


def _compose_system(customer_block: str = "") -> str:
    return sectioned_system_prompt(
        role=(
            "You are a Worktual sales teammate writing an inbound email reply. "
            "You already researched this lead (enrichment + lead summary)."
        ),
        goal=(
            "Answer the latest message in a way that shows you understand who "
            "they are and what their company does, using KB/catalog only for "
            "how Worktual can help that world."
        ),
        instructions=(
            "Answer the Latest message first. Prior thread is continuity only.\n"
            "Read the customer profile: role, company, industry, and lead "
            "summary. Tailor one or two sentences to their world "
            "(e.g. a Zendesk PM → CX / support ops / growth, not generic "
            '"businesses"). Do not paste or recap the whole summary.\n'
            "Infer implied need even if they do not name a product.\n"
            'Treat "tools" as products.\n'
            "When KB is present, extract only passages that fit their implied "
            "need and industry; ignore unrelated chunks and retrieval metadata.\n"
            "If KB is thin, use catalog names (no prices) still tied to their "
            "role/industry, and still answer.\n"
            "Interest confirmations: thank them, connect one relevant "
            "capability to their company/role, invite a simple next step. "
            "Do not push a demo unless they asked to meet.\n"
            "Courtesy-only messages: short ack, no pitch.\n"
            "Lead with the answer; match length to the question.\n"
            "Plain text only. No filler. End with a light follow-up, then the "
            "exact sign-off line (sender organization only — never the "
            "customer's company, never 'Support Team')."
        ),
        context=(
            customer_block.strip()
            or "No lead summary/enrichment stored yet — do not invent a company story."
        ),
        output=(
            'Return ONLY JSON: {"subject":"...","body":"...","grounded":true|false}.'
        ),
        guardrails=(
            "Never invent prices, legal terms, dates, or commitments.\n"
            "Never invent facts about their company, product, or role that are "
            "not in the customer profile / lead summary / latest email.\n"
            "Do not refuse because they did not name an exact product.\n"
            "Do not mention meetings unless they asked.\n"
            "Never claim a calendar invite was sent or that a meeting is "
            "scheduled — the CRM books meetings separately.\n"
            "Sign off with Best regards, then the sender organization name only. "
            "Never the customer company. Never 'Support Team'.\n"
            "Set grounded=false only when you cannot say anything useful at all."
        ),
    )


async def load_context(state: AutoReplyState) -> AutoReplyState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_auto_reply_context(state["activity_id"])
    return {**state, "context": ctx}


async def classify(state: AutoReplyState) -> AutoReplyState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": SKIP,
            "sensitivity": "unknown",
            "reason": "activity_not_found",
            "status": "skipped",
            "source": "heuristic",
        }

    guard = heuristic_classify(ctx)
    tz_name = _tz_name(ctx)
    decision: dict[str, Any]
    source = "ai"
    reason: str | None = None

    # Slot replies on active scheduling threads — deterministic, no LLM skip risk.
    if (
        guard.get("decision") == SAFE
        and guard.get("category") in {"demo_check_slot", "demo_confirm_slot"}
        and _scheduling_thread_active(ctx)
    ):
        decision = dict(guard)
        source = "heuristic"
        reason = guard.get("reason")
    # Hard skips (empty / automated / bulk) — no LLM needed.
    elif guard["decision"] == SKIP and guard.get("reason") in {
        "empty_body",
        "quote_only_body",
        "automated_sender",
        "bulk_or_transactional_mail",
    }:
        decision = dict(guard)
        source = "heuristic"
        reason = guard.get("reason")
    elif is_ai_configured():
        demo_state = ctx.get("demoState")
        demo_hint = ""
        if isinstance(demo_state, dict):
            demo_hint = (
                f" Open demo booking phase={demo_state.get('phase')}; "
                f"proposedSlots={demo_state.get('proposedSlots') or []}."
            )
        customer_block = customer_context_block(ctx)

        def _validate_classify(parsed: dict[str, Any]) -> dict[str, Any] | None:
            if parsed.get("decision") not in {SAFE, SENSITIVE, SKIP}:
                return None
            d = parsed["decision"]
            return {
                "decision": d,
                "sensitivity": (
                    "sensitive"
                    if d == SENSITIVE
                    else "safe"
                    if d == SAFE
                    else "unknown"
                ),
                "category": str(parsed.get("category") or "general")[:60],
                "reason": str(parsed.get("reason") or "")[:280] or None,
                "requestedStartIso": parsed.get("requestedStartIso"),
                "chosenSlotIso": parsed.get("chosenSlotIso"),
                "timeZone": parsed.get("timeZone") or tz_name,
            }

        classified, llm_reason = await generate_json_with_retries(
            system=_classify_system(demo_hint, customer_block),
            user="\n".join(
                [
                    customer_block,
                    "",
                    f"From: {ctx.get('contactName')} <{ctx.get('contactEmail') or '—'}>",
                    f"Timezone default: {tz_name}",
                    "",
                    "Prior conversation (supporting context only — do not override "
                    "intent of the Latest message):",
                    _thread_digest(ctx),
                    "",
                    f"Latest message subject: {ctx.get('subject')}",
                    "Latest message (PRIMARY — decide intent from this; quoted "
                    "history already removed):",
                    latest_inbound_text(ctx)[:2500] or (ctx.get("body") or "")[:2500],
                ]
            ),
            max_tokens=1200,
            repair_hint=(
                "Convert into ONLY classify JSON with decision "
                "(safe_auto_reply|sensitive|skip), category, reason."
            ),
            validate=_validate_classify,
        )
        if classified:
            decision = classified
        elif guard["decision"] == SENSITIVE:
            # Safety: keep sensitive escalate when LLM fails.
            decision = dict(guard)
            source = "heuristic"
            reason = llm_reason or "llm_failed_keep_sensitive"
        else:
            # Do not invent a safe auto-reply — escalate for human when LLM down.
            decision = {
                "decision": SENSITIVE,
                "sensitivity": "sensitive",
                "category": "llm_unavailable",
                "reason": (
                    f"LLM classify unavailable ({llm_reason or 'unknown'}) — "
                    "escalating instead of heuristic auto-reply."
                ),
                "requestedStartIso": None,
                "chosenSlotIso": None,
                "timeZone": tz_name,
            }
            source = "heuristic"
            reason = llm_reason or "llm_failed_escalate"
    else:
        # LLM not configured: hard-skip/sensitive only — never invent safe reply.
        if guard["decision"] == SENSITIVE:
            decision = dict(guard)
            source = "heuristic"
            reason = "llm_not_configured"
        elif guard["decision"] == SKIP:
            decision = dict(guard)
            source = "heuristic"
            reason = "llm_not_configured"
        else:
            decision = {
                "decision": SENSITIVE,
                "sensitivity": "sensitive",
                "category": "llm_unavailable",
                "reason": "LLM not configured — escalate instead of heuristic auto-reply.",
                "requestedStartIso": None,
                "chosenSlotIso": None,
                "timeZone": tz_name,
            }
            source = "heuristic"
            reason = "llm_not_configured"

    # Post-LLM safety: never auto-reply when heuristic detected sensitive.
    if guard["decision"] == SENSITIVE and decision.get("decision") == SAFE:
        decision = dict(guard)

    # Do not let the LLM escalate a normal inbound when heuristics say it is safe.
    latest = latest_inbound_text(ctx)
    open_demo = (
        isinstance(ctx.get("demoState"), dict)
        and ctx["demoState"].get("phase") not in (None, "booked")
        and _scheduling_thread_active(ctx)
    )
    latest_wants_demo = bool(DEMO_INTENT_RE.search(latest))
    if (
        decision.get("decision") == SENSITIVE
        and guard["decision"] == SAFE
        and not any(pattern.search(latest) for pattern, _ in SENSITIVE_PATTERNS)
    ):
        decision = dict(guard)

    scheduling_active = _scheduling_thread_active(ctx)
    parsed_latest = _parse_preferred_dt(latest, tz_name)

    # Lead summary / recommendedAction often mentions "demo". That must not
    # turn a product question or "I'm interested" into a demo booking.
    # Follow-up times on an active scheduling thread (including after a prior
    # booked demo) must still reach the CRM booking path.
    if (
        decision.get("decision") == SAFE
        and str(decision.get("category") or "").lower().startswith("demo_")
        and not latest_wants_demo
        and not open_demo
        and not (
            scheduling_active
            and (
                _guard_demo_booking(guard)
                or parsed_latest
                or decision.get("requestedStartIso")
                or decision.get("chosenSlotIso")
            )
        )
    ):
        decision = dict(guard)
        decision["category"] = "general"
        decision.pop("requestedStartIso", None)
        decision.pop("chosenSlotIso", None)

    # Prefer heuristic demo_* categories — the LLM invents labels like
    # "demo_request" which would skip the CRM booking path.
    if (
        decision.get("decision") == SAFE
        and str(guard.get("category") or "").startswith("demo_")
        and (latest_wants_demo or open_demo or scheduling_active)
    ):
        decision["category"] = guard["category"]
        if guard.get("requestedStartIso") and not decision.get("requestedStartIso"):
            decision["requestedStartIso"] = guard["requestedStartIso"]
        if guard.get("chosenSlotIso") and not decision.get("chosenSlotIso"):
            decision["chosenSlotIso"] = guard["chosenSlotIso"]
        decision["timeZone"] = (
            decision.get("timeZone") or guard.get("timeZone") or tz_name
        )
        if guard.get("replySubject"):
            decision["replySubject"] = guard.get("replySubject")
        if guard.get("replyBody"):
            decision["replyBody"] = guard.get("replyBody")
    elif decision.get("decision") == SAFE and (
        latest_wants_demo or open_demo or scheduling_active
    ):
        cat = str(decision.get("category") or "").lower()
        if cat.startswith("demo_") or "walkthrough" in cat or cat in {
            "schedule_call",
            "schedule_meeting",
            "demo_request",
        }:
            if decision.get("chosenSlotIso"):
                decision["category"] = "demo_confirm_slot"
            elif decision.get("requestedStartIso") or guard.get("requestedStartIso"):
                decision["category"] = "demo_check_slot"
                if not decision.get("requestedStartIso"):
                    decision["requestedStartIso"] = guard.get("requestedStartIso")
            else:
                decision["category"] = "demo_ask_slot"
                decision["replySubject"] = decision.get("replySubject") or guard.get(
                    "replySubject"
                )
                decision["replyBody"] = decision.get("replyBody") or guard.get(
                    "replyBody"
                )
            decision["timeZone"] = (
                decision.get("timeZone") or guard.get("timeZone") or tz_name
            )

    # LLM sometimes returns skip/empty on short slot replies ("today 8 pm")
    # while heuristics already parsed an open demo thread — trust heuristics.
    skip_cat = str(decision.get("category") or "").lower()
    if decision.get("decision") == SKIP and (
        str(decision.get("reason") or "").lower().find("empty") >= 0
        or skip_cat in {"empty_input", "unknown", ""}
    ):
        if (
            guard.get("decision") == SAFE
            and str(guard.get("category") or "").startswith("demo_")
            and (
                open_demo
                or scheduling_active
                or guard.get("requestedStartIso")
                or guard.get("chosenSlotIso")
            )
        ):
            decision = dict(guard)
            source = "heuristic"
            reason = reason or "llm_skip_overridden_demo_thread"
        elif scheduling_active and parsed_latest:
            decision = {
                "decision": SAFE,
                "sensitivity": "safe",
                "category": "demo_check_slot",
                "reason": "Lead shared a preferred demo date/time.",
                "requestedStartIso": parsed_latest.isoformat().replace(
                    "+00:00", "Z"
                ),
                "timeZone": tz_name,
            }
            source = "heuristic"
            reason = reason or "llm_skip_overridden_parsed_slot"
    elif (
        decision.get("decision") == SKIP
        and guard.get("decision") == SAFE
        and str(guard.get("category") or "").startswith("demo_")
        and (
            open_demo
            or scheduling_active
            or guard.get("requestedStartIso")
            or guard.get("chosenSlotIso")
        )
    ):
        decision = dict(guard)
        source = "heuristic"
        reason = reason or "llm_skip_overridden_demo_thread"

    return {
        **state,
        "decision": decision["decision"],
        "sensitivity": decision.get("sensitivity") or "unknown",
        "category": decision.get("category"),
        "reason": decision.get("reason") or reason,
        "requested_start_iso": decision.get("requestedStartIso"),
        "chosen_slot_iso": decision.get("chosenSlotIso"),
        "time_zone": decision.get("timeZone") or tz_name,
        "reply_subject": decision.get("replySubject") or guard.get("replySubject"),
        "reply_body": decision.get("replyBody") or guard.get("replyBody"),
        "status": "classified",
        "source": source,
    }


def _compose_failed_escalate(
    state: AutoReplyState,
    reason: str,
    *,
    category: str = "compose_failed",
) -> AutoReplyState:
    return {
        **state,
        "decision": SENSITIVE,
        "sensitivity": "sensitive",
        "category": category,
        "reason": reason,
        "reply_subject": None,
        "reply_body": None,
    }


async def compose_or_escalate(state: AutoReplyState) -> AutoReplyState:
    if state.get("decision") != SAFE:
        return state

    category = state.get("category") or "general"
    ctx = state.get("context") or {}

    # CRM fills confirmation / proposes alts after FreeBusy — agent only drafts ask.
    if category in {"demo_check_slot", "demo_confirm_slot"}:
        return {
            **state,
            "reply_subject": state.get("reply_subject") or _reply_subject(ctx.get("subject")),
            "reply_body": None,
        }

    if category == "demo_ask_slot":
        return {
            **state,
            "reply_subject": state.get("reply_subject") or _reply_subject(ctx.get("subject")),
            "reply_body": state.get("reply_body") or _demo_ask_body(ctx),
        }

    # General path: infer implied need → retrieve KB only when needed → LLM compose.
    latest = latest_inbound_text(ctx)
    catalog = str(ctx.get("productCatalog") or "").strip()
    need_kb, kb_query, implied_need = await plan_kb_retrieve(latest, catalog, ctx)

    kb_context = ""
    if need_kb and kb_query:
        logger.info(
            "auto-reply kb retrieve activity=%s query=%s",
            state.get("activity_id"),
            kb_query[:120],
        )
        kb = await get_sales_knowledge(kb_query, limit=4)
        if isinstance(kb, dict) and kb.get("status") == "success":
            kb_context = _clean_retrieved_kb(str(kb.get("context") or ""))
    elif not need_kb:
        logger.info(
            "auto-reply skip kb activity=%s",
            state.get("activity_id"),
        )

    if not is_ai_configured():
        return _compose_failed_escalate(
            state,
            "LLM not configured — escalate instead of heuristic auto-reply.",
            category="llm_unavailable",
        )

    signoff = _support_signoff(ctx)
    customer_block = customer_context_block(ctx)
    raw = await generate_ai_text(
        system=_compose_system(customer_block),
        user="\n".join(
            [
                customer_block,
                "",
                f"Reply to: {ctx.get('contactName')} <{ctx.get('contactEmail') or '—'}>",
                f"Subject: {ctx.get('subject')}",
                f"Sign-off (use exactly):\n{signoff}",
                "",
                "Implied need (meaning, not exact wording):",
                implied_need or "(infer from the latest message)",
                "",
                "KNOWLEDGE BASE (use only what fits their implied need + industry):",
                kb_context[:6000] if kb_context else "(not retrieved or empty)",
                "",
                "PRODUCT CATALOG (names only — no prices):",
                catalog[:2000] if catalog else "(empty)",
                "",
                "Prior conversation (supporting context only):",
                _thread_digest(ctx),
                "",
                "Latest message to answer (PRIMARY):",
                (latest or ctx.get("body") or "")[:2500],
            ]
        ),
        max_tokens=1200,
        timeout_ms=20_000,
    )

    if raw:
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            try:
                parsed = json.loads(match.group(0))
                grounded = parsed.get("grounded")
                if grounded is False and not kb_context and not catalog and not implied_need:
                    return _compose_failed_escalate(
                        state,
                        "LLM could not ground a reply — escalating for human.",
                    )
                if parsed.get("subject") and parsed.get("body"):
                    body = str(parsed["body"]).rstrip()
                    if signoff.split("\n")[0] not in body:
                        body = f"{body}\n\n{signoff}"
                    body = sanitize_email_closing(
                        body,
                        customer_company=str(ctx.get("companyName") or "") or None,
                        sender_organization=_sender_org_name(ctx),
                    )
                    return {
                        **state,
                        "reply_subject": str(parsed["subject"])[:180],
                        "reply_body": body,
                    }
            except Exception:  # noqa: BLE001
                pass

    return _compose_failed_escalate(
        state,
        "LLM compose unavailable or returned unusable output — escalating for human.",
    )


async def persist(state: AutoReplyState) -> AutoReplyState:
    client = CrmClient(state.get("organization_id"))
    result = await client.persist_auto_reply(
        state["activity_id"],
        {
            "decision": state.get("decision"),
            "sensitivity": state.get("sensitivity"),
            "category": state.get("category"),
            "reason": state.get("reason"),
            "replySubject": state.get("reply_subject"),
            "replyBody": state.get("reply_body"),
            "requestedStartIso": state.get("requested_start_iso"),
            "chosenSlotIso": state.get("chosen_slot_iso"),
            "timeZone": state.get("time_zone"),
        },
    )
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: AutoReplyState, after: AutoReplyState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {"hasThread": bool(ctx.get("thread") or ctx.get("activities"))}


def _detail_classify(
    _before: AutoReplyState, after: AutoReplyState
) -> dict[str, Any] | None:
    return {
        "sensitivity": after.get("sensitivity"),
        "category": after.get("category"),
    }


def _detail_compose_or_escalate(
    _before: AutoReplyState, after: AutoReplyState
) -> dict[str, Any] | None:
    return {
        "decision": after.get("decision"),
        "replyComposed": bool(after.get("reply_subject") and after.get("reply_body")),
    }


def _detail_persist(
    _before: AutoReplyState, after: AutoReplyState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
            AUTO_REPLY_MODULE_PATH,
            AUTO_REPLY_AGENT,
            "load_context",
            "Loading the inbound message & thread context",
            _detail_load_context,
            id_field="activity_id",
        )(load_context),
    traced_step(
            AUTO_REPLY_MODULE_PATH,
            AUTO_REPLY_AGENT,
            "classify",
            "Classifying sensitivity & intent",
            _detail_classify,
            id_field="activity_id",
        )(classify),
    traced_step(
            AUTO_REPLY_MODULE_PATH,
            AUTO_REPLY_AGENT,
            "compose_or_escalate",
            "Composing a reply or escalating",
            _detail_compose_or_escalate,
            id_field="activity_id",
        )(compose_or_escalate),
    traced_step(
            AUTO_REPLY_MODULE_PATH,
            AUTO_REPLY_AGENT,
            "persist",
            "Saving the auto-reply outcome",
            _detail_persist,
            id_field="activity_id",
        )(persist),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    activity_id: str,
    contact_id: str | None = None,
    organization_id: str | None = None,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "activity_id": activity_id,
            "contact_id": contact_id or "",
            "organization_id": organization_id,
            "status": "running",
        }
    )
    return {
        "activityId": activity_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "decision": result.get("decision"),
        "sensitivity": result.get("sensitivity"),
        "category": result.get("category"),
        "reason": result.get("reason"),
        "replySubject": result.get("reply_subject"),
        "requestedStartIso": result.get("requested_start_iso"),
        "chosenSlotIso": result.get("chosen_slot_iso"),
        "persistResult": result.get("persist_result"),
    }
