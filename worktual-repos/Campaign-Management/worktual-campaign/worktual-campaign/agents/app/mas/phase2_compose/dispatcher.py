"""Domain-owned dispatcher: recipe + need_input + failure policy."""

from __future__ import annotations

from typing import Any

from app.mas.phase2_compose.recipes import (
    COMPOSE_STEPS,
    MAX_DISPATCHER_ITERATIONS,
    MAX_HARD_RETRIES,
    MAX_NEED_RETRIES,
)
from app.mas.phase2_compose.registry import run_executor
from app.mas.phase2_compose.skills import find_provider
from app.mas.phase2_compose.workspace import Workspace


def _status(out: dict[str, Any]) -> str:
    return str(out.get("status") or ("completed" if out.get("ok") else "failed"))


async def dispatch_compose(ctx: dict[str, Any]) -> dict[str, Any]:
    ws = Workspace.from_ctx(ctx)
    if not ws.query:
        return {
            "ok": False,
            "action_status": "failed",
            "executor_id": "template_compose",
            "pipeline": "compose",
            "error": "query or enhanced_request is required",
            "fields": ws.to_fields(),
        }

    step_index = 0
    iterations = 0
    hard_retries: dict[str, int] = {}
    need_tries: dict[str, int] = {}

    while step_index < len(COMPOSE_STEPS):
        iterations += 1
        if iterations > MAX_DISPATCHER_ITERATIONS:
            return {
                "ok": False,
                "action_status": "failed",
                "executor_id": "template_compose",
                "pipeline": "compose",
                "error": "max_dispatcher_iterations",
                "warnings": ws.warnings,
                "fields": ws.to_fields(),
            }

        eid = COMPOSE_STEPS[step_index]
        progress = ctx.get("_phase2_progress")
        if callable(progress):
            labels = {
                "knowledge": ("Gathering context…", 38),
                "brand_guidelines": ("Applying brand…", 42),
                "plan": ("Planning email…", 50),
                "compliance_plan": ("Checking plan…", 55),
                "image": ("Generating images…", 60),
                "compose": ("Writing email HTML…", 70),
                "compliance_html": ("Polishing email…", 80),
            }
            label, pct = labels.get(eid, ("Writing channel templates…", 45 + step_index * 8))
            try:
                await progress(label, pct)
            except Exception:  # noqa: BLE001
                pass
        out = await run_executor(eid, ctx, ws)
        ws.add_warnings(out.get("warnings") if isinstance(out.get("warnings"), list) else [])
        status = _status(out)
        ws.record(eid, status, need=out.get("need"), error=out.get("error"))

        if status == "need_input":
            need = str(out.get("need") or "").strip()
            if not need:
                ws.append_warning("need_input_missing_need")
                step_index += 1
                continue
            tries = need_tries.get(need, 0)
            if tries >= MAX_NEED_RETRIES or need in ws.needs_resolved:
                ws.append_warning(f"unresolved_need:{need}")
                step_index += 1
                continue
            provider = find_provider(need)
            if not provider:
                ws.append_warning(f"unresolved_need:{need}")
                step_index += 1
                continue
            need_tries[need] = tries + 1
            pout = await run_executor(provider, ctx, ws)
            ws.add_warnings(
                pout.get("warnings") if isinstance(pout.get("warnings"), list) else []
            )
            ws.merge_payload(pout.get("payload") if isinstance(pout.get("payload"), dict) else {})
            ws.needs_resolved.add(need)
            ws.record(provider, _status(pout), via_need=need)
            continue  # retry same recipe step

        if status == "failed":
            n = hard_retries.get(eid, 0)
            if n < MAX_HARD_RETRIES:
                hard_retries[eid] = n + 1
                ws.append_warning(f"retry:{eid}")
                continue
            return {
                "ok": False,
                "action_status": "failed",
                "executor_id": eid,
                "pipeline": "compose",
                "error": out.get("error") or f"{eid}_failed",
                "warnings": ws.warnings,
                "fields": ws.to_fields(),
            }

        # completed or soft_fail
        ws.merge_payload(out.get("payload") if isinstance(out.get("payload"), dict) else {})
        step_index += 1

    fields = ws.to_fields()
    return {
        "ok": True,
        "action_status": "completed",
        "executor_id": "template_compose",
        "pipeline": "compose",
        "message": "Generated email template (compose pipeline).",
        "fields": fields,
        "plan": ws.plan,
        "image_assets": ws.image_assets,
        "warnings": ws.warnings,
        "trace": ws.trace,
    }
