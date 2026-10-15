"""OpenAI tool schemas for template-edit specialists (in-process MCP catalog)."""

from __future__ import annotations

from typing import Any

from app.agents.create_campaign.tools import SEARCH_KNOWLEDGE
from app.agents.template_library.edit_tools import (
    APPLY_TEMPLATE_CHANGES,
    HANDOFF_CAMPAIGN_LAUNCH,
    SET_EMAIL_THEME,
    SET_FOOTER_SOCIAL_LINKS,
)

SHOW_CURRENT_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "show_current_template",
        "description": (
            "Return a compact snapshot of the live template on the right "
            "(not the full HTML). Optional focus for a short excerpt."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Optional: footer, ctas, hero, body.",
                }
            },
        },
    },
}

LIST_SESSION_IMAGES = {
    "type": "function",
    "function": {
        "name": "list_session_images",
        "description": (
            "List images already in this campaign session: this-turn uploads, "
            "earlier chat uploads (status in_session — already stored, not waiting), "
            "and selected gallery images. Use when the user refers to a previous photo."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}

ATTACH_UPLOADED_IMAGE = {
    "type": "function",
    "function": {
        "name": "attach_uploaded_image",
        "description": (
            "Place a session image onto this template. Pass image_id from the "
            "library or an https image_url. placement: hero, bottom, or before_footer "
            "for email; header/icon for other channels."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_id": {"type": "string"},
                "image_url": {"type": "string"},
                "placement": {
                    "type": "string",
                    "description": "hero | bottom | before_footer | header",
                },
            },
        },
    },
}

GENERATE_IMAGE = {
    "type": "function",
    "function": {
        "name": "generate_image",
        "description": (
            "Create a new AI photo and store it on the public media host. "
            "Returns an https /api/media URL. Does not change the live template — "
            "call request_template_change with that URL to place it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "brief": {"type": "string"},
            },
            "required": ["brief"],
        },
    },
}

ENHANCE_IMAGE = {
    "type": "function",
    "function": {
        "name": "enhance_image",
        "description": (
            "Generate a stronger campaign photo from a brief and a current hero or library "
            "image. Returns an https /api/media URL. Does not place it — call "
            "request_template_change with that URL."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_id": {"type": "string"},
                "brief": {"type": "string"},
            },
            "required": ["brief"],
        },
    },
}

REQUEST_TEMPLATE_CHANGE = {
    "type": "function",
    "function": {
        "name": "request_template_change",
        "description": (
            "Hand a job to the template modification agent. Always explain the change. "
            "Pass image_urls (rebuild https) to place photos; pass placement hero, "
            "bottom, or before_footer. For copy/layout/CTA/theme, explanation is enough."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "explanation": {
                    "type": "string",
                    "description": "What the canvas agent must do, in full sentences.",
                },
                "image_urls": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Public https /api/media URLs to place.",
                },
                "image_id": {"type": "string"},
                "placement": {
                    "type": "string",
                    "description": "hero | bottom | before_footer | header",
                },
            },
            "required": ["explanation"],
        },
    },
}

REMOVE_IMAGE = {
    "type": "function",
    "function": {
        "name": "remove_image",
        "description": "Remove the current hero/header image from this template.",
        "parameters": {"type": "object", "properties": {}},
    },
}

EDIT_EMAIL_HTML = {
    "type": "function",
    "function": {
        "name": "edit_email_html",
        "description": (
            "Edit the live email HTML for copy, layout, or colors. Cannot create photos. "
            "Do not add links without an https href from the user, KB, or live template."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "instruction": {"type": "string"},
            },
            "required": ["instruction"],
        },
    },
}

ADD_CTA = {
    "type": "function",
    "function": {
        "name": "add_cta",
        "description": (
            "Add a button/link. url is required (https from the user, KB, or live template). "
            "Without a url this tool does not write a button."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "label": {"type": "string"},
                "placement": {"type": "string"},
            },
            "required": ["url"],
        },
    },
}

UPDATE_CTA = {
    "type": "function",
    "function": {
        "name": "update_cta",
        "description": "Change an existing CTA url or label. url must be https if provided.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "label": {"type": "string"},
            },
        },
    },
}

REMOVE_CTA = {
    "type": "function",
    "function": {
        "name": "remove_cta",
        "description": "Remove CTA buttons from this email.",
        "parameters": {"type": "object", "properties": {}},
    },
}

REDESIGN_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "redesign_template",
        "description": (
            "Rebuild layout via the Template Generation Director. For a new structure, "
            "not a one-line copy tweak."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "instruction": {"type": "string"},
                "preserve_copy": {"type": "boolean"},
                "preserve_hero": {"type": "boolean"},
            },
            "required": ["instruction"],
        },
    },
}

UNDO_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "undo_template",
        "description": "Restore the previous saved version of this template.",
        "parameters": {"type": "object", "properties": {}},
    },
}

REDO_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "redo_template",
        "description": "Reapply the version after an undo.",
        "parameters": {"type": "object", "properties": {}},
    },
}

SAVE_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "save_template",
        "description": "Mark current fields to persist (no extra copy changes).",
        "parameters": {"type": "object", "properties": {}},
    },
}

GET_EDIT_PREFERENCES = {
    "type": "function",
    "function": {
        "name": "get_edit_preferences",
        "description": "Read soft/hard edit preferences for this session.",
        "parameters": {"type": "object", "properties": {}},
    },
}

UPDATE_EDIT_PREFERENCE = {
    "type": "function",
    "function": {
        "name": "update_edit_preference",
        "description": "Save a preference. kind is soft or hard.",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "value": {"type": "string"},
                "kind": {"type": "string", "enum": ["soft", "hard"]},
            },
            "required": ["key", "value"],
        },
    },
}

VERIFY_HARD_PREFERENCES = {
    "type": "function",
    "function": {
        "name": "verify_hard_preferences",
        "description": "Check a proposed action against hard preferences.",
        "parameters": {
            "type": "object",
            "properties": {"proposed_action": {"type": "string"}},
        },
    },
}

_ALL: dict[str, dict[str, Any]] = {
    t["function"]["name"]: t
    for t in (
        SHOW_CURRENT_TEMPLATE,
        LIST_SESSION_IMAGES,
        ATTACH_UPLOADED_IMAGE,
        GENERATE_IMAGE,
        ENHANCE_IMAGE,
        REQUEST_TEMPLATE_CHANGE,
        REMOVE_IMAGE,
        SEARCH_KNOWLEDGE,
        SET_FOOTER_SOCIAL_LINKS,
        REDESIGN_TEMPLATE,
        UNDO_TEMPLATE,
        REDO_TEMPLATE,
        SAVE_TEMPLATE,
        HANDOFF_CAMPAIGN_LAUNCH,
        GET_EDIT_PREFERENCES,
        UPDATE_EDIT_PREFERENCE,
        VERIFY_HARD_PREFERENCES,
        EDIT_EMAIL_HTML,
        ADD_CTA,
        UPDATE_CTA,
        REMOVE_CTA,
        SET_EMAIL_THEME,
        APPLY_TEMPLATE_CHANGES,
    )
}


def schemas_for_names(names: tuple[str, ...] | list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for name in names:
        schema = _ALL.get(name)
        if schema:
            out.append(schema)
    return out
