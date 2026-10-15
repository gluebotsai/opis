"""One reporting turn for this CRM B2B pack (Domain → SQL/KG → review → brief).

Hosts should import `run_turn` from this module. This file does not live under
test_streamlit.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

PACK = Path(__file__).resolve().parent.parent
if str(PACK) not in sys.path:
    sys.path.insert(0, str(PACK))

for env_path in (PACK / ".env", PACK.parent / ".env", Path("/home/vectone/shiva/reportagent/.env")):
    if env_path.exists():
        load_dotenv(env_path)

from core.context_index import kpi_index_lines, view_index_lines  # noqa: E402
from core.facts import assemble_facts  # noqa: E402
from core.grounding import apply_grounding  # noqa: E402
from core.prompt_load import load_agent_prompt  # noqa: E402
from core.review import sql_task_done  # noqa: E402
from core.run_kpi import run_kpi  # noqa: E402
from core.run_sql import run_sql  # noqa: E402
from core.time import resolve_expression  # noqa: E402
from kg_executor.core.models import AgentContext  # noqa: E402
from kg_executor.core.orchestrator import CRMB2BKGAgent  # noqa: E402

LLM_BASE = os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1")).rstrip("/")
LLM_MODEL = os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma"))
DSN = os.getenv("DATABASE_URL", os.getenv("PG_DSN"))

LEAD_STATUS_FILTERS = frozenset(
    {"new", "contacted", "qualified", "qualifying", "disqualified", "converted"}
)


def _task_filters_sql(task: dict[str, Any]) -> str | None:
    parts: list[str] = []
    raw = task.get("status_filter") or task.get("lead_status")
    if raw not in (None, "", "null"):
        status = str(raw).strip().lower()
        if status in LEAD_STATUS_FILTERS:
            parts.append(f"lead_status = '{status}'")
    owner = task.get("owner_name") or task.get("named_owner")
    if owner not in (None, "", "null"):
        safe = str(owner).replace("'", "''")[:80].strip()
        if safe:
            parts.append(f"owner_name ILIKE '%{safe}%'")
    if not parts:
        return None
    return " AND ".join(parts)


def call_llm(messages: list[dict[str, str]], *, temperature: float = 0.1, max_tokens: int = 1200) -> str:
    with httpx.Client(base_url=LLM_BASE, timeout=90.0) as client:
        resp = client.post(
            "/chat/completions",
            json={
                "model": LLM_MODEL,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def extract_json(text: str) -> dict[str, Any]:
    clean = (text or "").strip()
    match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", clean, re.DOTALL)
    if match:
        clean = match.group(1)
    elif "{" in clean and "}" in clean:
        clean = clean[clean.find("{") : clean.rfind("}") + 1]
    try:
        parsed = json.loads(clean)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def extract_sql(text: str) -> str:
    parsed = extract_json(text)
    if isinstance(parsed.get("sql"), str) and parsed["sql"].strip():
        return parsed["sql"].strip().rstrip(";")
    match = re.search(r"```(?:sql)?\s*((?:SELECT|WITH)\b.*?)\s*```", text or "", re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip().rstrip(";")
    match = re.search(r"\b((?:SELECT|WITH)\b.*?)(?:;|\Z)", text or "", re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip().rstrip(";")
    return ""


def parse_executor(text: str) -> dict[str, Any]:
    parsed = extract_json(text)
    tool = str(parsed.get("tool") or parsed.get("action") or "").strip().lower()
    has_kpi = bool(parsed.get("kpi_id") or (tool in {"run_kpi", "kpi"} and parsed.get("kpi")))
    has_sql = isinstance(parsed.get("sql"), str) and parsed["sql"].strip()
    if has_kpi and has_sql and tool not in {"run_kpi", "kpi", "run_sql", "sql"}:
        return {"kind": "ambiguous", "raw": text}
    if tool in {"run_kpi", "kpi"} or (has_kpi and not has_sql):
        kpi_id = parsed.get("kpi_id") or parsed.get("kpi")
        call: dict[str, Any] = {"kind": "run_kpi", "kpi_id": kpi_id}
        if "dimension" in parsed and parsed.get("dimension"):
            call["dimension"] = parsed["dimension"]
        if isinstance(parsed.get("slot_values"), dict):
            call["slot_values"] = {str(k): str(v) for k, v in parsed["slot_values"].items()}
        return call
    if tool in {"run_sql", "sql"} or has_sql:
        return {"kind": "run_sql", "sql": str(parsed.get("sql") or extract_sql(text)).strip().rstrip(";")}
    sql = extract_sql(text)
    if sql[:6].lower() == "select" or sql[:4].lower() == "with":
        return {"kind": "run_sql", "sql": sql}
    return {"kind": "none", "raw": text}


def _time_bounds(expression: str | None) -> tuple[str | None, str | None, str, str]:
    bounds = resolve_expression(expression)
    start = bounds.start.isoformat() if bounds.start else None
    end = bounds.end.isoformat() if bounds.end else None
    return start, end, bounds.echo, bounds.status


def _unresolved_time_tasks(tasks: list) -> list[dict[str, Any]]:
    bad: list[dict[str, Any]] = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        if str(task.get("executor") or "sql").lower() == "kg":
            continue
        bounds = resolve_expression(task.get("time"))
        if bounds.status == "unresolved":
            bad.append({"id": task.get("id"), "time": task.get("time"), "echo": bounds.echo})
    return bad


def _plan_context(plan: dict[str, Any]) -> dict[str, Any]:
    raw = plan.get("understanding")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        return {"end_goal": raw.strip(), "said": raw.strip()}
    return {}


def _executor_user(
    task: dict[str, Any],
    start: str | None,
    end: str | None,
    *,
    time_echo: str,
    time_status: str,
    understanding: dict[str, Any] | None = None,
) -> str:
    if start and end:
        time_ctx = (
            f"time_status: {time_status}\n"
            f"period_applied: {time_echo}\n"
            f"time_params: start={start}, end={end}\n"
            "params_available: :start, :end\n"
            "You must apply :start and :end. Do not run an all-time query."
        )
    elif time_status == "unresolved":
        time_ctx = (
            f"time_status: unresolved\nperiod_applied: {time_echo}\n"
            "Do not execute all-time SQL. There is no bound window."
        )
    else:
        time_ctx = (
            f"time_status: {time_status}\nperiod_applied: {time_echo}\n"
            "time_params: overall / all-time (no date filter)\nparams_available: none"
        )
    kpi = task.get("kpi")
    kpi_set = kpi not in (None, "", "null")
    if kpi_set:
        tool_hint = (
            f"Domain suggested kpi={kpi}. Confirm against the KPI cards and task.goal. "
            "If that id’s meaning matches, run_kpi with it. If a different card matches the goal, use that id. "
            "Copy dimension when the goal is a slice."
        )
    else:
        tool_hint = (
            "No certified KPI was set. Read the view meanings and write one SELECT/WITH on the matching rpt.* view. "
            "Do not copy a sample query."
        )
    understanding_txt = json.dumps(understanding or {}, default=str)
    return (
        f"Domain understanding:\n{understanding_txt}\n\n"
        "Task JSON:\n"
        f"{json.dumps(task, default=str)}\n\n"
        f"{time_ctx}\n\n"
        f"{tool_hint}\n"
        "Reply with exactly one of:\n"
        '{"tool":"run_kpi","kpi_id":"<catalog id>","dimension":null}\n'
        'or {"tool":"run_kpi","kpi_id":"<catalog id>","dimension":"owner"}\n'
        "or one SELECT/WITH statement against rpt.* ."
    )


def _execute_call(
    call: dict[str, Any],
    *,
    organization_id: int,
    user_id: int,
    role: str,
    scope_level: str | None,
    start: str | None,
    end: str | None,
) -> dict[str, Any]:
    if call["kind"] == "run_kpi":
        kwargs: dict[str, Any] = {
            "kpi_id": call.get("kpi_id"),
            "organization_id": organization_id,
            "user_id": user_id,
            "role": role,
            "time_start": start,
            "time_end": end,
            "dsn": DSN,
        }
        if scope_level:
            kwargs["scope_level"] = scope_level
        if call.get("dimension"):
            kwargs["dimension"] = call["dimension"]
        if call.get("slot_values"):
            kwargs["slot_values"] = call["slot_values"]
        return run_kpi(**kwargs)
    params = {"start": start, "end": end} if start and end else None
    return run_sql(
        call.get("sql") or "",
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        params=params,
        dsn=DSN,
    )


def _apply_kpi_slots(task: dict[str, Any], call: dict[str, Any]) -> dict[str, Any]:
    if call.get("kind") != "run_kpi":
        return call
    dim = call.get("dimension") or task.get("dimension")
    if dim in (None, "", "null", "none"):
        dim = None
    if dim:
        call["dimension"] = dim
    filt = _task_filters_sql(task)
    if filt:
        slots = dict(call.get("slot_values") or {})
        slots["filters_sql"] = filt
        call["slot_values"] = slots
    return call


def _sql_sufficiency(
    sql_prompt: str,
    task: dict[str, Any],
    result: dict[str, Any],
    understanding: dict[str, Any],
) -> dict[str, Any]:
    sample = (result.get("rows") or [])[:8]
    user = (
        f"Domain understanding: {json.dumps(understanding, default=str)}\n"
        f"Task goal: {task.get('goal')}\n"
        f"status: {result.get('status')} error: {result.get('error')}\n"
        f"row_count: {len(result.get('rows') or [])}\n"
        f"sample_rows: {json.dumps(sample, default=str)[:4000]}\n"
        'Do these rows accomplish the task goal? JSON only: {"done": true} or {"done": false, "gap": "..." }'
    )
    try:
        raw = call_llm(
            [
                {
                    "role": "system",
                    "content": sql_prompt
                    + "\n\nYou are checking whether the last warehouse result meets the task. JSON only.",
                },
                {"role": "user", "content": user},
            ],
            temperature=0.0,
            max_tokens=200,
        )
        return extract_json(raw)
    except Exception:
        return {}


def _run_sql_task(
    task: dict[str, Any],
    *,
    sql_prompt: str,
    organization_id: int,
    user_id: int,
    role: str,
    understanding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    start, end, echo, status = _time_bounds(task.get("time"))
    scope = task.get("scope")
    scope_level = str(scope) if scope else None
    if status == "unresolved":
        return {
            "status": "error",
            "error_type": "TIME_UNRESOLVED",
            "error": echo,
            "time_echo": echo,
            "time_status": status,
            "rows": [],
            "sql": "",
            "attempts": [],
        }
    user_msg = _executor_user(
        task, start, end, time_echo=echo, time_status=status, understanding=understanding
    )
    raw = call_llm([{"role": "system", "content": sql_prompt}, {"role": "user", "content": user_msg}])
    call = _apply_kpi_slots(task, parse_executor(raw))
    attempts = [{"raw": raw, "call": {k: v for k, v in call.items() if k != "raw"}}]
    if call["kind"] in {"none", "ambiguous"}:
        return {
            "status": "error",
            "error_type": "NO_TOOL",
            "error": "SQL executor did not return run_kpi JSON or a SELECT/WITH statement.",
            "raw": raw,
            "attempts": attempts,
            "time_echo": echo,
            "rows": [],
            "sql": "",
        }
    result = _execute_call(
        call,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        scope_level=scope_level,
        start=start,
        end=end,
    )
    result["attempts"] = attempts
    result["time_echo"] = echo
    result["time_status"] = result.get("time_status") or status
    result["tool"] = call["kind"]
    if call["kind"] == "run_kpi":
        result["requested_kpi"] = call.get("kpi_id")
        result["requested_dimension"] = call.get("dimension")

    def _repair(seed_result: dict[str, Any], seed_raw: str, reason: str) -> dict[str, Any]:
        repair_user = (
            f"{user_msg}\n\nPrevious reply:\n{seed_raw}\n\n"
            f"error_type: REPAIR\nerror: {reason}\n"
            "Learn from that mistake. Reply again with one run_kpi JSON object or one SELECT/WITH statement."
        )
        repair_raw = call_llm(
            [{"role": "system", "content": sql_prompt}, {"role": "user", "content": repair_user}]
        )
        repair_call = _apply_kpi_slots(task, parse_executor(repair_raw))
        attempts.append({"raw": repair_raw, "call": {k: v for k, v in repair_call.items() if k != "raw"}})
        if repair_call["kind"] in {"none", "ambiguous"}:
            seed_result["repair_error"] = "Repair reply had no tool call."
            seed_result["attempts"] = attempts
            return seed_result
        repaired = _execute_call(
            repair_call,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            scope_level=scope_level,
            start=start,
            end=end,
        )
        repaired["attempts"] = attempts
        repaired["time_echo"] = echo
        repaired["time_status"] = repaired.get("time_status") or status
        repaired["tool"] = repair_call["kind"]
        repaired["repaired"] = True
        if repair_call["kind"] == "run_kpi":
            repaired["requested_kpi"] = repair_call.get("kpi_id")
            repaired["requested_dimension"] = repair_call.get("dimension")
        return repaired

    if result.get("error_type") == "REPAIR":
        result = _repair(result, raw, str(result.get("error") or "guard or database error"))
    else:
        review = _sql_sufficiency(sql_prompt, task, result, understanding or {})
        done, gap = sql_task_done(review, result, task)
        result["task_check"] = {"done": done, "gap": gap, "review": review}
        if not done:
            result = _repair(result, raw, gap or "Result did not accomplish the task goal.")
            review2 = _sql_sufficiency(sql_prompt, task, result, understanding or {})
            done2, gap2 = sql_task_done(review2, result, task)
            result["task_check"] = {"done": done2, "gap": gap2, "review": review2, "retried": True}
    return result


def _json_safe(val: Any) -> Any:
    if val is None or isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, list):
        return [_json_safe(x) for x in val]
    if isinstance(val, dict):
        return {str(k): _json_safe(v) for k, v in val.items()}
    return str(val)


def _run_kg_task(
    task: dict[str, Any],
    *,
    question: str,
    organization_id: int,
    user_id: int,
    role: str,
    understanding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    query = (
        "Execute this Domain graph job with read-only Cypher or a certified template. "
        "Ground notes in rows you actually traverse. "
        "If the first pass is insufficient, take one different traversal.\n"
        f"Domain understanding:\n{json.dumps(understanding or {}, default=str)}\n"
        f"Domain task JSON:\n{json.dumps(task, default=str)}\n"
        f"Original question: {question.strip()}"
    )
    try:
        out = CRMB2BKGAgent(
            AgentContext(org_id=organization_id, role=role, user_id=user_id)
        ).run(query)
    except Exception as exc:
        return {
            "status": "error",
            "error_type": "CALL_FAILED",
            "error": str(exc),
            "rows": [],
            "sql": "",
            "tool": "kg",
        }
    rows: list[dict[str, Any]] = []
    for fact in out.facts or []:
        breakdown = _json_safe(getattr(fact, "breakdown", None))
        if isinstance(breakdown, list) and breakdown:
            for item in breakdown:
                if isinstance(item, dict):
                    rows.append(item)
                else:
                    rows.append({"value": item})
        else:
            rows.append(
                {
                    "label": getattr(fact, "label", None),
                    "value": _json_safe(getattr(fact, "value", None)),
                    "unit": getattr(fact, "unit", None),
                }
            )
    status = str(out.status or "success").lower()
    if status not in {"success", "ok"}:
        return {
            "status": "error",
            "error_type": status.upper() if status else "KG_ERROR",
            "error": out.error or out.markdown or "KG executor failed.",
            "rows": rows,
            "sql": "\n".join(out.cypher_used or []),
            "tool": "kg",
            "attempts_made": out.attempts_made,
        }
    return {
        "status": "ok",
        "rows": rows,
        "sql": "\n".join(out.cypher_used or []),
        "tool": "kg",
        "attempts_made": out.attempts_made,
        "kg_notes": (out.markdown or "")[:8000],
    }


def _order_tasks(tasks: list[Any]) -> list[dict[str, Any]]:
    remaining = [t for t in tasks if isinstance(t, dict)]
    done_ids: set[str] = set()
    ordered: list[dict[str, Any]] = []
    while remaining:
        ready = []
        for t in remaining:
            deps = t.get("depends_on") or []
            if not isinstance(deps, list):
                deps = []
            dep_ids = [str(d) for d in deps]
            if all(d in done_ids for d in dep_ids):
                ready.append(t)
        if not ready:
            ordered.extend(remaining)
            break
        ready.sort(
            key=lambda t: 1 if str(t.get("executor") or "sql").lower() == "kg" else 0
        )
        pick = ready[0]
        remaining.remove(pick)
        ordered.append(pick)
        tid = str(pick.get("id") or f"anon{len(ordered)}")
        done_ids.add(tid)
    return ordered


def _facts_for_task(task: dict[str, Any], result: dict[str, Any]) -> str:
    executor = str(task.get("executor") or "sql").lower()
    if executor == "kg":
        kg_block = assemble_facts(
            result,
            task_goal=str(task.get("goal") or ""),
            kpi_id=None,
            answer_type=str(task.get("answer_type") or "why_breakdown"),
            time_echo="",
            time_requested=str(task.get("time") or ""),
            time_status="kg",
        )
        notes = result.get("kg_notes")
        if notes:
            return f"{kg_block}\nkg_notes:\n{notes}"
        return kg_block
    dim = result.get("dimension") or result.get("requested_dimension") or task.get("dimension")
    if dim in (None, "", "null"):
        dim = None
    return assemble_facts(
        result,
        task_goal=str(task.get("goal") or ""),
        kpi_id=result.get("kpi_id") or task.get("kpi"),
        group_by=[str(dim)] if dim else None,
        answer_type=str(task.get("answer_type") or ("breakdown" if dim else "")),
        time_echo=str(result.get("time_echo") or ""),
        time_requested=str(task.get("time") or ""),
        time_status=str(result.get("time_status") or ""),
        requested_kpi=str(result.get("requested_kpi") or task.get("kpi") or ""),
    )


def _run_plan_tasks(
    tasks: list[Any],
    *,
    question: str,
    organization_id: int,
    user_id: int,
    role: str,
    sql_prompt: str,
    understanding: dict[str, Any],
    trace: dict[str, Any],
) -> tuple[list[str], list[dict[str, Any]]]:
    fact_blocks: list[str] = []
    all_rows: list[dict[str, Any]] = []
    for task in _order_tasks(tasks):
        if not isinstance(task, dict):
            continue
        executor = str(task.get("executor") or "sql").lower()
        if executor == "kg":
            try:
                result = _run_kg_task(
                    task,
                    question=question,
                    organization_id=organization_id,
                    user_id=user_id,
                    role=role,
                    understanding=understanding,
                )
            except Exception as exc:
                result = {"status": "error", "error": str(exc), "error_type": "CALL_FAILED", "rows": []}
        else:
            try:
                result = _run_sql_task(
                    task,
                    sql_prompt=sql_prompt,
                    organization_id=organization_id,
                    user_id=user_id,
                    role=role,
                    understanding=understanding,
                )
            except Exception as exc:
                result = {"status": "error", "error": str(exc), "error_type": "CALL_FAILED", "rows": []}
        result["task"] = task
        trace["tasks"].append(result)
        fact_blocks.append(_facts_for_task(task, result))
        all_rows.extend(result.get("rows") or [])
    return fact_blocks, all_rows


def run_turn(
    question: str,
    *,
    organization_id: int,
    user_id: int,
    role: str,
) -> dict[str, Any]:
    catalog = kpi_index_lines()
    views = view_index_lines()
    domain_prompt = load_agent_prompt(PACK / "domain" / "agent.md") + "\n\n" + catalog
    sql_prompt = load_agent_prompt(PACK / "sql_executor" / "agent.md") + "\n\n" + catalog + "\n\n" + views
    domain_user = (
        f"Identity: role={role}, org_id={organization_id}, user_id={user_id}\n"
        f"Question: {question.strip()}"
    )
    trace: dict[str, Any] = {
        "question": question.strip(),
        "identity": {"organization_id": organization_id, "user_id": user_id, "role": role},
        "model": LLM_MODEL,
        "tasks": [],
    }
    try:
        domain_raw = call_llm(
            [{"role": "system", "content": domain_prompt}, {"role": "user", "content": domain_user}]
        )
    except Exception as exc:
        trace["domain_error"] = str(exc)
        return {"answer": f"Domain call failed: {exc}", "trace": trace, "rows": []}

    trace["domain_raw"] = domain_raw
    plan = extract_json(domain_raw)
    trace["plan"] = plan
    tasks = plan.get("tasks") if isinstance(plan.get("tasks"), list) else None
    if not tasks:
        trace["domain_error"] = "Domain reply had no tasks array."
        return {
            "answer": "Domain did not return a plan. The raw reply is in the trace.",
            "trace": trace,
            "rows": [],
        }

    unresolved = _unresolved_time_tasks(tasks)
    if unresolved:
        repair_user = (
            f"{domain_user}\n\nPrevious plan:\n{json.dumps(plan, default=str)}\n\n"
            "Python could not bind these task.time values to a UTC window:\n"
            f"{json.dumps(unresolved, default=str)}\n"
            "Rewrite the full plan JSON. For those tasks, set time to a bindable phrase "
            "(all time, this month, last month, August, August 2026, last 30 days, or an ISO date). "
            "Keep the same understanding, kpi and goal. Count questions stay on count KPIs."
        )
        try:
            repair_raw = call_llm(
                [{"role": "system", "content": domain_prompt}, {"role": "user", "content": repair_user}]
            )
            trace["domain_time_repair"] = repair_raw
            repaired_plan = extract_json(repair_raw)
            if isinstance(repaired_plan.get("tasks"), list):
                plan = repaired_plan
                tasks = plan["tasks"]
                trace["plan"] = plan
        except Exception as exc:
            trace["domain_time_repair_error"] = str(exc)

    understanding = _plan_context(plan)
    trace["understanding"] = understanding

    fact_blocks, all_rows = _run_plan_tasks(
        tasks,
        question=question,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        sql_prompt=sql_prompt,
        understanding=understanding,
        trace=trace,
    )

    facts = "\n\n".join(fact_blocks)
    end_goal = understanding.get("end_goal") or understanding.get("said") or question.strip()
    review_user = (
        f"GOAL_REVIEW\nOriginal Question: {question.strip()}\n"
        f"Identity: role={role}, org_id={organization_id}, user_id={user_id}\n"
        f"understanding: {json.dumps(understanding, default=str)}\n"
        f"end_goal: {end_goal}\n"
        f"Facts gathered:\n{facts}\n"
        "Decide if the end_goal is accomplished. Output one goal_review JSON."
    )
    try:
        review_raw = call_llm(
            [{"role": "system", "content": domain_prompt}, {"role": "user", "content": review_user}],
            temperature=0.0,
            max_tokens=800,
        )
        trace["goal_review_raw"] = review_raw
        review = extract_json(review_raw)
        trace["goal_review"] = review
    except Exception as exc:
        review = {"kind": "goal_review", "done": True, "reason": str(exc), "tasks": []}
        trace["goal_review_error"] = str(exc)

    follow = review.get("tasks") if isinstance(review.get("tasks"), list) else []
    if review.get("kind") == "goal_review" and review.get("done") in (False, "false", "no") and follow:
        extra_blocks, extra_rows = _run_plan_tasks(
            follow,
            question=question,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            sql_prompt=sql_prompt,
            understanding=understanding,
            trace=trace,
        )
        fact_blocks.extend(extra_blocks)
        all_rows.extend(extra_rows)
        facts = "\n\n".join(fact_blocks)
        trace["follow_up"] = True

    trace["facts"] = facts
    kg_notes = "\n\n".join(
        str(t.get("kg_notes") or "").strip()
        for t in trace["tasks"]
        if isinstance(t, dict) and t.get("kg_notes")
    ).strip()

    briefing_system = (
        domain_prompt
        + "\n\n## active mode: BRIEF\n"
        "The user message contains executor facts. Output the operator briefing only. "
        "No plan JSON. No RESULT labels. First sentence answers the question with numbers and names from the facts. "
        "Match understanding.expects. If kg_notes exist, carry Descriptive, Predictive, and Recommended "
        "only as far as those notes are grounded. Zero is zero. "
        "If the end_goal is only partly met, say what is still missing. "
        "Do not write 'you may want to review' unless a named row is unassigned, overdue, or $0."
    )
    synthesis_user = (
        f"Original Question: {question.strip()}\n"
        f"Identity: role={role}, org_id={organization_id}, user_id={user_id}\n"
        f"understanding: {json.dumps(understanding, default=str)}\n"
        f"end_goal: {end_goal}\n"
        f"Facts gathered:\n{facts}\n"
    )
    if kg_notes:
        synthesis_user += f"\nkg_notes:\n{kg_notes}\n"
    synthesis_user += (
        "\nWrite the briefing now. Use period_applied as the only named window. "
        "Open-deals population stays open deals. Count metrics stay counts. "
        "Tables only for group breakdowns or lists. Cite entity names from the rows."
    )
    try:
        briefing = call_llm(
            [
                {"role": "system", "content": briefing_system},
                {"role": "user", "content": synthesis_user},
            ],
            temperature=0.2,
            max_tokens=1400,
        )
    except Exception as exc:
        trace["synthesis_error"] = str(exc)
        return {"answer": facts, "trace": trace, "rows": all_rows}

    def _regen(previous: str, ungrounded: list[str]) -> str:
        return call_llm(
            [
                {"role": "system", "content": briefing_system},
                {
                    "role": "user",
                    "content": (
                        f"{synthesis_user}\n\nPrevious answer:\n{previous}\n\n"
                        "These figures were not in the facts: "
                        + ", ".join(str(n) for n in ungrounded)
                        + "\nRewrite the same briefing. Keep prose. Do not paste RESULT or catalog labels. "
                        "Use only numbers that appear in the facts."
                    ),
                },
            ],
            temperature=0.2,
            max_tokens=1400,
        )

    try:
        ground_src = f"{facts}\n{kg_notes}" if kg_notes else facts
        answer, grounded = apply_grounding(briefing, ground_src, _regen)
    except Exception as exc:
        answer, grounded = briefing, False
        trace["grounding_error"] = str(exc)
    trace["grounded"] = grounded
    trace["briefing_raw"] = briefing
    return {"answer": answer, "trace": trace, "rows": all_rows}
