"""Create-campaign OpenAI tool schemas — LLM-facing tools only (jun30-style tools file)."""

# web / web_push = browser notifications. push / app_push = mobile app. Never mix.
_CHANNEL_ENUM = ["email", "whatsapp", "web", "push", "web_push", "app_push"]
_CHANNEL_ITEM = {
    "type": "string",
    "enum": _CHANNEL_ENUM,
    "description": (
        "email; whatsapp; web or web_push = browser web push (never pass push for this); "
        "push or app_push = mobile app push."
    ),
}
_CHANNELS_ARRAY_DESC = (
    "Channel ids. web/web_push = browser web push; push/app_push = mobile app push. "
    "If the user asked for web push, pass web or web_push — never push."
)

OPEN_HUB_DESTINATION = {
    "type": "function",
    "function": {
        "name": "OPEN_HUB_DESTINATION",
        "description": (
            "Hub router only: open the destination that matches the user's intent (any natural language). "
            "Infer semantics from the message — not fixed phrases. "
            "create_space = user wants to work on a new campaign (build, send, blast, promote, setup, "
            "run, launch, start, 'make a campaign', etc.); always handoff_history=true; no intake on hub. "
            "recommendations / templates / drafts / whatsapp_approvals / reports = browse those areas. "
            "open_draft = resume a specific draft (draft_id from drafts_snapshot). "
            "Call with confirmed=true when opening or when the user clearly wants that destination. "
            "Use change_summary as a short human note for the UI."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "destination": {
                    "type": "string",
                    "enum": [
                        "recommendations",
                        "templates",
                        "drafts",
                        "whatsapp_approvals",
                        "create_space",
                        "open_draft",
                        "reports",
                    ],
                },
                "draft_id": {
                    "type": "string",
                    "description": "Required for open_draft — id from drafts_snapshot.",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Must be true. Call only after user confirmed or clearly asked to open.",
                },
                "handoff_history": {
                    "type": "boolean",
                    "description": (
                        "For create_space: true to seed the new create chat with this hub conversation."
                    ),
                },
                "change_summary": {
                    "type": "string",
                    "description": "Short note for the UI / logs, e.g. 'Opening recommendations'.",
                },
            },
            "required": ["destination", "confirmed", "change_summary"],
        },
    },
}

# One tool for Campaign overview (right panel) fields. Partial updates OK.
UPDATE_CAMPAIGN_SETUP = {
    "type": "function",
    "function": {
        "name": "update_campaign_setup",
        "description": (
            "Update the Campaign overview (right panel). Pass ONLY fields that are new "
            "or changing this turn: name, goal, objective, channels, and/or CRM segment "
            "audience (audience_text). "
            "For named people (email/phone/name) use check_contacts first — do not invent "
            "recipients. "
            "CHANNELS: pass channels ONLY when the user explicitly named or confirmed "
            "channels THIS turn — never default to email. Set channels_confirmed=true "
            "only in that case. On meta-only turns (name/goal/objective), do NOT pass "
            "channels; ask which channels in your HTML reply. "
            "web/web_push = browser web push; push/app_push = mobile app push — never "
            "store web push as push. "
            "Do not combine meta save and channels in one call unless the user gave both "
            "this turn. "
            "Pass orchestration_mode=broadcast only when they want every selected channel "
            "at launch together. Never use a person's name as the campaign title. "
            "When goal/objective is known but campaign.name is still empty, call "
            "suggest_campaign_names first (once), then save the user's pick via name=."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Full campaign title (from user pick or their wording).",
                },
                "goal": {"type": "string"},
                "objective": {"type": "string"},
                "channels": {
                    "type": "array",
                    "items": _CHANNEL_ITEM,
                    "description": (
                        "Full channel list to save. ONLY when the user explicitly chose "
                        "channels this turn — never default to email. Requires "
                        "channels_confirmed=true. Omit on meta-only saves. "
                        + _CHANNELS_ARRAY_DESC
                    ),
                },
                "channels_confirmed": {
                    "type": "boolean",
                    "description": (
                        "Required true when passing channels — user explicitly named or "
                        "confirmed channels THIS turn. Never true when saving meta only."
                    ),
                },
                "audience_text": {
                    "type": "string",
                    "description": (
                        "CRM segment / all contacts / city / join-window wording. "
                        "Not for specific emails/phones/names — use check_contacts."
                    ),
                },
                "user_text": {
                    "type": "string",
                    "description": "Latest user message when useful for meta/channel context.",
                },
                "strategy_summary": {"type": "string"},
                "strategy_accepted": {"type": "boolean"},
                "whatsapp_retry": {
                    "type": "integer",
                    "description": "WhatsApp retries 0-3 when WhatsApp is selected.",
                },
                "templates_finalized": {"type": "boolean"},
                "primary_channel": _CHANNEL_ITEM,
                "orchestration_mode": {
                    "type": "string",
                    "enum": ["prefer_primary", "staggered", "broadcast"],
                    "description": (
                        "Send plan: prefer_primary (default), staggered, or broadcast "
                        "(all channels at launch — only if user asked)."
                    ),
                },
                "change_summary": {
                    "type": "string",
                    "description": "Internal note for logs/UI — never shown in chat.",
                },
            },
            "required": ["change_summary"],
        },
    },
}

