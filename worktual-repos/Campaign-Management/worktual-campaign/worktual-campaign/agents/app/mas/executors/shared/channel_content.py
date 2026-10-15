"""Shared channel-content execution for Content executors."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.agents.template_library.channels import get_channel_agent
from app.mas.executors.shared.create_campaign_native import (
    is_create_campaign_handoff,
    is_native_create_campaign,
    run_native_create_executor,
)
from app.mas.runtime.load_agent_md import package_agent_md

EXECUTOR_CHANNEL = {
    "whatsapp_content": "whatsapp",
    "email_content": "email",
    "app_push_content": "push",
    "web_push_content": "web",
}


async def run_channel_content_executor(
    executor_id: str,
    ctx: dict[str, Any],
) -> dict[str, Any]:
    package = Path(__file__).resolve().parents[1] / executor_id
    meta = package_agent_md(package)

    if is_native_create_campaign() and is_create_campaign_handoff(ctx):
        return await run_native_create_executor(ctx, executor_id, agent_md_dir=package)

    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    mod = str(
        ctx.get("module_hint")
        or (ctx.get("task_spec") or {}).get("module")
        or session.get("module")
        or ""
    ).strip().lower()
    if mod in ("create_campaign", "recommendations"):
        from app.mas.runtime.creation_context import has_templates_for_channels

        if not has_templates_for_channels(session):
            query = str(
                (ctx.get("task_spec") or {}).get("query") or ctx.get("query") or ""
            ).strip()
            return {
                "ok": True,
                "action_status": "needs_domain",
                "kind": "executor",
                "agent_id": executor_id,
                "needs_domain": {
                    "domain_id": "creation",
                    "restated_query": query or (
                        "Build templates via build_campaign in Creation domain."
                    ),
                    "preferred_executor": "campaign_content",
                },
                "message": "Template build must go through Creation domain (build_campaign).",
                "reply": "",
                "agent_md_loaded": not meta.get("missing"),
            }

    task_spec = dict(ctx.get("task_spec") or {})
    channel = EXECUTOR_CHANNEL.get(executor_id)
    if not channel:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": executor_id,
            "error": f"No channel mapping for {executor_id}",
            "agent_md_loaded": not meta.get("missing"),
        }

    agent = get_channel_agent(channel)
    if agent is None:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": executor_id,
            "error": f"No channel agent for {channel}",
            "agent_md_loaded": not meta.get("missing"),
        }

    campaign = (
        task_spec["campaign"]
        if isinstance(task_spec.get("campaign"), dict)
        else {
            "name": task_spec.get("name") or "Campaign",
            "goal": task_spec.get("goal") or "",
            "objective": task_spec.get("objective") or task_spec.get("query") or "",
        }
    )
    raw_audience = task_spec.get("audience_summary")
    audience_summary = (
        raw_audience
        if isinstance(raw_audience, dict)
        else {"summary": str(raw_audience or "general audience")}
    )
    plan = (
        task_spec["plan"]
        if isinstance(task_spec.get("plan"), dict)
        else {
            "channel": channel,
            "insight": task_spec.get("insight") or task_spec.get("query") or "",
        }
    )

    try:
        template = await agent.generate(campaign, audience_summary, plan)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": executor_id,
            "error": str(exc),
            "agent_md_loaded": not meta.get("missing"),
        }

    return {
        "ok": True,
        "action_status": "completed",
        "kind": "executor",
        "agent_id": executor_id,
        "message": f"Generated {channel} template.",
        "result": {"channel": channel, "template": template},
        "template": template,
        "channel": channel,
        "agent_md_loaded": not meta.get("missing"),
    }
