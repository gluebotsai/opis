"""Deterministic draft ingest — remember fields the user already typed."""

from __future__ import annotations

import re
from typing import Any

from app.agents.contacts.validation import (
    is_valid_email,
    parse_and_validate_phone,
    title_case_person_name,
)

REQUIRED_FIELDS = (
    "first_name",
    "last_name",
    "email",
    "phone",
    "company_name",
    "city",
)

PUSH_FIELDS = (
    "app_push_token",
    "app_push_platform",
    "app_push_asked",
    "web_push_endpoint",
    "web_push_p256dh",
    "web_push_auth",
    "web_push_asked",
)

# Optional extras → CDP custom_fields JSON (not real columns).
EXTRA_META_FIELDS = (
    "extra_fields_asked",
    "pack_fields_skipped",  # comma-separated recommended keys user skipped
)

DRAFT_KEYS = REQUIRED_FIELDS + PUSH_FIELDS + EXTRA_META_FIELDS

EMAIL_FIND_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
SKIP_PUSH_RE = re.compile(
    r"^(skip|none|no|n/?a|not\s+now|later|nope|nah|don't\s+have|do\s+not\s+have|"
    r"no\s+token|no\s+push)(\s+please)?[.!]?\s*$",
    re.I,
)
FCM_TOKEN_RE = re.compile(r"[\w.-]{8,}:APA91b[\w-]+", re.I)
HTTPS_URL_RE = re.compile(r"https://[^\s<>\"']+", re.I)
PLATFORM_RE = re.compile(r"\b(android|ios|iphone|web)\b", re.I)
SKIP_AS_NAME_RE = re.compile(
    r"^(i\s+already|already\s+gave|yes|no|ok|okay|sure|please|thanks|"
    r"thank\s+you|hello|hi|hey|create|update|delete|import|lookup|"
    r"search|new\s+contact|new\s+one|add\s+(a\s+)?(new\s+)?(one|contact|person)|"
    r"create\s+(a\s+)?(new\s+)?(one|contact|person)|another\s+(one|contact)|"
    r"what\s+is|could\s+you|can\s+you|"
    r"skip|skipped|none|nope|nah|n/?a|user|customer)\b",
    re.I,
)
# Whole-utterance create commands mistaken for "First Last" (e.g. "new one").
CREATE_COMMAND_AS_NAME_RE = re.compile(
    r"^(?:(?:please\s+)?(?:add|create|make|start)\s+(?:a\s+)?(?:new\s+)?(?:one|contact|person)"
    r"|new\s+(?:one|contact|person)"
    r"|another\s+(?:one|contact))$",
    re.I,
)
NAME_WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'.-]{0,39}$")
GARBAGE_NAME_RE = re.compile(
    r"\b(skip|skipped|app\s*push|web\s*push|subscription endpoint|user\s+skipped)\b",
    re.I,
)
# Never treat these as person-name tokens (e.g. "aravi s email …").
RESERVED_NAME_TOKENS = frozenset(
    {
        "email",
        "phone",
        "mobile",
        "number",
        "company",
        "city",
        "town",
        "location",
        "name",
        "first",
        "last",
        "contact",
        "create",
        "update",
        "field",
        "fields",
        "user",
        "customer",
        "admin",
        "agent",
        # Create-intent tokens — not a person's given/family name.
        "new",
        "one",
        "another",
        "add",
        "make",
        "start",
        "person",
        # Filler in "name is X" / "called X" — not part of the person's name.
        "is",
        "are",
        "am",
        "was",
        "the",
        "a",
        "an",
        "called",
        "named",
        "show",
        "display",
        "view",
        "find",
        "open",
        "lookup",
        "details",
        "detail",
        "me",
        "their",
        "his",
        "her",
        "he",
        "she",
        "they",
        "its",
        "it's",
        "hes",
        "she's",
        "they're",
        "theyre",
        "i",
        "need",
        "neede",
        "to",
    }
)
NAME_LABELED_VALUE_RE = re.compile(
    r"(?i)^(?:"
    r"(?:their|his|her|its|the|customer(?:'s|s)?|contact(?:'s|s)?)?\s*"
    r"(?:full\s+)?name\s*(?:is|:)\s*"
    r"|(?:he|she|they)(?:'re|'s| is)\s+(?:called|named)\s+"
    r"|(?:call|called)\s+(?:them|him|her)\s+"
    r")([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)*)"
    r"\s*\.?\s*$"
)
CLEAR_SENTINEL = "__CLEAR__"
CLEAR_CITY_RE = re.compile(
    r"\b(no|remove|clear|without|drop|delete)\b.{0,24}\b(location|city|town)\b"
    r"|\b(location|city|town)\b.{0,12}\b(remove|clear|drop)\b",
    re.I,
)
FIRST_NAME_ASK_RE = re.compile(
    r"(first\s*name|given\s*name|what(?:'s| is)\s+the\s+first\s+name)",
    re.I,
)
LAST_NAME_ASK_RE = re.compile(
    r"(last\s*name|surname|family\s*name|what(?:'s| is)\s+the\s+last\s+name)",
    re.I,
)
CITY_ASK_RE = re.compile(
    r"\b(city|town|which\s+city|where\s+.+\s+live)",
    re.I,
)
PHONE_ASK_RE = re.compile(
    r"(phone\s*number|phone|mobile|country\s*code|whatsapp)",
    re.I,
)
EMAIL_ASK_RE = re.compile(
    r"(email\s*address|email\s*id|\bemail\b)",
    re.I,
)
COMPANY_ASK_RE = re.compile(
    r"(company\s*name|organisation|organization|company)",
    re.I,
)