SUGGEST_CAMPAIGN_NAMES = {
    "type": "function",
    "function": {
        "name": "suggest_campaign_names",
        "description": (
            "Record exactly three short campaign name options for the user to pick. "
            "Call once when goal/objective is known but campaign.name is empty and you "
            "have not already offered names this session. Pass the three names YOU invent "
            "from the brief — then present them in your HTML reply. "
            "Do not invent a fourth option. After they pick, call update_campaign_setup "
            "with name= their choice."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 3,
                    "maxItems": 3,
                    "description": "Exactly three short campaign title options.",
                },
                "based_on_goal": {
                    "type": "string",
                    "description": "Goal/brief these names are based on (optional).",
                },
                "change_summary": {
                    "type": "string",
                    "description": "Internal note — never shown in chat.",
                },
            },
            "required": ["names", "change_summary"],
        },
    },
}

CHECK_CONTACTS = {
    "type": "function",
    "function": {
        "name": "check_contacts",
        "description": (
            "Check whether specific contacts exist in CRM before targeting them. "
            "Call THIS turn when the user names people by email, phone, and/or name "
            "(e.g. run campaign for aravi@gmail.com) — do not wait for campaign name/goal. "
            "Call immediately when recent chat names a recipient, after the user confirms "
            "lookup, or when templates exist but session audience matched_count is 0 and "
            "an email/phone was discussed. Do not ask to look up without calling this "
            "tool the same turn. "
            "Pass emails / phones / names. Returns found vs missing. "
            "If found, those contacts become the campaign audience on the panel. "
            "If none found: do NOT re-ask for the same email/phone already passed or "
            "returned in emails_missing/phones_missing. Offer to create the contact "
            "with create_contact using those values + first_name when known. "
            "If LOOKUP_EMAIL_TYPO: ask them to confirm the suggested email — never ask "
            "for phone when they only gave an email. "
            "For CRM segments / all contacts use update_campaign_setup with audience_text."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "emails": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Exact emails the user named.",
                },
                "phones": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Exact phones the user named.",
                },
                "names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Person name(s) to search.",
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
        "name": "create_contact",
        "description": (
            "Create one CRM contact from create-campaign chat when check_contacts "
            "returned LOOKUP_NOT_FOUND (or the user asks to add them). "
            "Hard required: first_name + (email OR phone with country code). "
            "Email alone is enough — NEVER require phone when email is known or the "
            "user said email only / no number. "
            "Always pass email= when known (from chat or emails_missing). "
            "Reuse emails/phones already given — never re-ask for the same value. "
            "If CREATE_CONTACT_EMAIL_TYPO: confirm the suggested correction first. "
            "If CREATE_CONTACT_ALREADY_EXISTS: do NOT invent 'can't change email' — "
            "call update_contact with that contact_id and the new fields. "
            "Call with user_confirmed=true when the user clearly wants the contact "
            "created (e.g. name is Aravi, use that email, add them, create contact). "
            "On success, audience is refreshed and check_contacts is re-run for that person."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "email": {
                    "type": "string",
                    "description": (
                        "Required when known from chat / emails_missing. "
                        "Email alone satisfies channel — phone optional."
                    ),
                },
                "phone": {
                    "type": "string",
                    "description": (
                        "Optional when email is present. Only ask if user has no email."
                    ),
                },
                "company_name": {"type": "string"},
                "city": {"type": "string"},
                "user_confirmed": {
                    "type": "boolean",
                    "description": (
                        "True when the user clearly asked to create/add this contact "
                        "or confirmed after you offered."
                    ),
                },
                "change_summary": {"type": "string"},
            },
            "required": ["first_name", "user_confirmed", "change_summary"],
        },
    },
}

