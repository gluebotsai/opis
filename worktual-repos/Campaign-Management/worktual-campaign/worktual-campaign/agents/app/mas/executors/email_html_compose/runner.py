"""email_html_compose — MAS executor wrapping Phase 2 email compose.

Option A: Creation / campaign_content can invoke this for email create/regenerate.
Other channels stay on creation_agent channel writers. Phase 2 prompts unchanged.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

_PACKAGE = Path(__file__).resolve().parent
EXECUTOR_ID = "email_html_compose"


def _compose_user_reply(
    *,
    card: dict[str, Any],
    persisted: list[dict[str, Any]],
    persist_warning: str,
    attempted_persist: bool,
) -> str:
    subject = str((card.get("fields") or {}).get("subject") or "").strip()
    if persist_warning or (attempted_persist and not persisted):
        return (
            "The email template was generated but couldn't be saved to the database. "
            "Try regenerate, or open View — it may already be visible there."
        )
    label = f" — {subject}" if subject else ""
    return f"Email template is ready{label}. Open View to preview it."


def _dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _idea_from_ctx(ctx: dict[str, Any], task: dict[str, Any], campaign: dict[str, Any]) -> str:
    for key in ("idea", "user_request", "query", "verbatim_user_text"):
        for source in (task, ctx):
            text = str(source.get(key) or "").strip()
            if text:
                return text
    return str(
        campaign.get("objective") or campaign.get("goal") or campaign.get("name") or ""
    ).strip()


async def compose_email_template_card(
    *,
    campaign: dict[str, Any],
    channel_plan: dict[str, Any] | None = None,
    user_request: str = "",
    chat_summary: str = "",
    knowledge: str = "",
    company_pack: dict[str, Any] | None = None,
    campaign_profile: dict[str, Any] | None = None,
    prior_template: dict[str, Any] | None = None,
    launch_at: str = "",
    event_callback: Any | None = None,
    organization_id: str = "",
    generation_batch_id: str = "",
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Shared helper — used by MAS invoke and creation_agent email branch."""
    from app.mas.phase2_compose.plugin import run_phase2_email_create

    plan = _dict(channel_plan)
    launch = str(launch_at or plan.get("suggested_launch_at") or "").strip()
    return await run_phase2_email_create(
        campaign=_dict(campaign),
        plan=plan,
        user_request=user_request,
        chat_summary=chat_summary,
        knowledge=knowledge,
        company_pack=company_pack if isinstance(company_pack, dict) else None,
        campaign_profile=campaign_profile if isinstance(campaign_profile, dict) else None,
        launch_at=launch,
        prior_template=prior_template if isinstance(prior_template, dict) else None,
        event_callback=event_callback,
        organization_id=organization_id,
        generation_batch_id=generation_batch_id,
        session=session if isinstance(session, dict) else None,
    )


