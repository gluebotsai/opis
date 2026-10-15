"""OpenAI-style tools for Image MAS executors."""

from __future__ import annotations

ENHANCE_IMAGE_PROMPT = {
    "type": "function",
    "function": {
        "name": "ENHANCE_IMAGE_PROMPT",
        "description": (
            "Expand a described image idea into a full marketing visual brief "
            "(subject, setting, lighting, materials, composition, mood, channel crop). "
            "Call this only after the user described what to generate. "
            "Do not invent a scene from campaign name. Always before GENERATE_IMAGE."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_prompt": {
                    "type": "string",
                    "description": (
                        "What the user wants in the picture (subject, setting, style, "
                        "any exact words). Required — do not omit to auto-fill from campaign."
                    ),
                },
                "channel": {
                    "type": "string",
                    "description": "Optional channel hint: email, whatsapp, web, push.",
                },
                "aspect_hint": {
                    "type": "string",
                    "description": "Optional aspect/placement hint: hero, banner, thumbnail, 16:9, 1:1.",
                },
                "campaign_name": {
                    "type": "string",
                    "description": "Optional campaign name from session context.",
                },
                "campaign_goal": {
                    "type": "string",
                    "description": "Optional campaign goal/objective.",
                },
                "must_include": {
                    "type": "string",
                    "description": "Only if user explicitly asked to include something.",
                },
                "must_avoid": {
                    "type": "string",
                    "description": "Only if user explicitly asked to avoid something (brand-safe).",
                },
                "style_hint": {
                    "type": "string",
                    "description": "Only if user gave a style preference.",
                },
            },
            "required": ["user_prompt"],
        },
    },
}

GENERATE_IMAGE = {
    "type": "function",
    "function": {
        "name": "GENERATE_IMAGE",
        "description": (
            "Generate a campaign image from the stored ENHANCE_IMAGE_PROMPT brief. "
            "Call only after the user confirmed that brief. Pass user_confirmed=true. "
            "Do not pass raw user chat. Prefer the stored last_enhanced_prompt."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "enhanced_prompt": {
                    "type": "string",
                    "description": (
                        "Full visual brief from ENHANCE_IMAGE_PROMPT. Optional when "
                        "last_enhanced_prompt is already stored on the session."
                    ),
                },
                "enhance_id": {
                    "type": "string",
                    "description": "Optional enhance_id returned by ENHANCE_IMAGE_PROMPT.",
                },
                "user_confirmed": {
                    "type": "boolean",
                    "description": (
                        "True only after the user saw the enhanced brief and asked "
                        "to generate. Gemini is not called without this."
                    ),
                },
            },
        },
    },
}

REFINE_IMAGE = {
    "type": "function",
    "function": {
        "name": "REFINE_IMAGE",
        "description": (
            "Edit the last generated image using an enhanced edit brief. "
            "Call ENHANCE_IMAGE_PROMPT first for the edit instruction."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "enhanced_prompt": {
                    "type": "string",
                    "description": "Enhanced edit instruction from ENHANCE_IMAGE_PROMPT.",
                },
                "source_image_url": {
                    "type": "string",
                    "description": (
                        "Optional URL of image to edit; defaults to last generated image."
                    ),
                },
            },
            "required": ["enhanced_prompt"],
        },
    },
}

ATTACH_IMAGE = {
    "type": "function",
    "function": {
        "name": "ATTACH_IMAGE",
        "description": (
            "Attach the last generated image URL to a template field or section. "
            "Use after GENERATE_IMAGE or REFINE_IMAGE when editing a template."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "template_id": {
                    "type": "string",
                    "description": "Channel template id to update.",
                },
                "image_url": {
                    "type": "string",
                    "description": "Image URL to attach; defaults to last generated.",
                },
                "field_key": {
                    "type": "string",
                    "description": (
                        "Template field key, e.g. header_image, hero_image, image_url."
                    ),
                },
                "section_index": {
                    "type": "integer",
                    "description": "Optional email section index for type=image blocks.",
                },
                "replace_section": {
                    "type": "boolean",
                    "description": (
                        "True when replacing an existing image URL (change hero/product), "
                        "not filling an empty slot."
                    ),
                },
                "attach_target": {
                    "type": "string",
                    "enum": ["hero", "product", "last_filled_image", "next_empty_slot"],
                    "description": "Which slot to update when section_index is omitted.",
                },
            },
            "required": ["template_id"],
        },
    },
}

GET_LAST_IMAGE = {
    "type": "function",
    "function": {
        "name": "GET_LAST_IMAGE",
        "description": "Return the last enhanced prompt and image URL from this session.",
        "parameters": {"type": "object", "properties": {}},
    },
}

