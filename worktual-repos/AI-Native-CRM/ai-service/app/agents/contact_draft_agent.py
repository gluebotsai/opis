"""Contact draft field-fill agent — guided, one question at a time."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.native_pipeline import run_steps

from app.agents.coworker_shared import (
    apply_leave_create,
    build_conversation_prompt,
    draft_navigate_tools_from_llm,
    is_generic_coworker_speech,
    last_assistant_text,
    last_user_text,
    result_leaves_current_page,
    run_chat_json,
    sanitize_assistant_text_for_user,
    should_commit_native_turn,
    str_fields,
    strip_draft_patch,
)
from app.agents.draft_conversation import (
    TONE_RULES,
    contact_draft_ready,
    contact_draft_save_ready,
    looks_like_create_confirm,
    merge_draft,
    parse_contact_field_update,
    propose_create_contact_proposal,
    utterance_is_one_shot_create,
)

CONTACT_TYPES = ("contact", "lead", "prospect", "customer", "churned")
# Old HubSpot-style lifecycle labels some models still emit.
_LEGACY_LIFECYCLE_TO_CONTACT_TYPE = {
    "subscriber": "contact",
    "contact": "contact",
    "lead": "lead",
    "mql": "prospect",
    "sql": "prospect",
    "opportunity": "prospect",
    "customer": "customer",
    "evangelist": "customer",
    "other": "contact",
    "prospect": "prospect",
    "churned": "churned",
}

STOPWORDS = {
    "a",
    "an",
    "the",
    "for",
    "to",
    "from",
    "with",
    "at",
    "of",
    "and",
    "or",
    "new",
    "add",
    "create",
    "contact",
    "contacts",
    "lead",
    "person",
    "named",
    "called",
    "name",
    "is",
    "please",
    "help",
    "me",
    "my",
    "set",
    "email",
    "phone",
    "title",
    "company",
    "as",
    "make",
    "draft",
    "skip",
    "none",
    "no",
}

# Bare greetings / chat fillers — never treat as a person's name.
NAME_BLOCKLIST = {
    "hi",
    "hello",
    "hey",
    "hiya",
    "howdy",
    "yo",
    "sup",
    "thanks",
    "thank",
    "thx",
    "ok",
    "okay",
    "k",
    "kk",
    "sure",
    "yep",
    "yeah",
    "yea",
    "yup",
    "good",
    "morning",
    "afternoon",
    "evening",
    "greetings",
}


def is_greeting_or_filler(text: str) -> bool:
    """True when the whole message is only a greeting / filler (not a real name)."""
    tokens = [
        t
        for t in re.findall(r"[a-zA-Z]+", (text or "").strip().lower())
        if t
    ]
    if not tokens:
        return False
    return all(t in NAME_BLOCKLIST or t in STOPWORDS for t in tokens)


def _is_blocked_name_token(token: str) -> bool:
    return token.strip().lower() in NAME_BLOCKLIST


def _normalize_contact_type(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    mapped = _LEGACY_LIFECYCLE_TO_CONTACT_TYPE.get(raw.strip().lower(), raw.strip().lower())
    return mapped if mapped in CONTACT_TYPES else None


def _resolve_type_from_channels(
    draft: dict[str, Any] | None,
    merged: dict[str, Any],
) -> str:
    existing = _normalize_contact_type(str((draft or {}).get("contactType") or "")) or "contact"
    requested = _normalize_contact_type(str(merged.get("contactType") or "")) or existing
    if requested in {"prospect", "customer", "churned"} or existing in {
        "prospect",
        "customer",
        "churned",
    }:
        return requested if requested in {"prospect", "customer", "churned"} else existing
    if existing == "lead":
        return "lead"
    if str(merged.get("email") or "").strip() or str(merged.get("phone") or "").strip():
        return "lead"
    return "contact"


SYSTEM = f"""You help a colleague fill a CRM contact draft, one step at a time.
Reply with ONLY valid JSON:
{{"assistantText":"short human reply","patch":{{...optional...}},"navigate":{{"href":"/company/new","seedPrompt":"optional remaining intent"}}}}

Allowed patch keys: firstName, lastName, email, phone, title, companyId, locationId, companyName, contactType, leadStatus, notes, city, country, skippedOptional.
- contactType must be one of: contact, lead, prospect, customer, churned (never HubSpot lifecycle labels like mql/sql). Name-only people are contact; add email or phone to make them a lead.
- skippedOptional: comma-separated optional field keys the user skipped (email, phone, company, title, city, country). Persist and never re-ask those.
- companyId/locationId must come from catalog ids when matching by name — never invent ids
- Employer on THIS contact: while they are still creating this person, accept whatever name they type as companyName and move on. If it matches the catalog, also set companyId. If it does not, still keep companyName. Never ask existing vs new, never ask them to pick from the catalog, never refuse a typed company, never list catalog companies as the only options. "they work at X" / answering the contact's company question means companyName.
- A new company RECORD is not the employer field. If they want to create a company instead of this contact — including "create company", pausing this contact, "I'll add the contact later", then a company name — do NOT patch contact fields. Return empty patch and navigate.href="/company/new" with seedPrompt of the company name or remaining intent. Same for other record types: /sales/new, /product/new, /finance/new, /sales/quotes/new.
- Scheduling or booking a demo, meeting, or call, or asking to email or call someone — including "schedule demo for Nikila" — is not this new contact. Return an empty patch and navigate.href="/activities/log" with seedPrompt of their full request, including the person's name. Do not patch firstName or lastName from that request, and do not ask for a name.
- Names: if they give a full name in one message (e.g. "Manoj M", "Manoj Sharma", "Ada Lovelace"), patch firstName AND lastName together in that same turn. Do not ask for last name again. A single token is firstName only — then ask last name once. Last name is optional; if they skip it, move on.
- Never patch firstName/lastName from greetings or fillers (hi, hello, hey, thanks, ok, good morning). Reply warmly and ask for the contact's real name instead.
- Never invent ids
- Do not create/save the contact — only propose patches
- Accept every field the user volunteers in this message
- One contact per create flow — never ask how many contacts to add.
- Bulk CSV import stays in chat (CSV Instructions download link, then propose_import_contacts only after paste/attach or “import this sample”) — never ask paste vs template; do not start one-at-a-time create.
- Required before save: firstName and at least one of email or phone. Last name is optional. Ask every field in order — one question at a time: first name → last name → email → phone → company → title → city → country. Skip the last-name ask when both names arrived together, or when they skip last name.
- Never ask for lead source. CRM create always stores leadSource as "crm". Do not patch it, mention it, or collect it.
- Do not ask to save or say they look ready until every field above is filled or explicitly skipped (except first name and reachability rules below)
- Last name may be skipped. If they skip it, acknowledge once and ask for email next.
- Email and phone: ask both in order. They may skip email only if they will provide phone; they may skip phone only if email is already set. If they skip email, phone becomes mandatory — if they skip phone too, explain email or phone is required. Adding email or phone promotes them to a lead.
- If they skip an optional field (company/title/city/country, or phone when email is set, or email when phone is set), acknowledge once, patch skippedOptional with that field key (comma-separated list), and NEVER ask for that field again in this create flow
- After phone is handled (filled or skipped with email present), ask company next — not phone again
- Never ask for a mailing address or postal address on contact create
- Accept "infosys, product manager" style replies as companyName + title in one patch
- Ask in full sentences. Correct: "Could you share their email?" Incorrect: "Email:" or "First Name:"
- Saving is the user's choice — after all fields are filled or skipped, tell them they can say when to save; do not push save after only name or email
- Sound warm and natural — avoid repeating the same "Got it — X. What's X's Y?" pattern every turn
- Should not use single word replies,be verbose and conversational.
- Never start assistantText with a dash, bullet, or markdown list marker.
- If the user asks to leave create (show/list contacts, go back), empty patch and navigate.href="/contact"