async def run_email_html_compose_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    """MAS entrypoint — returns {ok, template} or {ok:false, error}."""
    task = _dict(ctx.get("task_spec"))
    campaign = _dict(task.get("campaign") or ctx.get("campaign"))
    channel_plan = _dict(
        task.get("channel_plan") or task.get("plan") or ctx.get("channel_plan")
    )
    idea = _idea_from_ctx(ctx, task, campaign)
    chat_summary = str(task.get("chat_summary") or ctx.get("chat_summary") or "").strip()
    knowledge = str(task.get("knowledge") or ctx.get("knowledge") or "").strip()
    company_pack = task.get("company_pack") or ctx.get("company_pack")
    campaign_profile = task.get("campaign_profile") or ctx.get("campaign_profile")
    prior = task.get("prior_template") or ctx.get("prior_template")
    launch_at = str(
        task.get("launch_at")
        or channel_plan.get("suggested_launch_at")
        or ""
    ).strip()
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    organization_id = str(
        task.get("organization_id")
        or ctx.get("organization_id")
        or session.get("organization_id")
        or session.get("tenant_id")
        or ""
    ).strip()

    if not idea and not (
        campaign.get("objective") or campaign.get("goal") or campaign.get("name")
    ):
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": EXECUTOR_ID,
            "error": "missing_idea",
            "message": "Email compose needs a campaign idea or name/goal/objective.",
            "agent_md_dir": str(_PACKAGE),
        }

    try:
        card = await compose_email_template_card(
            campaign=campaign,
            channel_plan=channel_plan,
            user_request=idea,
            chat_summary=chat_summary,
            knowledge=knowledge,
            company_pack=company_pack if isinstance(company_pack, dict) else None,
            campaign_profile=(
                campaign_profile if isinstance(campaign_profile, dict) else None
            ),
            prior_template=prior if isinstance(prior, dict) else None,
            launch_at=launch_at,
            event_callback=ctx.get("event_callback"),
            organization_id=organization_id,
            generation_batch_id=str(
                task.get("generation_batch_id") or ctx.get("generation_batch_id") or ""
            ).strip(),
            session=session if session else None,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": EXECUTOR_ID,
            "error": str(exc)[:240] or "email_html_compose_failed",
            "message": "Could not compose the email template.",
            "agent_md_dir": str(_PACKAGE),
        }

    html = str((card.get("fields") or {}).get("compiled_html") or "").strip()
    if not html:
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": EXECUTOR_ID,
            "error": "phase2_compose_empty_html",
            "message": "Compose returned an empty email.",
            "agent_md_dir": str(_PACKAGE),
        }

    session_id = str(ctx.get("session_id") or task.get("session_id") or "").strip()
    token = str(ctx.get("token") or "").strip()
    batch_id = str(
        task.get("generation_batch_id") or card.get("generation_batch_id") or ""
    ).strip()
    if not batch_id:
        import uuid

        batch_id = str(uuid.uuid4())
    card["generation_batch_id"] = batch_id

    persisted: list[dict[str, Any]] = []
    persist_warning = ""
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    if session_id and token:
        try:
            from app.template_store import create_templates_batch, sync_session_templates

            payload = [
                {
                    "template_id": card.get("template_id"),
                    "channel": "email",
                    "logo": card.get("logo") or "email",
                    "launch_at": card.get("launch_at"),
                    "how_it_works": card.get("how_it_works") or "",
                    "fields": card.get("fields") or {},
                    "prior_template_id": card.get("prior_template_id"),
                    "generation_batch_id": batch_id,
                }
            ]
            body = await create_templates_batch(
                session_id,
                payload,
                generation_batch_id=batch_id,
                token=token,
            )
            persisted = list(body.get("templates") or [])
            preexisting = {
                str(t.get("template_id") or "").strip()
                for t in (session.get("templates") or [])
                if isinstance(t, dict) and str(t.get("template_id") or "").strip()
            }
            from app.agents.create_campaign.tool_functions import (
                _keep_new_generation_templates,
            )

            persisted = _keep_new_generation_templates(
                persisted, preexisting, payload
            )
            if not persisted:
                synced = await sync_session_templates(
                    session_id,
                    payload,
                    generation_batch_id=batch_id,
                    token=token,
                )
                persisted = _keep_new_generation_templates(
                    list(synced.get("templates") or []),
                    preexisting,
                    payload,
                )
            if not persisted and not persist_warning:
                persist_warning = "template_persist_failed"
        except Exception as exc:  # noqa: BLE001
            persist_warning = (
                "The email template was generated but couldn't be saved. "
                "Try generate again, or open View."
            )
            logging.getLogger(__name__).warning(
                "email_html_compose persist failed: %s", exc
            )

        event_callback = ctx.get("event_callback")
        if callable(event_callback) and persisted:
            from app.mas.runtime.creation_context import last_user_turn_pin

            session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
            pin_id, pin_ord = last_user_turn_pin(session)
            persisted_batch = ""
            template_ids: list[str] = []
            for t in persisted:
                if not isinstance(t, dict):
                    continue
                tid = str(t.get("template_id") or "").strip()
                if tid:
                    template_ids.append(tid)
                bid = str(t.get("generation_batch_id") or "").strip()
                if bid and not persisted_batch:
                    persisted_batch = bid
            ready_payload: dict[str, Any] = {
                "generation_batch_id": persisted_batch or batch_id,
                "template_count": len(persisted),
                "template_ids": template_ids,
            }
            if pin_id:
                ready_payload["pin_user_message_id"] = pin_id
            if pin_ord >= 1:
                ready_payload["pin_user_ordinal"] = pin_ord
            try:
                await event_callback(
                    {
                        "type": "templates_ready",
                        "payload": ready_payload,
                    }
                )
            except Exception:  # noqa: BLE001
                pass

    attempted_persist = bool(session_id and token)
    reply = _compose_user_reply(
        card=card,
        persisted=persisted,
        persist_warning=persist_warning,
        attempted_persist=attempted_persist,
    )
    out: dict[str, Any] = {
        "ok": True,
        "action_status": "completed",
        "executor_id": EXECUTOR_ID,
        "template": card,
        "message": reply,
        "reply": reply,
        "agent_md_dir": str(_PACKAGE),
    }
    if persisted:
        out["templates"] = persisted
        out["generation_batch_id"] = batch_id
    if persist_warning:
        out["persist_warning"] = persist_warning
    return out
