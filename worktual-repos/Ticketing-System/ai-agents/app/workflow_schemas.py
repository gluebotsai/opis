"""
First-class workflow schemas for schema-aware Gemma NLU + LangGraph progression.

Only schemas + tool allowlists differ per module; the loop is identical:
  extract → store → missing? → ask | tool → update state → respond
"""

from __future__ import annotations

import re
import uuid
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any

_EMAIL_RE = re.compile(r"^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$")
_PHONE_DIGIT_RE = re.compile(r"\d")
_PRIORITY_LEVELS = frozenset({"urgent", "high", "medium", "low"})
_CREATE_TEAM_COMMAND_RE = re.compile(
    r"^\s*(please\s+)?((let'?s|can you|could you)\s+)?"
    r"(create|add|make|start|open|new)\b.{0,40}\b(team|queue)s?\b",
    re.IGNORECASE,
)
_CREATE_TEAM_COMMAND_EXACT = frozenset(
    {
        "create a new team",
        "create new team",
        "create a team",
        "create team",
        "new team",
        "add a team",
        "add team",
        "create a new queue",
        "create queue",
        "new queue",
    }
)


def looks_like_create_team_command(text: str | None) -> bool:
    """True when the utterance is a create-team *command*, not a team name."""
    raw = (text or "").strip().rstrip("!?.")
    if not raw or len(raw) > 80:
        return False
    if raw.lower() in _CREATE_TEAM_COMMAND_EXACT:
        return True
    return bool(_CREATE_TEAM_COMMAND_RE.search(raw))


_CREATE_TICKET_COMMAND_RE = re.compile(
    r"^\s*(please\s+)?((let'?s|can you|could you)\s+)?"
    r"(create|file|make|start|open|new)\b.{0,40}\b(ticket|case)s?\b",
    re.IGNORECASE,
)
_CREATE_TICKET_COMMAND_EXACT = frozenset(
    {
        "create ticket",
        "create a ticket",
        "create a new ticket",
        "create new ticket",
        "new ticket",
        "file a ticket",
        "file ticket",
        "open a ticket",
        "make a ticket",
        "start a ticket",
    }
)


def looks_like_create_ticket_command(text: str | None) -> bool:
    """True when the utterance is a create-ticket *command*, not a customer name."""
    raw = (text or "").strip().rstrip("!?.")
    if not raw or len(raw) > 80:
        return False
    if raw.lower() in _CREATE_TICKET_COMMAND_EXACT:
        return True
    return bool(_CREATE_TICKET_COMMAND_RE.search(raw))


_CREATE_CUSTOMER_COMMAND_RE = re.compile(
    r"^\s*(please\s+)?((let'?s|can you|could you)\s+)?"
    r"(create|add|make|start|open|new|register)\b(?!\s+(a\s+)?note).{0,40}\bcustomers?\b",
    re.IGNORECASE,
)
_CREATE_CUSTOMER_COMMAND_EXACT = frozenset(
    {
        "add customer",
        "add customers",
        "add a customer",
        "add new customer",
        "add a new customer",
        "create customer",
        "create a customer",
        "create a new customer",
        "create new customer",
        "new customer",
        "register customer",
        "register a customer",
    }
)


def looks_like_create_customer_command(text: str | None) -> bool:
    """True when the utterance is an add-customer *command*, not a person name."""
    raw = (text or "").strip().rstrip("!?.")
    if not raw or len(raw) > 80:
        return False
    if raw.lower() in _CREATE_CUSTOMER_COMMAND_EXACT:
        return True
    return bool(_CREATE_CUSTOMER_COMMAND_RE.search(raw))


_CREATE_PRIORITY_COMMAND_EXACT = frozenset(
    {
        "create priority",
        "create a priority",
        "create a new priority",
        "create new priority",
        "new priority",
        "add priority",
        "add a priority",
        "add a new priority",
        "set priority",
        "set a priority",
        "set the priority",
        "set the new priority",
        "set a new priority",
        "i want to set the new priority",
        "i want to create a priority",
        "i want to create a new priority",
        "i want to add a priority",
        "make a priority",
        "make a new priority",
    }
)
_CREATE_STATUS_COMMAND_EXACT = frozenset(
    {
        "create status",
        "create a status",
        "create a new status",
        "create new status",
        "new status",
        "add status",
        "add a status",
        "add a new status",
        "set status",
        "set a status",
        "set the new status",
        "i want to create a status",
        "i want to add a status",
    }
)
_PLACEHOLDER_PRIORITY_LABELS = frozenset(
    {
        "priority",
        "new priority",
        "priority level",
        "status",
        "new status",
        "untitled",
    }
)


def looks_like_create_priority_command(text: str | None) -> bool:
    """Exact start-phrase safety net only. Named labels are LLM + patch_priority_draft."""
    raw = (text or "").strip().rstrip("!?.")
    if not raw or len(raw) > 100:
        return False
    low = raw.lower()
    return low in _CREATE_PRIORITY_COMMAND_EXACT or low in _PLACEHOLDER_PRIORITY_LABELS


def looks_like_create_status_command(text: str | None) -> bool:
    """Exact start-phrase safety net only. Named labels are LLM + patch_status_draft."""
    raw = (text or "").strip().rstrip("!?.")
    if not raw or len(raw) > 100:
        return False
    low = raw.lower()
    return low in _CREATE_STATUS_COMMAND_EXACT or low in {"status", "new status"}


def display_name_from_create_priority_utterance(text: str | None) -> str | None:
    """Deprecated: never regex-extract a label. Specialist LLM + patch_priority_draft."""
    del text
    return None


def display_name_from_create_status_utterance(text: str | None) -> str | None:
    """Deprecated: never regex-extract a label. Specialist LLM + patch_status_draft."""
    del text
    return None


_CREATE_KB_COMMAND_EXACT = frozenset(
    {
        "create article",
        "create an article",
        "create a article",
        "create a new article",
        "create new article",
        "new article",
        "create kb",
        "create kb article",
        "create a kb article",
        "create a new kb article",
        "create knowledge base article",
        "create a knowledge base article",
        "new kb article",
        "new kb",
        "write article",
        "write an article",
        "write a new article",
        "add article",
        "add an article",
        "add a article",
        "publish article",
        "publish an article",
    }
)
_CREATE_MACRO_COMMAND_EXACT = frozenset(
    {
        "create macro",
        "create macros",
        "create a macro",
        "create a macros",
        "create a new macro",
        "create new macro",
        "new macro",
        "new macros",
        "add macro",
        "add macros",
        "add a macro",
        "write macro",
        "write a macro",
    }
)
_PLACEHOLDER_CATALOG_TITLES = frozenset(
    {
        "new article",
        "article",
        "untitled",
        "untitled article",
        "kb article",
        "knowledge base article",
        "new kb",
        "new kb article",
        "create article",
        "new macro",
        "new macros",
        "macro",
        "macros",
        "untitled macro",
        "create macro",
        "create macros",
    }
)


def is_placeholder_catalog_title(text: str | None) -> bool:
    """True for invented/shell titles like 'New Article' — not a user-supplied name."""
    raw = (text or "").strip().rstrip("!?.")
    return bool(raw) and raw.lower() in _PLACEHOLDER_CATALOG_TITLES


def looks_like_create_kb_command(text: str | None) -> bool:
    """Exact start-phrase safety net only. Titled extract is LLM + patch_kb_draft."""
    raw = (text or "").strip().rstrip("!?.")
    if not raw or len(raw) > 160:
        return False
    return raw.lower() in _CREATE_KB_COMMAND_EXACT


def utterance_is_kb_create_start(text: str | None) -> bool:
    """True when this utterance is a create-article start sentence (not a title)."""
    return _starts_with_exact_phrase(text, _CREATE_KB_COMMAND_EXACT)


def title_from_create_kb_utterance(text: str | None) -> str | None:
    """Deprecated: never regex-extract a title. Specialist LLM + patch_kb_draft."""
    del text
    return None


def looks_like_create_macro_command(text: str | None) -> bool:
    """True when the utterance is a create-macro *command*, not a macro title.

    Safety net only — primary start handling stamps `_intent_start_text` from
    Super/Domain start so plurals/typos never need an exact map.
    """
    raw = (text or "").strip().rstrip("!?.")
    if not raw or len(raw) > 80:
        return False
    return raw.lower() in _CREATE_MACRO_COMMAND_EXACT


def _norm_intent_utterance(text: str | None) -> str:
    return (text or "").strip().rstrip("!?. ").lower()


def _starts_with_exact_phrase(text: str | None, phrases: frozenset[str]) -> bool:
    """True when the utterance is an exact start phrase or that phrase plus more.

    Does not extract leftover slots. Specialist LLM + patch_*_draft owns titled/named.
    """
    low = _norm_intent_utterance(text)
    if not low:
        return False
    for phrase in phrases:
        if low == phrase or low.startswith(phrase + " "):
            return True
    return False


def mark_macro_intent_start(
    draft: dict[str, Any] | None, text: str | None
) -> dict[str, Any]:
    """Record the start-flow utterance; never treat it as title/body."""
    out = dict(draft or {})
    start = str(text or "").strip()
    if start:
        out["_intent_start_text"] = start
    out.pop("title", None)
    out.pop("name", None)
    # Body must not be pre-filled from the start phrase.
    if _norm_intent_utterance(out.get("body")) == _norm_intent_utterance(start):
        out.pop("body", None)
        out.pop("content", None)
        out.pop("reply", None)
    out["awaiting"] = "title"
    out["step"] = "title"
    return out


def mark_kb_intent_start(
    draft: dict[str, Any] | None, text: str | None
) -> dict[str, Any]:
    """Record the start-flow utterance; never treat it as title/category/body."""
    out = dict(draft or {})
    start = str(text or "").strip()
    if start:
        out["_intent_start_text"] = start
    out.pop("title", None)
    out.pop("name", None)
    out.pop("category", None)
    if _norm_intent_utterance(out.get("body")) == _norm_intent_utterance(start):
        out.pop("body", None)
        out.pop("content", None)
    out["awaiting"] = "title"
    out["step"] = "title"
    return out


def usable_macro_title(
    text: str | None, *, start_utterance: str | None = None
) -> str:
    """Real macro title, or '' when this is the start-intent utterance / placeholder."""
    raw = (text or "").strip()
    if not raw or len(raw) < 2:
        return ""
    if is_placeholder_catalog_title(raw):
        return ""
    if start_utterance and _norm_intent_utterance(raw) == _norm_intent_utterance(
        start_utterance
    ):
        return ""
    if looks_like_create_macro_command(raw):
        return ""
    if _starts_with_exact_phrase(raw, _CREATE_MACRO_COMMAND_EXACT):
        return ""
    return raw