{TONE_RULES}"""


class ContactDraftState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    result: dict[str, Any]


def is_list_or_leave_intent(text: str) -> bool:
    lower = text.lower()
    return bool(
        re.search(r"show\s+(all\s+)?contacts?", lower)
        or re.search(r"list\s+(all\s+)?contacts?", lower)
        or re.search(r"back\s+to\s+(the\s+)?(list|contacts?)", lower)
        or re.search(r"return\s+to\s+(the\s+)?(list|contacts?)", lower)
        or re.search(r"\b(view|open)\s+(the\s+)?(contact\s+)?list\b", lower)
        or lower
        in ("show contacts", "cancel", "never mind", "nevermind")
    )


_COMPANY_META_RE = re.compile(
    r"^\s*("
    r"(?:add|create|make|save)\s+(?:it\s+)?(?:as\s+)?(?:a\s+)?new(?:\s+(?:one|company|org(?:anization)?)?)?"
    r"|new\s+company"
    r"|existing(?:\s+company)?"
    r"|from\s+(?:the\s+)?catalog"
    r"|add\s+(?:it|them)(?:\s+as\s+new)?"
    r"|create\s+(?:a\s+)?new\s+(?:one|company)"
    r")\s*[.!]?\s*$",
    re.I,
)


def is_company_meta_reply(text: str) -> bool:
    """True for 'new company' / 'existing' — not a company name."""
    return bool(_COMPANY_META_RE.match((text or "").strip()))


def is_skip_intent(text: str) -> bool:
    lower = text.strip().lower()
    return lower in (
        "skip",
        "skip it",
        "skip that",
        "no",
        "none",
        "n/a",
        "na",
        "pass",
        "nope",
        "not now",
        "later",
        "no phone",
        "no company",
        "no title",
    )


_DEFERRAL_RE = re.compile(
    r"(?i)\b("
    r"(?:i|we)\s+(?:will|'ll|would)\b.{0,80}\blater\b"
    r"|(?:add|create|finish|continue|pick(?:\s+that)?\s+back).{0,40}\blater\b"
    r"|hold\s+off|not\s+now|for\s+now|\bpause\b"
    r"|contact\s+later"
    r")\b"
)


def looks_like_deferral(text: str) -> bool:
    """True for 'I'll add the contact later' — not a person's name."""
    return bool(_DEFERRAL_RE.search((text or "").strip()))


_OPTIONAL_SKIP_SLOTS = frozenset(
    {
        "lastName",
        "phone",
        "email",
        "company",
        "title",
        "city",
        "country",
    }
)


def can_skip_optional_field(draft: dict[str, Any] | None, field: str) -> bool:
    """Optional skips — reachability needs at least one of email or phone."""
    key = "company" if field in {"company", "companyName"} else field
    if key not in _OPTIONAL_SKIP_SLOTS:
        return False
    d = draft if isinstance(draft, dict) else {}
    has_email = bool(str(d.get("email") or "").strip())
    if key == "email":
        return True
    if key == "phone":
        return has_email
    return True


def skipped_optional_fields(draft: dict[str, Any] | None) -> set[str]:
    raw = str((draft or {}).get("skippedOptional") or "")
    out: set[str] = set()
    for part in raw.split(","):
        key = part.strip()
        if key == "companyName":
            key = "company"
        if key in _OPTIONAL_SKIP_SLOTS:
            out.add(key)
    return out


_DRAFT_STM_KEYS = (
    "firstName",
    "lastName",
    "email",
    "phone",
    "title",
    "companyName",
    "companyId",
    "city",
    "country",
    "leadSource",
    "skippedOptional",
)


def _contact_draft_slot(merged: dict[str, Any]) -> dict[str, str]:
    slot: dict[str, str] = {}
    for key in _DRAFT_STM_KEYS:
        val = str(merged.get(key) or "").strip()
        if val:
            slot[key] = val
    return slot


def hydrate_draft_from_session_memory(
    draft: dict[str, Any] | None,
    session_memory: dict[str, Any] | None,
) -> dict[str, Any]:
    """Union create skips and collected fields from client STM into the draft.

    STM survives a create-panel remount that drops the in-memory draft.
    """
    out = dict(draft) if isinstance(draft, dict) else {}
    if not isinstance(session_memory, dict):
        return out
    slots = session_memory.get("slots")
    if not isinstance(slots, dict):
        return out
    stored = slots.get("contactDraft")
    if isinstance(stored, dict):
        for key in _DRAFT_STM_KEYS:
            if str(out.get(key) or "").strip():
                continue
            val = str(stored.get(key) or "").strip()
            if val:
                out[key] = val
    stm_skip = str(slots.get("skippedOptional") or "").strip()
    if not stm_skip:
        return out
    combined = skipped_optional_fields(out) | skipped_optional_fields(
        {"skippedOptional": stm_skip}
    )
    if combined:
        out["skippedOptional"] = ",".join(sorted(combined))
    return out


def _pending_slot_from_session_memory(
    session_memory: dict[str, Any] | None,
) -> str | None:
    from app.agents.coworker_runtime import pending_ask_field

    if not isinstance(session_memory, dict):
        return None
    field = pending_ask_field(str(session_memory.get("pendingAsk") or ""))
    if field in _OPTIONAL_SKIP_SLOTS:
        return field
    return None


def contact_create_session_memory_patch(
    merged: dict[str, Any],
    *,
    result: dict[str, Any] | None = None,
    leave_create: bool = False,
) -> dict[str, Any]:
    """STM patch for contact create: pendingAsk + skippedOptional."""
    if leave_create:
        return {
            "pendingIntent": "",
            "pendingAsk": "",
            "slots": {
                "skippedOptional": "",
                "createModule": "",
                "contactName": "",
                "contactDraft": {},
            },
        }

    tools = (result or {}).get("toolProposals") or []
    creating = any(
        isinstance(t, dict) and t.get("name") == "propose_create_contact"
        for t in tools
    )
    if creating:
        name = " ".join(
            x
            for x in (
                str(merged.get("firstName") or "").strip(),
                str(merged.get("lastName") or "").strip(),
            )
            if x
        ).strip()
        return {
            "pendingIntent": "",
            "pendingAsk": "",
            "slots": {
                "skippedOptional": "",
                "createModule": "",
                **({"contactName": name} if name else {"contactName": ""}),
            },
            "lastEntities": ({"contactName": name} if name else {}),
        }

    from app.agents.draft_conversation import contact_next_ask_key

    ask = contact_next_ask_key(merged)
    skipped = str(merged.get("skippedOptional") or "").strip()
    name = " ".join(
        x
        for x in (
            str(merged.get("firstName") or "").strip(),
            str(merged.get("lastName") or "").strip(),
        )
        if x
    ).strip()
    return {
        "pendingIntent": "create_contact",
        "pendingAsk": f"contact_{ask}" if ask else "",
        "slots": {
            "createModule": "contact",
            "skippedOptional": skipped,
            "contactDraft": _contact_draft_slot(merged),
            **({"contactName": name} if name else {}),
        },
    }


def mark_optional_skipped(
    draft: dict[str, Any],
    field: str,
    patch: dict[str, Any] | None = None,
) -> str:
    key = "company" if field in {"company", "companyName"} else field
    skipped = skipped_optional_fields({**(draft or {}), **(patch or {})})
    if key in _OPTIONAL_SKIP_SLOTS:
        skipped.add(key)
    return ",".join(sorted(skipped))


def _speech_reasks_skipped_or_bad_slot(
    speech: str, draft: dict[str, Any]
) -> bool:
    lower = (speech or "").lower()
    if not lower.strip():
        return False
    if re.search(r"\b(mailing|postal|street)\s+address\b|\bhome\s+address\b", lower):
        return True
    skipped = skipped_optional_fields(draft)
    if "phone" in skipped and re.search(r"\b(phone|mobile)\b", lower):
        return True
    if "email" in skipped and re.search(
        r"\b(email|e-mail)\b",
        lower,
    ):
        return True
    if "company" in skipped and re.search(r"\bcompan(y|ies)\b", lower):
        return True
    if "title" in skipped and re.search(r"\b(title|role|position)\b", lower):
        return True
    if str(draft.get("email") or "").strip() and re.search(
        r"\b(what('| i)?s|share|provide|need)\b.*\b(email|e-mail)\b",
        lower,
    ):
        return True
    if str(draft.get("phone") or "").strip() and re.search(
        r"\b(what('| i)?s|share|provide|need)\b.*\b(phone|mobile)\b",
        lower,
    ):
        return True
    return False


def _title_case_token(token: str) -> str:
    if not token:
        return token
    if len(token) <= 2 and token == token.upper():
        return token
    return token[0].upper() + token[1:].lower()


_LABELED_FIELD_RE = re.compile(
    r"\b(?:company(?:\s*name)?|org(?:anization)?|title|role|position|"
    r"email|phone|mobile|city|country|lead\s*source)\s*[=:]\s*[^,;|]+",
    re.I,
)


def parse_name_from_text(text: str) -> dict[str, str]:
    if is_greeting_or_filler(text) or is_skip_intent(text) or looks_like_deferral(text):
        return {}

    cleaned = re.sub(r"[\w.+-]+@[\w.-]+\.\w+", " ", text)
    cleaned = re.sub(r"(?:\+?\d[\d\s().-]{7,}\d)", " ", cleaned)
    # Drop labeled slots so "company = Netflix, title = Developer" does not
    # pollute name token extraction.
    cleaned = _LABELED_FIELD_RE.sub(" ", cleaned)
    cleaned = re.sub(r"[\"'=]", "", cleaned).strip()

    for_match = re.search(
        r"(?:contact|lead|person|named|called|for|name(?:\s+is)?)\s+([a-z][a-z .'-]{1,60})",
        cleaned,
        re.I,
    )
    candidate = (for_match.group(1).strip() if for_match else "") or ""

    if not candidate:
        bare = re.match(r"^([a-z][a-z]*(?:\s+[a-z][a-z.]*){0,4})$", cleaned, re.I)
        if bare:
            candidate = bare.group(1).strip()

    if not candidate:
        tokens = [
            t.strip()
            for t in re.split(r"[\s,]+", cleaned)
            if t.strip()
            and t.lower() not in STOPWORDS
            and t.lower() not in NAME_BLOCKLIST
            and not re.search(r"[@/\\]", t)
        ]
        if 1 <= len(tokens) <= 5:
            candidate = " ".join(tokens)

    if not candidate:
        return {}

    parts = [
        p.rstrip(".,")
        for p in candidate.split()
        if p
        and p.lower() not in STOPWORDS
        and p.lower() not in NAME_BLOCKLIST
    ]
    if not parts:
        return {}
    if len(parts) == 1:
        return {"firstName": _title_case_token(parts[0])}
    return {
        "firstName": _title_case_token(parts[0]),
        "lastName": " ".join(_title_case_token(p) for p in parts[1:]),
    }


def resolve_company_match(
    text: str, companies: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Match a catalog company from a short reply (exact, prefix, contains, acronym)."""
    q = (text or "").strip().lower()
    if not q or len(q) > 80:
        return None
    # Ignore confirmations / skips
    if q in {
        "skip",
        "skip it",
        "none",
        "no",
        "n/a",
        "na",
        "no company",
        "yes",
        "yep",
        "save",
        "save them",
        "save them now",
    }:
        return None

    scored: list[tuple[int, dict[str, Any]]] = []
    for c in companies:
        name = str(c.get("name") or "").strip()
        if not name:
            continue
        name_l = name.lower()
        score = 0
        if name_l == q:
            score = 100
        elif name_l.startswith(q) or q.startswith(name_l):
            score = 80
        elif len(q) >= 2 and q in name_l:
            score = 60
        else:
            # Acronym: "cts" ↔ "Cognizant Technology Solutions"
            initials = "".join(w[0] for w in re.findall(r"[a-z0-9]+", name_l) if w)
            if len(q) >= 2 and initials == q:
                score = 70
            elif len(q) >= 2 and initials.startswith(q):
                score = 50
        if score:
            scored.append((score, c))
    if not scored:
        return None
    scored.sort(key=lambda x: (-x[0], -len(str(x[1].get("name") or ""))))
    best_score = scored[0][0]
    top = [c for s, c in scored if s == best_score]
    return top[0] if len(top) == 1 else (top[0] if best_score >= 80 else None)


