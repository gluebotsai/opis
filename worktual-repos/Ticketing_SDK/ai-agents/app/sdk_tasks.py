"""Partner named tasks. A button pins one registered Skill and skips Super.

Keep ids aligned with ui-backend/src/server/sdkTasks.ts.
"""

from __future__ import annotations

from typing import Any

from app.contracts.execution import DomainInstruction, RunRequest
from app.memory.session import SharedMemory

SDK_NAMED_TASKS: dict[str, str] = {
    "ticket.summarize": "ticket.investigation.summary",
    "ticket.classify": "ticket.classify.prioritize",
    "ticket.draftReply": "reply.draft",
    "ticket.similar": "ticket.detect.similar",
    "ticket.kb": "knowledge.recommend.resolution",
    "intake.deflect": "intake.self.service.deflection",
    "analytics.ask": "analytics.query",
    "analytics.why": "analytics.root.cause",
    "ticket.list": "ticket.read.search",
    "ticket.create": "ticket.create",
    "ticket.assign": "ticket.assign.best",
    "ticket.resolveSuggest": "ticket.resolve.reopen",
    "ticket.quality": "ticket.resolution.quality",
    "sla.advise": "sla.monitor.escalate",
    "ticket.workload": "routing.optimize.workload",
}


def sdk_context_block(task_id: str) -> str | None:
    """Refuse metric and why questions when their certified backend is unset.

    Ticket lists stay open: SQL falls back to list_tickets.
    """
    from app.config import get_settings

    settings = get_settings()
    if task_id == "analytics.query" and not str(settings.context_layer_url or "").strip():
        return "temporarily_unavailable"
    if task_id == "analytics.root.cause" and not str(settings.ontology_chat_url or "").strip():
        return "temporarily_unavailable"
    return None


def canonical_sdk_task(raw: object) -> str | None:
    key = str(raw or "").strip()
    if not key:
        return None
    if key in SDK_NAMED_TASKS:
        return SDK_NAMED_TASKS[key]
    if key in set(SDK_NAMED_TASKS.values()):
        return key
    return None


def sdk_named_task_instruction(
    memory: SharedMemory,
    request: RunRequest,
) -> DomainInstruction | None:
    """Replace the live task with the button's Skill. Unknown ids do not pin."""
    session = request.session_memory if isinstance(request.session_memory, dict) else {}
    task_id = canonical_sdk_task(session.get("sdkTask"))
    if not task_id:
        return None
    from app.workflow_schemas import new_harness_task_state

    raw_fields = session.get("harnessFields")
    fields: dict[str, Any] = dict(raw_fields) if isinstance(raw_fields, dict) else {}
    state = new_harness_task_state(
        task_id,
        channel=str(request.channel or request.surface or "") or None,
        collected=fields,
        provenance={str(key): "sdk_task" for key in fields},
    )
    memory.set_task_state(state)
    memory.durable["active_domain"] = state.domain
    objective = str(request.message or "").strip() or f"Run named task {state.task_id}"
    return DomainInstruction(
        executor_id=state.executor,
        task_id=state.task_id,
        skill_name=state.skill_name,
        version=state.task_version,
        objective=objective,
        supplied_fields=fields,
    )