UPLOAD_TEMPORARY_CONTACTS = {
    "type": "function",
    "function": {
        "name": "upload_temporary_contacts",
        "description": (
            "Upload temporary contacts for THIS create-campaign session only "
            "(not permanent CRM). Call when the user uploads a contact sheet / CSV "
            "for this campaign, or when temporary_contact_rows are available. "
            "Pass rows with first_name/last_name/email/phone (email OR phone required). "
            "Validated rows are stored and become the campaign temporary audience."
        ),
        "parameters": {
            "type": "object",
            "properties": {
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
                    "description": "Parsed contact rows from the uploaded sheet.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["rows", "change_summary"],
        },
    },
}

UPDATE_CONTACT = {
    "type": "function",
    "function": {
        "name": "update_contact",
        "description": (
            "Update an existing Audience/CRM contact from create-campaign chat "
            "(e.g. fix email typo gmai→gmail, change phone, rename). "
            "Prefer contact_id from check_contacts / create_contact / "
            "CREATE_CONTACT_ALREADY_EXISTS. If omitted, resolve via match_email / "
            "match_phone or the single current audience contact. "
            "Pass only fields to change (email, phone, first_name, last_name). "
            "Call with user_confirmed=true when the user confirmed the change. "
            "Never refuse an email update because the phone is already on that contact — "
            "that is exactly when to update this record."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "CRM contact id when known.",
                },
                "match_email": {
                    "type": "string",
                    "description": "Current email used to find the contact if id unknown.",
                },
                "match_phone": {
                    "type": "string",
                    "description": "Current phone used to find the contact if id unknown.",
                },
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "email": {
                    "type": "string",
                    "description": "New email to set on the contact.",
                },
                "phone": {
                    "type": "string",
                    "description": "New phone (with country code) to set.",
                },
                "company_name": {"type": "string"},
                "city": {"type": "string"},
                "user_confirmed": {
                    "type": "boolean",
                    "description": (
                        "True when the user confirmed updating this contact "
                        "(e.g. yes, update the email)."
                    ),
                },
                "change_summary": {"type": "string"},
            },
            "required": ["user_confirmed", "change_summary"],
        },
    },
}