def sanitize_macro_draft_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Drop start-intent / placeholder titles; keep collect order title → body → confirm."""
    draft = dict(raw or {})
    start = str(draft.get("_intent_start_text") or "").strip()
    title = usable_macro_title(
        str(draft.get("title") or draft.get("name") or "").strip(),
        start_utterance=start,
    )
    if title:
        draft["title"] = title
    else:
        draft.pop("title", None)
        draft.pop("name", None)
        awaiting = str(draft.get("awaiting") or "").strip().lower()
        if awaiting in {"body", "confirm", ""}:
            draft["awaiting"] = "title"
            draft["step"] = "title"
    # Never keep body equal to the start-intent phrase or the title.
    # Domain/LLM often copies the title utterance into body on the title turn.
    body = str(draft.get("body") or draft.get("content") or "").strip()
    body_is_start = bool(
        body and start and _norm_intent_utterance(body) == _norm_intent_utterance(start)
    )
    body_is_title = bool(
        body and title and _norm_intent_utterance(body) == _norm_intent_utterance(title)
    )
    if body_is_start or body_is_title:
        draft.pop("body", None)
        draft.pop("content", None)
        draft.pop("reply", None)
        awaiting = str(draft.get("awaiting") or "").strip().lower()
        if awaiting in {"confirm", ""}:
            draft["awaiting"] = "body" if title else "title"
            draft["step"] = draft["awaiting"]
    return draft


def _catalog_label_kind(raw: dict[str, Any] | None, fallback: str = "priority") -> str:
    kind = str((raw or {}).get("kind") or fallback or "priority").strip().lower()
    return kind if kind in {"priority", "status"} else "priority"


def mark_catalog_label_intent_start(
    draft: dict[str, Any] | None,
    text: str | None,
    *,
    kind: str = "priority",
) -> dict[str, Any]:
    """Record the start-flow utterance; never treat it as the catalog label."""
    out = dict(draft or {})
    start = str(text or "").strip()
    label_kind = kind if kind in {"priority", "status"} else "priority"
    if start:
        out["_intent_start_text"] = start
    out.pop("displayName", None)
    out.pop("name", None)
    out.pop("label", None)
    if label_kind != "status":
        out.pop("resolutionHours", None)
        out.pop("hours", None)
    out["awaiting"] = "name"
    out["step"] = "name"
    out["kind"] = label_kind
    return out


def mark_priority_intent_start(
    draft: dict[str, Any] | None, text: str | None
) -> dict[str, Any]:
    return mark_catalog_label_intent_start(draft, text, kind="priority")


def mark_status_intent_start(
    draft: dict[str, Any] | None, text: str | None
) -> dict[str, Any]:
    return mark_catalog_label_intent_start(draft, text, kind="status")


def usable_catalog_label(
    text: str | None,
    *,
    start_utterance: str | None = None,
    kind: str = "priority",
) -> str:
    """Real short catalog label, or '' when this is the start-intent utterance."""
    raw = (text or "").strip()
    if not raw or len(raw) < 2:
        return ""
    if raw.lower() in _PLACEHOLDER_PRIORITY_LABELS:
        return ""
    if start_utterance and _norm_intent_utterance(raw) == _norm_intent_utterance(
        start_utterance
    ):
        return ""
    phrases = (
        _CREATE_STATUS_COMMAND_EXACT
        if kind == "status"
        else _CREATE_PRIORITY_COMMAND_EXACT
    )
    if _starts_with_exact_phrase(raw, phrases):
        return ""
    # Length/token cap only — create vs label vs hours is LLM + active slot type.
    if len(raw) > 48 or len(raw.split()) > 3:
        return ""
    return raw


def usable_priority_label(
    text: str | None, *, start_utterance: str | None = None
) -> str:
    return usable_catalog_label(
        text, start_utterance=start_utterance, kind="priority"
    )


def usable_status_label(
    text: str | None, *, start_utterance: str | None = None
) -> str:
    return usable_catalog_label(text, start_utterance=start_utterance, kind="status")


def sanitize_priority_draft_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Drop start-intent / placeholder labels; keep collect order name → hours."""
    draft = dict(raw or {})
    start = str(draft.get("_intent_start_text") or "").strip()
    kind = _catalog_label_kind(draft)
    label = usable_catalog_label(
        str(
            draft.get("displayName") or draft.get("name") or draft.get("label") or ""
        ).strip(),
        start_utterance=start,
        kind=kind,
    )
    if label:
        draft["displayName"] = label
    else:
        draft.pop("displayName", None)
        draft.pop("name", None)
        draft.pop("label", None)
        awaiting = str(draft.get("awaiting") or "").strip().lower()
        if awaiting in {"hours", "confirm", ""}:
            draft["awaiting"] = "name"
            draft["step"] = "name"
            if kind != "status":
                draft.pop("resolutionHours", None)
                draft.pop("hours", None)
    if start:
        draft["_intent_start_text"] = start
    return draft


def usable_kb_title(
    text: str | None, *, start_utterance: str | None = None
) -> str:
    """Real article title, or '' when this is the start-intent utterance / placeholder."""
    raw = (text or "").strip()
    if not raw or len(raw) < 2:
        return ""
    if is_placeholder_catalog_title(raw):
        return ""
    if start_utterance and _norm_intent_utterance(raw) == _norm_intent_utterance(
        start_utterance
    ):
        return ""
    if looks_like_create_kb_command(raw):
        return ""
    if _starts_with_exact_phrase(raw, _CREATE_KB_COMMAND_EXACT):
        return ""
    return raw


