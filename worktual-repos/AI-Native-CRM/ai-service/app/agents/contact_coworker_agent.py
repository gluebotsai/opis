"""Contacts module co-worker — list / create / detail workspace intents."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.draft_conversation import (
    CONTACT_FIRST_NAME_Q,
    company_field_change_without_value,
    contact_field_change_without_value,
    describe_company_patch,
    describe_contact_patch,
    is_field_add_not_create,
    open_in_shell_create,
    parse_company_field_update,
    parse_contact_field_update,
    parse_pending_contact_field_offer,
    pending_contact_field_from_messages,
    propose_delete_contact_proposal,
    propose_import_contacts_proposal,
    propose_update_company_proposal,
    propose_update_contact_proposal,
)
from app.agents.coworker_shared import (
    display_from_catalog,
    has_compound_delete_intent,
    has_open_record,
    looks_like_affirmative,
    looks_like_decline,
    open_entity_id,
    wants_delete_intent,
)
from app.agents.native_pipeline import run_steps
from app.agents.crm_tools import effective_contact_type


class ContactCoworkerState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    result: dict[str, Any]


def _last_user(messages: list[dict[str, Any]] | None) -> str:
    if not messages:
        return ""
    for m in reversed(messages):
        if m.get("role") == "user" and isinstance(m.get("text"), str):
            t = m["text"].strip()
            if t:
                return t
    return ""


def _last_assistant(messages: list[dict[str, Any]] | None) -> str:
    if not messages:
        return ""
    for m in reversed(messages):
        if m.get("role") == "assistant" and isinstance(m.get("text"), str):
            t = m["text"].strip()
            if t:
                return t
    return ""


def is_contacts_list_intent(text: str) -> bool:
    lower = text.lower()
    return bool(
        re.search(r"show\s+(all\s+)?contacts?", lower)
        or re.search(r"list\s+(all\s+)?contacts?", lower)
        or re.search(r"back\s+to\s+(the\s+)?(list|contacts?)", lower)
        or re.search(r"return\s+to\s+(the\s+)?(list|contacts?)", lower)
        or re.search(r"\b(view|open)\s+(the\s+)?(contact\s+)?list\b", lower)
        or re.search(r"\bclear\s+(the\s+)?(search|filter|filters)\b", lower)
        or re.search(r"^\s*show\s+all\s*$", lower)
        or lower in ("show contacts", "contacts")
    )


def _is_help_question(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(what can you|what do you|capabilities|how do (you|i)|explain (this|the)|"
            r"who are you|what are you)\b",
            lower,
        )
        or re.search(r"what can you help", lower)
    )


def _wants_delete(lower: str) -> bool:
    return wants_delete_intent(lower)


def _wants_edit(lower: str) -> bool:
    if _wants_delete(lower):
        return False
    if is_field_add_not_create(lower):
        return True
    return bool(
        re.search(
            r"\b(edit|update|change|modify|rename)\b|"
            r"\b(fix|correct)\s+(the\s+)?(contact|name|email|phone|details?)\b",
            lower,
        )
    )


CONTACT_CSV_IMPORT_INSTRUCTIONS = (
    "Great! To onboard multiple users efficiently, please upload a CSV file "
    "following the required format. You can download the template and instructions "
    "here: [CSV Instructions](/api/contacts/import/sample).\n\n"
    "Once you've prepared the file, you can upload it now."
)


def _wants_import_now(lower: str) -> bool:
    """True when they asked to import rows now — not just see the sample."""
    if re.search(
        r"\bimport\s+(this|the|your|that)\s+(sample|template|csv|file|rows?)\b",
        lower,
    ):
        return True
    if re.search(r"\bimport\s+(the\s+)?sample\b", lower):
        return True
    if re.search(r"\b(use|load|go\s+with)\s+(the\s+)?(sample|template)\b", lower):
        return True
    return bool(re.search(r"\bimport\s+(them|these|it)\b", lower))


def _wants_import(lower: str) -> bool:
    if re.search(r"\b(zoominfo|apollo|lusha|builtwith)\b", lower):
        return False
    if _wants_import_now(lower):
        return True
    if re.search(r"\b(sample|template|format)\b", lower) and re.search(
        r"\b(csv|spreadsheet|excel)\b", lower
    ):
        return True
    if re.search(r"\bimport\b", lower) and re.search(
        r"\b(csv|spreadsheet|excel|contacts?|leads?|people)\b", lower
    ):
        return True
    return bool(re.search(r"\bbulk\s+(upload|import|add)\b", lower))


def _normalize_csv_header(line: str) -> str:
    return re.sub(r"[\s_\-]+", "", (line or "").lower())


def _csv_header_row_ok(line: str) -> bool:
    if not re.search(r"[,;\t]", line):
        return False
    norm = _normalize_csv_header(line)
    has_email = "email" in norm
    has_name = any(
        tok in norm
        for tok in (
            "firstname",
            "lastname",
            "fullname",
            "fname",
            "lname",
            "name",
        )
    )
    return has_email and has_name


def _extract_contact_csv(text: str) -> str | None:
    """Return CSV body starting at the header row, or None."""
    raw = (text or "").strip()
    if raw.startswith("\ufeff"):
        raw = raw[1:]
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    start = None
    for i, line in enumerate(lines[:-1]):
        if _csv_header_row_ok(line):
            start = i
            break
    if start is None:
        return None
    body_lines = lines[start:]
    if len(body_lines) < 2:
        return None
    return "\n".join(body_lines).strip() + "\n"


def _looks_like_contact_csv(text: str) -> bool:
    return _extract_contact_csv(text) is not None


def _awaiting_csv_upload(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return "csv instructions" in last or (
        "prepared the file" in last and "upload it now" in last
    )


def _wants_create(lower: str) -> bool:
    """True for create flows — never edit/update/delete or field-add."""
    if _is_help_question(lower) or _wants_edit(lower) or _wants_delete(lower):
        return False
    if _wants_import(lower) or _looks_like_contact_csv(lower):
        return False
    if is_field_add_not_create(lower):
        return False
    return bool(
        re.search(
            r"\b(create|new|start|make|draft|register|set\s*up|insert)\b|"
            r"\badd\s+(a\s+|an\s+|new\s+)?(contact|lead|person)\b|"
            r"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|register|insert)\b|"
            r"\b(want|need)\s+(a|an)\s+(new\s+)?(contact|lead|person)\b|"
            r"\badd\b.+\b(named|called|email|@)\b",
            lower,
        )
    )


def extract_delete_query(text: str) -> str | None:
    m = re.search(
        r"(?:delete|remove|erase)\s+"
        r"(?:the\s+)?(?:contact\s+)?(?:for\s+|named\s+|of\s+)?"
        r"(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(
        r"^(a|the|this|that|contact|contacts?|lead|person|people|them|him|her|"
        r"it|here|"
        r"this\s+contact|the\s+contact|current\s+contact|"
        r"this\s+person|this\s+lead|this\s+one)$",
        q,
        re.I,
    ):
        return None
    q = re.sub(r"^(?:the\s+)?contact\s+", "", q, flags=re.I).strip()
    if not q or re.match(
        r"^(this|that|them|him|her|it|here)$",
        q,
        re.I,
    ):
        return None
    return q[:120] if q else None


def _looks_like_delete_confirm(text: str) -> bool:
    if looks_like_affirmative(text):
        return True
    return bool(
        re.match(
            r"^\s*(delete(\s+(it|them|him|her|this|that))?"
            r"(\s+(the\s+)?(contact|person|lead))?|"
            r"remove(\s+(it|them|him|her|this|that))?"
            r"(\s+(the\s+)?(contact|person|lead))?)\s*[.!]?\s*$",
            text.strip(),
            re.I,
        )
    )


def extract_open_query(text: str) -> str | None:
    m = re.search(
        r"(?:open|show|view|find|go to)\s+(?:contact\s+)?(.+)$",
        text,
        re.I,
    ) or re.search(r"^contact\s+(.+)$", text, re.I)
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(r"^(a|the|all|list|new)$", q, re.I):
        return None
    if is_contacts_list_intent(text):
        return None
    if re.match(r"^(contact|this|them|him|her)$", q, re.I):
        return None
    return q[:120]


def extract_edit_query(text: str) -> str | None:
    """Name/email after edit/update phrasing, if any."""
    # Field assignments are not contact names ("update country as India")
    if parse_contact_field_update(text) or parse_company_field_update(text):
        return None
    if company_field_change_without_value(text):
        return None
    m = re.search(
        r"(?:edit|update|change|modify|rename)\s+"
        r"(?:the\s+)?(?:contact\s+)?(?:for\s+|named\s+|of\s+)?"
        r"(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    # Bare "edit contact" / "edit this contact" — no person named yet
    if not q or re.match(
        r"^(a|the|this|that|contact|contacts?|lead|person|people|them|him|her|"
        r"it|details?|info|information|profile|alone|only|"
        r"this\s+alone|that\s+alone|just\s+this|only\s+this|"
        r"this\s+one|that\s+one|"
        r"this\s+contact|the\s+contact|current\s+contact|"
        r"this\s+person|this\s+lead)$",
        q,
        re.I,
    ):
        return None
    # "industry type of this contact" / field names are not people
    if re.search(
        r"\bof\s+(?:this|the)\s+(?:contact|person|company)\b|"
        r"^(?:the\s+)?"
        r"(?:industry(?:\s+type)?|domain|title|email|phone|mobile|address|"
        r"city|country|notes?|linkedin|employee|company\s*size|"
        r"lifecycle|lead\s*status|status)\b",
        q,
        re.I,
    ):
        return None
    # Drop leading "contact " if still present
    q = re.sub(r"^(?:the\s+)?contact\s+", "", q, flags=re.I).strip()
    if not q:
        return None
    # "country as India" leftover after stripping "update"
    if parse_contact_field_update(q) or parse_company_field_update(q):
        return None
    return q[:120]


def _open_contact(
    catalog: dict[str, Any] | None, entity_id: Any
) -> dict[str, Any] | None:
    if not entity_id:
        return None
    eid = str(entity_id)
    open_c = (catalog or {}).get("openContact")
    if isinstance(open_c, dict) and str(open_c.get("id") or "") == eid:
        return open_c
    for c in (catalog or {}).get("contacts") or []:
        if isinstance(c, dict) and str(c.get("id")) == eid:
            return c
    return None


def _open_company(catalog: dict[str, Any] | None) -> dict[str, Any] | None:
    open_co = (catalog or {}).get("openCompany")
    return open_co if isinstance(open_co, dict) and open_co.get("id") else None


def _refers_to_open_contact(text: str) -> bool:
    lower = (text or "").lower()
    return bool(
        re.search(
            r"\b(this|current|open)\s+(contact|person|lead|one)\b|"
            r"\b(this|them|him|her|here)\b|"
            r"\bof\s+this\s+(contact|person|lead)\b",
            lower,
        )
    )


def _wants_about(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(tell( me)? about|what (do )?you know|who is (this|they|he|she)|"
            r"summarize|about this|describe (this|them)|what('?s| is) "
            r"(their|his|her|this)\b)",
            lower,
        )
        or re.search(r"\btell( me)? about\b", lower)
    )


def _summarize_open_contact(
    contact: dict[str, Any], company: dict[str, Any] | None
) -> str:
    name = str(contact.get("displayName") or "").strip() or "This contact"
    bits = [f"**{name}** is open on the right."]
    email = str(contact.get("email") or "").strip()
    phone = str(contact.get("phone") or "").strip()
    title = str(contact.get("title") or "").strip()
    city = str(contact.get("city") or "").strip()
    country = str(contact.get("country") or "").strip()
    address = str(contact.get("addressLine") or "").strip()
    if title:
        bits.append(f"Title: **{title}**.")
    if email:
        bits.append(f"Email: {email}.")
    if phone:
        bits.append(f"Phone: {phone}.")
    loc = ", ".join(x for x in (address or city, country) if x)
    if loc:
        bits.append(f"Location: {loc}.")
    if company:
        cname = str(company.get("name") or contact.get("companyName") or "").strip()
        industry = str(company.get("industry") or "").strip()
        domain = str(company.get("domain") or "").strip()
        company_bits = []
        if cname:
            company_bits.append(cname)
        if industry:
            company_bits.append(f"industry **{industry}**")
        if domain:
            company_bits.append(f"domain {domain}")
        if company_bits:
            bits.append("Company: " + ", ".join(company_bits) + ".")
    elif contact.get("companyName"):
        bits.append(f"Company: {contact['companyName']}.")
    stage = effective_contact_type(contact.get("contactType"))
    bits.append(f"Lifecycle: {stage}.")
    bits.append("What would you like to change?")
    return " ".join(bits)


def _apply_company_field_update(
    company_id: str, field_patch: dict[str, str]
) -> dict[str, Any]:
    from app.agents.draft_conversation import sanitize_company_field_patch

    clean = sanitize_company_field_patch(field_patch)
    if not clean:
        return {
            "ok": True,
            "assistantText": (
                "What's the new company name? Just the name itself "
                "(e.g. Red Bull) — not the whole sentence."
            ),
        }
    what = describe_company_patch(clean)
    return {
        "ok": True,
        "assistantText": f"Sure — I'll update the company {what} now.",
        "toolProposals": [
            propose_update_company_proposal(
                company_id=str(company_id),
                patch=clean,
                auto=True,
            )
        ],
    }


def _ask_company_field_value(
    field: str, company: dict[str, Any] | None
) -> dict[str, Any]:
    labels = {
        "name": "company name",
        "industry": "industry",
        "domain": "domain",
        "linkedinUrl": "LinkedIn URL",
        "employeeCount": "employee count",
    }
    label = labels.get(field, field)
    cname = str((company or {}).get("name") or "their company").strip()
    current = str((company or {}).get(field) or "").strip()
    if current:
        return {
            "ok": True,
            "assistantText": (
                f"**{cname}** currently has {label} **{current}**. "
                f"What should we change it to?"
            ),
        }
    return {
        "ok": True,
        "assistantText": f"What {label} should we set for **{cname}**?",
    }


def _awaiting_contact_identity(messages: list[dict[str, Any]] | None) -> bool:
    """True when the last assistant turn asked which contact to open/edit."""
    last = _last_assistant(messages).lower()
    if not last:
        return False
    if (
        _awaiting_delete_identity(messages)
        or _awaiting_delete_confirm(messages)
        or _awaiting_field_update_target(messages)
    ):
        return False
    return bool(
        re.search(
            r"which contact|name or email|who (do you|should|would)|"
            r"provide (a |the )?name|tell me who|find them",
            last,
        )
    )


def _awaiting_company_field_value(messages: list[dict[str, Any]] | None) -> str | None:
    last = _last_assistant(messages).lower()
    if not last:
        return None
    if re.search(r"what (industry|domain|linkedin|employee)", last) or re.search(
        r"currently has (industry|domain|linkedin|employee)", last
    ):
        if "industry" in last:
            return "industry"
        if "domain" in last:
            return "domain"
        if "linkedin" in last:
            return "linkedinUrl"
        if "employee" in last:
            return "employeeCount"
    if re.search(r"what should we change it to", last):
        if "industry" in last:
            return "industry"
        if "domain" in last:
            return "domain"
        if "linkedin" in last:
            return "linkedinUrl"
        if "employee" in last:
            return "employeeCount"
        return "industry"
    return None


def _awaiting_field_update_target(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(r"which contact should we update", last)
        and re.search(r"i'?ll set the|set the", last)
    )


def _contact_hint_from_messages(
    messages: list[dict[str, Any]] | None,
) -> str | None:
    """Name mentioned in recent update/edit turns (user or assistant)."""
    for m in reversed((messages or [])[-8:]):
        text = str(m.get("text") or "").strip()
        if not text:
            continue
        role = str(m.get("role") or "")
        if role == "user":
            q = extract_edit_query(text)
            if q:
                return q
            m_create = re.search(
                r"(?:edit|update|change|modify)\s+(?:the\s+)?(?:contact\s+)?"
                r"(?:for\s+|named\s+|of\s+)?(.+)$",
                text,
                re.I,
            )
            if m_create:
                cand = m_create.group(1).strip().rstrip(".?!")
                if cand and not re.match(
                    r"^(this|that|alone|it|them|him|her|contact)(\s+alone)?$",
                    cand,
                    re.I,
                ):
                    return cand[:120]
        if role == "assistant":
            updating = re.search(
                r"\b(?:updating|editing|changing)\s+\*{0,2}([A-Za-z][\w.'-]+"
                r"(?:\s+[A-Za-z][\w.'-]+)?)\*{0,2}\b",
                text,
                re.I,
            )
            if updating:
                return updating.group(1).strip()[:120]
            for_m = re.search(
                r"(?:update|change|edit)\s+for\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)"
                r"|for\s+\*\*([^*]+)\*\*"
                r"|for\s+([A-Z][\w.'-]+(?:\s+[A-Za-z][\w.'-]+)?)\s*\?",
                text,
            )
            if for_m:
                return (for_m.group(1) or for_m.group(2) or for_m.group(3) or "").strip()[
                    :120
                ]
            field_for = re.search(
                r"which field .* for\s+([A-Za-z][\w.'-]+(?:\s+[A-Za-z][\w.'-]+)?)",
                text,
                re.I,
            )
            if field_for:
                return field_for.group(1).strip()[:120]
    return None


def _looks_like_create_draft_prompt(speech: str) -> bool:
    """LLM sometimes drifts into create-slot questions mid-update."""
    lower = (speech or "").lower()
    if not lower.strip():
        return False
    return bool(
        re.search(
            r"\b(what('s| is) the first name|and (what('s| is) )?the first name|"
            r"got it[, ]+.*first name|what is the last name|"
            r"provide the last name|primary email address for this contact|"
            r"let's start with the first contact)\b",
            lower,
        )
    )


def _resolve_update_target(
    text: str,
    ctx: dict[str, Any],
    catalog: dict[str, Any] | None,
    messages: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Open contact, named edit query, or recent chat hint."""
    entity_id = open_entity_id(ctx)
    if entity_id:
        hit = _open_contact(catalog, entity_id)
        if hit:
            return hit
    q = extract_edit_query(text)
    if q:
        return resolve_contact_match(catalog, q)
    hint = _contact_hint_from_messages(messages)
    if hint:
        return resolve_contact_match(catalog, hint)
    stm = (ctx.get("sessionMemory") if isinstance(ctx, dict) else None) or {}
    slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
    last = stm.get("lastEntities") if isinstance(stm.get("lastEntities"), dict) else {}
    cid = str(slots.get("contactId") or last.get("contactId") or "").strip()
    if cid:
        return _open_contact(catalog, cid) or resolve_contact_match(catalog, cid)
    return None



