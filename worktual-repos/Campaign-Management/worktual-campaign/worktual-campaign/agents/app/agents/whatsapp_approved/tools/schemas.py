"""Tools for approved WhatsApp template run agent (direct send, no template edit)."""

SET_AUDIENCE = {
    "type": "function",
    "function": {
        "name": "SET_AUDIENCE",
        "description": (
            "Store who will receive this approved template. Pass phones "
            "(digits with country code) and/or contact_ids from a prior filter. "
            "Call whenever the user names recipients."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "phones": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "E.g. 919876543210 — digits only, country code included",
                },
                "contact_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Selected contact UUIDs (from FILTER_CONTACTS)",
                },
                "mode": {
                    "type": "string",
                    "enum": ["replace", "add"],
                    "description": "replace (default) or add to existing audience",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

FILTER_CONTACTS = {
    "type": "function",
    "function": {
        "name": "FILTER_CONTACTS",
        "description": (
            "Find contacts by email, phone, city, company, or name (search). "
            "ALWAYS use this when the user gives a person name or email — "
            "do not ask for a phone first. Stores matching contact_ids as audience."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "search": {"type": "string"},
                "emails": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "phones": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "city": {"type": "string"},
                "company_name": {"type": "string"},
                "mode": {
                    "type": "string",
                    "enum": ["replace", "add"],
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

SEND_APPROVED_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "SEND_APPROVED_TEMPLATE",
        "description": (
            "Send the approved WhatsApp template as-is to the stored audience "
            "via the Campaign regulated send API (social Meta send). "
            "ONLY after the user explicitly confirms yes. Does NOT edit or "
            "resubmit the template."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_confirmed": {"type": "boolean"},
                "body_params": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Ordered values for {{1}}, {{2}}, … if the template has variables",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["user_confirmed", "change_summary"],
        },
    },
}

UPLOAD_TEMPORARY_CONTACTS = {
    "type": "function",
    "function": {
        "name": "UPLOAD_TEMPORARY_CONTACTS",
        "description": (
            "Store a temporary contact sheet for this approved-template run "
            "(campaign-only, not permanent CRM). Call when rows are provided "
            "from an uploaded CSV or when the user message references a sheet upload."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "rows": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Parsed sheet rows (firstName, email, phone, …)",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["rows", "change_summary"],
        },
    },
}

LAUNCH_APPROVED_CAMPAIGN = {
    "type": "function",
    "function": {
        "name": "LAUNCH_APPROVED_CAMPAIGN",
        "description": (
            "Create a Monitoring campaign and schedule WhatsApp sends using the "
            "already-approved template and current audience. Use when the user "
            "confirms send now or a scheduled date/time. Does not edit the template."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_confirmed": {"type": "boolean"},
                "schedule_mode": {
                    "type": "string",
                    "enum": ["now", "scheduled"],
                    "description": "Send now or schedule for later",
                },
                "launch_local_date": {
                    "type": "string",
                    "description": "YYYY-MM-DD when schedule_mode=scheduled",
                },
                "launch_local_time": {
                    "type": "string",
                    "description": "HH:MM local when schedule_mode=scheduled",
                },
                "scheduled_at": {
                    "type": "string",
                    "description": "Optional ISO UTC schedule",
                },
                "timezone": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["user_confirmed", "change_summary"],
        },
    },
}

ALL_TOOLS = [
    SET_AUDIENCE,
    FILTER_CONTACTS,
    UPLOAD_TEMPORARY_CONTACTS,
    SEND_APPROVED_TEMPLATE,
    LAUNCH_APPROVED_CAMPAIGN,
]

_WHATSAPP_APPROVED_TOOL_INDEX = {
    str(t["function"]["name"]): t for t in ALL_TOOLS
}


def whatsapp_approved_tool_schemas_for_names(names: frozenset[str] | set[str]) -> list:
    """Resolve OpenAI tool schemas for approved-WA skill tool_names."""
    out: list = []
    for name in names:
        tool = _WHATSAPP_APPROVED_TOOL_INDEX.get(str(name))
        if tool:
            out.append(tool)
    return out
