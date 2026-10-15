"""OpenAI-style tool schemas for campaign monitoring agent."""

from app.agents.routing import ROUTE_TO_MODULE_SCHEMA

LIST_MONITOR_CAMPAIGNS = {
    "type": "function",
    "function": {
        "name": "LIST_MONITOR_CAMPAIGNS",
        "description": (
            "List campaigns in a monitoring bucket: live, scheduled, past, draft, or all. "
            "For Dashboard 'campaigns that ran' in a period use bucket=all + relative/from_date "
            "(ran_only defaults true). Optional channel filter (email|sms|whatsapp|push|web|ppc; "
            "app push = push). Returns channels[], audience_count, channel_metrics per row."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "bucket": {
                    "type": "string",
                    "enum": ["live", "scheduled", "past", "draft", "all"],
                },
                "relative": {
                    "type": "string",
                    "enum": ["today", "yesterday", "last_7_days", "last_month"],
                    "description": "Filter by launch local date window (IST default)",
                },
                "from_date": {
                    "type": "string",
                    "description": "Inclusive YYYY-MM-DD launch local date",
                },
                "to_date": {
                    "type": "string",
                    "description": "Inclusive YYYY-MM-DD launch local date",
                },
                "channel": {
                    "type": "string",
                    "description": (
                        "Optional: campaigns that include this channel "
                        "(push = App Push). Matches Dashboard channel cards."
                    ),
                },
                "ran_only": {
                    "type": "boolean",
                    "description": (
                        "Exclude draft/scheduled when true (default for period/channel lists)."
                    ),
                },
                "name_contains": {
                    "type": "string",
                    "description": "Substring filter on campaign name.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Page size (default 20, max 50)",
                },
                "offset": {
                    "type": "integer",
                    "description": "Rows to skip (default 0)",
                },
                "include_visual": {
                    "type": "boolean",
                    "description": (
                        "True only for KPI/overview list totals. False for names, "
                        "audience, channels, or narrative answers (default false)."
                    ),
                },
                "change_summary": {"type": "string"},
            },
            "required": ["bucket", "change_summary"],
        },
    },
}

GET_CAMPAIGN_REPORT = {
    "type": "function",
    "function": {
        "name": "GET_CAMPAIGN_REPORT",
        "description": (
            "Load one campaign report: channels with to_send/sent/failed/stub, pause state, "
            "and campaign-level totals. Prefer when focus_campaign_id is set."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "include_visual": {
                    "type": "boolean",
                    "description": (
                        "True when the user asked for performance KPIs for one campaign. "
                        "False for audience, channels, schedule, or detail-only answers (default false)."
                    ),
                },
                "change_summary": {"type": "string"},
            },
            "required": ["campaign_id", "change_summary"],
        },
    },
}

STOP_CAMPAIGN = {
    "type": "function",
    "function": {
        "name": "STOP_CAMPAIGN",
        "description": (
            "Stop an entire live or scheduled campaign. Call once without reason "
            "to classify status and get sent vs selected counts. If live or scheduled, "
            "ask the user for a reason, then call again WITH that reason to actually stop. "
            "If the campaign is already completed or cancelled (past), tell the user — "
            "do not invent a reason. Use STOP_CHANNEL only when they want one channel paused."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {
                    "type": "string",
                    "description": "Campaign UUID. Optional if focus_campaign_id is set.",
                },
                "reason": {
                    "type": "string",
                    "description": (
                        "Required to actually stop. Omit on the first call to inspect "
                        "status and audience sent counts."
                    ),
                },
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
            "Pause (stop) one channel on a live or scheduled campaign. "
            "Requires a non-empty reason (shown on the channel description)."
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
        "description": (
            "Resume a paused channel on a live or scheduled campaign. "
            "Not allowed for past/expired campaigns."
        ),
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

GET_CAMPAIGN_AUDIENCE = {
    "type": "function",
    "function": {
        "name": "GET_CAMPAIGN_AUDIENCE",
        "description": (
            "Who was selected for a campaign, who was actually sent (live ESP), "
            "who got a stub send (not delivered to inbox), and who was missed "
            "(failed / skipped / pending / not_sent). Use when the user asks for "
            "audience details, contact names, who received, or who missed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {
                    "type": "string",
                    "description": "Campaign UUID. Optional if focus_campaign_id is set.",
                },
                "channel": {
                    "type": "string",
                    "description": "Optional channel filter: email | push | web | sms | whatsapp",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

PICK_AB_WINNER = {
    "type": "function",
    "function": {
        "name": "PICK_AB_WINNER",
        "description": (
            "Pick the email A/B winner and send the holdout remainder. "
            "Pass winner=a or winner=b to force a variant, or omit winner to "
            "auto-analyse open/click rates. Use force=true to pick early before "
            "the decide window. Email A/B only."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "winner": {
                    "type": "string",
                    "enum": ["a", "b"],
                    "description": "Force variant A or B. Omit to auto-pick from open/click rate.",
                },
                "force": {
                    "type": "boolean",
                    "description": "Pick early / send remainder now (default true for monitor asks)",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["change_summary"],
        },
    },
}

ALL_TOOLS = [
    LIST_MONITOR_CAMPAIGNS,
    GET_CAMPAIGN_REPORT,
    GET_CAMPAIGN_AUDIENCE,
    STOP_CAMPAIGN,
    STOP_CHANNEL,
    RESUME_CHANNEL,
    PICK_AB_WINNER,
    ROUTE_TO_MODULE_SCHEMA,
]

_MONITORING_TOOL_INDEX = {
    str(t["function"]["name"]): t for t in ALL_TOOLS
}


def monitoring_tool_schemas_for_names(names: frozenset[str] | set[str]) -> list:
    """OpenAI tool schemas for a monitoring skill tool subset."""
    out = []
    for name in names:
        tool = _MONITORING_TOOL_INDEX.get(str(name))
        if tool:
            out.append(tool)
    return out


def tools_for_mas_optimization_executor(
    executor_id: str,
    *,
    surface: str = "reports",
) -> list:
    """OpenAI tool schemas for one Optimization MAS executor (bounded subset)."""
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    eid = str(executor_id or "monitoring").strip().lower()
    names = EXECUTOR_TOOL_ALLOWLIST.get(eid, frozenset())
    if eid == "analytics":
        if str(surface or "").strip().lower() == "events_report":
            from app.agents.events_report.tools.schemas import ALL_TOOLS as _EVENT_TOOLS

            catalog = {str(t["function"]["name"]): t for t in _EVENT_TOOLS}
        else:
            from app.agents.reports.tools.schemas import ALL_TOOLS as _REPORT_TOOLS

            catalog = {str(t["function"]["name"]): t for t in _REPORT_TOOLS}
    else:
        catalog = _MONITORING_TOOL_INDEX
    return [catalog[n] for n in names if n in catalog]
