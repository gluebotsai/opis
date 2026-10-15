"""Campaign image plan — LLM sets explicit slots; tools normalize only."""

from __future__ import annotations

from typing import Any

from app.agents.image.channel_image import (
    eligible_image_channels,
    normalize_channel_list,
    resolve_plan_channels,
)
from app.mas.runtime.task_memory import get_mas_task


def _image_root(session: dict[str, Any]) -> dict[str, Any]:
    task = get_mas_task(session)
    slots = task.setdefault("slots", {})
    if not isinstance(slots.get("image"), dict):
        slots["image"] = {}
    return slots["image"]


def get_image_plan(session: dict[str, Any]) -> dict[str, Any]:
    root = _image_root(session)
    plan = root.get("plan")
    return dict(plan) if isinstance(plan, dict) else {}


def set_image_plan(
    session: dict[str, Any],
    *,
    wants_images: bool,
    channels: list[str] | None = None,
    mode: str = "shared",
    scope: str = "all_eligible",
    auto_after_build: bool = True,
    user_confirmed: bool = False,
) -> dict[str, Any]:
    """Persist normalized image plan into MAS slots."""
    mode_norm = str(mode or "shared").strip().lower().replace("-", "_")
    if mode_norm not in ("shared", "per_channel"):
        mode_norm = "shared"
    resolved = resolve_plan_channels(session, channels=channels, scope=scope)
    skipped = [
        ch
        for ch in selected_non_image_channels(session, channels, scope)
        if ch not in resolved
    ]
    plan = {
        "wants_images": bool(wants_images),
        "channels": resolved,
        "mode": mode_norm,
        "scope": str(scope or ("all_eligible" if not channels else "subset")).strip(),
        "auto_after_build": bool(auto_after_build),
        "user_confirmed": bool(user_confirmed),
        "status": "pending" if wants_images and resolved else "none",
        "skipped_channels": skipped,
    }
    root = _image_root(session)
    root["plan"] = plan
    return plan


def selected_non_image_channels(
    session: dict[str, Any],
    channels: list[str] | None,
    scope: str,
) -> list[str]:
    from app.agents.image.channel_image import selected_session_channels

    scope_norm = str(scope or "").strip().lower()
    if scope_norm in ("all_eligible", "all", "all_channels", "all_selected"):
        return selected_session_channels(session)
    return normalize_channel_list(channels or [])


def _fields_for_channel(session: dict[str, Any], channel: str) -> dict[str, Any]:
    ch = str(channel or "").strip().lower()
    for row in session.get("templates") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("channel") or "").strip().lower() != ch:
            continue
        fields = row.get("fields")
        if isinstance(fields, dict):
            return fields
    return {}


def _channel_still_needs_images(session: dict[str, Any], channel: str) -> bool:
    from app.agents.image.hero_image import (
        fields_have_hero_image,
        list_unfilled_image_section_indices,
    )

    ch = str(channel or "").strip().lower()
    fields = _fields_for_channel(session, ch)
    if ch == "email":
        pending = list_unfilled_image_section_indices(fields)
        if pending:
            return True
    return not fields_have_hero_image(fields)


def should_run_pipeline_after_build(session: dict[str, Any]) -> bool:
    plan = get_image_plan(session)
    if not plan.get("wants_images"):
        # Confirmed chat uploads still require attach even if plan was cleared.
        try:
            from app.agents.image.user_assets import confirmed_template_images

            if confirmed_template_images(session):
                return True
        except Exception:  # noqa: BLE001
            pass
        return False
    status = str(plan.get("status") or "").strip().lower()
    if status == "attach_failed":
        return False
    if status == "attached":
        for ch in plan.get("channels") or []:
            if _channel_still_needs_images(session, str(ch)):
                return True
        return False
    if not plan.get("auto_after_build", True):
        return False
    if not plan.get("channels"):
        return False
    for ch in plan.get("channels") or []:
        ch_norm = str(ch).strip().lower()
        if ch_norm and _channel_still_needs_images(session, ch_norm):
            return True
    return False


def mark_plan_status(session: dict[str, Any], status: str) -> None:
    root = _image_root(session)
    plan = dict(root.get("plan") or {})
    plan["status"] = str(status or "").strip()
    root["plan"] = plan


def images_by_channel_slot(session: dict[str, Any]) -> dict[str, str]:
    root = _image_root(session)
    raw = root.get("images_by_channel")
    if not isinstance(raw, dict):
        return {}
    return {
        str(k): str(v)
        for k, v in raw.items()
        if str(k).strip() and str(v).strip()
    }


def set_images_by_channel(session: dict[str, Any], mapping: dict[str, str]) -> None:
    root = _image_root(session)
    root["images_by_channel"] = {
        str(k): str(v) for k, v in (mapping or {}).items() if str(v).strip()
    }
    if mapping:
        # Keep last_image_url as most recent / shared reference.
        root["last_image_url"] = next(iter(mapping.values()))


__all__ = [
    "get_image_plan",
    "images_by_channel_slot",
    "mark_plan_status",
    "set_image_plan",
    "set_images_by_channel",
    "should_run_pipeline_after_build",
]
