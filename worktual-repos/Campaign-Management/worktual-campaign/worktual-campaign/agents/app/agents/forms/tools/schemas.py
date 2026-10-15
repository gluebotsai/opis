"""OpenAI-style tools for the main Form Event agent (routes to specialists)."""

from app.agents.routing import ROUTE_TO_MODULE_SCHEMA

RUN_THEME_SPECIALIST = {
    "type": "function",
    "function": {
        "name": "RUN_THEME_SPECIALIST",
        "description": (
            "Internal Theme specialist: colors, background, logo, spacing, button text. "
            "Use ONLY when the user asked to change look/style — not for campaign workflow."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "instruction": {
                    "type": "string",
                    "description": "Exact user wording for the theme/style change.",
                },
            },
            "required": ["instruction"],
        },
    },
}

RUN_FIELDS_SPECIALIST = {
    "type": "function",
    "function": {
        "name": "RUN_FIELDS_SPECIALIST",
        "description": (
            "Internal Fields specialist: add/remove/rename/reorder fields, defaults, "
            "title, description, thank-you copy. Use for layout AND prefills. "
            "Do NOT use for publish, save, launch, or campaign — use ROUTE_TO_CREATE_CAMPAIGN."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "instruction": {
                    "type": "string",
                    "description": "Exact user wording for the fields/copy change.",
                },
            },
            "required": ["instruction"],
        },
    },
}

RUN_DESIGN_SPECIALIST = {
    "type": "function",
    "function": {
        "name": "RUN_DESIGN_SPECIALIST",
        "description": (
            "Internal Full Design specialist: create or fully redesign the form "
            "(fields + theme). Use for new form goals or major overhauls — not campaigns."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "instruction": {
                    "type": "string",
                    "description": "Overall form goal or redesign request.",
                },
            },
            "required": ["instruction"],
        },
    },
}

ROUTE_TO_CREATE_CAMPAIGN = {
    "type": "function",
    "function": {
        "name": "ROUTE_TO_CREATE_CAMPAIGN",
        "description": (
            "Hand off to Create campaign when the user wants to promote, launch, or "
            "send this form. Call ONLY this tool for campaign/save/publish/launch intent — "
            "never mix with field/theme/design specialists in the same turn. "
            "Set user_confirmed=true only if they explicitly approved in this message "
            "(e.g. yes, looks good, create campaign now). Otherwise set user_confirmed=false "
            "so the app asks them to confirm before navigating."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_goal": {
                    "type": "string",
                    "description": (
                        "Restated campaign intent (audience, goal, channels) from the user."
                    ),
                },
                "user_confirmed": {
                    "type": "boolean",
                    "description": (
                        "True when the user clearly approved opening Create campaign "
                        "in this message. False when you still need their yes."
                    ),
                },
                "change_summary": {
                    "type": "string",
                    "description": "Short line shown to the user when navigation happens.",
                },
            },
            "required": ["user_confirmed", "change_summary"],
        },
    },
}

# Narrow ROUTE_TO_MODULE for non-campaign destinations (audience, dashboard, etc.).
_FORMS_ROUTE_TO_MODULE = {
    **ROUTE_TO_MODULE_SCHEMA,
    "function": {
        **ROUTE_TO_MODULE_SCHEMA["function"],
        "description": (
            "Route to another workspace when the request is NOT about creating a campaign "
            "for this form (e.g. audience/contacts, dashboard, monitoring). "
            "For create campaign / launch / promote this form, use ROUTE_TO_CREATE_CAMPAIGN."
        ),
    },
}

ROUTE_TOOLS = frozenset({"ROUTE_TO_CREATE_CAMPAIGN", "ROUTE_TO_MODULE"})

# Main agent only sees specialist routers (not raw APPLY_* JSON tools).
ALL_TOOLS = [
    RUN_THEME_SPECIALIST,
    RUN_FIELDS_SPECIALIST,
    RUN_DESIGN_SPECIALIST,
    ROUTE_TO_CREATE_CAMPAIGN,
    _FORMS_ROUTE_TO_MODULE,
]

SPECIALIST_TOOLS = frozenset(
    {
        "RUN_THEME_SPECIALIST",
        "RUN_FIELDS_SPECIALIST",
        "RUN_DESIGN_SPECIALIST",
    }
)

# Kept for handlers that still apply design payloads.
DESIGN_APPLY_TOOLS = SPECIALIST_TOOLS


def tools_for_mas_forms_executor(executor_id: str) -> list:
    """OpenAI tool schemas for one Forms MAS executor (bounded subset)."""
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    eid = str(executor_id or "form_theme").strip().lower()
    names = EXECUTOR_TOOL_ALLOWLIST.get(eid, frozenset())
    catalog = {str(t["function"]["name"]): t for t in ALL_TOOLS}
    return [catalog[n] for n in names if n in catalog]

