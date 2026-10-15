"""Form Fields Executor — Fields specialist with native MAS loop."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.forms_native import (
    is_native_forms,
    run_native_forms_executor,
)
from app.mas.executors.shared.form_specialist import run_form_specialist_executor

_PACKAGE = Path(__file__).resolve().parent


async def run_form_fields_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    task_spec = dict(ctx.get("task_spec") or {})
    entry = str(ctx.get("entry") or "").strip().lower()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()

    if (query or entry in ("interactive", "sticky_domain")) and is_native_forms():
        return await run_native_forms_executor(ctx, "form_fields", agent_md_dir=_PACKAGE)

    from app.agents.forms.specialists import run_fields_specialist

    return await run_form_specialist_executor(
        "form_fields", run_fields_specialist, ctx
    )