def _awaiting_delete_identity(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(r"\bdelete\b|\bremove\b", last)
        and re.search(r"which contact|name or email|who (should|would|do)", last)
    )


def _awaiting_delete_confirm(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(
            r"want me to remove|permanently remove|permanently delete|"
            r"confirm.*(delete|remov)|ready to delete|say \*\*delete\*\*|"
            r"can't be undone|cannot be undone|go[- ]?ahead|"
            r"before i remove|your go-ahead|want your go-ahead|"
            r"want to permanently",
            last,
        )
    )


def _awaiting_save_confirm(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(
            r"shall i save|should i save|want me to save|save that change|"
            r"ready to save|go ahead and save",
            last,
        )
    )


def _looks_like_contact_identity(text: str) -> bool:
    """Short name/email reply — not a new command."""
    stripped = text.strip()
    if not stripped or len(stripped) > 80:
        return False
    lower = stripped.lower()
    if (
        _wants_create(lower)
        or _wants_edit(lower)
        or _wants_delete(lower)
        or _wants_import(lower)
        or is_contacts_list_intent(stripped)
    ):
        return False
    if re.search(
        r"\b(help|what can|show|list|create|add|new|edit|update|cancel|never\s*mind)\b",
        lower,
    ):
        return False
    # Email or 1–3 word name
    if re.search(r"^[\w.+-]+@[\w.-]+\.\w+$", stripped):
        return True
    words = re.findall(r"[A-Za-z][\w'-]*", stripped)
    return 1 <= len(words) <= 4


