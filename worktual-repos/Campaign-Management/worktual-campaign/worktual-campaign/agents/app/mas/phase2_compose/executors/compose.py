"""Template compose executor — HTML from plan + resolved image assets."""

from __future__ import annotations

import json
from typing import Any

from app.mas.phase2_compose.llm import (
    TEMPLATE_COMPOSE_SYSTEM,
    achat_completion,
    extract_email_html,
)
from app.mas.phase2_compose.schemas import EmailPlan, ImageAsset, envelope
from app.mas.phase2_compose.skills import Skill
from app.mas.phase2_compose.workspace import Workspace

SKILL: Skill = {
    "id": "compose",
    "does": "Write HTML email from plan and image assets",
    "needs": ["plan"],
    "provides": ["compiled_html"],
    "failure": "hard",
}


def _compose_user_message(workspace: Workspace) -> str:
    plan: EmailPlan = workspace.plan or {}
    image_assets: list[ImageAsset] = list(workspace.image_assets or [])
    kind = str(plan.get("email_kind") or "").strip() or "other"
    parts = [
        f"User request:\n{workspace.query}",
        f"email_kind: {kind}",
        f"Email plan (follow content_brief and email_kind; invent structure for this request only):\n"
        + json.dumps(plan, indent=2),
    ]
    if workspace.chat_summary:
        parts.append(f"Chat context:\n{workspace.chat_summary}")
    if workspace.prior_extract:
        parts.append(
            "Current session template extract:\n"
            + json.dumps(workspace.prior_extract, indent=2)
        )
        if workspace.content_mode == "keep":
            parts.append(
                "content_mode=keep — keep the same copy, subject, and structure; "
                "only apply image URL changes from the image list."
            )
        elif workspace.content_mode == "rewrite":
            parts.append(
                "content_mode=rewrite — write new copy for this turn; "
                "reuse the extract's hero_url if image_mode=keep."
            )
        if workspace.image_mode:
            parts.append(f"image_mode={workspace.image_mode}")
        if workspace.prior_compiled_html and workspace.content_mode != "keep":
            html = workspace.prior_compiled_html
            if len(html) > 8000:
                html = html[:8000]
            parts.append("Prior HTML for structure reference (do not copy stock URLs):\n" + html)
    if workspace.knowledge:
        mode = str((workspace.knowledge or {}).get("copy_mode") or "").strip()
        if mode == "illustrative":
            parts.append(
                "Knowledge facts (illustrative industry copy — never [Feature Name] "
                "or [Your Company Name]; use knowledge.company as the brand):\n"
                + json.dumps(workspace.knowledge, indent=2)
            )
        else:
            parts.append("Knowledge facts:\n" + json.dumps(workspace.knowledge, indent=2))
    from app.mas.phase2_compose.plugin import cta_constraint_for_compose

    parts.append(
        cta_constraint_for_compose(
            knowledge=workspace.knowledge,
            query=workspace.query,
            chat_summary=workspace.chat_summary,
            destination_url=workspace.destination_url,
        )
    )
    if workspace.brand_guidelines:
        parts.append(
            "Brand guidelines (use provided logo/banner/footer/colors only; "
            "do not invent URLs):\n"
            + json.dumps(workspace.brand_guidelines, indent=2)
        )
    if image_assets:
        parts.append(
            "Use only these images (exact url, width, height):\n"
            + json.dumps(image_assets, indent=2)
        )
    else:
        parts.append("No images — do not include any img tags.")
    return "\n\n".join(parts)


async def run(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    if not workspace.plan:
        return envelope(
            executor_id="compose",
            status="failed",
            ok=False,
            error="plan required for compose",
        )

    raw = await achat_completion(system=TEMPLATE_COMPOSE_SYSTEM, user=_compose_user_message(workspace))
    html = extract_email_html(raw)
    retried = False
    if not html:
        retried = True
        raw = await achat_completion(
            system=TEMPLATE_COMPOSE_SYSTEM,
            user=(
                _compose_user_message(workspace)
                + "\n\nYour previous reply was not HTML. "
                "Reply with a complete HTML email only — no analysis, no markdown."
            ),
        )
        html = extract_email_html(raw)
    if not html:
        return envelope(
            executor_id="compose",
            status="failed",
            ok=False,
            error="compose_empty_html",
        )

    from app.mas.phase2_compose.html_images import sanitize_compose_images

    html, cleaned_assets = sanitize_compose_images(
        html,
        workspace.image_assets,
        brand=workspace.brand_guidelines
        if isinstance(workspace.brand_guidelines, dict)
        else {},
    )
    workspace.image_assets = cleaned_assets

    fields: dict[str, Any] = {
        "subject": workspace.plan.get("subject") or "",
        "preheader": workspace.plan.get("preheader") or "",
        "compiled_html": html,
        "plan": dict(workspace.plan),
        "image_assets": list(cleaned_assets),
        "pipeline": "compose",
    }
    return envelope(
        executor_id="compose",
        status="completed",
        payload={"compiled_html": html, "fields": fields},
    )


async def run_template_compose_executor(
    ctx: dict[str, Any],
    *,
    plan: EmailPlan,
    image_assets: list[ImageAsset],
) -> dict[str, Any]:
    ws = Workspace.from_ctx(ctx)
    ws.plan = dict(plan)
    ws.image_assets = list(image_assets)
    out = await run(ctx, ws)
    if not out.get("ok"):
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": "template_compose",
            "error": out.get("error") or "compose_failed",
        }
    payload = out.get("payload") or {}
    return {
        "ok": True,
        "action_status": "completed",
        "executor_id": "template_compose",
        "message": "Generated email template (compose pipeline).",
        "fields": payload.get("fields") or {},
    }