def sanitize(
    patch: dict[str, Any] | None,
    companies: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not patch:
        return None
    out = str_fields(
        patch,
        [
            "firstName",
            "lastName",
            "email",
            "phone",
            "title",
            "companyName",
            "notes",
            "city",
            "country",
            "leadSource",
            "leadStatus",
            "skippedOptional",
        ],
        max_len=4000,
    )
    for k, mx in (
        ("firstName", 80),
        ("lastName", 80),
        ("email", 200),
        ("phone", 40),
        ("title", 120),
        ("companyName", 200),
        ("city", 80),
        ("country", 80),
        ("leadSource", 80),
        ("leadStatus", 40),
        ("skippedOptional", 120),
    ):
        if k in out:
            out[k] = out[k][:mx]

    # Drop greeting/filler tokens that slipped in as names (LLM or heuristic).
    for name_key in ("firstName", "lastName"):
        val = out.get(name_key)
        if isinstance(val, str) and _is_blocked_name_token(val):
            out.pop(name_key, None)

    raw_type = patch.get("contactType")
    if raw_type is None:
        raw_type = patch.get("lifecycleStage")
    contact_type = _normalize_contact_type(raw_type)
    if contact_type:
        out["contactType"] = contact_type

    company_ids = {c["id"] for c in companies if c.get("id")}
    cid = patch.get("companyId")
    if isinstance(cid, str) and cid in company_ids:
        out["companyId"] = cid
        company = next((c for c in companies if c.get("id") == cid), None)
        locs = (company or {}).get("locations") or []
        lid = patch.get("locationId")
        if isinstance(lid, str) and any(l.get("id") == lid for l in locs):
            out["locationId"] = lid
        elif locs and locs[0].get("id"):
            out["locationId"] = locs[0]["id"]

    # CRM-created contacts always use source crm — never collect another value.
    out["leadSource"] = "crm"

    return out or None


def _patch_only(patch: dict[str, Any] | None) -> dict[str, Any]:
    """Offline field extraction only — never invent chat speech."""
    result: dict[str, Any] = {"ok": True}
    if patch:
        result["patch"] = patch
        result["contactDraftPatch"] = patch
    return result




def heuristic(
    text: str,
    companies: list[dict[str, Any]],
    draft: dict[str, Any],
    prior_assistant: str = "",
    session_memory: dict[str, Any] | None = None,
    business_type: str | None = None,
) -> dict[str, Any]:
    draft = hydrate_draft_from_session_memory(draft, session_memory)
    if looks_like_deferral(text) and not is_skip_intent(text):
        return {"ok": True}
    if is_list_or_leave_intent(text):
        return {
            "ok": True,
            "workspaceHint": {"mode": "list", "label": "Show contacts"},
            "toolProposals": [
                {
                    "id": "ws-from-draft",
                    "name": "set_workspace",
                    "label": "Show contacts",
                    "args": {"mode": "list", "auto": True},
                    "risk": "low",
                }
            ],
            "sessionMemoryPatch": contact_create_session_memory_patch(
                draft, leave_create=True
            ),
        }

    if looks_like_create_confirm(text):
        from app.agents.draft_conversation import contact_draft_save_ready

        bt = str(business_type or "").strip().lower()
        if contact_draft_save_ready(draft, bt):
            return {
                "ok": True,
                "toolProposals": [
                    propose_create_contact_proposal(
                        proposal_id="create-contact-confirm",
                        auto=True,
                    )
                ],
            }
        if contact_draft_ready(draft):
            name = " ".join(
                x
                for x in (
                    str(draft.get("firstName") or "").strip(),
                    str(draft.get("lastName") or "").strip(),
                )
                if x
            ).strip()
            who = f"**{name}**" if name else "them"
            return {
                "ok": True,
                "assistantText": (
                    f"I still need an email or phone number for {who} before I can save."
                ),
            }
        return {"ok": True}

    if is_company_meta_reply(text):
        return {"ok": True}

    # Greetings while collecting a name — acknowledge only; do not fill the draft.
    if is_greeting_or_filler(text):
        return {"ok": True}

    first = str(draft.get("firstName") or "").strip()
    # Single-name: "use Ashika" / "just first name"
    use_mono = re.search(
        r"^\s*use\s+([A-Za-z][\w'-]*)\s*$|"
        r"\b(just\s+(the\s+)?first(\s+name)?|same\s+as\s+first|"
        r"no\s+last\s+name|only\s+one\s+name)\b",
        text,
        re.I,
    )
    if use_mono and first and not str(draft.get("lastName") or "").strip():
        ln = use_mono.group(1) if use_mono.group(1) else first
        if _is_blocked_name_token(ln):
            return {"ok": True}
        return _patch_only({"lastName": _title_case_token(ln)})

    if is_skip_intent(text):
        from app.agents.draft_conversation import (
            contact_mandatory_field_message,
            contact_next_ask_key,
        )

        pending = _pending_slot_from_assistant(
            prior_assistant
        ) or _pending_slot_from_session_memory(session_memory)
        if not pending:
            pending = contact_next_ask_key(draft)
        if pending == "firstName":
            return {
                "ok": True,
                "assistantText": contact_mandatory_field_message(pending, draft),
            }
        if pending and not can_skip_optional_field(draft, pending):
            return {
                "ok": True,
                "assistantText": contact_mandatory_field_message(pending, draft),
            }
        if pending and can_skip_optional_field(draft, pending):
            return _patch_only(
                {"skippedOptional": mark_optional_skipped(draft, pending)}
            )
        return {"ok": True}

    patch: dict[str, Any] = {}
    email = re.search(r"[\w.+-]+@[\w.-]+\.\w+", text)
    if email:
        patch["email"] = email.group(0)
    phone = re.search(r"(?:\+?\d[\d\s().-]{7,}\d)", text)
    if phone:
        patch["phone"] = re.sub(r"\s+", " ", phone.group(0)).strip()

    names = parse_name_from_text(text)
    pending_slot = _pending_slot_from_assistant(prior_assistant)
    if (
        pending_slot
        and pending_slot not in patch
        and not is_skip_intent(text)
        and len(text.strip()) <= 80
        and not re.search(r"@", text)
    ):
        if pending_slot == "phone":
            if re.search(r"\d", text) and not patch.get("phone"):
                patch["phone"] = re.sub(r"\s+", " ", text.strip())[:40]
        elif pending_slot == "city":
            patch["city"] = text.strip().rstrip(".!")[:80]
        elif pending_slot == "country":
            patch["country"] = text.strip().rstrip(".!")[:80]
        elif pending_slot == "title" and not patch.get("title"):
            patch["title"] = text.strip()[:120]

    # Waiting on last name — treat a short reply as last name
    if (
        draft.get("firstName")
        and not draft.get("lastName")
        and not patch.get("email")
        and not patch.get("phone")
        and not is_skip_intent(text)
        and not is_greeting_or_filler(text)
        and len(text.strip()) <= 80
    ):
        if names.get("lastName"):
            patch["lastName"] = names["lastName"]
            if names.get("firstName"):
                patch["firstName"] = names["firstName"]
        elif names.get("firstName") and not re.search(
            r"\b(first\s*name|rename)\b", text, re.I
        ):
            # Single token while awaiting last name
            patch["lastName"] = names["firstName"]
        elif re.match(r"^[A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*){0,3}$", text.strip()):
            parts = [
                p
                for p in text.strip().split()
                if not _is_blocked_name_token(p)
            ]
            if parts:
                patch["lastName"] = " ".join(_title_case_token(p) for p in parts)

    # Only take names when we still need them, or user clearly stated a name phrase
    elif names and (
        not (draft.get("firstName") or draft.get("lastName"))
        or re.search(r"\b(name|named|called|is)\b", text, re.I)
    ):
        patch.update(names)

    # Bare reply while waiting for title (not while waiting for company)
    needs_company = bool(
        draft.get("firstName")
        and draft.get("lastName")
        and draft.get("email")
        and not draft.get("companyId")
        and not draft.get("companyName")
    )
    if (
        draft.get("firstName")
        and draft.get("lastName")
        and draft.get("email")
        and not draft.get("title")
        and not needs_company
        and not patch
        and not is_skip_intent(text)
        and len(text.strip()) <= 80
        and not re.search(r"[@]", text)
    ):
        patch["title"] = text.strip()[:120]

    lower = text.lower()
    company = resolve_company_match(text, companies)
    if not company:
        # Fallback: longest substring match (legacy)
        ranked = sorted(
            (
                {
                    "c": c,
                    "i": lower.find(str(c.get("name") or "").lower()),
                    "len": len(str(c.get("name") or "")),
                }
                for c in companies
                if c.get("name")
            ),
            key=lambda x: -x["len"],
        )
        company = next((r["c"] for r in ranked if r["i"] >= 0), None)
    if company:
        patch["companyId"] = company["id"]
        if company.get("name"):
            patch["companyName"] = str(company["name"]).strip()[:200]
        locs = company.get("locations") or []
        if locs and locs[0].get("id"):
            patch["locationId"] = locs[0]["id"]
    elif (
        needs_company
        and not patch
        and not is_skip_intent(text)
        and not is_company_meta_reply(text)
    ):
        # Free-text company when nothing in catalog matches
        cleaned_co = text.strip()
        if cleaned_co.lower() in {
            "company",
            "the company",
            "org",
            "organization",
            "i already",
            "already",
            "i already did",
            "i already gave",
        }:
            return {"ok": True}
        if (
            len(cleaned_co) <= 80
            and not re.search(r"[@]", cleaned_co)
            and not looks_like_create_confirm(cleaned_co)
        ):
            # Bare country while asking company — record it, keep asking company
            if re.match(
                r"^(india|usa|uk|uae|singapore|australia|canada|germany|france|"
                r"china|japan|brazil|mexico|netherlands|sweden|switzerland)$",
                cleaned_co,
                re.I,
            ):
                patch["country"] = _title_case_token(cleaned_co)
            else:
                patch["companyName"] = cleaned_co[:200]

    if re.search(r"\bchurned\b", text, re.I):
        patch["contactType"] = "churned"
    elif re.search(r"\bcustomer\b", text, re.I):
        patch["contactType"] = "customer"
    elif re.search(r"\bprospect\b|\bmql\b|\bsql\b", text, re.I):
        patch["contactType"] = "prospect"
    elif re.search(r"\blead\b", text, re.I) and "create" not in lower:
        patch["contactType"] = "lead"

    field_patch = parse_contact_field_update(text)
    if field_patch:
        for k in ("country", "city", "title", "notes", "phone", "email"):
            if k in field_patch:
                patch[k] = field_patch[k]

    # One-shot dumps: "name, email, company = X, title = Y"
    for key, val in _structured_slots_from_user(text, draft, patch).items():
        if key not in patch or not str(patch.get(key) or "").strip():
            patch[key] = val

    clean = sanitize(patch, companies)
    merged = merge_draft(draft, clean)
    next_type = _resolve_type_from_channels(draft, merged)
    if next_type != str((draft or {}).get("contactType") or "contact"):
        clean = {**(clean or {}), "contactType": next_type}
        merged = merge_draft(draft, clean)
    if (
        clean
        and contact_draft_ready(merged)
        and not contact_draft_ready(draft)
        and utterance_is_one_shot_create(text)
    ):
        result = _patch_only(clean)
        result["toolProposals"] = [
            propose_create_contact_proposal(
                proposal_id="create-contact-oneshot",
                auto=True,
            )
        ]
        return result

    return _patch_only(clean)


def _pending_slot_from_assistant(prior: str) -> str | None:
    lower = (prior or "").lower()
    if not lower.strip():
        return None
    # Prefer location/city even when the same turn mentioned a company name.
    if re.search(r"\b(city|location|town)\b", lower):
        return "city"
    if re.search(r"\bcountry\b", lower):
        return "country"
    if re.search(r"\b(title|role|position)\b", lower) and not re.search(
        r"\bcompan", lower
    ):
        return "title"
    if re.search(r"\b(phone|mobile)\b", lower):
        return "phone"
    if re.search(r"\bcompan(y|ies)\b", lower):
        return "company"
    if re.search(r"\b(email|e-mail)\b", lower):
        return "email"
    if re.search(r"\blast\s+name\b", lower):
        return "lastName"
    if re.search(r"\b(first\s+name|full\s+name)\b", lower):
        return "firstName"
    return None


_BARE_CREATE_COMMAND_RE = re.compile(
    r"^\s*(please\s+)?(help\s+me\s+(to\s+)?)?"
    r"(create|add|new|start|make)(\s+a|\s+new)?\s+(contact|lead|person)s?"
    r"\s*[.!]?\s*$",
    re.I,
)


def infer_contact_reply_patch(
    text: str,
    draft: dict[str, Any],
    prior_assistant: str = "",
) -> dict[str, str]:
    """Map one create-walk reply onto draft fields when the model only talks.

    Bare commands ("create contact") and greetings stay empty so they never
    become a name. A single token while first name is already known is the
    last name ("Raghu" then "M").
    """
    raw = (text or "").strip()
    if (
        not raw
        or _BARE_CREATE_COMMAND_RE.match(raw)
        or is_greeting_or_filler(raw)
        or is_skip_intent(raw)
        or looks_like_deferral(raw)
        or is_list_or_leave_intent(raw)
        or looks_like_create_confirm(raw)
        or is_company_meta_reply(raw)
    ):
        return {}

    patch: dict[str, str] = {}
    email = re.search(r"[\w.+-]+@[\w.-]+\.\w+", raw)
    if email and not str(draft.get("email") or "").strip():
        patch["email"] = email.group(0)
    if not str(draft.get("phone") or "").strip() and _BARE_PHONE_RE.match(raw):
        patch["phone"] = re.sub(r"\s+", " ", raw).strip()[:40]

    names = parse_name_from_text(raw)
    first = str(draft.get("firstName") or "").strip()
    last = str(draft.get("lastName") or "").strip()
    pending = _pending_slot_from_assistant(prior_assistant)
    short = len(raw) <= 80 and "@" not in raw and "email" not in patch

    if first and not last and short and "phone" not in patch:
        if names.get("lastName"):
            patch["lastName"] = names["lastName"]
            if names.get("firstName"):
                patch["firstName"] = names["firstName"]
        elif names.get("firstName") and not re.search(
            r"\b(first\s*name|rename)\b", raw, re.I
        ):
            patch["lastName"] = names["firstName"]
        return patch

    if pending == "lastName" and not last and short and names.get("firstName"):
        patch["lastName"] = names.get("lastName") or names["firstName"]
        if not first and names.get("lastName") and names.get("firstName"):
            patch["firstName"] = names["firstName"]
        return patch

    if names and not (first or last):
        patch.update(names)
        return patch

    if not short:
        return patch
    if pending == "city" and not str(draft.get("city") or "").strip():
        patch["city"] = raw.strip().rstrip(".!")[:80]
    elif pending == "country" and not str(draft.get("country") or "").strip():
        patch["country"] = raw.strip().rstrip(".!")[:80]
    elif pending == "title" and not str(draft.get("title") or "").strip():
        patch["title"] = raw.strip()[:120]
    elif pending == "company" and not (
        str(draft.get("companyName") or "").strip()
        or str(draft.get("companyId") or "").strip()
    ):
        patch["companyName"] = raw.strip().rstrip(".!")[:200]
    return patch


def replay_contact_create_fields(
    messages: list[dict[str, Any]] | None,
    draft: dict[str, Any] | None = None,
    user_text: str = "",
) -> dict[str, str]:
    """Rebuild collected create fields from the thread, oldest answer first.

    Starts empty so an earlier first-name reply is not reread as the last name
    once that first name is already known.
    """
    del draft
    local: dict[str, str] = {}
    prior = ""
    last_user = ""
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "")
        text = str(msg.get("text") or msg.get("content") or "").strip()
        if not text:
            continue
        if role == "assistant":
            prior = text
            continue
        if role != "user":
            continue
        last_user = text
        local.update(infer_contact_reply_patch(text, local, prior))
    current = (user_text or "").strip()
    if current and current != last_user:
        local.update(infer_contact_reply_patch(current, local, prior))
    return local