# Legacy schemas kept for old transcripts / tests — not in CORE_TOOLS.
UPDATE_CAMPAIGN_META = UPDATE_CAMPAIGN_SETUP
SELECT_AUDIENCE = {
    "type": "function",
    "function": {
        "name": "select_audience",
        "description": "Legacy — use update_campaign_setup with audience_text.",
        "parameters": {
            "type": "object",
            "properties": {
                "user_text": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["user_text", "change_summary"],
        },
    },
}
LOOKUP_CONTACTS = CHECK_CONTACTS
SET_CHANNELS = {
    "type": "function",
    "function": {
        "name": "set_channels",
        "description": "Legacy — use update_campaign_setup with channels.",
        "parameters": {
            "type": "object",
            "properties": {
                "channels": {
                    "type": "array",
                    "items": _CHANNEL_ITEM,
                    "description": _CHANNELS_ARRAY_DESC,
                },
                "user_text": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

BUILD_CAMPAIGN = {
    "type": "function",
    "function": {
        "name": "build_campaign",
        "description": (
            "Create or regenerate template cards. Call after audience + channels are set "
            "when the user clearly wants templates. Pass user_confirmed=true on that "
            "go-ahead (tools do not infer confirmation from chat text). "
            "Pass channels if they are not already saved "
            "(email, whatsapp, web/web_push, push/app_push). "
            "Also pass name, goal, and objective from this conversation so template copy "
            "is correct. mode=create for first batch or to fill channels that still lack "
            "cards; mode=regenerate when the user asks to generate again in main chat "
            "(same pipeline and UI progress as create — new template id/card). "
            "Always pass user_text as the complete compose brief for THIS turn: campaign "
            "facts + the user's latest message verbatim + any deltas (longer copy, image "
            "blocks, tone). Phase 2 does not re-read the chat UI — missing constraints "
            "in user_text will not appear in HTML. change_summary is for the chat reply "
            "only, not the email body. Pass wants_images when they asked for images."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["create", "regenerate"]},
                "channels": {
                    "type": "array",
                    "items": _CHANNEL_ITEM,
                    "description": (
                        "Channels to build templates for (required on create when session "
                        "has no channels yet). "
                        + _CHANNELS_ARRAY_DESC
                    ),
                },
                "name": {
                    "type": "string",
                    "description": "Agreed campaign title from this conversation.",
                },
                "goal": {
                    "type": "string",
                    "description": "Agreed campaign goal from this conversation.",
                },
                "objective": {
                    "type": "string",
                    "description": "Agreed campaign objective from this conversation.",
                },
                "whatsapp_retry": {
                    "type": "integer",
                    "description": (
                        "WhatsApp retries 0-3 when WhatsApp is a selected channel. "
                        "Default 0 if omitted."
                    ),
                },
                "user_confirmed": {
                    "type": "boolean",
                    "description": (
                        "True when this turn is clear go-ahead for templates "
                        "(yes / create / proceed / go / build / all at once / continue)."
                    ),
                },
                "wants_images": {
                    "type": "boolean",
                    "description": (
                        "True when the user asked for hero/banner images on templates "
                        "this turn. Sets image plan and runs attach after build."
                    ),
                },
                "content_mode": {
                    "type": "string",
                    "enum": ["keep", "rewrite"],
                    "description": (
                        "Optional. keep=reuse prior card copy; rewrite=new copy this turn. "
                        "When session cards exist, inspect_session_template first, then set this."
                    ),
                },
                "design_mode": {
                    "type": "string",
                    "enum": ["keep", "rewrite"],
                    "description": (
                        "Optional. Library/adapt: keep baseline layout vs rewrite. "
                        "Omit for normal create behavior."
                    ),
                },
                "image_mode": {
                    "type": "string",
                    "enum": ["keep", "plan_new", "none"],
                    "description": (
                        "Optional. keep=reuse this session's last /api/media hero; "
                        "plan_new=Gemini new hero this turn; none=no images. "
                        "You choose from inspect_session_template + the user's ask. "
                        "Omit only on the first generate when no card exists yet."
                    ),
                },
                "scope": {
                    "type": "string",
                    "enum": ["selected", "missing_only", "all_session"],
                    "description": (
                        "Optional. missing_only=only channels without templates; "
                        "selected/all_session=use channels arg or session channels."
                    ),
                },
                "user_text": {
                    "type": "string",
                    "description": (
                        "Complete email compose brief for this generate: campaign "
                        "name/goal/offer + verbatim latest user message + this-turn "
                        "deltas (e.g. longer copy, image blocks). Required for "
                        "regenerate so HTML matches what they just asked."
                    ),
                },
                "change_summary": {
                    "type": "string",
                    "description": (
                        "Short note for the chat reply / UI. Not the email HTML brief."
                    ),
                },
                "channel_visuals": {
                    "type": "array",
                    "description": (
                        "Optional per-channel image intent for this build. Each row: "
                        "channel + visual. visual: none | keep | generate | use_upload | "
                        "shared | inherit_email_primary. Use when channels differ "
                        "(email with image, web without; one upload for all; web reuses "
                        "email hero). Omit to fall back to wants_images / image_mode."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "channel": {"type": "string", "enum": _CHANNEL_ENUM},
                            "visual": {
                                "type": "string",
                                "enum": [
                                    "none",
                                    "keep",
                                    "generate",
                                    "use_upload",
                                    "shared",
                                    "inherit_email_primary",
                                ],
                            },
                        },
                        "required": ["channel", "visual"],
                    },
                },
            },
            "required": ["mode", "change_summary"],
        },
    },
}

INSPECT_SESSION_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "inspect_session_template",
        "description": (
            "Read compact facts from a template already in this session (latest email "
            "unless template_id or channel is passed). Returns subject, clipped body "
            "plain text, word_count, hero_url, image_urls — not full HTML. Call this "
            "before build_campaign when cards already exist so you can set content_mode "
            "and image_mode from the user's ask. You decide keep vs rewrite and keep vs "
            "plan_new (Gemini); the tool only reports what is stored."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "template_id": {
                    "type": "string",
                    "description": "Optional. Specific card id from Live session / last generate.",
                },
                "channel": {
                    "type": "string",
                    "enum": _CHANNEL_ENUM,
                    "description": "Optional. Latest card for this channel (default: latest email).",
                },
                "change_summary": {
                    "type": "string",
                    "description": "Short note for logs, e.g. 'read last email before regenerate'.",
                },
            },
        },
    },
}

