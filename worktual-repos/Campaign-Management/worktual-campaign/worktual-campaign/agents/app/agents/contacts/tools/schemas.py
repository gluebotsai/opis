"""OpenAI-style tool schemas for contacts agent."""

LOOKUP_CONTACT = {
    "type": "function",
    "function": {
        "name": "LOOKUP_CONTACT",
        "description": (
            "Duplicate check by email and/or phone before create — not by name alone. "
            "Use only when a valid email or phone is already on the draft. "
            "Returns candidate matches for the right panel."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "full_name": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

GET_CONTACT = {
    "type": "function",
    "function": {
        "name": "GET_CONTACT",
        "description": "Load one contact by id into session draft/focus.",
        "parameters": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["contact_id", "change_summary"],
        },
    },
}

SEARCH_CONTACTS = {
    "type": "function",
    "function": {
        "name": "SEARCH_CONTACTS",
        "description": (
            "Search/filter contacts. Returns count + tiny sample, never a full dump. "
            "Use search for contact names (first, last, or full name like Priya Sharma)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
                "company": {"type": "string"},
                "job_title": {"type": "string"},
                "has_email": {"type": "boolean"},
                "has_phone": {"type": "boolean"},
                "search": {
                    "type": "string",
                    "description": "Free-text: contact first name, last name, full name, email, company, city, or phone fragment.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

SET_DRAFT_FIELDS = {
    "type": "function",
    "function": {
        "name": "SET_DRAFT_FIELDS",
        "description": (
            "Merge known contact fields into the live Contact Setup panel. "
            "REQUIRED whenever the user provides or corrects any create/update field "
            "(first_name, last_name, email, phone, company, city) — the panel only "
            "updates when this tool succeeds. Call again to overwrite a prior value. "
            "Never tell the user a field is on the form until this tool returns that field. "
            "Channel: email OR phone (either is enough); if phone is given it must include "
            "country code. Use first_name and last_name for single-field answers. "
            "Use full_name only when the user gives both names together (e.g. Pujitha Paleti). "
            "Never send full_name with a single token. Soft fields (last_name, city, company) "
            "follow INDUSTRY CONTEXT — ask once, never block create. "
            "REQUIRED on create/add intent: call first with mode=create (fields may "
            "be empty) so the right panel opens. When a contact profile is open and the user "
            "wants a NEW contact, also pass reset_draft=true. Pass field values as "
            "structured args — do not rely on free-text change_summary for extraction."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["create", "update"],
                    "description": (
                        "Agent-chosen panel mode. Use create when starting or continuing "
                        "a new-contact flow (even with empty fields, and even if a "
                        "contact is currently focused). Use update only when editing "
                        "the open contact. Omit on later turns once mode is set."
                    ),
                },
                "reset_draft": {
                    "type": "boolean",
                    "description": (
                        "True to clear the live draft and leave any open detail contact "
                        "(start a brand-new create). Required with mode=create when "
                        "the user wants another / new contact while a profile is open."
                    ),
                },
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "full_name": {
                    "type": "string",
                    "description": (
                        "Both names in one answer only (e.g. 'Pujitha Paleti'). "
                        "Do not use for a single first or last name — use first_name or last_name."
                    ),
                },
                "firstName": {"type": "string"},
                "lastName": {"type": "string"},
                "email": {
                    "type": "string",
                    "description": (
                        "Optional if phone is already on the draft. "
                        "Either email or phone satisfies the channel requirement."
                    ),
                },
                "phone": {
                    "type": "string",
                    "description": (
                        "Optional if email is already on the draft. "
                        "When provided, the user must include a country code "
                        "(e.g. +91 9876543210 or 919876543210) — never invent one."
                    ),
                },
                "phoneNumber": {"type": "string"},
                "whatsappNumber": {"type": "string"},
                "company_name": {"type": "string"},
                "CompanyName": {"type": "string"},
                "city": {"type": "string"},
                "clear_city": {
                    "type": "boolean",
                    "description": "True to clear city/location from the draft.",
                },
                "clear_location": {
                    "type": "boolean",
                    "description": "Alias of clear_city.",
                },
                "clear_company": {
                    "type": "boolean",
                    "description": "True to clear company_name from the draft.",
                },
                "app_push_token": {
                    "type": "string",
                    "description": "FCM/APNs device token (App push ID).",
                },
                "app_push_platform": {
                    "type": "string",
                    "description": "android, ios, or web. Default android.",
                },
                "app_push_skip": {
                    "type": "boolean",
                    "description": "True when the user skipped App push.",
                },
                "web_push_endpoint": {
                    "type": "string",
                    "description": "Web PushSubscription.endpoint (https URL).",
                },
                "web_push_p256dh": {"type": "string"},
                "web_push_auth": {"type": "string"},
                "web_push_skip": {
                    "type": "boolean",
                    "description": "True when the user skipped Web push.",
                },
                "custom_fields": {
                    "type": "object",
                    "description": (
                        "Extra attributes that are NOT first/last name, email, phone, "
                        "company, or city (e.g. job_title, segment, product_interest, score). "
                        "Stored in CDP custom_fields JSON."
                    ),
                    "additionalProperties": True,
                },
                "extra_fields_skip": {
                    "type": "boolean",
                    "description": (
                        "True when industry-extras phase is done (user skipped / "
                        "said nothing else / agent finished asking)."
                    ),
                },
                "skip_field": {
                    "type": "string",
                    "enum": ["last_name", "company_name", "city", "email", "phone"],
                    "description": (
                        "When the user skips a field you just asked, set in this call. "
                        "last_name/company_name/city are skippable; email/phone only when "
                        "the other channel already satisfies identity."
                    ),
                },
                "mark_asked": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "first_name",
                            "last_name",
                            "email",
                            "phone",
                            "company_name",
                            "city",
                        ],
                    },
                    "description": "Field(s) you asked about this turn.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

VERIFY_FOCUS_IDENTITY = {
    "type": "function",
    "function": {
        "name": "VERIFY_FOCUS_IDENTITY",
        "description": (
            "Optional: when session has focus_contact_id, verify with email OR phone "
            "(whichever the user provided) against the focused contact. "
            "Prefer asking 'this contact (cite one of email/phone on file) or another?' "
            "instead of re-collecting both fields."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "user_query": {
                    "type": "string",
                    "description": "The user's latest request text (for routing).",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

CREATE_CONTACT = {
    "type": "function",
    "function": {
        "name": "CREATE_CONTACT",
        "description": (
            "Create a contact only after the user explicitly confirmed. "
            "Hard required: first_name + (valid email OR phone with country code). "
            "Soft fields (last_name, city, company_name, vertical extras) are optional — "
            "include only if the user already provided them; never block create waiting "
            "for them. B2C: company_name and city remain optional to save. "
            "Pass all known fields as structured args. user_confirmed=true required. "
            "Prefer LOOKUP first; if matches exist, ask update vs create another."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "email": {
                    "type": "string",
                    "description": (
                        "Pass when known. Create needs email OR phone — not both."
                    ),
                },
                "phone": {
                    "type": "string",
                    "description": (
                        "Pass when known (with country code). Optional if email is set."
                    ),
                },
                "company_name": {"type": "string"},
                "city": {"type": "string"},
                "app_push_token": {"type": "string"},
                "app_push_platform": {"type": "string"},
                "web_push_endpoint": {"type": "string"},
                "web_push_p256dh": {"type": "string"},
                "web_push_auth": {"type": "string"},
                "user_confirmed": {
                    "type": "boolean",
                    "description": "Must be true only after user said yes to create.",
                },
                "custom_fields": {
                    "type": "object",
                    "description": "Optional extras → CDP custom_fields JSON.",
                    "additionalProperties": True,
                },
                "change_summary": {"type": "string"},
            },
            "required": [
                "first_name",
                "user_confirmed",
                "change_summary",
            ],
        },
    },
}

UPDATE_CONTACT = {
    "type": "function",
    "function": {
        "name": "UPDATE_CONTACT",
        "description": (
            "Update an existing contact by id only after the user explicitly confirmed. "
            "Pass user_confirmed=true and the changed fields. Prefer GET_CONTACT first. "
            "Contact must keep first_name and at least one of email or phone."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "company_name": {"type": "string"},
                "city": {"type": "string"},
                "app_push_token": {"type": "string"},
                "app_push_platform": {"type": "string"},
                "web_push_endpoint": {"type": "string"},
                "web_push_p256dh": {"type": "string"},
                "web_push_auth": {"type": "string"},
                "custom_fields": {
                    "type": "object",
                    "description": "Optional extras → CDP custom_fields JSON (merged).",
                    "additionalProperties": True,
                },
                "user_confirmed": {
                    "type": "boolean",
                    "description": "Must be true only after user said yes to update.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["contact_id", "user_confirmed", "change_summary"],
        },
    },
}

REQUEST_DELETE = {
    "type": "function",
    "function": {
        "name": "REQUEST_DELETE",
        "description": (
            "Mark a contact pending delete and ask the user to confirm. "
            "Do not delete yet."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["contact_id", "change_summary"],
        },
    },
}

CONFIRM_DELETE = {
    "type": "function",
    "function": {
        "name": "CONFIRM_DELETE",
        "description": (
            "After REQUEST_DELETE, call with confirmed=true only on explicit yes. "
            "confirmed=false cancels."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "confirmed": {"type": "boolean"},
                "change_summary": {"type": "string"},
            },
            "required": ["confirmed", "change_summary"],
        },
    },
}

IMPORT_CONTACTS = {
    "type": "function",
    "function": {
        "name": "IMPORT_CONTACTS",
        "description": (
            "Bulk-import contacts (CCUIA). Pass parsed rows from a CSV/list the user provided. "
            "Prefer dry_run=true first. Weak consent (verbal/unknown) holds the import until "
            "compliance_acknowledged=true after the user confirms review. "
            "Max 500 rows via agent; use Audience Import UI for larger files."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "dry_run": {"type": "boolean"},
                "upsert": {"type": "boolean"},
                "consent_source": {"type": "string"},
                "compliance_acknowledged": {"type": "boolean"},
                "rows": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "first_name": {"type": "string"},
                            "last_name": {"type": "string"},
                            "email": {"type": "string"},
                            "phone": {"type": "string"},
                            "company_name": {"type": "string"},
                            "city": {"type": "string"},
                            "name": {"type": "string"},
                        },
                    },
                },
                "change_summary": {"type": "string"},
            },
            "required": ["rows", "change_summary"],
        },
    },
}

GET_COMPANY_PACK = {
    "type": "function",
    "function": {
        "name": "GET_COMPANY_PACK",
        "description": (
            "Load this company's industry pack (seeded fields + editable rules). "
            "Use when the user asks what rules/fields the company pack has."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

ADD_COMPANY_RULE = {
    "type": "function",
    "function": {
        "name": "ADD_COMPANY_RULE",
        "description": (
            "Add a lasting company pack rule (e.g. prefer phone for WhatsApp). "
            "Confirm with the user first."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["text", "change_summary"],
        },
    },
}

UPDATE_COMPANY_RULE = {
    "type": "function",
    "function": {
        "name": "UPDATE_COMPANY_RULE",
        "description": "Edit an existing company pack rule by id.",
        "parameters": {
            "type": "object",
            "properties": {
                "rule_id": {"type": "string"},
                "text": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["rule_id", "text", "change_summary"],
        },
    },
}

DELETE_COMPANY_RULE = {
    "type": "function",
    "function": {
        "name": "DELETE_COMPANY_RULE",
        "description": "Delete a company pack rule by id after user confirms.",
        "parameters": {
            "type": "object",
            "properties": {
                "rule_id": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["rule_id", "change_summary"],
        },
    },
}

UPSERT_PACK_FIELD = {
    "type": "function",
    "function": {
        "name": "UPSERT_PACK_FIELD",
        "description": (
            "Add or update a soft field hint on the company pack "
            "(not a forced create ask)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "label": {"type": "string"},
                "type": {"type": "string", "enum": ["string", "number"]},
                "ask": {"type": "string", "enum": ["optional", "recommended"]},
                "change_summary": {"type": "string"},
            },
            "required": ["key", "change_summary"],
        },
    },
}

CONFIRM_PACK_FIELD = {
    "type": "function",
    "function": {
        "name": "CONFIRM_PACK_FIELD",
        "description": (
            "Confirm a suggested learned field so it stays on the company pack."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["key", "change_summary"],
        },
    },
}

DELETE_PACK_FIELD = {
    "type": "function",
    "function": {
        "name": "DELETE_PACK_FIELD",
        "description": "Remove a field hint from the company pack.",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["key", "change_summary"],
        },
    },
}

from app.agents.routing import ROUTE_TO_MODULE_SCHEMA

# --- Jun30-facing Audience tools (prompt uses these names) ---

GET_CONTACT_DETAIL = {
    "type": "function",
    "function": {
        "name": "GET_CONTACT_DETAIL",
        "description": (
            "Look up the directory by email, phone, WhatsApp number, or full name. "
            "During contact_creation, call after each valid email or phone is saved. "
            "If a match exists while creating, keep create mode and offer a different "
            "identity or opening the match — the panel shows a clickable Existing match. "
            "If no match during create, proceed silently (do not tell the user nothing was found)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "input_field": {
                    "type": "string",
                    "description": (
                        "Email address, phone number, WhatsApp number, or full name"
                    ),
                },
            },
            "required": ["input_field"],
        },
    },
}

QUERY_CONTACTS = {
    "type": "function",
    "function": {
        "name": "QUERY_CONTACTS",
        "description": (
            "Find or list contacts from a natural-language view/filter request, or when "
            "the user gave two or more criteria (name+city, email+company, etc.). "
            "Pass the full user intent (merge memory: city, age, has email, etc.). "
            "Runs read-only SQL retrieval. "
            "Do not use for a single known email/phone/name/id (use VIEW_CONTACT instead)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_request": {
                    "type": "string",
                    "description": (
                        "Required. Full restatement of which contacts to show: the user's "
                        "latest message plus any filter criteria from chat_memory_note and "
                        "recent_chat (city, company, industry, age, gender, country, has "
                        "email/phone, etc.). The read-only SQL agent uses this text only."
                    ),
                },
                "change_summary": {
                    "type": "string",
                    "description": "Short note for logs (required).",
                },
            },
            "required": ["user_request", "change_summary"],
        },
    },
}

VIEW_CONTACT = {
    "type": "function",
    "function": {
        "name": "VIEW_CONTACT",
        "description": (
            "Show one contact by a single known identity — email, phone, full name, or "
            "contact_id after the user picks from a list. Validate email/phone format first. "
            "Not for filter/list queries or two+ criteria (use QUERY_CONTACTS for those)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "Load one contact by CRM id (after user picks from a list).",
                },
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "full_name": {
                    "type": "string",
                    "description": "Person name when email/phone are unknown.",
                },
                "city": {"type": "string"},
                "company": {"type": "string"},
                "job_title": {"type": "string"},
                "search": {
                    "type": "string",
                    "description": "Free-text filter when no structured field fits.",
                },
                "has_email": {"type": "boolean"},
                "has_phone": {"type": "boolean"},
                "change_summary": {
                    "type": "string",
                    "description": "Short note for logs (required).",
                },
            },
            "required": ["change_summary"],
        },
    },
}

CONTACT_VIEW_AND_DOWNLOAD = {
    "type": "function",
    "function": {
        "name": "CONTACT_VIEW_AND_DOWNLOAD",
        "description": (
            "Views, filters, or lists contacts based on the user's request. "
            "Use the user's query exactly as provided."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "User search/filter query exactly as provided.",
                },
            },
            "required": ["query"],
        },
    },
}

CREATE_SINGLE_CONTACT = {
    "type": "function",
    "function": {
        "name": "CREATE_SINGLE_CONTACT",
        "description": (
            "Persist the contact after the user positively confirmed the summary. "
            "Requires first name and email or phone on draft and user_confirmed=true."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "firstName": {"type": "string"},
                "lastName": {"type": "string"},
                "email": {"type": "string"},
                "whatsappNumber": {"type": "string"},
                "phoneNumber": {"type": "string"},
                "CompanyName": {"type": "string"},
                "city": {"type": "string"},
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "phone": {"type": "string"},
                "company_name": {"type": "string"},
                "custom_fields": {"type": "object", "additionalProperties": True},
                "user_confirmed": {
                    "type": "boolean",
                    "description": "True only after the user clearly agreed to create.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["firstName", "user_confirmed", "change_summary"],
        },
    },
}

CREATE_BULK_CONTACT = {
    "type": "function",
    "function": {
        "name": "CREATE_BULK_CONTACT",
        "description": "Creates multiple contacts using uploaded CSV or Excel file.",
        "parameters": {
            "type": "object",
            "properties": {
                "fileUrl": {
                    "type": "string",
                    "description": "Uploaded CSV or Excel file URL",
                },
                "isTemp": {
                    "type": "integer",
                    "description": "0 for permanent contacts (Audience uses 0 only)",
                },
                "rows": {
                    "type": "array",
                    "description": "Parsed sheet rows when already available",
                    "items": {"type": "object", "additionalProperties": True},
                },
                "change_summary": {"type": "string"},
            },
            "required": ["isTemp"],
        },
    },
}

UPDATE_SINGLE_CONTACT = {
    "type": "function",
    "function": {
        "name": "UPDATE_SINGLE_CONTACT",
        "description": (
            "Updates an existing contact using contact ID and updated fields. "
            "Only include fields the user wants to update."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "contact_id": {"type": "string"},
                "firstName": {"type": "string"},
                "lastName": {"type": "string"},
                "email": {"type": "string"},
                "whatsappNumber": {"type": "string"},
                "phoneNumber": {"type": "string"},
                "CompanyName": {"type": "string"},
                "city": {"type": "string"},
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "phone": {"type": "string"},
                "company_name": {"type": "string"},
                "custom_fields": {"type": "object", "additionalProperties": True},
                "change_summary": {"type": "string"},
            },
            "required": ["id"],
        },
    },
}

UPDATE_BULK_CONTACT = {
    "type": "function",
    "function": {
        "name": "UPDATE_BULK_CONTACT",
        "description": "Updates multiple contacts using uploaded CSV or Excel file.",
        "parameters": {
            "type": "object",
            "properties": {
                "fileUrl": {"type": "string"},
                "isTemp": {
                    "type": "integer",
                    "description": "0 for permanent contacts",
                },
                "rows": {
                    "type": "array",
                    "items": {"type": "object", "additionalProperties": True},
                },
                "change_summary": {"type": "string"},
            },
            "required": ["isTemp"],
        },
    },
}

ALL_TOOLS = [
    SET_DRAFT_FIELDS,
    GET_CONTACT_DETAIL,
    CONTACT_VIEW_AND_DOWNLOAD,
    CREATE_SINGLE_CONTACT,
    CREATE_BULK_CONTACT,
    UPDATE_SINGLE_CONTACT,
    UPDATE_BULK_CONTACT,
    ROUTE_TO_MODULE_SCHEMA,
]

# Full catalog for MAS executor subsets (allowlist in tool_adapters.py).
_CONTACT_TOOL_CATALOG = [
    VIEW_CONTACT,
    QUERY_CONTACTS,
    LOOKUP_CONTACT,
    GET_CONTACT,
    SEARCH_CONTACTS,
    SET_DRAFT_FIELDS,
    VERIFY_FOCUS_IDENTITY,
    CREATE_CONTACT,
    UPDATE_CONTACT,
    IMPORT_CONTACTS,
    GET_COMPANY_PACK,
    ADD_COMPANY_RULE,
    UPDATE_COMPANY_RULE,
    DELETE_COMPANY_RULE,
    UPSERT_PACK_FIELD,
    CONFIRM_PACK_FIELD,
    DELETE_PACK_FIELD,
    GET_CONTACT_DETAIL,
    CONTACT_VIEW_AND_DOWNLOAD,
    CREATE_SINGLE_CONTACT,
    CREATE_BULK_CONTACT,
    UPDATE_SINGLE_CONTACT,
    UPDATE_BULK_CONTACT,
    ROUTE_TO_MODULE_SCHEMA,
]

_CONTACT_TOOL_INDEX = {
    str(t["function"]["name"]): t for t in _CONTACT_TOOL_CATALOG
}


def contact_tool_schemas_for_names(names: frozenset[str] | set[str]) -> list:
    """OpenAI tool schemas for an explicit skill allowlist."""
    out = []
    for name in names:
        tool = _CONTACT_TOOL_INDEX.get(str(name))
        if tool:
            out.append(tool)
    return out


def tools_for_mas_audience_executor(executor_id: str) -> list:
    """OpenAI tool schemas for one Audience MAS executor (bounded subset)."""
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    eid = str(executor_id or "").strip().lower()
    names = EXECUTOR_TOOL_ALLOWLIST.get(eid, frozenset())
    return [_CONTACT_TOOL_INDEX[n] for n in names if n in _CONTACT_TOOL_INDEX]