_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")
_BARE_PHONE_RE = re.compile(r"^\+?\d[\d\s().-]{6,}\d\s*$")


def _structured_slots_from_user(
    user_text: str,
    draft: dict[str, Any],
    llm_patch: dict[str, Any] | None,
) -> dict[str, Any]:
    """Fill missing create slots from clear tokens / labeled fields in the turn.

    Greetings like "hi"/"hello" must never become names. Safe fills:
    email, phone, labeled company/title, and names only when the message also
    carries an email or labeled company/title (one-shot create dump).
    """
    fill: dict[str, Any] = {}
    text = (user_text or "").strip()
    if not text:
        return fill
    preview = {
        **(draft if isinstance(draft, dict) else {}),
        **(llm_patch if isinstance(llm_patch, dict) else {}),
    }
    if not str(preview.get("email") or "").strip():
        matched = _EMAIL_RE.search(text)
        if matched:
            fill["email"] = matched.group(0)
    if not str(preview.get("phone") or "").strip():
        if _BARE_PHONE_RE.match(text):
            fill["phone"] = re.sub(r"\s+", " ", text).strip()[:40]
        elif "@" not in text:
            matched = re.search(r"(?:\+?\d[\d\s().-]{7,}\d)", text)
            if matched:
                fill["phone"] = re.sub(r"\s+", " ", matched.group(0)).strip()[:40]

    if not str(preview.get("companyName") or "").strip() and not str(
        preview.get("companyId") or ""
    ).strip():
        company_m = re.search(
            r"\b(?:company(?:\s*name)?|org(?:anization)?)\s*[=:]\s*([^,;|]+)",
            text,
            re.I,
        )
        if company_m:
            company_val = company_m.group(1).strip().rstrip(".!")[:200]
            if company_val and company_val.lower() not in {
                "company",
                "org",
                "organization",
                "n/a",
                "none",
                "skip",
            }:
                fill["companyName"] = company_val

    if not str(preview.get("title") or "").strip():
        title_m = re.search(
            r"\b(?:title|role|position)\s*[=:]\s*([^,;|]+)",
            text,
            re.I,
        )
        if title_m:
            title_val = title_m.group(1).strip().rstrip(".!")[:120]
            if title_val and title_val.lower() not in {
                "title",
                "role",
                "position",
                "n/a",
                "none",
                "skip",
            }:
                fill["title"] = title_val

    # "infosys, product manager" while company/title still open
    needs_company = not (
        str(preview.get("companyName") or "").strip()
        or str(preview.get("companyId") or "").strip()
    )
    needs_title = not str(preview.get("title") or "").strip()
    if (
        (needs_company or needs_title)
        and "," in text
        and "@" not in text
        and not _EMAIL_RE.search(text)
        and len(text) <= 80
    ):
        left, right = [p.strip() for p in text.split(",", 1)]
        if left and right and not re.search(r"\d{5,}", text):
            if needs_company and "companyName" not in fill:
                fill["companyName"] = left[:200]
            if needs_title and "title" not in fill:
                fill["title"] = right[:120]

    # Names only with a strong create signal (email or labeled firmographics).
    rich_create = bool(
        fill.get("email")
        or preview.get("email")
        or fill.get("companyName")
        or fill.get("title")
        or _EMAIL_RE.search(text)
        or _LABELED_FIELD_RE.search(text)
    )
    if rich_create and not (
        str(preview.get("firstName") or "").strip()
        or str(preview.get("lastName") or "").strip()
    ):
        names = parse_name_from_text(text)
        if names.get("firstName"):
            fill["firstName"] = names["firstName"]
        if names.get("lastName"):
            fill["lastName"] = names["lastName"]
    return fill


