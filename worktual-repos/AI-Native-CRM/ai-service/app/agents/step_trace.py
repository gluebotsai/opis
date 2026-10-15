"""
Shared curated step-trace helper for LangGraph agent nodes.

Wraps a node with a started -> ok/failed/skipped step event, posted
fire-and-forget to the backend via CrmClient.post_agent_step. A
step-logging failure is swallowed inside the CrmClient call, so this can
never break the agent run it is tracing.

Reused by every LangGraph-based proactive agent (enrichment, scoring,
nurture, lifecycle, auto-reply, summary, assignment, meeting agents, ...) —
do not copy this pattern into a per-agent file; add a new call site here
instead.

Two correlation modes, chosen per agent:
- Job-backed agents (enrichment/scoring/nurture/lifecycle/auto-reply) leave
  `job_id_field` unset — the backend resolves the real job row itself via
  `find<X>JobByOrgContact`, keyed off the URL entity (`id_field`).
- Job-less agents (summary, assignment, meeting_brief/reminder,
  meeting_miss_escalation, meeting_mom, post_meeting_process) generate a
  fresh `job_id` (uuid4) at the top of `run()`, put it in `state[job_id_field]`
  (conventionally `"job_id"`), and pass `job_id_field="job_id"` here — the
  backend then uses that id directly, with no job table to look up.

`agent` may also be a callable of `state` for the rare case where one
LangGraph module serves two dashboard-visible agent ids (meeting_brief_agent
emits either "meeting_brief" or "meeting_reminder" depending on
`state["reminder_window"]`).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from app.crm_client import CrmClient

State = dict[str, Any]
NodeFn = Callable[[State], Awaitable[State]]
DetailFn = Callable[[State, State], "dict[str, Any] | None"]
AgentSpec = "str | Callable[[State], str]"


def _resolve_agent(agent: AgentSpec, state: State) -> str:
    return agent(state) if callable(agent) else agent


async def emit_step(
    state: State,
    *,
    module_path: str,
    agent: AgentSpec,
    step: str,
    label: str,
    status: str,
    id_field: str | None = "contact_id",
    job_id_field: str | None = None,
    detail: dict[str, Any] | None = None,
    error_reason: str | None = None,
) -> None:
    """
    Curated agent-activity trace for the live UI timeline. Never raises.

    Exposed publicly (not just via `traced_step`) so a node can also emit an
    ad-hoc sub-step inline — e.g. an LLM call nested inside a larger node —
    without needing its own graph node.
    """
    entity_id = state.get(id_field) if id_field else None
    if id_field and not entity_id:
        return
    job_id = state.get(job_id_field) if job_id_field else None
    if job_id_field and not job_id:
        return

    client = CrmClient(state.get("organization_id"))
    await client.post_agent_step(
        module_path,
        entity_id,
        agent=_resolve_agent(agent, state),
        step=step,
        label=label,
        status=status,
        detail=detail,
        error_reason=error_reason,
        contact_id=state.get("contact_id"),
        company_id=state.get("company_id"),
        job_id=job_id,
    )


def traced_step(
    module_path: str,
    agent: AgentSpec,
    step: str,
    label: str,
    detail_fn: DetailFn | None = None,
    *,
    id_field: str | None = "contact_id",
    job_id_field: str | None = None,
) -> Callable[[NodeFn], NodeFn]:
    """
    Wrap a LangGraph node with a curated started -> ok/failed/skipped step
    event.

    `module_path` is the internal route segment the CRM mounted for this
    agent (e.g. "enrichment", "scoring", "auto-reply", "assignment"). `id_field`
    is the state key holding the id used in that route's URL (defaults to
    "contact_id"; e.g. "activity_id" for auto-reply/meeting agents, `None`
    when the route has no per-call entity segment — e.g. sales_assignment,
    which may target a company only). `contact_id` is always attached to the
    event when present in state, regardless of `id_field`, so the trace
    stays contact-browsable even for activity-keyed agents.

    "skipped" is reported when this node is the one that decided to stop
    the pipeline (status transitions from not-skipped to skipped);
    everything else that completes without raising is "ok".
    """

    def decorator(fn: NodeFn) -> NodeFn:
        async def wrapped(state: State) -> State:
            await emit_step(
                state,
                module_path=module_path,
                agent=agent,
                id_field=id_field,
                job_id_field=job_id_field,
                step=step,
                label=label,
                status="started",
            )
            try:
                after = await fn(state)
            except Exception as exc:  # noqa: BLE001
                await emit_step(
                    state,
                    module_path=module_path,
                    agent=agent,
                    id_field=id_field,
                    job_id_field=job_id_field,
                    step=step,
                    label=label,
                    status="failed",
                    error_reason=str(exc)[:280],
                )
                raise

            newly_skipped = (
                after.get("status") == "skipped" and state.get("status") != "skipped"
            )
            if newly_skipped:
                await emit_step(
                    state,
                    module_path=module_path,
                    agent=agent,
                    id_field=id_field,
                    job_id_field=job_id_field,
                    step=step,
                    label=label,
                    status="skipped",
                    error_reason=after.get("reason"),
                )
            else:
                await emit_step(
                    state,
                    module_path=module_path,
                    agent=agent,
                    id_field=id_field,
                    job_id_field=job_id_field,
                    step=step,
                    label=label,
                    status="ok",
                    detail=detail_fn(state, after) if detail_fn else None,
                )
            return after

        return wrapped

    return decorator
