"""Domain-led reports turn: plan → SQL/KG executors → brief (reports-analytics-agent internals)."""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any

from app.agents.llm_result import extract_json
from app.agents.reports_analytics_adapter import peel_card_choice
from app.agents.reports_analytics_agent import AnalyticsScope
from app.agents.reports_b2b.core.facts import assemble_facts
from app.agents.reports_b2b.core.grounding import ground_check
from app.agents.reports_b2b.core.prompt_load import PACK_ROOT, load_agent_prompt
from app.agents.reports_b2b.core.run_kpi import run_kpi
from app.agents.reports_b2b.core.run_sql import run_sql
from app.agents.reports_b2b.identity import normalize_role, parse_org_id, parse_user_id
from app.agents.reports_b2b.core.scope import normalize_task_scope
from app.agents.reports_b2b.kg_executor.core.models import AgentContext as KgContext
from app.agents.reports_b2b.kg_executor.core.models import SynthesisOutput
from app.agents.reports_b2b.kg_executor.core.orchestrator import CRMB2BKGAgent
from app.llm import generate_ai_text, is_ai_configured

_DOMAIN_MD = PACK_ROOT / "domain" / "agent.md"
_SQL_MD = PACK_ROOT / "sql_executor" / "agent.md"
_LOG_AGENT = "reports-analytics-agent"
_REPORT_OBJECTS = frozenset(
    {
        "contacts",
        "companies",
        "deals",
        "quotes",
        "invoices",
        "activities",
        "contracts",
        "products",
    }
)


def _sql_tool_summary(result: dict[str, Any]) -> dict[str, Any]:
    rows = result.get("rows") if isinstance(result.get("rows"), list) else []
    return {
        "status": result.get("status"),
        "kpi_id": result.get("kpi_id"),
        "rowCount": len(rows),
        "error": result.get("error") or result.get("error_type"),
        "time_echo": result.get("time_echo"),
    }


def _kg_tool_summary(result: SynthesisOutput | None) -> dict[str, Any]:
    if result is None:
        return {"status": "error", "rowCount": 0}
    rows = _kg_rows_from_output(result)
    return {
        "status": result.status,
        "rowCount": len(rows),
        "factCount": len(result.facts),
        "attempts": result.attempts_made,
        "error": result.error,
    }