def enrich_contact_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    companies: list[dict[str, Any]],
    draft: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
    session_memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Clamp the LLM draft patch and persist create-flow STM.

    Never extract names or other slots from user text. The model owns
    collected fields and assistant speech.
    """
    del messages
    draft = hydrate_draft_from_session_memory(draft, session_memory)

    if result_leaves_current_page(
        result, pathname="", module="contact"
    ) or result.get("navigate"):
        out = strip_draft_patch(dict(result))
        nav_tools = draft_navigate_tools_from_llm(result, user_text=user_text)
        if nav_tools and not out.get("toolProposals"):
            out["toolProposals"] = nav_tools
        leave = True
        stm_patch = contact_create_session_memory_patch(
            hydrate_draft_from_session_memory(draft, session_memory),
            result=out,
            leave_create=leave,
        )
        out["sessionMemoryPatch"] = stm_patch
        return out

    llm_patch = result.get("patch") or result.get("contactDraftPatch")
    if not isinstance(llm_patch, dict):
        llm_patch = {}
    clean = sanitize(llm_patch or None, companies) or {}
    clean["leadSource"] = "crm"
    out = dict(result)
    merged = merge_draft(draft, clean)
    skipped_val = str(merged.get("skippedOptional") or "").strip()
    if skipped_val:
        clean = {**clean, "skippedOptional": skipped_val}
        merged = merge_draft(draft, clean)
    out["patch"] = clean
    out["contactDraftPatch"] = clean

    leave = bool(out.get("workspaceHint"))
    stm_patch = contact_create_session_memory_patch(
        merged, result=out, leave_create=leave
    )
    prior_stm = out.get("sessionMemoryPatch")
    if isinstance(prior_stm, dict) and prior_stm:
        merged_slots = {
            **(prior_stm.get("slots") if isinstance(prior_stm.get("slots"), dict) else {}),
            **(stm_patch.get("slots") if isinstance(stm_patch.get("slots"), dict) else {}),
        }
        out["sessionMemoryPatch"] = {**prior_stm, **stm_patch, "slots": merged_slots}
    else:
        out["sessionMemoryPatch"] = stm_patch
    return out


def _llm_contact_result(
    *,
    speech: str,
    patch: dict[str, Any] | None,
    user_text: str,
    draft: dict[str, Any],
    business_type: str | None = None,
) -> dict[str, Any] | None:
    text = sanitize_assistant_text_for_user(speech)
    if not text or is_generic_coworker_speech(text):
        return None
    result: dict[str, Any] = {
        "ok": True,
        "assistantText": text,
        "source": "ai",
    }
    if patch:
        result["patch"] = patch
        result["contactDraftPatch"] = patch
    return result


async def handle(state: ContactDraftState) -> ContactDraftState:
    messages = state.get("messages") or []
    catalog = state.get("catalog") or {}
    user_text = last_user_text(messages)
    if not user_text:
        return {
            **state,
            "result": {
                "ok": False,
                "error": "Send a message to update the contact draft.",
            },
        }

    companies = list(catalog.get("companies") or [])
    draft = (
        catalog.get("currentDraft")
        or (state.get("context") or {}).get("draft")
        or {}
    )
    if not isinstance(draft, dict):
        draft = {}
    ctx = state.get("context") or {}
    business_type = str(
        catalog.get("businessType")
        or ctx.get("businessType")
        or ctx.get("business_type")
        or ""
    ).strip().lower()
    stm = (
        ctx.get("sessionMemory")
        if isinstance(ctx.get("sessionMemory"), dict)
        else {}
    )
    draft = hydrate_draft_from_session_memory(draft, stm)
    draft = {**draft, "leadSource": "crm"}

    from app.agent_log import fmt, logger, tool_names
    from app.agents.crm_tools import run_native_agent_turn
    from app.llm import is_ai_configured

    logger.info(
        fmt(
            agent="contact-draft",
            step="start",
            user=user_text,
            patch=draft if isinstance(draft, dict) else None,
        )
    )
    if is_ai_configured():
        pathname = str(ctx.get("pathname") or "/contact/new")
        native = await run_native_agent_turn(
            mod="contact",
            surface="create",
            messages=messages,
            context={
                **ctx,
                "draft": draft,
                "module": "contact",
                "surface": "create",
                "pathname": pathname,
            },
            catalog={**catalog, "currentDraft": draft, "companies": companies},
            user_text=user_text,
        )
        native_patch = None
        native_tools = None
        if native and native.get("ok"):
            speech = str(native.get("assistantText") or "").strip()
            leaving = result_leaves_current_page(
                native, pathname=pathname, module="contact"
            )
            # Bare email/phone without a draft patch must not commit — otherwise
            # the model can say "Got it" and the workspace never stores the value.
            if leaving or (
                speech
                and not is_generic_coworker_speech(speech)
                and should_commit_native_turn(native, user_text=user_text)
            ):
                native_out = apply_leave_create(
                    {**native, "source": "ai"},
                    pathname=pathname,
                    module="contact",
                )
                logger.info(
                    fmt(
                        agent="contact-draft",
                        step="native",
                        speech=speech,
                        tools=tool_names(native_out),
                        patch=native_out.get("patch")
                        or native_out.get("contactDraftPatch"),
                    )
                )
                return {
                    **state,
                    "result": enrich_contact_draft_result(
                        native_out,
                        user_text=user_text,
                        companies=companies,
                        draft=draft,
                        messages=messages,
                        session_memory=stm,
                    ),
                }
            native_patch = native.get("patch") or native.get("contactDraftPatch")
            native_tools = native.get("toolProposals")

        ai = await run_chat_json(
            system=SYSTEM,
            user=build_conversation_prompt(
                {
                    "companies": companies,
                    "contactTypes": list(CONTACT_TYPES),
                    "currentDraft": draft,
                    "pathname": pathname,
                },
                messages,
            ),
        )
        if ai:
            nav_tools = draft_navigate_tools_from_llm(ai, user_text=user_text)
            clean = None if nav_tools else (
                sanitize(ai.get("patch"), companies)
                or (native_patch if isinstance(native_patch, dict) else None)
            )
            llm = _llm_contact_result(
                speech=str(ai.get("assistantText") or ""),
                patch=clean,
                user_text=user_text,
                draft=draft,
                business_type=business_type,
            )
            if llm:
                if nav_tools:
                    llm["toolProposals"] = nav_tools
                    llm = strip_draft_patch(llm)
                elif native_tools and not llm.get("toolProposals"):
                    llm["toolProposals"] = native_tools
                    llm = apply_leave_create(
                        llm, pathname=pathname, module="contact"
                    )
                logger.info(
                    fmt(
                        agent="contact-draft",
                        step="json",
                        speech=llm.get("assistantText"),
                        tools=tool_names(llm),
                        patch=llm.get("patch") or llm.get("contactDraftPatch"),
                    )
                )
                return {
                    **state,
                    "result": enrich_contact_draft_result(
                        llm,
                        user_text=user_text,
                        companies=companies,
                        draft=draft,
                        messages=messages,
                        session_memory=stm,
                    ),
                }

        logger.error(
            fmt(
                agent="contact-draft",
                step="fallback",
                ok=False,
                reason="llm_unusable",
            )
        )
        from app.agents.coworker_shared import llm_unavailable_result

        return {
            **state,
            "result": llm_unavailable_result("llm_unusable"),
        }

    logger.error(
        fmt(
            agent="contact-draft",
            step="fallback",
            ok=False,
            reason="llm_not_configured",
        )
    )
    from app.agents.coworker_shared import llm_unavailable_result

    return {
        **state,
        "result": llm_unavailable_result("llm_not_configured"),
    }


_PIPELINE_STEPS = (
    handle,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    *,
    messages: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    catalog: dict[str, Any] | None = None,
    organization_id: str | None = None,
) -> dict[str, Any]:
    del organization_id
    # Prefer draft from context when catalog.currentDraft missing
    cat = dict(catalog or {})
    ctx = context or {}
    if not cat.get("currentDraft") and isinstance(ctx.get("draft"), dict):
        cat["currentDraft"] = ctx["draft"]
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": ctx,
            "catalog": cat,
        }
    )
    return result.get("result") or {
        "ok": False,
        "error": "Contact draft assist failed.",
    }
