"""Image executor — enhance slot prompts, Gemini generate, map rebuild URLs.

Phase 2 never substitutes stock/static hero URLs. Failures surface as attach warnings.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from app.agents.image.enhance import strip_merge_tags, visual_alignment_copy
from app.mas.phase2_compose.html_images import map_hero_fields
from app.mas.phase2_compose.schemas import EmailPlan, ImageAsset, ImageSlot, envelope
from app.mas.phase2_compose.skills import Skill
from app.mas.phase2_compose.workspace import Workspace

_log = logging.getLogger(__name__)

SKILL: Skill = {
    "id": "image",
    "does": "Fill image slots with Gemini rebuild URLs",
    "needs": ["plan"],
    "provides": ["image_assets"],
    "failure": "soft",
}


def _slots_needed(plan: EmailPlan) -> bool:
    for slot in plan.get("image_slots") or []:
        if slot.get("needed"):
            return True
    return False


def _force_fail() -> bool:
    return os.environ.get("COMPOSE_FORCE_IMAGE_FAIL", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _campaign_from_ctx(ctx: dict[str, Any] | None) -> dict[str, Any]:
    data = ctx if isinstance(ctx, dict) else {}
    task = data.get("task_spec") if isinstance(data.get("task_spec"), dict) else {}
    camp = task.get("campaign") if isinstance(task.get("campaign"), dict) else {}
    if not camp and isinstance(data.get("campaign"), dict):
        camp = data["campaign"]
    return dict(camp)


def _token_from_ctx(ctx: dict[str, Any] | None) -> str:
    data = ctx if isinstance(ctx, dict) else {}
    token = str(data.get("token") or "").strip()
    if token:
        return token
    try:
        from app.request_context import get_request_token

        return str(get_request_token() or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def _slot_user_prompt(plan: EmailPlan, slot: ImageSlot) -> str:
    prompt = strip_merge_tags(str(slot.get("prompt") or ""))
    if prompt:
        return prompt
    role = str(slot.get("role") or "hero").strip() or "hero"
    return (
        f"Photoreal email {role} photograph of people in a real setting, "
        "natural lighting, editorial landscape crop. No text, letters, numbers, "
        "signs, screens, posters, banners, or logos with words in the image."
    )


def _alignment_brief(plan: EmailPlan, campaign: dict[str, Any]) -> str:
    bits = [
        visual_alignment_copy(str(plan.get("content_brief") or "")),
        visual_alignment_copy(str(campaign.get("objective") or campaign.get("goal") or "")),
    ]
    return next((b for b in bits if b), "")


async def generate_compose_image_url(
    *,
    user_prompt: str,
    plan: EmailPlan | None = None,
    slot: ImageSlot | None = None,
    campaign: dict[str, Any] | None = None,
    token: str = "",
) -> dict[str, Any]:
    """Enhance → Gemini → rebuild media URL. Used by create, chat, and Images tab."""
    from app.agents.image.enhance import enhance_image_prompt

    plan_obj: EmailPlan = plan if isinstance(plan, dict) else {}
    slot_obj: ImageSlot = slot if isinstance(slot, dict) else {}
    camp = campaign if isinstance(campaign, dict) else {}
    role = str(slot_obj.get("role") or "hero").strip() or "hero"
    w = int(slot_obj.get("width_px") or 600)
    h = int(slot_obj.get("height_px") or 338)
    raw = strip_merge_tags(user_prompt) or _slot_user_prompt(plan_obj, slot_obj)
    name = visual_alignment_copy(str(camp.get("name") or ""), max_len=80)
    goal = visual_alignment_copy(
        str(camp.get("goal") or camp.get("objective") or ""), max_len=120
    )
    brief = _alignment_brief(plan_obj, camp)
    subject = visual_alignment_copy(str(plan_obj.get("subject") or ""), max_len=120)

    enhanced = await enhance_image_prompt(
        raw,
        channel="email",
        aspect_hint=f"{w}x{h}",
        campaign_name=name,
        campaign_goal=goal,
        campaign_brief=brief,
        messaging_angle=brief,
        template_subject=subject,
        style_hint=role,
    )
    if not enhanced.ok:
        return {
            "ok": False,
            "error": enhanced.error or "Image prompt enhancement failed",
            "refused": enhanced.refused,
        }

    try:
        from app.integrations.gemini_image import generate_and_upload_rebuild_url

        result = await generate_and_upload_rebuild_url(
            enhanced.enhanced_prompt, token=token
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("compose Gemini generate failed role=%s", role)
        return {"ok": False, "error": str(exc)[:240] or "gemini_generate_failed"}

    if result.get("used_stub"):
        return {
            "ok": False,
            "error": "dev_stub_images_disabled",
        }
    url = str(result.get("url") or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return {"ok": False, "error": "Image upload returned no URL"}

    try:
        from app.gallery.image_asset_registry import register_gallery_image

        await register_gallery_image(
            image_url=url,
            token=token,
            media_id=str(result.get("media_id") or ""),
            source="ai_generated",
            generation_prompt=enhanced.enhanced_prompt,
            channel="email",
            context={"origin": "phase2_compose", "role": role},
        )
    except Exception:  # noqa: BLE001
        pass

    return {
        "ok": True,
        "url": url,
        "media_id": str(result.get("media_id") or ""),
        "used_stub": bool(result.get("used_stub")),
        "enhanced_prompt": enhanced.enhanced_prompt[:4000],
        "role": role,
        "width_px": w,
        "height_px": h,
    }


async def generate_and_map_compose_hero(
    fields: dict[str, Any],
    *,
    brief: str = "",
    campaign: dict[str, Any] | None = None,
    token: str = "",
) -> dict[str, Any]:
    """Generate a hero and map it onto compose HTML + header_image + image_assets."""
    current = dict(fields) if isinstance(fields, dict) else {}
    plan = current.get("plan") if isinstance(current.get("plan"), dict) else {}
    slots = plan.get("image_slots") if isinstance(plan.get("image_slots"), list) else []
    slot: ImageSlot = {}
    for row in slots:
        if isinstance(row, dict) and row.get("needed"):
            slot = dict(row)
            break
    if not slot:
        slot = {"role": "hero", "needed": True, "width_px": 600, "height_px": 338, "prompt": ""}
    prompt = (
        strip_merge_tags(brief)
        or strip_merge_tags(str(slot.get("prompt") or ""))
        or _slot_user_prompt(plan, slot)
    )
    out = await generate_compose_image_url(
        user_prompt=prompt,
        plan=plan,
        slot=slot,
        campaign=campaign,
        token=token,
    )
    if not out.get("ok"):
        return out
    mapped = map_hero_fields(
        current,
        str(out.get("url") or ""),
        role=str(out.get("role") or "hero"),
        width_px=int(out.get("width_px") or 600),
        height_px=int(out.get("height_px") or 338),
    )
    from app.mas.phase2_compose.html_images import (
        collect_allowed_image_urls,
        strip_untrusted_content_images,
    )

    mapped["compiled_html"] = strip_untrusted_content_images(
        str(mapped.get("compiled_html") or ""),
        allowed_urls=collect_allowed_image_urls(mapped),
    )
    out["fields"] = mapped
    return out


# Edit paths import this name; create uses hero-only mapping (pre fail-closed compose).
generate_and_map_compose_images = generate_and_map_compose_hero


def _ready_image_from_ctx(ctx: dict[str, Any] | None) -> str:
    data = ctx if isinstance(ctx, dict) else {}
    task = data.get("task_spec") if isinstance(data.get("task_spec"), dict) else {}
    camp = _campaign_from_ctx(data)
    for source in (data, task, camp):
        url = str((source or {}).get("ready_image_url") or "").strip()
        if url.lower().startswith(("http://", "https://")) and "/api/media/" in url.lower():
            return url
    return ""


async def _provider_assets(
    plan: EmailPlan, ctx: dict[str, Any] | None = None
) -> tuple[list[ImageAsset], list[str], bool]:
    """Gemini per needed slot. Raises only for COMPOSE_FORCE_IMAGE_FAIL."""
    if _force_fail():
        raise RuntimeError("image_provider_failed")

    warnings: list[str] = []
    assets: list[ImageAsset] = []
    camp = _campaign_from_ctx(ctx)
    token = _token_from_ctx(ctx)
    used_gemini = False
    ready = _ready_image_from_ctx(ctx)
    for slot in plan.get("image_slots") or []:
        if not slot.get("needed"):
            continue
        role = str(slot.get("role") or "hero").strip() or "hero"
        if ready and role.lower() in {"hero", "banner", "header"}:
            assets.append(
                {
                    "role": role,
                    "url": ready,
                    "width_px": int(slot.get("width_px") or 600),
                    "height_px": int(slot.get("height_px") or 338),
                }
            )
            used_gemini = True
            ready = ""
            continue
        try:
            out = await generate_compose_image_url(
                user_prompt=_slot_user_prompt(plan, slot),
                plan=plan,
                slot=slot,
                campaign=camp,
                token=token,
            )
            url = str(out.get("url") or "").strip()
            if out.get("used_stub"):
                raise RuntimeError("dev_stub_images_disabled")
            if not out.get("ok") or not url:
                raise RuntimeError(str(out.get("error") or "gemini_slot_failed"))
            assets.append(
                {
                    "role": str(slot.get("role") or out.get("role") or "hero"),
                    "url": url,
                    "width_px": int(slot.get("width_px") or 600),
                    "height_px": int(slot.get("height_px") or 338),
                }
            )
            used_gemini = True
        except Exception as exc:  # noqa: BLE001
            err = str(exc)[:240] or "gemini_slot_failed"
            _log.warning("compose Gemini slot failed role=%s: %s", slot.get("role"), err)
            warnings.append(f"Images did not attach: {err}")

    return assets, warnings, used_gemini


async def run(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    plan: EmailPlan = workspace.plan or {}
    if not _slots_needed(plan):
        return envelope(
            executor_id="image",
            status="completed",
            payload={"image_assets": []},
        )

    try:
        assets, warnings, used_gemini = await _provider_assets(plan, ctx)
        missed = any(str(w).lower().startswith("images did not attach") for w in warnings)
        status = "soft_fail" if (missed or (not used_gemini and warnings)) else "completed"
        return envelope(
            executor_id="image",
            status=status,
            payload={"image_assets": assets},
            warnings=warnings,
        )
    except Exception as exc:  # noqa: BLE001
        err = str(exc)[:240] or "image_provider_failed"
        return envelope(
            executor_id="image",
            status="soft_fail",
            payload={"image_assets": []},
            warnings=[f"Images did not attach: {err}"],
        )


async def run_image_executor(ctx: dict[str, Any], plan: EmailPlan) -> dict[str, Any]:
    ws = Workspace()
    ws.plan = dict(plan)
    out = await run(ctx, ws)
    return {
        "ok": True,
        "action_status": "completed",
        "executor_id": "image",
        "image_assets": (out.get("payload") or {}).get("image_assets") or [],
        "warnings": out.get("warnings") or [],
    }