def _reports_context_from_memory(working: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(working, dict):
        return {}
    slots = working.get("slots")
    if isinstance(slots, dict) and isinstance(slots.get("reportsContext"), dict):
        return dict(slots["reportsContext"])
    if isinstance(working.get("reportsContext"), dict):
        return dict(working["reportsContext"])
    return {}


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _canonical_object(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in _REPORT_OBJECTS else ""


def _format_chat(messages: list[dict[str, Any]], *, turns: int = 4) -> str:
    """Last few turns in full. A turn starts at a user line and includes the reply after it."""
    kept: list[tuple[str, str]] = []
    for item in messages:
        role = str(item.get("role") or "")
        text = str(item.get("content") or item.get("text") or "").strip()
        if role in {"user", "assistant"} and text:
            kept.append((role, text))
    groups: list[list[tuple[str, str]]] = []
    current: list[tuple[str, str]] = []
    for role, text in kept:
        if role == "user" and current:
            groups.append(current)
            current = []
        current.append((role, text))
    if current:
        groups.append(current)
    lines: list[str] = []
    for group in groups[-turns:]:
        for role, text in group:
            lines.append(f"{role}: {text}")
    return "\n".join(lines)


def _identity_block(scope: AnalyticsScope, org_id: int, user_id: int) -> str:
    role = normalize_role(scope.role)
    return (
        f"Identity: role={role}, org_id={org_id}, user_id={user_id}, "
        f"business_type={scope.business_type}\n"
    )


def _follow_up_block(prior: dict[str, Any]) -> str:
    if not prior:
        return ""
    parts = []
    for key in ("objectLock", "timePhrase", "lastKpiId", "lastAnswerType", "lastSummary"):
        val = prior.get(key)
        if val:
            parts.append(f"{key}={val}")
    if not parts:
        return ""
    return "Follow-up context: " + ", ".join(parts) + "\n"


async def _llm_text(
    *,
    system: str,
    user: str,
    max_tokens: int = 1200,
    phase: str = "llm",
) -> str:
    del phase  # LLM turn log + agent-turn LIVE lines come from ``app.llm``.
    if not is_ai_configured():
        raise RuntimeError("LLM is not configured")
    text = await generate_ai_text(
        system=system,
        user=user,
        max_tokens=max_tokens,
        enable_thinking=False,
    )
    if not text:
        raise RuntimeError("LLM returned empty content")
    return text.strip()


def _obs_tool(name: str, arguments: Any, result: Any) -> None:
    from app.agent_log import trace_tool_call, trace_tool_response
    from app.observability.turn_log import record_tool, turn_active

    if turn_active():
        record_tool(name, arguments, result, agent=_LOG_AGENT)
        return
    trace_tool_call(agent=_LOG_AGENT, tool=name, args=arguments)
    trace_tool_response(
        agent=_LOG_AGENT,
        tool=name,
        ok=not (isinstance(result, dict) and result.get("status") == "error"),
        response=result,
    )


def _looks_like_plan_json(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return False
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.I)
        stripped = re.sub(r"\s*```$", "", stripped)
    parsed = extract_json(stripped)
    return isinstance(parsed, dict) and parsed.get("kind") == "plan"


def _sanitize_brief(answer: str) -> str:
    if _looks_like_plan_json(answer):
        return ""
    return (answer or "").strip()


def _no_data_brief(question: str) -> str:
    del question
    return "I don't have a figure for that yet."


def _sql_needs_fallback(result: dict[str, Any]) -> bool:
    """A missing or failed metric should try free SQL, then the graph."""
    if result.get("status") == "ok":
        return False
    if str(result.get("error_type") or "") in {"ACCESS_DENIED", "CLARIFY"}:
        return False
    return True


def _parse_plan(raw: str) -> dict[str, Any]:
    parsed = extract_json(raw) or {}
    if not isinstance(parsed, dict):
        return {}
    if parsed.get("kind") != "plan":
        parsed["kind"] = "plan"
    tasks = parsed.get("tasks")
    if not isinstance(tasks, list):
        parsed["tasks"] = []
    return parsed


def _clean_llm_sql(sql: str) -> str:
    """Strip markdown fences and prose so sql_guard can parse the statement."""
    text = (sql or "").strip()
    text = re.sub(r"^```(?:sql|postgresql|postgres)?\s*", "", text, flags=re.I)
    if "```" in text:
        text = text.split("```", 1)[0]
    kept: list[str] = []
    for line in text.splitlines():
        if line.strip().startswith("```"):
            break
        kept.append(line)
    text = "\n".join(kept).strip()
    if not text.upper().startswith(("SELECT", "WITH")):
        match = re.search(r"\b(SELECT|WITH)\b", text, re.I | re.S)
        if match:
            text = text[match.start() :].strip()
    return text.rstrip(";").strip()


def _sort_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {str(t.get("id")): t for t in tasks if isinstance(t, dict) and t.get("id")}
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()

    def visit(tid: str) -> None:
        if tid in seen or tid not in by_id:
            return
        task = by_id[tid]
        for dep in task.get("depends_on") or []:
            visit(str(dep))
        if tid not in seen:
            seen.add(tid)
            ordered.append(task)

    for tid in by_id:
        visit(tid)
    for task in tasks:
        tid = str(task.get("id") or "")
        if tid and tid not in seen:
            ordered.append(task)
    return ordered


async def _execute_sql_task(
    task: dict[str, Any],
    *,
    org_id: int,
    user_id: int,
    role: str,
) -> dict[str, Any]:
    kpi = task.get("kpi")
    time_phrase = str(task.get("time") or "all time")
    dimension = task.get("dimension")
    scope_level = str(task.get("scope") or "org")
    goal = str(task.get("goal") or "")
    owner_name = str(task.get("owner_name") or "").strip() or None
    owner_names = [
        str(item).strip()
        for item in (task.get("owner_names") or [])
        if str(item).strip()
    ][:20] if isinstance(task.get("owner_names"), list) else None
    status_filter = str(task.get("status_filter") or "").strip() or None
    term = str(task.get("term") or "").strip() or None
    region = str(task.get("region") or "").strip() or None
    country = str(task.get("country") or "").strip() or None
    row_limit = _positive_int(task.get("limit"))

    if kpi:
        kpi_args = {
            "kpi": str(kpi),
            "scope": scope_level,
            "time": time_phrase,
            "dimension": dimension,
            "goal": goal,
            "owner_name": owner_name,
            "owner_names": owner_names,
            "status_filter": status_filter,
            "term": term,
            "region": region,
            "country": country,
            "limit": row_limit,
        }
        result = await asyncio.to_thread(
            run_kpi,
            str(kpi),
            organization_id=org_id,
            user_id=user_id,
            role=role,
            scope_level=scope_level,
            time_window=time_phrase if time_phrase.lower() not in {"", "none"} else None,
            dimension=str(dimension) if dimension else None,
            owner_name=owner_name,
            owner_names=owner_names,
            status_filter=status_filter,
            term=term,
            region=region,
            country=country,
            row_limit=row_limit,
        )
        summary = _sql_tool_summary(result if isinstance(result, dict) else {})
        _obs_tool("run_kpi", kpi_args, summary)
        return result if isinstance(result, dict) else {}

    sql_task = dict(task)
    if term == "latest" and not row_limit:
        sql_task["limit"] = 10
    if term == "recent" and time_phrase.strip().lower() in {"", "all time", "recent", "none"}:
        sql_task["time"] = "last 1 hour"
    sql_prompt = load_agent_prompt(_SQL_MD)
    user = json.dumps(sql_task, ensure_ascii=False)
    raw = await _llm_text(system=sql_prompt, user=user, max_tokens=800, phase="sql_executor")
    tool = extract_json(raw) or {}
    sql = _clean_llm_sql(str(tool.get("sql") or tool.get("query") or raw))
    if sql.startswith("{"):
        sql = _clean_llm_sql(str(tool.get("sql") or ""))
    if not sql:
        err = {
            "status": "error",
            "error_type": "REPLAN",
            "error": "SQL executor returned no query",
            "rows": [],
            "task_goal": goal,
        }
        _obs_tool("run_sql", {"goal": goal}, err)
        return err
    sql_args = {"goal": goal, "sqlPreview": sql[:240]}
    result = await asyncio.to_thread(
        run_sql,
        sql,
        organization_id=org_id,
        user_id=user_id,
        role=role,
    )
    summary = _sql_tool_summary(result if isinstance(result, dict) else {})
    _obs_tool("run_sql", sql_args, summary)
    if isinstance(result, dict) and result.get("status") == "ok":
        if term == "latest":
            shown = row_limit or 10
            result["answer_note"] = (
                f"These are the {shown} most recently created, not the full set."
            )
        elif term == "recent" and sql_task.get("time") == "last 1 hour":
            result["answer_note"] = "This is for the last 1 hour."
    return result if isinstance(result, dict) else {}


def _kg_rows_from_output(output: SynthesisOutput) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for fact in output.facts:
        if isinstance(fact.breakdown, list):
            rows.extend(row for row in fact.breakdown if isinstance(row, dict))
        elif fact.value is not None:
            rows.append(
                {
                    "label": fact.label,
                    "value": fact.value,
                    **({"unit": fact.unit} if fact.unit else {}),
                }
            )
    return rows


def _kg_notes_from_output(output: SynthesisOutput) -> str:
    if output.status != "success":
        return "kg_notes: graph context unavailable"
    facts = [
        {
            "label": fact.label,
            "value": fact.value,
            "unit": fact.unit,
            "breakdown": fact.breakdown,
        }
        for fact in output.facts
    ]
    if not facts:
        return "kg_notes: graph returned 0 facts"
    preview = json.dumps(facts, ensure_ascii=False, default=str)
    if len(preview) > 6000:
        preview = preview[:6000] + "…"
    return f"kg_notes (verified graph facts):\n{preview}"


async def _execute_kg_task(
    task: dict[str, Any],
    *,
    kg_ctx: KgContext,
) -> tuple[SynthesisOutput | None, str, list[dict[str, Any]]]:
    goal = str(task.get("goal") or "")
    kg_question = (
        f"{goal}\n\n"
        "Domain task context (trusted planner output): "
        f"{json.dumps(task, ensure_ascii=False, default=str)}"
    )
    tool_args = {"goal": goal, "task": task}
    try:
        output = await asyncio.to_thread(
            CRMB2BKGAgent(context=kg_ctx).run,
            kg_question,
        )
    except Exception as exc:
        _obs_tool(
            "crm_b2b_kg_agent",
            tool_args,
            {"status": "error", "error": f"graph unavailable — {exc}"},
        )
        return None, "kg_notes: graph context unavailable", []

    _obs_tool("crm_b2b_kg_agent", tool_args, _kg_tool_summary(output))
    rows = _kg_rows_from_output(output)
    return output, _kg_notes_from_output(output), rows


async def run_turn(
    *,
    question: str,
    scope: AnalyticsScope,
    session_id: str | None = None,
    messages: list[dict[str, Any]] | None = None,
    working_memory: dict[str, Any] | None = None,
    time_phrase: str | None = None,
    object_lock: str | None = None,
) -> dict[str, Any]:
    import time

    from app.agent_log import trace

    org_id = parse_org_id(scope.organization_id)
    user_id = parse_user_id(scope.actor_id)
    role = normalize_role(scope.role)
    from app.agents.reports_b2b.kg_executor.core.kg_client import (
        resolve_org_default_currency,
    )

    display_currency = resolve_org_default_currency(org_id)
    prior = _reports_context_from_memory(working_memory)
    trusted_time_phrase = str(time_phrase or "").strip()
    trusted_object_lock = _canonical_object(object_lock) or _canonical_object(
        prior.get("objectLock")
    )
    started = time.perf_counter()

    trace(agent=_LOG_AGENT, step="receive", user=question.strip(), orgId=org_id, role=role)

    domain_prompt = load_agent_prompt(_DOMAIN_MD)
    earlier = _format_chat(messages or [])
    plan_user = (
        _identity_block(scope, org_id, user_id)
        + "Current question (decide the object and metric from this sentence alone, "
        "unless it cannot stand alone and clearly points back):\n"
        + f"{question.strip()}\n\n"
        + (
            "Earlier turns — ignore them when the current question names a new subject. "
            "Use them only when this question cannot stand alone "
            "(those, that, same, them, or a bare yes or please). "
            "A bare yes or please answers only the latest assistant question, not an older one. "
            "Emit no tasks only when these turns already contain the exact figure or rows that question needs. "
            "Otherwise emit a sql task, or a kg task when it is a why or an explanation. "
            "A choice of two metrics is not already answered: emit a sql task for the first one. "
            "Do not say the list is missing.\n"
            + _follow_up_block(prior)
            + (
                "Trusted report context (optional follow-up only): "
                + json.dumps(
                    {
                        **(
                            {"timePhrase": trusted_time_phrase}
                            if trusted_time_phrase
                            else {}
                        ),
                        **(
                            {"objectLock": trusted_object_lock}
                            if trusted_object_lock
                            else {}
                        ),
                    },
                    ensure_ascii=False,
                )
                + "\n"
                if trusted_time_phrase or trusted_object_lock
                else ""
            )
            + (earlier + "\n" if earlier else "")
            if prior or trusted_time_phrase or trusted_object_lock or earlier
            else ""
        )
    )
    plan_raw = await _llm_text(
        system=domain_prompt, user=plan_user, max_tokens=900, phase="domain_plan"
    )
    plan = _parse_plan(plan_raw)
    trace(
        agent=_LOG_AGENT,
        step="plan",
        ok=True,
        taskCount=len(plan.get("tasks") or []),
        depth=plan.get("depth"),
    )
    tasks = _sort_tasks([t for t in plan.get("tasks", []) if isinstance(t, dict)])

    if not tasks:
        brief_user = (
            plan_user
            + "\nMode: brief. No executor facts. Reply in 1–2 sentences. "
            "Do not invent numbers or charts. Do not write a card line."
        )
        brief = await _llm_text(
            system=domain_prompt, user=brief_user, max_tokens=280, phase="domain_chat"
        )
        brief, _ignored = peel_card_choice(brief)
        return {
            "assistantText": brief,
            "rows": [],
            "plan": plan,
            "kpi_slices": [],
            "had_kg": False,
        }

    for task in tasks:
        normalize_task_scope(task, role=role)

    facts_parts: list[str] = []
    all_rows: list[dict[str, Any]] = []
    breakdowns: list[dict[str, Any]] = []
    kpi_slices: list[dict[str, Any]] = []
    had_kg = False
    task_results: list[dict[str, Any]] = []
    last_kpi: str | None = None
    last_answer_type: str | None = None

    kg_ctx = KgContext(org_id=org_id, role=role, user_id=user_id, session_id=session_id)
    result_index = 0

    for task in tasks:
        result_index += 1
        result_id = f"r{result_index}"
        executor = str(task.get("executor") or "sql").lower()
        if executor == "kg":
            had_kg = True
            res, notes, kg_rows = await _execute_kg_task(task, kg_ctx=kg_ctx)
            facts_parts.append(f"result_id: {result_id}\n{notes}")
            if kg_rows:
                breakdowns.append(
                    {
                        "id": result_id,
                        "kpi_id": str(task.get("kpi") or ""),
                        "rows": kg_rows,
                        "goal": str(task.get("goal") or "Leads"),
                        "time": str(task.get("time") or ""),
                        "dimension": str(task.get("dimension") or ""),
                        "answer_type": str(task.get("answer_type") or "list"),
                    }
                )
                if not all_rows:
                    all_rows = list(kg_rows)
            task_results.append(
                {
                    "executor": "kg",
                    "status": res.status if res else "error",
                }
            )
            continue

        result = await _execute_sql_task(
            task,
            org_id=org_id,
            user_id=user_id,
            role=role,
        )
        used_certified_kpi = bool(task.get("kpi")) and not _sql_needs_fallback(result)
        if task.get("kpi") and _sql_needs_fallback(result):
            result = await _execute_sql_task(
                {**task, "kpi": None},
                org_id=org_id,
                user_id=user_id,
                role=role,
            )
            plan_has_kg = any(
                str(item.get("executor") or "").lower() == "kg" for item in tasks
            )
            if _sql_needs_fallback(result) and not plan_has_kg:
                had_kg = True
                res, notes, kg_rows = await _execute_kg_task(task, kg_ctx=kg_ctx)
                facts_parts.append(f"result_id: {result_id}b\n{notes}")
                if kg_rows:
                    breakdowns.append(
                        {
                            "id": f"{result_id}b",
                            "kpi_id": "",
                            "rows": kg_rows,
                            "goal": str(task.get("goal") or ""),
                            "time": str(task.get("time") or ""),
                            "dimension": str(task.get("dimension") or ""),
                            "answer_type": "why_breakdown",
                        }
                    )
                    if not all_rows:
                        all_rows = list(kg_rows)
                task_results.append(
                    {
                        "executor": "kg",
                        "status": res.status if res else "error",
                    }
                )
        kpi_id = result.get("kpi_id") or (
            task.get("kpi") if used_certified_kpi else None
        )
        if kpi_id:
            last_kpi = str(kpi_id)
        last_answer_type = str(task.get("answer_type") or "")
        rows = result.get("rows") if isinstance(result.get("rows"), list) else []
        if rows:
            dimension = task.get("dimension")
            answer_type = str(task.get("answer_type") or "").lower()
            is_breakdown = bool(dimension) or answer_type in {
                "list",
                "table",
                "breakdown",
                "why_breakdown",
            }
            if is_breakdown or len(rows) > 1:
                all_rows = rows
                breakdowns.append(
                    {
                        "id": result_id,
                        "kpi_id": str(kpi_id or ""),
                        "rows": rows,
                        "goal": str(task.get("goal") or ""),
                        "time": str(task.get("time") or ""),
                        "dimension": str(dimension or ""),
                        "answer_type": answer_type or "breakdown",
                    }
                )
            elif kpi_id and result.get("status") == "ok":
                kpi_slices.append(
                    {
                        "id": result_id,
                        "kpi_id": str(kpi_id),
                        "rows": rows,
                        "goal": str(task.get("goal") or ""),
                        "time": str(task.get("time") or ""),
                    }
                )
                if len(kpi_slices) == 1 and len(rows) == 1:
                    all_rows = rows
        facts_parts.append(
            f"result_id: {result_id}\n"
            + assemble_facts(
                result,
                task_goal=str(task.get("goal") or ""),
                kpi_id=str(kpi_id) if kpi_id else None,
                group_by=[str(task.get("dimension"))] if task.get("dimension") else None,
                answer_type=str(task.get("answer_type") or ""),
                time_echo=str(result.get("time_echo") or ""),
                time_requested=str(task.get("time") or ""),
                time_status=str(result.get("time_status") or ""),
                requested_kpi=str(task.get("kpi") or "") or None,
            )
        )
        task_results.append({"executor": "sql", "status": result.get("status"), "kpi": kpi_id})

    facts_blob = "\n\n".join(p for p in facts_parts if p.strip())
    card_choice: dict[str, str] | None = {"kind": "none"}
    if not facts_blob.strip():
        answer = _no_data_brief(question)
    else:
        brief_user = (
            _identity_block(scope, org_id, user_id)
            + f"Display currency: {display_currency}. Use that currency code/symbol for every money amount.\n"
            + f"Original question: {question.strip()}\n\n"
            + facts_blob
        )
        brief_system = (
            domain_prompt
            + "\n\nYou are in **brief** mode. Follow the crm-user-brief examples. "
            "The user-facing part is HTML only — never a plan object, never Markdown, never a code fence.\n"
            "Allowed tags only: p, ul, li, strong, em, br. No class, style, id, heading tags, "
            "or links.\n"
            "The last line is the card line from the examples, `card: none` or "
            "`card: kpi r1` or `card: bar r1` or `card: table r1`. "
            "Name one result_id from the facts. Do not put numbers, labels, or totals on that line.\n"
            + f"The tenant display currency is {display_currency}; never substitute another currency symbol. "
            "If kg_notes says the graph is unavailable or returned 0 rows, do not infer hidden "
            "causes or systemic patterns; state that deeper causal evidence is unavailable and "
            "limit conclusions to the SQL categories and counts. Do not expose infrastructure "
            "names, environment variables, configuration steps, internal errors, or speculate "
            "about why graph context is unavailable. Do not make schema/storage claims unless "
            "the executor facts explicitly state them. "
            "Never invent metrics. "
            "Do not say you could not load warehouse metrics, and do not tell the user "
            "to ask for a different KPI such as won revenue or pipeline. "
            "Answer the current question from these facts, including a real zero."
        )
        raw_answer = await _llm_text(
            system=brief_system, user=brief_user, max_tokens=4096, phase="brief"
        )
        answer, card_choice = peel_card_choice(raw_answer)
        answer = _sanitize_brief(answer) or _no_data_brief(question)
        if card_choice is None:
            card_choice = {"kind": "none"}

        check = ground_check(answer, facts_blob)
        if not check.grounded and check.ungrounded:
            repair_user = (
                brief_user
                + f"\n\nUngrounded numbers in draft: {check.ungrounded}. "
                f"Rewrite using ONLY the facts. Keep the card line. Draft to fix:\n{answer}"
            )
            try:
                repaired = await _llm_text(
                    system=brief_system,
                    user=repair_user,
                    max_tokens=4096,
                    phase="brief_repair",
                )
                repaired_html, repaired_choice = peel_card_choice(repaired)
                answer = _sanitize_brief(repaired_html) or answer
                if repaired_choice is not None:
                    card_choice = repaired_choice
            except Exception:
                answer = (
                    answer
                    + "\n\n(Some figures could not be verified against warehouse rows.)"
                )

    first_task = tasks[0] if tasks else {}
    planned_object = _canonical_object(
        plan.get("object")
        or first_task.get("object")
        or first_task.get("objectLock")
    )
    reports_patch = {
        "objectLock": planned_object or trusted_object_lock,
        "timePhrase": str(
            first_task.get("time")
            or trusted_time_phrase
            or prior.get("timePhrase")
            or ""
        ),
        "lastKpiId": last_kpi or prior.get("lastKpiId"),
        "lastAnswerType": last_answer_type or prior.get("lastAnswerType"),
        "lastSummary": answer[:200],
    }

    progress = None
    if had_kg:
        kg_ok = any(
            isinstance(r, dict)
            and r.get("executor") == "kg"
            and r.get("status") == "success"
            for r in task_results
        )
        progress = [
            {"phase": "plan", "status": "done", "detail": "Analytics plan ready"},
            {"phase": "sql", "status": "done", "detail": "Warehouse metrics loaded"},
            {
                "phase": "kg",
                "status": "done" if kg_ok else "unavailable",
                "detail": "Graph context loaded" if kg_ok else "Graph context unavailable",
            },
            {"phase": "brief", "status": "done", "detail": "Answer synthesized"},
        ]

    elapsed_ms = (time.perf_counter() - started) * 1000
    trace(
        agent=_LOG_AGENT,
        step="finish",
        ok=True,
        ms=round(elapsed_ms, 1),
        speech=answer,
        rowCount=len(all_rows),
        hadKg=had_kg,
        taskResults=task_results,
    )

    return {
        "assistantText": answer,
        "rows": all_rows,
        "breakdowns": breakdowns,
        "kpi_slices": kpi_slices,
        "plan": plan,
        "task_results": task_results,
        "had_kg": had_kg,
        "progress": progress,
        "reportsContextPatch": reports_patch,
        "card_choice": card_choice or {"kind": "none"},
    }
