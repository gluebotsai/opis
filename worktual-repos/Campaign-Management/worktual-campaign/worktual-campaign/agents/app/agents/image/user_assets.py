"""User-provided campaign images (chat upload + gallery) for template attach.

LLM confirms chat uploads via confirm_chat_images. Tools normalize/persist only.
Generate/attach prefers confirmed URLs over AI generation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.agents.image.channel_image import (
    channel_supports_image,
    normalize_channel_list,
    selected_session_channels,
)
from app.agents.image.enhance import normalize_channel
from app.mas.runtime.task_memory import get_mas_task


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _image_root(session: dict[str, Any]) -> dict[str, Any]:
    task = get_mas_task(session)
    slots = task.setdefault("slots", {})
    if not isinstance(slots.get("image"), dict):
        slots["image"] = {}
    return slots["image"]


def _sync_slot_lists(session: dict[str, Any]) -> None:
    root = _image_root(session)
    root["pending_user_assets"] = list_pending_chat_images(session)
    root["confirmed_user_assets"] = list_confirmed_chat_images(session)


def compact_chat_image_uploads(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    from app.agents.image.media_upload import chat_store_media_url

    out: list[dict[str, Any]] = []
    for row in raw[:12]:
        if not isinstance(row, dict):
            continue
        url = chat_store_media_url(
            str(row.get("image_url") or row.get("url") or "").strip()
        )
        if not url:
            continue
        asset_id = str(row.get("id") or row.get("asset_id") or "").strip()
        if not asset_id:
            asset_id = str(uuid.uuid4())
        out.append(
            {
                "id": asset_id,
                "image_url": url[:4096],
                "media_id": str(row.get("media_id") or "").strip()[:128],
                "filename": str(row.get("filename") or row.get("name") or "").strip()[
                    :240
                ],
                "source": str(row.get("source") or "chat_upload").strip()[:64]
                or "chat_upload",
                "created_at": str(row.get("created_at") or "").strip() or _utc_now(),
            }
        )
    return out


def list_pending_chat_images(session: dict[str, Any]) -> list[dict[str, Any]]:
    raw = session.get("pending_chat_images")
    return compact_chat_image_uploads(raw if isinstance(raw, list) else [])


def list_pending_edit_chat_images(session: dict[str, Any]) -> list[dict[str, Any]]:
    raw = session.get("pending_edit_chat_images")
    return compact_chat_image_uploads(raw if isinstance(raw, list) else [])


def peek_turn_chat_image_uploads(session: dict[str, Any]) -> list[dict[str, Any]]:
    """Create-chat uploads attached to the current socket turn only (not session pending)."""
    raw = session.get("_turn_chat_image_uploads")
    return compact_chat_image_uploads(raw if isinstance(raw, list) else [])


def pop_turn_chat_image_uploads(session: dict[str, Any]) -> list[dict[str, Any]]:
    rows = peek_turn_chat_image_uploads(session)
    session.pop("_turn_chat_image_uploads", None)
    return rows


def message_images_from_upload_rows(
    rows: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """All uploads this turn — for chat bubble display + session persist."""
    from app.agents.image.media_upload import chat_store_media_url

    out: list[dict[str, str]] = []
    for row in compact_chat_image_uploads(rows):
        candidate = chat_store_media_url(str(row.get("image_url") or "").strip())
        if not candidate:
            continue
        item: dict[str, str] = {"url": candidate[:4096]}
        fn = str(row.get("filename") or "").strip()
        if fn:
            item["filename"] = fn[:240]
        out.append(item)
    return out[:12]


def bubble_image_from_upload_rows(
    rows: list[dict[str, Any]],
) -> tuple[str, str]:
    """First upload this turn → legacy single image_url fields."""
    images = message_images_from_upload_rows(rows)
    if not images:
        return "", ""
    first = images[0]
    return first.get("url") or "", first.get("filename") or ""


def list_confirmed_chat_images(session: dict[str, Any]) -> list[dict[str, Any]]:
    raw = session.get("confirmed_chat_images")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[:24]:
        if not isinstance(row, dict):
            continue
        url = str(row.get("image_url") or "").strip()
        if not url:
            continue
        channels = normalize_channel_list(row.get("channels"))
        out.append(
            {
                "id": str(row.get("id") or "").strip() or str(uuid.uuid4()),
                "image_url": url[:4096],
                "media_id": str(row.get("media_id") or "").strip()[:128],
                "filename": str(row.get("filename") or "").strip()[:240],
                "source": str(row.get("source") or "chat_upload").strip()[:64],
                "channels": channels,
                "include_in_templates": bool(row.get("include_in_templates", True)),
                "created_at": str(row.get("created_at") or "").strip() or _utc_now(),
            }
        )
    return out


def ingest_pending_chat_images(
    session: dict[str, Any],
    uploads: Any,
) -> list[dict[str, Any]]:
    """Append FE chat uploads into pending (awaiting LLM confirm)."""
    incoming = compact_chat_image_uploads(uploads)
    if not incoming:
        return []
    pending = list_pending_chat_images(session)
    seen = {str(r.get("image_url") or "") for r in pending}
    for row in incoming:
        url = str(row.get("image_url") or "")
        if url in seen:
            continue
        pending.append(row)
        seen.add(url)
    session["pending_chat_images"] = pending[:24]
    _sync_slot_lists(session)
    return incoming


def ingest_pending_edit_chat_images(
    session: dict[str, Any],
    uploads: Any,
) -> list[dict[str, Any]]:
    """Edit-space uploads — never mixed into create pending_chat_images."""
    incoming = compact_chat_image_uploads(uploads)
    if not incoming:
        return []
    for row in incoming:
        row["source"] = "edit_chat_upload"
    pending = list_pending_edit_chat_images(session)
    seen = {str(r.get("image_url") or "") for r in pending}
    for row in incoming:
        url = str(row.get("image_url") or "")
        if url in seen:
            continue
        pending.append(row)
        seen.add(url)
    session["pending_edit_chat_images"] = pending[:24]
    return incoming


def confirm_chat_images(
    session: dict[str, Any],
    *,
    include_in_templates: bool,
    asset_ids: list[str] | None = None,
    channels: list[str] | None = None,
) -> dict[str, Any]:
    """Move pending uploads to confirmed (or discard). Explicit LLM args only."""
    pending = list_pending_chat_images(session)
    if not pending:
        return {
            "ok": False,
            "error": "no_pending_images",
            "message": "No chat-uploaded images are waiting for confirmation.",
        }

    id_filter = {str(x).strip() for x in (asset_ids or []) if str(x).strip()}
    selected = [
        row
        for row in pending
        if not id_filter or str(row.get("id") or "") in id_filter
    ]
    if not selected:
        return {
            "ok": False,
            "error": "asset_ids_not_found",
            "message": "Those image ids are not in the pending upload list.",
            "pending": pending,
        }

    remaining = [
        row
        for row in pending
        if str(row.get("id") or "")
        not in {str(r.get("id") or "") for r in selected}
    ]
    session["pending_chat_images"] = remaining

    if not include_in_templates:
        _sync_slot_lists(session)
        return {
            "ok": True,
            "include_in_templates": False,
            "discarded": [str(r.get("id") or "") for r in selected],
            "pending_remaining": len(remaining),
            "message": (
                "Understood — those uploads will not be added to templates. "
                "Say if you want AI-generated heroes instead."
            ),
            "change_summary": "Chat images declined for templates.",
        }

    target_channels = normalize_channel_list(channels)
    if not target_channels:
        target_channels = [
            ch
            for ch in selected_session_channels(session)
            if channel_supports_image(ch)
        ]
    if not target_channels:
        target_channels = ["email"]

    confirmed = list_confirmed_chat_images(session)
    overlap = set(target_channels)
    confirmed = [
        row
        for row in confirmed
        if not overlap.intersection(normalize_channel_list(row.get("channels")))
    ]
    for row in selected:
        confirmed.append(
            {
                **row,
                "channels": target_channels,
                "include_in_templates": True,
                "confirmed_at": _utc_now(),
            }
        )
    session["confirmed_chat_images"] = confirmed[:24]

    from app.agents.image.plan import images_by_channel_slot, set_images_by_channel

    slot = dict(images_by_channel_slot(session))
    for ch in target_channels:
        slot.pop(normalize_channel(ch), None)
    set_images_by_channel(session, slot)

    from app.agents.image.plan import get_image_plan, set_image_plan

    plan = get_image_plan(session)
    if not plan.get("wants_images"):
        set_image_plan(
            session,
            wants_images=True,
            channels=target_channels,
            mode="shared" if len(selected) == 1 else str(plan.get("mode") or "shared"),
            scope="subset",
            auto_after_build=True,
            user_confirmed=True,
        )
    else:
        merged = list(
            dict.fromkeys(list(plan.get("channels") or []) + target_channels)
        )
        set_image_plan(
            session,
            wants_images=True,
            channels=merged,
            mode=str(plan.get("mode") or "shared"),
            scope=str(plan.get("scope") or "subset"),
            auto_after_build=bool(plan.get("auto_after_build", True)),
            user_confirmed=True,
        )

    _sync_slot_lists(session)
    return {
        "ok": True,
        "include_in_templates": True,
        "confirmed": [
            {
                "id": r.get("id"),
                "image_url": r.get("image_url"),
                "filename": r.get("filename"),
                "channels": target_channels,
            }
            for r in selected
        ],
        "channels": target_channels,
        "pending_remaining": len(remaining),
        "message": (
            "Those images are saved for this campaign and will be used on "
            f"{', '.join(target_channels)} templates when we generate or attach."
        ),
        "change_summary": (
            f"Confirmed {len(selected)} chat image(s) for "
            f"{', '.join(target_channels)}."
        ),
    }


def confirmed_template_images(session: dict[str, Any]) -> list[dict[str, Any]]:
    """Confirmed chat uploads marked for template use."""
    return [
        row
        for row in list_confirmed_chat_images(session)
        if row.get("include_in_templates")
        and str(row.get("image_url") or "").strip()
    ]


def sync_image_plan_for_confirmed_uploads(session: dict[str, Any]) -> dict[str, Any] | None:
    """Ensure image plan runs after build when the user confirmed chat uploads.

    Expands plan channels to all image-capable selected channels so an upload
    confirmed before channels were chosen still attaches everywhere needed.
    """
    confirmed = confirmed_template_images(session)
    if not confirmed:
        return None

    from app.agents.image.channel_image import selected_session_channels
    from app.agents.image.plan import get_image_plan, set_image_plan

    selected = [
        ch
        for ch in selected_session_channels(session)
        if channel_supports_image(ch)
    ]
    if not selected:
        selected = ["email"]

    # Widen confirmed rows so preferred_urls covers every image-capable channel.
    widened: list[dict[str, Any]] = []
    for row in list_confirmed_chat_images(session):
        if not row.get("include_in_templates"):
            widened.append(row)
            continue
        row_channels = normalize_channel_list(row.get("channels"))
        merged = list(dict.fromkeys(row_channels + selected))
        widened.append({**row, "channels": merged or selected})
    session["confirmed_chat_images"] = widened[:24]
    _sync_slot_lists(session)

    prior = get_image_plan(session)
    mode = str(prior.get("mode") or "shared").strip().lower() or "shared"
    return set_image_plan(
        session,
        wants_images=True,
        channels=selected,
        mode=mode if mode in ("shared", "per_channel") else "shared",
        scope="subset",
        auto_after_build=True,
        user_confirmed=True,
    )


def preferred_urls_by_channel(
    session: dict[str, Any],
    *,
    channels: list[str] | None = None,
    mode: str | None = None,
) -> dict[str, str]:
    """Resolve user/gallery image URLs to use instead of AI generation."""
    targets = normalize_channel_list(channels)
    if not targets:
        from app.agents.image.plan import get_image_plan

        targets = [
            normalize_channel(str(ch))
            for ch in (get_image_plan(session).get("channels") or [])
            if str(ch).strip()
        ]
    targets = [ch for ch in targets if channel_supports_image(ch)]
    if not targets:
        return {}

    mode_norm = str(mode or "").strip().lower() or "shared"
    mapping: dict[str, str] = {}

    confirmed = [
        r
        for r in list_confirmed_chat_images(session)
        if r.get("include_in_templates")
    ]
    # Latest confirm wins per channel (list order = confirm order).
    for row in reversed(confirmed):
        url = str(row.get("image_url") or "").strip()
        if not url:
            continue
        row_channels = normalize_channel_list(row.get("channels")) or targets
        for ch in row_channels:
            ch_n = normalize_channel(ch)
            if ch_n in targets and ch_n not in mapping:
                mapping[ch_n] = url

    if mapping and mode_norm == "shared":
        shared_url = ""
        for row in reversed(confirmed):
            url = str(row.get("image_url") or "").strip()
            if not url:
                continue
            row_channels = normalize_channel_list(row.get("channels")) or targets
            if any(normalize_channel(c) in targets for c in row_channels):
                shared_url = url
                break
        if shared_url:
            return {ch: shared_url for ch in targets}

    if len(mapping) >= len(targets):
        return {ch: mapping[ch] for ch in targets if ch in mapping}

    gallery = session.get("selected_gallery_images")
    if isinstance(gallery, list) and gallery:
        for row in gallery:
            if not isinstance(row, dict):
                continue
            url = str(row.get("image_url") or "").strip()
            if not url:
                continue
            if mode_norm == "shared" or not mapping:
                return {ch: url for ch in targets}
            for ch in targets:
                mapping.setdefault(ch, url)
            break

    return mapping


def session_images_for_edit(
    session: dict[str, Any],
    *,
    turn_uploads: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """This-turn uploads for edit attach; omit turn_uploads to inspect session photos."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(row: dict[str, Any], *, status: str) -> None:
        url = str(row.get("image_url") or "").strip()
        if not url or url in seen:
            return
        seen.add(url)
        out.append(
            {
                "id": str(row.get("id") or "").strip() or str(uuid.uuid4()),
                "image_url": url[:4096],
                "media_id": str(row.get("media_id") or "").strip()[:128],
                "filename": str(row.get("filename") or "").strip()[:240],
                "source": str(row.get("source") or "chat_upload").strip()[:64]
                or "chat_upload",
                "status": status,
                "created_at": str(row.get("created_at") or "").strip() or _utc_now(),
            }
        )

    for row in compact_chat_image_uploads(turn_uploads):
        _add(row, status="this_turn")
    if turn_uploads is not None:
        return out[:24]
    for row in list_pending_chat_images(session):
        _add(row, status="in_session")
    for row in list_confirmed_chat_images(session):
        if row.get("include_in_templates") is False:
            continue
        _add(row, status="confirmed")
    return out[:24]