PRESENT_CAMPAIGN_SUMMARY = {
    "type": "function",
    "function": {
        "name": "present_campaign_summary",
        "description": (
            "Show the one-time campaign recap (name, goal, audience count, channels, "
            "template ids) after the user approves the template cards. Persists those "
            "fields and paints the recap panel. Call this once before launch_campaign. "
            "Do not call it for goal/name/audience steps, and do not invent audience "
            "counts or template ids — use session facts."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Campaign title from this conversation.",
                },
                "goal": {
                    "type": "string",
                    "description": "Campaign goal from this conversation.",
                },
                "objective": {
                    "type": "string",
                    "description": "Campaign objective from this conversation.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["name", "goal", "objective", "change_summary"],
        },
    },
}

LAUNCH_CAMPAIGN = {
    "type": "function",
    "function": {
        "name": "launch_campaign",
        "description": (
            "Launch the campaign after the user confirms send. "
            "Call this immediately on that confirmation — do not recap or ask to "
            "show a summary first. confirmed=true to send. "
            "schedule_mode=now for immediate; at for a named date/time. "
            "schedule_mode=now: leave launch_local_date, launch_local_time, and scheduled_at "
            "unset. Do not copy a previous launch clock from session. "
            "Relaunch after regenerating a template: if the user wants send again / immediately "
            "/ same customer, use schedule_mode=now with no clock fields. Named time this turn "
            "only → schedule_mode=at with launch_local_date/time. "
            "Default orchestration_mode=prefer_primary (one channel at launch). "
            "Use staggered when the user wants follow-ups on other channels later. "
            "Use broadcast only when the user explicitly confirms every selected channel "
            "at launch together (then set broadcast_confirmed=true). "
            "If the tool returns launch_not_ready because some channels lack templates, "
            "call update_campaign_setup or build_campaign as needed, then call this again. "
            "launch_channels: web/web_push = browser web push; push/app_push = mobile. "
            "Never pass push for web push."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_mode": {
                    "type": "string",
                    "enum": ["now", "at"],
                    "description": (
                        "now = send as soon as possible; omit clock fields on relaunch. "
                        "at = user named a date/time this turn."
                    ),
                },
                "launch_local_date": {"type": "string"},
                "launch_local_time": {"type": "string"},
                "scheduled_at": {"type": "string"},
                "timezone": {"type": "string"},
                "launch_channels": {
                    "type": "array",
                    "items": _CHANNEL_ITEM,
                    "description": _CHANNELS_ARRAY_DESC,
                },
                "primary_channel": {
                    **_CHANNEL_ITEM,
                    "description": (
                        "Preferred channel at T0. "
                        + _CHANNEL_ITEM["description"]
                    ),
                },
                "orchestration_mode": {
                    "type": "string",
                    "enum": ["prefer_primary", "staggered", "broadcast"],
                    "description": (
                        "prefer_primary (default)=1 channel at T0; "
                        "staggered=primary now, others later; "
                        "broadcast=all at once (requires broadcast_confirmed)."
                    ),
                },
                "broadcast_confirmed": {
                    "type": "boolean",
                    "description": (
                        "True only if the user explicitly confirmed sending on every "
                        "selected channel at the same time."
                    ),
                },
                "confirmed": {"type": "boolean"},
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

from app.agents.image.tools.schemas import PLAN_CAMPAIGN_IMAGES as _PLAN_CAMPAIGN_IMAGES_SCHEMA
from app.agents.image.tools.schemas import CONFIRM_CHAT_IMAGES as _CONFIRM_CHAT_IMAGES_SCHEMA
from app.agents.image.tools.schemas import CLEAR_CHAT_IMAGES as _CLEAR_CHAT_IMAGES_SCHEMA

PLAN_CAMPAIGN_IMAGES = {
    "type": "function",
    "function": {
        **_PLAN_CAMPAIGN_IMAGES_SCHEMA["function"],
        "name": "plan_campaign_images",
    },
}

CONFIRM_CHAT_IMAGES = {
    "type": "function",
    "function": {
        **_CONFIRM_CHAT_IMAGES_SCHEMA["function"],
        "name": "confirm_chat_images",
    },
}

CLEAR_CHAT_IMAGES = {
    "type": "function",
    "function": {
        **_CLEAR_CHAT_IMAGES_SCHEMA["function"],
        "name": "clear_chat_images",
    },
}

SET_EMAIL_AB = {
    "type": "function",
    "function": {
        "name": "set_email_ab",
        "description": (
            "Enable or disable email A/B testing for this campaign. "
            "Email only (open/click measurable). Default split 20% A / 20% B / 60% holdout; "
            "winner auto-picked after ab_decide_after_minutes (default 15), then holdout "
            "gets the winning variant. "
            "Requires email in channels. When templates already exist without A/B variants, "
            "the tool regenerates the email card with variant_a and variant_b. "
            "Call when the user asks for A/B, split test, two subject lines, or test vs winner."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "enabled": {
                    "type": "boolean",
                    "description": "True to enable email A/B; false to disable.",
                },
                "ab_pct_a": {
                    "type": "integer",
                    "description": "Percent of audience for variant A (default 20).",
                },
                "ab_pct_b": {
                    "type": "integer",
                    "description": "Percent of audience for variant B (default 20).",
                },
                "ab_pct_holdout": {
                    "type": "integer",
                    "description": (
                        "Percent held for the winner (default 60). "
                        "If A+B+holdout ≠ 100, holdout is adjusted."
                    ),
                },
                "ab_auto": {
                    "type": "boolean",
                    "description": "Auto-pick winner from open/click (default true).",
                },
                "ab_decide_after_minutes": {
                    "type": "integer",
                    "description": (
                        "Minutes after A/B send before auto-picking winner "
                        "(default 15; max 1440)."
                    ),
                },
                "change_summary": {
                    "type": "string",
                    "description": "Short note for UI/logs, e.g. 'Email A/B 20/20/60'.",
                },
            },
            "required": ["enabled", "change_summary"],
        },
    },
}

SEARCH_KNOWLEDGE = {
    "type": "function",
    "function": {
        "name": "search_knowledge",
        "description": (
            "Search this organization's campaign knowledge base (product/business facts, "
            "offers, pricing, features). Call when the user asks for product facts, or "
            "before generating/editing copy that must stay grounded in verified KB. "
            "Pass a short query in your own words. Do not invent claims the tool did not return."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "What to look up (e.g. Pro Plan pricing, campaign product overview)."
                    ),
                },
                "module": {
                    "type": "string",
                    "enum": ["auto", "product", "business", "support"],
                    "description": (
                        "KB module. auto = product then business. Default auto."
                    ),
                },
            },
            "required": ["query"],
        },
    },
}

