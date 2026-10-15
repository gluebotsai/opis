"""OpenAI-style tool schemas for recommendation agent."""

from app.agents.routing import ROUTE_TO_MODULE_SCHEMA

LOAD_PAST_CAMPAIGNS = {
    "type": "function",
    "function": {
        "name": "LOAD_PAST_CAMPAIGNS",
        "description": (
            "Load completed campaigns: name, goal, objective, channels, audience, "
            "and performance (sent, failed, bounced, opens, clicks, rates). "
            "Call this before GENERATE_RECOMMENDATIONS if past_campaigns is missing."
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

GENERATE_RECOMMENDATIONS = {
    "type": "function",
    "function": {
        "name": "GENERATE_RECOMMENDATIONS",
        "description": (
            "Put campaign ideas on the Recommendations board. Each item must include "
            "goal, objective, channels, audience, why_created, and timing_label. "
            "Use an empty list when nothing useful should be shown."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "What these ideas optimize for.",
                },
                "recommendations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "goal": {"type": "string"},
                            "objective": {"type": "string"},
                            "timing_label": {"type": "string"},
                            "event_name": {"type": "string"},
                            "audience": {"type": "string"},
                            "channels": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "why_created": {"type": "string"},
                            "intended_use": {"type": "string"},
                            "inspired_by_campaign": {"type": "string"},
                            "contacts_specified": {"type": "boolean"},
                            "matched_count": {"type": "number"},
                            "contacts_missing_reason": {"type": "string"},
                            "audience_filters": {"type": "object"},
                            "templates": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "channel": {"type": "string"},
                                        "name": {"type": "string"},
                                        "preview": {"type": "string"},
                                    },
                                    "required": ["channel", "name", "preview"],
                                },
                            },
                        },
                        "required": [
                            "title",
                            "goal",
                            "objective",
                            "audience",
                            "channels",
                            "why_created",
                            "timing_label",
                        ],
                    },
                },
                "change_summary": {"type": "string"},
            },
            "required": ["recommendations", "change_summary"],
        },
    },
}

ALL_TOOLS = [LOAD_PAST_CAMPAIGNS, GENERATE_RECOMMENDATIONS, ROUTE_TO_MODULE_SCHEMA]
