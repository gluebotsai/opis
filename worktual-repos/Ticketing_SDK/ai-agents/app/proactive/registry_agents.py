"""Named proactive agent modules (not chat specialists)."""

from __future__ import annotations

from typing import Any, Callable

from app.proactive import (
    ara,
    crda,
    dssa,
    icpa,
    itra,
    pna,
    rcaa,
    rkaa,
    rqa,
    sema,
    stda,
    tcaa,
    tiaa,
    tsaa,
    wloa,
)
from app.proactive.contract import AgentSpec, Proposal

_MODULES = (
    tcaa,
    icpa,
    itra,
    dssa,
    tsaa,
    sema,
    rkaa,
    crda,
    ara,
    wloa,
    tiaa,
    stda,
    pna,
    rcaa,
    rqa,
)

AGENTS: dict[str, Any] = {m.SPEC.agent_id: m for m in _MODULES}

PROACTIVE_HARNESS_BINDINGS: dict[str, dict[str, str]] = {
    "tcaa": {
        "domain": "intake_deflection_domain",
        "executor": "ticket_creation_executor",
        "task_id": "ticket.create",
        "skill_name": "ticket-create",
    },
    "dssa": {
        "domain": "intake_deflection_domain",
        "executor": "ai_resolution_executor",
        "task_id": "intake.self.service.deflection",
        "skill_name": "intake-self-service-deflection",
    },
    "icpa": {
        "domain": "triage_routing_domain",
        "executor": "classification_priority_executor",
        "task_id": "ticket.classify.prioritize",
        "skill_name": "ticket-classify-prioritize",
    },
    "itra": {
        "domain": "triage_routing_domain",
        "executor": "intelligent_assignment_executor",
        "task_id": "ticket.assign.best",
        "skill_name": "ticket-assign-best",
    },
    "wloa": {
        "domain": "triage_routing_domain",
        "executor": "workload_optimization_executor",
        "task_id": "routing.optimize.workload",
        "skill_name": "routing-optimize-workload",
    },
    "rcaa": {
        "domain": "triage_routing_domain",
        "executor": "root_cause_learning_executor",
        "task_id": "routing.learn.from.outcomes",
        "skill_name": "routing-learn-from-outcomes",
    },
    "tsaa": {
        "domain": "resolution_lifecycle_domain",
        "executor": "investigation_summary_executor",
        "task_id": "ticket.investigation.summary",
        "skill_name": "ticket-investigation-summary",
    },
    "sema": {
        "domain": "resolution_lifecycle_domain",
        "executor": "sla_escalation_executor",
        "task_id": "sla.monitor.escalate",
        "skill_name": "sla-monitor-escalate",
    },
    "crda": {
        "domain": "resolution_lifecycle_domain",
        "executor": "customer_reply_drafting_executor",
        "task_id": "reply.draft",
        "skill_name": "reply-draft",
    },
    "ara": {
        "domain": "resolution_lifecycle_domain",
        "executor": "autonomous_resolution_executor",
        "task_id": "ticket.autonomous.resolution",
        "skill_name": "ticket-autonomous-resolution",
    },
    "rqa": {
        "domain": "resolution_lifecycle_domain",
        "executor": "resolution_quality_executor",
        "task_id": "ticket.resolution.quality",
        "skill_name": "ticket-resolution-quality",
    },
    "pna": {
        "domain": "resolution_lifecycle_domain",
        "executor": "personalized_notification_executor",
        "task_id": "notification.personalize.deliver",
        "skill_name": "notification-personalize-deliver",
    },
    "tiaa": {
        "domain": "resolution_lifecycle_domain",
        "executor": "insights_analytics_executor",
        "task_id": "analytics.generate.insights",
        "skill_name": "analytics-generate-insights",
    },
    "rkaa": {
        "domain": "knowledge_domain",
        "executor": "resolution_knowledge_executor",
        "task_id": "knowledge.recommend.resolution",
        "skill_name": "knowledge-recommend-resolution",
    },
    "stda": {
        "domain": "knowledge_domain",
        "executor": "similar_ticket_detection_executor",
        "task_id": "ticket.detect.similar",
        "skill_name": "ticket-detect-similar",
    },
}


def harness_binding_for(agent_id: str) -> dict[str, str] | None:
    binding = PROACTIVE_HARNESS_BINDINGS.get((agent_id or "").strip().lower())
    return dict(binding) if binding else None


def validate_proactive_harness_bindings() -> None:
    from app.skills.catalog import tools_for_skill
    from app.workflow_schemas import task_definition_for

    if set(PROACTIVE_HARNESS_BINDINGS) != set(AGENTS):
        raise ValueError("every proactive agent must have one Harness binding")
    for agent_id, binding in PROACTIVE_HARNESS_BINDINGS.items():
        task = task_definition_for(binding["task_id"])
        if (
            not task
            or task.domain != binding["domain"]
            or task.executor != binding["executor"]
            or task.skill_name != binding["skill_name"]
        ):
            raise ValueError(f"invalid proactive Harness binding: {agent_id}")
        spec = spec_for(agent_id)
        if spec and not set(spec.tools_used) <= set(
            tools_for_skill(task.skill_name, task.executor)
        ):
            raise ValueError(f"proactive tools exceed Skill scope: {agent_id}")


def spec_for(agent_id: str) -> AgentSpec | None:
    mod = AGENTS.get((agent_id or "").strip().lower())
    return getattr(mod, "SPEC", None) if mod else None


def agents_for_event(event_type: str) -> list[tuple[str, Callable[[dict[str, Any]], Proposal | None]]]:
    et = (event_type or "").strip()
    out: list[tuple[str, Callable[[dict[str, Any]], Proposal | None]]] = []
    for mod in _MODULES:
        if et in mod.SPEC.trigger:
            out.append((mod.SPEC.agent_id, mod.propose))
    return out
