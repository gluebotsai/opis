"""Align MAS image plan with Template Director email slot specs."""

from __future__ import annotations

from typing import Any

from app.agents.image.hero_image import normalize_image_slot_specs
from app.agents.image.plan import get_image_plan, set_image_plan


def apply_design_plans_to_image_plan(
    session: dict[str, Any],
    design_plans: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """When Director planned email images, ensure image plan wants_images + slot metadata."""
    email_plan: dict[str, Any] = {}
    for row in design_plans or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("channel") or "").strip().lower() == "email":
            email_plan = row
            break
    specs = normalize_image_slot_specs(email_plan.get("image_slot_specs"))
    if not specs:
        sections = email_plan.get("sections") if isinstance(email_plan.get("sections"), list) else []
        image_count = sum(1 for s in sections if str(s).strip().lower() == "image")
        if image_count > 0:
            specs = [
                {
                    "role": "hero" if i == 0 else "product",
                    "aspect_ratio": "16:9" if i == 0 else "1:1",
                    "display": "full_width" if i == 0 else "grid_cell",
                    "subject_hint": "",
                }
                for i in range(min(image_count, 6))
            ]
    if not specs:
        return get_image_plan(session)

    existing = get_image_plan(session)
    channels = list(existing.get("channels") or [])
    if "email" not in channels:
        channels.append("email")

    plan = set_image_plan(
        session,
        wants_images=True,
        channels=channels or ["email"],
        auto_after_build=True,
        user_confirmed=bool(existing.get("user_confirmed")),
    )
    from app.mas.runtime.task_memory import get_mas_task

    task = get_mas_task(session)
    slots = task.setdefault("slots", {})
    image_root = slots.setdefault("image", {})
    if isinstance(image_root, dict):
        image_root["email_slot_specs"] = specs
        image_root["plan"] = plan
    return plan


__all__ = ["apply_design_plans_to_image_plan"]
