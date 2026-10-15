"""OpenAI-style tool schemas for events report agent."""

from app.agents.routing import ROUTE_TO_MODULE_SCHEMA

LIST_EVENTS = {
    "type": "function",
    "function": {
        "name": "LIST_EVENTS",
        "description": (
            "List events from the session snapshot. "
            "Filter by status (active/ended/draft/planned/all) or kind."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["all", "active", "ended", "draft", "planned"],
                },
                "kind": {
                    "type": "string",
                    "description": "Optional kind filter (form, webinar, coupon, ...)",
                },
                "include_drafts": {
                    "type": "boolean",
                    "description": "Include draft events (default true)",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

GET_EVENT_DETAIL = {
    "type": "function",
    "function": {
        "name": "GET_EVENT_DETAIL",
        "description": (
            "Load one event by id or title from the snapshot, including fields, "
            "submission/open counts, and recent submissions when present."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "event_id": {"type": "string"},
                "title": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

ALL_TOOLS = [LIST_EVENTS, GET_EVENT_DETAIL, ROUTE_TO_MODULE_SCHEMA]