def resolve_contact_match(
    catalog: dict[str, Any] | None, query: str
) -> dict[str, Any] | None:
    """Return a single catalog contact when the query uniquely identifies them."""
    contacts = (catalog or {}).get("contacts")
    if not isinstance(contacts, list) or not contacts:
        return None
    q = query.strip().lower()
    if not q:
        return None

    exact: list[dict[str, Any]] = []
    strong: list[dict[str, Any]] = []
    weak: list[dict[str, Any]] = []

    for raw in contacts:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        name = str(raw.get("displayName") or "").strip()
        email = str(raw.get("email") or "").strip()
        name_l = name.lower()
        email_l = email.lower()
        if not name_l and not email_l:
            continue
        if q == name_l or q == email_l:
            exact.append(raw)
            continue
        first = name_l.split()[0] if name_l else ""
        if first == q or name_l.startswith(q + " ") or email_l.startswith(q):
            strong.append(raw)
            continue
        if q in name_l or (email_l and q in email_l):
            weak.append(raw)

    for bucket in (exact, strong, weak):
        if len(bucket) == 1:
            return bucket[0]
    return None


def _pending_duplicate_contacts(
    ctx: dict[str, Any], catalog: dict[str, Any] | None
) -> list[dict[str, Any]]:
    pending = (catalog or {}).get("pendingDuplicateContacts")
    if isinstance(pending, list) and pending:
        return [
            c
            for c in pending
            if isinstance(c, dict) and str(c.get("id") or "").strip()
        ]
    stm = (ctx.get("sessionMemory") if isinstance(ctx, dict) else None) or {}
    slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
    pending_stm = slots.get("pendingDuplicateContacts")
    if isinstance(pending_stm, list):
        return [
            c
            for c in pending_stm
            if isinstance(c, dict) and str(c.get("id") or "").strip()
        ]
    return []


