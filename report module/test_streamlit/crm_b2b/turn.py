"""Pass-through turn for the B2B CRM pack.

Streamlit supplies organization id, user id, and role. This module loads the
pack prompts, asks the Domain model, then SQL (`run_kpi`/`run_sql`) or KG
(`CRMB2BKGAgent`). It does not rename KPIs or invent dimensions.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "reports_analytics_agent_CRM_B2B"

for env_path in (ROOT / ".env", PACK / ".env", Path("/home/vectone/shiva/reportagent/.env")):
    if env_path.exists():
        load_dotenv(env_path)

from reports_analytics_agent_CRM_B2B.core.facts import assemble_facts  # noqa: E402
from reports_analytics_agent_CRM_B2B.core.grounding import apply_grounding  # noqa: E402
from reports_analytics_agent_CRM_B2B.core.prompt_load import load_agent_prompt  # noqa: E402
from reports_analytics_agent_CRM_B2B.core.run_kpi import run_kpi  # noqa: E402
from reports_analytics_agent_CRM_B2B.core.run_sql import run_sql  # noqa: E402
from reports_analytics_agent_CRM_B2B.core.time import resolve_expression  # noqa: E402
from reports_analytics_agent_CRM_B2B.kg_executor.core.models import AgentContext  # noqa: E402
from reports_analytics_agent_CRM_B2B.kg_executor.core.orchestrator import CRMB2BKGAgent  # noqa: E402

LLM_BASE = os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1")).rstrip("/")
LLM_MODEL = os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma"))

# LLM_BASE = "http://81.17.61.149:8066/v1"
# LLM_MODEL = "worktual-qwen-27B"

print("#####################")
print(LLM_MODEL)
print("#####################")

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
    """Read a tool call the SQL executor actually wrote. Do not fill missing fields."""
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


def _executor_user(task: dict[str, Any], start: str | None, end: str | None, *, time_echo: str, time_status: str) -> str:
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
        dim = task.get("dimension")
        dim_s = f' Copy task.dimension as dimension ({dim}).' if dim not in (None, "", "null") else (
            " If the goal is by sales rep/agent/owner, set dimension to owner."
        )
        tool_hint = (
            f'Call run_kpi with this exact kpi_id: {kpi}.{dim_s} '
            "Do not replace it with a neighbouring metric."
        )
    else:
        tool_hint = (
            "task.kpi is empty. Write one SELECT/WITH against the rpt.* view for the object in the goal "
            "(contacts for leads, quotes for quotes, deals only if the goal is deals). "
            "Do not copy a sample query."
        )
    return (
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


def _run_sql_task(
    task: dict[str, Any],
    *,
    sql_prompt: str,
    organization_id: int,
    user_id: int,
    role: str,
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
    user_msg = _executor_user(task, start, end, time_echo=echo, time_status=status)
    raw = call_llm([{"role": "system", "content": sql_prompt}, {"role": "user", "content": user_msg}])
    call = parse_executor(raw)
    if call.get("kind") == "run_kpi":
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
    if result.get("error_type") == "REPAIR":
        repair_user = (
            f"{user_msg}\n\nPrevious reply:\n{raw}\n\n"
            f"error_type: REPAIR\nerror: {result.get('error')}\n"
            "Reply again with one run_kpi JSON object or one SELECT/WITH statement."
        )
        repair_raw = call_llm(
            [{"role": "system", "content": sql_prompt}, {"role": "user", "content": repair_user}]
        )
        repair_call = parse_executor(repair_raw)
        if repair_call.get("kind") == "run_kpi":
            dim = repair_call.get("dimension") or task.get("dimension")
            if dim in (None, "", "null", "none"):
                dim = None
            if dim:
                repair_call["dimension"] = dim
            filt = _task_filters_sql(task)
            if filt:
                slots = dict(repair_call.get("slot_values") or {})
                slots["filters_sql"] = filt
                repair_call["slot_values"] = slots
        attempts.append({"raw": repair_raw, "call": {k: v for k, v in repair_call.items() if k != "raw"}})
        if repair_call["kind"] in {"none", "ambiguous"}:
            result["repair_error"] = "Repair reply had no tool call."
            result["attempts"] = attempts
            return result
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
) -> dict[str, Any]:
    query = (
        "Execute this Domain graph job with read-only Cypher or a certified template. "
        "Do not return unsupported_request when Contact, Deal, Quote, Invoice, or ContactActivity can answer the goal.\n"
        f"Domain task JSON:\n{json.dumps(task, default=str)}\n"
        f"Original question (names and context only): {question.strip()}"
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
    """Run SQL before KG when both exist; honor depends_on."""
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


def run_turn(
    question: str,
    *,
    organization_id: int,
    user_id: int,
    role: str,
) -> dict[str, Any]:
    domain_prompt = load_agent_prompt(PACK / "domain" / "agent.md")
    sql_prompt = load_agent_prompt(PACK / "sql_executor" / "agent.md")
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
            "Keep the same kpi and goal. Count questions stay on count KPIs."
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
                )
            except Exception as exc:
                result = {"status": "error", "error": str(exc), "error_type": "CALL_FAILED", "rows": []}
            result["task"] = task
            trace["tasks"].append(result)
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
                kg_block = f"{kg_block}\nkg_notes:\n{notes}"
            fact_blocks.append(kg_block)
            all_rows.extend(result.get("rows") or [])
            continue
        try:
            result = _run_sql_task(
                task,
                sql_prompt=sql_prompt,
                organization_id=organization_id,
                user_id=user_id,
                role=role,
            )
        except Exception as exc:
            result = {"status": "error", "error": str(exc), "error_type": "CALL_FAILED", "rows": []}
        result["task"] = task
        trace["tasks"].append(result)
        dim = result.get("dimension") or result.get("requested_dimension") or task.get("dimension")
        if dim in (None, "", "null"):
            dim = None
        fact_blocks.append(
            assemble_facts(
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
        )
        all_rows.extend(result.get("rows") or [])

    facts = "\n\n".join(fact_blocks)
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
        "If kg_notes exist, use them for the why. Zero is zero. "
        "Do not write 'you may want to review' unless a named row is unassigned, overdue, or $0."
    )
    synthesis_user = (
        f"Original Question: {question.strip()}\n"
        f"Identity: role={role}, org_id={organization_id}, user_id={user_id}\n"
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
