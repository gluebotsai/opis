"""Compose Email Agent (LangGraph).

Turns a natural-language instruction into a CRM outbound email subject + body.
Grounds product copy in the product knowledge base. CRM product catalog may supply
names only (never pricing). Does not send mail — Inbox fills fields; user sends.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, TypedDict, Optional

from app.agents.llm_result import generate_json_with_retries
from app.agents.native_pipeline import run_steps
from app.llm import is_ai_configured
from app.services.knowledge_base import get_sales_knowledge

logger = logging.getLogger(__name__)


class ComposeState(TypedDict, total=False):
    instruction: str
    contact_id: Optional[str]
    contact_name: Optional[str]
    company_name: Optional[str]
    # Sender's org (Worktual tenant) — never confuse with customer company_name.
    sender_organization_name: Optional[str]
    subject: Optional[str]
    current_body: Optional[str]
    inbound_body: Optional[str]
    is_reply: bool
    organization_id: Optional[str]
    product_catalog: str
    kb_context: str
    out_subject: Optional[str]
    out_body: Optional[str]
    source: str
    status: str
    reason: Optional[str]


SYSTEM_PROMPT = """ROLE
You are a Professional CRM Email Content Creator writing ON BEHALF OF the sender's
organization (Worktual / the CRM tenant). You are NOT writing as the customer.

OBJECTIVE
Generate:
1. A clear, relevant email subject
2. A professional email body in plain text (NOT HTML)

GROUNDING (CRITICAL)
- KNOWLEDGE BASE is the source of truth for product capabilities and benefits in the email body
- PRODUCT CATALOG (if present) is names-only for orientation — do NOT copy catalog descriptions,
  prices, fees, ₹/$ amounts, or billing terms into the email
- Do NOT invent or include pricing unless it appears in the KNOWLEDGE BASE section
- IGNORE knowledge-base text about internal CRM admin modules (e.g. "Product Module",
  "centralized repository for managing products", pipeline stage how-tos)
- If the knowledge base is empty, write a short helpful email without inventing product details
- Do NOT invent meeting times, links, phone numbers, or commitments

PERSONALIZATION (STRICT)
- If a real contact first name is provided (not "—" / "there"), salutation is: Hi <FirstName>,
- If no name: use exactly "Hi,"
- Do NOT use placeholders like [Name], [Customer], [Your Name], etc.
- CUSTOMER COMPANY is the recipient's employer — use only for context (e.g. "at Acme"),
  NEVER in the sign-off, NEVER as "Acme Support Team", NEVER as who you represent
- SENDER ORGANIZATION is who you write for — if you add a line after "Best regards,",
  use ONLY the sender organization name (or omit it). Never invent "Support Team" labels

SUBJECT
- Concise, based on the user's intent (max ~80 chars)
- No clickbait; fix obvious typos (do not copy broken spelling)

BODY SPACING (STRICT)
- Use plain text with newlines
- Exactly ONE blank line between salutation, each paragraph, and the closing
- Do NOT insert extra blank lines or triple spacing
- Keep the whole body compact (typically 4–8 lines of text total)

BODY CONTENT
1. Salutation as above
2. Opening: useful context from the intent — NEVER paste the user's raw instruction into the body
3. 1–2 short paragraphs grounded in the knowledge base (capabilities/benefits; no pricing unless KB has it)
4. One clear next-step question
5. Closing: prefer exactly "Best regards," with nothing after it.
   If a sender organization name is provided, you MAY add that name alone on the next line.
   FORBIDDEN after the closing: customer company names, "Support Team", "Sales Team",
   fake departments, or any invented job title

TONE
Professional, direct, helpful. No aggressive language. Do not use the word "tool" or "tools".

REPLY MODE
- If Is reply is true, keep a Re: subject unless the instruction clearly asks for a new subject

OUTPUT (VERY STRICT)
Return ONLY valid JSON (no markdown, no explanation):
{"subject":"...","body":"..."}

