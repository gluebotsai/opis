"""Hub-only CRM spoke supervisor — plan and chain agents from the Hub instruction.

Normal CRM flows (coworker UI, Inbox, HTTP ``/ai/v1/agents/*/run``) are unchanged.
This module is only entered from A2A ``dispatch_skill``.

Policy:
1. Read Hub instruction/goal — it is authoritative over optional ``skillId`` hint.
2. Plan which agent(s) to run (LLM when configured; deterministic send-email shortcut).
3. Execute the plan, then reactively chain more agents only if the goal is still open.
4. Offline LLM: deterministic send shortcut, else fall back to ``skillId`` hint agent.
"""

from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable, Mapping

from app.a2a.catalog import EXCLUDE_NAMED_AGENTS, NAMED_BLURBS, SpokeSkill, get_spoke_skill, list_spoke_skills
from app.a2a.log import hub_instruction, log_a2a
from app.a2a.payload import lookup
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.llm import is_ai_configured

InvokeNamed = Callable[[str, Mapping[str, Any]], Awaitable[dict[str, Any]]]
InvokeCoworker = Callable[[SpokeSkill, Mapping[str, Any]], Awaitable[dict[str, Any]]]

MAX_FOLLOW_UPS = 2
MAX_PLAN_AGENTS = 3
_RESULT_CLIP = 1800

_SEND_ACTION = re.compile(
    r"\b(send_email|send\s+(an?\s+)?email|after\s+dispatch|log\s+the\s+email\s+activity)\b",
    re.I,
)
_DRAFT_ONLY = re.compile(r"\bdraft\b", re.I)

# Internal executors Hub never sees on the card, but the supervisor may call.
_INTERNAL_AGENTS: dict[str, str] = {
    "send-outbound-email": (
        "Send a pre-composed subject/body via the org CRM bot and log activity. "
        "Requires contact_id, subject, body."
    ),
}


def _goal_text(payload: Mapping[str, Any]) -> str:
    return " ".join(
        str(part or "").strip()
        for part in (
            payload.get("instruction"),
            payload.get("description"),
            payload.get("text"),
            payload.get("query"),
        )
        if part not in (None, "")
    ).strip()


def hub_wants_send_email(payload: Mapping[str, Any]) -> bool:
    """True when Hub asked to deliver mail, not merely draft."""
    action = str(
        payload.get("actionType")
        or payload.get("action_type")
        or lookup(payload, "action_type")
        or ""
    ).strip().lower()
    if action in {"send_email", "send-email", "send"}:
        return True
    channel = str(payload.get("channel") or "").strip().lower()
    if channel == "email" and action.startswith("send"):
        return True
    text = _goal_text(payload)
    if not text:
        return False
    if _DRAFT_ONLY.search(text) and not _SEND_ACTION.search(text):
        return False
    return bool(_SEND_ACTION.search(text))


def hub_wants_send_after_compose(payload: Mapping[str, Any], skill: SpokeSkill) -> bool:
    """Backward-compatible wrapper — send intent is instruction-driven, not skill-bound."""
    del skill
    return hub_wants_send_email(payload)


