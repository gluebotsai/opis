"""Single-writer MAS chat transcript — user once at turn start, assistant once at end."""

from __future__ import annotations

from typing import Any

from app.mas.runtime.turn import MasTurn
from app.request_context import mas_transcript_scope
from app.session_store import (
    append_llm_memory,
    append_message,
    get_llm_memory,
    get_or_create_session,
    save_session,
)


_CREATE_CHAT_MODULES = frozenset(
    {"create_campaign", "library_run", "recommendation_run", "recommendations"}
)

_HANDOFF_STATUSES = frozenset({"needs_domain"})


def _user_facing_create_reply(module: str, reply: str) -> str:
    mod = str(module or "").strip().lower()
    if mod not in _CREATE_CHAT_MODULES:
        return reply
    from app.agents.create_campaign.user_facing import (
        sanitize_user_facing_reply,
        strip_inline_template_from_reply,
    )

    return strip_inline_template_from_reply(sanitize_user_facing_reply(reply))


def _is_handoff_result(result: dict[str, Any]) -> bool:
    status = str(result.get("action_status") or "").strip().lower()
    if status in _HANDOFF_STATUSES:
        return True
    if str(result.get("status") or "").strip().lower() == "needs_domain_choice":
        return True
    needs = result.get("needs_domain")
    if isinstance(needs, dict) and needs.get("domain_id"):
        return True
    return False


def _executor_reply(result: dict[str, Any]) -> str:
    """Prefer executor-level reply over domain routing prose."""
    nested = result.get("result")
    if isinstance(nested, dict):
        for key in ("reply", "message"):
            text = str(nested.get(key) or "").strip()
            if text:
                return text
    kind = str(result.get("kind") or "").strip().lower()
    if kind == "executor":
        for key in ("reply", "message"):
            text = str(result.get(key) or "").strip()
            if text:
                return text
    return ""


def _result_nodes(result: dict[str, Any]) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = [result]
    domain_result = result.get("domain_result")
    if isinstance(domain_result, dict):
        nodes.append(domain_result)
        nested = domain_result.get("result")
        if isinstance(nested, dict):
            nodes.append(nested)
    return nodes