def empty_draft() -> dict[str, Any]:
    d: dict[str, Any] = {k: "" for k in DRAFT_KEYS}
    d["custom_fields"] = {}
    return d


def _truthy_asked(value: Any) -> bool:
    return str(value or "").strip().lower() in ("1", "true", "yes")


def _app_push_resolved(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    if _truthy_asked(d.get("app_push_asked")):
        return True
    return bool(str(d.get("app_push_token") or "").strip())


def _web_push_complete(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    return bool(
        str(d.get("web_push_endpoint") or "").strip()
        and str(d.get("web_push_p256dh") or "").strip()
        and str(d.get("web_push_auth") or "").strip()
    )


def _web_push_resolved(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    if _truthy_asked(d.get("web_push_asked")):
        return True
    return _web_push_complete(d)


def is_push_skip(text: str) -> bool:
    return bool(SKIP_PUSH_RE.match((text or "").strip()))


def is_garbage_person_name(*parts: str) -> bool:
    """True when a placeholder/recap was treated as a person name (e.g. User)."""
    cleaned = [str(p or "").strip() for p in parts if str(p or "").strip()]
    if not cleaned:
        return False
    # Single-token placeholders / create-intent words ("new", "one", …)
    if len(cleaned) == 1 and cleaned[0].lower() in RESERVED_NAME_TOKENS:
        return True
    if any(p.lower() in ("user", "customer", "admin", "agent") for p in cleaned):
        # "User" alone or leading "User skipped…"
        if len(cleaned) == 1 or cleaned[0].lower() in ("user", "customer"):
            return True
    blob = " ".join(cleaned)
    if is_push_skip(blob):
        return True
    if CREATE_COMMAND_AS_NAME_RE.match(blob) or SKIP_AS_NAME_RE.match(blob):
        return True
    # All tokens reserved → e.g. first=New last=One
    if all(p.lower() in RESERVED_NAME_TOKENS for p in cleaned):
        return True
    return bool(GARBAGE_NAME_RE.search(blob))


def message_text(m: dict[str, Any] | None) -> str:
    d = m or {}
    return str(d.get("text") or d.get("content") or "").strip()


def required_identity_fields(campaign_profile: Any = None) -> tuple[str, ...]:
    """Hard-required create keys (channel is email OR phone — see missing_fields)."""
    _ = campaign_profile
    return ("first_name",)


def soft_ask_fields(campaign_profile: Any = None) -> tuple[str, ...]:
    """Ask in chat but do not block create when empty."""
    _ = campaign_profile
    return ("company_name", "city")


def _normalize_custom_fields(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        out: dict[str, Any] = {}
        for k, v in raw.items():
            key = str(k or "").strip()
            if not key:
                continue
            if v is None or (isinstance(v, str) and not str(v).strip()):
                continue
            out[key] = v
        return out
    if isinstance(raw, str) and raw.strip():
        try:
            import json

            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return _normalize_custom_fields(parsed)
        except Exception:  # noqa: BLE001
            return {}
    return {}


def _extra_fields_resolved(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    return _truthy_asked(d.get("extra_fields_asked"))


def _pack_skipped_keys(draft: dict[str, Any] | None) -> set[str]:
    raw = (draft or {}).get("pack_fields_skipped")
    if isinstance(raw, (list, tuple, set)):
        return {str(p).strip() for p in raw if str(p).strip()}
    text = str(raw or "")
    return {p.strip() for p in text.split(",") if p.strip()}


def _mark_pack_skipped(draft: dict[str, Any], key: str) -> None:
    k = str(key or "").strip()
    if not k:
        return
    skipped = _pack_skipped_keys(draft)
    skipped.add(k)
    draft["pack_fields_skipped"] = ",".join(sorted(skipped))


def _unmark_pack_skipped(draft: dict[str, Any], key: str) -> None:
    """Clear a skip flag when the user later provides that field."""
    k = str(key or "").strip()
    if not k:
        return
    skipped = _pack_skipped_keys(draft)
    if k not in skipped:
        return
    skipped.discard(k)
    draft["pack_fields_skipped"] = ",".join(sorted(skipped)) if skipped else ""


def mark_optional_field_skipped(draft: dict[str, Any], field: str) -> None:
    """Record that an optional field was offered and skipped — does not clear other draft values."""
    key = str(field or "").strip().lower()
    if key in ("last_name", "company_name", "city", "email", "phone"):
        _mark_pack_skipped(draft, key)


def unmark_optional_field_skipped(draft: dict[str, Any], field: str) -> None:
    """Clear skip when the user later provides that field."""
    key = str(field or "").strip().lower()
    if key in ("last_name", "company_name", "city", "email", "phone"):
        _unmark_pack_skipped(draft, key)


def _has_contact_channel(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    email = str(d.get("email") or "").strip()
    has_email = bool(email) and is_valid_email(email)
    has_phone = bool(parse_and_validate_phone(str(d.get("phone") or "")).get("ok"))
    return has_email or has_phone


def channel_status(draft: dict[str, Any] | None) -> dict[str, bool]:
    d = draft or {}
    email = str(d.get("email") or "").strip()
    has_email = bool(email) and is_valid_email(email)
    has_phone = bool(parse_and_validate_phone(str(d.get("phone") or "")).get("ok"))
    return {
        "has_email": has_email,
        "has_phone": has_phone,
        "satisfied": has_email or has_phone,
    }


SKIP_CHANNEL_RE = re.compile(
    r"^(skip(\s+it)?(\s+(the\s+)?(phone|number|mobile|email))?|"
    r"none|no|n/?a|not\s+now|later|nope|nah|"
    r"no\s+(phone|number|mobile|email)|"
    r"don'?t\s+have(\s+(a\s+)?(phone|number|mobile|email))?|"
    r"do\s+not\s+have(\s+(a\s+)?(phone|number|mobile|email))?|"
    r"without\s+(a\s+)?(phone|number|email)|"
    r"email\s+only|phone\s+only)(\s+please)?[.!]?\s*$",
    re.I,
)


def is_channel_skip(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if SKIP_CHANNEL_RE.match(t):
        return True
    # Soft phrases: "skip the phone", "no phone number please"
    return bool(
        re.search(
            r"\b(skip|ignore|without)\b.{0,20}\b(phone|number|mobile|email)\b",
            t,
            re.I,
        )
        or re.search(
            r"\b(no|without)\b.{0,12}\b(phone|number|mobile|email)\b",
            t,
            re.I,
        )
    )


def channel_skip_fields(text: str) -> list[str]:
    """Which channel fields the user declined in this utterance."""
    t = (text or "").strip()
    if not t or not is_channel_skip(t):
        return []
    out: list[str] = []
    if re.search(r"\bemail\b", t, re.I):
        out.append("email")
    if re.search(r"\b(phone|number|mobile)\b", t, re.I):
        out.append("phone")
    if not out and SKIP_CHANNEL_RE.match(t):
        m = re.search(r"no\s+(phone|number|mobile|email)", t, re.I)
        if m:
            word = m.group(1).lower()
            out.append("email" if word == "email" else "phone")
    return out


def identity_view_args_from_turn(
    user_text: str,
    *,
    last_assistant: str = "",
) -> dict[str, str] | None:
    """
    When the user supplies a known email (or phone) outside field collection,
    treat as read-only view — not create draft ingest.
    """
    raw = (user_text or "").strip()
    if not raw:
        return None
    assistant = (last_assistant or "").strip()
    em = EMAIL_FIND_RE.search(raw)
    if em:
        candidate = em.group(0).strip().lower()
        if is_valid_email(candidate) and not EMAIL_ASK_RE.search(assistant):
            return {"email": candidate}
    if PHONE_ASK_RE.search(assistant):
        return None
    ph = parse_and_validate_phone(raw)
    if ph.get("ok"):
        digits = re.sub(r"\D", "", raw)
        if len(digits) >= 10 and len(raw.split()) <= 4:
            return {"phone": str(ph["e164"])}
    return None


def sync_draft_from_user_turn(
    session: dict[str, Any],
    user_text: str,
    *,
    last_assistant: str = "",
) -> dict[str, Any]:
    """
    Deterministic pre-LLM ingest for an *active create* draft only.
    Does not classify create vs update intent — the LLM calls SET_DRAFT_FIELDS
    with mode=create / reset_draft when starting a new contact.
    Returns {changed, draft_contact, draft_mode, focus_contact_id, ui_payload}.
    """
    raw = (user_text or "").strip()
    if not raw:
        return {"changed": False}

    draft = {**empty_draft(), **(session.get("draft_contact") or {})}
    mode = str(session.get("draft_mode") or "").lower()
    focus = session.get("focus_contact_id")

    # Update / view: leave draft alone until the LLM uses tools.
    if focus and mode == "update":
        return {"changed": False}
    if mode not in ("create", ""):
        return {"changed": False}

    assistant = (last_assistant or "").strip()
    create_progress = any(
        str(draft.get(k) or "").strip()
        for k in ("first_name", "last_name", "email", "phone")
    )
    field_asked = bool(
        EMAIL_ASK_RE.search(assistant) or PHONE_ASK_RE.search(assistant)
    )
    # Outside mid-create field collection, a bare email/phone is view — not ingest.
    # Mid-create (progress or assistant asked for email/phone) → sync the field.
    if identity_view_args_from_turn(raw, last_assistant=last_assistant):
        if not (mode == "create" and (create_progress or field_asked)):
            return {"changed": False}

    extracted = dict(extract_contact_fields(raw))
    assistant = (last_assistant or "").strip()

    # Bare "First Last" only when the co-worker asked for a name (or labeled "name is X").
    # Otherwise create-intent replies like "new one" must not fill the panel.
    name_asked = bool(
        FIRST_NAME_ASK_RE.search(assistant)
        or LAST_NAME_ASK_RE.search(assistant)
        or re.search(r"(?i)\b(?:full\s+)?name\b", assistant)
    )
    if (
        not name_asked
        and "email" not in extracted
        and "phone" not in extracted
        and not NAME_LABELED_VALUE_RE.match(raw)
    ):
        extracted.pop("first_name", None)
        extracted.pop("last_name", None)

    if (
        PHONE_ASK_RE.search(assistant)
        and "phone" not in extracted
        and re.sub(r"\D", "", raw)
    ):
        ph = parse_and_validate_phone(raw)
        if ph.get("ok"):
            extracted["phone"] = str(ph["e164"])

    if (
        COMPANY_ASK_RE.search(assistant)
        and "company_name" not in extracted
        and not re.sub(r"\D", "", raw)
        and len(raw) <= 80
        and not SKIP_AS_NAME_RE.search(raw)
        and "@" not in raw
    ):
        extracted["company_name"] = raw.strip().strip(".,;")

    if (
        CITY_ASK_RE.search(assistant)
        and "city" not in extracted
        and NAME_WORD_RE.match(raw.split()[0] if raw.split() else "")
    ):
        extracted["city"] = raw.strip().strip(".,;")

    for field in channel_skip_fields(raw):
        mark_optional_field_skipped(draft, field)

    # Scrub create-command names already stuck on the panel (e.g. New / One).
    changed_scrub = False
    for nk in ("first_name", "last_name"):
        if draft.get(nk) and is_garbage_person_name(str(draft.get(nk) or "")):
            draft[nk] = ""
            changed_scrub = True
    if is_garbage_person_name(
        str(draft.get("first_name") or ""),
        str(draft.get("last_name") or ""),
    ):
        draft["first_name"] = ""
        draft["last_name"] = ""
        changed_scrub = True

    merged, changed = merge_extracted(draft, extracted)
    if changed_scrub:
        changed = True
    if merged != draft:
        changed = True
    draft = merged

    if not changed:
        return {"changed": False}

    if not session.get("draft_mode"):
        session["draft_mode"] = "create"
    session["draft_contact"] = draft

    payload: dict[str, Any] = {
        "draft_contact": draft,
        "focus_contact_id": session.get("focus_contact_id"),
        "mode": session.get("draft_mode") or "create",
    }

    return {
        "changed": True,
        "draft_contact": draft,
        "draft_mode": session.get("draft_mode"),
        "focus_contact_id": session.get("focus_contact_id"),
        "ui_payload": payload,
    }


def missing_fields(
    draft: dict[str, Any] | None,
    *,
    include_push: bool | None = None,
    focus_contact_id: str | None = None,
    campaign_profile: Any = None,
) -> list[str]:
    """Hard create gaps: first_name + (valid email OR valid phone)."""
    _ = include_push
    _ = focus_contact_id
    _ = campaign_profile
    d = draft or {}
    miss: list[str] = []
    if not str(d.get("first_name") or "").strip():
        miss.append("first_name")

    email_raw = str(d.get("email") or "").strip()
    phone_raw = str(d.get("phone") or "").strip()
    has_email = bool(email_raw) and is_valid_email(email_raw)
    has_phone = bool(phone_raw) and bool(
        parse_and_validate_phone(phone_raw).get("ok")
    )
    if not has_email and not has_phone:
        miss.append("email")
    return miss


def soft_missing_fields(
    draft: dict[str, Any] | None,
    *,
    campaign_profile: Any = None,
) -> list[str]:
    """Empty soft-ask fields (do not block create). Skipped fields are excluded."""
    d = draft or {}
    skipped = _pack_skipped_keys(d)
    return [
        k
        for k in soft_ask_fields(campaign_profile)
        if k not in skipped and not str(d.get(k) or "").strip()
    ]


def next_creation_prompt_field(
    draft: dict[str, Any] | None,
    *,
    campaign_profile: Any = None,
) -> str | None:
    """Next conversational field for contact_creation — respects pack_fields_skipped."""
    from app.industry_packs.loader import normalize_campaign_profile

    d = draft or {}
    skipped = _pack_skipped_keys(d)
    profile = normalize_campaign_profile(campaign_profile)
    mode = str(profile.get("mode") or "b2b").strip().lower()

    if not str(d.get("first_name") or "").strip():
        return "first_name"
    if not str(d.get("last_name") or "").strip() and "last_name" not in skipped:
        return "last_name"

    email_raw = str(d.get("email") or "").strip()
    phone_raw = str(d.get("phone") or "").strip()
    has_email = bool(email_raw) and is_valid_email(email_raw)
    has_phone = bool(phone_raw) and bool(parse_and_validate_phone(phone_raw).get("ok"))
    # Always ask email then phone (user may skip either; at least one required to create).
    if "email" not in skipped and not has_email:
        return "email"
    if "phone" not in skipped and not has_phone:
        return "phone"
    if not has_email and not has_phone:
        return None

    if mode == "b2b":
        if not str(d.get("company_name") or "").strip() and "company_name" not in skipped:
            return "company_name"
    if not str(d.get("city") or "").strip() and "city" not in skipped:
        return "city"
    return None


_FIELD_LABELS = {
    "first_name": "first name",
    "last_name": "last name",
    "email": "email address",
    "phone": "phone number (with country code)",
    "company_name": "company name",
    "city": "city",
}


def creation_reply_hint(
    draft: dict[str, Any] | None,
    next_field: str | None,
    *,
    skipped_field: str | None = None,
) -> str | None:
    """
    Internal next-field hint for tools/tests — not a user-facing reply template.
    The executor must invent its own phrasing each turn.
    """
    _ = skipped_field
    d = draft or {}
    first = str(d.get("first_name") or "").strip()
    if next_field is None:
        if first and (_has_contact_channel(d)):
            return "ready_to_confirm"
        return "ready_to_confirm"
    return str(next_field)


def split_full_name(name: str) -> tuple[str, str]:
    parts = [p for p in re.split(r"\s+", (name or "").strip()) if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _maybe_full_name(text: str) -> str | None:
    t = (text or "").strip()
    if not t or "@" in t or SKIP_AS_NAME_RE.search(t) or is_garbage_person_name(t):
        return None
    if is_push_skip(t):
        return None
    # Phone-like
    digits = re.sub(r"\D", "", t)
    if len(digits) >= 8 and len(digits) >= len(re.sub(r"\s", "", t)) * 0.6:
        return None
    words = [w for w in re.split(r"\s+", t) if w]
    if not words or len(words) > 4:
        return None
    if not all(NAME_WORD_RE.match(w) for w in words):
        return None
    if any(w.lower() in RESERVED_NAME_TOKENS for w in words):
        # Drop reserved trailing tokens: "aravi s email" → "aravi s"
        words = [w for w in words if w.lower() not in RESERVED_NAME_TOKENS]
        if not words or not all(NAME_WORD_RE.match(w) for w in words):
            return None
    # Single word only if it looks like a given name (not "Company")
    if len(words) == 1 and len(words[0]) < 2:
        return None
    return " ".join(words)


def extract_contact_fields(text: str) -> dict[str, str]:
    """Pull any contact fields present in a single user utterance."""
    out: dict[str, str] = {}
    raw = (text or "").strip()
    if not raw:
        return out

    if CLEAR_CITY_RE.search(raw):
        out["city"] = CLEAR_SENTINEL

    if is_push_skip(raw):
        return out

    em = EMAIL_FIND_RE.search(raw)
    if em:
        candidate = em.group(0).strip().lower()
        if is_valid_email(candidate):
            out["email"] = candidate

    # Prefer whole-string phone; else longest digit run with country code
    ph = parse_and_validate_phone(raw)
    if ph.get("ok"):
        out["phone"] = str(ph["e164"])
    else:
        digit_chunks = re.findall(r"[+]?\d[\d\s().-]{6,}\d", raw)
        for chunk in sorted(digit_chunks, key=len, reverse=True):
            ph2 = parse_and_validate_phone(chunk)
            if ph2.get("ok"):
                out["phone"] = str(ph2["e164"])
                break

    # "name is Aravindh" / "called Maya" → given name(s), not label tokens.
    m_labeled = NAME_LABELED_VALUE_RE.match(raw)
    if m_labeled and not em and "phone" not in out:
        labeled = m_labeled.group(1).strip()
        if labeled and not is_garbage_person_name(labeled):
            fn, ln = split_full_name(labeled)
            if fn:
                out["first_name"] = fn
            if ln:
                out["last_name"] = ln
            out.update(extract_push_fields(raw, expecting=None))
            return out

    # Name: only when the message is primarily a name (or "First Last")
    # If email/phone present, still try leading name before email: "Pujitha Paleti p@x.com"
    name_src = raw
    if em:
        name_src = raw[: em.start()].strip(" ,;-") or raw[em.end() :].strip(" ,;-")
    # Strip a lone "email" label line before the address.
    name_src = re.sub(r"(?i)\bemail\b\s*:?\s*$", "", name_src or "").strip()
    name_src = re.sub(r"(?i)^\s*email\s*:?\s*", "", name_src or "").strip()
    # Utterance includes an email — do not treat words before/after it as a person name
    # ("show user@x.com details" is view, not first_name=Show).
    full = None if em else (_maybe_full_name(name_src) if name_src else None)
    if not full and not em and "phone" not in out:
        full = _maybe_full_name(raw)
    if full:
        first, last = split_full_name(full)
        if first:
            out["first_name"] = first
        if last:
            out["last_name"] = last

    # Explicit "first name is X" / "last name: Y"
    m_first = re.search(
        r"(?:first\s*name|fname)\s*(?:is|:)?\s*([A-Za-z][A-Za-z'.-]*)",
        raw,
        re.I,
    )
    if m_first and not is_garbage_person_name(m_first.group(1)):
        out["first_name"] = m_first.group(1)
    m_last = re.search(
        r"(?:last\s*name|lname|surname)\s*(?:is|:)?\s*([A-Za-z][A-Za-z'.-]*)",
        raw,
        re.I,
    )
    if m_last and not is_garbage_person_name(m_last.group(1)):
        out["last_name"] = m_last.group(1)
    m_company = re.search(
        r"(?:company|organisation|organization)\s*(?:is|:)?\s*(.+)$",
        raw,
        re.I,
    )
    if m_company and "@" not in m_company.group(1):
        company = m_company.group(1).strip().strip(".,")
        if 1 < len(company) < 80 and not SKIP_AS_NAME_RE.search(company):
            out["company_name"] = company
    if "city" not in out:
        m_city = re.search(
            r"(?:city|town)\s*(?:is|:)?\s*([A-Za-z][A-Za-z\s'.-]{1,40})$",
            raw,
            re.I,
        )
        if m_city:
            city_val = m_city.group(1).strip()
            if city_val.lower() not in RESERVED_NAME_TOKENS:
                out["city"] = city_val

    out.update(extract_push_fields(raw, expecting=None))
    return out


def infer_push_expecting(assistant_text: str) -> str | None:
    t = (assistant_text or "").lower()
    if re.search(r"web\s*push|subscription endpoint|p256dh|\bauth key\b", t):
        return "web_push"
    if re.search(r"app\s*push|fcm|apns|device token|push id|push token", t):
        return "app_push"
    return None


def extract_push_fields(
    text: str,
    *,
    expecting: str | None = None,
) -> dict[str, str]:
    """Parse App push / Web push from a user reply. Skip is allowed."""
    out: dict[str, str] = {}
    raw = (text or "").strip()
    if not raw:
        return out

    if expecting == "app_push" and is_push_skip(raw):
        out["app_push_asked"] = "1"
        return out
    if expecting == "web_push" and is_push_skip(raw):
        out["web_push_asked"] = "1"
        return out

    m_app = re.search(
        r"(?:app\s*push(?:\s*id)?|fcm(?:\s*token)?|apns(?:\s*token)?|device token)\s*(?:is|:)?\s*(\S.+)$",
        raw,
        re.I,
    )
    fcm = FCM_TOKEN_RE.search(raw)
    if m_app:
        token = m_app.group(1).strip().strip(".,;")
        if token and not is_push_skip(token):
            out["app_push_token"] = token.split()[0]
            out["app_push_asked"] = "1"
    elif fcm:
        out["app_push_token"] = fcm.group(0)
        out["app_push_asked"] = "1"
    elif expecting == "app_push" and not is_push_skip(raw) and "@" not in raw:
        token = re.sub(r"\b(android|ios|iphone|web|platform)\b", "", raw, flags=re.I).strip()
        token = token.strip(" ,;:-")
        if 12 <= len(token) <= 4096 and not EMAIL_FIND_RE.search(token):
            out["app_push_token"] = token.split()[0] if " " not in token.strip() else token
            out["app_push_asked"] = "1"

    plat = PLATFORM_RE.search(raw)
    if plat and (out.get("app_push_token") or expecting == "app_push" or m_app):
        p = plat.group(1).lower()
        out["app_push_platform"] = "ios" if p in ("ios", "iphone") else p

    m_ep = re.search(
        r"(?:web\s*push|subscription)?\s*endpoint\s*(?:is|:)?\s*(https://\S+)",
        raw,
        re.I,
    )
    url_match = HTTPS_URL_RE.search(raw)
    url = (m_ep.group(1).strip().rstrip(".,;") if m_ep else None) or (
        url_match.group(0).rstrip(".,;")
        if url_match
        and (expecting == "web_push" or re.search(r"web\s*push|endpoint|p256dh", raw, re.I))
        else None
    )
    if url:
        out["web_push_endpoint"] = url

    m_p256 = re.search(r"p256dh\s*(?:key)?\s*(?:is|:)?\s*(\S+)", raw, re.I)
    if m_p256:
        out["web_push_p256dh"] = m_p256.group(1).strip().rstrip(".,;")
    m_auth = re.search(r"\bauth\s*(?:key)?\s*(?:is|:)?\s*(\S+)", raw, re.I)
    if m_auth:
        out["web_push_auth"] = m_auth.group(1).strip().rstrip(".,;")

    if expecting == "web_push" and not url and not m_p256 and not m_auth:
        parts = [p.strip() for p in re.split(r"[\s,;]+", raw) if p.strip()]
        https_parts = [p.rstrip(".,;") for p in parts if p.lower().startswith("https://")]
        other = [p for p in parts if not p.lower().startswith("https://") and not is_push_skip(p)]
        if https_parts:
            out["web_push_endpoint"] = https_parts[0]
        if len(other) >= 2:
            out.setdefault("web_push_p256dh", other[0])
            out.setdefault("web_push_auth", other[1])
        elif len(other) == 1 and out.get("web_push_endpoint"):
            out.setdefault("web_push_p256dh", other[0])

    probe = {**out}
    if _web_push_complete(probe):
        out["web_push_asked"] = "1"

    return out


def try_combine_phone_from_messages(user_texts: list[str]) -> str | None:
    """Combine '9346765884' + '91' (or reverse) into E.164 when possible."""
    recent = [t.strip() for t in user_texts if t and t.strip()][-4:]
    if len(recent) < 2:
        return None
    for i in range(len(recent) - 1, 0, -1):
        a, b = recent[i - 1], recent[i]
        for left, right in ((a, b), (b, a)):
            da, db = re.sub(r"\D", "", left), re.sub(r"\D", "", right)
            if not da or not db:
                continue
            # country code then national
            if 1 <= len(da) <= 3 and 8 <= len(db) <= 12:
                ph = parse_and_validate_phone(da + db)
                if ph.get("ok"):
                    return str(ph["e164"])
            if 1 <= len(db) <= 3 and 8 <= len(da) <= 12:
                ph = parse_and_validate_phone(db + da)
                if ph.get("ok"):
                    return str(ph["e164"])
            # concatenated as typed across two messages already full
            ph = parse_and_validate_phone(left + right)
            if ph.get("ok"):
                return str(ph["e164"])
    return None


def merge_extracted(
    draft: dict[str, Any] | None, extracted: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Fill draft slots from extracted; overwrite garbage names like 'User'."""
    next_draft = empty_draft()
    cur = draft or {}
    for k in DRAFT_KEYS:
        next_draft[k] = str(cur.get(k) or "").strip()
    next_draft["custom_fields"] = _normalize_custom_fields(cur.get("custom_fields"))
    # Drop garbage placeholders already sitting in the draft.
    for nk in ("first_name", "last_name"):
        if next_draft[nk] and is_garbage_person_name(next_draft[nk]):
            next_draft[nk] = ""
    if is_garbage_person_name(
        str(next_draft.get("first_name") or ""),
        str(next_draft.get("last_name") or ""),
    ):
        next_draft["first_name"] = ""
        next_draft["last_name"] = ""
    changed = False
    push_value_keys = (
        "app_push_token",
        "app_push_platform",
        "web_push_endpoint",
        "web_push_p256dh",
        "web_push_auth",
    )
    for k, v in extracted.items():
        if k == "custom_fields":
            merged_cf = {
                **_normalize_custom_fields(next_draft.get("custom_fields")),
                **_normalize_custom_fields(v),
            }
            if merged_cf != next_draft.get("custom_fields"):
                next_draft["custom_fields"] = merged_cf
                next_draft["extra_fields_asked"] = "1"
                changed = True
            continue
        if k not in DRAFT_KEYS:
            continue
        val = str(v or "").strip()
        if val == CLEAR_SENTINEL:
            if next_draft[k]:
                next_draft[k] = ""
                changed = True
            continue
        if not val:
            continue
        if k in (
            "app_push_asked",
            "web_push_asked",
            "extra_fields_asked",
        ):
            if not _truthy_asked(next_draft[k]) and _truthy_asked(val):
                next_draft[k] = "1"
                changed = True
            continue
        if k in ("first_name", "last_name") and is_garbage_person_name(val):
            continue
        if k == "email":
            if not is_valid_email(val):
                continue
        if k == "phone":
            parsed = parse_and_validate_phone(val)
            if not parsed.get("ok"):
                continue
            val = str(parsed.get("e164") or val)
        if not next_draft[k]:
            next_draft[k] = val
            changed = True
        elif k in ("first_name", "last_name") and is_garbage_person_name(next_draft[k]):
            next_draft[k] = val
            changed = True
        elif k == "phone" and next_draft[k] != val:
            next_draft[k] = val
            changed = True
        elif k in push_value_keys and next_draft[k] != val:
            next_draft[k] = val
            changed = True
        else:
            continue
        if k == "app_push_token":
            next_draft["app_push_asked"] = "1"
        if k in ("web_push_endpoint", "web_push_p256dh", "web_push_auth") and _web_push_complete(
            next_draft
        ):
            next_draft["web_push_asked"] = "1"
    for nk in ("first_name", "last_name"):
        if next_draft[nk]:
            titled = title_case_person_name(next_draft[nk])
            if titled != next_draft[nk]:
                next_draft[nk] = titled
                changed = True
    return next_draft, changed


def extract_from_user_history(messages: list[dict[str, Any]]) -> dict[str, str]:
    """Scan recent user messages (oldest→newest) and accumulate fields."""
    recent = [
        m
        for m in (messages or [])[-20:]
        if message_text(m) and m.get("role") in ("user", "assistant")
    ]
    user_texts = [
        message_text(m)
        for m in recent
        if m.get("role") == "user"
    ]
    combined: dict[str, str] = {}
    last_assistant = ""
    identity_or_push = (
        "email",
        "phone",
        "app_push_token",
        "web_push_endpoint",
        "web_push_p256dh",
        "web_push_auth",
    )
    for m in recent:
        content = message_text(m)
        if m.get("role") == "assistant":
            last_assistant = content
            continue
        expecting = infer_push_expecting(last_assistant)
        if expecting in ("app_push", "web_push") and is_push_skip(content):
            part = extract_push_fields(content, expecting=expecting)
        else:
            part = extract_contact_fields(content)
            part.update(extract_push_fields(content, expecting=expecting))
            # Contextual single-token answers after an explicit ask.
            token = content.strip()
            if (
                FIRST_NAME_ASK_RE.search(last_assistant or "")
                and NAME_WORD_RE.match(token)
                and token.lower() not in RESERVED_NAME_TOKENS
                and not is_garbage_person_name(token)
            ):
                part["first_name"] = token
            elif (
                LAST_NAME_ASK_RE.search(last_assistant or "")
                and NAME_WORD_RE.match(token)
                and token.lower() not in RESERVED_NAME_TOKENS
                and not is_garbage_person_name(token)
            ):
                part["last_name"] = token
            elif (
                CITY_ASK_RE.search(last_assistant or "")
                and NAME_WORD_RE.match(token)
                and token.lower() not in RESERVED_NAME_TOKENS
            ):
                part["city"] = token
        part = {
            k: v
            for k, v in part.items()
            if k not in ("first_name", "last_name") or not is_garbage_person_name(str(v or ""))
        }
        for k, v in part.items():
            if v == CLEAR_SENTINEL:
                combined[k] = CLEAR_SENTINEL
                continue
            if not v:
                continue
            # Prefer later real names over earlier garbage / empty.
            if k in ("first_name", "last_name"):
                prev = combined.get(k)
                if not prev or is_garbage_person_name(str(prev)):
                    combined[k] = v
                continue
            if k not in combined or combined.get(k) == CLEAR_SENTINEL:
                combined[k] = v
            elif k in identity_or_push:
                combined[k] = v
            elif k in ("app_push_asked", "web_push_asked"):
                combined[k] = "1"
    if "phone" not in combined or combined.get("phone") == CLEAR_SENTINEL:
        combo = try_combine_phone_from_messages(user_texts)
        if combo:
            combined["phone"] = combo
    return combined


def format_push_summary_value(draft: dict[str, Any] | None, kind: str) -> str:
    d = draft or {}
    if kind == "app_push":
        token = str(d.get("app_push_token") or "").strip()
        plat = str(d.get("app_push_platform") or "").strip()
        if token:
            shown = token if len(token) <= 24 else f"{token[:10]}…{token[-6:]}"
            return f"{shown} ({plat})" if plat else shown
        if _truthy_asked(d.get("app_push_asked")):
            return "Skipped"
        return "—"
    endpoint = str(d.get("web_push_endpoint") or "").strip()
    if endpoint:
        return endpoint if len(endpoint) <= 48 else f"{endpoint[:36]}…"
    if _truthy_asked(d.get("web_push_asked")):
        return "Skipped"
    return "—"


def draft_status_line(
    missing: list[str] | None,
    draft: dict[str, Any] | None = None,
) -> str:
    """One-line create readiness for UI (not injected as LLM scripts)."""
    miss = list(missing) if missing is not None else missing_fields(draft)
    if "first_name" in miss:
        return "Need a first name."
    if "email" in miss:
        return "Need an email address."
    if "phone" in miss:
        return "Need a phone with country code."
    return "Ready to create — confirm in chat."


def draft_summary_lines(draft: dict[str, Any] | None) -> str:
    """Filled facts only — do not list empty optionals as gaps."""
    d = draft or {}
    lines: list[str] = []
    fn = str(d.get("first_name") or "").strip()
    ln = str(d.get("last_name") or "").strip()
    name = " ".join(p for p in (fn, ln) if p).strip()
    if name:
        lines.append(f"Name: {name}")
    elif fn:
        lines.append(f"First name: {fn}")
    email = str(d.get("email") or "").strip()
    phone = str(d.get("phone") or "").strip()
    if email:
        lines.append(f"Email: {email}")
    if phone:
        lines.append(f"Phone: {phone}")
    company = str(d.get("company_name") or "").strip()
    city = str(d.get("city") or "").strip()
    if company:
        lines.append(f"Company: {company}")
    if city:
        lines.append(f"City: {city}")
    cf = _normalize_custom_fields(d.get("custom_fields"))
    if cf:
        extras = ", ".join(f"{k}={v}" for k, v in list(cf.items())[:12])
        lines.append(f"Extra fields: {extras}")
    if not lines:
        return "No contact fields filled yet."
    return "\n".join(lines)


def next_missing_prompt(
    missing: list[str],
    draft: dict[str, Any] | None = None,
    *,
    campaign_profile: Any = None,
) -> str:
    """Kept for callers; returns empty — LLM decides the next question from chat + draft."""
    _ = (missing, draft, campaign_profile)
    return ""