def _awaiting_duplicate_review(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        "possible duplicate" in last
        or "duplicate before saving" in last
        or "open an existing one" in last
    )


def _wants_open_existing_duplicate(lower: str) -> bool:
    return bool(
        re.search(r"\bopen\b.*\b(existing|duplicate|that one|them)\b", lower)
        or re.search(r"\b(existing|duplicate)\b.*\b(open|use)\b", lower)
        or lower.strip()
        in {
            "open the existing one",
            "open existing",
            "open existing one",
            "use existing",
            "use the existing one",
        }
    )


def _resolve_pending_duplicate_open(
    text: str,
    ctx: dict[str, Any],
    catalog: dict[str, Any] | None,
) -> dict[str, Any] | None:
    pending = _pending_duplicate_contacts(ctx, catalog)
    if not pending:
        return None
    if len(pending) == 1:
        return pending[0]
    match = resolve_contact_match({"contacts": pending}, text)
    if match:
        return match
    if _wants_open_existing_duplicate(text.lower()):
        return pending[0]
    return None


def _open_pending_duplicate_result(contact: dict[str, Any]) -> dict[str, Any]:
    name = str(contact.get("displayName") or "contact").strip() or "contact"
    cid = str(contact["id"])
    return {
        "ok": True,
        "assistantText": (
            f"I've opened **{name}**'s profile. What would you like to update or do next?"
        ),
        "toolProposals": [
            {
                "id": "ws-open-dup",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": cid,
                    "auto": True,
                },
                "risk": "low",
            }
        ],
        "sessionMemoryPatch": {
            "slots": {"contactId": cid, "pendingDuplicateContacts": []},
            "lastEntities": {"contactId": cid},
        },
    }


