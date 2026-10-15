"""Template Domain — compose pipeline only (8504 package)."""

from __future__ import annotations

from typing import Any

from app.mas.phase2_compose.executors.html_edit import run_html_edit_executor
from app.mas.phase2_compose.pipeline import run_compose_pipeline
from app.mas.phase2_compose.registry import registered_ids


def is_compose_html_fields(fields: dict[str, Any] | None) -> bool:
    """True when the email is Phase 2 compiled HTML — not section/block canvas."""
    from app.mas.phase2_compose.llm import looks_like_html

    data = fields if isinstance(fields, dict) else {}
    html = str(data.get("compiled_html") or data.get("html") or "").strip()
    return looks_like_html(html)


class TemplateDomain:
    """Domain agent — routes compose / html_edit only."""

    async def invoke(self, ctx: dict[str, Any]) -> dict[str, Any]:
        task = dict(ctx.get("task_spec") or {})
        executor_id = str(
            task.get("executor_id") or ctx.get("executor_id") or ""
        ).strip().lower()

        fields = task.get("fields") or ctx.get("fields")
        has_template = isinstance(fields, dict) and bool(fields)

        if not executor_id:
            if has_template and isinstance(fields, dict) and is_compose_html_fields(fields):
                executor_id = "html_edit"
            else:
                executor_id = "template_compose"

        if executor_id in ("template_compose", "compose_generate", "compose"):
            return await run_compose_pipeline(ctx)

        if executor_id in ("html_edit",):
            return await run_html_edit_executor(ctx)

        return {
            "ok": False,
            "action_status": "failed",
            "error": f"Unknown executor_id: {executor_id}",
            "allowed": ["template_compose", "html_edit", *registered_ids()],
        }