"body" must be plain text. Prefer \\n for line breaks inside the JSON string; never use HTML.
"""

REVISION_PROMPT = """
REVISION OF AN EXISTING EMAIL
CURRENT SUBJECT and CURRENT BODY are the email already shown to the user.
Read the instruction and change only what it asks for.
Copy the subject exactly when the instruction does not ask for a different subject.
Copy the body exactly except for the part the instruction asks to change.
When the instruction asks for a different email, write that email.
Ignore the knowledge base unless the instruction asks to add product information.
Return the full subject and the full body.
"""


def _escape_newlines_in_json_strings(raw: str) -> str:
    """Repair common LLM JSON with literal newlines inside quoted strings."""
    out: list[str] = []
    in_string = False
    escape = False
    for ch in raw:
        if escape:
            out.append(ch)
            escape = False
            continue
        if ch == "\\" and in_string:
            out.append(ch)
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            out.append(ch)
            continue
        if in_string and ch == "\n":
            out.append("\\n")
            continue
        if in_string and ch == "\r":
            continue
        if in_string and ch == "\t":
            out.append("\\t")
            continue
        out.append(ch)
    return "".join(out)


def extract_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()
    candidates = [raw]
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        candidates.append(raw[start : end + 1])
    for candidate in candidates:
        for payload in (candidate, _escape_newlines_in_json_strings(candidate)):
            try:
                data = json.loads(payload)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                continue
    return None


def normalize_body_spacing(body: str) -> str:
    """Collapse excessive blank lines; keep at most one blank between blocks."""
    text = (body or "").replace("\r\n", "\n").replace("\r", "\n")
    # Literal backslash-n from double-encoded JSON
    if "\\n" in text and text.count("\n") < text.count("\\n"):
        text = text.replace("\\n", "\n")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    lines = [ln.rstrip() for ln in text.split("\n")]
    out: list[str] = []
    blank = False
    for ln in lines:
        if not ln.strip():
            if out and not blank:
                out.append("")
                blank = True
            continue
        out.append(ln.strip())
        blank = False
    while out and out[0] == "":
        out.pop(0)
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


_FAKE_TEAM_SIG = re.compile(
    r"(?i)\b(support|sales|success|customer\s*care|helpdesk)\s+team\b"
)


def sanitize_email_closing(
    body: str,
    *,
    customer_company: str | None = None,
    sender_organization: str | None = None,
) -> str:
    """Keep 'Best regards,' and optionally the sender org — drop fake team /
    customer-company sign-offs the LLM invents (e.g. 'Zoho Support Team')."""
    text = normalize_body_spacing(body)
    if not text:
        return text

    match = re.search(r"(?im)^best\s+regards,?\s*$", text)
    if not match:
        return text

    head = text[: match.end()].rstrip()
    # Normalize to canonical closing
    head = re.sub(r"(?im)best\s+regards,?\s*$", "Best regards,", head)

    tail_lines = [
        ln.strip()
        for ln in text[match.end() :].split("\n")
        if ln.strip()
    ]
    if not tail_lines:
        return head

    sender = (sender_organization or "").strip()
    customer = (customer_company or "").strip()
    kept: list[str] = []
    for ln in tail_lines:
        low = ln.lower()
        if customer and customer.lower() in low:
            continue
        if _FAKE_TEAM_SIG.search(ln):
            continue
        if re.search(r"(?i)\b(support|sales)\s+team\b", ln):
            continue
        if sender and low == sender.lower():
            kept.append(sender)
            break
        # Unknown leftover signature line — drop rather than keep inventing
        continue

    if kept:
        return f"{head}\n{kept[0]}"
    return head


def _strip_instruction_prefix(instr: str) -> str:
    cleaned = re.sub(r"\s+", " ", (instr or "").strip())
    cleaned = re.sub(
        r"^(write|draft|compose|create|send|explain)\s+(an?\s+)?(email|mail|about)\s*"
        r"(about|asking|regarding|for|to|on)?\s*",
        "",
        cleaned,
        flags=re.I,
    ).strip(" .")
    return cleaned


def _opening_from_intent(instr: str, *, is_reply: bool) -> str:
    """Human opening line — never echo the raw user prompt."""
    low = (instr or "").lower()
    if is_reply:
        return "Thank you for your message — I wanted to follow up with next steps."
    if any(w in low for w in ("product", "catalog", "offering", "solution", "prouct", "attract")):
        return (
            "I wanted to share a brief overview of our products "
            "and how they can support your needs."
        )
    if any(w in low for w in ("proposal", "quotation", "quote", "rfq")):
        return (
            "I wanted to follow up regarding a proposal and make sure we "
            "cover what you need."
        )
    if "invoice" in low:
        return "I wanted to follow up regarding your invoice request."
    if any(w in low for w in ("demo", "meeting", "call", "schedule")):
        return "I wanted to follow up so we can arrange a convenient time to connect."
    topic = _strip_instruction_prefix(instr)
    if topic and len(topic) < 60 and not topic.lower().startswith("write"):
        return f"I wanted to follow up regarding {topic.lower()}."
    return "I wanted to reach out and continue our conversation."


_KB_META_PREFIX = re.compile(
    r"^(passage|chunk|source|document|doc|page|score|id|title)\s*[:#.\-]\s*",
    re.I,
)
_KB_META_INLINE = re.compile(
    r"(?i)\b(passage|chunk|source|document|doc|page|score|id|title)\s*[:#]\s*"
    r"[^.!\n]{0,100}[.!]?\s*"
)
_KB_CRUMB = re.compile(
    r"(?i)\b(deployment date|null|undefined)\b\.?\s*"
)


_KB_MID_SENTENCE = re.compile(
    r"^(?:"
    r"are|is|was|were|been|being|have|has|had|and|or|but|to|for|of|the|a|an|"
    r"with|from|that|which|who|whom|whose|this|these|those|as|by|on|in|at|"
    r"their|our|your|its|they|we|you|it|can|could|should|would|may|might"
    r")\b",
    re.I,
)


def _clean_kb_sentences(kb_context: str, *, max_chars: int = 280) -> str:
    """Turn raw retrieve hits into one short email-safe blurb.

    Offline/heuristic path must never paste retrieval metadata
    (e.g. ``passage: deployment date.``) into the customer email.
    """
    text = (kb_context or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"<[^>]+>", " ", text)
    text = _KB_META_INLINE.sub(" ", text)
    text = _KB_CRUMB.sub(" ", text)
    text = re.sub(r"[`'\"]+", "", text)
    # Drop duplicated title stubs: "Product Module The Product Module acts…"
    text = re.sub(
        r"\b([A-Z][A-Za-z0-9 /&-]{2,40})\s+(The\s+\1)\b",
        r"\2",
        text,
    )
    text = re.sub(r"\s+", " ", text).strip(" .,;:-")

    chunks = re.split(r"(?<=[.!?])\s+", text)
    cleaned: list[str] = []
    for chunk in chunks:
        s = (chunk or "").strip(" \t.,;:-")
        if not s:
            continue
        s = _KB_META_PREFIX.sub("", s).strip(" \t.,;:-")
        # Drop leftover metadata crumbs / tiny / incomplete fragments
        if len(s) < 36:
            continue
        # Mid-sentence retrieval crumbs ("are flagged as high-priority…")
        if not s[0].isupper() or _KB_MID_SENTENCE.search(s):
            continue
        if re.search(r"\b(deployment date|null|undefined)\b", s, re.I):
            continue
        # Incomplete trailing clause ("… uploaded in bulk, or")
        if re.search(r"\b(or|and|with|to|for|of)$", s, re.I):
            s = re.sub(r"[,;\s]+\b(or|and|with|to|for|of)$", "", s, flags=re.I).strip()
            if len(s) < 36:
                continue
        if not s.endswith((".", "!", "?")):
            s += "."
        cleaned.append(s)
        joined = " ".join(cleaned)
        if len(joined) >= max_chars:
            break
    if not cleaned:
        return ""
    out = " ".join(cleaned)
    if len(out) > max_chars:
        cut = out[: max_chars - 1].rsplit(" ", 1)[0].rstrip(".,;:")
        out = f"{cut}."
    return out


def _subject_from_intent(instr: str) -> str:
    """Readable subject from intent — avoid copying awkward prompt wording."""
    low = (instr or "").lower()
    if any(w in low for w in ("product", "catalog", "offering", "solution", "prouct", "attract")):
        return "Our products - a quick overview"
    if any(w in low for w in ("proposal", "quotation", "quote", "rfq")):
        return "Proposal follow-up"
    if "invoice" in low:
        return "Regarding your invoice"
    if any(w in low for w in ("demo", "meeting", "call", "schedule")):
        return "Scheduling a quick call"
    cleaned = _strip_instruction_prefix(instr) or "Following up"
    cleaned = re.sub(r"\baskig\b", "asking", cleaned, flags=re.I)
    cleaned = re.sub(r"\bhie\b", "his", cleaned, flags=re.I)
    cleaned = re.sub(r"\bproucts?\b", "products", cleaned, flags=re.I)
    cleaned = re.sub(r"\battract (him|her|them) about\b", "overview of", cleaned, flags=re.I)
    # Prefer ASCII punctuation in subjects (avoids MIME mojibake).
    cleaned = (
        cleaned.replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
        .replace("\u2026", "...")
    )
    out = cleaned[:1].upper() + cleaned[1:]
    if len(out) > 72:
        out = out[:69].rstrip() + "..."
    return out


def _wants_products(instr: str) -> bool:
    low = (instr or "").lower()
    return any(
        w in low
        for w in (
            "product",
            "catalog",
            "offering",
            "solution",
            "prouct",
            "attract",
            "pitch",
            "demo",
        )
    )


_PRICE_RE = re.compile(
    r"(?i)("
    r"₹\s*[\d,]+|"
    r"\$\s*[\d,]+|"
    r"\b\d[\d,]*(?:\.\d+)?\s*/\s*(?:user|month|mo|year|yr|seat|contact)s?\b|"
    r"\b(?:INR|USD|AED|GBP)\s*[\d,]+|"
    r"\b[\d,]+\s*(?:INR|USD|AED|GBP)\b|"
    r"\b(?:price|pricing|fee|fees|charge|charges|billed|quotation|quote)\b"
    r")"
)


def _catalog_names_only(product_catalog: str | None, *, max_items: int = 5) -> list[str]:
    """Product names from CRM catalog — never descriptions/prices."""
    raw = (product_catalog or "").strip()
    if not raw:
        return []
    names: list[str] = []
    for line in raw.splitlines():
        item = re.sub(r"\s+", " ", line).strip(" -•\t")
        if not item:
            continue
        name = item.split(":", 1)[0].strip()
        if not name or len(name) < 2 or len(name) > 80:
            continue
        if _PRICE_RE.search(name):
            continue
        names.append(name)
        if len(names) >= max_items:
            break
    return names


def _catalog_name_blurb(product_catalog: str | None) -> str:
    names = _catalog_names_only(product_catalog)
    if not names:
        return ""
    if len(names) == 1:
        return f"One offering we can discuss is {names[0]}."
    if len(names) == 2:
        return f"Two offerings we can discuss are {names[0]} and {names[1]}."
    return (
        "Offerings we can discuss include "
        + ", ".join(names[:-1])
        + f", and {names[-1]}."
    )


def heuristic_compose(
    instruction: str,
    *,
    contact_name: str | None = None,
    company_name: str | None = None,
    subject: str | None = None,
    is_reply: bool = False,
    kb_context: str | None = None,
    product_catalog: str | None = None,
) -> tuple[str, str]:
    raw_name = (contact_name or "").strip()
    has_name = bool(raw_name) and raw_name.lower() not in {"there", "—", "-"}
    first = raw_name.split()[0] if has_name else None
    instr = (instruction or "").strip() or "Write a short professional email."

    if is_reply:
        base = (subject or "").strip()
        out_subject = (
            base
            if base.lower().startswith("re:")
            else (f"Re: {base}" if base else "Re: Your message")
        )
    else:
        out_subject = _subject_from_intent(instr)

    salutation = f"Hi {first}," if first else "Hi,"
    opening = _opening_from_intent(instr, is_reply=is_reply)
    wants_products = _wants_products(instr)
    low = instr.lower()
    is_proposal_followup = any(
        w in low for w in ("proposal", "quotation", "quote", "rfq")
    ) and not wants_products

    # KB pitch only for product-intent emails. Follow-ups must not paste random KB crumbs.
    mid = ""
    if wants_products:
        kb_blurb = _clean_kb_sentences(kb_context or "")
        if kb_blurb and not re.search(
            r"\b(product module|centralized repository for managing)\b",
            kb_blurb,
            re.I,
        ):
            mid = f"Here is a concise look at what we offer: {kb_blurb}"
        if not mid:
            mid = _catalog_name_blurb(product_catalog)
    if not mid and is_proposal_followup:
        mid = (
            "When you have a moment, could you share a quick status update "
            "or let me know if you have any questions?"
        )
    if not mid:
        mid = (
            "I'd be glad to share more about how we can help "
            "and align on the best next step."
        )

    if is_proposal_followup:
        cta = (
            "Would you prefer to reply with an update, or schedule a brief call?"
        )
    elif wants_products:
        cta = (
            "Would you like a short overview call, or should I send more detail first?"
        )
    else:
        cta = "Happy to help with next steps whenever it works for you."

    body = normalize_body_spacing(
        "\n".join(
            [
                salutation,
                "",
                opening,
                "",
                mid,
                "",
                cta,
                "",
                "Best regards,",
            ]
        )
    )
    return out_subject[:180], body


_INTERNAL_MODULE_KB = re.compile(
    r"(?i)\b("
    r"product module|centralized repository for managing|"
    r"product manager uploads|pipeline: lead|kyc & verification|"
    r"tamper-proof audit log|real-time example"
    r")\b"
)


def _kb_retrieve_query(instruction: str, product_catalog: str) -> str:
    """Build a retrieve query — never use the raw email prompt alone."""
    if not _wants_products(instruction):
        return ""
    catalog_names = []
    for line in (product_catalog or "").splitlines():
        name = line.split(":", 1)[0].strip(" -•\t")
        if name and len(name) < 80:
            catalog_names.append(name)
    if catalog_names:
        return (
            "Worktual customer benefits features "
            + " ".join(catalog_names[:6])
        )
    return (
        "Worktual CRM AI Native Contact Centre CDP Campaign "
        "products solutions customer benefits features"
    )


async def _load_kb(instruction: str, product_catalog: str = "") -> str:
    q = _kb_retrieve_query(instruction, product_catalog)
    if not q:
        return ""
    try:
        kb = await get_sales_knowledge(q, limit=4)
    except Exception as exc:  # noqa: BLE001
        logger.warning("compose-email KB retrieve failed: %s", exc)
        return ""
    if not (isinstance(kb, dict) and kb.get("status") == "success"):
        return ""
    raw = str(kb.get("context") or "").strip()
    if not raw:
        return ""
    # Drop internal CRM-admin module docs — they are not sellable product pitches.
    parts = re.split(r"(?<=[.!?])\s+|\n+", raw)
    kept: list[str] = []
    for part in parts:
        s = re.sub(r"\s+", " ", (part or "").strip())
        if len(s) < 40:
            continue
        if _INTERNAL_MODULE_KB.search(s):
            continue
        if re.match(r"(?i)^passage\s*:", s):
            s = re.sub(r"(?i)^passage\s*:\s*", "", s).strip()
        if s and (s[0].isupper() and not _KB_MID_SENTENCE.search(s)):
            kept.append(s)
        if len(" ".join(kept)) >= 2500:
            break
    return " ".join(kept)[:6000]


def _validate_compose_json(parsed: dict[str, Any]) -> dict[str, str] | None:
    subject = str(parsed.get("subject") or "").strip()
    body = str(parsed.get("body") or "").strip()
    if not subject or not body:
        return None
    return {"subject": subject[:180], "body": body[:4000]}


async def compose(state: ComposeState) -> ComposeState:
    instruction = (state.get("instruction") or "").strip()
    if not instruction:
        return {
            **state,
            "status": "failed",
            "reason": "instruction_required",
            "source": "heuristic",
        }

    contact_name = state.get("contact_name")
    company_name = state.get("company_name")
    sender_org = (state.get("sender_organization_name") or "").strip() or None
    subject = state.get("subject")
    inbound = state.get("inbound_body")
    is_reply = bool(state.get("is_reply"))
    product_catalog = (state.get("product_catalog") or "").strip()
    current_body = (state.get("current_body") or "").strip()

    kb_context = state.get("kb_context") or ""
    if not current_body and not kb_context:
        kb_context = await _load_kb(instruction, product_catalog)

    if current_body:
        if not is_ai_configured():
            return {
                **state,
                "status": "failed",
                "reason": "llm_not_configured",
                "source": "ai",
            }
        out_subject, out_body = (subject or "").strip(), current_body
        source = "ai"
        reason = None
    else:
        out_subject, out_body = heuristic_compose(
            instruction,
            contact_name=contact_name,
            company_name=company_name,
            subject=subject,
            is_reply=is_reply,
            kb_context=kb_context,
            product_catalog=product_catalog,
        )
        source = "heuristic"
        reason = None

    if is_ai_configured():
        user_parts = [
            f"Instruction (intent only — do not paste into body): {instruction}",
            f"Contact name: {contact_name or '—'}",
            f"CUSTOMER COMPANY (recipient employer — context only, NEVER use in sign-off): {company_name or '—'}",
            f"SENDER ORGANIZATION (who you write for): {sender_org or 'Worktual'}",
            f"Is reply: {is_reply}",
            f"Current subject: {subject or '—'}",
            "",
            "PRODUCT CATALOG NAMES ONLY (do not copy prices or billing from CRM):",
            product_catalog if product_catalog else "(empty)",
            "",
            "KNOWLEDGE BASE (source of truth for capabilities/benefits in the body):",
            kb_context if kb_context else "(empty — do not invent product specifics)",
        ]
        if current_body:
            user_parts.extend(
                [
                    "",
                    "CURRENT BODY (the email already shown — change only what the instruction asks):",
                    current_body[:4000],
                ]
            )
        if inbound:
            snippet = re.sub(r"<[^>]+>", " ", inbound)
            snippet = re.sub(r"\s+", " ", snippet).strip()[:1200]
            user_parts.append(f"Inbound message:\n{snippet or '(empty)'}")

        parsed, fail_reason = await generate_json_with_retries(
            system=SYSTEM_PROMPT + (REVISION_PROMPT if current_body else ""),
            user="\n".join(user_parts),
            max_tokens=700,
            timeout_ms=60_000,
            attempts=2,
            repair_hint=(
                "Convert the following into ONLY valid JSON with keys "
                '"subject" and "body". Escape newlines in body as \\n. '
                "No markdown, no commentary."
            ),
            validate=_validate_compose_json,
        )
        if parsed:
            body = sanitize_email_closing(
                parsed["body"],
                customer_company=company_name,
                sender_organization=sender_org,
            )
            echoed = (
                not current_body
                and instruction.lower()[:40] in body.lower()
                and len(instruction) > 12
            )
            if not echoed:
                out_subject, out_body = parsed["subject"], body
                source = "ai"
                if kb_context:
                    reason = "kb_grounded"
                elif product_catalog:
                    reason = "catalog_names_only"
                else:
                    reason = "ai_no_kb"
            else:
                reason = "llm_echo_or_incomplete"
                logger.warning(
                    "compose-email: LLM output rejected (%s); using heuristic",
                    reason,
                )
        else:
            reason = fail_reason or "llm_bad_json"
            logger.warning(
                "compose-email: LLM compose failed (%s); using heuristic",
                reason,
            )
            if current_body:
                return {
                    **state,
                    "status": "failed",
                    "reason": reason,
                    "source": "ai",
                }
    else:
        reason = "llm_not_configured"

    out_body = sanitize_email_closing(
        out_body,
        customer_company=company_name,
        sender_organization=sender_org,
    )

    return {
        **state,
        "product_catalog": product_catalog,
        "kb_context": kb_context,
        "out_subject": out_subject,
        "out_body": out_body,
        "source": source,
        "status": "ok",
        "reason": reason,
    }


_PIPELINE_STEPS = (
    compose,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    instruction: str,
    contact_id: str | None = None,
    contact_name: str | None = None,
    company_name: str | None = None,
    subject: str | None = None,
    current_body: str | None = None,
    inbound_body: str | None = None,
    is_reply: bool = False,
    organization_id: str | None = None,
    product_catalog: str | None = None,
    sender_organization_name: str | None = None,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "instruction": instruction,
            "contact_id": contact_id,
            "contact_name": contact_name,
            "company_name": company_name,
            "sender_organization_name": (sender_organization_name or "").strip()
            or None,
            "subject": subject,
            "current_body": (current_body or "").strip() or None,
            "inbound_body": inbound_body,
            "is_reply": is_reply,
            "organization_id": organization_id,
            "product_catalog": (product_catalog or "").strip(),
            "kb_context": "",
            "status": "running",
        }
    )
    ok = result.get("status") == "ok"
    catalog_used = bool((result.get("product_catalog") or "").strip())
    kb_used = bool((result.get("kb_context") or "").strip())
    return {
        "ok": ok,
        "subject": result.get("out_subject") or "",
        "body": result.get("out_body") or "",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "kbUsed": kb_used,
        "catalogUsed": catalog_used,
    }