def _open_contact_result(contact: dict[str, Any], *, query: str) -> dict[str, Any]:
    name = str(contact.get("displayName") or query).strip() or query
    cid = str(contact["id"])
    return {
        "ok": True,
        "assistantText": (
            f"Opening **{name}** — tell me what you'd like to change "
            "(name, email, phone, title, …)."
        ),
        "toolProposals": [
            {
                "id": "ws-detail",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": cid,
                    "auto": True,
                },
                "risk": "low",
            }
        ],
        "sessionMemoryPatch": {
            "slots": {"contactId": cid},
            "lastEntities": {"contactId": cid},
        },
    }


def _delete_candidate_result(contact: dict[str, Any], *, query: str) -> dict[str, Any]:
    """Open the contact and ask for an explicit delete confirmation in chat."""
    name = str(contact.get("displayName") or query).strip() or query
    return {
        "ok": True,
        "assistantText": (
            f"I found **{name}**. Want me to remove them permanently?"
        ),
        "toolProposals": [
            {
                "id": "ws-detail-delete",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": str(contact["id"]),
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


def _find_or_search_contact(
    query: str, catalog: dict[str, Any] | None
) -> dict[str, Any]:
    """Prefer opening a unique match in chat; otherwise filter the list."""
    match = resolve_contact_match(catalog, query)
    if match:
        return _open_contact_result(match, query=query)
    q = query.strip()[:120]
    is_email = "@" in q and "." in q.split("@")[-1]
    if is_email:
        assistant_text = (
            f"I've filtered the list for **{q}**. "
            "Check the results on the right — tell me if you'd like to open one."
        )
    else:
        assistant_text = (
            f"I couldn't uniquely match **{q}** — I've filtered the list. "
            "Say the full name or email and I'll open them."
        )
    return {
        "ok": True,
        "assistantText": assistant_text,
        "toolProposals": [
            {
                "id": "ws-search",
                "name": "set_workspace",
                "label": "Search contacts",
                "args": {"mode": "list", "search": q, "auto": True},
                "risk": "low",
            }
        ],
    }


def _find_or_search_for_delete(
    query: str, catalog: dict[str, Any] | None
) -> dict[str, Any]:
    match = resolve_contact_match(catalog, query)
    if match:
        return _delete_candidate_result(match, query=query)
    q = query.strip()[:120]
    return {
        "ok": True,
        "assistantText": (
            f"I couldn't uniquely match **{q}** — I've filtered the list. "
            "Say the full name or email of the contact to delete."
        ),
        "toolProposals": [
            {
                "id": "ws-search-delete",
                "name": "set_workspace",
                "label": "Search contacts",
                "args": {"mode": "list", "search": q, "auto": True},
                "risk": "low",
            }
        ],
    }


def _looks_like_simple_yes(text: str) -> bool:
    return looks_like_affirmative(text)


def _apply_field_update(
    entity_id: str, field_patch: dict[str, str]
) -> dict[str, Any]:
    what = describe_contact_patch(field_patch)
    return {
        "ok": True,
        "assistantText": (
            f"Sure — I'll update the {what} now."
        ),
        "toolProposals": [
            propose_update_contact_proposal(
                contact_id=str(entity_id),
                patch=field_patch,
                auto=True,
            )
        ],
    }


def _ask_which_contact() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which contact should we open? Share a name or email and I'll find them."
        ),
    }


def _ask_which_contact_for_field(field_patch: dict[str, str]) -> dict[str, Any]:
    what = describe_contact_patch(field_patch)
    return {
        "ok": True,
        "assistantText": (
            f"Which contact should we update — I'll set the {what}. "
            "Share a name or email."
        ),
    }


def _open_and_apply_field_update(
    contact: dict[str, Any], field_patch: dict[str, str]
) -> dict[str, Any]:
    name = str(contact.get("displayName") or "this contact").strip() or "this contact"
    what = describe_contact_patch(field_patch)
    cid = str(contact["id"])
    return {
        "ok": True,
        "assistantText": (
            f"Updating **{name}** — setting the {what} now."
        ),
        "toolProposals": [
            {
                "id": "ws-detail-field",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": cid,
                    "auto": True,
                },
                "risk": "low",
            },
            propose_update_contact_proposal(
                contact_id=cid,
                patch=field_patch,
                auto=True,
            ),
        ],
        "sessionMemoryPatch": {
            "slots": {"contactId": cid},
            "lastEntities": {"contactId": cid},
        },
    }


