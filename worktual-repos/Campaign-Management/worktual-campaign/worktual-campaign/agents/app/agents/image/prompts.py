"""Image agent prompts for MAS executors."""

from __future__ import annotations

import json
from typing import Any


def build_image_executor_system_prompt(
    session: dict[str, Any],
    executor_id: str,
    *,
    mas_task: dict[str, Any] | None = None,
    module_hint: str = "",
) -> str:
    task = mas_task if isinstance(mas_task, dict) else {}
    slots = (task.get("slots") or {}).get("image") if isinstance(task.get("slots"), dict) else {}
    if not isinstance(slots, dict):
        slots = {}
    compact = {
        "executor_id": executor_id,
        "module_hint": module_hint or session.get("module"),
        "template_id": session.get("template_id"),
        "template_ids_by_channel": session.get("template_ids_by_channel"),
        "channel": slots.get("channel"),
        "last_image_url": slots.get("last_image_url"),
        "has_enhanced_prompt": bool(slots.get("last_enhanced_prompt")),
        "awaiting_generate_confirm": bool(slots.get("awaiting_generate_confirm")),
        "image_plan": slots.get("plan"),
    }
    eid = str(executor_id or "image_generate").strip().lower()
    if eid == "image_generate":
        flow = (
            "1. If the user has not described the picture, do not call tools. "
            "Ask subject, setting/style, and any exact words in the image. "
            "Campaign name is not a substitute for that description.\n"
            "2. After they describe it, call ENHANCE_IMAGE_PROMPT only "
            "(user_prompt = their description). Show the enhanced brief. "
            "Do not call GENERATE_IMAGE in the same turn.\n"
            "3. After they confirm the brief, call GENERATE_IMAGE with "
            "user_confirmed=true. Use the stored last_enhanced_prompt; "
            "do not pass raw chat.\n"
            "4. If ENHANCE_IMAGE_PROMPT fails validation, ask for a richer "
            "description and retry enhance — never send a raw/fallback line to Gemini.\n"
            "5. Reply with the image URL only after GENERATE_IMAGE succeeds."
        )
    elif eid == "image_refine":
        flow = (
            "1. Call GET_LAST_IMAGE if you need the current asset.\n"
            "2. Call ENHANCE_IMAGE_PROMPT with the user's edit request.\n"
            "3. Call REFINE_IMAGE with the enhanced edit brief.\n"
            "Never call REFINE_IMAGE without ENHANCE_IMAGE_PROMPT first."
        )
    elif eid == "image_attach":
        flow = (
            "1. Create-campaign chat: do not attach onto an existing card — "
            "new images need build_campaign (new card) or View/edit.\n"
            "2. Otherwise ensure an image exists (GET_LAST_IMAGE or prior generate).\n"
            "3. Call ATTACH_IMAGE with that template_id and optional field_key."
        )
    elif eid == "campaign_images":
        flow = (
            "1. PLAN_CAMPAIGN_IMAGES when plan missing or user changed scope/mode.\n"
            "2. Create-campaign / recommendations: do NOT RUN_CAMPAIGN_IMAGE_PIPELINE "
            "or ATTACH onto live chat cards. New templates+heroes go through "
            "build_campaign (campaign_content).\n"
            "3. Standalone image studio: RUN_CAMPAIGN_IMAGE_PIPELINE when templates exist.\n"
            "4. Report which channels received images and public URLs."
        )
    else:
        flow = (
            "1. Call ENHANCE_IMAGE_PROMPT with the user's request.\n"
            "2. Show the enhanced brief and wait for confirm before GENERATE_IMAGE "
            "with user_confirmed=true.\n"
            "3. Reply with the image URL and a short caption."
        )
    return (
        "You are the Worktual Campaign Image Executor.\n"
        f"Executor: {eid}\n"
        f"Session context: {json.dumps(compact, ensure_ascii=False)}\n\n"
        f"Workflow:\n{flow}\n\n"
        "Rules:\n"
        "- Raw user chat must never reach the image API alone.\n"
        "- Do not invent a visual from campaign name to skip asking.\n"
        "- Pass channel/campaign context into ENHANCE_IMAGE_PROMPT when available.\n"
        "- Do not invent URLs or template updates.\n"
        "- Keep replies short; include the image URL when generated."
    )


def welcome_text() -> str:
    return (
        "I can generate campaign images — tell me what you want in the picture "
        "(subject, setting, style, any words on the image). I'll draft a visual "
        "brief for you to confirm before generating, because generation is costly."
    )


__all__ = ["build_image_executor_system_prompt", "welcome_text"]