# present_campaign_summary stays for old sessions / dispatch — not offered to the LLM.
CORE_TOOLS = [
    UPDATE_CAMPAIGN_SETUP,
    SUGGEST_CAMPAIGN_NAMES,
    PLAN_CAMPAIGN_IMAGES,
    CONFIRM_CHAT_IMAGES,
    CLEAR_CHAT_IMAGES,
    CHECK_CONTACTS,
    CREATE_CONTACT,
    UPLOAD_TEMPORARY_CONTACTS,
    UPDATE_CONTACT,
    BUILD_CAMPAIGN,
    INSPECT_SESSION_TEMPLATE,
    SET_EMAIL_AB,
    LAUNCH_CAMPAIGN,
    SEARCH_KNOWLEDGE,
]

_TOOL_INDEX = {t["function"]["name"]: t for t in CORE_TOOLS}

_CONTENT_EXECUTOR_IDS = frozenset(
    {"email_content", "whatsapp_content", "app_push_content", "web_push_content"}
)

MAS_EXECUTOR_TOOL_NAMES: dict[str, tuple[str, ...]] = {
    "brief_validation": (
        "update_campaign_setup",
        "suggest_campaign_names",
        "plan_campaign_images",
        "confirm_chat_images",
        "clear_chat_images",
        "set_email_ab",
        "search_knowledge",
    ),
    "launch_scheduling": ("launch_campaign", "set_email_ab", "search_knowledge"),
    "campaign_audience": (
        "check_contacts",
        "create_contact",
        "upload_temporary_contacts",
        "update_contact",
        "confirm_chat_images",
        "clear_chat_images",
        "search_knowledge",
    ),
    "campaign_content": (
        "build_campaign",
        "inspect_session_template",
        "plan_campaign_images",
        "confirm_chat_images",
        "clear_chat_images",
        "set_email_ab",
        "search_knowledge",
    ),
    "search_knowledge": ("search_knowledge",),
    "recommendation": tuple(t["function"]["name"] for t in CORE_TOOLS),
}


def create_campaign_tool_schemas_for_names(names: frozenset[str] | set[str]) -> list:
    """OpenAI tool schemas for a create-campaign skill tool subset."""
    out = []
    for name in names:
        tool = _TOOL_INDEX.get(str(name))
        if tool:
            out.append(tool)
    return out


def resolve_mas_executor_tool_key(executor_id: str) -> str:
    """Map MAS executor id to a bounded create-campaign tool subset."""
    eid = str(executor_id or "").strip().lower()
    if eid in _CONTENT_EXECUTOR_IDS:
        return "campaign_content"
    if eid == "contact":
        return "campaign_audience"
    if eid in MAS_EXECUTOR_TOOL_NAMES:
        return eid
    return "brief_validation"


def tools_for_mas_executor(executor_id: str) -> list:
    key = resolve_mas_executor_tool_key(executor_id)
    names = MAS_EXECUTOR_TOOL_NAMES[key]
    return [_TOOL_INDEX[n] for n in names if n in _TOOL_INDEX]

HUB_TOOLS = [
    OPEN_HUB_DESTINATION,
]

ALL_TOOLS = CORE_TOOLS