def session_image_library(
    session: dict[str, Any],
    *,
    turn_uploads: list[dict[str, Any]] | None = None,
    on_template_urls: list[str] | None = None,
    edit_space: bool = False,
) -> list[dict[str, Any]]:
    """This-turn + earlier session uploads + gallery picks (not this-turn-only)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(row: dict[str, Any], *, status: str, source: str = "") -> None:
        url = str(row.get("image_url") or row.get("url") or "").strip()
        if not url or url in seen:
            return
        seen.add(url)
        on_tpl = url.lower() in {
            str(u).strip().lower() for u in (on_template_urls or []) if str(u).strip()
        }
        out.append(
            {
                "id": str(row.get("id") or row.get("asset_id") or "").strip()
                or str(uuid.uuid4()),
                "image_url": url[:4096],
                "media_id": str(row.get("media_id") or "").strip()[:128],
                "filename": str(row.get("filename") or row.get("name") or "").strip()[
                    :240
                ],
                "source": source
                or str(row.get("source") or "chat_upload").strip()[:64]
                or "chat_upload",
                "status": status,
                "already_on_template": on_tpl,
                "created_at": str(row.get("created_at") or "").strip() or _utc_now(),
            }
        )

    for row in compact_chat_image_uploads(turn_uploads):
        src = "edit_chat_upload" if edit_space else "chat_upload"
        _add(row, status="this_turn", source=src)
    pending_rows = (
        list_pending_edit_chat_images(session)
        if edit_space
        else list_pending_chat_images(session)
    )
    pending_source = "edit_chat_upload" if edit_space else "chat_upload"
    for row in pending_rows:
        _add(row, status="in_session", source=pending_source)
    if not edit_space:
        for row in list_confirmed_chat_images(session):
            if row.get("include_in_templates") is False:
                continue
            _add(row, status="confirmed", source="chat_upload")
    gallery = session.get("selected_gallery_images")
    if isinstance(gallery, list):
        for row in gallery[:24]:
            if isinstance(row, dict):
                _add(row, status="gallery", source="gallery")
    return out[:32]


def pending_images_fact_lines(session: dict[str, Any]) -> list[str]:
    pending = list_pending_chat_images(session)
    if not pending:
        return []
    lines = [
        "pending_chat_images: "
        f"{len(pending)} waiting — user uploaded image(s) this session. "
        "Reply naturally (no canned scripts): acknowledge the upload. "
        "If they already asked to add it to templates THIS turn, call "
        "confirm_chat_images(include_in_templates=true) now. Otherwise ask "
        "yes/no then call confirm_chat_images. "
        "Do not invent URLs; do not auto-attach without confirm_chat_images."
    ]
    for row in pending[:6]:
        name = str(row.get("filename") or "image").strip() or "image"
        lines.append(
            f"  - id={row.get('id')} file={name} "
            f"url={str(row.get('image_url') or '')[:120]}"
        )
    confirmed = list_confirmed_chat_images(session)
    if confirmed:
        lines.append(
            f"confirmed_chat_images: {len(confirmed)} will be preferred over AI generate "
            "only if the user still wants those photos. If they asked for new/different "
            "generated images, call clear_chat_images then plan_campaign_images."
        )
    return lines


def clear_chat_images(
    session: dict[str, Any],
    *,
    pending: bool = True,
    confirmed: bool = True,
) -> dict[str, Any]:
    """Drop sticky chat uploads so a later generate is not bound to an old photo."""
    dropped_pending = len(list_pending_chat_images(session)) if pending else 0
    dropped_confirmed = len(list_confirmed_chat_images(session)) if confirmed else 0
    if pending:
        session["pending_chat_images"] = []
    if confirmed:
        session["confirmed_chat_images"] = []
    _sync_slot_lists(session)
    from app.agents.image.plan import get_image_plan, set_image_plan

    plan = get_image_plan(session)
    if confirmed and plan.get("wants_images"):
        set_image_plan(
            session,
            wants_images=True,
            channels=list(plan.get("channels") or []),
            mode=str(plan.get("mode") or "shared"),
            scope=str(plan.get("scope") or "subset"),
            auto_after_build=bool(plan.get("auto_after_build", True)),
            user_confirmed=True,
        )
    return {
        "ok": True,
        "cleared_pending": dropped_pending,
        "cleared_confirmed": dropped_confirmed,
        "message": (
            "Previous chat photos will not be reused. "
            "Generate new images or upload a file on this turn."
        ),
        "change_summary": "Cleared sticky chat images.",
    }
