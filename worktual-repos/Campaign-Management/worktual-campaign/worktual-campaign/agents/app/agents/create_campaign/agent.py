"""Create-campaign agent — jun30 tool loop: tools if LLM called them, else reply to user.

No regex intent, no remint, no phrase recovery. User ↔ LLM only (+ tool execution).
Overview (right bar) updates from process memory via state_update as soon as tools save.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from app.agents.create_campaign.context import ensure_audience_summary, ensure_org_context
from app.agents.create_campaign.prompts import (
    build_system_prompt,
    hub_system_prompt,
    welcome_text,
)
from app.agents.create_campaign.tool_functions import dispatch_core_tool, dispatch_tool
from app.agents.create_campaign.tools import CORE_TOOLS, HUB_TOOLS
from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_RETRIES,
    CHAT_LLM_TIMEOUT_S,
    CHAT_REASONING_EFFORT,
    CREATE_CHAT_MAX_TOKENS,
    LLM_UNAVAILABLE_REPLY,
    OpenAILLM,
)
from app.progress_status import emit_process_progress
from app.request_context import set_request_token
from app.runtime.agent import run_tool_loop, strip_internal_nudges
from app.text_cleanup import strip_markdown_emphasis
from app.session_store import (
    append_llm_memory,
    append_message,
    get_llm_memory,
    get_or_create_session,
    hydrate_session_audience,
    is_hub_session_id,
    public_state,
    replace_llm_memory,
    save_session,
)

logger = logging.getLogger(__name__)

# Tool + reply is enough for most turns; keep below previous 8 to cut latency.
_MAX_TOOL_ROUNDS = 4


def _log_llm_inputs(
    session_id: str,
    user_text: str,
    messages: list[dict],
    history: list[dict],
) -> None:
    """Confirm current query + llm_memory (incl. tools) are in the payload."""
    roles = [str(m.get("role") or "") for m in messages]
    tool_n = sum(1 for r in roles if r == "tool")
    user_turns = [
        str(m.get("content") or "")[:120]
        for m in history
        if m.get("role") == "user"
    ]
    last_user = next(
        (
            str(m.get("content") or "")
            for m in reversed(history)
            if m.get("role") == "user"
        ),
        "",
    )
    query_in_history = bool(user_text) and last_user.strip() == user_text.strip()
    sys_len = len(str(messages[0].get("content") or "")) if messages else 0
    logger.info(
        "create_campaign LLM inputs session=%s memory_msgs=%s roles=%s tool_msgs=%s "
        "query_len=%s query_in_history=%s system_chars=%s last_users=%s",
        session_id,
        len(history),
        roles,
        tool_n,
        len(user_text or ""),
        query_in_history,
        sys_len,
        user_turns[-4:],
    )
    if user_text and not history:
        logger.warning(
            "create_campaign LLM inputs: user_text present but history empty session=%s",
            session_id,
        )
    if user_text and history and not query_in_history:
        logger.warning(
            "create_campaign LLM inputs: latest query missing from memory session=%s "
            "query=%r last_user=%r",
            session_id,
            user_text[:160],
            last_user[:160],
        )


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def _is_hub_session(session: dict[str, Any]) -> bool:
    return bool(session.get("hub_mode")) or is_hub_session_id(
        session.get("session_id")
    )


def _keep_templates_fact_in_llm_memory(
    session: dict[str, Any], final_content: str
) -> None:
    """If this turn created cards and the recap LLM failed, keep that fact in llm_memory."""
    fact = str(session.pop("_templates_generated_note", "") or "").strip()
    if (final_content or "").strip() != LLM_UNAVAILABLE_REPLY or not fact:
        return
    mem = session.get("llm_memory")
    if not isinstance(mem, list):
        mem = get_llm_memory(session)
        session["llm_memory"] = mem
    last = mem[-1] if mem else None
    if (
        isinstance(last, dict)
        and last.get("role") == "assistant"
        and not last.get("tool_calls")
        and str(last.get("content") or "").strip() == LLM_UNAVAILABLE_REPLY
    ):
        last["content"] = fact
        return
    if any(
        isinstance(m, dict)
        and m.get("role") == "assistant"
        and fact in str(m.get("content") or "")
        for m in mem[-8:]
    ):
        return
    append_llm_memory(session, {"role": "assistant", "content": fact})


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    if _is_hub_session(session):
        return {
            "role": "system",
            "content": hub_system_prompt(session),
        }
    org = session.get("org_context") if isinstance(session.get("org_context"), dict) else {}
    return {
        "role": "system",
        "content": build_system_prompt(session, org),
    }


async def _emit_state(event_callback: Any, session_id: str) -> None:
    """Push overview from process memory. Safe to call right after tools save."""
    if not event_callback:
        return
    try:
        session = await get_or_create_session(session_id)
        await event_callback(
            {
                "type": "state_update",
                "state": public_state(session),
            }
        )
    except Exception:  # noqa: BLE001
        pass


# Tools that write draft fields the right-hand overview mirrors.
_STATE_TOOLS = frozenset(
    {
        "update_campaign_setup",
        "suggest_campaign_names",
        "update_campaign_meta",
        "set_channels",
        "select_audience",
        "check_contacts",
        "lookup_contacts",
        "create_contact",
        "upload_temporary_contacts",
        "update_contact",
        "build_campaign",
        "launch_campaign",
    }
)


from app.agents.create_campaign.user_facing import (
    looks_like_internal_reply,
    pick_user_facing_tool_message,
    sanitize_user_facing_reply,
    strip_inline_template_from_reply,
    tool_result_for_llm,
)


def _fact_reply_from_tools(
    round_tool_results: list[tuple[str, dict[str, Any]]],
) -> str:
    """Last-resort user HTML when tools succeeded but the LLM returned empty text."""
    if not round_tool_results:
        return ""
    # Prefer navigation / launch / build over earlier setup acks in the same turn.
    names = [n for n, _ in round_tool_results]
    prefer_hub = "OPEN_HUB_DESTINATION" in names
    prefer_launch = "launch_campaign" in names and not prefer_hub
    prefer_build = (
        "build_campaign" in names and not prefer_launch and not prefer_hub
    )
    parts: list[str] = []
    for name, result in round_tool_results:
        if not isinstance(result, dict):
            continue
        if prefer_hub and name != "OPEN_HUB_DESTINATION":
            continue
        if prefer_launch and name != "launch_campaign":
            continue
        if prefer_build and name != "build_campaign":
            continue
        facing = pick_user_facing_tool_message(result)
        if facing:
            parts.append(facing if facing.startswith("<") else f"<p>{facing}</p>")
            if result.get("ok") is False:
                continue
        if result.get("ok") is False:
            user_html = str(result.get("user_message") or "").strip()
            if user_html.startswith("<"):
                parts.append(user_html)
                continue
            if name not in ("build_campaign", "launch_campaign"):
                err = str(result.get("message") or result.get("error") or "").strip()
                if err and looks_like_internal_reply(err):
                    parts.append(sanitize_user_facing_reply(err))
                    continue
                if err and ("LOOKUP_EMAIL_TYPO" in err or "EMAIL_TYPO" in err):
                    suggested = str(result.get("suggested_email") or "").strip()
                    bad = str(result.get("email") or "").strip()
                    if suggested and bad:
                        parts.append(
                            f"<p><b>{bad}</b> looks mistyped — did you mean "
                            f"<b>{suggested}</b>?</p>"
                        )
                    elif suggested:
                        parts.append(
                            f"<p>That email looks mistyped — did you mean "
                            f"<b>{suggested}</b>?</p>"
                        )
                    else:
                        parts.append(
                            "<p>That email looks mistyped — please confirm the "
                            "correct address.</p>"
                        )
                elif (err and "LOOKUP_NOT_FOUND" in err) or result.get("found") is False:
                    missing_e = [
                        str(e)
                        for e in (result.get("emails_missing") or [])
                        if str(e).strip()
                    ][:3]
                    who = ", ".join(missing_e) if missing_e else "those people"
                    parts.append(
                        f"<p>I could not find <b>{who}</b> in Audience yet. "
                        "I can create the contact here — share a first name if needed "
                        "(I’ll reuse the email you already gave; phone is optional).</p>"
                    )
                elif err and not looks_like_internal_reply(err):
                    parts.append(f"<p>{err[:280]}</p>")
                elif err:
                    parts.append(sanitize_user_facing_reply(err))
                continue
        if name in ("check_contacts", "lookup_contacts"):
            if result.get("ok") is False:
                continue
            count = int(result.get("matched_count") or 0)
            samples = result.get("sample_names") or []
            who = ", ".join(str(s) for s in samples[:3] if s) or "the matched contacts"
            if result.get("found") and count > 0:
                parts.append(
                    f"<p>Found <b>{count}</b> contact(s) including {who}. "
                    "Audience is set on the campaign panel.</p>"
                )
            else:
                missing_e = [
                    str(e)
                    for e in (result.get("emails_missing") or [])
                    if str(e).strip()
                ][:3]
                who = ", ".join(missing_e) if missing_e else "those people"
                parts.append(
                    f"<p>No matching contacts for <b>{who}</b>. "
                    "I can create them here using the email/phone you already shared — "
                    "just confirm a first name if I don’t have it yet.</p>"
                )
        elif name == "create_contact":
            if result.get("ok") and result.get("created"):
                contact = (
                    result.get("contact")
                    if isinstance(result.get("contact"), dict)
                    else {}
                )
                label = (
                    " ".join(
                        p
                        for p in (
                            str(contact.get("first_name") or "").strip(),
                            str(contact.get("last_name") or "").strip(),
                        )
                        if p
                    ).strip()
                    or str(contact.get("email") or contact.get("phone") or "contact").strip()
                )
                matched = int(result.get("matched_count") or 0)
                if result.get("found") and matched > 0:
                    parts.append(
                        f"<p>Created <b>{label}</b> and set them as the campaign audience.</p>"
                    )
                else:
                    parts.append(
                        f"<p>Created contact <b>{label}</b> in Audience.</p>"
                    )
            elif result.get("ok") is False:
                err = str(result.get("message") or result.get("error") or "").strip()
                if "EMAIL_TYPO" in err:
                    suggested = str(result.get("suggested_email") or "").strip()
                    bad = str(result.get("email") or "").strip()
                    if suggested and bad:
                        parts.append(
                            f"<p><b>{bad}</b> looks mistyped — did you mean "
                            f"<b>{suggested}</b>? Confirm and I’ll create the contact "
                            "(phone not required).</p>"
                        )
                    else:
                        parts.append(
                            "<p>That email looks mistyped — please confirm the "
                            "correct address (phone not required).</p>"
                        )
                elif "INVALID_EMAIL" in err:
                    parts.append(
                        "<p>That email doesn’t look valid — please share a corrected "
                        "address (phone is optional).</p>"
                    )
                elif "ALREADY_EXISTS" in err or result.get("already_exists"):
                    contact = (
                        result.get("contact")
                        if isinstance(result.get("contact"), dict)
                        else {}
                    )
                    label = (
                        " ".join(
                            p
                            for p in (
                                str(contact.get("first_name") or "").strip(),
                                str(contact.get("last_name") or "").strip(),
                            )
                            if p
                        ).strip()
                        or "that contact"
                    )
                    parts.append(
                        f"<p><b>{label}</b> is already in Audience. "
                        "I can update their email/phone on that record — confirm "
                        "and I’ll apply the change (no new phone needed).</p>"
                    )
                elif "NEED_NAME" in err:
                    parts.append(
                        "<p>I still need a first name to create this contact "
                        "(I’ll keep the email you already gave; phone is optional).</p>"
                    )
                elif "NEED_CHANNEL" in err:
                    parts.append(
                        "<p>I need an email (or a phone with country code) to create "
                        "the contact — email alone is enough.</p>"
                    )
                elif "not_confirmed" in err or "CONFIRM" in err:
                    parts.append(
                        "<p>Confirm and I’ll create this contact in Audience.</p>"
                    )
                elif err and "CREATE_CONTACT" not in err[:40]:
                    parts.append(f"<p>{err[:280]}</p>")
        elif name == "upload_temporary_contacts":
            inserted = int(result.get("inserted") or 0)
            failed = int(result.get("failed") or 0)
            if inserted > 0:
                parts.append(
                    f"<p>Loaded <b>{inserted}</b> temporary contact(s) for this campaign"
                    + (f" ({failed} row(s) skipped)" if failed else "")
                    + ". They will be used as this campaign's audience.</p>"
                )
            else:
                parts.append(
                    "<p>Could not save temporary contacts — each row needs a valid "
                    "email or phone (with country code).</p>"
                )
        elif name == "update_contact":
            if result.get("ok") and result.get("updated"):
                contact = (
                    result.get("contact")
                    if isinstance(result.get("contact"), dict)
                    else {}
                )
                label = (
                    " ".join(
                        p
                        for p in (
                            str(contact.get("first_name") or "").strip(),
                            str(contact.get("last_name") or "").strip(),
                        )
                        if p
                    ).strip()
                    or str(contact.get("email") or contact.get("phone") or "contact").strip()
                )
                email = str(contact.get("email") or "").strip()
                extra = f" ({email})" if email else ""
                parts.append(f"<p>Updated <b>{label}</b>{extra} in Audience.</p>")
            elif result.get("ok") is False:
                err = str(result.get("message") or result.get("error") or "").strip()
                if "EMAIL_TYPO" in err:
                    suggested = str(result.get("suggested_email") or "").strip()
                    bad = str(result.get("email") or "").strip()
                    if suggested and bad:
                        parts.append(
                            f"<p><b>{bad}</b> looks mistyped — did you mean "
                            f"<b>{suggested}</b>?</p>"
                        )
                    else:
                        parts.append(
                            "<p>That email looks mistyped — please confirm the "
                            "correct address.</p>"
                        )
                elif "NEED_ID" in err or "contact_not_found" in err:
                    parts.append(
                        "<p>I couldn’t tell which contact to update — share the "
                        "current email or phone on that record.</p>"
                    )
                elif "not_confirmed" in err or "CONFIRM" in err:
                    parts.append(
                        "<p>Confirm and I’ll update this contact in Audience.</p>"
                    )
                elif err and "UPDATE_CONTACT" not in err[:40]:
                    parts.append(f"<p>{err[:280]}</p>")
        elif name in ("update_campaign_setup", "update_campaign_meta", "set_channels"):
            panel = result.get("panel") if isinstance(result.get("panel"), dict) else {}
            channels = panel.get("channels") or result.get("channels") or []
            if isinstance(channels, list) and channels:
                labels = ", ".join(str(c) for c in channels)
                parts.append(f"<p>Channels set: <b>{labels}</b>.</p>")
            name_v = str(panel.get("name") or "").strip()
            if name_v:
                parts.append(f"<p>Campaign name: <b>{name_v}</b>.</p>")
        elif name == "select_audience":
            count = int(result.get("matched_count") or 0)
            parts.append(f"<p>Audience updated — <b>{count}</b> contact(s) matched.</p>")
        elif name == "build_campaign":
            ready = [
                str(c).strip().lower()
                for c in (result.get("channels") or [])
                if str(c).strip()
            ]
            missing = [
                str(c).strip().lower()
                for c in (result.get("missing_channels") or [])
                if str(c).strip()
            ]
            if result.get("ok") is False:
                err = str(
                    result.get("user_message")
                    or result.get("message")
                    or result.get("error")
                    or ""
                ).strip()
                if result.get("error") == "templates_already_exist":
                    parts.append(
                        "<p>Your templates are already on the panel.</p>"
                        "<p>Say <b>launch now</b> when you want to send, or ask to "
                        "regenerate if you want new versions.</p>"
                    )
                elif err.startswith("<"):
                    parts.append(err)
                elif err:
                    parts.append(f"<p>{err[:280]}</p>")
                else:
                    parts.append(
                        "<p>Template generation did not finish. Please try again.</p>"
                    )
            elif missing and ready:
                parts.append(
                    f"<p>Templates ready for <b>{', '.join(ready)}</b>. "
                    f"Still missing: <b>{', '.join(missing)}</b>.</p>"
                    "<p>We can finish the missing channels, or launch with the "
                    "channels that already have cards — say which you prefer.</p>"
                )
            else:
                label = ", ".join(ready) if ready else "your channels"
                parts.append(
                    f"<p>Templates are ready for <b>{label}</b>. "
                    "Review them on the panel, then confirm send when you want to launch.</p>"
                )
        elif name == "launch_campaign":
            email_warn = str(result.get("email_send_warning") or "").strip()
            user_html = str(result.get("user_message") or "").strip()
            if result.get("ok") is False:
                if user_html.startswith("<"):
                    parts.append(user_html)
                else:
                    err = str(
                        result.get("message") or result.get("error") or email_warn or ""
                    ).strip()
                    if "Tell the user" in err or "Launch blocked" in err:
                        parts.append(
                            "<p>We can't launch yet — some templates or setup "
                            "are still missing. Check the overview panel.</p>"
                        )
                    elif err:
                        parts.append(f"<p>{err[:480]}</p>")
                    else:
                        parts.append(
                            "<p>Launch could not proceed. Check the panel and try again.</p>"
                        )
            else:
                msg = str(result.get("message") or "").strip()
                if msg:
                    parts.append(f"<p>{msg[:480]}</p>")
                else:
                    parts.append(
                        "<p>Launch request processed. Check the panel for status.</p>"
                    )
                channels = [
                    str(c).strip().lower()
                    for c in (result.get("channels_scheduled") or [])
                    if str(c).strip()
                ]
                if email_warn:
                    parts.append(f"<p><b>Email note:</b> {email_warn[:400]}</p>")
                elif "email" in channels and result.get("email_queued") is True:
                    parts.append(
                        "<p>Web tracking tokens (<code>wt=</code>) are added to CTA "
                        "links in each sent email — not in the panel preview.</p>"
                    )
    out: list[str] = []
    for p in parts:
        if not out or out[-1] != p:
            out.append(p)
    return "".join(out)


def _prefetch_org_and_audience(session_id: str, token: str) -> None:
    """Warm org + audience summary without blocking the LLM turn."""

    async def _run() -> None:
        try:
            await ensure_org_context(session_id, token)
        except Exception:  # noqa: BLE001
            pass
        try:
            await ensure_audience_summary(session_id, token)
        except Exception:  # noqa: BLE001
            pass

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(_run())


def _tool_payload_for_llm(result: dict[str, Any]) -> dict[str, Any]:
    skip = {"ui_event", "assistant_html", "send_strategy_html"}
    return {k: v for k, v in result.items() if k not in skip}


async def _llm_narrate_after_tool(
    messages: list[dict],
    *,
    tool_name: str,
    tool_args: dict[str, Any],
    tool_result: dict[str, Any],
    retries: int = 3,
) -> str:
    """LLM pass after a deterministic tool — retries when the model returns empty text."""
    import json

    payload = _tool_payload_for_llm(tool_result)
    narrate = list(messages)
    narrate.append(
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "deterministic_tool",
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": json.dumps(tool_args),
                    },
                }
            ],
        }
    )
    narrate.append(
        {
            "role": "tool",
            "tool_call_id": "deterministic_tool",
            "name": tool_name,
            "content": json.dumps(payload),
        }
    )
    # Also append into the live messages list so llm_memory keeps tool facts.
    messages.append(narrate[-2])
    messages.append(narrate[-1])

    for attempt in range(max(1, retries)):
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    _llm().run,
                    narrate,
                    [],
                    CHAT_REASONING_EFFORT,
                    CREATE_CHAT_MAX_TOKENS,
                ),
                timeout=CHAT_LLM_TIMEOUT_S,
            )
            text = strip_markdown_emphasis((result.get("content") or "").strip())
            if text:
                return text
            narrate.append(
                {
                    "role": "user",
                    "content": (
                        "[internal_nudge] Reply to the user now in short HTML. "
                        "Do not leave the reply blank."
                    ),
                    "_internal_nudge": True,
                }
            )
        except Exception:  # noqa: BLE001
            continue
    return ""


_HUB_NO_TOOL_NUDGE = (
    "Hub router: infer the user's intent from their message (any wording) and call OPEN_HUB_DESTINATION "
    "with confirmed=true before replying. "
    "If they want to work on a new campaign → create_space, handoff_history=true. "
    "If they want ideas / templates / drafts / WhatsApp approvals / reports → matching destination. "
    "Never ask for campaign name, goal, or channels on the hub."
)


def _after_hub_no_tools(round_i: int, _content: str) -> str | None:
    if round_i <= 1:
        return _HUB_NO_TOOL_NUDGE
    return None


def _break_after_hub_navigate(
    round_calls: list[tuple[str, dict[str, Any]]], content: str
) -> str | None:
    for name, result in round_calls:
        if name != "OPEN_HUB_DESTINATION" or not isinstance(result, dict):
            continue
        if result.get("ok") is False:
            continue
        summary = str(result.get("message") or "").strip()
        if summary and not looks_like_internal_reply(summary):
            return summary if summary.startswith("<") else f"<p>{summary}</p>"
        return "<p>Opening your workspace…</p>"
    return None


_MAS_EXECUTOR_NO_TOOL_NUDGES: dict[str, str] = {
    "brief_validation": (
        "You must call update_campaign_setup (and plan_campaign_images when they want "
        "hero/banner images) before replying. Do not draft templates or paste HTML."
    ),
    "campaign_content": (
        "You must call plan_campaign_images when images are wanted, then build_campaign "
        "with user_confirmed=true before replying. Do not paste email HTML drafts."
    ),
    "campaign_audience": (
        "You must call check_contacts or create_contact for named recipients before replying."
    ),
    "launch_scheduling": (
        "You must call launch_campaign with confirmed=true before replying. "
        "When templates already exist, do NOT call build_campaign or regenerate. "
        "Immediate / send again / re-launch → schedule_mode='now' and omit clock fields. "
        "When the user asks to schedule (e.g. in 5 minutes, tomorrow 9am), pass "
        "schedule_mode='at' and scheduled_at as ISO UTC or launch_local_date/time."
    ),
}


async def run_create_campaign_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    executor_id: str = "coordinator",
    ui_events: list | None = None,
    event_callback: Any = None,
    persist_chat: bool = True,
    persist_user: bool | None = None,
) -> dict[str, Any]:
    """Bounded create-campaign tool loop (MAS executors + legacy coordinator)."""
    user_text = (user_text or "").strip()
    logger.info(
        "create_campaign executor=%s turn start session=%s query=%r",
        executor_id,
        session_id,
        user_text[:160],
    )
    ui_events = list(ui_events or [])
    if persist_user is None:
        persist_user = persist_chat

    session = await get_or_create_session(session_id, token=token)
    if persist_user:
        from app.agents.image.user_assets import (
            message_images_from_upload_rows,
            peek_turn_chat_image_uploads,
            pop_turn_chat_image_uploads,
        )

        turn_rows = peek_turn_chat_image_uploads(session)
        img_list = message_images_from_upload_rows(turn_rows)
        if user_text or img_list:
            img_url = img_list[0]["url"] if img_list else ""
            img_fn = img_list[0].get("filename") if img_list else ""
            session = await append_message(
                session_id,
                "user",
                user_text,
                token=token,
                image_url=img_url or None,
                image_filename=img_fn or None,
                image_urls=img_list or None,
            )
            if turn_rows:
                pop_turn_chat_image_uploads(session)
                session = await save_session(session, token=token)

    hub_mode = _is_hub_session(session)
    if hub_mode:
        active_tools = tools or HUB_TOOLS
    else:
        active_tools = tools or CORE_TOOLS
        _prefetch_org_and_audience(session_id, token)
        session = await get_or_create_session(session_id, token=token)
        session = await hydrate_session_audience(session, session_id, token=token)

    if not hub_mode:
        mem = strip_internal_nudges(get_llm_memory(session))
        if mem != list(session.get("llm_memory") or []):
            session["llm_memory"] = mem
            session = await save_session(session, token=token)
        if user_text and persist_user:
            last = mem[-1] if mem else None
            if not (
                isinstance(last, dict)
                and last.get("role") == "user"
                and str(last.get("content") or "").strip() == user_text
            ):
                mem = [*mem, {"role": "user", "content": user_text}]
                session["llm_memory"] = mem
                session = await save_session(session, token=token)
        elif user_text and not persist_user:
            last = mem[-1] if mem else None
            if not (
                isinstance(last, dict)
                and last.get("role") == "user"
                and str(last.get("content") or "").strip() == user_text
            ):
                mem = [*mem, {"role": "user", "content": user_text}]
        history = list(mem)
    else:
        from app.session_store import chat_history_for_llm

        history = chat_history_for_llm(session, limit=None)
        if user_text and not persist_user:
            history = [*history, {"role": "user", "content": user_text}]

    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [_system_message(session)]
    messages.extend(history)
    _log_llm_inputs(session_id, user_text, messages, history)

    await emit_process_progress(event_callback, "thinking")

    def _after_no_tools(round_i: int, content: str) -> str | None:
        from app.agents.create_campaign.chat_html_normalize import (
            looks_like_complete_user_reply,
        )

        # Model already wrote a full user-facing answer (ideas, lists, questions).
        # Forcing tools here discarded that reply and left mid-cut / empty bubbles.
        if looks_like_complete_user_reply(content):
            return None
        nudge = _MAS_EXECUTOR_NO_TOOL_NUDGES.get(str(executor_id or "").strip().lower())
        if nudge and round_i == 0:
            return nudge
        return None

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        t0 = time.perf_counter()
        if hub_mode:
            result = await dispatch_tool(
                name, session_id, token, args, event_callback=event_callback
            )
        else:
            payload = dict(args or {})
            if name in (
                "update_campaign_setup",
                "suggest_campaign_names",
                "update_campaign_meta",
                "build_campaign",
                "set_channels",
                "select_audience",
                "lookup_contacts",
                "check_contacts",
                "create_contact",
                "update_contact",
                "launch_campaign",
                "plan_campaign_images",
            ):
                payload.setdefault("user_text", user_text)
            try:
                result = await dispatch_core_tool(
                    name, session_id, token, payload, event_callback=event_callback
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "create_campaign tool %s crashed session=%s executor=%s",
                    name,
                    session_id,
                    executor_id,
                )
                result = {
                    "ok": False,
                    "error": str(exc)[:240],
                    "message": (
                        f"Tool {name} failed internally. "
                        "Explain briefly in short HTML; do not paste this error."
                    ),
                    "user_message": (
                        "<p>Something went wrong finishing that step. "
                        "Please try again in a moment.</p>"
                    ),
                }
        logger.info(
            "create_campaign tool %s executor=%s %.2fs ok=%s",
            name,
            executor_id,
            time.perf_counter() - t0,
            (result or {}).get("ok") if isinstance(result, dict) else None,
        )
        if isinstance(result, dict) and result.get("ui_event"):
            ui_events.append(result["ui_event"])
        if name in _STATE_TOOLS and isinstance(result, dict) and result.get("ok") is not False:
            await _emit_state(event_callback, session_id)
        return result

    async def after_each_tool(
        name: str, _result: dict[str, Any], _messages: list[dict]
    ) -> None:
        if name not in _STATE_TOOLS:
            await _emit_state(event_callback, session_id)

    def _serialize_tool_for_llm(result: dict[str, Any]) -> str:
        return json.dumps(tool_result_for_llm(result))

    final_content = ""
    try:
        loop_result = await run_tool_loop(
            _llm(),
            messages,
            active_tools,
            dispatch=dispatch,
            ui_events=ui_events,
            max_rounds=max(_MAX_TOOL_ROUNDS, 6),
            max_tokens=CREATE_CHAT_MAX_TOKENS,
            timeout_retries=max(2, CHAT_LLM_TIMEOUT_RETRIES),
            empty_content_retries=2,
            unavailable_reply=LLM_UNAVAILABLE_REPLY,
            after_each_tool=None if hub_mode else after_each_tool,
            after_no_tools=_after_hub_no_tools if hub_mode else _after_no_tools,
            break_after_tools=_break_after_hub_navigate if hub_mode else None,
            serialize_tool_result=_serialize_tool_for_llm,
        )
        ui_events = loop_result.ui_events
        final_content = (loop_result.content or "").strip()
        # One user-visible bubble per turn — do not concatenate prior assistant replies.
        # Session JSON + llm_memory (user turns, tools) carry state for the next step.
        from app.agents.create_campaign.chat_html_normalize import normalize_chat_html

        if final_content:
            final_content = normalize_chat_html(final_content)
    except Exception:  # noqa: BLE001
        final_content = LLM_UNAVAILABLE_REPLY
        loop_result = type(
            "LR",
            (),
            {"used_tools": False, "content": "", "round_tool_results": []},
        )()

    if not final_content:
        final_content = LLM_UNAVAILABLE_REPLY

    if getattr(loop_result, "used_tools", False) and getattr(
        loop_result, "round_tool_results", None
    ):
        leaked = looks_like_internal_reply(final_content)
        if (
            not final_content
            or final_content == LLM_UNAVAILABLE_REPLY
            or leaked
        ):
            fact = _fact_reply_from_tools(list(loop_result.round_tool_results))
            if fact:
                final_content = fact
            elif leaked:
                final_content = sanitize_user_facing_reply(final_content)

    final_content = sanitize_user_facing_reply(final_content)
    final_content = strip_inline_template_from_reply(final_content)

    if not hub_mode:
        transcript = strip_internal_nudges(
            [m for m in messages if isinstance(m, dict) and m.get("role") != "system"]
        )
        if final_content:
            last = transcript[-1] if transcript else None
            if not (
                isinstance(last, dict)
                and last.get("role") == "assistant"
                and not last.get("tool_calls")
                and str(last.get("content") or "").strip() == final_content
            ):
                transcript.append({"role": "assistant", "content": final_content})
        session = await get_or_create_session(session_id, token=token)
        replace_llm_memory(session, transcript)
        _keep_templates_fact_in_llm_memory(session, final_content)
        await save_session(session, token=token)

    await emit_process_progress(event_callback, "thinking", status="done")

    if persist_chat:
        await append_message(session_id, "assistant", final_content, token=token)
    else:
        await save_session(await get_or_create_session(session_id, token=token), token=token)

    session = await get_or_create_session(session_id, token=token)
    if not hub_mode:
        await _emit_state(event_callback, session_id)
    return {
        "reply": final_content,
        "followups": [],
        "ui_events": ui_events,
        "state": public_state(session),
        "used_tools": bool(getattr(loop_result, "used_tools", False)),
    }


async def run_coordinator(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    ui_events: list | None = None,
    event_callback: Any = None,
    persist_chat: bool = True,
    persist_user: bool | None = None,
) -> dict[str, Any]:
    """Jun30 Agent.run semantics: tool_calls → tools; else content → user."""
    user_text = (user_text or "").strip()
    logger.info(
        "create_campaign turn start session=%s query=%r",
        session_id,
        user_text[:160],
    )
    result = await run_create_campaign_executor_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        tools=None,
        system_content=None,
        executor_id="coordinator",
        ui_events=list(ui_events or []),
        event_callback=event_callback,
        persist_chat=persist_chat,
        persist_user=persist_user,
    )
    return {
        "reply": result.get("reply") or "",
        "followups": result.get("followups") or [],
        "ui_events": result.get("ui_events") or [],
    }


class _CoordinatorRunner:
    async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
        return await run_coordinator(
            session_id=str(state["session_id"]),
            token=str(state["token"]),
            user_text=str(state.get("user_text") or ""),
            ui_events=list(state.get("ui_events") or []),
            event_callback=state.get("event_callback"),
            persist_chat=bool(state.get("persist_chat", True)),
            persist_user=state.get("persist_user"),
        )


_RUNNER: _CoordinatorRunner | None = None


def get_graph() -> _CoordinatorRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = _CoordinatorRunner()
    return _RUNNER


async def run_create_campaign_turn(
    session_id: str,
    token: str,
    user_text: str,
    event_callback=None,
    *,
    persist_chat: bool = True,
    persist_user: bool | None = None,
) -> dict[str, Any]:
    set_request_token(token)
    result = await run_coordinator(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
        persist_chat=persist_chat,
        persist_user=persist_user,
    )
    session = await get_or_create_session(session_id, token=token)
    return {
        "reply": result.get("reply") or "",
        "followups": result.get("followups") or [],
        "ui_events": result.get("ui_events") or [],
        "state": public_state(session),
        "messages": session.get("messages") or [],
        "persist_chat": persist_chat,
    }


__all__ = [
    "run_coordinator",
    "run_create_campaign_executor_turn",
    "run_create_campaign_turn",
    "welcome_text",
    "get_graph",
]
