"""Shared conversational draft helpers — next-question prompts and human tone."""

from __future__ import annotations

import difflib
import re
from typing import Any

from app.agents.coworker_shared import trim_at_next_field


def _s(draft: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = draft.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def merge_draft(
    current: dict[str, Any] | None, patch: dict[str, Any] | None
) -> dict[str, Any]:
    out = dict(current or {})
    for k, v in (patch or {}).items():
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        out[k] = v
    return out


def parse_money_amount(text: str) -> str | None:
    """Parse chat amounts like `$1,200`, `25k`, `amount 2.5k`, `amount: 5000`."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    # k-shorthand first so "amount 25k" is not truncated to "25"
    k_m = re.search(
        r"(?:\$?\s*)?(?:amount\s*(?:as|to|:|=)?\s*)?\$?\s*"
        r"([\d,]+(?:\.\d+)?)\s*k\b",
        stripped,
        re.I,
    )
    if k_m:
        try:
            return str(float(k_m.group(1).replace(",", "")) * 1000)
        except ValueError:
            return None
    dollar_m = re.search(r"\$\s*([\d,]+(?:\.\d+)?)", stripped)
    if dollar_m:
        return dollar_m.group(1).replace(",", "")
    amount_m = re.search(
        r"\bamount\s*(?:as|to|:|=)?\s*\$?\s*([\d,]+(?:\.\d+)?)\b",
        stripped,
        re.I,
    )
    if amount_m:
        return amount_m.group(1).replace(",", "")
    return None


_UTTERANCE_NOISE = frozenset(
    {
        "create",
        "add",
        "new",
        "start",
        "make",
        "draft",
        "register",
        "setup",
        "insert",
        "log",
        "help",
        "me",
        "please",
        "a",
        "an",
        "the",
        "to",
        "for",
        "with",
        "my",
        "our",
        "want",
        "need",
        "contact",
        "contacts",
        "lead",
        "person",
        "people",
        "company",
        "companies",
        "account",
        "organization",
        "org",
        "deal",
        "deals",
        "opportunity",
        "opportunities",
        "pipeline",
        "product",
        "sku",
        "invoice",
        "bill",
        "quote",
        "quotation",
        "activity",
        "activities",
        "call",
        "meeting",
        "task",
        "note",
        "one",
        "some",
        "set",
        "up",
        "let",
        "lets",
        "named",
        "called",
    }
)

_UTTERANCE_FUZZY = (
    "contact",
    "contacts",
    "create",
    "company",
    "companies",
    "deal",
    "deals",
    "product",
    "invoice",
    "quote",
    "quotation",
    "activity",
    "activities",
    "person",
    "people",
)


def _token_is_create_noise(tok: str) -> bool:
    t = (tok or "").strip().lower()
    if not t or t in _UTTERANCE_NOISE or len(t) < 2:
        return True
    return any(
        abs(len(t) - len(w)) <= 2
        and difflib.SequenceMatcher(None, t, w).ratio() >= 0.72
        for w in _UTTERANCE_FUZZY
    )


def utterance_has_details(text: str) -> bool:
    """True when the user volunteered field values beyond a bare create ask.

    Typos like "cotact" / "crete" must not count as details — otherwise we
    narrate "pull in what you shared" on a bare create.
    """
    tokens = re.findall(r"[\w@.+-]+", text or "")
    leftover = [t for t in tokens if not _token_is_create_noise(t)]
    return any(len(t) >= 2 for t in leftover)


CONTACT_FIRST_NAME_Q = "Sure! What's their full name?"

_NUMBER_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}


def parse_contact_count_reply(text: str) -> int | None:
    stripped = re.sub(r"[.!\s]+$", "", (text or "").strip().lower())
    if re.fullmatch(r"\d{1,2}", stripped):
        n = int(stripped)
        return n if 1 <= n <= 20 else None
    if stripped in _NUMBER_WORDS:
        return _NUMBER_WORDS[stripped]
    if re.fullmatch(r"(just\s+)?(one|a\s+single(\s+one)?|only\s+one)", stripped):
        return 1
    return None


def contact_count_followup(n: int) -> str:
    if n <= 1:
        return "Great! What is the first name?"
    return "Great! Let's start with the first contact. What is the first name?"


def open_in_shell_create(
    text: str,
    *,
    label: str,
    first_question: str,
) -> dict[str, Any]:
    """Open create workspace. Speech is only the next human question — never UI narration."""
    rich = utterance_has_details(text)
    speech = "Sure! Let's add them." if rich else first_question
    return {
        "ok": True,
        "assistantText": speech,
        "toolProposals": [
            {
                "id": "ws-create",
                "name": "set_workspace",
                "label": label,
                "args": {
                    "mode": "create",
                    **({"seedPrompt": text.strip()[:2000]} if rich else {}),
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


READY_CREATE_CHAT = "That looks complete on my side — shall I save it?"

_SAVE_OFFER_RE = re.compile(
    r"\b("
    r"ready to save|shall i save|shall i create|"
    r"looks complete|save (your|the|this)|"
    r"when you('re| are) ready"
    r")\b",
    re.I,
)


def looks_like_save_offer(text: str) -> bool:
    """True when speech is offering to persist, not asking the next field."""
    return bool(_SAVE_OFFER_RE.search(str(text or "")))

CREATING_CONTACT_CHAT = "Perfect — saving them now."

_CREATE_CONFIRM_RE = re.compile(
    r"^\s*(yes|yep|yeah|yup|y|ok|okay|sure|please|confirm|absolutely|definitely|"
    r"create(\s+(it|them|the\s+\w+|contact|deal|company|product))?(\s+now)?|"
    r"save(\s+(it|them|the\s+\w+|contact|deal|company|product|anyway))?(\s+now)?|"
    r"save\s+anyway|continue\s+anyway|create\s+anyway|"
    r"add(\s+(it|them|the\s+\w+|contact|deal|company|product))?(\s+now)?|"
    r"do\s+it|go\s+ahead|go\s+for\s+it|looks?\s+good|sounds?\s+good|"
    r"that'?s\s+(fine|good|all|it)|thats\s+(fine|good|all|it)|"
    r"nothing\s+else|no\s+more|all\s+set|we'?re\s+good|perfect|great|"
    r"alright|all\s+right|please\s+do)"
    r"(\s+(please|thanks|thank\s+you|now|save(\s+it)?|create(\s+it)?|go\s+ahead|do\s+it))*"
    r"\s*[.!]?\s*$",
    re.I,
)


def contact_draft_ready(draft: dict[str, Any] | None) -> bool:
    """Ready when first name is set. Last name and email/phone are optional here."""
    d = draft or {}
    return bool(_s(d, "firstName"))


def contact_draft_save_ready(
    draft: dict[str, Any] | None,
    business_type: str | None = None,
) -> bool:
    """Ready to persist — first name plus email or phone (last name and company optional)."""
    del business_type
    if not contact_draft_ready(draft):
        return False
    d = draft or {}
    return bool(_s(d, "email") or _s(d, "phone"))


def contact_next_ask_key(draft: dict[str, Any] | None) -> str:
    """Authoritative next create slot for STM pendingAsk (and speech fallback).

    Returns firstName|lastName|email|phone|company|title|city|country|save.
    Save requires first name and at least one of email or phone. Last name is optional.
    Lead source is never asked — it defaults to crm.
    """
    from app.agents.contact_draft_agent import skipped_optional_fields

    d = draft if isinstance(draft, dict) else {}
    skipped = skipped_optional_fields(d)
    has_first = bool(_s(d, "firstName"))
    has_last = bool(_s(d, "lastName"))
    has_email = bool(_s(d, "email"))
    has_phone = bool(_s(d, "phone"))
    if not has_first and not has_last:
        return "firstName"
    if has_first and not has_last and "lastName" not in skipped:
        return "lastName"
    if has_last and not has_first:
        return "firstName"
    if not has_email and "email" not in skipped:
        return "email"
    if not has_phone and "phone" not in skipped:
        return "phone"
    # Invalid skip state — re-ask the missing reachability channel.
    if not has_email and not has_phone:
        return "phone" if "email" in skipped else "email"
    if not _s(d, "companyId", "companyName") and "company" not in skipped:
        return "company"
    if not _s(d, "title") and "title" not in skipped:
        return "title"
    if not _s(d, "city") and "city" not in skipped:
        return "city"
    if not _s(d, "country") and "country" not in skipped:
        return "country"
    return "save"


def ready_create_chat(draft: dict[str, Any] | None = None) -> str:
    """Natural save offer — never instruct the user to type a magic word."""
    d = draft or {}
    name = " ".join(
        x for x in (_s(d, "firstName"), _s(d, "lastName")) if x
    ).strip()
    email = _s(d, "email")
    phone = _s(d, "phone")
    if name and email:
        return f"I have **{name}** at {email}. Shall I save them?"
    if name and phone:
        return f"I have **{name}** at {phone}. Shall I save them?"
    if name:
        return f"I have **{name}** ready. Shall I save them?"
    title = _s(d, "title") or _s(d, "name")
    company = _s(d, "companyName")
    if title and company:
        return f"I have **{title}** for **{company}**. Shall I save it?"
    if title:
        return f"I have **{title}** ready. Shall I save it?"
    deal_hint = _s(d, "dealId")
    subject = _s(d, "subject")
    if subject:
        return f"I have **{subject}** ready to log. Shall I save it?"
    if deal_hint:
        return "That looks complete on my side — shall I save it?"
    return READY_CREATE_CHAT


def is_field_add_not_create(text: str) -> bool:
    """True when 'add/set a phone|email|…' means update a field, not create a record."""
    lower = (text or "").strip().lower()
    if not lower:
        return False
    # Explicit new-record language wins (including "add a contact/deal/…")
    if re.search(
        r"\b(new|create|insert|add)\s+(a\s+|an\s+|new\s+)?(contact|lead|person|deal|opportunit|"
        r"compan(?:y|ies)|product|quote|invoice|activit|location|account|organization)\b",
        lower,
    ):
        return False
    if re.search(
        r"\b(add|set|include|put|insert|update|change)\s+"
        r"(a\s+|an\s+|the\s+|their\s+|his\s+|her\s+)?"
        r"(phone|mobile|email|mail|address|title|job\s*title|company|domain|"
        r"industry|amount|stage|price|sku|notes?|city|country|linkedin|"
        r"quantity|discount|subject|currency)\b",
        lower,
    ):
        return True
    return False

def looks_like_create_confirm(text: str) -> bool:
    """True when the user is confirming save, not volunteering new field values."""
    stripped = (text or "").strip()
    if not stripped:
        return False
    lower = stripped.lower()
    # "create contact" / "new contact" open a draft — not save confirmation.
    if re.search(
        r"^\s*(create|new|add|make|start|register|set\s*up)\s+(a\s+|an\s+)?"
        r"(contact|lead|person)\b",
        lower,
    ):
        return False
    if re.match(r"^\s*(create|new)\s+(contact|lead|person)\s*[.!]?\s*$", lower):
        return False
    if _CREATE_CONFIRM_RE.match(stripped):
        return True
    # Soft confirmations: "yes please", "yes save it", "ok go ahead"
    if re.match(r"^\s*(yes|yep|yeah|yup|y|ok|okay|sure)\b", lower):
        if "@" in stripped or re.search(
            r"\b(named|called|email|phone|amount|title\s+as|domain)\b",
            lower,
        ):
            return False
        if len(stripped.split()) <= 6:
            return True
    if re.search(
        r"\b(create|save|confirm|add\s+them|go\s+ahead)\b",
        lower,
    ) and not utterance_has_details(stripped):
        return True
    return False


def utterance_is_one_shot_create(text: str) -> bool:
    """Create/add with details in the same message — save once the draft is ready."""
    if not utterance_has_details(text):
        return False
    return bool(
        re.search(
            r"\b(create|add|new|register|set\s*up)\b",
            text,
            re.I,
        )
    )

def propose_create_contact_proposal(
    *,
    proposal_id: str = "create-contact",
    auto: bool = False,
) -> dict[str, Any]:
    """Propose saving the contact. auto=True runs in chat without a Confirm button."""
    return {
        "id": proposal_id,
        "name": "propose_create_contact",
        "label": "Create contact",
        "args": {"auto": True} if auto else {},
        "risk": "low" if auto else "high",
    }


def propose_import_contacts_proposal(
    *,
    csv_text: str | None = None,
    sample: bool = False,
    proposal_id: str = "import-contacts",
) -> dict[str, Any]:
    """Import contacts from chat CSV (form-owned Fastify write)."""
    args: dict[str, Any] = {"auto": True}
    text = (csv_text or "").strip()
    if text:
        args["csvText"] = text[:200_000]
    if sample:
        args["sample"] = True
    return {
        "id": proposal_id,
        "name": "propose_import_contacts",
        "label": "Import contacts",
        "args": args,
        "risk": "low",
    }


def parse_contact_field_update(text: str) -> dict[str, str] | None:
    """Extract explicit contact field assignments from chat (detail edit)."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    lower = stripped.lower()
    # Don't treat create/list commands as field edits
    if re.search(
        r"\b(create|add new|show all|back to list|help me create)\b", lower
    ):
        return None

    # "update cuntry as india" / "change the contact's country to India"
    normalized = re.sub(
        r"^(?:please\s+)?(?:update|change|edit|set|make)\s+",
        "",
        stripped,
        flags=re.I,
    ).strip()
    normalized = re.sub(
        r"^(?:the\s+)?(?:contact'?s?\s+|their\s+|his\s+|her\s+)",
        "",
        normalized,
        flags=re.I,
    ).strip()

    def _extract(source: str) -> dict[str, str]:
        patch: dict[str, str] = {}

        email_m = re.search(
            r"(?:set\s+)?(?:their\s+|the\s+|his\s+|her\s+)?email\s*"
            r"(?:(?:as|to|:|=)\s*)?"
            r"([\w.+-]+@[\w.-]+\.\w+)",
            source,
            re.I,
        )
        if email_m:
            patch["email"] = email_m.group(1).strip()

        phone_m = re.search(
            r"(?:set\s+)?(?:their\s+|the\s+|his\s+|her\s+)?(?:phone|mobile|number)\s*"
            r"(?:(?:as|to|:|=)\s*)?(.+)$",
            source,
            re.I,
        )
        if phone_m:
            phone_val = trim_at_next_field(
                re.sub(r"\s+", " ", phone_m.group(1)).strip()
            )
            if phone_val and not re.match(
                r"^(as|to|number|field)$", phone_val, re.I
            ):
                # Require a digit so bare "phone" / "add a phone number" stay pending
                if re.search(r"\d", phone_val):
                    patch["phone"] = phone_val[:40]

        title_m = re.search(
            r"(?:set\s+)?(?:their\s+|the\s+|his\s+|her\s+)?"
            r"(?:title|job\s*title|role|position)\s*"
            r"(?:as|to|:|=)\s*(.+)$",
            source,
            re.I,
        )
        if title_m:
            patch["title"] = trim_at_next_field(
                title_m.group(1).strip().rstrip(".!")
            )[:120]

        notes_m = re.search(
            r"(?:set\s+)?(?:their\s+|the\s+)?notes?\s*(?:as|to|:|=)\s*(.+)$",
            source,
            re.I,
        )
        if notes_m:
            patch["notes"] = trim_at_next_field(notes_m.group(1).strip())[:2000]

        city_m = re.search(
            r"(?:set\s+)?(?:their\s+|the\s+|his\s+|her\s+)?city\s*"
            r"(?:(?:field\s+)?(?:as|to|:|=)\s*)?(.+)$",
            source,
            re.I,
        )
        if city_m:
            city_val = trim_at_next_field(city_m.group(1).strip().rstrip(".!"))
            if city_val and not re.match(r"^(as|to|field)$", city_val, re.I):
                patch["city"] = city_val[:80]

        address_m = re.search(
            r"(?:set\s+)?(?:their\s+|the\s+|his\s+|her\s+)?"
            r"(?:address|street\s*address|address\s*line)\s*"
            r"(?:(?:as|to|:|=)\s*)(.+)$",
            source,
            re.I,
        )
        if address_m:
            patch["addressLine"] = trim_at_next_field(
                address_m.group(1).strip().rstrip(".!")
            )[:200]

        # Common typos: coutry / cuntry / contry
        country_m = re.search(
            r"(?:set\s+)?(?:their\s+|the\s+|his\s+|her\s+)?"
            r"(?:country|coutry|cuntry|contry|countyr|nation)\s*"
            r"(?:(?:field\s+)?(?:as|to|:|=)\s*)?(.+)$",
            source,
            re.I,
        )
        if country_m:
            country_val = trim_at_next_field(
                country_m.group(1).strip().rstrip(".!")
            )
            if country_val and not re.match(r"^(as|to|field)$", country_val, re.I):
                patch["country"] = country_val[:80]

        first_m = re.search(
            r"(?:set\s+|update\s+|change\s+|edit\s+)?"
            r"(?:their\s+|the\s+|his\s+|her\s+|contact'?s?\s+)?"
            r"first\s*name\s*(?:as|to|:|=)\s*(.+)$",
            source,
            re.I,
        )
        if first_m:
            patch["firstName"] = first_m.group(1).strip().split()[0][:80]

        last_m = re.search(
            r"(?:set\s+|update\s+|change\s+|edit\s+)?"
            r"(?:their\s+|the\s+|his\s+|her\s+|contact'?s?\s+)?"
            r"last\s*name\s*(?:as|to|:|=)\s*(.+)$",
            source,
            re.I,
        )
        if last_m:
            patch["lastName"] = last_m.group(1).strip().split()[0][:80]

        # Full name only when not already a first/last-name assignment
        # (otherwise "last name as guna" also matches bare "name as …").
        # "company name …" is a company field, not the contact's full name.
        if (
            "firstName" not in patch
            and "lastName" not in patch
            and not re.search(r"\b(?:first|last|company)\s+name\b", source, re.I)
        ):
            name_m = re.search(
                r"(?:set\s+|update\s+|change\s+)?"
                r"(?:their\s+|the\s+)?"
                r"(?:full\s+)?name\s*(?:as|to|:|=)\s*(.+)$|"
                r"rename\s+(?:them\s+)?to\s+(.+)$",
                source,
                re.I,
            )
            if name_m:
                full = (name_m.group(1) or name_m.group(2) or "").strip()
                parts = re.findall(r"[A-Za-z][\w'-]*", full)
                if len(parts) >= 2:
                    patch["firstName"] = parts[0][:80]
                    patch["lastName"] = parts[-1][:80]
                elif len(parts) == 1:
                    patch["firstName"] = parts[0][:80]

        return patch

    patch = _extract(stripped)
    if not patch and normalized and normalized.lower() != stripped.lower():
        patch = _extract(normalized)
    return patch or None


def describe_contact_patch(patch: dict[str, str]) -> str:
    labels = {
        "firstName": "first name",
        "lastName": "last name",
        "email": "email",
        "phone": "phone",
        "title": "title",
        "notes": "notes",
        "city": "city",
        "country": "country",
        "addressLine": "address",
    }
    bits = []
    for key, label in labels.items():
        if key in patch:
            bits.append(f"{label} to **{patch[key]}**")
    if not bits:
        return "those details"
    if len(bits) == 1:
        return bits[0]
    return ", ".join(bits[:-1]) + f", and {bits[-1]}"


def parse_company_field_update(text: str) -> dict[str, str] | None:
    """Extract explicit company field assignments from chat."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    lower = stripped.lower()
    if re.search(
        r"\b(create|add new|show all|back to list|help me create|location)\b",
        lower,
    ):
        return None

    # Drop trailing "of this contact/company" so values parse cleanly
    cleaned = re.sub(
        r"\s+of\s+(?:this\s+)?(?:contact|company|person|them|it)\s*$",
        "",
        stripped,
        flags=re.I,
    ).strip()

    patch: dict[str, str] = {}

    # Prefer "rename/change/set … company name to X". Never treat "first/last name"
    # as a company rename (those are contact fields). Bare "name as X" is contact.
    if re.search(r"\b(?:first|last)\s+name\b", cleaned, re.I):
        name_m = None
    else:
        name_m = re.search(
            r"(?:rename|change|update|set|edit)\s+"
            r"(?:the\s+)?company(?:\s+name)?\s+"
            r"(?:as|to|:|=)\s*(.+)$",
            cleaned,
            re.I,
        )
        if not name_m:
            name_m = re.search(
                r"rename\s+(?:the\s+)?company\s+to\s+(.+)$",
                cleaned,
                re.I,
            )
        if not name_m:
            name_m = re.search(
                r"(?:the\s+)?company\s+name\s*(?:as|to|:|=)\s*(.+)$",
                cleaned,
                re.I,
            )
    if name_m:
        name_val = sanitize_company_update_name(name_m.group(1) or "")
        if name_val:
            patch["name"] = name_val

    domain_m = re.search(
        r"(?:set\s+)?(?:the\s+)?(?:domain|website)\s*"
        r"(?:(?:as|to|:|=)\s*)?"
        r"([\w.-]+\.[a-z]{2,})",
        cleaned,
        re.I,
    )
    if domain_m:
        patch["domain"] = domain_m.group(1).lower()

    industry_m = re.search(
        r"(?:set\s+|change\s+|update\s+|edit\s+)?"
        r"(?:the\s+)?industry(?:\s+type)?\s*"
        r"(?:(?:as|to|:|=)\s*)?(.+)$",
        cleaned,
        re.I,
    )
    if industry_m:
        val = industry_m.group(1).strip().rstrip(".!")
        val = re.sub(
            r"\s+of\s+(?:this\s+)?(?:contact|company|person).*$",
            "",
            val,
            flags=re.I,
        ).strip()
        val = trim_at_next_field(val)
        if val and not re.match(
            r"^(of|this|contact|company|type|the|as|to|field)$", val, re.I
        ):
            patch["industry"] = val[:120]

    linkedin_m = re.search(
        r"(?:set\s+)?(?:the\s+)?linkedin\s*(?:url\s*)?(?:as|to|:|=)\s*(.+)$",
        cleaned,
        re.I,
    )
    if linkedin_m:
        patch["linkedinUrl"] = trim_at_next_field(linkedin_m.group(1).strip())[:300]

    employees_m = re.search(
        r"(?:set\s+|change\s+|update\s+)?"
        r"(?:the\s+)?(?:employee\s*count|employees|company\s*size)\s*"
        r"(?:as|to|:|=)\s*(\d[\d,]*)",
        cleaned,
        re.I,
    )
    if employees_m:
        patch["employeeCount"] = employees_m.group(1).replace(",", "")[:12]

    return patch or None


def company_field_change_without_value(text: str) -> str | None:
    """If user wants to change a company field but gave no value, return field key."""
    lower = (text or "").strip().lower()
    if not lower:
        return None
    if parse_company_field_update(text):
        return None
    if not re.search(
        r"\b(change|update|edit|set|modify|want to change|add|rename)\b",
        lower,
    ):
        return None
    if re.search(r"\bindustry(?:\s+type)?\b|\bsector\b", lower):
        return "industry"
    if re.search(r"\bdomain\b|\bwebsite\b", lower):
        return "domain"
    if re.search(r"\blinkedin\b", lower):
        return "linkedinUrl"
    if re.search(r"\bemployee|\bcompany\s*size\b", lower):
        return "employeeCount"
    # "rename the company name" / "change company name" with no value yet
    if re.search(
        r"\b(?:company\s+name|rename(?:\s+the)?(?:\s+company)?(?:\s+name)?)\b",
        lower,
    ) and not re.search(r"\b(?:as|to|:|=)\s+\S", lower):
        return "name"
    return None


def contact_field_change_without_value(text: str) -> str | None:
    """If user wants to add/change a contact field but gave no value, return field key."""
    lower = (text or "").strip().lower()
    if not lower:
        return None
    if parse_contact_field_update(text):
        return None
    if not re.search(
        r"\b(change|update|edit|set|modify|want to change|add|include|put)\b",
        lower,
    ):
        return None
    if re.search(r"\b(phone|mobile|number)\b", lower):
        return "phone"
    if re.search(r"\b(email|mail)\b", lower):
        return "email"
    if re.search(r"\b(title|job\s*title|role|position)\b", lower):
        return "title"
    if re.search(r"\b(address|street)\b", lower):
        return "addressLine"
    if re.search(r"\bcity\b", lower):
        return "city"
    if re.search(r"\b(country|nation)\b", lower):
        return "country"
    if re.search(r"\bnotes?\b", lower):
        return "notes"
    return None


def describe_company_patch(patch: dict[str, str]) -> str:
    labels = {
        "name": "name",
        "domain": "domain",
        "industry": "industry",
        "linkedinUrl": "LinkedIn URL",
        "employeeCount": "company size",
    }
    bits = []
    for key, label in labels.items():
        if key in patch:
            bits.append(f"{label} to **{patch[key]}**")
    if not bits:
        return "those details"
    if len(bits) == 1:
        return bits[0]
    return ", ".join(bits[:-1]) + f", and {bits[-1]}"


def sanitize_company_update_name(name: str | None) -> str | None:
    """Keep the company *value* only — drop instruction leftovers from bad parses/LLM.

    Returns None when the string is empty or still looks like an instruction, not a name.
    """
    val = trim_at_next_field(str(name or "").strip().strip("\"'").rstrip(".!")).strip()
    if not val:
        return None
    # Strip repeated "company name to …" prefixes.
    for _ in range(3):
        nxt = re.sub(
            r"^(?:the\s+)?(?:company\s+)?(?:name\s+)?(?:as|to|:|=)\s+",
            "",
            val,
            flags=re.I,
        ).strip()
        nxt = re.sub(
            r"^(?:rename|change|update|set|edit)\s+(?:the\s+)?(?:company\s+)?(?:name\s+)?(?:as|to|:|=)?\s*",
            "",
            nxt,
            flags=re.I,
        ).strip()
        if nxt == val:
            break
        val = nxt
    if not val or re.match(
        r"^(?:the\s+)?(?:company(?:\s+name)?|name|as|to|field|rename)$",
        val,
        re.I,
    ):
        return None
    # Still contains the instruction scaffolding — reject.
    if re.search(
        r"\b(?:rename|change|update)\s+(?:the\s+)?company\s+name\b",
        val,
        re.I,
    ):
        return None
    if re.match(r"^(?:the\s+)?company\s+name\s+to\b", val, re.I):
        return None
    return val[:200]


def sanitize_company_field_patch(patch: dict[str, str] | None) -> dict[str, str] | None:
    """Clamp company update fields; drop bad name values."""
    if not isinstance(patch, dict) or not patch:
        return None
    out: dict[str, str] = {}
    for key, val in patch.items():
        if not isinstance(val, str) or not val.strip():
            continue
        if key == "name":
            cleaned = sanitize_company_update_name(val)
            if cleaned:
                out["name"] = cleaned
            continue
        out[key] = val.strip()[:2000]
    return out or None


def parse_product_field_update(text: str) -> dict[str, str] | None:
    """Extract explicit product field assignments from chat."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    lower = stripped.lower()
    if re.search(
        r"\b(create|add new|show all|back to list|help me create)\b", lower
    ):
        return None

    patch: dict[str, str] = {}
    name_m = re.search(
        r"(?:set\s+)?(?:the\s+)?(?:product\s+)?name\s*(?:as|to|:|=)\s*(.+)$|"
        r"rename\s+(?:to\s+)?(.+)$",
        stripped,
        re.I,
    )
    if name_m:
        patch["name"] = trim_at_next_field(
            (name_m.group(1) or name_m.group(2) or "").strip().rstrip(".!")
        )[:200]

    sku_m = re.search(
        r"(?:set\s+)?(?:the\s+)?sku\s*(?:as|to|:|=)\s*([A-Za-z0-9_-]+)",
        stripped,
        re.I,
    )
    if sku_m:
        patch["sku"] = sku_m.group(1).strip()[:80]

    price_m = re.search(
        r"(?:set\s+)?(?:the\s+)?price\s*(?:as|to|:|=)\s*\$?\s*([\d,]+(?:\.\d+)?)",
        stripped,
        re.I,
    )
    if price_m:
        patch["price"] = price_m.group(1).replace(",", "")

    desc_m = re.search(
        r"(?:set\s+)?(?:the\s+)?description\s*(?:as|to|:|=)\s*(.+)$",
        stripped,
        re.I,
    )
    if desc_m:
        patch["description"] = trim_at_next_field(desc_m.group(1).strip())[:2000]

    category_m = re.search(
        r"(?:set\s+)?(?:the\s+)?category\s*(?:as|to|:|=)\s*(.+)$",
        stripped,
        re.I,
    )
    if category_m:
        patch["category"] = trim_at_next_field(
            category_m.group(1).strip().rstrip(".!")
        )[:120]

    if re.search(r"\bcustomizable\b", lower):
        patch["productType"] = "customizable"
    elif re.search(r"\bfixed(?:\s+price)?\b", lower):
        patch["productType"] = "fixed"

    billing_type_m = re.search(
        r"(?:set\s+)?(?:the\s+)?billing\s*type\s*(?:as|to|:|=)\s*(one[-\s]?time|recurring)",
        stripped,
        re.I,
    )
    if billing_type_m:
        raw = billing_type_m.group(1).lower().replace("-", "_").replace(" ", "_")
        patch["billingType"] = "recurring" if "recurring" in raw else "one_time"
    elif re.search(r"\b(recurring|subscription)\b", lower):
        patch["billingType"] = "recurring"
    elif re.search(r"\b(one[-\s]?time|once)\b", lower):
        patch["billingType"] = "one_time"

    freq_m = re.search(
        r"(?:set\s+)?(?:the\s+)?billing\s*frequency\s*(?:as|to|:|=)\s*(monthly|quarterly|annual|annually|yearly)",
        stripped,
        re.I,
    )
    if freq_m:
        raw = freq_m.group(1).lower()
        patch["billingType"] = "recurring"
        patch["billingFrequency"] = (
            "annual" if raw in ("annual", "annually", "yearly") else raw
        )
    elif re.search(r"\b(monthly|per\s+month|/mo)\b", lower):
        patch["billingType"] = "recurring"
        patch["billingFrequency"] = "monthly"
    elif re.search(r"\b(quarterly|per\s+quarter)\b", lower):
        patch["billingType"] = "recurring"
        patch["billingFrequency"] = "quarterly"
    elif re.search(r"\b(annual|annually|yearly|per\s+year|/yr)\b", lower):
        patch["billingType"] = "recurring"
        patch["billingFrequency"] = "annual"

    return patch or None


def describe_product_patch(patch: dict[str, str]) -> str:
    labels = {
        "name": "name",
        "sku": "SKU",
        "price": "price",
        "description": "description",
        "category": "category",
        "productType": "product type",
        "billingType": "billing type",
        "billingFrequency": "billing frequency",
    }
    bits = []
    for key, label in labels.items():
        if key in patch:
            bits.append(f"{label} to **{patch[key]}**")
    if not bits:
        return "those details"
    if len(bits) == 1:
        return bits[0]
    return ", ".join(bits[:-1]) + f", and {bits[-1]}"


def parse_pending_contact_field_offer(assistant_text: str) -> dict[str, str] | None:
    """Recover a field patch from an assistant confirmation question."""
    last = (assistant_text or "").strip()
    if not last:
        return None
    m = re.search(
        r"(?:set\s+(?:the\s+)?)?(first\s*name|last\s*name|email|phone|title|notes|city|country)\s*"
        r"(?:field\s+)?(?:to|as)\s+(.+?)(?:\s+for\s+[^.?]*)?(?:\?|\.|$)",
        last,
        re.I,
    )
    if not m:
        # "I'll set the country to **India**"
        m = re.search(
            r"(?:I'?ll set the|set the)\s+"
            r"(first name|last name|email|phone|title|job title|notes|city|country)\s+to\s+"
            r"\*\*(.+?)\*\*",
            last,
            re.I,
        )
    if not m:
        # "set his job title to Product Lead" / "job title as Product Lead?"
        job_m = re.search(
            r"(?:set\s+(?:the\s+)?(?:their\s+|his\s+|her\s+)?)?"
            r"(?:job\s*title|title|role|position)\s*(?:field\s+)?(?:to|as)\s+"
            r"(.+?)(?:\s*[—–-]\s*shall|\s+for\s+|\?|\.|$)",
            last,
            re.I,
        )
        if job_m:
            val = job_m.group(1).strip().rstrip(".!").strip("*").strip()
            if val:
                return {"title": val[:2000]}
        return None
    label = m.group(1).strip().lower().replace(" ", "")
    if label in ("jobtitle", "role", "position"):
        label = "title"
    value = m.group(2).strip().rstrip(".!").strip("*").strip()
    if not value:
        return None
    key_map = {
        "firstname": "firstName",
        "lastname": "lastName",
        "email": "email",
        "phone": "phone",
        "title": "title",
        "notes": "notes",
        "city": "city",
        "country": "country",
    }
    key = key_map.get(label)
    if not key:
        return None
    return {key: value[:2000]}


def pending_contact_field_from_messages(
    messages: list[dict[str, Any]] | None,
) -> dict[str, str] | None:
    """Recover a pending contact field patch from recent assistant + user turns."""
    if not messages:
        return None
    for m in reversed(messages[-8:]):
        role = str(m.get("role") or "")
        text = str(m.get("text") or m.get("content") or "")
        if role == "assistant":
            pending = parse_pending_contact_field_offer(text)
            if pending:
                return pending
        if role == "user":
            patch = parse_contact_field_update(text)
            if patch:
                return patch
    return None


def propose_update_contact_proposal(
    *,
    contact_id: str,
    patch: dict[str, str],
    proposal_id: str = "update-contact",
    auto: bool = True,
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_update_contact",
        "label": "Update contact",
        "args": {
            "contactId": contact_id,
            "auto": True if auto else False,
            **{k: v for k, v in patch.items()},
        },
        "risk": "low" if auto else "high",
    }


def propose_delete_contact_proposal(
    *,
    contact_id: str,
    display_name: str = "",
    proposal_id: str = "delete-contact",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Delete {display_name}".strip()
        if display_name.strip()
        else "Delete contact"
    )
    return {
        "id": proposal_id,
        "name": "propose_delete_contact",
        "label": label[:80],
        "args": {
            "contactId": contact_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def deal_draft_ready(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    return bool(_s(d, "title") and (_s(d, "companyId") or _s(d, "companyName")))


def company_draft_ready(draft: dict[str, Any] | None) -> bool:
    """Match the create form: company name + first location are required."""
    d = draft or {}
    return bool(_s(d, "name") and _s(d, "locationName"))


def should_persist_ready_company(
    user_text: str,
    *,
    before: dict[str, Any] | None,
    merged: dict[str, Any] | None,
) -> bool:
    """Save once name and location are in. Optional fields are not a gate.

    A confirm, a one-shot "create Acme in Mumbai", or the turn that supplies
    the last required field all persist. A later question does not.
    """
    if not company_draft_ready(merged):
        return False
    text = (user_text or "").strip()
    if looks_like_create_confirm(text) or utterance_is_one_shot_create(text):
        return True
    if company_draft_ready(before):
        return False
    if text.endswith("?") or re.match(
        r"^(what|why|how|when|where|who|which)\b",
        text,
        re.I,
    ):
        return False
    return True


def product_draft_ready(draft: dict[str, Any] | None) -> bool:
    # Matches the create panel / DAO requirement: name + SKU.
    d = draft or {}
    return bool(_s(d, "name") and _s(d, "sku"))


def invoice_draft_ready(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    return bool(_s(d, "dealId") and _s(d, "productId"))


def activity_draft_ready(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    return bool(_s(d, "contactId") and _s(d, "subject"))


def quote_draft_ready(draft: dict[str, Any] | None) -> bool:
    d = draft or {}
    return bool(_s(d, "dealId") and _s(d, "productId"))


def propose_create_deal_proposal(
    *, proposal_id: str = "create-deal", auto: bool = True
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_create_deal",
        "label": "Create deal",
        "args": {"auto": True} if auto else {},
        "risk": "low" if auto else "high",
    }


def propose_update_deal_proposal(
    *,
    deal_id: str,
    patch: dict[str, Any],
    proposal_id: str = "update-deal",
    auto: bool = True,
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_update_deal",
        "label": "Update deal",
        "args": {
            "dealId": deal_id,
            "auto": True if auto else False,
            **{k: v for k, v in patch.items()},
        },
        "risk": "low" if auto else "high",
    }


def propose_delete_deal_proposal(
    *,
    deal_id: str,
    display_name: str = "",
    proposal_id: str = "delete-deal",
    auto: bool = True,
) -> dict[str, Any]:
    label = f"Delete {display_name}".strip() if display_name.strip() else "Delete deal"
    return {
        "id": proposal_id,
        "name": "propose_delete_deal",
        "label": label[:80],
        "args": {
            "dealId": deal_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def propose_create_company_proposal(
    *, proposal_id: str = "create-company", auto: bool = True
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_create_company",
        "label": "Create company",
        "args": {"auto": True} if auto else {},
        "risk": "low" if auto else "high",
    }


def propose_update_company_proposal(
    *,
    company_id: str,
    patch: dict[str, Any],
    proposal_id: str = "update-company",
    auto: bool = True,
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_update_company",
        "label": "Update company",
        "args": {
            "companyId": company_id,
            "auto": True if auto else False,
            **{k: v for k, v in patch.items()},
        },
        "risk": "low" if auto else "high",
    }


def propose_delete_company_proposal(
    *,
    company_id: str,
    display_name: str = "",
    proposal_id: str = "delete-company",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Delete {display_name}".strip() if display_name.strip() else "Delete company"
    )
    return {
        "id": proposal_id,
        "name": "propose_delete_company",
        "label": label[:80],
        "args": {
            "companyId": company_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def propose_create_product_proposal(
    *, proposal_id: str = "create-product", auto: bool = True
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_create_product",
        "label": "Create product",
        "args": {"auto": True} if auto else {},
        "risk": "low" if auto else "high",
    }


def propose_update_product_proposal(
    *,
    product_id: str,
    patch: dict[str, Any],
    proposal_id: str = "update-product",
    auto: bool = True,
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_update_product",
        "label": "Update product",
        "args": {
            "productId": product_id,
            "auto": True if auto else False,
            **{k: v for k, v in patch.items()},
        },
        "risk": "low" if auto else "high",
    }


def propose_delete_product_proposal(
    *,
    product_id: str,
    display_name: str = "",
    proposal_id: str = "delete-product",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Delete {display_name}".strip() if display_name.strip() else "Delete product"
    )
    return {
        "id": proposal_id,
        "name": "propose_delete_product",
        "label": label[:80],
        "args": {
            "productId": product_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def parse_quote_field_update(text: str) -> dict[str, str] | None:
    """Extract quote notes / customer / company / vendor from a detail edit."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    lower = stripped.lower()
    if re.search(
        r"\b(create|add new|show all|back to list|help me create)\b", lower
    ):
        return None
    normalized = re.sub(
        r"^(?:please\s+)?(?:update|change|edit|set|make)\s+",
        "",
        stripped,
        flags=re.I,
    ).strip()
    normalized = re.sub(
        r"^(?:the\s+)?(?:quote'?s?\s+|their\s+|this\s+)",
        "",
        normalized,
        flags=re.I,
    ).strip()
    patch: dict[str, str] = {}
    notes_m = re.search(
        r"(?:the\s+)?notes?\s*(?:as|to|:|=)\s*(.+)$", normalized, re.I
    ) or re.search(
        r"(?:the\s+)?notes?\s*(?:as|to|:|=)\s*(.+)$", stripped, re.I
    )
    if notes_m:
        patch["notes"] = trim_at_next_field(notes_m.group(1).strip())[:2000]
    customer_m = re.search(
        r"(?:the\s+)?(?:customer(?:\s+name)?|client(?:\s+name)?)\s*"
        r"(?:as|to|:|=)\s*(.+)$",
        normalized,
        re.I,
    )
    if customer_m:
        patch["customerName"] = trim_at_next_field(
            customer_m.group(1).strip().rstrip(".!")
        )[:200]
    company_m = re.search(
        r"(?:the\s+)?company(?:\s+name)?\s*(?:as|to|:|=)\s*(.+)$",
        normalized,
        re.I,
    )
    if company_m:
        patch["companyName"] = trim_at_next_field(
            company_m.group(1).strip().rstrip(".!")
        )[:200]
    vendor_m = re.search(
        r"(?:the\s+)?vendor(?:\s+name)?\s*(?:as|to|:|=)\s*(.+)$",
        normalized,
        re.I,
    )
    if vendor_m:
        patch["vendorName"] = trim_at_next_field(
            vendor_m.group(1).strip().rstrip(".!")
        )[:200]
    return patch or None


_QUOTE_SECTION_ALIASES: dict[str, tuple[str, ...]] = {
    "bank": ("bank details", "bank detail", "bank", "payment details", "account details"),
    "terms": ("terms and conditions", "terms & conditions", "terms", "t&c"),
    "payment_terms": ("payment terms", "payment term"),
    "delivery": ("delivery timeline", "delivery", "timeline"),
    "introduction": ("introduction", "intro"),
    "tax_note": ("tax note", "taxes", "tax"),
}

_QUOTE_SECTION_INTENT_RE = re.compile(
    r"\b(add|update|change|edit|set|fill|replace|put|rewrite|revise|improve|enhance|refresh)\b.+\b("
    r"bank|section|introduction|intro|terms|payment|delivery|tax|footer)\b|"
    r"\b(bank\s+details?|account\s+name|ifsc|routing|iban)\b",
    re.I,
)


def _quote_section_key_from_text(lower: str) -> str | None:
    for key, aliases in _QUOTE_SECTION_ALIASES.items():
        for alias in sorted(aliases, key=len, reverse=True):
            if alias in lower:
                return key
    return None


def merge_quote_section_updates(
    sections: list[dict[str, Any]],
    *,
    section_key: str,
    body: str | None = None,
    title: str | None = None,
) -> list[dict[str, Any]]:
    """Replace one template section body/title while preserving order/ids."""
    out: list[dict[str, Any]] = []
    replaced = False
    for row in sections:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        if key == section_key:
            patched = dict(row)
            if body is not None:
                patched["body"] = body[:4000]
            if title is not None and title.strip():
                patched["title"] = title.strip()[:200]
            out.append(patched)
            replaced = True
        else:
            out.append(dict(row))
    if not replaced:
        default_title = section_key.replace("_", " ").title()
        for key, aliases in _QUOTE_SECTION_ALIASES.items():
            if key == section_key and aliases:
                default_title = aliases[0].title()
                break
        out.append(
            {
                "id": f"sec-{section_key}",
                "key": section_key,
                "title": (title or default_title)[:200],
                "body": (body or "")[:4000],
                "sortOrder": len(out) + 1,
            }
        )
    return out


def parse_quote_section_update(
    text: str,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Extract document section edits (bank details, terms, …) on quote detail."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    lower = stripped.lower()
    if re.search(
        r"\b(create|add new|show all|back to list|help me create)\b", lower
    ):
        return None
    if not _QUOTE_SECTION_INTENT_RE.search(stripped):
        return None
    section_key = _quote_section_key_from_text(lower)
    if not section_key and re.search(r"\baccount\s+name\b|\bifsc\b|\biban\b", lower):
        section_key = "bank"
    if not section_key:
        return None

    body: str | None = None
    aliases = _QUOTE_SECTION_ALIASES.get(section_key, ())
    for alias in sorted(aliases, key=len, reverse=True):
        m = re.search(
            rf"(?:please\s+)?(?:add|update|change|edit|set|fill|replace|put)\s+"
            rf"(?:the\s+)?{re.escape(alias)}\s*(?:as|to|:|=|-)\s*(.+)$",
            stripped,
            re.I | re.S,
        )
        if m:
            body = trim_at_next_field(m.group(1).strip())[:4000]
            break
    if not body:
        m = re.search(
            rf"(?:please\s+)?(?:add|update|change|edit|set|fill|replace|put)\s+"
            rf"(?:the\s+)?{re.escape(aliases[0] if aliases else section_key)}\s*(.+)$",
            stripped,
            re.I | re.S,
        )
        if m:
            body = trim_at_next_field(m.group(1).strip())[:4000]
    if not body and section_key == "bank":
        if re.search(r"\baccount\s+name\b|\bbank\b|\bifsc\b|\brouting\b|\biban\b", lower):
            body = re.sub(
                r"^(?:please\s+)?(?:add|update|change|edit|set|fill|replace|put)\s+"
                r"(?:the\s+)?(?:bank\s+details?|payment\s+details?)\s*",
                "",
                stripped,
                flags=re.I,
            ).strip()[:4000]
    if not body or len(body) < 12:
        return None

    open_q = catalog.get("openQuote") if isinstance(catalog, dict) else None
    base_sections: list[dict[str, Any]] = []
    if isinstance(open_q, dict) and isinstance(open_q.get("documentSections"), list):
        base_sections = [
            dict(s) for s in open_q["documentSections"] if isinstance(s, dict)
        ]
    if base_sections:
        return {
            "documentSections": merge_quote_section_updates(
                base_sections,
                section_key=section_key,
                body=body,
            )
        }
    return {"sectionUpdates": [{"key": section_key, "body": body}]}


def _last_assistant_text(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "assistant":
            return str(m.get("text") or "").strip()
    return ""


def resolve_pending_quote_update_on_confirm(
    messages: list[dict[str, Any]] | None,
    catalog: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Apply a prior quote edit when the user confirms with yes/save."""
    if not messages:
        return None
    last_user = ""
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("role") == "user":
            last_user = str(m.get("text") or "").strip()
            break
    if not looks_like_create_confirm(last_user):
        return None
    asst = _last_assistant_text(messages[:-1] if len(messages) > 1 else messages)
    if not re.search(
        r"\b(shall i|should i|save|update|add|confirm|go ahead)\b",
        asst,
        re.I,
    ):
        return None
    for m in reversed(messages[:-1][-8:]):
        if not isinstance(m, dict) or m.get("role") != "user":
            continue
        utterance = str(m.get("text") or "").strip()
        if not utterance or looks_like_create_confirm(utterance):
            continue
        section = parse_quote_section_update(utterance, catalog)
        if section:
            return section
        field = parse_quote_field_update(utterance)
        if field:
            return field
    return None


def _num_arg(val: Any, default: float | None = None) -> float | None:
    if val is None or isinstance(val, bool):
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str) and val.strip():
        try:
            return float(val.strip())
        except ValueError:
            return default
    return default


def sanitize_invoice_update_args(
    args: dict[str, Any],
    *,
    invoice_id: str,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Keep notes/terms plus optional lines + discount for propose_update_invoice."""
    quote_shaped = sanitize_quote_update_args(
        {
            **args,
            "quoteId": invoice_id,
        },
        quote_id=invoice_id,
        catalog=catalog,
    )
    if not quote_shaped:
        clean: dict[str, Any] = {"invoiceId": invoice_id, "auto": True}
        for key in ("notes", "paymentTerms"):
            val = args.get(key)
            if isinstance(val, str) and val.strip():
                clean[key] = val.strip()[:2000]
        amount = _num_arg(args.get("discountAmount"))
        if amount is not None:
            clean["discountAmount"] = max(0.0, amount)
        return None if len(clean) <= 2 else clean
    out: dict[str, Any] = {"invoiceId": invoice_id, "auto": True}
    if quote_shaped.get("notes"):
        out["notes"] = quote_shaped["notes"]
    terms = args.get("paymentTerms")
    if isinstance(terms, str) and terms.strip():
        out["paymentTerms"] = terms.strip()[:2000]
    if "discountPct" in quote_shaped:
        out["discountPct"] = quote_shaped["discountPct"]
    amount = _num_arg(args.get("discountAmount"))
    if amount is not None:
        out["discountAmount"] = max(0.0, amount)
    if quote_shaped.get("lines"):
        out["lines"] = quote_shaped["lines"]
    return None if len(out) <= 2 else out


def sanitize_quote_update_args(
    args: dict[str, Any],
    *,
    quote_id: str,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Keep notes/names plus optional lines + discount for propose_update_quote."""
    clean: dict[str, Any] = {"quoteId": quote_id, "auto": True}
    for key in ("notes", "customerName", "companyName", "vendorName"):
        val = args.get(key)
        if isinstance(val, str) and val.strip():
            clean[key] = val.strip()[:2000]
    discount = _num_arg(args.get("discountPct"))
    if discount is not None:
        clean["discountPct"] = max(0.0, min(100.0, discount))
    products: list[dict[str, Any]] = []
    if isinstance(catalog, dict) and isinstance(catalog.get("products"), list):
        products = [
            p for p in catalog["products"] if isinstance(p, dict) and p.get("id")
        ]
    raw_lines = args.get("lines")
    lines_out: list[dict[str, Any]] = []
    if isinstance(raw_lines, list):
        from app.agents.coworker_shared import resolve_catalog_id

        for row in raw_lines:
            if not isinstance(row, dict):
                continue
            pid = str(row.get("productId") or row.get("product") or "").strip()
            name = str(row.get("name") or "").strip()
            resolved = (
                resolve_catalog_id(pid or name, items=products, kind="product")
                if products
                else None
            )
            product = next(
                (
                    p
                    for p in products
                    if str(p.get("id")) == (resolved or pid)
                ),
                None,
            )
            qty = _num_arg(row.get("quantity"), 1.0) or 1.0
            unit = _num_arg(row.get("unitPrice"))
            line: dict[str, Any] = {"quantity": max(0.01, qty)}
            if resolved or pid:
                line["productId"] = resolved or pid
            label = product.get("name") if isinstance(product, dict) else None
            if isinstance(label, str) and label.strip():
                line["name"] = label.strip()[:200]
            elif name:
                line["name"] = name[:200]
            if unit is not None and unit >= 0:
                line["unitPrice"] = unit
            if not line.get("productId") and not line.get("name"):
                continue
            lines_out.append(line)
    if lines_out:
        clean["lines"] = lines_out
    doc_sections = args.get("documentSections")
    if isinstance(doc_sections, list) and doc_sections:
        normalized: list[dict[str, Any]] = []
        for row in doc_sections:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "").strip()
            body = str(row.get("body") or "").strip()
            key = str(row.get("key") or "").strip()
            if not body:
                continue
            normalized.append(
                {
                    "id": str(row.get("id") or f"sec-{key or len(normalized)}"),
                    "key": key or f"section-{len(normalized)}",
                    "title": title or key.replace("_", " ").title(),
                    "body": body[:4000],
                    "sortOrder": int(row.get("sortOrder") or len(normalized) + 1),
                }
            )
        if normalized:
            clean["documentSections"] = normalized
    section_updates = args.get("sectionUpdates")
    if isinstance(section_updates, list) and section_updates:
        base_sections: list[dict[str, Any]] = []
        if isinstance(catalog, dict):
            open_q = catalog.get("openQuote")
            if isinstance(open_q, dict) and isinstance(
                open_q.get("documentSections"), list
            ):
                base_sections = [
                    dict(s)
                    for s in open_q["documentSections"]
                    if isinstance(s, dict)
                ]
        merged = list(base_sections)
        for row in section_updates:
            if not isinstance(row, dict):
                continue
            key = str(row.get("key") or "").strip()
            body_val = row.get("body")
            title_val = row.get("title")
            body = str(body_val).strip() if body_val is not None else None
            title = str(title_val).strip() if title_val is not None else None
            if key and (body or title):
                merged = merge_quote_section_updates(
                    merged,
                    section_key=key,
                    body=body,
                    title=title,
                )
        if merged:
            clean["documentSections"] = merged
    if len(clean) <= 2:
        return None
    return clean


_QUOTE_LINE_INTENT_RE = re.compile(
    r"\b(update|change|edit|set|replace|swap|add)\b.+\b("
    r"product|line\s*items?|sku|qty|quantity|discount|pricing|price)\b|"
    r"\b(line\s*items?|products?)\b.+\b(update|change|edit|set|replace)\b|"
    r"\bno\s+discount\b|\bquantity\s+\d|\bqty\s+\d",
    re.I,
)


def parse_quote_line_update(
    text: str,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Extract replacement quote lines from a detail edit (products / qty / discount)."""
    stripped = (text or "").strip()
    if not stripped or not _QUOTE_LINE_INTENT_RE.search(stripped):
        return None
    products: list[dict[str, Any]] = []
    if isinstance(catalog, dict) and isinstance(catalog.get("products"), list):
        products = [
            p for p in catalog["products"] if isinstance(p, dict) and p.get("id")
        ]
    if not products:
        return None
    from app.agents.coworker_shared import (
        clear_rank_winner,
        rank_products_by_name,
        resolve_catalog_id,
    )

    qty_m = re.search(
        r"\b(?:qty|quantity)\s*[:=]?\s*(\d+(?:\.\d+)?)\b", stripped, re.I
    )
    quantity = float(qty_m.group(1)) if qty_m else 1.0
    discount: float | None = None
    if re.search(
        r"\bno\s+discount\b|\bwithout\s+discount\b|\b0\s*%?\s*discount\b",
        stripped,
        re.I,
    ):
        discount = 0.0
    else:
        disc_m = re.search(
            r"\bdiscount\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?", stripped, re.I
        )
        if disc_m:
            discount = float(disc_m.group(1))
    blob = re.sub(
        r"\b(update|change|edit|set|replace|swap|add|product|products|"
        r"line\s*items?|as|to|with|for|qty|quantity|discount|no|without|"
        r"separate|seperate|line\s*item|items?|each)\b",
        " ",
        stripped,
        flags=re.I,
    )
    parts = [
        p.strip()
        for p in re.split(r"\s*(?:\+|\/|&|,| and )\s*", blob)
        if p.strip()
    ]
    matched: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bit in parts or [stripped]:
        pid = resolve_catalog_id(bit, items=products, kind="product", min_score=0.72)
        product = next(
            (p for p in products if str(p.get("id")) == pid), None
        ) if pid else None
        if not product:
            ranked = rank_products_by_name(
                {"products": products}, bit, min_score=0.68, limit=2
            )
            product = clear_rank_winner(ranked)
        if not product:
            continue
        pid = str(product.get("id"))
        if pid in seen:
            continue
        seen.add(pid)
        matched.append(product)
    if not matched:
        ranked = rank_products_by_name(
            {"products": products}, stripped, min_score=0.68, limit=5
        )
        for _score, product in ranked:
            pid = str(product.get("id"))
            if pid in seen:
                continue
            seen.add(pid)
            matched.append(product)
    if not matched:
        return None
    patch: dict[str, Any] = {
        "lines": [
            {
                "productId": str(p["id"]),
                "name": str(p.get("name") or "").strip()[:200],
                "quantity": quantity,
            }
            for p in matched
        ]
    }
    if discount is not None:
        patch["discountPct"] = discount
    return patch


def parse_invoice_field_update(text: str) -> dict[str, str] | None:
    """Extract invoice notes / payment terms from a detail edit."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    lower = stripped.lower()
    if re.search(
        r"\b(create|add new|show all|back to list|help me create)\b", lower
    ):
        return None
    normalized = re.sub(
        r"^(?:please\s+)?(?:update|change|edit|set|make)\s+",
        "",
        stripped,
        flags=re.I,
    ).strip()
    normalized = re.sub(
        r"^(?:the\s+)?(?:invoice'?s?\s+|their\s+|this\s+)",
        "",
        normalized,
        flags=re.I,
    ).strip()
    patch: dict[str, str] = {}
    notes_m = re.search(
        r"(?:the\s+)?notes?\s*(?:as|to|:|=)\s*(.+)$", normalized, re.I
    ) or re.search(
        r"(?:the\s+)?notes?\s*(?:as|to|:|=)\s*(.+)$", stripped, re.I
    )
    if notes_m:
        patch["notes"] = trim_at_next_field(notes_m.group(1).strip())[:2000]
    terms_m = re.search(
        r"(?:the\s+)?(?:payment\s+terms?|terms)\s*(?:as|to|:|=)\s*(.+)$",
        normalized,
        re.I,
    )
    if terms_m:
        patch["paymentTerms"] = trim_at_next_field(
            terms_m.group(1).strip().rstrip(".!")
        )[:200]
    return patch or None


def wants_send_quote(text: str) -> bool:
    """True when the user wants to send the open quote, not create a new one."""
    lower = (text or "").lower()
    if re.search(r"\b(create|new|draft)\s+(a\s+)?(quote|quotation)\b", lower):
        return False
    if re.search(r"\bsend\s+me\s+(a\s+)?(quote|quotation)\b", lower):
        return False
    return bool(
        re.search(
            r"\b(send|email|deliver)\s+(this|the|it|quote|quotation)\b|"
            r"\b(send|email)\s+(it|this)\s+(out|over|to\b)|"
            r"\bmark\s+(this|the|it)?\s*(quote\s+)?(as\s+)?sent\b",
            lower,
        )
    )


def wants_send_invoice(text: str) -> bool:
    """True when the user wants to send the open invoice, not create a new one."""
    lower = (text or "").lower()
    if re.search(r"\b(create|new|draft)\s+(a\s+)?invoice\b", lower):
        return False
    if re.search(r"\bsend\s+me\s+(a\s+)?invoice\b", lower):
        return False
    return bool(
        re.search(
            r"\b(send|email|deliver)\s+(this|the|it|invoice)\b|"
            r"\b(send|email)\s+(it|this)\s+(out|over|to\b)|"
            r"\bmark\s+(this|the|it)?\s*(invoice\s+)?(as\s+)?sent\b",
            lower,
        )
    )


def wants_send_proposal(text: str) -> bool:
    """True when the user wants to send/share the open proposal."""
    lower = (text or "").lower()
    if re.search(r"\b(create|new|draft)\s+(a\s+)?proposal\b", lower):
        return False
    if re.search(r"\bsend\s+me\s+(a\s+)?proposal\b", lower):
        return False
    return bool(
        re.search(
            r"\b(send|email|share|deliver)\s+(this|the|it|proposal)\b|"
            r"\b(send|email|share)\s+(it|this)\s+(out|over|to\b)|"
            r"\bmark\s+(this|the|it)?\s*(proposal\s+)?(as\s+)?shared\b",
            lower,
        )
    )


def propose_send_quote_proposal(
    *,
    quote_id: str,
    display_name: str = "",
    proposal_id: str = "send-quote",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Send {display_name}".strip() if display_name.strip() else "Send quote"
    )
    return {
        "id": proposal_id,
        "name": "propose_send_quote",
        "label": label[:80],
        "args": {
            "quoteId": quote_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def propose_send_invoice_proposal(
    *,
    invoice_id: str,
    display_name: str = "",
    proposal_id: str = "send-invoice",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Send {display_name}".strip() if display_name.strip() else "Send invoice"
    )
    return {
        "id": proposal_id,
        "name": "propose_send_invoice",
        "label": label[:80],
        "args": {
            "invoiceId": invoice_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def propose_send_proposal_doc(
    *,
    proposal_id_value: str,
    display_name: str = "",
    proposal_id: str = "send-proposal",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Share {display_name}".strip()
        if display_name.strip()
        else "Share proposal"
    )
    return {
        "id": proposal_id,
        "name": "propose_send_proposal",
        "label": label[:80],
        "args": {
            "proposalId": proposal_id_value,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def wants_mark_invoice_paid(text: str) -> bool:
    lower = (text or "").lower()
    return bool(
        re.search(
            r"\bmark(\s+(it|this|the))?\s*(invoice\s+)?(as\s+)?paid\b|"
            r"\b(record|register)\s+(the\s+)?payment\b|"
            r"\b(this|the)\s+invoice\s+is\s+paid\b",
            lower,
        )
    )


def propose_update_quote_proposal(
    *,
    quote_id: str,
    patch: dict[str, Any],
    proposal_id: str = "update-quote",
    auto: bool = True,
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_update_quote",
        "label": "Update quote",
        "args": {
            "quoteId": quote_id,
            "auto": True if auto else False,
            **{k: v for k, v in patch.items()},
        },
        "risk": "low" if auto else "high",
    }


def propose_delete_quote_proposal(
    *,
    quote_id: str,
    display_name: str = "",
    proposal_id: str = "delete-quote",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Delete {display_name}".strip() if display_name.strip() else "Delete quote"
    )
    return {
        "id": proposal_id,
        "name": "propose_delete_quote",
        "label": label[:80],
        "args": {
            "quoteId": quote_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def propose_update_invoice_proposal(
    *,
    invoice_id: str,
    patch: dict[str, Any],
    proposal_id: str = "update-invoice",
    auto: bool = True,
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_update_invoice",
        "label": "Update invoice",
        "args": {
            "invoiceId": invoice_id,
            "auto": True if auto else False,
            **{k: v for k, v in patch.items()},
        },
        "risk": "low" if auto else "high",
    }


def propose_delete_invoice_proposal(
    *,
    invoice_id: str,
    display_name: str = "",
    proposal_id: str = "delete-invoice",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Delete {display_name}".strip()
        if display_name.strip()
        else "Delete invoice"
    )
    return {
        "id": proposal_id,
        "name": "propose_delete_invoice",
        "label": label[:80],
        "args": {
            "invoiceId": invoice_id,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def propose_mark_invoice_paid_proposal(
    *,
    invoice_id: str,
    proposal_id: str = "mark-invoice-paid",
    auto: bool = True,
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_mark_invoice_paid",
        "label": "Mark invoice paid",
        "args": {"invoiceId": invoice_id, "auto": True if auto else False},
        "risk": "low" if auto else "high",
    }


def propose_delete_proposal_doc(
    *,
    proposal_id_value: str,
    display_name: str = "",
    proposal_id: str = "delete-proposal",
    auto: bool = True,
) -> dict[str, Any]:
    label = (
        f"Delete {display_name}".strip()
        if display_name.strip()
        else "Delete proposal"
    )
    return {
        "id": proposal_id,
        "name": "propose_delete_proposal",
        "label": label[:80],
        "args": {
            "proposalId": proposal_id_value,
            "auto": True if auto else False,
            **({"displayName": display_name.strip()[:120]} if display_name.strip() else {}),
        },
        "risk": "low" if auto else "high",
    }


def propose_create_invoice_proposal(
    *, proposal_id: str = "create-invoice", auto: bool = True
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_create_invoice",
        "label": "Create invoice",
        "args": {"auto": True} if auto else {},
        "risk": "low" if auto else "high",
    }


def propose_create_activity_proposal(
    *, proposal_id: str = "create-activity", auto: bool = True
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_create_activity",
        "label": "Log activity",
        "args": {"auto": True} if auto else {},
        "risk": "low" if auto else "high",
    }


def propose_create_quote_proposal(
    *, proposal_id: str = "create-quote", auto: bool = True
) -> dict[str, Any]:
    return {
        "id": proposal_id,
        "name": "propose_create_quote",
        "label": "Create quote",
        "args": {"auto": True} if auto else {},
        "risk": "low" if auto else "high",
    }


def propose_create_proposal_doc(
    *,
    deal_id: str,
    title: str | None = None,
    proposal_id: str = "create-proposal",
    auto: bool = True,
    product_hint: str | None = None,
    product_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Create a deal proposal document (not a pipeline stage)."""
    args: dict[str, Any] = {"dealId": deal_id, "auto": True} if auto else {"dealId": deal_id}
    if title and title.strip():
        args["title"] = title.strip()[:200]
    if product_hint and product_hint.strip():
        args["productHint"] = product_hint.strip()[:200]
    if product_ids:
        cleaned = [str(p).strip() for p in product_ids if str(p).strip()]
        if cleaned:
            args["productIds"] = cleaned[:10]
    return {
        "id": proposal_id,
        "name": "propose_create_proposal",
        "label": "Create proposal",
        "args": args,
        "risk": "low" if auto else "high",
    }


CREATING_DEAL_CHAT = "Great — saving the deal now."
CREATING_COMPANY_CHAT = "Great — saving the company now."
CREATING_PRODUCT_CHAT = "Great — saving the product now."
CREATING_INVOICE_CHAT = "Great — creating the invoice now."
CREATING_ACTIVITY_CHAT = "Got it — logging that activity now."
CREATING_QUOTE_CHAT = "Great — saving the quote now."
CREATING_PROPOSAL_CHAT = "Great — writing the proposal from your template now."


CONTACT_ALL_FIELDS_DONE_CHAT = (
    "That's everything on my list. Tell me when you'd like me to save, "
    "or share anything else you want to add first."
)

ALL_FIELDS_DONE_CHAT = CONTACT_ALL_FIELDS_DONE_CHAT


def draft_skipped_fields(draft: dict[str, Any] | None) -> set[str]:
    return product_skipped_fields(draft)


def draft_mark_skipped(draft: dict[str, Any] | None, field: str) -> str:
    return product_mark_skipped(draft, field)


def contact_mandatory_field_message(field: str, draft: dict[str, Any] | None = None) -> str:
    """User-facing copy when they skip a required create slot."""
    d = draft if isinstance(draft, dict) else {}
    from app.agents.contact_draft_agent import skipped_optional_fields

    skipped = skipped_optional_fields(d)
    if field == "firstName":
        return "First name is mandatory — what's their first name?"
    if field == "lastName":
        return "Last name is optional — say skip if they only use one name."
    if field == "phone" and "email" in skipped and not _s(d, "phone"):
        return (
            "Phone number is mandatory when email is skipped — we need at least "
            "one way to reach them."
        )
    if field == "email" and "phone" in skipped and not _s(d, "email"):
        return (
            "Email is mandatory when phone is skipped — we need at least one "
            "way to reach them."
        )
    if field in {"email", "phone"}:
        return (
            "Email or phone number is mandatory — we need at least one way to "
            "reach them before saving."
        )
    return "That field is mandatory."


def speech_offers_contact_save(text: str) -> bool:
    lower = (text or "").strip().lower()
    if not lower:
        return False
    return bool(
        re.search(
            r"\b(shall i save|should i save|want me to save|ready to save|"
            r"save them now|save (it|them|now)|looks ready|enough to get started)\b",
            lower,
        )
    )


def speech_offers_save(text: str) -> bool:
    return speech_offers_contact_save(text)


def next_contact_prompt(draft: dict[str, Any], *, just_patched: bool = False) -> str:
    name = " ".join(
        x for x in (_s(draft, "firstName"), _s(draft, "lastName")) if x
    ).strip()
    first = _s(draft, "firstName")
    who = name or first or "this contact"
    ask = contact_next_ask_key(draft)

    if ask == "firstName":
        if _s(draft, "lastName") and not first:
            return "Thanks! What is the first name for this contact?"
        return CONTACT_FIRST_NAME_Q if not just_patched else "Got it — and the first name?"
    if ask == "lastName":
        return (
            "Got it, thank you. Could you please provide the last name for this contact?"
        )
    if ask == "email":
        return (
            f"What email address should we use for {who}? "
            "(Say skip if you'd rather use phone only.)"
        )
    if ask == "phone":
        if _s(draft, "email"):
            return (
                f"What's the best phone number for {who}, with country code "
                "(e.g. 919876543210)? Say skip if email is enough."
            )
        from app.agents.contact_draft_agent import skipped_optional_fields

        if "email" in skipped_optional_fields(draft):
            return (
                f"What's their phone number (with country code, e.g. 919876543210)? "
                f"We need this since email was skipped."
            )
        return (
            f"What's their phone number (with country code, e.g. 919876543210)? "
            f"Say skip if you'd rather use email only."
        )
    if ask == "company":
        return (
            f"Which company is {who} with? Say skip if you want to leave it blank."
        )
    if ask == "title":
        return f"What's their job title? Say skip if you want to leave it blank."
    if ask == "city":
        return f"Which city are they based in? Say skip if you want to leave it blank."
    if ask == "country":
        return f"Which country? Say skip if you want to leave it blank."
    return CONTACT_ALL_FIELDS_DONE_CHAT


_COMPANY_OPTIONAL_ASK = frozenset(
    {
        "locationAddress",
        "locationType",
        "domain",
        "industry",
        "employeeCount",
        "linkedinUrl",
    }
)
_LOCATION_OPTIONAL_ASK = frozenset({"type", "address", "industry"})
_DEAL_OPTIONAL_ASK = frozenset(
    {"amount", "stage", "contact", "expectedCloseDate", "notes"}
)
_QUOTE_OPTIONAL_ASK = frozenset({"offer", "quantity", "discount"})
_INVOICE_OPTIONAL_ASK = frozenset(
    {"quantity", "currency", "issueDate", "dueDate", "paymentTerms", "notes"}
)


def company_next_ask_key(draft: dict[str, Any] | None) -> str:
    """Guided company create — matches frontend companySetupSteps."""
    d = draft if isinstance(draft, dict) else {}
    skipped = draft_skipped_fields(d)
    if not _s(d, "name"):
        return "name"
    if not _s(d, "locationName"):
        return "locationName"
    if not _s(d, "locationAddress") and "locationAddress" not in skipped:
        return "locationAddress"
    if not _s(d, "locationType") and "locationType" not in skipped:
        return "locationType"
    if not _s(d, "domain") and "domain" not in skipped:
        return "domain"
    if not _s(d, "industry") and "industry" not in skipped:
        return "industry"
    if not _s(d, "employeeCount") and "employeeCount" not in skipped:
        return "employeeCount"
    if not _s(d, "linkedinUrl") and "linkedinUrl" not in skipped:
        return "linkedinUrl"
    return "save"


def looks_like_street_address(value: str) -> bool:
    s = (value or "").strip()
    if not s:
        return False
    if re.search(r"\d", s):
        return True
    return bool(
        re.search(
            r"\b(street|st\.|road|rd\.|avenue|ave|lane|ln\.|drive|dr\.|"
            r"boulevard|blvd|floor|suite|unit|#|plot|sector|phase)\b",
            s,
            re.I,
        )
    )


def is_city_only_address_reply(text: str) -> bool:
    """User wants location at city level — not a duplicate street address."""
    bare = (text or "").strip().lower()
    if not bare:
        return False
    if is_product_skip_intent(text):
        return True
    if bare in ("city", "town"):
        return True
    return bool(
        re.search(
            r"\b(city\s+level|just\s+(the\s+)?city|city\s+only|no\s+address|"
            r"no\s+street|keep\s+(it\s+)?at\s+(the\s+)?city|same\s+as\s+city)\b",
            bare,
        )
    )


def normalize_company_address_patch(
    patch: dict[str, Any] | None,
    draft: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Drop address when it only repeats the location name (LLM echo)."""
    if not isinstance(patch, dict) or not patch:
        return patch
    out = dict(patch)
    base = {**(draft if isinstance(draft, dict) else {}), **out}
    loc = _s(base, "locationName")
    addr = _s(out, "locationAddress")
    if addr and loc and addr.lower() == loc.lower() and not looks_like_street_address(addr):
        out.pop("locationAddress", None)
    return out or None


_COMPANY_WALK_SLOTS = (
    "name",
    "locationName",
    "locationAddress",
    "locationType",
    "domain",
    "industry",
    "employeeCount",
    "linkedinUrl",
    "save",
)

_COMPANY_ASK_TO_KEYS: dict[str, tuple[str, ...]] = {
    "name": ("name",),
    "locationName": ("locationName",),
    "locationAddress": ("locationAddress",),
    "locationType": ("locationType",),
    "domain": ("domain",),
    "industry": ("industry",),
    "employeeCount": ("employeeCount",),
    "linkedinUrl": ("linkedinUrl",),
}


def _company_walk_index(ask: str) -> int:
    try:
        return _COMPANY_WALK_SLOTS.index(ask)
    except ValueError:
        return len(_COMPANY_WALK_SLOTS)


def _company_allowed_patch_keys(ask: str) -> set[str]:
    allowed: set[str] = {"skippedOptional"}
    if ask == "save":
        for keys in _COMPANY_ASK_TO_KEYS.values():
            allowed.update(keys)
        return allowed
    limit = _company_walk_index(ask)
    for slot in _COMPANY_WALK_SLOTS[: limit + 1]:
        allowed.update(_COMPANY_ASK_TO_KEYS.get(slot, ()))
    return allowed


def clamp_company_patch_to_walk(
    patch: dict[str, Any],
    *,
    ask: str,
) -> dict[str, Any]:
    """Keep the current guided slot, earlier fields, and required name + location.

    Optional fields still wait their turn. A location the model already
    extracted is not dropped just because the walk has not asked for it yet.
    """
    if not patch:
        return patch
    allowed = _company_allowed_patch_keys(ask)
    allowed.update({"name", "locationName"})
    return {k: v for k, v in patch.items() if k in allowed}


def apply_company_slot_answer(
    text: str,
    draft: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Map the user reply onto the current company create slot (no multi-field heuristics)."""
    d = draft if isinstance(draft, dict) else {}
    ask = company_next_ask_key(d)
    bare = (text or "").strip()
    if not bare or ask == "save":
        return None
    if ask == "name" and len(bare) <= 80 and not re.search(r"@", bare):
        return {"name": bare[:80]}
    if ask == "locationName" and re.match(r"^[A-Za-z0-9&.' -]{2,80}$", bare):
        lower = bare.lower()
        if re.search(r"\b(hq|headquarters|head\s*office|branch)\b", lower):
            return None
        if not re.search(r"\.(com|io|org|net|co)\b", bare, re.I):
            return {"locationName": bare[:80]}
    if ask == "locationAddress":
        if is_city_only_address_reply(bare):
            return {"skippedOptional": draft_mark_skipped(d, "locationAddress")}
        if len(bare) >= 3:
            return {"locationAddress": bare[:300]}
    if ask == "locationType":
        lower = bare.lower()
        if "branch" in lower:
            return {"locationType": "branch"}
        if re.search(r"\b(hq|headquarters|head\s*office)\b", lower):
            return {"locationType": "hq"}
    if ask == "domain":
        m = re.search(r"\b([a-z0-9-]+\.[a-z]{2,})\b", bare, re.I)
        if m:
            return {"domain": m.group(1).lower()}
    if ask == "industry" and len(bare) >= 2:
        return {"industry": bare[:60]}
    if ask == "employeeCount" and re.match(r"^\d[\d,]*$", bare.replace(",", "")):
        return {"employeeCount": bare.replace(",", "")}
    if ask == "linkedinUrl" and re.search(r"linkedin\.com", bare, re.I):
        url = bare if bare.lower().startswith("http") else f"https://{bare}"
        return {"linkedinUrl": url[:300]}
    return None


def company_mandatory_field_message(
    field: str, draft: dict[str, Any] | None = None
) -> str:
    del draft
    if field == "name":
        return "Company name is mandatory — what's the account called?"
    if field == "locationName":
        return (
            "First location name is mandatory — a city or office name works "
            "(e.g. Chennai HQ)."
        )
    return "That field is mandatory."


def location_next_ask_key(draft: dict[str, Any] | None) -> str:
    d = draft if isinstance(draft, dict) else {}
    skipped = draft_skipped_fields(d)
    if not _s(d, "name", "locationName"):
        return "name"
    if not _s(d, "type") and "type" not in skipped:
        return "type"
    if not _s(d, "address", "locationAddress") and "address" not in skipped:
        return "address"
    if not _s(d, "industry") and "industry" not in skipped:
        return "industry"
    return "save"


def location_mandatory_field_message(
    field: str, draft: dict[str, Any] | None = None
) -> str:
    del draft
    if field == "name":
        return "Location name is mandatory — what should we call this location?"
    return "That field is mandatory."


def deal_next_ask_key(draft: dict[str, Any] | None) -> str:
    d = draft if isinstance(draft, dict) else {}
    skipped = draft_skipped_fields(d)
    if not _s(d, "title"):
        return "title"
    if not (_s(d, "companyId") or _s(d, "companyName")):
        return "company"
    if not _s(d, "amount") and "amount" not in skipped:
        return "amount"
    if not _s(d, "stage") and "stage" not in skipped:
        return "stage"
    if not _s(d, "contactId") and "contact" not in skipped:
        return "contact"
    if not _s(d, "expectedCloseDate") and "expectedCloseDate" not in skipped:
        return "expectedCloseDate"
    if not _s(d, "notes") and "notes" not in skipped:
        return "notes"
    return "save"


def deal_mandatory_field_message(
    field: str, draft: dict[str, Any] | None = None
) -> str:
    del draft
    if field == "title":
        return "Deal title is mandatory — what should we call this deal?"
    if field == "company":
        return (
            "Company is mandatory — which account is this deal for? "
            "Pick from your list or type a new name."
        )
    return "That field is mandatory."


def quote_next_ask_key(draft: dict[str, Any] | None) -> str:
    d = draft if isinstance(draft, dict) else {}
    skipped = draft_skipped_fields(d)
    if not _s(d, "dealId"):
        return "deal"
    if not _s(d, "productId"):
        return "product"
    if not _s(d, "offerId") and "offer" not in skipped:
        return "offer"
    if not _s(d, "quantity") and "quantity" not in skipped:
        return "quantity"
    if not _s(d, "discountPct") and "discount" not in skipped:
        return "discount"
    return "save"


def quote_mandatory_field_message(
    field: str, draft: dict[str, Any] | None = None
) -> str:
    del draft
    if field == "deal":
        return "Deal is mandatory — which deal is this quote for?"
    if field == "product":
        return "Product is mandatory — which product should we quote?"
    return "That field is mandatory."


def invoice_next_ask_key(draft: dict[str, Any] | None) -> str:
    d = draft if isinstance(draft, dict) else {}
    skipped = draft_skipped_fields(d)
    if not _s(d, "dealId"):
        return "deal"
    if not _s(d, "productId"):
        return "product"
    if not _s(d, "quantity") and "quantity" not in skipped:
        return "quantity"
    if not _s(d, "currency") and "currency" not in skipped:
        return "currency"
    if not _s(d, "issueDate") and "issueDate" not in skipped:
        return "issueDate"
    if not _s(d, "dueDate") and "dueDate" not in skipped:
        return "dueDate"
    if not _s(d, "paymentTerms") and "paymentTerms" not in skipped:
        return "paymentTerms"
    if not _s(d, "notes") and "notes" not in skipped:
        return "notes"
    return "save"


def invoice_mandatory_field_message(
    field: str, draft: dict[str, Any] | None = None
) -> str:
    del draft
    if field == "deal":
        return "Deal is mandatory — which deal should this invoice link to?"
    if field == "product":
        return "Product is mandatory — which product line should we bill?"
    return "That field is mandatory."


def apply_guided_create_skip(
    user_text: str,
    draft: dict[str, Any] | None,
    *,
    next_ask_fn,
    optional_asks: frozenset[str],
    mandatory_message_fn,
) -> dict[str, Any] | None:
    """Return patch or {_blockSpeech: text} when user skips a create slot."""
    if not is_product_skip_intent(user_text):
        return None
    ask = next_ask_fn(draft)
    if ask == "save":
        return None
    if ask not in optional_asks:
        return {"_blockSpeech": mandatory_message_fn(ask, draft)}
    return {"skippedOptional": draft_mark_skipped(draft, ask)}


def rewrite_early_save_speech(
    speech: str,
    draft: dict[str, Any],
    *,
    next_ask_fn,
    next_prompt_fn,
) -> str:
    if speech and speech_offers_save(speech) and next_ask_fn(draft) != "save":
        rewritten = next_prompt_fn(draft, just_patched=True)
        return rewritten.strip() or speech
    return speech


def next_company_prompt(draft: dict[str, Any], *, just_patched: bool = False) -> str:
    name = _s(draft, "name")
    ask = company_next_ask_key(draft)
    if ask == "name":
        return (
            "Sure — what's the company called?"
            if not just_patched
            else "Got it — and the company name?"
        )
    if ask == "locationName":
        who = f"**{name}**" if name else "this company"
        if just_patched:
            who_plain = name or "This company"
            return (
                f"{who_plain} — what's the first location called? "
                "A city or office name works."
            )
        return f"Where is {who} based — city or office name?"
    if ask == "locationAddress":
        return (
            f"Street address for **{name}**'s location? Say skip if you want to leave it blank."
        )
    if ask == "locationType":
        return "Is this location HQ or a branch? Say skip if you want to decide later."
    if ask == "domain":
        return f"Website domain for **{name}** (like acme.com)? Say skip to leave blank."
    if ask == "industry":
        return f"Industry for **{name}**? Say skip if you want to leave it blank."
    if ask == "employeeCount":
        return "Rough employee count? A number is fine, or say skip."
    if ask == "linkedinUrl":
        return "LinkedIn company URL, or say skip."
    return ALL_FIELDS_DONE_CHAT


def next_location_prompt(draft: dict[str, Any], *, just_patched: bool = False) -> str:
    del just_patched
    loc = _s(draft, "name", "locationName") or "this location"
    ask = location_next_ask_key(draft)
    if ask == "name":
        return "What should we call this location?"
    if ask == "type":
        return f"Is **{loc}** HQ or a branch? Say skip if you want to decide later."
    if ask == "address":
        return "Street address for this location? Say skip if you want to leave it blank."
    if ask == "industry":
        return "Industry at this location, or say skip."
    return ALL_FIELDS_DONE_CHAT


def next_deal_prompt(draft: dict[str, Any], *, just_patched: bool = False) -> str:
    title = _s(draft, "title")
    ask = deal_next_ask_key(draft)
    if ask == "title":
        return (
            "What should we call this deal?"
            if not just_patched
            else "Sure — deal title?"
        )
    if ask == "company":
        who = f"**{title}**" if title else "this deal"
        return (
            f"Which company is {who} for? Pick from your list or type a new name."
        )
    if ask == "amount":
        return "Deal amount (number and currency if you like), or say skip."
    if ask == "stage":
        return (
            "Pipeline stage — qualification, discover, propose, negotiate, "
            "closed won, or closed lost? Or say skip."
        )
    if ask == "contact":
        return "Primary contact on this deal? Name someone or say skip."
    if ask == "expectedCloseDate":
        return "Expected close date (YYYY-MM-DD), or say skip."
    if ask == "notes":
        return "Any notes on this deal, or say skip."
    return ALL_FIELDS_DONE_CHAT


PRODUCT_RETAIL_KEYS = ("brand", "stockOnHand")
PRODUCT_QUOTE_KEYS = (
    "productType",
    "billingType",
    "billingFrequency",
    "maxDiscountPercent",
    "offers",
    "addons",
)


def product_motion(business_type: str | None) -> str:
    bt = (business_type or "b2b").strip().lower()
    return bt if bt in ("b2b", "b2c", "b2b2c") else "b2b"


def product_asks_retail_fields(business_type: str | None) -> bool:
    """Brand + stock on hand are B2C / B2B2C catalog fields — not asked on B2B."""
    return product_motion(business_type) in ("b2c", "b2b2c")


def product_asks_quote_fields(business_type: str | None) -> bool:
    """Product type, billing, max discount, offers — not asked on pure B2C."""
    return product_motion(business_type) != "b2c"


def product_forbidden_patch_keys(business_type: str | None) -> set[str]:
    drop: set[str] = set()
    if not product_asks_retail_fields(business_type):
        drop.update(PRODUCT_RETAIL_KEYS)
    if not product_asks_quote_fields(business_type):
        drop.update(PRODUCT_QUOTE_KEYS)
    return drop


def product_walk_slots(business_type: str | None = None) -> tuple[str, ...]:
    """Guided ask order for this motion. Same catalog table; gated collection."""
    slots: list[str] = ["name", "sku", "price", "currency"]
    if product_asks_quote_fields(business_type):
        slots.extend(
            ("productType", "billingType", "billingFrequency", "maxDiscount")
        )
    if product_asks_retail_fields(business_type):
        slots.extend(("brand", "stockOnHand"))
    slots.extend(("productUrl", "category", "description", "tags", "image"))
    if product_asks_quote_fields(business_type):
        slots.extend(("offers", "addons"))
    slots.append("save")
    return tuple(slots)


def product_walk_instruction(business_type: str | None) -> str:
    """One-line walk for the coworker prompt — current org only."""
    motion = product_motion(business_type)
    if motion == "b2c":
        return (
            "B2C walk: name → sku → price → currency → brand → stockOnHand → "
            "productUrl → category → description → tags → image. "
            "Never ask productType, billing, maxDiscount, offers, or addons."
        )
    if motion == "b2b2c":
        return (
            "B2B2C walk: name → sku → price → currency → productType → "
            "billingType (then billingFrequency if recurring) → maxDiscount → "
            "brand → stockOnHand → productUrl → category → description → tags → "
            "image → offers/addons if customizable."
        )
    return (
        "B2B walk: name → sku → price → currency → productType → billingType "
        "(then billingFrequency if recurring) → maxDiscount → productUrl → "
        "category → description → tags → image → offers/addons if customizable. "
        "Never ask brand or stockOnHand."
    )


def next_product_prompt(
    draft: dict[str, Any],
    *,
    just_patched: bool = False,
    business_type: str | None = None,
) -> str:
    """Ask order mirrors frontend productSetupSteps — one field at a time."""
    ask = product_next_ask_key(draft, business_type=business_type)
    name = _s(draft, "name") or "this product"
    if ask == "name":
        return "What's the product name?"
    if ask == "sku":
        if just_patched:
            return f"Got it — **{name}**. What SKU should we use for this one?"
        return f"What SKU should we use for **{name}**?"
    if ask == "price":
        if just_patched:
            return f"Got it, SKU is set. What price should we put on this?"
        return f"What price should we put on **{name}**? Or say skip."
    if ask == "currency":
        if just_patched:
            return "Got it. Which currency — USD, EUR, GBP, INR, or AED?"
        return f"Currency for **{name}** (USD, EUR, GBP, INR, AED)? Or say skip."
    if ask == "productType":
        if just_patched:
            return "Fixed price (standard) or customizable with offers/addons?"
        return (
            f"Product type for **{name}** — fixed/standard, or customizable?"
        )
    if ask == "billingType":
        if just_patched:
            return "One-time purchase or recurring subscription?"
        return f"Billing for **{name}** — one-time or recurring?"
    if ask == "billingFrequency":
        return f"**{name}** is recurring — monthly, quarterly, or annual?"
    if ask == "maxDiscount":
        return "Any max discount percent? Or say skip."
    if ask == "brand":
        return "What brand is this under? Or say skip."
    if ask == "stockOnHand":
        return "Stock on hand (number), or say skip if not tracked."
    if ask == "productUrl":
        return "Product URL, or say skip."
    if ask == "category":
        return "What category does this fall under? Or say skip."
    if ask == "description":
        return "Short description, or say skip."
    if ask == "tags":
        return "Any tags (comma-separated), or say skip."
    if ask == "image":
        return "Image URL, or say skip."
    if ask == "offers":
        return (
            f"**{name}** is customizable — add an offer/plan name, or say skip."
        )
    if ask == "addons":
        return "Add an addon name, or say skip."
    return ALL_FIELDS_DONE_CHAT


_PRODUCT_OPTIONAL_ASK = (
    "price",
    "currency",
    "productType",
    "billingType",
    "billingFrequency",
    "maxDiscount",
    "brand",
    "stockOnHand",
    "productUrl",
    "category",
    "description",
    "tags",
    "image",
    "offers",
    "addons",
)


def product_skipped_fields(draft: dict[str, Any] | None) -> set[str]:
    raw = str((draft or {}).get("skippedOptional") or "")
    return {p.strip() for p in raw.split(",") if p.strip()}


def product_mark_skipped(draft: dict[str, Any] | None, field: str) -> str:
    skipped = product_skipped_fields(draft)
    skipped.add(field)
    return ",".join(sorted(skipped))


def product_next_ask_key(
    draft: dict[str, Any] | None,
    *,
    business_type: str | None = None,
) -> str:
    """Authoritative next product create slot (matches guided Product setup)."""
    d = draft if isinstance(draft, dict) else {}
    skipped = product_skipped_fields(d)
    if not _s(d, "name"):
        return "name"
    if not _s(d, "sku"):
        return "sku"
    if not _s(d, "price") and "price" not in skipped:
        return "price"
    if not _s(d, "currency") and "currency" not in skipped:
        return "currency"
    quote = product_asks_quote_fields(business_type)
    if quote:
        if not _s(d, "productType") and "productType" not in skipped:
            return "productType"
        billing = (_s(d, "billingType") or "").lower()
        if not billing and "billingType" not in skipped:
            return "billingType"
        if (
            billing == "recurring"
            and not _s(d, "billingFrequency")
            and "billingFrequency" not in skipped
        ):
            return "billingFrequency"
        if not _s(d, "maxDiscountPercent") and "maxDiscount" not in skipped:
            return "maxDiscount"
    if product_asks_retail_fields(business_type):
        if not _s(d, "brand") and "brand" not in skipped:
            return "brand"
        if not _s(d, "stockOnHand") and "stockOnHand" not in skipped:
            return "stockOnHand"
    if not _s(d, "productUrl") and "productUrl" not in skipped:
        return "productUrl"
    if not _s(d, "category") and "category" not in skipped:
        return "category"
    if not _s(d, "description") and "description" not in skipped:
        return "description"
    if not _s(d, "tags") and "tags" not in skipped:
        return "tags"
    if (
        not _s(d, "imageUrl")
        and not _s(d, "galleryUrls")
        and "image" not in skipped
    ):
        return "image"
    if product_asks_quote_fields(business_type):
        product_type = (_s(d, "productType") or "").lower()
        if product_type == "customizable":
            offers = d.get("offers") if isinstance(d.get("offers"), list) else []
            named_offers = [
                o
                for o in offers
                if isinstance(o, dict) and str(o.get("name") or "").strip()
            ]
            if not named_offers and "offers" not in skipped:
                return "offers"
            addons = d.get("addons") if isinstance(d.get("addons"), list) else []
            named_addons = [
                a
                for a in addons
                if isinstance(a, dict) and str(a.get("name") or "").strip()
            ]
            if not named_addons and "addons" not in skipped:
                return "addons"
    return "save"


_CURRENCY_ALIASES = {
    "usd": "USD",
    "dollar": "USD",
    "dollars": "USD",
    "us": "USD",
    "eur": "EUR",
    "euro": "EUR",
    "euros": "EUR",
    "gbp": "GBP",
    "pound": "GBP",
    "pounds": "GBP",
    "inr": "INR",
    "ind": "INR",
    "india": "INR",
    "rupee": "INR",
    "rupees": "INR",
    "rs": "INR",
    "₹": "INR",
    "aed": "AED",
    "dirham": "AED",
}


def parse_product_currency(text: str) -> str | None:
    bare = (text or "").strip().lower()
    if not bare:
        return None
    if bare in _CURRENCY_ALIASES:
        return _CURRENCY_ALIASES[bare]
    m = re.search(r"\b(USD|EUR|GBP|INR|AED)\b", text or "", re.I)
    if m:
        return m.group(1).upper()
    for key, code in _CURRENCY_ALIASES.items():
        if re.search(rf"\b{re.escape(key)}\b", bare):
            return code
    return None


def is_product_skip_intent(text: str) -> bool:
    lower = (text or "").strip().lower()
    return lower in {
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
        "use usd",
        "default",
    } or bool(re.match(r"^\s*skip\b", lower))


_PRODUCT_SLOT_HELP: dict[str, str] = {
    "name": "That's just the product's display name in the catalog.",
    "sku": "SKU is a short unique code you use internally (e.g. CRM-1).",
    "price": "The list price for this product (numbers only is fine).",
    "currency": "Which money unit the price uses — USD, EUR, GBP, INR, or AED.",
    "productType": (
        "**Fixed/standard** = one set price. **Customizable** = plans/offers "
        "and addons customers can pick."
    ),
    "billingType": "How customers pay — one-time purchase, or a recurring subscription.",
    "billingFrequency": "How often the subscription renews — monthly, quarterly, or annual.",
    "maxDiscount": "The highest discount % sales can offer without extra approval. Or skip.",
    "brand": (
        "Brand is the maker or label this product sits under (e.g. Acme). "
        "Type a name, or say skip if you don't use brands."
    ),
    "stockOnHand": "How many units you have in stock right now. Or say skip if you don't track stock.",
    "productUrl": "A public page URL for this product, if you have one. Or say skip.",
    "category": "A grouping label (e.g. Software, Hardware). Or say skip.",
    "description": "A short blurb of what the product is. Or say skip.",
    "tags": "Optional keywords for search/filtering, comma-separated. Or say skip.",
    "image": "An image URL for the product. Or say skip.",
    "offers": "A plan or package name under this customizable product. Or say skip.",
    "addons": "An optional add-on name customers can buy with it. Or say skip.",
}


def is_product_slot_meta_question(text: str, ask: str | None = None) -> bool:
    """True when the user is asking what a field means — not providing a value."""
    bare = (text or "").strip()
    if not bare:
        return False
    lower = bare.lower()
    if is_product_skip_intent(bare):
        return False
    # Clear "what do you mean?" / "huh?" / "explain" style replies
    if re.match(
        r"^(what(\s+do\s+you)?\s+mean|what'?s\s+that|huh|explain|"
        r"help|why|not\s+sure|i\s+don'?t\s+understand)\b",
        lower,
    ):
        return True
    # "brand means?", "what is brand?", "means?", field + mean/what
    if re.search(
        r"\b(means?|what\s+is|what'?s|explain|how\s+does|define)\b",
        lower,
    ) and ( "?" in bare or len(bare.split()) <= 8):
        return True
    # Short free-text answers that are clearly questions
    if bare.endswith("?") and len(bare) <= 80:
        # Allow bare currency codes / enums with a stray ? ("INR?", "fixed?")
        if ask in {
            "currency",
            "productType",
            "billingType",
            "billingFrequency",
            "price",
            "maxDiscount",
            "stockOnHand",
            "sku",
        }:
            return False
        return True
    return False


def explain_product_slot(ask: str) -> str:
    """Explain the current guided field, then re-ask it."""
    help_text = _PRODUCT_SLOT_HELP.get(ask) or "Happy to explain that field."
    reask = {
        "name": "What's the product name?",
        "sku": "What SKU should we use?",
        "price": "What price should we put on this? Or say skip.",
        "currency": "Which currency — USD, EUR, GBP, INR, or AED? Or say skip.",
        "productType": "Fixed/standard, or customizable?",
        "billingType": "One-time purchase or recurring subscription?",
        "billingFrequency": "Monthly, quarterly, or annual?",
        "maxDiscount": "Any max discount percent? Or say skip.",
        "brand": "What brand is this under? Or say skip.",
        "stockOnHand": "Stock on hand (number), or say skip if not tracked.",
        "productUrl": "Product URL, or say skip.",
        "category": "What category does this fall under? Or say skip.",
        "description": "Short description, or say skip.",
        "tags": "Any tags (comma-separated), or say skip.",
        "image": "Image URL, or say skip.",
        "offers": "Add an offer/plan name, or say skip.",
        "addons": "Add an addon name, or say skip / save.",
    }.get(ask, "What would you like to put here? Or say skip.")
    return f"{help_text} {reask}"


def apply_product_slot_answer(
    text: str,
    draft: dict[str, Any] | None,
    *,
    business_type: str | None = None,
) -> dict[str, Any] | None:
    """Map the user reply onto the *current* guided slot (deterministic aliases)."""
    d = draft if isinstance(draft, dict) else {}
    ask = product_next_ask_key(d, business_type=business_type)
    if ask == "save":
        return None
    bare = (text or "").strip()
    if not bare:
        return None

    if is_product_slot_meta_question(bare, ask):
        return None

    if is_product_skip_intent(bare) and ask in _PRODUCT_OPTIONAL_ASK:
        return {"skippedOptional": product_mark_skipped(d, ask)}

    if ask == "name" and len(bare) >= 2:
        return {"name": bare[:200]}
    if ask == "sku" and re.match(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$", bare):
        return {"sku": bare}
    if ask == "price":
        m = re.match(r"^\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$", bare)
        if m:
            return {"price": m.group(1).replace(",", "")}
    if ask == "currency":
        code = parse_product_currency(bare)
        if code:
            return {"currency": code}
    if ask == "productType":
        lower = bare.lower()
        if re.search(r"\b(customizable|custom|configurable)\b", lower):
            return {"productType": "customizable"}
        if re.search(r"\b(fixed|standard|simple)\b", lower):
            return {"productType": "fixed"}
    if ask == "billingType":
        lower = bare.lower()
        if re.search(r"\b(recurring|subscription|subscribe)\b", lower):
            return {"billingType": "recurring"}
        if re.search(r"\b(one[-\s]?time|once)\b", lower):
            return {"billingType": "one_time"}
    if ask == "billingFrequency":
        lower = bare.lower()
        if re.search(r"\b(monthly|per\s+month|/mo)\b", lower):
            return {"billingType": "recurring", "billingFrequency": "monthly"}
        if re.search(r"\b(quarterly|per\s+quarter)\b", lower):
            return {"billingType": "recurring", "billingFrequency": "quarterly"}
        if re.search(r"\b(annual|annually|yearly|per\s+year)\b", lower):
            return {"billingType": "recurring", "billingFrequency": "annual"}
    if ask == "maxDiscount":
        m = re.match(r"^(\d{1,3}(?:\.\d+)?)\s*%?\s*$", bare)
        if m:
            return {"maxDiscountPercent": m.group(1)}
    if ask == "brand" and len(bare) >= 2:
        return {"brand": bare[:120]}
    if ask == "stockOnHand":
        m = re.match(r"^(\d+)\s*$", bare)
        if m:
            return {"stockOnHand": m.group(1)}
    if ask == "productUrl" and re.search(r"https?://|\.", bare, re.I):
        return {"productUrl": bare[:500]}
    if ask == "category" and len(bare) >= 2:
        return {"category": bare[:120]}
    if ask == "description" and len(bare) >= 2:
        return {"description": bare[:2000]}
    if ask == "tags" and len(bare) >= 1:
        return {"tags": bare[:200]}
    if ask == "image" and re.search(r"https?://|\.", bare, re.I):
        return {"imageUrl": bare[:500]}
    if ask == "offers" and len(bare) >= 2:
        return {"offers": [{"name": bare[:120]}]}
    if ask == "addons" and len(bare) >= 2:
        return {
            "addons": [{"name": bare[:120], "pricingModel": "unit"}],
        }
    return None


def next_invoice_prompt(draft: dict[str, Any], *, just_patched: bool = False) -> str:
    del just_patched
    ask = invoice_next_ask_key(draft)
    if ask == "deal":
        return (
            "Which deal should this invoice link to? "
            "Name it and I'll match if I can."
        )
    if ask == "product":
        return "Which product line should we bill on this invoice?"
    if ask == "quantity":
        return "Quantity for that line, or say skip."
    if ask == "currency":
        return "Currency (USD, EUR, GBP, INR, AED), or say skip."
    if ask == "issueDate":
        return "Issue date (YYYY-MM-DD), or say skip."
    if ask == "dueDate":
        return "Due date (YYYY-MM-DD), or say skip."
    if ask == "paymentTerms":
        return "Payment terms (e.g. Net 30), or say skip."
    if ask == "notes":
        return "Notes on the invoice, or say skip."
    return ALL_FIELDS_DONE_CHAT


_ACTIVITY_WALK = ("contact", "type", "subject", "dueAt", "body", "save")
_ACTIVITY_OPTIONAL_ASK = frozenset({"type", "dueAt", "body"})


def activity_mandatory_field_message(
    field: str, draft: dict[str, Any] | None = None
) -> str:
    del draft
    if field == "contact":
        return (
            "Contact is mandatory — who is this activity about? "
            "Name them and I'll match if I can."
        )
    if field == "subject":
        return "Subject is mandatory — what's a short subject line?"
    return "That field is mandatory."
_ACTIVITY_TYPE_ALIASES = {
    "note": "note",
    "notes": "note",
    "call": "call",
    "phone": "call",
    "email": "email",
    "mail": "email",
    "meeting": "meeting",
    "meet": "meeting",
    "appointment": "meeting",
    "demo": "meeting",
    "task": "task",
    "todo": "task",
    "sms": "sms",
    "text": "sms",
    "notify": "note",
    "notification": "note",
}


def activity_next_ask_key(draft: dict[str, Any] | None) -> str:
    """Authoritative next activity slot (matches guided Activity setup)."""
    d = draft if isinstance(draft, dict) else {}
    skipped = product_skipped_fields(d)
    if not _s(d, "contactId"):
        return "contact"
    if not _s(d, "type") and "type" not in skipped:
        return "type"
    if not _s(d, "subject"):
        return "subject"
    if not _s(d, "dueAt") and "dueAt" not in skipped:
        return "dueAt"
    if not _s(d, "body") and "body" not in skipped:
        return "body"
    return "save"


def next_activity_prompt(draft: dict[str, Any], *, just_patched: bool = False) -> str:
    ask = activity_next_ask_key(draft)
    if ask == "contact":
        return "Who is this activity about? Name the contact and I'll match them."
    if ask == "type":
        if just_patched:
            return (
                "Got it. What kind — call, meeting, email, task, SMS, or a note?"
            )
        return "What kind of activity — call, meeting, email, task, SMS, or a note?"
    if ask == "subject":
        if just_patched:
            return "Got it. What's a short subject?"
        return "What should the subject line say?"
    if ask == "dueAt":
        if just_patched:
            return "Any due date, or skip?"
        return "When is it due? A date works, or skip."
    if ask == "body":
        if just_patched:
            return "Any extra notes, or say skip?"
        return "Anything to add in the notes, or say skip?"
    return ALL_FIELDS_DONE_CHAT


_ACTIVITY_FOR_NAME_RE = re.compile(
    r"\b(?:for|with|about)\s+"
    r"(?!me\b|a\b|an\b|the\b|this\b|that\b|today\b|tomorrow\b)"
    r"([A-Za-z][\w.'-]*(?:\s+[A-Za-z][\w.'-]*){0,3})",
    re.I,
)


def extract_activity_contact_hint(text: str) -> str | None:
    """Pull a contact name from 'log a note for Yaswanth: …'."""
    bare = (text or "").strip()
    if not bare:
        return None
    m = _ACTIVITY_FOR_NAME_RE.search(bare)
    if not m:
        return None
    name = re.split(r"[:\"“”]", m.group(1), maxsplit=1)[0].strip(" \t,.-")
    return name if len(name) >= 2 else None


def extract_activity_subject_hint(text: str) -> str | None:
    """Quoted note body, or the remainder after 'Name:'."""
    bare = (text or "").strip()
    if not bare:
        return None
    quoted = re.search(r"[\"“](.+?)[\"”]", bare)
    if quoted and len(quoted.group(1).strip()) >= 2:
        return quoted.group(1).strip()[:200]
    colon = re.search(r":\s*(.+)$", bare)
    if colon:
        rest = colon.group(1).strip().strip("\"“”'")
        if len(rest) >= 4:
            return rest[:200]
    return None


def parse_activity_type(text: str) -> str | None:
    lower = (text or "").strip().lower()
    if not lower:
        return None
    if lower in _ACTIVITY_TYPE_ALIASES:
        return _ACTIVITY_TYPE_ALIASES[lower]
    for raw, mapped in _ACTIVITY_TYPE_ALIASES.items():
        if re.search(rf"\b{re.escape(raw)}\b", lower):
            return mapped
    return None


def _activity_create_without_name(text: str) -> bool:
    """True for 'help me log a new activity' with no 'for <name>'."""
    t = (text or "").strip()
    if not t or extract_activity_contact_hint(t):
        return False
    if re.search(
        r"\bhelp me (to )?(log|record|create|add)\b",
        t,
        re.I,
    ):
        return True
    return bool(
        re.search(
            r"^\s*(log|create|add|new)\s+(a\s+|an\s+|new\s+)?"
            r"(note|call|meeting|task|sms|activit)",
            t,
            re.I,
        )
    )


def resolve_activity_contact_id(
    text: str,
    contacts: list[dict[str, Any]],
) -> str | None:
    from app.agents.coworker_shared import resolve_catalog_id

    bare = (text or "").strip()
    if not bare:
        return None
    hint = extract_activity_contact_hint(bare)
    if hint:
        return resolve_catalog_id(
            hint, items=contacts, kind="contact", min_score=0.72
        )
    # Don't fuzzy-match the whole create sentence ("new" ≠ noreply@linkedin).
    if _activity_create_without_name(bare):
        return None
    return resolve_catalog_id(
        bare, items=contacts, kind="contact", min_score=0.72
    )


def apply_activity_slot_answer(
    text: str,
    draft: dict[str, Any] | None,
    contacts: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Map the user reply onto the current activity slot."""
    d = draft if isinstance(draft, dict) else {}
    ask = activity_next_ask_key(d)
    bare = (text or "").strip()
    if not bare or ask == "save":
        return None
    if looks_like_create_confirm(bare) and ask != "save":
        return None
    if is_product_skip_intent(bare) and ask in _ACTIVITY_OPTIONAL_ASK:
        return {"skippedOptional": product_mark_skipped(d, ask)}
    if ask == "contact":
        matched = resolve_activity_contact_id(bare, contacts)
        if matched:
            return {"contactId": matched}
        # Create openers and long log utterances aren't a failed name pick.
        if _activity_create_without_name(bare) or len(bare.split()) > 6:
            return None
        return {"_unmatchedContact": True}
    if ask == "type":
        mapped = parse_activity_type(bare)
        if mapped:
            return {"type": mapped}
        return None
    if ask == "subject" and len(bare) >= 2:
        return {"subject": bare[:200]}
    if ask == "dueAt":
        due = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", bare)
        if due:
            return {"dueAt": due.group(1)}
        return None
    if ask == "body" and len(bare) >= 2:
        return {"body": bare[:2000]}
    return None


def next_quote_prompt(draft: dict[str, Any], *, just_patched: bool = False) -> str:
    del just_patched
    ask = quote_next_ask_key(draft)
    if ask == "deal":
        return (
            "Which deal is this quote for? Name it here and I'll match if I can."
        )
    if ask == "product":
        return "Which product should we quote?"
    if ask == "offer":
        return "Plan or offer on that product, or say skip if it's a fixed-price product."
    if ask == "quantity":
        return "How many units, or say skip."
    if ask == "discount":
        return "Discount percent (0–100), or say skip."
    return ALL_FIELDS_DONE_CHAT


def next_question(
    kind: str,
    draft: dict[str, Any],
    *,
    just_patched: bool = False,
    business_type: str | None = None,
) -> str:
    if kind == "contact":
        return next_contact_prompt(draft, just_patched=just_patched)
    if kind == "company":
        return next_company_prompt(draft, just_patched=just_patched)
    if kind == "location":
        return next_location_prompt(draft, just_patched=just_patched)
    if kind == "deal" or kind == "sales":
        return next_deal_prompt(draft, just_patched=just_patched)
    if kind == "product":
        return next_product_prompt(
            draft, just_patched=just_patched, business_type=business_type
        )
    if kind == "invoice" or kind == "finance":
        return next_invoice_prompt(draft, just_patched=just_patched)
    if kind == "activity" or kind == "activities":
        return next_activity_prompt(draft, just_patched=just_patched)
    if kind == "quote" or kind == "quotes":
        return next_quote_prompt(draft, just_patched=just_patched)
    return "What would you like to work on next?"


TONE_RULES = """
Conversational rules (all modules):
- You are talking with the user — communicate. Never answer with only "On it.", "Done.", or a bare status.
- Sound like a helpful colleague: warm, clear, briefly human. Not a form wizard or ticket bot.
- Always acknowledge what they just said in plain language, then ask the next useful question or confirm the action.
- Vary your wording — do not repeat the same "Got it — X. What's X's Y?" pattern every turn.
- Ask exactly ONE next question, and only when a required slot is missing. Prefer acting when slots are filled.
- Never phrase requests as form labels. Correct: "Could you share their email?" Incorrect: "Email:" or "First Name:".
- If they volunteer several fields at once, accept them all and only ask for what's still missing.
- Create vs update: "add a phone/email/title/domain/price" (or similar field) means UPDATE an existing record — not create a new one. Create only when they clearly want a NEW contact/deal/company/product/quote/invoice/activity.
- Walk every guided field in order; do not offer to save until all fields are filled or skipped. Then tell them they can save when ready — never tell them to type "create", "yes", "skip", or "ask again".
- Never volunteer "say skip" or "type yes" as instructions. If they skip an optional field on their own, accept and continue.
- Only greet once at the start of a conversation — never re-greet mid-flow.
- Interpret short replies (skip, yes, ok, no) from the current step in the conversation.
- Act on clear intents (including typos). Only clarify when something is genuinely ambiguous (who, which record).
- Never claim you saved or created anything until they agree in chat and the save tool runs.
- Never tell them to click Create on the form or tap a Confirm button.
- Never narrate internal checks (validating, looking up duplicates) — just continue with the right next step.
- Never mention opening create, the workspace, the right pane, set_workspace, or "pulling in" what they shared. Just ask the next human question.
- Never show database IDs, CUIDs, UUIDs, or strings like "(ID cm…)" to the user. Refer to deals, contacts, and products by name/title only.
- Keep replies to 1–2 short sentences, but those sentences must feel spoken to a person.
""".strip()

# Keep draft agents aligned with crm_tools conversational policy when available.
try:
    from app.agents.crm_tools import CONVERSATIONAL_SHARED as _CONV

    TONE_RULES = _CONV
except Exception:
    pass