def _ask_which_contact_to_delete() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which contact would you like to delete? Share a name or email."
        ),
    }


def _execute_delete(
    contact_id: str, *, display_name: str = ""
) -> dict[str, Any]:
    name = display_name.strip() or "this contact"
    return {
        "ok": True,
        "assistantText": f"Removing **{name}** now.",
        "toolProposals": [
            propose_delete_contact_proposal(
                contact_id=str(contact_id),
                display_name=display_name,
                auto=True,
            )
        ],
    }


def contacts_heuristic(
    text: str,
    ctx: dict[str, Any],
    *,
    messages: list[dict[str, Any]] | None = None,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    surface = str(ctx.get("surface") or "").lower()
    lower = text.lower()
    entity_id = open_entity_id(ctx)
    open_in_memory = has_open_record(ctx)

    if is_contacts_list_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "Alright — showing all contacts again."
                if surface == "list"
                else "Alright — back to the contacts list. Chat stays here."
            ),
            "toolProposals": [
                {
                    "id": "ws-list",
                    "name": "set_workspace",
                    "label": "Show contacts",
                    # Clear leftover search from prior find/delete filter steps.
                    "args": {"mode": "list", "auto": True, "search": ""},
                    "risk": "low",
                }
            ],
        }

    csv_body = _extract_contact_csv(text)
    if csv_body:
        return {
            "ok": True,
            "assistantText": "Got your CSV — importing those contacts now.",
            "toolProposals": [
                propose_import_contacts_proposal(csv_text=csv_body)
            ],
        }
    if _wants_import_now(lower):
        return {
            "ok": True,
            "assistantText": "Importing the sample contacts now.",
            "toolProposals": [
                propose_import_contacts_proposal(sample=True)
            ],
        }
    if _awaiting_csv_upload(messages) and looks_like_affirmative(text):
        return {
            "ok": True,
            "assistantText": (
                "Attach your .csv with the paperclip, or paste the rows here — "
                "then I'll import them."
            ),
        }
    if _wants_import(lower):
        return {
            "ok": True,
            "assistantText": CONTACT_CSV_IMPORT_INSTRUCTIONS,
        }

    pending_dup = _resolve_pending_duplicate_open(text, ctx, catalog)
    if pending_dup and (
        _wants_open_existing_duplicate(lower)
        or (_awaiting_duplicate_review(messages) and _looks_like_contact_identity(text))
    ):
        return _open_pending_duplicate_result(pending_dup)

    if _awaiting_duplicate_review(messages) and _wants_open_existing_duplicate(lower):
        pending = _pending_duplicate_contacts(ctx, catalog)
        if pending:
            return _open_pending_duplicate_result(pending[0])

    # Delete confirm after we identified a contact — decline gracefully
    if _awaiting_delete_confirm(messages) and looks_like_decline(text):
        name = (
            display_from_catalog(
                catalog, str(entity_id), list_key="contacts", open_key="openContact"
            )
            if entity_id
            else ""
        )
        who = f"**{name}**" if name else "that contact"
        return {
            "ok": True,
            "assistantText": f"No problem — I won't delete {who}. Anything else you need?",
        }

    # Delete confirm after we identified a contact
    if _awaiting_delete_confirm(messages) and (
        _looks_like_delete_confirm(text) or _wants_delete(lower)
    ):
        if entity_id:
            display = display_from_catalog(
                catalog,
                entity_id,
                list_key="contacts",
                open_key="openContact",
            )
            return _execute_delete(str(entity_id), display_name=display)
        return {
            "ok": True,
            "assistantText": (
                "I still need to know who to delete — share a name or email."
            ),
        }

    # Follow-up after "which contact to delete?"
    if _awaiting_delete_identity(messages) and _looks_like_contact_identity(text):
        return _find_or_search_for_delete(text, catalog)

    # Compound request ("delete this and create a new one") — never guess on
    # a destructive action when the message is asking for more than one thing
    if has_compound_delete_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "That sounds like more than one request — should I update this "
                "contact, delete it, or create a new one? Let's do one at a time."
            ),
        }

    # Explicit delete — memory owns "who" when a record is open
    if _wants_delete(lower):
        q = extract_delete_query(text)
        if open_in_memory and entity_id:
            # Only leave open memory when they clearly named a *different* person
            if q:
                match = resolve_contact_match(catalog, q)
                if match and str(match.get("id")) != str(entity_id):
                    return _find_or_search_for_delete(q, catalog)
            display = display_from_catalog(
                catalog,
                entity_id,
                list_key="contacts",
                open_key="openContact",
            )
            return _execute_delete(str(entity_id), display_name=display)
        if q:
            return _find_or_search_for_delete(q, catalog)
        return _ask_which_contact_to_delete()

    if _looks_like_simple_yes(text) and _awaiting_save_confirm(messages):
        pending = pending_contact_field_from_messages(messages)
        if pending:
            target = _resolve_update_target(text, ctx, catalog, messages)
            if target and target.get("id"):
                return _apply_field_update(str(target["id"]), pending)

    # Follow-up after "which contact to update (field)?"
    if _awaiting_field_update_target(messages) and _looks_like_contact_identity(text):
        pending = parse_pending_contact_field_offer(_last_assistant(messages))
        if pending:
            match = resolve_contact_match(catalog, text)
            if match:
                return _open_and_apply_field_update(match, pending)
            return {
                "ok": True,
                "assistantText": (
                    f"I couldn't uniquely match **{text.strip()[:80]}** — "
                    "share the full name or email of the contact to update."
                ),
                "toolProposals": [
                    {
                        "id": "ws-search-field",
                        "name": "set_workspace",
                        "label": "Search contacts",
                        "args": {
                            "mode": "list",
                            "search": text.strip()[:120],
                            "auto": True,
                        },
                        "risk": "low",
                    }
                ],
            }

    # Explicit contact field assignments before company-field follow-ups —
    # "city as Namakkal" must not be treated as a company industry value.
    field_patch = parse_contact_field_update(text)
    if field_patch:
        if entity_id:
            return _apply_field_update(str(entity_id), field_patch)
        target = _resolve_update_target(text, ctx, catalog, messages)
        if target and target.get("id"):
            return _open_and_apply_field_update(target, field_patch)
        return _ask_which_contact_for_field(field_patch)

    # Follow-up: user provided a company field value after we asked
    pending_co_field = _awaiting_company_field_value(messages)
    if pending_co_field and entity_id and surface == "detail":
        raw = text.strip().rstrip(".!")
        if raw and len(raw.split()) <= 8 and not _wants_create(lower):
            company_id = None
            open_company = _open_company(catalog)
            open_contact = _open_contact(catalog, entity_id)
            if open_company and open_company.get("id"):
                company_id = str(open_company["id"])
            elif open_contact and open_contact.get("companyId"):
                company_id = str(open_contact["companyId"])
            if company_id:
                return _apply_company_field_update(
                    company_id, {pending_co_field: raw[:120]}
                )

    # Follow-up after "which contact?" — treat the reply as a search query
    if _awaiting_contact_identity(messages) and _looks_like_contact_identity(text):
        return _find_or_search_contact(text, catalog)

    open_contact = _open_contact(catalog, entity_id)
    open_company = _open_company(catalog)

    # About / summarize — memory owns who when a record is open
    if _wants_about(lower) and open_in_memory and entity_id:
        if open_contact:
            return {
                "ok": True,
                "assistantText": _summarize_open_contact(open_contact, open_company),
            }
        return {
            "ok": True,
            "assistantText": (
                "I have this contact open on the right — ask me to change "
                "a field (title, email, phone, industry on their company, …) "
                "and I'll update it."
            ),
        }

    # Company fields shown on contact detail (industry, domain, company name, …)
    company_patch = parse_company_field_update(text)
    company_field_pending = company_field_change_without_value(text)
    if company_patch or company_field_pending:
        company_id = None
        if open_company and open_company.get("id"):
            company_id = str(open_company["id"])
        elif open_contact and open_contact.get("companyId"):
            company_id = str(open_contact["companyId"])
        if not company_id and entity_id and surface == "detail":
            return {
                "ok": True,
                "assistantText": (
                    "This contact isn't linked to a company yet — industry and "
                    "domain live on the company. Link a company first, or tell me "
                    "which company to update."
                ),
            }
        if company_id:
            if company_patch:
                return _apply_company_field_update(company_id, company_patch)
            if company_field_pending:
                return _ask_company_field_value(company_field_pending, open_company)
        if company_patch:
            return {
                "ok": True,
                "assistantText": (
                    "Which company should we update? Share the company name."
                ),
            }

    # "update this" / "update this alone" after a field was discussed — apply to hint
    if _wants_edit(lower) and not extract_edit_query(text) and not entity_id:
        pending_field = parse_pending_contact_field_offer(_last_assistant(messages))
        if not pending_field:
            # Prior user turn may have been the field ("city as Namakkal")
            for m in reversed((messages or [])[:-1][-6:]):
                if m.get("role") != "user":
                    continue
                pending_field = parse_contact_field_update(str(m.get("text") or ""))
                if pending_field:
                    break
        target = _resolve_update_target(text, ctx, catalog, messages)
        if pending_field and target and target.get("id"):
            return _open_and_apply_field_update(target, pending_field)
        if target and target.get("id") and _refers_to_open_contact(text):
            name = str(target.get("displayName") or "this contact")
            return {
                "ok": True,
                "assistantText": (
                    f"What should we change for **{name}** — title, email, phone, "
                    "address, city, country, or notes?"
                ),
                "toolProposals": [
                    {
                        "id": "ws-detail-hint",
                        "name": "set_workspace",
                        "label": f"Open {name}",
                        "args": {
                            "mode": "detail",
                            "entityId": str(target["id"]),
                            "auto": True,
                        },
                        "risk": "low",
                    }
                ],
                "sessionMemoryPatch": {
                    "slots": {"contactId": str(target["id"])},
                    "lastEntities": {"contactId": str(target["id"])},
                },
            }

    # "add a phone" / "change the title" with no value — ask for that field on open contact
    contact_field_pending = contact_field_change_without_value(text)
    if contact_field_pending and open_in_memory and entity_id:
        labels = {
            "phone": "phone number",
            "email": "email",
            "title": "job title",
            "addressLine": "address",
            "city": "city",
            "country": "country",
            "notes": "notes",
        }
        label = labels.get(contact_field_pending, contact_field_pending)
        name = str((open_contact or {}).get("displayName") or "them")
        return {
            "ok": True,
            "assistantText": f"Sure — what's the {label} for **{name}**?",
        }

    # Detail workspace: apply field changes conversationally from chat
    if open_in_memory and entity_id:
        # Confirm a field change the model asked about (e.g. "set Country to India?")
        pending_field_offer = parse_pending_contact_field_offer(_last_assistant(messages))
        if pending_field_offer and looks_like_decline(text):
            return {
                "ok": True,
                "assistantText": "No problem — I'll leave that as is. Anything else?",
            }
        if pending_field_offer and _looks_like_simple_yes(text):
            return _apply_field_update(str(entity_id), pending_field_offer)
        if _wants_edit(lower) and not extract_edit_query(text):
            name = str((open_contact or {}).get("displayName") or "this contact")
            return {
                "ok": True,
                "assistantText": (
                    f"What should we change for **{name}** — title, email, phone, "
                    "address, city, country, notes, or their company's industry/"
                    'domain? For example: "title Developer" or "industry SaaS".'
                ),
            }

    # Edit / update — memory owns who when open and no other name given
    if _wants_edit(lower):
        q = extract_edit_query(text)
        if open_in_memory and entity_id and not q:
            name = str((open_contact or {}).get("displayName") or "this contact")
            return {
                "ok": True,
                "assistantText": (
                    f"What should we change for **{name}** — title, email, phone, "
                    "address, city, country, notes, or their company's industry/"
                    'domain? For example: "title Developer" or "industry SaaS".'
                ),
            }
        if q:
            return _find_or_search_contact(q, catalog)
        # "update this" / bare update — use chat hint when no open record
        hinted = _resolve_update_target(text, ctx, catalog, messages)
        if hinted and hinted.get("id"):
            return _open_contact_result(
                hinted, query=str(hinted.get("displayName") or "contact")
            )
        return _ask_which_contact()

    contact_create = _wants_create(lower) and (
        bool(re.search(r"\b(contact|lead|person|people)\b", lower))
        or not bool(
            re.search(
                r"\b(deal|compan|product|invoice|quote|activit|propos)\b", lower
            )
        )
    )
    if contact_create:
        if surface == "create":
            return None  # fall through to draft fill
        return open_in_shell_create(
            text,
            label="Create contact",
            first_question=CONTACT_FIRST_NAME_Q,
        )

    open_q = extract_open_query(text)
    if open_q and entity_id and re.search(r"this|current|them|him|her", open_q, re.I):
        return {
            "ok": True,
            "assistantText": "Keeping this contact open on the right.",
            "toolProposals": [
                {
                    "id": "ws-detail",
                    "name": "set_workspace",
                    "label": "Open contact",
                    "args": {"mode": "detail", "entityId": entity_id, "auto": True},
                    "risk": "low",
                }
            ],
        }
    if open_q and not re.search(r"create|add|new", lower):
        return _find_or_search_contact(open_q, catalog)

    if _is_help_question(lower) or re.search(r"^\s*help\b", lower):
        return {
            "ok": True,
            "assistantText": (
                "I can add someone new, import a CSV, find or update a person, or "
                "take you back to the list — just tell me what you need in plain language."
            ),
        }

    return None