def extract_turn_chat_meta(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """Persist analytics cards on assistant rows for dashboard/reports remount."""
    if not isinstance(result, dict):
        return None
    for node in _result_nodes(result):
        analytics = node.get("analytics")
        suggestions = node.get("suggestions")
        if not isinstance(analytics, dict) or not analytics.get("visual"):
            continue
        if analytics.get("include_visual") is False:
            continue
        meta: dict[str, Any] = {"analytics": analytics}
        if isinstance(suggestions, list):
            cleaned = [str(s).strip() for s in suggestions if str(s).strip()]
            if cleaned:
                meta["suggestions"] = cleaned
        return meta
    return None


def extract_turn_reply(result: dict[str, Any] | None) -> str:
    """User-visible reply only — never MAS handoff metadata."""
    if not isinstance(result, dict):
        return ""
    domain_result = result.get("domain_result")
    if isinstance(domain_result, dict):
        exec_reply = _executor_reply(domain_result)
        if exec_reply:
            return exec_reply
        if _is_handoff_result(domain_result):
            return ""
        for key in ("reply", "message"):
            text = str(domain_result.get(key) or "").strip()
            if text:
                return text
    exec_reply = _executor_reply(result)
    if exec_reply:
        return exec_reply
    if _is_handoff_result(result):
        return ""
    for key in ("reply", "message"):
        text = str(result.get(key) or "").strip()
        if text:
            return text
    return ""


async def record_user_turn(turn: MasTurn) -> None:
    """Append verbatim user row — only callable from mas_invoke begin."""
    text = turn.verbatim_user_text.strip()
    if not turn.session_id:
        return
    with mas_transcript_scope(managed=False):
        mod = turn.module or "contacts"
        session = await get_or_create_session(
            turn.session_id,
            token=turn.token or None,
            module=mod,
        )
        image_url = ""
        image_filename = ""
        try:
            from app.agents.image.user_assets import (
                message_images_from_upload_rows,
                pop_turn_chat_image_uploads,
            )

            turn_uploads = pop_turn_chat_image_uploads(session)
            image_list = message_images_from_upload_rows(turn_uploads)
            image_url = image_list[0]["url"] if image_list else ""
            image_filename = image_list[0].get("filename") if image_list else ""
            if turn_uploads:
                await save_session(session, token=turn.token or None)
        except Exception:  # noqa: BLE001
            image_url = ""
            image_filename = ""

        if not text and not image_url:
            return

        msgs = session.get("messages") or []
        last = msgs[-1] if msgs else None
        last_img = (
            str(last.get("image_url") or "").strip()
            if isinstance(last, dict)
            else ""
        )
        same_user_text = (
            isinstance(last, dict)
            and str(last.get("role") or "") == "user"
            and str(last.get("text") or "").strip() == text
        )
        if same_user_text and image_url and last_img and image_url != last_img:
            # Distinct image upload (often empty caption) — always a new bubble.
            await append_message(
                turn.session_id,
                "user",
                text,
                token=turn.token or None,
                module=mod,
                image_url=image_url or None,
                image_filename=image_filename or None,
                image_urls=image_list or None,
            )
            session = await get_or_create_session(
                turn.session_id,
                token=turn.token or None,
                module=mod,
            )
        elif same_user_text:
            from app.carry_messages import _merge_message_image_fields

            last_d = dict(last) if isinstance(last, dict) else {}
            donor: dict[str, Any] = {}
            if image_list:
                donor["image_urls"] = image_list
            if image_url:
                donor["image_url"] = image_url
            if image_filename:
                donor["image_filename"] = image_filename
            merged = _merge_message_image_fields(last_d, donor)
            if merged != last_d:
                msgs = list(msgs)
                msgs[-1] = merged
                session["messages"] = msgs
                await save_session(session, token=turn.token or None)
        else:
            await append_message(
                turn.session_id,
                "user",
                # Keep UI clean for image-only turns — no canned upload caption.
                text,
                token=turn.token or None,
                module=mod,
                image_url=image_url or None,
                image_filename=image_filename or None,
                image_urls=image_list or None,
            )
            session = await get_or_create_session(
                turn.session_id,
                token=turn.token or None,
                module=mod,
            )
        mem = get_llm_memory(session)
        last_mem = mem[-1] if mem else None
        mem_text = text or (
            f"[User uploaded image:{image_filename or 'image'}; "
            "see pending_chat_images — decide next step (confirm/attach) in your reply.]"
            if image_url
            else ""
        )
        if not (
            isinstance(last_mem, dict)
            and last_mem.get("role") == "user"
            and str(last_mem.get("content") or "").strip() == mem_text
        ):
            append_llm_memory(session, {"role": "user", "content": mem_text})
            await save_session(session, token=turn.token or None)


async def record_assistant_turn(turn: MasTurn, result: dict[str, Any] | None) -> None:
    """Append assistant reply once at turn end."""
    mod = turn.module or "contacts"
    payload = result if isinstance(result, dict) else {}
    reply = _user_facing_create_reply(mod, extract_turn_reply(payload))
    chat_meta = extract_turn_chat_meta(payload)
    if not reply or not turn.session_id:
        return
    with mas_transcript_scope(managed=False):
        session = await get_or_create_session(
            turn.session_id,
            token=turn.token or None,
            module=mod,
        )
        msgs = list(session.get("messages") or [])
        last = msgs[-1] if msgs else None
        if (
            isinstance(last, dict)
            and str(last.get("role") or "") == "assistant"
            and str(last.get("text") or "").strip() == reply
        ):
            if chat_meta and not (
                isinstance(last.get("meta"), dict)
                and isinstance(last["meta"].get("analytics"), dict)
                and last["meta"]["analytics"].get("visual")
            ):
                last = {**last, "meta": chat_meta}
                msgs[-1] = last
                session["messages"] = msgs
                await save_session(session, token=turn.token or None)
            return
        await append_message(
            turn.session_id,
            "assistant",
            reply,
            meta=chat_meta,
            token=turn.token or None,
            module=mod,
        )