PLAN_CAMPAIGN_IMAGES = {
    "type": "function",
    "function": {
        "name": "PLAN_CAMPAIGN_IMAGES",
        "description": (
            "Save whether this campaign needs template images, which channels, and "
            "shared vs per-channel mode. Call when the user wants visuals on templates "
            "(email hero, multiple product images, WhatsApp header, etc.). Template "
            "Director may also infer image slots from chat during build_campaign. "
            "Image-capable channels: email, whatsapp, web (when selected). "
            "Confirmed chat uploads are preferred over AI."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "wants_images": {
                    "type": "boolean",
                    "description": "True when the user wants campaign template images.",
                },
                "channels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Subset of channels for images, e.g. ['email'] or "
                        "['email','whatsapp']. Omit when scope=all_eligible."
                    ),
                },
                "scope": {
                    "type": "string",
                    "enum": ["all_eligible", "subset"],
                    "description": (
                        "all_eligible = every selected channel that supports images; "
                        "subset = use channels list."
                    ),
                },
                "mode": {
                    "type": "string",
                    "enum": ["shared", "per_channel"],
                    "description": (
                        "shared = one image on all planned channels; "
                        "per_channel = different image per channel."
                    ),
                },
                "auto_after_build": {
                    "type": "boolean",
                    "description": (
                        "When true (default), generate+attach runs automatically after "
                        "build_campaign when templates exist."
                    ),
                },
                "user_confirmed": {"type": "boolean"},
            },
            "required": ["wants_images"],
        },
    },
}

GENERATE_CAMPAIGN_IMAGES = {
    "type": "function",
    "function": {
        "name": "GENERATE_CAMPAIGN_IMAGES",
        "description": (
            "Generate campaign images per the saved plan — shared or per channel. "
            "Requires PLAN_CAMPAIGN_IMAGES and existing templates for best alignment."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "channels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional override of plan channels.",
                },
                "mode": {
                    "type": "string",
                    "enum": ["shared", "per_channel"],
                    "description": "Optional override of plan mode.",
                },
            },
        },
    },
}

ATTACH_CAMPAIGN_IMAGES = {
    "type": "function",
    "function": {
        "name": "ATTACH_CAMPAIGN_IMAGES",
        "description": (
            "Attach generated images to template fields per channel (email header_image, "
            "WhatsApp header_media_url). Uses images_by_channel from last generate step."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "channels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional subset to attach; defaults to generated channels.",
                },
            },
        },
    },
}

RUN_CAMPAIGN_IMAGE_PIPELINE = {
    "type": "function",
    "function": {
        "name": "RUN_CAMPAIGN_IMAGE_PIPELINE",
        "description": (
            "Run GENERATE_CAMPAIGN_IMAGES then ATTACH_CAMPAIGN_IMAGES per the saved plan."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}

CONFIRM_CHAT_IMAGES = {
    "type": "function",
    "function": {
        "name": "CONFIRM_CHAT_IMAGES",
        "description": (
            "After the user uploads image(s) in create-campaign chat, ask whether to "
            "add them into templates, then call this tool with include_in_templates="
            "true|false. Optional asset_ids and channels. Confirmed URLs are preferred "
            "over AI generation on build/attach."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "include_in_templates": {
                    "type": "boolean",
                    "description": (
                        "True when the user wants these uploads in templates; "
                        "false to discard for template use."
                    ),
                },
                "asset_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Optional pending image ids; omit to apply to all pending uploads."
                    ),
                },
                "channels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Optional image-capable channels (email, whatsapp, web). "
                        "Defaults to selected capable channels."
                    ),
                },
            },
            "required": ["include_in_templates"],
        },
    },
}

CLEAR_CHAT_IMAGES = {
    "type": "function",
    "function": {
        "name": "CLEAR_CHAT_IMAGES",
        "description": (
            "Drop pending and confirmed chat uploads so they are not reused. "
            "Call when the user asks to generate new or different images and did not "
            "upload a file on this turn. Then plan_campaign_images / build_campaign."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pending": {
                    "type": "boolean",
                    "description": "Clear pending uploads. Default true.",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Clear confirmed uploads. Default true.",
                },
            },
        },
    },
}

_ALL = [
    ENHANCE_IMAGE_PROMPT,
    GENERATE_IMAGE,
    REFINE_IMAGE,
    ATTACH_IMAGE,
    GET_LAST_IMAGE,
    PLAN_CAMPAIGN_IMAGES,
    GENERATE_CAMPAIGN_IMAGES,
    ATTACH_CAMPAIGN_IMAGES,
    RUN_CAMPAIGN_IMAGE_PIPELINE,
    CONFIRM_CHAT_IMAGES,
    CLEAR_CHAT_IMAGES,
]

_TOOL_BY_NAME = {str(t["function"]["name"]): t for t in _ALL}
_TOOL_BY_NAME["plan_campaign_images"] = PLAN_CAMPAIGN_IMAGES


def tools_for_mas_image_executor(executor_id: str) -> list:
    """Bounded tool subset per Image MAS executor."""
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    eid = str(executor_id or "image_generate").strip().lower()
    names = EXECUTOR_TOOL_ALLOWLIST.get(eid, frozenset())
    return [_TOOL_BY_NAME[n] for n in names if n in _TOOL_BY_NAME]


__all__ = [
    "ATTACH_CAMPAIGN_IMAGES",
    "ATTACH_IMAGE",
    "ENHANCE_IMAGE_PROMPT",
    "GENERATE_CAMPAIGN_IMAGES",
    "GENERATE_IMAGE",
    "GET_LAST_IMAGE",
    "PLAN_CAMPAIGN_IMAGES",
    "REFINE_IMAGE",
    "RUN_CAMPAIGN_IMAGE_PIPELINE",
    "CONFIRM_CHAT_IMAGES",
    "CLEAR_CHAT_IMAGES",
    "tools_for_mas_image_executor",
]