async def handle(state: ContactCoworkerState) -> ContactCoworkerState:
    messages = state.get("messages") or []
    text = _last_user(messages)
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    if not text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to work with the agent."},
        }

    from app.agent_log import fmt, logger, tool_names
    from app.agents.coworker_shared import (
        actions_without_speech,
        is_generic_coworker_speech,
        should_commit_native_turn,
        strip_internal_workspace_sentences,
    )
    from app.agents.crm_tools import run_native_agent_turn
    from app.llm import is_ai_configured

    surface = str(ctx.get("surface") or "list")

    # Offline-only routing when LLM is down (happy path is native tool loop + LLM speech).
    if not is_ai_configured():
        from app.agents.coworker_shared import llm_unavailable_result

        return {
            **state,
            "result": llm_unavailable_result("llm_unavailable"),
        }

    from app.agents.deal_coworker_agent import resolve_proposal_not_quote_turn

    handoff = resolve_proposal_not_quote_turn(
        user_text=text,
        mod=str(ctx.get("module") or "contact"),
        pathname=str(ctx.get("pathname") or ""),
        catalog=catalog,
    )
    if handoff:
        return {**state, "result": handoff}

    native = await run_native_agent_turn(
        mod="contact",
        surface=surface,
        messages=messages,
        context=ctx,
        catalog=catalog,
        user_text=text,
    )
    if should_commit_native_turn(native, user_text=text):
        logger.info(
            fmt(
                agent="contact-coworker",
                step="native",
                surface=surface,
                speech=(native or {}).get("assistantText"),
                tools=tool_names(native if isinstance(native, dict) else None),
            )
        )
        return {**state, "result": {**native, "source": "ai"}}

    return {
        **state,
        "result": {"ok": True, "assistantText": "", "_unhandled": True},
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
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
        }
    )
    return result.get("result") or {"ok": False, "error": "Contact co-worker failed."}
