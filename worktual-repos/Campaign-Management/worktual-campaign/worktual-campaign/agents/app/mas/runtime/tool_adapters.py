"""Tool adapters — map executor tool names to legacy handlers."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]

# Executor → allowlisted legacy tool names (contacts module).
EXECUTOR_TOOL_ALLOWLIST: dict[str, frozenset[str]] = {
    "contact": frozenset(
        {
            "VIEW_CONTACT",
            "QUERY_CONTACTS",
            "LOOKUP_CONTACT",
            "GET_CONTACT",
            "GET_CONTACT_DETAIL",
            "CONTACT_VIEW_AND_DOWNLOAD",
            "SEARCH_CONTACTS",
            "SET_DRAFT_FIELDS",
            "VERIFY_FOCUS_IDENTITY",
            "CREATE_CONTACT",
            "CREATE_SINGLE_CONTACT",
            "UPDATE_CONTACT",
            "UPDATE_SINGLE_CONTACT",
            "GET_COMPANY_PACK",
            "ADD_COMPANY_RULE",
            "UPDATE_COMPANY_RULE",
            "DELETE_COMPANY_RULE",
            "UPSERT_PACK_FIELD",
            "CONFIRM_PACK_FIELD",
            "DELETE_PACK_FIELD",
            "ROUTE_TO_MODULE",
        }
    ),
    "audience_selection": frozenset(
        {
            "SEARCH_CONTACTS",
            "LOOKUP_CONTACT",
            "CONTACT_VIEW_AND_DOWNLOAD",
            "CREATE_BULK_CONTACT",
            "UPDATE_BULK_CONTACT",
            "IMPORT_CONTACTS",
            "ROUTE_TO_MODULE",
        }
    ),
    "audience_pull": frozenset(
        {
            "SEARCH_CONTACTS",
            "LOOKUP_CONTACT",
            "CONTACT_VIEW_AND_DOWNLOAD",
            "IMPORT_CONTACTS",
        }
    ),
    "monitoring": frozenset(
        {
            "LIST_MONITOR_CAMPAIGNS",
            "GET_CAMPAIGN_REPORT",
            "GET_CAMPAIGN_AUDIENCE",
            "ROUTE_TO_MODULE",
        }
    ),
    "recovery": frozenset(
        {
            "STOP_CAMPAIGN",
            "STOP_CHANNEL",
            "RESUME_CHANNEL",
            "PICK_AB_WINNER",
            "ROUTE_TO_MODULE",
        }
    ),
    "analytics": frozenset(
        {
            "ask_ontology",
            "query_analytics",
            "ask_semantic_layer",
            "LIST_MONITOR_CAMPAIGNS",
            "GET_CAMPAIGN_REPORT",
            "GET_CAMPAIGN_AUDIENCE",
            "LIST_EVENTS",
            "GET_EVENT_DETAIL",
            "ROUTE_TO_MODULE",
        }
    ),
    "form_theme": frozenset({"RUN_THEME_SPECIALIST", "UPDATE_FORM_THEME"}),
    "form_fields": frozenset({"RUN_FIELDS_SPECIALIST", "UPDATE_FORM_FIELDS"}),
    "form_design": frozenset({"RUN_DESIGN_SPECIALIST", "APPLY_FORM_DESIGN"}),
    "image_generate": frozenset({"ENHANCE_IMAGE_PROMPT", "GENERATE_IMAGE", "GET_LAST_IMAGE"}),
    "image_refine": frozenset({"ENHANCE_IMAGE_PROMPT", "REFINE_IMAGE", "GET_LAST_IMAGE"}),
    "image_attach": frozenset({"GET_LAST_IMAGE", "ATTACH_IMAGE"}),
    "campaign_images": frozenset(
        {
            "PLAN_CAMPAIGN_IMAGES",
            "GENERATE_CAMPAIGN_IMAGES",
            "ATTACH_CAMPAIGN_IMAGES",
            "RUN_CAMPAIGN_IMAGE_PIPELINE",
            "GET_LAST_IMAGE",
            "CONFIRM_CHAT_IMAGES",
            "confirm_chat_images",
            "CLEAR_CHAT_IMAGES",
            "clear_chat_images",
        }
    ),
    "whatsapp_approved_send": frozenset(
        {
            "SET_AUDIENCE",
            "FILTER_CONTACTS",
            "UPLOAD_TEMPORARY_CONTACTS",
            "SEND_APPROVED_TEMPLATE",
            "LAUNCH_APPROVED_CAMPAIGN",
        }
    ),
    "content_verification": frozenset({"SET_TEMPLATE_FIELDS", "SUBMIT_FOR_APPROVAL"}),
    "brief_validation": frozenset(
        {
            "update_campaign_setup",
            "suggest_campaign_names",
            "plan_campaign_images",
            "confirm_chat_images",
            "clear_chat_images",
        }
    ),
    "launch_scheduling": frozenset({"launch_campaign"}),
    "campaign_audience": frozenset(
        {
            "check_contacts",
            "create_contact",
            "upload_temporary_contacts",
            "update_contact",
            "confirm_chat_images",
            "clear_chat_images",
        }
    ),
    "campaign_content": frozenset(
        {
            "build_campaign",
            "inspect_session_template",
            "plan_campaign_images",
            "confirm_chat_images",
            "clear_chat_images",
        }
    ),
    "recommendation": frozenset(
        {
            "update_campaign_setup",
            "check_contacts",
            "create_contact",
            "upload_temporary_contacts",
            "update_contact",
            "build_campaign",
            "inspect_session_template",
            "launch_campaign",
            "plan_campaign_images",
            "confirm_chat_images",
            "clear_chat_images",
        }
    ),
}

_CREATE_CAMPAIGN_EXECUTORS = frozenset(
    {
        "brief_validation",
        "launch_scheduling",
        "campaign_audience",
        "campaign_content",
        "recommendation",
    }
)


async def dispatch_executor_tool(
    executor_id: str,
    tool_name: str,
    args: dict[str, Any],
    *,
    session_id: str = "",
    token: str = "",
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """
    Route a tool call to the legacy handler for this executor.

    Unknown executor/tool → structured error (does not invent success).
    """
    eid = str(executor_id or "").strip().lower()
    name = str(tool_name or "").strip()
    allow = EXECUTOR_TOOL_ALLOWLIST.get(eid)
    if allow is None:
        return {
            "ok": False,
            "status": "not_implemented",
            "executor_id": eid,
            "tool": name,
            "error": f"No tool allowlist for executor '{eid}'.",
        }
    if name not in allow:
        return {
            "ok": False,
            "status": "forbidden_tool",
            "executor_id": eid,
            "tool": name,
            "error": f"Tool '{name}' is not allowlisted for executor '{eid}'.",
        }

    if eid in ("contact", "audience_selection", "audience_pull"):
        from app.agents.contacts.tools.handlers import dispatch_tool

        return await dispatch_tool(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    if eid in ("monitoring", "recovery"):
        from app.agents.monitoring.tools.handlers import dispatch_tool as mon_dispatch

        return await mon_dispatch(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    if eid == "analytics":
        # Prefer reports dispatcher; events tools live there too for Reports module.
        from app.agents.reports.tools.handlers import dispatch_tool as reports_dispatch

        return await reports_dispatch(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    if eid in ("form_theme", "form_fields", "form_design"):
        from app.agents.forms.tools.handlers import dispatch_tool as forms_dispatch

        return await forms_dispatch(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    if eid in ("image_generate", "image_refine", "image_attach", "campaign_images"):
        from app.agents.image.tools.handlers import dispatch_tool as image_dispatch

        return await image_dispatch(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    if eid == "whatsapp_approved_send":
        from app.agents.whatsapp_approved.tools.handlers import (
            dispatch_tool as wa_approved_dispatch,
        )

        return await wa_approved_dispatch(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    if eid == "content_verification":
        from app.agents.whatsapp_rejected.tools.handlers import (
            dispatch_tool as wa_rejected_dispatch,
        )

        return await wa_rejected_dispatch(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    if eid in _CREATE_CAMPAIGN_EXECUTORS:
        from app.agents.create_campaign.tool_functions import dispatch_core_tool

        return await dispatch_core_tool(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )

    return {
        "ok": False,
        "status": "not_implemented",
        "executor_id": eid,
        "tool": name,
        "error": (
            f"Tool adapter for executor '{eid}' is not implemented yet."
        ),
    }