def sanitize_kb_draft_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Drop start-intent / invented titles; keep collect order title → category → body."""
    draft = dict(raw or {})
    start = str(draft.get("_intent_start_text") or "").strip()
    title = usable_kb_title(
        str(draft.get("title") or draft.get("name") or "").strip(),
        start_utterance=start,
    )
    if title:
        draft["title"] = title
    else:
        draft.pop("title", None)
        draft.pop("name", None)
        # Don't keep a category if title was never collected — that skips the ask.
        draft.pop("category", None)
        awaiting = str(draft.get("awaiting") or "").strip().lower()
        if awaiting in {"category", "body", "confirm", ""}:
            draft["awaiting"] = "title"
            draft["step"] = "title"
    if start:
        draft["_intent_start_text"] = start
    return draft


def wants_add_missing_customer(text: str | None) -> bool:
    """Deprecated: add-customer after CDP miss is LLM-owned (route_to_agent / tools).

    Never keyword-match affirmations. Always False so native path does not
    invent add-customer intent from yes/ok/add phrases.
    """
    del text
    return False


_IMPORT_CUSTOMERS_RE = None  # intent is LLM-owned; do not regex-match import utterances


def looks_like_import_customers_command(text: str | None) -> bool:
    """Deprecated: import vs create is LLM-owned. Always False (no regex gate)."""
    del text
    return False


def redirect_import_customers_to_create(
    decision: dict[str, Any] | None,
    user_text: str | None,
) -> dict[str, Any]:
    """Trust the LLM/NLU operation. Do not rewrite IMPORT↔CREATE via phrase lists."""
    del user_text
    return dict(decision) if isinstance(decision, dict) else {}


_TICKET_AWAITING = {
    "name": "customerName",
    "customername": "customerName",
    "contact": "contact",
    "issue": "issue",
    "priority": "priority",
    "confirm": None,
}

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

CREATE_TICKET_SCHEMA: dict[str, Any] = {
    "id": "create_ticket",
    "label": "Create Ticket",
    # Chat collects customer + issue only. Subject / priority / description are
    # produced by Express enrich_ticket (same path as the Create Ticket form).
    "required": ["customerName", "contact", "issue"],
    "optional": [
        "customerEmail",
        "customerPhone",
        "subject",
        "customerId",
        "priority",
    ],
    "defaults": {"priority": None},
    "field_labels": {
        "customerName": "customer full name",
        "contact": "email address or phone number",
        "customerEmail": "email address",
        "customerPhone": "phone number",
        "issue": "short description of the customer issue",
        "priority": "priority (urgent, high, medium, or low)",
        "subject": "ticket subject",
    },
    "slot_types": {
        "customerName": "person_name",
        "contact": "contact",
        "customerEmail": "email",
        "customerPhone": "phone",
        "issue": "issue_text",
        "priority": "ticket_priority",
        "subject": "short_text",
    },
    "tool": "create_ticket",
}

CREATE_TEAM_SCHEMA: dict[str, Any] = {
    "id": "create_team",
    "label": "Create Team",
    # Chat matches product rule: name + description + at least one member required.
    "required": ["name", "description", "members"],
    "optional": [],
    "field_labels": {
        "name": "team name",
        "description": "short team description (used to route tickets)",
        "members": "staff names to add (at least one — teams cannot be empty)",
    },
    "slot_types": {
        "name": "team_name",
        "description": "long_text",
        "members": "member_list",
    },
    "tool": "create_queue",
}

ADD_TEAM_MEMBERS_SCHEMA: dict[str, Any] = {
    "id": "add_team_members",
    "label": "Add Team Members",
    "required": ["team", "members"],
    "optional": ["id"],
    "field_labels": {
        "team": "team name to update",
        "members": "staff names to add",
    },
    "slot_types": {"team": "team_name", "members": "member_list"},
    "tool": "update_queue",
}

CREATE_MACRO_SCHEMA: dict[str, Any] = {
    "id": "create_macro",
    "label": "Create Macro",
    "required": ["title", "body"],
    "optional": [],
    "field_labels": {
        "title": "macro title",
        "body": "macro reply body",
    },
    "slot_types": {"title": "short_text", "body": "long_text"},
    "tool": "create_macro",
}

CREATE_KB_SCHEMA: dict[str, Any] = {
    "id": "create_kb",
    "label": "Create KB Article",
    "required": ["title", "category", "body"],
    "optional": [],
    "field_labels": {
        "title": "article title",
        "category": "article category name",
        "body": "article content",
    },
    "slot_types": {
        "title": "short_text",
        "category": "category",
        "body": "long_text",
    },
    "tool": "create_kb_article",
}

MANAGE_KB_CATEGORY_SCHEMA: dict[str, Any] = {
    "id": "manage_kb_category",
    "label": "Manage KB Categories",
    "required": ["mode", "name"],
    "optional": [],
    "field_labels": {
        "mode": "add, edit, or delete",
        "name": "category name",
    },
    "slot_types": {
        "mode": "short_text",
        "name": "short_text",
    },
    "tool": "manage_kb_category",
}

ESCALATE_SCHEMA: dict[str, Any] = {
    "id": "escalate",
    "label": "Escalate Ticket",
    "required": ["ticket_number", "assignee"],
    "optional": ["note"],
    "field_labels": {
        "ticket_number": "ticket number to escalate",
        "assignee": "assignee or best resolver",
        "note": "optional note",
    },
    "slot_types": {
        "ticket_number": "ticket_ref",
        "assignee": "person_name",
        "note": "long_text",
    },
    "tool": "escalate_ticket",
}

# Workflow id `reassign_ticket` is the guided-flow name only. At confirm,
# write_tool_for_draft maps reassign_draft → update_ticket (agent) or
# escalate_ticket (resolver). There is no Express tool named reassign_ticket.
REASSIGN_SCHEMA: dict[str, Any] = {
    "id": "reassign_ticket",
    "label": "Reassign Ticket",
    "required": ["ticket_number", "target_role", "person"],
    "optional": ["note"],
    "field_labels": {
        "ticket_number": "ticket number to reassign",
        "target_role": "agent or resolver",
        "person": "teammate name",
        "note": "optional note",
    },
    "slot_types": {
        "ticket_number": "ticket_ref",
        "target_role": "enum:agent|resolver",
        "person": "person_name",
        "note": "long_text",
    },
    "tool": "reassign_ticket",
}

CREATE_PRIORITY_SCHEMA: dict[str, Any] = {
    "id": "create_priority",
    "label": "Create Priority",
    "required": ["displayName", "resolutionHours"],
    "optional": [],
    "field_labels": {
        "displayName": "priority display name",
        "resolutionHours": "resolution hours (SLA)",
    },
    "slot_types": {
        "displayName": "catalog_label",
        "resolutionHours": "positive_number",
    },
    "tool": "create_priority",
}

CREATE_STATUS_SCHEMA: dict[str, Any] = {
    "id": "create_status",
    "label": "Create Status",
    "required": ["displayName"],
    "optional": [],
    "field_labels": {"displayName": "status display name"},
    "slot_types": {"displayName": "catalog_label"},
    "tool": "create_status",
}

CREATE_CUSTOMER_SCHEMA: dict[str, Any] = {
    "id": "create_customer",
    "label": "Add Customer",
    # Matches the Add customer form fields collected in chat: name, email, phone.
    "required": ["name", "email", "phone"],
    "optional": ["accountName"],
    "field_labels": {
        "name": "customer full name",
        "email": "email address",
        "phone": "phone number",
        "accountName": "account or company",
    },
    "slot_types": {
        "name": "person_name",
        "email": "email",
        "phone": "phone",
    },
    "tool": "create_customer",
}

_SCHEMAS: dict[str, dict[str, Any]] = {
    "create_ticket": CREATE_TICKET_SCHEMA,
    "ticket": CREATE_TICKET_SCHEMA,
    "create_team": CREATE_TEAM_SCHEMA,
    "team": CREATE_TEAM_SCHEMA,
    "add_team_members": ADD_TEAM_MEMBERS_SCHEMA,
    "add_members": ADD_TEAM_MEMBERS_SCHEMA,
    "create_macro": CREATE_MACRO_SCHEMA,
    "macro": CREATE_MACRO_SCHEMA,
    "create_kb": CREATE_KB_SCHEMA,
    "kb": CREATE_KB_SCHEMA,
    "manage_kb_category": MANAGE_KB_CATEGORY_SCHEMA,
    "manage_category": MANAGE_KB_CATEGORY_SCHEMA,
    "escalate": ESCALATE_SCHEMA,
    "reassign_ticket": REASSIGN_SCHEMA,
    "reassign": REASSIGN_SCHEMA,
    "create_priority": CREATE_PRIORITY_SCHEMA,
    "priority": CREATE_PRIORITY_SCHEMA,
    "create_status": CREATE_STATUS_SCHEMA,
    "status": CREATE_STATUS_SCHEMA,
    "create_customer": CREATE_CUSTOMER_SCHEMA,
    "customer": CREATE_CUSTOMER_SCHEMA,
}


def schema_for_workflow(workflow_id: str | None) -> dict[str, Any] | None:
    wid = (workflow_id or "").strip().lower()
    return _SCHEMAS.get(wid)


_TASK_ALIASES: dict[str, tuple[str, ...]] = {
    "ticket-create": (
        "create_ticket",
        "ticket.create.interactive",
        "ticket.create.structured",
        "tk.ticket.create",
    ),
    "team-create": ("create_team", "tk.team.create"),
    "team-members-update": ("add_team_members", "tk.team.members.add"),
    "customer-create": ("create_customer", "tk.customer.create"),
    "knowledge-article-create": ("create_kb", "tk.kb.article.create"),
    "macro-create": ("create_macro", "tk.macro.create"),
    "priority-create": ("create_priority", "tk.catalog.priority.create"),
    "status-create": ("create_status", "tk.catalog.status.create"),
    "ticket-escalate": ("escalate", "tk.ticket.escalate"),
    "ticket-reassign": ("reassign_ticket", "tk.ticket.assign.resolve"),
}
_TASK_CHANNELS: dict[str, tuple[str, ...]] = {
    "ticket-create": (
        "staff_chat",
        "portal_authenticated",
        "staff_form",
        "portal_form",
        "webchat",
        "email",
        "public_api",
        "widget",
        "a2a",
    )
}


def _task_input_schema(
    workflow_schema: dict[str, Any] | None,
    *,
    tool_names: list[str],
) -> dict[str, Any]:
    from app.mcp.catalog import catalog_by_name

    catalog = catalog_by_name()
    target_name = str((workflow_schema or {}).get("tool") or "")
    if target_name not in catalog:
        mutations = [
            name
            for name in tool_names
            if name in catalog and catalog[name].kind == "mutation"
        ]
        target_name = mutations[-1] if mutations else (tool_names[0] if tool_names else "")
    base = dict(catalog[target_name].input_schema) if target_name in catalog else {
        "type": "object",
        "properties": {},
    }
    properties = dict(base.get("properties") or {})
    if workflow_schema:
        slot_types = workflow_schema.get("slot_types") or {}
        for field in [
            *(workflow_schema.get("required") or []),
            *(workflow_schema.get("optional") or []),
        ]:
            if field in properties:
                continue
            slot_type = str(slot_types.get(field) or "")
            json_type = "array" if slot_type == "member_list" else "string"
            properties[field] = {"type": json_type}
        base["required"] = list(workflow_schema.get("required") or [])
    base["type"] = "object"
    base["properties"] = properties
    return base


@lru_cache
def harness_task_definitions() -> dict[str, "TaskDefinition"]:
    """Compile canonical task bindings from Skill metadata and workflow schemas."""
    from app.contracts.execution import TaskDefinition
    from app.skills.catalog import discover_skills
    from app.tools.registry import TOOL_META

    tasks: dict[str, TaskDefinition] = {}
    aliases_seen: dict[str, str] = {}
    for skill in discover_skills().values():
        schema = schema_for_workflow(skill.schema_ref)
        required = list((schema or {}).get("required") or [])
        optional = list((schema or {}).get("optional") or [])
        write = any(
            bool((TOOL_META.get(tool) or {}).get("confirm"))
            or bool((TOOL_META.get(tool) or {}).get("destructive"))
            for tool in skill.allowed_tools
        )
        for task_id in skill.task_ids:
            if task_id in tasks:
                raise ValueError(f"duplicate Harness task id: {task_id}")
            aliases = list(_TASK_ALIASES.get(skill.name, ()))
            for alias in aliases:
                owner = aliases_seen.setdefault(alias, task_id)
                if owner != task_id:
                    raise ValueError(f"duplicate Harness task alias: {alias}")
            if len(skill.eligible_executors) != 1:
                raise ValueError(
                    f"task Skill must have one owning Executor: {skill.name}"
                )
            tasks[task_id] = TaskDefinition(
                id=task_id,
                version=skill.version,
                domain=skill.domain,
                executor=skill.eligible_executors[0],
                skill_name=skill.name,
                schema_ref=skill.schema_ref,
                input_schema=_task_input_schema(
                    schema,
                    tool_names=list(skill.allowed_tools),
                ),
                tool_names=list(skill.allowed_tools),
                required=required,
                optional=optional,
                channels=list(_TASK_CHANNELS.get(skill.name, ())),
                aliases=aliases,
                approval_mode=skill.approval_policy,
                idempotency_required=write,
                active=skill.active,
            )
    return tasks


def task_definition_for(task_or_alias: str | None) -> "TaskDefinition | None":
    key = str(task_or_alias or "").strip()
    if not key:
        return None
    tasks = harness_task_definitions()
    if key in tasks:
        return tasks[key]
    for task in tasks.values():
        if key in task.aliases:
            return task
    return None


# Schema ``tool`` → actual MCP write names that count as the task's primary mutation.
_PRIMARY_WRITE_TOOL_ALIASES: dict[str, frozenset[str]] = {
    "create_ticket": frozenset({"create_ticket", "portal_create_ticket"}),
    "reassign_ticket": frozenset({"update_ticket", "escalate_ticket"}),
}


def primary_write_tool_for_task(task_or_alias: str | None) -> str | None:
    """Return the schema-declared primary write tool for a Harness task, if any."""
    task = task_definition_for(task_or_alias)
    if not task or not task.schema_ref:
        return None
    schema = schema_for_workflow(task.schema_ref)
    tool = str((schema or {}).get("tool") or "").strip()
    return tool or None


def is_primary_task_mutation(task_or_alias: str | None, tool_name: str | None) -> bool:
    """True when this tool is the task's primary write (not a helper mutation).

    Under ticket.create, create_customer is not primary (CDP miss hands off to
    catalog customer.create). After handoff, create_customer is primary for
    customer.create and uses that task's confirmation evidence.
    """
    tool = str(tool_name or "").strip().lower()
    if not tool:
        return False
    primary = primary_write_tool_for_task(task_or_alias)
    if not primary:
        # Unknown / no schema tool — treat every mutation as primary (fail closed).
        return True
    aliases = _PRIMARY_WRITE_TOOL_ALIASES.get(primary, frozenset({primary}))
    return tool == primary or tool in aliases


def new_harness_task_state(
    task_or_alias: str,
    *,
    channel: str | None = None,
    collected: dict[str, Any] | None = None,
    provenance: dict[str, str] | None = None,
    idempotency_key: str | None = None,
) -> "TaskState":
    from app.contracts.execution import TaskState
    from app.skills.catalog import discover_skills

    task = task_definition_for(task_or_alias)
    if not task:
        raise ValueError(f"unknown Harness task: {task_or_alias}")
    skill = discover_skills()[task.skill_name]
    values = dict(collected or {})
    missing = [field for field in task.required if not values.get(field)]
    return TaskState(
        task_id=task.id,
        task_version=task.version,
        domain=task.domain,
        executor=task.executor,
        skill_name=task.skill_name,
        skill_version=skill.version,
        skill_digest=skill.content_digest,
        channel=channel,
        status="collecting" if missing else "pending",
        collected=values,
        provenance=dict(provenance or {}),
        missing_fields=missing,
        idempotency_key=(
            idempotency_key
            or (str(uuid.uuid4()) if task.idempotency_required else None)
        ),
    )


def email_looks_valid(raw: str) -> bool:
    return bool(_EMAIL_RE.match((raw or "").strip()))


def phone_looks_valid(raw: str) -> bool:
    digits = "".join(_PHONE_DIGIT_RE.findall(raw or ""))
    return len(digits) >= 7


_EMAIL_FIELD_KEYS = frozenset({"email", "customerEmail", "customer_email"})
_PHONE_FIELD_KEYS = frozenset({"phone", "customerPhone", "customer_phone"})
_ID_FIELD_KEYS = frozenset(
    {
        "customerId",
        "customer_id",
        "id",
        "queueId",
        "assigneeId",
        "resolverId",
    }
)
_SKIP_UTTERANCE_KEYS = frozenset({"enriched", "confidence", "surface"})


def _utterance_has_email(user_text: str, email: str) -> bool:
    value = (email or "").strip().lower()
    return bool(value) and value in (user_text or "").strip().lower()


def _utterance_has_phone(user_text: str, phone: str) -> bool:
    want = re.sub(r"\D", "", phone or "")
    if len(want) < 7:
        return False
    have = re.sub(r"\D", "", user_text or "")
    return bool(have) and (want in have or have in want)


def _normalize_for_match(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", " ", (value or "").lower()).strip()


def _utterance_has_value(user_text: str, value: str) -> bool:
    raw = (value or "").strip()
    text = (user_text or "").strip()
    if not raw or not text:
        return False
    if raw.lower() in text.lower():
        return True
    norm_raw = _normalize_for_match(raw)
    norm_text = _normalize_for_match(text)
    if norm_raw and norm_raw in norm_text:
        return True
    tokens = [tok for tok in norm_raw.split() if len(tok) > 1]
    if not tokens:
        return False
    text_tokens = set(norm_text.split())
    return all(tok in text_tokens for tok in tokens)


_FUZZY_ROSTER_MIN_QUERY_LEN = 3
_FUZZY_ROSTER_MIN_RATIO = 0.54


def _name_match_score(query: str, display_name: str) -> float:
    """Score how well a short user fragment matches a roster display name."""
    q = str(query or "").strip().lower()
    name = str(display_name or "").strip().lower()
    if not q or not name:
        return 0.0
    if q == name:
        return 1.0
    if q in name or name in q:
        return 0.95
    parts = [p for p in name.split() if p]
    first = parts[0] if parts else name
    scores = [
        SequenceMatcher(None, q, first).ratio(),
        SequenceMatcher(None, q, name.replace(" ", "")).ratio(),
        SequenceMatcher(None, q, name).ratio(),
    ]
    if len(q) >= _FUZZY_ROSTER_MIN_QUERY_LEN:
        if first.startswith(q) or q.startswith(first[: len(q)]):
            scores.append(0.88)
        if len(first) >= _FUZZY_ROSTER_MIN_QUERY_LEN and q.startswith(first[:3]):
            scores.append(0.82)
    return max(scores)


def _fuzzy_unique_entity(
    query: str,
    ents: list[dict[str, str]],
    *,
    min_ratio: float = _FUZZY_ROSTER_MIN_RATIO,
) -> dict[str, str] | None:
    """Unique best fuzzy hit on first/full name (typo-tolerant: rahu → Raghuram)."""
    q = str(query or "").strip()
    if len(q) < _FUZZY_ROSTER_MIN_QUERY_LEN or not ents:
        return None
    scored = sorted(
        (( _name_match_score(q, e["name"]), e) for e in ents),
        key=lambda row: row[0],
        reverse=True,
    )
    best_score, best = scored[0]
    if best_score < min_ratio:
        return None
    if len(scored) > 1:
        second_score = scored[1][0]
        if second_score >= min_ratio and (best_score - second_score) < 0.08:
            return None
    return dict(best)


def resolve_entity(
    user_input: str,
    available_entities: list[Any] | None,
    entity_type: str = "agent",
    *,
    allow_fuzzy: bool = True,
    allow_substring: bool = True,
) -> dict[str, Any] | None:
    """Resolve a short answer against a fetched list. No nickname maps.

    Returns {id, name} on a unique hit, {ambiguous: [{id,name}, ...]} on clash,
    or None if nothing matches.

    allow_fuzzy=False stops before SequenceMatcher (reassign/escalate interpret
    step). Default True keeps create-team / add-members / auto-assign behavior.
    allow_substring=False skips containment matches (avoids rahu→Rahul when
    Raghuram is also plausible).
    """
    q = str(user_input or "").strip()
    ents: list[dict[str, str]] = []
    for raw in available_entities or []:
        if isinstance(raw, dict):
            name = str(raw.get("name") or raw.get("label") or "").strip()
            eid = str(raw.get("id") or "").strip()
        else:
            name = str(raw or "").strip()
            eid = ""
        if name:
            ents.append({"id": eid, "name": name})
    if not q or not ents:
        return None
    ordinals = {
        "first": 1,
        "1": 1,
        "one": 1,
        "second": 2,
        "2": 2,
        "two": 2,
        "third": 3,
        "3": 3,
        "three": 3,
        "fourth": 4,
        "4": 4,
        "fifth": 5,
        "5": 5,
    }
    tok = q.lower().rstrip(".")
    if tok in ordinals:
        idx = ordinals[tok] - 1
        if 0 <= idx < len(ents):
            return dict(ents[idx])
        return None
    if tok.isdigit():
        idx = int(tok) - 1
        if 0 <= idx < len(ents):
            return dict(ents[idx])
        return None
    by_lower = {e["name"].lower(): e for e in ents}
    hit = by_lower.get(q.lower())
    if hit:
        return dict(hit)
    first = q.split()[0].lower()
    firsts = [e for e in ents if e["name"].split()[0].lower() == first]
    if len(firsts) == 1:
        return dict(firsts[0])
    if len(firsts) > 1:
        return {"ambiguous": firsts, "entity_type": entity_type}
    lasts = [e for e in ents if e["name"].split()[-1].lower() == first]
    if len(lasts) == 1:
        return dict(lasts[0])
    if len(lasts) > 1:
        return {"ambiguous": lasts, "entity_type": entity_type}
    if allow_substring:
        subs = [e for e in ents if first in e["name"].lower()]
        if len(subs) == 1:
            return dict(subs[0])
        if len(subs) > 1:
            return {"ambiguous": subs, "entity_type": entity_type}
    if not allow_fuzzy:
        return None
    fuzzy = _fuzzy_unique_entity(q, ents)
    if fuzzy:
        return fuzzy
    return None


def resolve_roster_name(
    raw: str,
    roster: list[str] | None,
    *,
    allow_fuzzy: bool = True,
    allow_substring: bool = True,
) -> str | None:
    """Exact list spelling, substring/first-token, or unique fuzzy match."""
    hit = resolve_entity(
        raw,
        roster or [],
        "agent",
        allow_fuzzy=allow_fuzzy,
        allow_substring=allow_substring,
    )
    if isinstance(hit, dict) and hit.get("name") and not hit.get("ambiguous"):
        return str(hit["name"])
    return None


def person_from_user_text(
    text: str | None,
    roster: list[str] | None,
    *,
    allow_fuzzy: bool = True,
    allow_substring: bool = True,
) -> str | None:
    """Canonical roster name the user named this turn (whole utterance or short name).

    Super Agent should put the DB spelling in fields.person. This only binds against
    the live roster — it does not parse assign/reassign grammar.

    allow_fuzzy=False: clear matches only (reassign/escalate). Default True for
    create-team / add-members and other shared callers.
    """
    names = [str(n).strip() for n in (roster or []) if str(n).strip()]
    raw = str(text or "").strip()
    if not raw or not names:
        return None
    direct = resolve_roster_name(
        raw,
        names,
        allow_fuzzy=allow_fuzzy,
        allow_substring=allow_substring,
    )
    if direct:
        return direct
    lower = raw.lower()
    found: list[str] = []
    for name in names:
        nlow = name.lower()
        if nlow and nlow in lower:
            found.append(name)
            continue
        first = nlow.split()[0] if nlow else ""
        if len(first) > 1:
            start = 0
            while True:
                idx = lower.find(first, start)
                if idx < 0:
                    break
                before = idx == 0 or not lower[idx - 1].isalnum()
                after_i = idx + len(first)
                after = after_i >= len(lower) or not lower[after_i].isalnum()
                if before and after:
                    found.append(name)
                    break
                start = idx + 1
    unique = list(dict.fromkeys(found))
    if len(unique) == 1:
        return unique[0]
    if len(unique) > 1:
        return None
    return resolve_roster_name(
        raw,
        names,
        allow_fuzzy=allow_fuzzy,
        allow_substring=allow_substring,
    )


def ticket_person_resolution(
    user_input: str,
    available_entities: list[Any] | None,
) -> dict[str, Any] | None:
    """Reassign/escalate person match: clear bind vs fuzzy proposal.

    Never silently treats a fuzzy-only hit as confirmed. Callers must ask
    \"Did you mean <name>?\" when kind == \"propose\". Multiple close fuzzy
    scores return ambiguous so the user picks.

    Returns:
      {kind: \"clear\"|\"propose\", id, name}
      {kind: \"ambiguous\", candidates: [{id,name}, ...]}
      None
    """
    clear = resolve_entity(
        user_input,
        available_entities,
        "agent",
        allow_fuzzy=False,
        allow_substring=False,
    )
    if isinstance(clear, dict) and clear.get("ambiguous"):
        return {
            "kind": "ambiguous",
            "candidates": list(clear.get("ambiguous") or []),
        }
    if isinstance(clear, dict) and clear.get("name"):
        return {
            "kind": "clear",
            "id": str(clear.get("id") or "").strip(),
            "name": str(clear.get("name") or "").strip(),
        }

    # Plausible fuzzy set (not silent unique bind when several are close).
    q = str(user_input or "").strip()
    ents: list[dict[str, str]] = []
    for raw in available_entities or []:
        if isinstance(raw, dict):
            name = str(raw.get("name") or raw.get("label") or "").strip()
            eid = str(raw.get("id") or "").strip()
        else:
            name = str(raw or "").strip()
            eid = ""
        if name:
            ents.append({"id": eid, "name": name})
    if len(q) < _FUZZY_ROSTER_MIN_QUERY_LEN or not ents:
        return None
    scored = sorted(
        ((_name_match_score(q, e["name"]), e) for e in ents),
        key=lambda row: row[0],
        reverse=True,
    )
    plausible = [
        (score, dict(ent))
        for score, ent in scored
        if score >= _FUZZY_ROSTER_MIN_RATIO
    ]
    if not plausible:
        return None
    if len(plausible) == 1:
        best = plausible[0][1]
        return {
            "kind": "propose",
            "id": str(best.get("id") or "").strip(),
            "name": str(best.get("name") or "").strip(),
        }
    # Multiple people look plausible for this fragment → ask which one.
    return {
        "kind": "ambiguous",
        "candidates": [ent for _, ent in plausible[:8]],
    }


_ROSTER_SELECT_ALL_RE = re.compile(
    r"^(please\s+)?(add|include|assign|take|use|pick|select)?\s*"
    r"(all(\s+of\s+(them|these|those|the\s+(people|staff|members|agents|names)))?"
    r"|everyone|everybody|the\s+entire\s+(list|roster|team|staff)"
    r"|the\s+whole\s+(list|roster|team|staff)"
    r"|all\s+(staff|members|agents|people|names))"
    r"(\s+please)?\s*$",
    re.I,
)


def utterance_selects_all_roster(text: str | None) -> bool:
    """Roster binder fallback when NLU left fields empty but the turn means everyone.

    Not the meaning engine — Super Agent / specialist should put the full roster in
    fields.members. This only maps a complete offered list onto available_members
    for validation when JSON is incomplete.
    """
    raw = (text or "").strip().rstrip("!?.")
    if not raw:
        return False
    return bool(_ROSTER_SELECT_ALL_RE.match(raw))


def members_from_user_text(text: str | None, roster: list[str] | None) -> list[str]:
    """Roster names the user actually named this turn (comma / and lists)."""
    names = [str(n).strip() for n in (roster or []) if str(n).strip()]
    raw = (text or "").strip()
    if not raw or not names:
        return []
    if utterance_selects_all_roster(raw):
        return list(names)
    parts = re.split(r"[,;/]|\band\b", raw, flags=re.I)
    found: list[str] = []
    seen: set[str] = set()

    def _add(hit: str | None) -> None:
        if not hit:
            return
        key = hit.lower()
        if key not in seen:
            seen.add(key)
            found.append(hit)

    for part in parts:
        cleaned = re.sub(
            r"^(please\s+)?(add|include|assign)\s+",
            "",
            part.strip(),
            flags=re.I,
        )
        if cleaned:
            _add(resolve_roster_name(cleaned, names))
    if not found:
        _add(resolve_roster_name(raw, names))
    return found


def ground_fields_in_utterance(
    fields: dict[str, Any] | None,
    user_text: str | None,
    *,
    roster_members: list[str] | None = None,
) -> dict[str, Any]:
    """Keep NLU fields grounded in this turn.

    Member names may be the canonical roster spelling even when the user typed
    a short form (first token / unique substring on available_members). Only
    names on roster_members are kept.
    Other fields must still appear in the utterance so the model cannot invent email/id.
    """
    src = fields if isinstance(fields, dict) else {}
    text = user_text or ""
    if not src:
        return {}
    out: dict[str, Any] = {}
    for key, raw in src.items():
        if raw in (None, "", []):
            continue
        lk = str(key)
        if lk in _SKIP_UTTERANCE_KEYS or lk in _ID_FIELD_KEYS:
            continue
        if lk == "members_skipped":
            # Create-team no longer allows empty teams — ignore skip flags.
            continue
        if lk == "members" and isinstance(raw, list):
            roster = [
                str(n).strip()
                for n in (roster_members or [])
                if str(n).strip()
            ]
            if utterance_selects_all_roster(text) and roster:
                out["members"] = list(roster)
                continue
            candidates: list[str] = []
            seen: set[str] = set()
            for m in raw:
                s = str(m).strip()
                if not s:
                    continue
                canonical = resolve_roster_name(s, roster)
                if canonical:
                    key = canonical.lower()
                    if key not in seen:
                        seen.add(key)
                        candidates.append(canonical)
                    continue
                if roster:
                    continue
                if _utterance_has_value(text, s):
                    key = s.lower()
                    if key not in seen:
                        seen.add(key)
                        candidates.append(s)
            if len(candidates) <= 1:
                kept = candidates
            else:
                kept = [
                    name
                    for name in candidates
                    if name.lower()
                    in {n.lower() for n in members_from_user_text(text, roster)}
                ]
            if not kept and roster:
                kept = members_from_user_text(text, roster)
            if kept:
                out["members"] = kept
            continue
        if lk in ("customerName", "customer_name", "assignee") and roster_members:
            value = str(raw).strip() if not isinstance(raw, bool) else ""
            canonical = resolve_roster_name(value, roster_members)
            if canonical:
                existing = out.get("members") if isinstance(out.get("members"), list) else []
                if canonical.lower() not in {str(x).lower() for x in existing}:
                    out["members"] = [*existing, canonical]
            continue
        if lk == "person" and roster_members:
            value = str(raw).strip() if not isinstance(raw, bool) else ""
            if not value:
                continue
            canonical = person_from_user_text(
                value,
                roster_members,
                allow_fuzzy=False,
                allow_substring=False,
            ) or resolve_roster_name(
                value,
                roster_members,
                allow_fuzzy=False,
                allow_substring=False,
            )
            out["person"] = canonical or value
            continue
        if isinstance(raw, bool):
            continue
        value = str(raw).strip()
        if not value:
            continue
        if lk in _EMAIL_FIELD_KEYS or (
            lk == "contact" and email_looks_valid(value)
        ):
            if email_looks_valid(value) and _utterance_has_email(text, value):
                out[key] = raw
            continue
        if lk in _PHONE_FIELD_KEYS or (
            lk == "contact" and phone_looks_valid(value)
        ):
            if phone_looks_valid(value) and _utterance_has_phone(text, value):
                out[key] = raw
            continue
        if lk == "resolutionHours":
            digits = re.sub(r"[^\d.]", "", value)
            if digits and re.search(
                rf"(?<!\d){re.escape(digits.rstrip('0').rstrip('.') or digits)}(?!\d)",
                text,
            ):
                out[key] = raw
            continue
        if _utterance_has_value(text, value):
            out[key] = raw
    return out


def _contact_ok(data: dict[str, Any]) -> bool:
    email = str(data.get("customerEmail") or data.get("email") or "").strip()
    phone = str(data.get("customerPhone") or data.get("phone") or "").strip()
    return email_looks_valid(email) or phone_looks_valid(phone)


def issue_looks_usable(raw: str) -> bool:
    text = (raw or "").strip()
    if len(text) < 8:
        return False
    if email_looks_valid(text) or phone_looks_valid(text):
        return False
    lower = text.lower()
    if lower in {
        "no issue description",
        "no issue description provided",
        "n/a",
        "none",
        "nothing",
    }:
        return False
    stripped = re.sub(r"[\w.+-]+@[\w.-]+\.\w+", "", text)
    stripped = re.sub(r"\d[\d\s().-]{6,}\d", "", stripped).strip(" ,;-")
    return len(stripped) >= 8


_OPTIONS_ASK_RE = re.compile(
    r"^(show|list|see|what are|who are|who can)\b.+"
    r"\b(team|teams|member|members|staff|roster|available)\b"
    r"|^(available\s+(teams?|members?)|who can i add)\b",
    re.I,
)


def utterance_asks_for_options(text: str | None) -> bool:
    """Structural: catalog/roster asks are not team names or member values."""
    raw = (text or "").strip()
    if not raw:
        return False
    return bool(_OPTIONS_ASK_RE.search(raw))


def utterance_plausibly_confirms(text: str | None) -> bool:
    """Removed: consent is LLM-owned (specialist tool call / NLU CONFIRM).

    Always False — do not keyword-match yes/yehh/ok. Kept as a no-op stub so
    any stray import fails closed instead of inventing confirm intent.
    """
    del text
    return False


def utterance_plausibly_cancels(text: str | None) -> bool:
    """Removed: cancel is LLM-owned (NLU CANCEL_WORKFLOW / specialist refusal).

    Always False — do not keyword-match no/stop/cancel. Kept as a no-op stub.
    """
    del text
    return False


_REASSIGN_START_RE = re.compile(
    r"\b("
    r"re-?assign(ing|ed)?|"
    r"reassing|reasign|reasing|reasining|reassining|"
    r"change\s+(the\s+)?assignee|"
    r"change\s+(the\s+)?(agent|resolver)|"
    r"assign\s+to\s+someone"
    r")\b",
    re.I,
)


def utterance_plausibly_starts_reassign(text: str | None) -> bool:
    """Safety gate when NLU emits UPDATE_TICKET for a clear reassign start.

    Super Agent should emit START_REASSIGN; this only corrects empty field-update
    loops (status/priority ask) for open-ticket reassignment.

    Collision family (reassign vs generic UPDATE) — related gates:
    - normalize_workflow_decision force START_REASSIGN (SIDE_QUEST / roster ask)
    - utterance_is_reassign_role_column / _asks_reassign_roster_list
    - ground_active_collect_decision (mid-flow roster SIDE_QUEST → CONTINUE)
    Prefer extending these helpers over new prompt bullets for the same collision.
    """
    raw = (text or "").strip()
    if not raw:
        return False
    lower = raw.lower().rstrip("!?.")
    if lower in {
        "reassign",
        "re-assign",
        "reassing",
        "reasign",
        "reasing",
        "reassigning",
    }:
        return True
    if re.search(
        r"\b(how many|were reassigned|tickets?\s+assigned\s+to|reassigned\s+today)\b",
        lower,
    ):
        return False
    return bool(_REASSIGN_START_RE.search(raw))


def looks_like_person_name(raw: str) -> bool:
    text = (raw or "").strip()
    if len(text) < 2 or len(text) > 80:
        return False
    if "?" in text:
        return False
    if email_looks_valid(text) or phone_looks_valid(text):
        return False
    if (
        looks_like_create_customer_command(text)
        or looks_like_create_ticket_command(text)
        or looks_like_create_team_command(text)
    ):
        return False
    if re.search(
        r"\b(create|file|make|new|ticket|tickets|case|show|list|filter|cancel)\b",
        text,
        re.I,
    ):
        return False
    if re.match(
        r"^(what|which|who|where|when|why|how|do|does|did|can|could|would|please)\b",
        text,
        re.I,
    ):
        return False
    # Meta / protest — never bind as a customer name ("details where already given").
    if re.search(
        r"\b(already\s+(given|provided|said|told|entered|filled)|"
        r"details?\s+(where|were|are|already)|"
        r"i\s+(already|just|said|told)|"
        r"as\s+i\s+said|same\s+as\s+above|see\s+above)\b",
        text,
        re.I,
    ):
        return False
    # Correction / edit instructions are not person names
    # ("change the name", "update email", "fix the customer name").
    if re.search(
        r"\b(change|update|edit|fix|revise|correct|replace|modify|undo|"
        r"go\s+back|back\s+to)\b",
        text,
        re.I,
    ) and re.search(
        r"\b(name|email|phone|contact|issue|subject|description|field|"
        r"customer|assignee|member|title|body|category|priority)\b",
        text,
        re.I,
    ):
        return False
    if re.match(
        r"^(change|update|edit|fix|revise|correct|replace|modify)\b",
        text,
        re.I,
    ):
        return False
    # "another name" / "different email" — field redirects, not values
    if re.search(
        r"\b(another|different|other|new)\s+(name|email|phone|contact|issue|"
        r"customer|assignee|title|body|category)\b",
        text,
        re.I,
    ):
        return False
    # Person names are short; long clauses are instructions, not names.
    tokens = [t for t in re.split(r"\s+", text) if t]
    if len(tokens) > 5:
        return False
    return bool(re.search(r"[A-Za-z]", text))


def _first_str(*vals: Any) -> str:
    for v in vals:
        s = str(v or "").strip()
        if s:
            return s
    return ""


def normalize_ticket_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Flatten NLU/draft fields into canonical create-ticket keys."""
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    name = _first_str(src.get("customerName"), src.get("customer"), src.get("name"))
    if name and looks_like_person_name(name):
        out["customerName"] = name
    cid = _first_str(src.get("customerId"), src.get("customer_id"))
    if cid:
        out["customerId"] = cid
    email = _first_str(src.get("customerEmail"), src.get("email"))
    phone = _first_str(src.get("customerPhone"), src.get("phone"))
    contact = _first_str(src.get("contact"))
    if not email and email_looks_valid(contact):
        email = contact
    if not phone and phone_looks_valid(contact):
        phone = contact
    if email_looks_valid(email):
        out["customerEmail"] = email
    if phone_looks_valid(phone):
        out["customerPhone"] = phone
    issue = _first_str(src.get("issue"), src.get("description"))
    if issue_looks_usable(issue):
        out["issue"] = issue
    subject = _first_str(src.get("subject"))
    if subject and not email_looks_valid(subject) and not phone_looks_valid(subject):
        out["subject"] = subject
    pri = _first_str(src.get("priority")).lower()
    if pri in _PRIORITY_LEVELS:
        out["priority"] = pri
    for key in (
        "description",
        "category",
        "skill",
        "queue",
        "queueId",
        "assignee",
        "assigneeId",
        "resolver",
        "resolverId",
        "confidence",
        "enriched",
        "status",
        "note",
        "ticket_number",
        "ticketNumber",
    ):
        value = src.get(key)
        if value not in (None, ""):
            out[key] = value
    tn = _first_str(src.get("ticket_number"), src.get("ticketNumber"), src.get("ticket"))
    if tn:
        out["ticket_number"] = tn
    note = _first_str(src.get("note"), src.get("comment"), src.get("body"))
    if note:
        out["note"] = note
    status = _first_str(src.get("status"))
    if status:
        out["status"] = status
    return out


def normalize_customer_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    name = _first_str(src.get("name"), src.get("customerName"), src.get("customer"))
    if name and looks_like_person_name(name):
        out["name"] = name
    email = _first_str(src.get("email"), src.get("customerEmail"))
    phone = _first_str(src.get("phone"), src.get("customerPhone"))
    contact = _first_str(src.get("contact"))
    if contact and not email and not phone:
        if email_looks_valid(contact):
            email = contact
        elif phone_looks_valid(contact):
            phone = contact
    if email and email_looks_valid(email):
        out["email"] = email
    if phone and phone_looks_valid(phone):
        out["phone"] = phone
    account = _first_str(src.get("accountName"), src.get("account"))
    if account:
        out["accountName"] = account
    return out


def normalize_team_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    name = _first_str(src.get("name"), src.get("teamName"), src.get("queueName"), src.get("team"))
    if (
        name
        and not email_looks_valid(name)
        and not phone_looks_valid(name)
        and len(name) >= 2
        and not looks_like_create_team_command(name)
    ):
        out["name"] = name
    description = _first_str(src.get("description"), src.get("teamDescription"))
    if description and len(description) >= 3:
        out["description"] = description
    members = src.get("members") or src.get("member_names") or src.get("memberNames")
    names: list[str] = []
    if isinstance(members, list):
        names = [str(m).strip() for m in members if str(m).strip()]
    elif isinstance(members, str) and members.strip():
        names = [p.strip() for p in re.split(r"[,;\n]| and ", members) if p.strip()]
    if names:
        out["members"] = names
    # Ignore members_skipped — empty teams are not allowed on create.
    qid = _first_str(src.get("id"), src.get("queueId"))
    if qid:
        out["id"] = qid
    return out


def normalize_members_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out = normalize_team_fields(src)
    members = src.get("members") or src.get("member_names") or src.get("memberNames")
    names: list[str] = []
    if isinstance(members, list):
        names = [str(m).strip() for m in members if str(m).strip()]
    elif isinstance(members, str) and members.strip():
        names = [p.strip() for p in re.split(r"[,;\n]| and ", members) if p.strip()]
    if names:
        out["members"] = names
    team = _first_str(src.get("team"), src.get("teamName"), src.get("name"))
    if team:
        out["team"] = team
    return out


def normalize_macro_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    title = _first_str(src.get("title"), src.get("name"))
    if len(title) >= 2:
        out["title"] = title
    body = _first_str(src.get("body"), src.get("content"), src.get("reply"))
    if len(body) >= 3:
        out["body"] = body
    mid = _first_str(src.get("id"))
    if mid:
        out["id"] = mid
    return out


def normalize_kb_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    title = usable_kb_title(
        _first_str(src.get("title"), src.get("name")),
        start_utterance=_first_str(src.get("_intent_start_text")),
    )
    if len(title) >= 2:
        out["title"] = title
    category = _first_str(src.get("category"))
    if category:
        out["category"] = category
    body = _first_str(src.get("body"), src.get("content"))
    if len(body) >= 10:
        out["body"] = body
    return out


def normalize_escalate_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    tn = _first_str(
        src.get("ticket_number"),
        src.get("ticketNumber"),
        src.get("ticket"),
    )
    if tn:
        out["ticket_number"] = tn.lstrip("#")
    assignee = _first_str(src.get("assignee"), src.get("agent"), src.get("resolver"))
    if assignee:
        out["assignee"] = assignee
    note = _first_str(src.get("note"), src.get("comment"))
    if note:
        out["note"] = note
    return out


def normalize_catalog_resolution_hours(raw: Any) -> int:
    """Catalog SLA is stored as whole hours; sub-hour values round up to 1."""
    if isinstance(raw, str):
        # Accept "3", "3 hrs", "3 hours" — same digit extract as slot_compatible.
        cleaned = re.sub(r"[^\d.]", "", raw.strip())
        raw = cleaned if cleaned else raw
    try:
        n = float(raw)
    except (TypeError, ValueError):
        raise ValueError("resolutionHours must be a positive number") from None
    if not (n > 0 and n == n):  # finite and > 0
        raise ValueError("resolutionHours must be > 0")
    if n < 1:
        return 1
    return int(round(n))


def normalize_priority_fields(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    name = _first_str(
        src.get("displayName"),
        src.get("display_name"),
        src.get("name"),
        src.get("label"),
    )
    if len(name) >= 2:
        # Create-intent sentences / start utterance must never become catalog labels.
        start = _first_str(src.get("_intent_start_text"))
        kind = _catalog_label_kind(src)
        label = usable_catalog_label(name, start_utterance=start, kind=kind)
        if label:
            out["displayName"] = label
    hours = src.get("resolutionHours")
    if hours is None:
        hours = (
            src.get("resolution_hours")
            or src.get("resolution_time_hours")
            or src.get("hours")
            or src.get("slaHours")
            or src.get("sla_hours")
        )
    try:
        if hours is not None and str(hours).strip() != "":
            out["resolutionHours"] = normalize_catalog_resolution_hours(hours)
    except ValueError:
        pass
    kind = _first_str(src.get("kind")).lower()
    if kind in ("priority", "status"):
        out["kind"] = kind
    return out


_NORMALIZERS = {
    "create_ticket": normalize_ticket_fields,
    "ticket": normalize_ticket_fields,
    "create_team": normalize_team_fields,
    "team": normalize_team_fields,
    "add_team_members": normalize_members_fields,
    "add_members": normalize_members_fields,
    "create_macro": normalize_macro_fields,
    "macro": normalize_macro_fields,
    "create_kb": normalize_kb_fields,
    "kb": normalize_kb_fields,
    "escalate": normalize_escalate_fields,
    "create_priority": normalize_priority_fields,
    "priority": normalize_priority_fields,
    "create_status": normalize_priority_fields,
    "status": normalize_priority_fields,
    "create_customer": normalize_customer_fields,
    "customer": normalize_customer_fields,
}


def normalize_fields(workflow_id: str | None, raw: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize extracted fields for the active workflow; idle = union of typed fields."""
    src = raw if isinstance(raw, dict) else {}
    wid = (workflow_id or "").strip().lower()
    fn = _NORMALIZERS.get(wid)
    if fn:
        return fn(src)
    out: dict[str, Any] = {}
    for normalizer in (
        normalize_ticket_fields,
        normalize_team_fields,
        normalize_members_fields,
        normalize_macro_fields,
        normalize_kb_fields,
        normalize_escalate_fields,
        normalize_priority_fields,
        normalize_customer_fields,
    ):
        out.update(normalizer(src))
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def merge_workflow_state(
    workflow_id: str | None,
    existing: dict[str, Any] | None,
    extracted: dict[str, Any] | None,
    *,
    user_text: str | None = None,
    roster_members: list[str] | None = None,
) -> dict[str, Any]:
    base = dict(existing or {})
    incoming = extracted
    if user_text is not None:
        incoming = ground_fields_in_utterance(
            incoming, user_text, roster_members=roster_members
        )
    incoming = normalize_fields(workflow_id, incoming)
    for k, v in incoming.items():
        if v in (None, "", []):
            continue
        base[k] = v
    return base


def merge_ticket_state(
    existing: dict[str, Any] | None,
    extracted: dict[str, Any] | None,
    *,
    user_text: str | None = None,
) -> dict[str, Any]:
    return merge_workflow_state(
        "create_ticket", existing, extracted, user_text=user_text
    )


def missing_fields(workflow_id: str | None, data: dict[str, Any] | None) -> list[str]:
    wid = (workflow_id or "").strip().lower()
    d = data if isinstance(data, dict) else {}
    if wid in ("create_ticket", "ticket"):
        return missing_ticket_fields(d)
    if wid in ("create_team", "team"):
        missing: list[str] = []
        if not str(d.get("name") or "").strip():
            missing.append("name")
        if len(str(d.get("description") or "").strip()) < 3:
            missing.append("description")
        members = d.get("members")
        if isinstance(members, list):
            have = bool([m for m in members if str(m).strip()])
        else:
            have = bool(str(members or "").strip())
        # members_skipped is no longer valid — teams must have at least one member.
        if not have:
            missing.append("members")
        return missing
    if wid in ("add_team_members", "add_members"):
        missing = []
        if not (
            str(d.get("team") or d.get("name") or "").strip()
            or str(d.get("id") or "").strip()
        ):
            missing.append("team")
        members = d.get("members")
        if isinstance(members, list):
            have = bool([m for m in members if str(m).strip()])
        else:
            have = bool(str(members or "").strip())
        if not have:
            missing.append("members")
        return missing
    if wid in ("create_macro", "macro"):
        missing = []
        if len(str(d.get("title") or d.get("name") or "").strip()) < 2:
            missing.append("title")
        if len(str(d.get("body") or d.get("content") or d.get("reply") or "").strip()) < 3:
            missing.append("body")
        return missing
    if wid in ("create_kb", "kb"):
        missing = []
        if not usable_kb_title(
            str(d.get("title") or "").strip(),
            start_utterance=str(d.get("_intent_start_text") or "").strip(),
        ):
            missing.append("title")
        if not str(d.get("category") or "").strip():
            missing.append("category")
        body = str(d.get("body") or d.get("content") or "").strip()
        if len(body) < 10:
            missing.append("body")
        return missing
    if wid == "escalate":
        missing = []
        if not str(d.get("ticket_number") or d.get("ticketNumber") or "").strip():
            missing.append("ticket_number")
        if not str(d.get("assignee") or "").strip():
            missing.append("assignee")
        return missing
    if wid in ("reassign_ticket", "reassign"):
        missing = []
        if not str(d.get("ticket_number") or d.get("ticketNumber") or "").strip():
            missing.append("ticket_number")
        role = str(d.get("target_role") or "").strip().lower()
        if role not in ("agent", "resolver"):
            missing.append("target_role")
        if not str(d.get("person") or d.get("person_name") or "").strip():
            missing.append("person")
        return missing
    if wid in ("create_status", "status") or str(d.get("kind") or "").lower() == "status":
        missing = []
        start = str(d.get("_intent_start_text") or "").strip()
        if not usable_status_label(
            str(d.get("displayName") or d.get("name") or "").strip(),
            start_utterance=start,
        ):
            missing.append("displayName")
        return missing
    if wid in ("create_priority", "priority"):
        missing = []
        start = str(d.get("_intent_start_text") or "").strip()
        if not usable_priority_label(
            str(d.get("displayName") or d.get("name") or "").strip(),
            start_utterance=start,
        ):
            missing.append("displayName")
        try:
            hours = float(d.get("resolutionHours") or d.get("hours") or 0)
        except (TypeError, ValueError):
            hours = 0
        if hours <= 0:
            missing.append("resolutionHours")
        return missing
    if wid in ("create_customer", "customer"):
        missing = []
        if not str(d.get("name") or d.get("customerName") or "").strip():
            missing.append("name")
        email = str(d.get("email") or d.get("customerEmail") or "").strip()
        phone = str(d.get("phone") or d.get("customerPhone") or "").strip()
        if not email_looks_valid(email):
            missing.append("email")
        if not phone_looks_valid(phone):
            missing.append("phone")
        return missing
    return []


def missing_ticket_fields(data: dict[str, Any] | None) -> list[str]:
    """Return required field ids still missing (contact = email|phone)."""
    d = data if isinstance(data, dict) else {}
    # Support portal: customer is session-bound; only the issue is collected.
    if str(d.get("surface") or "").strip().lower() == "portal":
        issue = str(
            d.get("issue") or d.get("subject") or d.get("description") or ""
        ).strip()
        if not issue_looks_usable(issue):
            return ["issue"]
        return []
    missing: list[str] = []
    if not str(d.get("customerName") or "").strip():
        missing.append("customerName")
    if not _contact_ok(d):
        missing.append("contact")
    issue = str(
        d.get("issue") or d.get("subject") or d.get("description") or ""
    ).strip()
    if not issue_looks_usable(issue):
        missing.append("issue")
    # Priority / subject are enrichment outputs — never chat-required.
    return missing


def next_field_label(workflow_id: str | None, missing: list[str]) -> str:
    schema = schema_for_workflow(workflow_id) or CREATE_TICKET_SCHEMA
    labels = schema.get("field_labels") or {}
    if not missing:
        return ""
    return str(labels.get(missing[0], missing[0]))


def next_missing_label(missing: list[str]) -> str:
    return next_field_label("create_ticket", missing)


CONFIRM_AWAITING = frozenset({"confirm", "delete_confirm"})
_DRAFT_KEYS = (
    "ticket_draft",
    "team_draft",
    "customer_draft",
    "kb_draft",
    "macro_draft",
    "priority_draft",
    "status_draft",
    "escalate_draft",
    "reassign_draft",
)


def is_confirm_awaiting(draft: dict[str, Any] | None) -> bool:
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    return awaiting in CONFIRM_AWAITING


def customer_write_ready(data: dict[str, Any] | None) -> bool:
    """True when create_customer can write: name + (email|phone).

    Matches the MCP/Express tool contract (required: name only; contact is
    email OR phone). Standalone guided chat may still collect phone via
    missing_fields / CREATE_CUSTOMER_SCHEMA — that is collection UX, not the
    write gate.
    """
    d = data if isinstance(data, dict) else {}
    name = str(d.get("name") or d.get("customerName") or "").strip()
    email = str(d.get("email") or d.get("customerEmail") or "").strip()
    phone = str(d.get("phone") or d.get("customerPhone") or "").strip()
    return bool(name and (email or phone))


def draft_complete(workflow_id: str | None, data: dict[str, Any] | None) -> bool:
    """True when required create fields are filled, or a delete target is identified."""
    awaiting = str((data or {}).get("awaiting") or "").strip().lower()
    if awaiting == "delete_confirm":
        d = data if isinstance(data, dict) else {}
        return bool(
            str(
                d.get("id")
                or d.get("queue_id")
                or d.get("displayName")
                or d.get("name")
                or d.get("title")
                or ""
            ).strip()
        )
    return not missing_fields(workflow_id, data)


def workflow_id_for_draft(draft_key: str | None, draft: dict[str, Any] | None) -> str | None:
    key = str(draft_key or "").strip()
    d = draft if isinstance(draft, dict) else {}
    flow = str(d.get("flow") or d.get("workflow") or "").strip().lower()
    kind = str(d.get("kind") or "").strip().lower()
    if key == "ticket_draft":
        return "create_ticket"
    if key == "customer_draft":
        return "create_customer"
    if key == "kb_draft":
        return "create_kb"
    if key == "macro_draft":
        return "create_macro"
    if key == "escalate_draft":
        return "escalate"
    if key == "reassign_draft":
        return "reassign_ticket"
    if key == "priority_draft":
        return "create_status" if kind == "status" else "create_priority"
    if key == "status_draft":
        return "create_status"
    if key == "team_draft":
        if flow in {"add_members", "add_team_members"} or (
            str(d.get("id") or "").strip()
            and str(d.get("awaiting") or "").strip().lower() == "confirm"
            and d.get("members") is not None
            and not str(d.get("description") or "").strip()
        ):
            return "add_team_members"
        return "create_team"
    if flow:
        return flow
    return None


def write_tool_for_armed_draft(
    draft_key: str | None, draft: dict[str, Any] | None
) -> str | None:
    """Schema write tool for a draft that is already on a confirm step."""
    if not is_confirm_awaiting(draft):
        return None
    key = str(draft_key or "").strip()
    d = draft if isinstance(draft, dict) else {}
    awaiting = str(d.get("awaiting") or "").strip().lower()
    kind = str(d.get("kind") or "").strip().lower()
    if key == "ticket_draft":
        if str(d.get("surface") or "").strip().lower() == "portal":
            return "portal_create_ticket"
        return "create_ticket"
    if key == "customer_draft":
        return "create_customer"
    if key == "kb_draft":
        return "create_kb_article"
    if key == "macro_draft":
        return "delete_macro" if awaiting == "delete_confirm" else "create_macro"
    if key == "escalate_draft":
        return "escalate_ticket"
    if key == "reassign_draft":
        # Schema id is reassign_ticket; actual write is role-specific (see REASSIGN_SCHEMA).
        role = str((d or {}).get("target_role") or "").strip().lower()
        return "escalate_ticket" if role == "resolver" else "update_ticket"
    if key == "priority_draft":
        if awaiting == "delete_confirm":
            return "delete_status" if kind == "status" else "delete_priority"
        return "create_status" if kind == "status" else "create_priority"
    if key == "status_draft":
        if awaiting == "delete_confirm":
            return "delete_status"
        return "create_status"
    if key == "team_draft":
        if awaiting == "delete_confirm":
            return "delete_queue"
        wid = workflow_id_for_draft(key, d)
        if wid in {"add_team_members", "add_members"}:
            return "update_queue"
        return "create_queue"
    return None


def write_tool_for_pending(last_query: dict[str, Any] | None) -> str | None:
    """Write tool armed by last_query.pending_update / pending_delete."""
    pending = last_query if isinstance(last_query, dict) else {}
    if pending.get("pending_bulk"):
        return None
    if not pending.get("pending_update") and not pending.get("pending_delete"):
        return None
    proposed = str(pending.get("proposed_tool") or "").strip().lower()
    if proposed:
        return proposed
    op = str(pending.get("operation") or "").strip().upper()
    from app.tools.registry import OPERATION_TOOL

    name = OPERATION_TOOL.get(op)
    pu = pending.get("pending_update") if isinstance(pending.get("pending_update"), dict) else {}
    assignee = str(pu.get("assignee") or "").strip().upper()
    if name == "update_ticket" and assignee in {"AUTO", "BEST", "BEST_RESOLVER"}:
        return "auto_assign_ticket"
    return name


def write_tool_armed(
    *,
    draft: dict[str, Any] | None = None,
    workflow_id: str | None = None,
    last_query: dict[str, Any] | None = None,
    draft_key: str | None = None,
) -> bool:
    """True after we have already asked, and the payload is complete (or pending_*)."""
    pending = last_query if isinstance(last_query, dict) else {}
    if pending.get("pending_bulk"):
        return False
    if pending.get("pending_update") or pending.get("pending_delete"):
        return True
    if not isinstance(draft, dict):
        return False
    key = str(draft_key or "").strip()
    # Directory miss: do not arm create_ticket — customers specialist must write first.
    if key == "ticket_draft" and draft.get("customer_not_found"):
        return False
    if not is_confirm_awaiting(draft):
        return False
    wid = workflow_id or workflow_id_for_draft(draft_key, draft)
    return draft_complete(wid, draft)


def write_schema_audit(state: dict[str, Any] | None) -> str:
    """Required vs present fields for armed drafts — specialist evaluates this, code still validates."""
    blob = state if isinstance(state, dict) else {}
    lines: list[str] = []
    for key in _DRAFT_KEYS:
        draft = blob.get(key) if isinstance(blob.get(key), dict) else None
        if not write_tool_armed(draft=draft, draft_key=key):
            continue
        wid = workflow_id_for_draft(key, draft)
        tool = write_tool_for_armed_draft(key, draft)
        awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
        if awaiting == "delete_confirm":
            lines.append(f"{tool}: delete target present; missing=[]")
            continue
        miss = missing_fields(wid, draft)
        schema = schema_for_workflow(wid) or {}
        required = [str(f) for f in (schema.get("required") or [])]
        present = [f for f in required if f not in miss]
        lines.append(
            f"{tool}: required={present + miss}; present={present}; missing={miss}"
        )
    return "; ".join(lines)


def armed_write_tools_from_state(state: dict[str, Any] | None) -> frozenset[str]:
    """Write tools that may be bound this turn (complete confirm/delete or pending_*)."""
    blob = state if isinstance(state, dict) else {}
    ctx = blob.get("conversation_context") if isinstance(blob.get("conversation_context"), dict) else {}
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    tools: set[str] = set()
    pending_name = write_tool_for_pending(last_q)
    if pending_name:
        tools.add(pending_name)
        pu = last_q.get("pending_update") if isinstance(last_q.get("pending_update"), dict) else {}
        if str(pu.get("assignee") or "").strip().upper() in {"AUTO", "BEST", "BEST_RESOLVER"}:
            tools.add("auto_assign_ticket")
    for key in _DRAFT_KEYS:
        draft = blob.get(key) if isinstance(blob.get(key), dict) else None
        if not write_tool_armed(draft=draft, draft_key=key):
            continue
        name = write_tool_for_armed_draft(key, draft)
        if name:
            tools.add(name)
    return frozenset(tools)


_WORKFLOW_DRAFT_KEY: dict[str, str] = {
    "create_team": "team_draft",
    "add_team_members": "team_draft",
    "add_members": "team_draft",
    "create_ticket": "ticket_draft",
    "create_customer": "customer_draft",
    "create_kb": "kb_draft",
    "create_macro": "macro_draft",
    "create_priority": "priority_draft",
    "create_status": "status_draft",
    "escalate": "escalate_draft",
    "reassign_ticket": "reassign_draft",
}


def preferred_armed_write_tool(
    state: dict[str, Any] | None,
    candidates: frozenset[str] | None = None,
) -> str | None:
    """Pick the write tool for an armed confirm turn (current_workflow wins over stale drafts)."""
    blob = state if isinstance(state, dict) else {}
    last = blob.get("last_tool_outcome") if isinstance(blob.get("last_tool_outcome"), dict) else {}
    last_tool = str(last.get("tool") or "").strip()
    last_code = str(last.get("error_code") or "").strip().upper()
    last_kind = str(last.get("kind") or "").strip().lower()
    if last_tool and (
        last_code == "CONFIRMATION_REQUIRED" or last_kind == "needs_confirm"
    ):
        if not candidates or last_tool in candidates:
            return last_tool
    current = str(blob.get("current_workflow") or "").strip().lower()
    ctx = (
        blob.get("conversation_context")
        if isinstance(blob.get("conversation_context"), dict)
        else {}
    )
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    pending = write_tool_for_pending(last_q)
    if pending and (not candidates or pending in candidates):
        return pending

    ordered_keys: list[str] = []
    preferred_key = _WORKFLOW_DRAFT_KEY.get(current)
    if preferred_key:
        ordered_keys.append(preferred_key)
    for key in _DRAFT_KEYS:
        if key not in ordered_keys:
            ordered_keys.append(key)

    for key in ordered_keys:
        draft = blob.get(key) if isinstance(blob.get(key), dict) else None
        if not write_tool_armed(draft=draft, draft_key=key):
            continue
        tool = write_tool_for_armed_draft(key, draft)
        if tool and (not candidates or tool in candidates):
            return tool
    return None


def arm_confirmed_for_write_tool(
    *,
    args: dict[str, Any] | None,
    draft: dict[str, Any] | None,
    workflow_id: str | None = None,
    draft_key: str | None = None,
) -> dict[str, Any]:
    """Pass through write args; never invent consent from draft completeness.

    Confirmed stays LLM/chip-owned after a real confirm ask. Completeness alone
    must not set confirmed=true (that skipped the summary step on create-ticket).
    """
    out = dict(args) if isinstance(args, dict) else {}
    del draft, workflow_id, draft_key  # retained for call-site compatibility
    return out

def draft_for_write_tool(
    tool_name: str, state: dict[str, Any] | None
) -> tuple[dict[str, Any] | None, str | None]:
    """Return (draft, draft_key) that arms this write tool, if any."""
    blob = state if isinstance(state, dict) else {}
    name = str(tool_name or "").strip().lower()
    for key in _DRAFT_KEYS:
        draft = blob.get(key) if isinstance(blob.get(key), dict) else None
        if write_tool_for_armed_draft(key, draft) == name and write_tool_armed(
            draft=draft, draft_key=key
        ):
            return draft, key
    return None, None


def fill_tool_args_from_state(
    tool_name: str,
    args: dict[str, Any] | None,
    state: dict[str, Any] | None,
) -> dict[str, Any]:
    """Fill write-tool args from the armed draft so the LLM can omit already-collected fields."""
    out = dict(args) if isinstance(args, dict) else {}
    blob = state if isinstance(state, dict) else {}
    name = str(tool_name or "").strip().lower()

    def _set(key: str, *values: Any) -> None:
        if out.get(key) not in (None, "", [], {}):
            return
        for val in values:
            if val not in (None, "", [], {}):
                out[key] = val
                return

    tix = blob.get("ticket_draft") if isinstance(blob.get("ticket_draft"), dict) else {}
    team = blob.get("team_draft") if isinstance(blob.get("team_draft"), dict) else {}
    cust = blob.get("customer_draft") if isinstance(blob.get("customer_draft"), dict) else {}
    kb = blob.get("kb_draft") if isinstance(blob.get("kb_draft"), dict) else {}
    macro = blob.get("macro_draft") if isinstance(blob.get("macro_draft"), dict) else {}
    pri = blob.get("priority_draft") if isinstance(blob.get("priority_draft"), dict) else {}
    esc = blob.get("escalate_draft") if isinstance(blob.get("escalate_draft"), dict) else {}
    ras = blob.get("reassign_draft") if isinstance(blob.get("reassign_draft"), dict) else {}
    ctx = blob.get("conversation_context") if isinstance(blob.get("conversation_context"), dict) else {}
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    pending_u = last_q.get("pending_update") if isinstance(last_q.get("pending_update"), dict) else {}
    pending_d = last_q.get("pending_delete") if isinstance(last_q.get("pending_delete"), dict) else {}

    if name == "create_ticket":
        _set("customer_name", tix.get("customerName"))
        _set("customer_id", tix.get("customerId"))
        _set("customer_email", tix.get("customerEmail"))
        _set("customer_phone", tix.get("customerPhone"))
        issue = str(tix.get("issue") or tix.get("subject") or "").strip()
        _set("subject", tix.get("subject") or issue)
        _set("description", tix.get("description") or issue)
        _set("priority", tix.get("priority"))
        _set("channel", "Chat")
    elif name == "portal_create_ticket":
        issue = str(
            tix.get("issue") or tix.get("description") or tix.get("subject") or ""
        ).strip()
        _set("issue", issue)
        _set("subject", tix.get("subject") or issue)
        _set("description", tix.get("description") or issue)
        if tix.get("kb_offered") and out.get("force_create") in (None, ""):
            out["force_create"] = True
    elif name == "create_queue":
        _set("name", team.get("name"))
        _set("description", team.get("description"))
        members = team.get("members")
        if isinstance(members, list) and members:
            _set("members", members)
    elif name == "update_queue":
        last_ent = blob.get("last_entity") if isinstance(blob.get("last_entity"), dict) else {}
        last_ent_id = (
            last_ent.get("id")
            if str(last_ent.get("type") or "").strip().lower() in {"team", "queue"}
            else None
        )
        _set(
            "queue_id",
            team.get("id")
            or team.get("queue_id")
            or pending_u.get("id")
            or pending_u.get("queue_id")
            or last_ent_id,
        )
        members = team.get("members") if isinstance(team.get("members"), list) else pending_u.get("members")
        if isinstance(members, list) and members:
            _set("members", members)
            if str(team.get("flow") or team.get("workflow") or "").lower() in {
                "add_members",
                "add_team_members",
            }:
                out["add_members"] = True
    elif name == "delete_queue":
        _set("queue_id", team.get("id") or pending_d.get("id") or pending_d.get("queue_id"))
    elif name == "create_customer":
        _set("name", cust.get("name") or cust.get("customerName"))
        _set("email", cust.get("email") or cust.get("customerEmail"))
        _set("phone", cust.get("phone") or cust.get("customerPhone"))
    elif name == "create_kb_article":
        if out.get("content") in (None, "") and out.get("body") not in (None, ""):
            out["content"] = out.get("body")
        _set("title", kb.get("title"))
        _set("content", kb.get("body") or kb.get("content"))
        _set("category", kb.get("category"))
    elif name == "create_macro":
        _set("title", macro.get("title"))
        _set("body", macro.get("body"))
    elif name == "delete_macro":
        _set("macro_id", macro.get("id") or pending_d.get("id"))
    elif name == "create_priority":
        _set("display_name", pri.get("displayName") or pri.get("name"))
        hours = pri.get("resolutionHours") or pri.get("hours")
        if hours not in (None, ""):
            _set("resolution_hours", hours)
    elif name == "create_status":
        _set("display_name", pri.get("displayName") or pri.get("name"))
    elif name in {"delete_priority", "delete_status"}:
        _set("priority_id" if name == "delete_priority" else "status_id", pri.get("id") or pending_d.get("id"))
    elif name == "escalate_ticket":
        _set("ticket_number", esc.get("ticket_number") or esc.get("ticketNumber"))
        _set("assignee", esc.get("assignee"))
        _set("assignee_id", esc.get("assignee_id") or esc.get("assigneeId"))
        _set("agent", esc.get("agent"))
        _set("agent_id", esc.get("agent_id") or esc.get("agentId"))
        _set("rationale", esc.get("note") or esc.get("rationale"))
        if ras.get("target_role") == "resolver" or ras.get("person"):
            _set("ticket_number", ras.get("ticket_number") or ras.get("ticketNumber"))
            _set("assignee", ras.get("person") or ras.get("person_name"))
            _set("assignee_id", ras.get("person_id") or ras.get("personId"))
    elif name == "update_ticket":
        role = str(ras.get("target_role") or "").strip().lower()
        if ras.get("person") or ras.get("person_name") or role in {"agent", "resolver"}:
            _set(
                "ticket_number",
                ras.get("ticket_number") or ras.get("ticketNumber"),
            )
            person = ras.get("person") or ras.get("person_name")
            if role == "resolver":
                _set("resolver", person)
            else:
                _set("assignee", person)
        filters = last_q.get("filters") if isinstance(last_q.get("filters"), dict) else {}
        _set(
            "ticket_number",
            pending_u.get("ticket_number")
            or pending_u.get("ticketNumber")
            or filters.get("query")
            or filters.get("ticket_number"),
        )
        _set("status", pending_u.get("status"))
        _set("priority", pending_u.get("priority"))
        _set("assignee", pending_u.get("assignee"))
        _set("resolver", pending_u.get("resolver"))
        _set("queue", pending_u.get("queue"))
        _set("note", pending_u.get("note"))
    elif name == "publish_kb_article":
        _set("article_id", pending_u.get("id") or kb.get("id"))
    elif name == "auto_assign_ticket":
        filters = last_q.get("filters") if isinstance(last_q.get("filters"), dict) else {}
        _set(
            "ticket_number",
            pending_u.get("ticket_number")
            or pending_u.get("ticketNumber")
            or filters.get("query")
            or filters.get("ticket_number"),
        )
    elif name == "update_macro":
        _set("macro_id", pending_u.get("id") or macro.get("id"))
        _set("title", pending_u.get("title") or macro.get("title"))
        _set("body", pending_u.get("body") or macro.get("body"))
    elif name == "update_kb_article":
        _set("article_id", pending_u.get("id") or kb.get("id"))
        _set("title", pending_u.get("title") or kb.get("title"))
        _set("content", pending_u.get("content") or pending_u.get("body") or kb.get("body"))
        _set("category", pending_u.get("category") or kb.get("category"))
        _set("status", pending_u.get("status"))
    elif name == "update_org_preferences":
        _set("ticket_prefix", pending_u.get("ticket_prefix") or pending_u.get("ticketPrefix"))
        _set("portal_label", pending_u.get("portal_label") or pending_u.get("portalLabel"))
        _set("display_timezone", pending_u.get("display_timezone") or pending_u.get("displayTimezone"))
        _set("portal_auth_mode", pending_u.get("portal_auth_mode") or pending_u.get("portalAuthMode"))
        _set("business_type", pending_u.get("business_type") or pending_u.get("businessType"))
    elif name in {"update_priority", "update_status"}:
        _set(
            "priority_id" if name == "update_priority" else "status_id",
            pending_u.get("id") or pri.get("id"),
        )
        _set("display_name", pending_u.get("displayName") or pri.get("displayName"))
        hours = pending_u.get("resolutionHours") or pri.get("resolutionHours")
        if hours not in (None, ""):
            _set("resolution_hours", hours)
        if pending_u.get("active") is not None:
            _set("active", pending_u.get("active"))
    return {k: v for k, v in out.items() if v not in (None, "")}


def ticket_draft_from_state(data: dict[str, Any], *, awaiting: str | None = None) -> dict[str, Any]:
    """Project canonical fields into legacy ticket_draft adapter."""
    miss = missing_ticket_fields(data)
    step = awaiting or (miss[0] if miss else "confirm")
    await_map = {
        "customerName": "name",
        "contact": "contact",
        "issue": "issue",
        "priority": "priority",
    }
    draft = {
        "awaiting": await_map.get(step, step),
        "customerId": str(data.get("customerId") or ""),
        "customerName": str(data.get("customerName") or ""),
        "customerEmail": str(data.get("customerEmail") or ""),
        "customerPhone": str(data.get("customerPhone") or ""),
        "issue": str(data.get("issue") or data.get("description") or ""),
        "subject": str(data.get("subject") or data.get("issue") or data.get("description") or "")[
            :200
        ],
        "priority": str(data.get("priority") or ""),
    }
    for key in (
        "description",
        "category",
        "skill",
        "queue",
        "queueId",
        "assignee",
        "assigneeId",
        "resolver",
        "resolverId",
        "resolverConfidence",
        "confidence",
        "rationale",
        "enriched",
        "enrichedByAi",
        "resolver_confidence",
    ):
        if data.get(key) not in (None, ""):
            draft[key] = data[key]
    conf = data.get("resolver_confidence")
    if conf is None:
        conf = data.get("confidence")
    if conf not in (None, "") and "resolverConfidence" not in draft:
        draft["resolverConfidence"] = conf
        draft["confidence"] = conf
    if str(data.get("surface") or "").strip().lower() == "portal":
        draft["surface"] = "portal"
    return draft


def awaiting_to_schema_field(awaiting: str | None) -> str | None:
    aw = (awaiting or "").strip().lower()
    return _TICKET_AWAITING.get(aw, aw or None)


def slot_compatible(slot_type: str | None, text: str) -> bool:
    """True when an utterance may fill this schema slot (never awaiting-blind)."""
    raw = (text or "").strip()
    if not raw:
        return False
    kind = (slot_type or "").strip().lower()
    if kind == "email":
        return email_looks_valid(raw)
    if kind == "phone":
        # Reject compound commands / route queries that merely contain digits.
        if len(raw) > 24 or len(raw.split()) > 2:
            return False
        if looks_like_create_customer_command(raw) or looks_like_create_ticket_command(raw):
            return False
        return phone_looks_valid(raw)
    if kind == "contact":
        return email_looks_valid(raw) or phone_looks_valid(raw)
    if kind == "ticket_priority":
        return raw.lower() in _PRIORITY_LEVELS or bool(
            re.search(r"\b(urgent|high|medium|low)\b", raw.lower())
        )
    if kind == "issue_text":
        return issue_looks_usable(raw)
    if kind == "person_name":
        return looks_like_person_name(raw)
    if kind == "team_name":
        return (
            len(raw) >= 2
            and not email_looks_valid(raw)
            and not phone_looks_valid(raw)
            and not looks_like_create_team_command(raw)
            and not utterance_asks_for_options(raw)
        )
    if kind == "positive_number":
        try:
            return float(re.sub(r"[^\d.]", "", raw) or 0) > 0
        except ValueError:
            return False
    if kind == "long_text":
        # Length only — affirm vs body content is LLM-owned (do not keyword-block).
        return len(raw) >= 3
    if kind == "catalog_label":
        if raw.lower() in _PLACEHOLDER_PRIORITY_LABELS:
            return False
        # Short labels only. Create vs hours vs rename is LLM + the active slot.
        if len(raw) > 48 or len(raw.split()) > 3:
            return False
        return len(raw) >= 2
    if kind == "category":
        # Start-create utterances are not category labels.
        if looks_like_create_kb_command(raw):
            return False
        # Article body pasted early is not a category label.
        if len(raw) > 64 or "\n" in raw:
            return False
        return len(raw) >= 2
    if kind == "member_list":
        low = raw.lower().rstrip("!?.")
        if utterance_asks_for_options(raw):
            return False
        if low in {
            "skip",
            "none",
            "no",
            "no members",
            "without members",
            "no one",
            "nobody",
            "n/a",
        }:
            return False
        if re.search(r"\b(skip|without\s+members|no\s+members)\b", low):
            return False
        return len(raw) >= 2
    if kind in ("short_text", "ticket_ref"):
        # Consent vs title is LLM-owned. awaiting=confirm never binds (see _awaiting_slot).
        if looks_like_create_kb_command(raw) or looks_like_create_macro_command(raw):
            return False
        if is_placeholder_catalog_title(raw):
            return False
        return len(raw) >= 1
    return len(raw) >= 2


def _awaiting_slot(workflow_id: str | None, awaiting: str | None) -> str:
    wid = (workflow_id or "").strip().lower()
    aw = (awaiting or "").strip().lower()
    if not aw or aw == "confirm":
        return ""
    if wid in ("create_ticket", "ticket"):
        return awaiting_to_schema_field(aw) or ""
    if wid in ("create_priority", "priority", "create_status", "status"):
        return {"name": "displayName", "hours": "resolutionHours"}.get(aw, aw)
    if wid in ("add_team_members", "add_members"):
        return {"members_names": "members", "members_team": "team", "members": "members"}.get(
            aw, aw
        )
    if wid in ("create_team", "team"):
        return {"create_members": "members", "members": "members"}.get(aw, aw)
    if wid in ("create_customer", "customer"):
        return {"customername": "name", "contact": "email"}.get(aw, aw)
    if wid in ("reassign_ticket", "reassign"):
        return {
            "ticket": "ticket_number",
            "ticket_number": "ticket_number",
            "role": "target_role",
            "target_role": "target_role",
            "person": "person",
            "assignee": "person",
        }.get(aw, aw)
    if wid == "escalate":
        return {
            "ticket": "ticket_number",
            "ticket_number": "ticket_number",
            "assignee": "assignee",
            "person": "assignee",
            "note": "note",
        }.get(aw, aw)
    return aw


def bind_awaiting_value(
    workflow_id: str | None,
    awaiting: str | None,
    text: str,
) -> dict[str, Any]:
    """Typed bind for the active slot. Empty when the utterance is the wrong type."""
    slot = _awaiting_slot(workflow_id, awaiting)
    if not slot:
        return {}
    wid = (workflow_id or "").strip().lower()
    if wid in ("create_kb", "kb") and slot == "title":
        titled = usable_kb_title(text)
        if not titled:
            return {}
        return normalize_fields(workflow_id, {slot: titled})
    if wid in ("create_macro", "macro") and slot == "title":
        # Prefer start-utterance from caller via normalize; absorb path owns intent.
        if looks_like_create_macro_command(text) or is_placeholder_catalog_title(text):
            return {}
        titled = usable_macro_title(text)
        if not titled:
            return {}
        return normalize_fields(workflow_id, {slot: titled})
    if wid in ("create_priority", "priority") and slot == "displayName":
        labeled = usable_priority_label(text)
        if not labeled:
            return {}
        # Active-slot safety: a multi-token value that already type-checks as
        # resolutionHours must not fill displayName. The specialist binds hours.
        if len(labeled.split()) >= 2 and slot_compatible("positive_number", text):
            return {}
        return normalize_fields(workflow_id, {slot: labeled})
    if wid in ("create_status", "status") and slot == "displayName":
        labeled = usable_status_label(text)
        if not labeled:
            return {}
        return normalize_fields(workflow_id, {slot: labeled})
    schema = schema_for_workflow(workflow_id) or {}
    slot_type = (schema.get("slot_types") or {}).get(slot)
    if slot_type and not slot_compatible(str(slot_type), text):
        return {}
    return normalize_fields(workflow_id, {slot: text})


_SCHEMA_FIELD_TO_AWAITING: dict[str, dict[str, str]] = {
    "create_ticket": {
        "customerName": "name",
        "contact": "contact",
        "issue": "issue",
        "priority": "priority",
    },
    "ticket": {
        "customerName": "name",
        "contact": "contact",
        "issue": "issue",
        "priority": "priority",
    },
    "create_customer": {"name": "name", "email": "email", "phone": "phone"},
    "customer": {"name": "name", "email": "email", "phone": "phone"},
    "create_team": {
        "name": "name",
        "description": "description",
        "members": "members",
    },
    "team": {
        "name": "name",
        "description": "description",
        "members": "members",
    },
    "add_team_members": {
        "team": "members_team",
        "members": "members_names",
    },
    "add_members": {
        "team": "members_team",
        "members": "members_names",
    },
    "create_macro": {"title": "title", "body": "body"},
    "macro": {"title": "title", "body": "body"},
    "create_kb": {"title": "title", "category": "category", "body": "body"},
    "kb": {"title": "title", "category": "category", "body": "body"},
    "create_priority": {
        "displayName": "name",
        "resolutionHours": "hours",
    },
    "priority": {
        "displayName": "name",
        "resolutionHours": "hours",
    },
    "create_status": {"displayName": "name"},
    "status": {"displayName": "name"},
    "escalate": {
        "ticket_number": "ticket",
        "assignee": "assignee",
        "note": "note",
    },
    "reassign_ticket": {
        "ticket_number": "ticket",
        "target_role": "target_role",
        "person": "person",
    },
    "reassign": {
        "ticket_number": "ticket",
        "target_role": "target_role",
        "person": "person",
    },
}


def awaiting_hint_from_missing(
    workflow_id: str | None, data: dict[str, Any] | None
) -> str:
    """UI awaiting hint from schema missing_fields (SoT). Not the meaning of the turn."""
    miss = missing_fields(workflow_id, data)
    if not miss:
        return "confirm"
    wid = (workflow_id or "").strip().lower()
    primary = str(miss[0])
    return _SCHEMA_FIELD_TO_AWAITING.get(wid, {}).get(primary, primary)


def bind_primary_missing(
    workflow_id: str | None,
    data: dict[str, Any] | None,
    text: str,
) -> dict[str, Any]:
    """Bind utterance into the first missing schema field when type-compatible."""
    hint = awaiting_hint_from_missing(workflow_id, data)
    if hint == "confirm":
        return {}
    return bind_awaiting_value(workflow_id, hint, text)
