"""Tools for rejected WhatsApp template agent (FE applies via ui_events + optional HTTP)."""

SET_TEMPLATE_FIELDS = {
    "type": "function",
    "function": {
        "name": "SET_TEMPLATE_FIELDS",
        "description": (
            "Update the rejected template draft fields (name, header, body, footer, buttons). "
            "Call whenever the user provides revised copy."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "header": {"type": "string"},
                "body": {"type": "string"},
                "footer": {"type": "string"},
                "buttons": {
                    "type": "string",
                    "description": "Newline-separated button labels",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

SUBMIT_FOR_APPROVAL = {
    "type": "function",
    "function": {
        "name": "SUBMIT_FOR_APPROVAL",
        "description": (
            "Ask FE to save a new draft (new unique name) and submit to Meta. "
            "Only after the user explicitly confirms yes."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_confirmed": {"type": "boolean"},
                "change_summary": {"type": "string"},
            },
            "required": ["user_confirmed", "change_summary"],
        },
    },
}

ALL_TOOLS = [SET_TEMPLATE_FIELDS, SUBMIT_FOR_APPROVAL]
