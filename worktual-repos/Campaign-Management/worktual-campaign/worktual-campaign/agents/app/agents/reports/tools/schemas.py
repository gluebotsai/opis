"""Tool schemas for the unified Reports & Analytics agent."""

from app.agents.monitoring.tools.schemas import LIST_MONITOR_CAMPAIGNS, STOP_CAMPAIGN
from app.agents.routing import ROUTE_TO_MODULE_SCHEMA

GET_CAMPAIGN_LIVE_STATUS = {
    "type": "function",
    "function": {
        "name": "GET_CAMPAIGN_LIVE_STATUS",
        "description": (
            "Live send pipeline for one campaign: queued/sending batches, "
            "pending/sent/failed counts per channel, as_of timestamp. "
            "Use for in-progress sends and real-time ops — not period KPI totals."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {
                    "type": "string",
                    "description": "Campaign id from LIST_MONITOR_CAMPAIGNS",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["campaign_id", "change_summary"],
        },
    },
}

GET_PORTFOLIO_PERFORMANCE = {
    "type": "function",
    "function": {
        "name": "GET_PORTFOLIO_PERFORMANCE",
        "description": (
            "SSOT Dashboard performance — same JSON as Overview KPI cards. "
            "Use for last week / period performance, open rate, sent volume, "
            "channel rollup. Prefer over query_analytics for parity with UI. "
            "Do not pass channels unless the user asked to filter channels."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["launch", "activity"],
                    "description": "launch = KPI cards; activity emphasizes event-time series.",
                },
                "relative": {
                    "type": "string",
                    "enum": [
                        "today",
                        "yesterday",
                        "last_7_days",
                        "last_30_days",
                        "last_month",
                    ],
                },
                "from_date": {"type": "string"},
                "to_date": {"type": "string"},
                "activity_from_date": {
                    "type": "string",
                    "description": "Event-time chart window (IST). Use dashboard_period.activity_from when set.",
                },
                "activity_to_date": {"type": "string"},
                "channels": {
                    "type": "string",
                    "description": "Optional — omit for full Overview parity.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

GET_ACTIVITY_SERIES = {
    "type": "function",
    "function": {
        "name": "GET_ACTIVITY_SERIES",
        "description": (
            "Event-time daily sent/failed/opens/clicks for the Dashboard period "
            "(IST buckets). Use for trend / today activity — not launch-date rollup."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "relative": {
                    "type": "string",
                    "enum": [
                        "today",
                        "yesterday",
                        "last_7_days",
                        "last_30_days",
                        "last_month",
                    ],
                },
                "from_date": {"type": "string"},
                "to_date": {"type": "string"},
                "channels": {
                    "type": "string",
                    "description": "Comma-separated agent channels (email,push,...)",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

GET_OPS_FEED = {
    "type": "function",
    "function": {
        "name": "GET_OPS_FEED",
        "description": (
            "Unified real-time ops: active live sends, recent failures, "
            "and activity series for the period."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "relative": {"type": "string"},
                "from_date": {"type": "string"},
                "to_date": {"type": "string"},
                "channels": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

GET_RECENT_SEND_FAILURES = {
    "type": "function",
    "function": {
        "name": "GET_RECENT_SEND_FAILURES",
        "description": (
            "Recent recipient-level send failures with skip_fail_reason "
            "(e.g. web push not ready, compliance). Optional campaign_id / channel."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "channel": {
                    "type": "string",
                    "description": "email | sms | whatsapp | push | web",
                },
                "limit": {"type": "integer"},
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

GET_CAMPAIGN_REPORT = {
    "type": "function",
    "function": {
        "name": "GET_CAMPAIGN_REPORT",
        "description": (
            "Full report for one campaign_id: goal, schedule/timezone, audience count, "
            "and per-channel metrics (email/sms/whatsapp/push/web/ppc as present): "
            "sent, stub (not delivered), failed, opens, clicks, rates, pause state. "
            "For named contacts use GET_CAMPAIGN_AUDIENCE."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {
                    "type": "string",
                    "description": "Campaign UUID from LIST_MONITOR_CAMPAIGNS",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["campaign_id", "change_summary"],
        },
    },
}

GET_CAMPAIGN_AUDIENCE = {
    "type": "function",
    "function": {
        "name": "GET_CAMPAIGN_AUDIENCE",
        "description": (
            "List contacts selected for a campaign and per-contact outcome: "
            "sent (live), stub (local fake send — inbox not reached), failed, "
            "skipped, pending, not_sent. Call when the user asks who the audience "
            "is, who received, or who missed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {
                    "type": "string",
                    "description": "Campaign UUID from LIST_MONITOR_CAMPAIGNS",
                },
                "channel": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

STOP_CHANNEL = {
    "type": "function",
    "function": {
        "name": "STOP_CHANNEL",
        "description": (
            "Pause one channel on a live or scheduled campaign. Requires a non-empty reason."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "channel": {
                    "type": "string",
                    "description": "email | sms | whatsapp | push | web | ppc",
                },
                "reason": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["campaign_id", "channel", "reason", "change_summary"],
        },
    },
}

RESUME_CHANNEL = {
    "type": "function",
    "function": {
        "name": "RESUME_CHANNEL",
        "description": "Resume a paused channel on a live or scheduled campaign.",
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "channel": {"type": "string"},
                "change_summary": {"type": "string"},
            },
            "required": ["campaign_id", "channel", "change_summary"],
        },
    },
}

LIST_EVENTS = {
    "type": "function",
    "function": {
        "name": "LIST_EVENTS",
        "description": (
            "List events from the Reports session snapshot (launched + drafts). "
            "Returns title, status, kind, submission_count, open_count."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["all", "active", "ended", "draft", "planned"],
                },
                "kind": {"type": "string"},
                "include_drafts": {"type": "boolean"},
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
            "Detail for one event by event_id or title: fields, submissions, opens, public slug."
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

ASK_ONTOLOGY = {
    "type": "function",
    "function": {
        "name": "ask_ontology",
        "description": (
            "Analytics / knowledge-graph questions via the ontology layer. "
            "Use for: past campaigns related to an idea or theme, graph facts, "
            "whether a campaign type was launched before, relationships between "
            "campaigns/contacts/events in the ontology. "
            "Do NOT use for dashboard KPI rates/volumes (open rate, click rate, "
            "sent count) — those use query_analytics / ask_semantic_layer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Plain-language analytics / past-campaign question for the ontology."
                    ),
                },
                "question": {
                    "type": "string",
                    "description": "Alias for query (optional).",
                },
            },
            "required": ["query"],
        },
    },
}

ASK_SEMANTIC_LAYER = {
    "type": "function",
    "function": {
        "name": "ask_semantic_layer",
        "description": (
            "Low-level semantic gateway for report KPIs (rates, volumes). "
            "Prefer query_analytics for report metrics. Do NOT use for ontology "
            "analytics / past-campaign graph questions — use ask_ontology."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Plain-language metrics / report question.",
                },
            },
            "required": ["query"],
        },
    },
}

QUERY_ANALYTICS = {
    "type": "function",
    "function": {
        "name": "query_analytics",
        "description": (
            "Report metrics / KPI questions (open rate, click rate, delivery rate, "
            "sent volume). Uses allowlisted Campaign metrics + portfolio parity. "
            "Always pass metrics[] explicitly. For live in-flight sends use "
            "GET_CAMPAIGN_LIVE_STATUS. For ontology themes use ask_ontology."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "metrics": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "portfolio",
                            "open_rate",
                            "click_rate",
                            "delivery_rate",
                            "sent",
                            "failed",
                            "opens",
                            "clicks",
                            "campaigns_ran",
                            "status_counts",
                            "monitoring_tab_counts",
                            "status_pie",
                        ],
                    },
                    "description": (
                        "Explicit metric ids (required for accurate answers). "
                        "monitoring_tab_counts = Live/Scheduled/Draft/Past tab badges (all-time)."
                    ),
                },
                "question": {
                    "type": "string",
                    "description": "The user's report/KPI question, e.g. what's our open rate?",
                },
                "query": {
                    "type": "string",
                    "description": "Alias for question (optional).",
                },
                "label": {
                    "type": "string",
                    "description": "Optional short chart title.",
                },
                "relative": {
                    "type": "string",
                    "enum": [
                        "today",
                        "yesterday",
                        "last_7_days",
                        "last_30_days",
                        "last_month",
                    ],
                    "description": (
                        "Time window when the user named one (today, yesterday, last week, etc.). "
                        "Overrides dashboard_period for this query."
                    ),
                },
                "from_date": {
                    "type": "string",
                    "description": "Inclusive start YYYY-MM-DD (optional).",
                },
                "to_date": {
                    "type": "string",
                    "description": "Inclusive end YYYY-MM-DD (optional).",
                },
                "include_visual": {
                    "type": "boolean",
                    "description": (
                        "True for KPI/count/rate/overview questions where a metric card helps. "
                        "False when a short text answer is enough (default true)."
                    ),
                },
            },
            "required": ["question"],
        },
    },
}

ALL_TOOLS = [
    ASK_ONTOLOGY,
    QUERY_ANALYTICS,
    ASK_SEMANTIC_LAYER,
    LIST_MONITOR_CAMPAIGNS,
    GET_CAMPAIGN_LIVE_STATUS,
    GET_RECENT_SEND_FAILURES,
    GET_PORTFOLIO_PERFORMANCE,
    GET_ACTIVITY_SERIES,
    GET_OPS_FEED,
    GET_CAMPAIGN_REPORT,
    GET_CAMPAIGN_AUDIENCE,
    STOP_CAMPAIGN,
    STOP_CHANNEL,
    RESUME_CHANNEL,
    LIST_EVENTS,
    GET_EVENT_DETAIL,
    ROUTE_TO_MODULE_SCHEMA,
]

_REPORTS_TOOL_INDEX = {
    str(t["function"]["name"]): t for t in ALL_TOOLS
}


def reports_tool_schemas_for_names(names: frozenset[str] | set[str]) -> list:
    """OpenAI tool schemas for a reports/dashboard skill tool subset."""
    out = []
    for name in names:
        tool = _REPORTS_TOOL_INDEX.get(str(name))
        if tool:
            out.append(tool)
    return out