def _clip_result(result: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {"value": str(result)[:400]}
    raw = json.dumps(result, default=str)
    if len(raw) <= _RESULT_CLIP:
        return dict(result)
    keep = {
        k: result.get(k)
        for k in (
            "ok",
            "status",
            "source",
            "reason",
            "error",
            "subject",
            "body",
            "band",
            "total",
            "decision",
            "assistantText",
            "to",
            "activityId",
            "sent",
        )
        if k in result
    }
    keep["_clipped"] = True
    body = keep.get("body")
    if isinstance(body, str) and len(body) > 400:
        keep["body"] = body[:400] + "…"
    speech = keep.get("assistantText")
    if isinstance(speech, str) and len(speech) > 400:
        keep["assistantText"] = speech
    return keep


def _agent_catalog() -> dict[str, str]:
    """Planner + follow-up catalog: agent/skill id → description."""
    out: dict[str, str] = dict(_INTERNAL_AGENTS)
    for skill in list_spoke_skills():
        if skill.agent_name in EXCLUDE_NAMED_AGENTS:
            continue
        if skill.agent_name == "crm-agent":
            out[skill.id] = skill.description
            continue
        blurb = NAMED_BLURBS.get(skill.agent_name)
        desc = blurb[1] if blurb else skill.description
        out[skill.agent_name] = desc
    return out


def _planner_system(catalog: Mapping[str, str]) -> str:
    lines = "\n".join(f"- {name}: {desc}" for name, desc in sorted(catalog.items()))
    return sectioned_system_prompt(
        role=(
            "You are the CRM A2A spoke supervisor. Hub sent a goal/instruction "
            "for CRM to execute."
        ),
        goal=(
            "Choose the minimal ordered list of CRM agents or coworker skill ids "
            "needed to satisfy the Hub instruction."
        ),
        instructions=(
            "1. The Hub instruction/goal is authoritative — ignore a mismatched skillId hint.\n"
            "2. Pick ids exactly as listed below (agent names or coworker skill ids).\n"
            "3. Order matters: compose-email before send-outbound-email when sending mail.\n"
            "4. Use one agent when enough; chain only when the goal clearly needs multiple steps.\n"
            "5. send-outbound-email always follows compose-email in the same plan.\n"
            "6. Never pick crm-agent; use coworker skill ids (activities, deals, …).\n"
            "7. Max three agents in the initial plan."
        ),
        context=f"Available agents and skills:\n{lines}",
        output=(
            'Return ONLY JSON: {"agents": ["<id>", ...], "reason": "..."}'
        ),
        guardrails="No markdown. Prefer fewer agents. If unsure, pick the single best fit.",
    )


def _supervisor_system(catalog: Mapping[str, str]) -> str:
    lines = "\n".join(f"- {name}: {desc}" for name, desc in sorted(catalog.items()))
    return sectioned_system_prompt(
        role=(
            "You are the CRM A2A spoke supervisor. CRM already ran one or more agents. "
            "You decide whether another named agent is required to finish the Hub goal."
        ),
        goal=(
            "Finish the Hub goal with the fewest agents. Prefer done=true when the "
            "latest result already satisfies the instruction."
        ),
        instructions=(
            "1. Read the Hub goal and the latest agent result.\n"
            "2. If the goal is satisfied, return done=true.\n"
            "3. Only request nextAgent when the goal clearly still needs another CRM step "
            "(e.g. draft email exists and Hub asked to send; score done and Hub asked to nurture).\n"
            "4. nextAgent must be one of the available agents listed below.\n"
            "5. Pass only args the next agent needs (contact_id, subject, body, deal_id, …).\n"
            "6. Never invent SQL, never ask Hub a clarifying question, never pick crm-agent.\n"
            "7. Do not re-run the same agent that just ran."
        ),
        context=f"Available next agents:\n{lines}",
        output=(
            'Return ONLY JSON, one of:\n'
            '{"done": true, "reason": "..."}\n'
            'or\n'
            '{"done": false, "nextAgent": "<id>", "reason": "...", "args": {}}'
        ),
        guardrails=(
            "No markdown. No chain longer than needed. If unsure, done=true."
        ),
    )


def _skill_for_step(step: str) -> SpokeSkill | None:
    return get_spoke_skill(step)


def _fallback_plan(skill_hint: SpokeSkill | None) -> list[str]:
    if skill_hint is None:
        return []
    if skill_hint.agent_name == "crm-agent":
        return [skill_hint.id]
    return [skill_hint.agent_name]


async def plan_hub_agents(
    *,
    goal: str,
    payload: Mapping[str, Any],
    skill_hint: SpokeSkill | None,
) -> list[str]:
    """Plan initial agent chain from Hub instruction. Deterministic shortcuts first."""
    if hub_wants_send_email(payload):
        return ["compose-email", "send-outbound-email"]

    if not is_ai_configured():
        return _fallback_plan(skill_hint)

    catalog = _agent_catalog()
    hint_id = skill_hint.id if skill_hint else ""
    user = (
        f"Hub goal:\n{goal or '(none)'}\n\n"
        f"Optional skillId hint (may be wrong — prefer the goal): {hint_id or '(none)'}\n\n"
        f"Payload context (ids only):\n"
        f"- contact/cdpId: {lookup(payload, 'contact_id') or payload.get('cdpId')}\n"
        f"- dealId: {lookup(payload, 'deal_id')}\n"
        f"- activityId: {lookup(payload, 'activity_id')}\n"
        f"- actionType: {payload.get('actionType') or payload.get('action_type')}"
    )

    def _validate(parsed: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(parsed, dict):
            return None
        raw = parsed.get("agents") or parsed.get("plan") or []
        if not isinstance(raw, list):
            return None
        agents: list[str] = []
        for item in raw[:MAX_PLAN_AGENTS]:
            step = str(item or "").strip()
            if step and step in catalog and step not in agents:
                agents.append(step)
        if not agents:
            return None
        return {
            "agents": agents,
            "reason": str(parsed.get("reason") or "planned")[:300],
        }

    planned, fail = await generate_json_with_retries(
        system=_planner_system(catalog),
        user=user,
        max_tokens=400,
        timeout_ms=45_000,
        attempts=2,
        validate=_validate,
    )
    if planned and isinstance(planned.get("agents"), list):
        return list(planned["agents"])
    log_a2a(
        step="supervise_plan_fallback",
        hub=hub_instruction(payload),
        crm={"reason": fail or "plan_failed", "hint": hint_id},
    )
    return _fallback_plan(skill_hint)


async def decide_next_agent(
    *,
    goal: str,
    primary_skill_id: str,
    primary_agent: str,
    primary_result: Mapping[str, Any],
    already_ran: list[str],
) -> dict[str, Any]:
    """LLM: done or next named agent. Offline → done."""
    if not is_ai_configured():
        return {"done": True, "reason": "llm_not_configured"}
    catalog = {
        name: desc
        for name, desc in _agent_catalog().items()
        if name not in already_ran
    }
    if not catalog:
        return {"done": True, "reason": "no_follow_up_agents"}

    user = (
        f"Hub goal:\n{goal or '(none — treat latest result as complete)'}\n\n"
        f"Initial skillId hint: {primary_skill_id or '(none)'}\n"
        f"Latest agent: {primary_agent}\n"
        f"Already ran: {already_ran}\n\n"
        f"Latest result (JSON):\n{json.dumps(_clip_result(dict(primary_result)), default=str)}"
    )

    def _validate(parsed: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(parsed, dict):
            return None
        if parsed.get("done") is True:
            return {
                "done": True,
                "reason": str(parsed.get("reason") or "goal_satisfied")[:300],
            }
        next_agent = str(parsed.get("nextAgent") or parsed.get("next_agent") or "").strip()
        if not next_agent or next_agent not in catalog:
            return {
                "done": True,
                "reason": f"invalid_or_blocked_next_agent:{next_agent or 'empty'}",
            }
        args = parsed.get("args") if isinstance(parsed.get("args"), dict) else {}
        return {
            "done": False,
            "nextAgent": next_agent,
            "reason": str(parsed.get("reason") or "follow_up")[:300],
            "args": args,
        }

    decided, fail = await generate_json_with_retries(
        system=_supervisor_system(catalog),
        user=user,
        max_tokens=400,
        timeout_ms=45_000,
        attempts=2,
        validate=_validate,
    )
    if decided:
        return decided
    return {"done": True, "reason": fail or "llm_decide_failed"}


async def complete_hub_compose_and_send(
    payload: Mapping[str, Any],
    *,
    invoke_named: InvokeNamed,
) -> dict[str, Any]:
    """Deterministic compose-email → send-outbound-email."""
    log_a2a(
        step="supervise",
        hub=hub_instruction(payload),
        crm={
            "plan": ["compose-email", "send-outbound-email"],
            "reason": "hub_send_email",
        },
        message="Hub send_email — compose then send",
    )

    composed = await invoke_named("compose-email", payload)
    if not isinstance(composed, dict):
        composed = {"result": composed}
    subject = str(composed.get("subject") or "").strip()
    body = str(composed.get("body") or "").strip()
    if not composed.get("ok") or not subject or not body:
        log_a2a(
            step="supervise_stop",
            hub=hub_instruction(payload),
            crm={"agent": "compose-email", "ok": False, "result": composed},
            message="Compose failed — not sending",
        )
        return {
            **composed,
            "ok": False,
            "sent": False,
            "orchestrated": True,
            "steps": ["compose-email"],
            "error": composed.get("reason") or composed.get("error") or "compose_failed",
        }

    contact_id = str(
        lookup(payload, "contact_id")
        or payload.get("cdpId")
        or payload.get("cdp_id")
        or ""
    ).strip()
    org_id = str(
        lookup(payload, "organization_id")
        or payload.get("organizationId")
        or ""
    ).strip() or None

    send_payload = {
        **dict(payload),
        "contact_id": contact_id,
        "contactId": contact_id,
        "organization_id": org_id,
        "organizationId": org_id,
        "subject": subject,
        "body": body,
        "reason": "hub_a2a_send_email",
    }
    sent = await invoke_named("send-outbound-email", send_payload)
    if not isinstance(sent, dict):
        sent = {"result": sent}

    ok = bool(sent.get("ok")) and str(sent.get("status") or "").lower() == "sent"
    log_a2a(
        step="supervise_done",
        hub=hub_instruction(payload),
        crm={
            "compose": {
                "ok": True,
                "source": composed.get("source"),
                "subject": subject[:120],
            },
            "send": {
                "ok": ok,
                "status": sent.get("status"),
                "to": sent.get("to"),
                "error": sent.get("error"),
                "activityId": sent.get("activityId"),
            },
        },
        message="Hub compose→send finished" if ok else "Hub compose ok; send failed",
    )
    return {
        "ok": ok,
        "orchestrated": True,
        "steps": ["compose-email", "send-outbound-email"],
        "subject": subject,
        "body": body,
        "compose": composed,
        "send": sent,
        "sent": ok,
        "to": sent.get("to"),
        "activityId": sent.get("activityId"),
        "source": composed.get("source"),
        "error": None if ok else (sent.get("error") or "send_failed"),
    }


def _merge_follow_up_payload(
    payload: Mapping[str, Any],
    prior: Mapping[str, Any],
    args: Mapping[str, Any],
) -> dict[str, Any]:
    merged = dict(payload)
    for key in ("subject", "body", "contact_id", "contactId", "deal_id", "dealId"):
        if prior.get(key) not in (None, "") and merged.get(key) in (None, ""):
            merged[key] = prior.get(key)
    for key, value in args.items():
        if value not in (None, ""):
            merged[key] = value
    contact = (
        lookup(merged, "contact_id")
        or merged.get("cdpId")
        or prior.get("contact_id")
        or ""
    )
    contact_s = str(contact).strip()
    if contact_s:
        merged["contact_id"] = contact_s
        merged["contactId"] = contact_s
        merged.setdefault("cdpId", contact_s)
    return merged


def _validate_step_fields(skill: SpokeSkill, payload: Mapping[str, Any]) -> None:
    from app.a2a.errors import InputRequiredError

    if not skill.required_fields:
        return
    missing = [
        field
        for field in skill.required_fields
        if lookup(payload, field) in (None, "")
    ]
    if missing:
        raise InputRequiredError(missing)


async def _invoke_plan_step(
    step: str,
    payload: Mapping[str, Any],
    *,
    invoke_named: InvokeNamed,
    invoke_coworker: InvokeCoworker,
) -> dict[str, Any]:
    skill = _skill_for_step(step)
    if skill is None:
        return await invoke_named(step, payload)
    _validate_step_fields(skill, payload)
    if skill.agent_name == "crm-agent":
        return await invoke_coworker(skill, payload)
    return await invoke_named(skill.agent_name, payload)


def _should_skip_send(step: str, follow_payload: Mapping[str, Any]) -> str | None:
    if step != "send-outbound-email":
        return None
    if not str(follow_payload.get("subject") or "").strip() or not str(
        follow_payload.get("body") or ""
    ).strip():
        return "missing_subject_or_body"
    if not str(lookup(follow_payload, "contact_id") or "").strip():
        return "missing_contact"
    return None


def _orchestrated_result(
    *,
    steps: list[str],
    results: list[dict[str, Any]],
    current: Mapping[str, Any],
) -> dict[str, Any]:
    ok = bool(current.get("ok", True))
    if "status" in current and str(current.get("status") or "").lower() in {
        "failed",
        "error",
    }:
        ok = False
    primary = results[0]["result"] if results else current
    return {
        "ok": ok,
        "orchestrated": True,
        "steps": steps,
        "primary": primary,
        "followUps": results[1:] if len(results) > 1 else [],
        "final": dict(current),
        **{
            k: current[k]
            for k in (
                "subject",
                "body",
                "to",
                "sent",
                "activityId",
                "source",
                "band",
                "assistantText",
            )
            if k in current
        },
        "error": current.get("error") or current.get("reason"),
    }


async def execute_hub_plan(
    *,
    plan: list[str],
    payload: Mapping[str, Any],
    skill_hint: SpokeSkill | None,
    invoke_named: InvokeNamed,
    invoke_coworker: InvokeCoworker,
) -> dict[str, Any]:
    """Run a planned agent chain with reactive follow-ups when needed."""
    goal = _goal_text(payload)
    if not plan:
        from app.a2a.errors import InputRequiredError

        raise InputRequiredError(
            ["skillId"],
            "Could not plan agents from the Hub instruction — send skillId or configure the LLM.",
        )

    log_a2a(
        step="supervise_plan",
        hub=hub_instruction(payload),
        crm={"plan": plan, "hint": skill_hint.id if skill_hint else None},
        message="Hub supervisor plan",
    )

    steps: list[str] = []
    results: list[dict[str, Any]] = []
    current: dict[str, Any] = {}

    async def _run_step(step: str, step_payload: Mapping[str, Any]) -> dict[str, Any]:
        skip = _should_skip_send(step, step_payload)
        if skip:
            log_a2a(
                step="supervise_skip",
                hub=hub_instruction(payload),
                crm={"nextAgent": step, "reason": skip},
            )
            return {"ok": False, "reason": skip}
        log_a2a(
            step="supervise_run",
            hub=hub_instruction(payload),
            crm={"agent": step},
        )
        try:
            out = await _invoke_plan_step(
                step,
                step_payload,
                invoke_named=invoke_named,
                invoke_coworker=invoke_coworker,
            )
        except Exception as exc:  # noqa: BLE001
            log_a2a(
                step="supervise_run_error",
                ok=False,
                hub=hub_instruction(payload),
                crm={"agent": step, "error": str(exc)[:300]},
            )
            return {"ok": False, "error": str(exc)[:300]}
        if not isinstance(out, dict):
            out = {"result": out}
        return out

    for step in plan:
        if step in steps:
            continue
        step_payload = _merge_follow_up_payload(payload, current, {})
        current = await _run_step(step, step_payload)
        steps.append(step)
        results.append({"agent": step, "result": current})
        if current.get("ok") is False and step == "compose-email":
            break

    hint_id = skill_hint.id if skill_hint else ""
    hint_agent = skill_hint.agent_name if skill_hint else ""

    for _ in range(MAX_FOLLOW_UPS):
        decision = await decide_next_agent(
            goal=goal or f"Complete Hub task",
            primary_skill_id=hint_id,
            primary_agent=steps[-1] if steps else hint_agent,
            primary_result=current,
            already_ran=list(steps),
        )
        log_a2a(
            step="supervise_decide",
            hub=hub_instruction(payload),
            crm={"decision": decision, "ran": list(steps)},
        )
        if decision.get("done") is not False:
            break
        next_agent = str(decision.get("nextAgent") or "").strip()
        if not next_agent or next_agent in steps or next_agent not in _agent_catalog():
            break
        args = decision.get("args") if isinstance(decision.get("args"), dict) else {}
        follow_payload = _merge_follow_up_payload(payload, current, args)
        current = await _run_step(next_agent, follow_payload)
        steps.append(next_agent)
        results.append({"agent": next_agent, "result": current})

    if len(steps) == 1 and len(plan) == 1:
        return current

    log_a2a(
        step="supervise_done",
        hub=hub_instruction(payload),
        crm={"steps": steps, "ok": current.get("ok", True)},
        message="Hub supervisor finished multi-agent chain",
    )
    return _orchestrated_result(steps=steps, results=results, current=current)


def _agent_receipt_label(step: str) -> str:
    spoke = _skill_for_step(step)
    if spoke and spoke.agent_name == "crm-agent":
        return "crm-agent"
    if spoke:
        return spoke.agent_name
    return step


async def run_hub_supervised_task(
    *,
    skill: SpokeSkill | None,
    payload: Mapping[str, Any],
    invoke_named: InvokeNamed,
    invoke_coworker: InvokeCoworker,
) -> tuple[dict[str, Any], str]:
    """
    Plan from Hub instruction, execute agents, optionally chain follow-ups.

    Returns (result, agent_name_for_receipt).
    """
    if hub_wants_send_email(payload):
        contact = lookup(payload, "contact_id")
        if contact in (None, ""):
            from app.a2a.errors import InputRequiredError

            raise InputRequiredError(["contactId"])
        result = await complete_hub_compose_and_send(
            payload, invoke_named=invoke_named
        )
        return result, "crm-spoke-supervisor"

    goal = _goal_text(payload)
    plan = await plan_hub_agents(goal=goal, payload=payload, skill_hint=skill)

    supervised = await execute_hub_plan(
        plan=plan,
        payload=payload,
        skill_hint=skill,
        invoke_named=invoke_named,
        invoke_coworker=invoke_coworker,
    )
    if isinstance(supervised, dict) and supervised.get("orchestrated"):
        return supervised, "crm-spoke-supervisor"
    agent_label = _agent_receipt_label(plan[0]) if plan else (
        _agent_receipt_label(skill.id) if skill else "crm-spoke-supervisor"
    )
    return supervised, agent_label
