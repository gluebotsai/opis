"""Pass-through turn for the ticketing V2 pack.

Identity is only what the Streamlit sidebar supplies (org, user, role, and
optional queue ids). This module does not invent dimensions, status filters,
queue defaults, or org/user fallbacks.
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
PACK = ROOT / "reports_analytics_agent_ticketing_v2"

for env_path in (ROOT / ".env", PACK / ".env"):
    if env_path.exists():
        load_dotenv(env_path)

from reports_analytics_agent_ticketing_v2.core.context import (  # noqa: E402
    dimension_glossary_lines,
    kpi_index_lines,
    kg_schema_brief,
    rpt_column_book_lines,
)
from reports_analytics_agent_ticketing_v2.core.cypher_validate import load_product_edges  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.facts import assemble_facts  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.grounding import apply_grounding  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.loader import merge_effective  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.run_cypher import run_cypher  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.run_kpi import run_kpi  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.run_sql import run_sql  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.time import resolve_expression  # noqa: E402

LLM_BASE = os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1")).rstrip("/")
LLM_MODEL = os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma"))
DSN = os.getenv("DATABASE_URL", os.getenv("PG_DSN"))


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


def extract_cypher(text: str) -> str:
    parsed = extract_json(text)
    if isinstance(parsed.get("cypher"), str) and parsed["cypher"].strip():
        return parsed["cypher"].strip().rstrip(";")
    match = re.search(r"```(?:cypher)?\s*((?:MATCH|OPTIONAL MATCH)\b.*?)\s*```", text or "", re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip().rstrip(";")
    return ""


def parse_sql_executor(text: str) -> dict[str, Any]:
    parsed = extract_json(text)
    tool = str(parsed.get("tool") or parsed.get("action") or "").strip().lower()
    has_kpi = bool(parsed.get("kpi_id") or (tool in {"run_kpi", "kpi"} and parsed.get("kpi")))
    has_sql = isinstance(parsed.get("sql"), str) and parsed["sql"].strip()
    if has_kpi and has_sql and tool not in {"run_kpi", "kpi", "run_sql", "sql"}:
        return {"kind": "ambiguous", "raw": text}
    if tool in {"run_kpi", "kpi"} or (has_kpi and not has_sql):
        call: dict[str, Any] = {"kind": "run_kpi", "kpi_id": parsed.get("kpi_id") or parsed.get("kpi")}
        if parsed.get("dimension"):
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


def parse_kg_executor(text: str) -> dict[str, Any]:
    parsed = extract_json(text)
    if str(parsed.get("error_type") or "").upper() == "REPLAN":
        return {
            "kind": "replan",
            "error": str(parsed.get("error") or "graph path needs an entity id"),
        }
    tool = str(parsed.get("tool") or "").strip().lower()
    cypher = str(parsed.get("cypher") or extract_cypher(text)).strip().rstrip(";")
    params = parsed.get("params") if isinstance(parsed.get("params"), dict) else {}
    if tool in {"run_cypher", "cypher"} or cypher.upper().startswith("MATCH") or cypher.upper().startswith("OPTIONAL MATCH"):
        return {"kind": "run_cypher", "cypher": cypher, "params": params}
    return {"kind": "none", "raw": text}


def _time_bounds(expression: str | None) -> tuple[str | None, str | None, str, str]:
    bounds = resolve_expression(expression)
    start = bounds.start.isoformat() if bounds.start else None
    end = bounds.end.isoformat() if bounds.end else None
    status = "bounded" if start and end else "all_time"
    return start, end, bounds.echo, status


def queues_for_identity(
    *,
    organization_id: int,
    user_id: int,
    role: str,
    dsn: str | None = None,
) -> list[int]:
    """Load this caller's queues from Postgres. Never substitutes a canned list."""
    url = dsn or DSN
    if not url:
        return []
    try:
        import psycopg2

        with psycopg2.connect(url) as conn:
            with conn.cursor() as cur:
                if str(role).lower() == "admin":
                    cur.execute(
                        "SELECT id FROM ticketing.agent_queues WHERE organization_id = %s ORDER BY id",
                        (organization_id,),
                    )
                else:
                    cur.execute(
                        "SELECT queue_id FROM ticketing.agent_queue_members "
                        "WHERE organization_id = %s AND user_id = %s ORDER BY queue_id",
                        (organization_id, user_id),
                    )
                return [int(row[0]) for row in cur.fetchall()]
    except Exception:
        return []


def _executor_sql_user(
    task: dict[str, Any],
    start: str | None,
    end: str | None,
    *,
    time_echo: str,
    time_status: str,
    column_book: str,
) -> str:
    if start and end:
        time_ctx = (
            f"time_status: {time_status}\nperiod_applied: {time_echo}\n"
            f"time_params: start={start}, end={end}\nparams_available: :start, :end"
        )
    else:
        time_ctx = (
            f"time_status: {time_status}\nperiod_applied: {time_echo}\n"
            "time_params: overall / all-time (no date filter)"
        )
    kpi = task.get("kpi")
    kpi_set = kpi not in (None, "", "null")
    dim = task.get("dimension")
    if kpi_set:
        dim_s = f' Copy task.dimension as dimension ({dim}).' if dim not in (None, "", "null") else ""
        tool_hint = f'Call run_kpi with this exact kpi_id: {kpi}.{dim_s}'
    else:
        tool_hint = (
            "task.kpi is empty. Write one SELECT/WITH against rpt.* for the object in the goal. "
            "GROUP BY the column whose description matches the requested slice. Lists LIMIT 50."
        )
    return (
        "Task JSON:\n"
        f"{json.dumps(task, default=str)}\n\n"
        f"{time_ctx}\n\n"
        f"## rpt column book\n{column_book}\n\n"
        f"{tool_hint}\n"
        "Reply with exactly one JSON tool call: run_kpi or run_sql."
    )


def _executor_kg_user(
    task: dict[str, Any],
    *,
    start: str | None,
    end: str | None,
    time_echo: str,
    schema: str,
    examples: str,
) -> str:
    return (
        "Task JSON:\n"
        f"{json.dumps(task, default=str)}\n\n"
        f"period_applied: {time_echo}\n"
        f"time_params: start={start}, end={end}\n\n"
        f"## Schema\n{schema}\n\n"
        f"## Examples\n{examples}\n\n"
        "Reply with exactly one JSON object: "
        '{"tool":"run_cypher","cypher":"MATCH ...","params":{}}'
    )


def _execute_sql_call(
    call: dict[str, Any],
    *,
    organization_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int],
    scope_level: str | None,
    start: str | None,
    end: str | None,
    task: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task = task or {}
    if call["kind"] == "run_kpi":
        kwargs: dict[str, Any] = {
            "kpi_id": call.get("kpi_id"),
            "organization_id": organization_id,
            "user_id": user_id,
            "role": role,
            "queue_ids": queue_ids,
            "time_start": start,
            "time_end": end,
            "dsn": DSN,
        }
        if scope_level:
            kwargs["scope_level"] = scope_level
        kpi_id = str(call.get("kpi_id") or task.get("kpi") or "")
        audience = str(task.get("audience") or "").strip().lower()
        goal = str(task.get("goal") or "").lower()
        org_wide = audience in {"org", "all_users", "everyone", "org-wide"} or "org-wide" in goal
        if kpi_id == "unread_notifications" and not org_wide:
            kwargs["scope_level"] = "own"
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
        queue_ids=queue_ids,
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
    queue_ids: list[int],
    column_book: str,
) -> dict[str, Any]:
    start, end, echo, status = _time_bounds(task.get("time"))
    scope = task.get("scope")
    scope_level = str(scope) if scope else None
    user_msg = _executor_sql_user(
        task, start, end, time_echo=echo, time_status=status, column_book=column_book
    )
    raw = call_llm([{"role": "system", "content": sql_prompt}, {"role": "user", "content": user_msg}])
    call = parse_sql_executor(raw)
    if call.get("kind") == "run_kpi":
        dim = call.get("dimension") or task.get("dimension")
        if dim not in (None, "", "null", "none"):
            call["dimension"] = dim
    attempts = [{"raw": raw, "call": {k: v for k, v in call.items() if k != "raw"}}]
    if call["kind"] in {"none", "ambiguous"}:
        return {
            "status": "error",
            "error_type": "NO_TOOL",
            "error": "SQL executor did not return run_kpi or run_sql.",
            "raw": raw,
            "attempts": attempts,
            "time_echo": echo,
            "rows": [],
            "sql": "",
        }
    result = _execute_sql_call(
        call,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        queue_ids=queue_ids,
        scope_level=scope_level,
        start=start,
        end=end,
        task=task,
    )
    result["attempts"] = attempts
    result["time_echo"] = echo
    result["time_status"] = status
    result["tool"] = call["kind"]
    if call["kind"] == "run_kpi":
        result["requested_kpi"] = call.get("kpi_id")
        result["requested_dimension"] = call.get("dimension")
    if result.get("error_type") == "REPAIR":
        repair_user = (
            f"{user_msg}\n\nPrevious reply:\n{raw}\n\n"
            f"error_type: REPAIR\nerror: {result.get('error')}\n"
            "Reply again with one run_kpi or run_sql JSON object."
        )
        repair_raw = call_llm(
            [{"role": "system", "content": sql_prompt}, {"role": "user", "content": repair_user}]
        )
        repair_call = parse_sql_executor(repair_raw)
        if repair_call.get("kind") == "run_kpi":
            dim = repair_call.get("dimension") or task.get("dimension")
            if dim not in (None, "", "null", "none"):
                repair_call["dimension"] = dim
        attempts.append({"raw": repair_raw, "call": {k: v for k, v in repair_call.items() if k != "raw"}})
        if repair_call["kind"] in {"none", "ambiguous"}:
            result["repair_error"] = "Repair reply had no tool call."
            result["attempts"] = attempts
            return result
        repaired = _execute_sql_call(
            repair_call,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            queue_ids=queue_ids,
            scope_level=scope_level,
            start=start,
            end=end,
            task=task,
        )
        repaired["attempts"] = attempts
        repaired["time_echo"] = echo
        repaired["time_status"] = status
        repaired["tool"] = repair_call["kind"]
        repaired["repaired"] = True
        if repair_call["kind"] == "run_kpi":
            repaired["requested_kpi"] = repair_call.get("kpi_id")
            repaired["requested_dimension"] = repair_call.get("dimension")
        return repaired
    return result


def _run_kg_task(
    task: dict[str, Any],
    *,
    kg_prompt: str,
    schema: str,
    examples: str,
    organization_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int],
) -> dict[str, Any]:
    start, end, echo, status = _time_bounds(task.get("time"))
    user_msg = _executor_kg_user(task, start=start, end=end, time_echo=echo, schema=schema, examples=examples)
    raw = call_llm([{"role": "system", "content": kg_prompt}, {"role": "user", "content": user_msg}])
    call = parse_kg_executor(raw)
    attempts = [{"raw": raw, "call": {k: v for k, v in call.items() if k != "raw"}}]
    if call.get("kind") == "replan":
        return {
            "status": "error",
            "error_type": "REPLAN",
            "error": call.get("error") or "graph path needs a ticket_number, queue_name, or person name.",
            "raw": raw,
            "attempts": attempts,
            "time_echo": echo,
            "rows": [],
            "tool": "run_cypher",
        }
    if call["kind"] != "run_cypher" or not call.get("cypher"):
        return {
            "status": "error",
            "error_type": "NO_TOOL",
            "error": "KG executor did not return run_cypher JSON.",
            "raw": raw,
            "attempts": attempts,
            "time_echo": echo,
            "rows": [],
            "sql": "",
            "tool": "kg",
        }
    params = dict(call.get("params") or {})
    if start and end:
        params.setdefault("start", start)
        params.setdefault("end", end)
    result = run_cypher(
        call["cypher"],
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        queue_ids=queue_ids,
        params=params,
        execute=True,
    )
    if result.get("error_type") == "REPAIR":
        repair_user = (
            f"{user_msg}\n\nPrevious reply:\n{raw}\n\n"
            f"error_type: REPAIR\nerror: {result.get('error')}\n"
            "Reply again with one run_cypher JSON object."
        )
        repair_raw = call_llm(
            [{"role": "system", "content": kg_prompt}, {"role": "user", "content": repair_user}]
        )
        repair_call = parse_kg_executor(repair_raw)
        attempts.append({"raw": repair_raw, "call": {k: v for k, v in repair_call.items() if k != "raw"}})
        if repair_call.get("cypher"):
            rparams = dict(repair_call.get("params") or {})
            if start and end:
                rparams.setdefault("start", start)
                rparams.setdefault("end", end)
            result = run_cypher(
                repair_call["cypher"],
                organization_id=organization_id,
                user_id=user_id,
                role=role,
                queue_ids=queue_ids,
                params=rparams,
                execute=True,
            )
            result["repaired"] = True
    result["attempts"] = attempts
    result["time_echo"] = echo
    result["time_status"] = status
    result["tool"] = "run_cypher"
    result["sql"] = result.get("cypher") or call.get("cypher") or ""
    return result


def run_turn(
    question: str,
    *,
    organization_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int] | None = None,
) -> dict[str, Any]:
    if organization_id is None or user_id is None or not str(role or "").strip():
        return {
            "answer": "Set organization id, user id, and role in this sidebar. The ticketing pack will not use a built-in default identity.",
            "trace": {"domain_error": "identity_required"},
            "rows": [],
        }
    queues = list(queue_ids) if queue_ids is not None else queues_for_identity(
        organization_id=int(organization_id),
        user_id=int(user_id),
        role=str(role),
        dsn=DSN,
    )
    domain_prompt = (PACK / "domain" / "agent.md").read_text()
    sql_prompt = (PACK / "sql_executor" / "agent.md").read_text()
    kg_prompt = (PACK / "kg_executor" / "agent.md").read_text()
    catalog = merge_effective(organization_id)
    kpi_index = kpi_index_lines(catalog.get("kpis") or {})
    dim_glossary = dimension_glossary_lines()
    column_book = rpt_column_book_lines()
    schema = kg_schema_brief(catalog.get("kg_schema") or {}, edges=load_product_edges())
    examples_path = PACK / "product" / "kg" / "examples" / "cypher.yml"
    examples = examples_path.read_text()[:6000] if examples_path.exists() else ""
    domain_user = (
        f"Identity: role={role}, org_id={organization_id}, user_id={user_id}, queues={queues}\n"
        f"Question: {question.strip()}\n\n"
        f"## KPI meaning index\n{kpi_index}\n\n"
        f"## Dimension glossary\n{dim_glossary}\n"
        "Choose the KPI by what the user wants measured, then the dimension id from the glossary. "
        "Copy the user's time words. Do not invent KPI ids."
    )
    trace: dict[str, Any] = {
        "question": question.strip(),
        "identity": {
            "organization_id": int(organization_id),
            "user_id": int(user_id),
            "role": str(role),
            "queue_ids": queues,
        },
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

    fact_blocks: list[str] = []
    all_rows: list[dict[str, Any]] = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        executor = str(task.get("executor") or "sql").lower()
        if executor == "kg":
            try:
                result = _run_kg_task(
                    task,
                    kg_prompt=kg_prompt,
                    schema=schema,
                    examples=examples,
                    organization_id=int(organization_id),
                    user_id=int(user_id),
                    role=str(role),
                    queue_ids=queues,
                )
            except Exception as exc:
                result = {"status": "error", "error": str(exc), "error_type": "CALL_FAILED", "rows": []}
        else:
            try:
                result = _run_sql_task(
                    task,
                    sql_prompt=sql_prompt,
                    organization_id=int(organization_id),
                    user_id=int(user_id),
                    role=str(role),
                    queue_ids=queues,
                    column_book=column_book,
                )
            except Exception as exc:
                result = {"status": "error", "error": str(exc), "error_type": "CALL_FAILED", "rows": []}
        result["task"] = task
        trace["tasks"].append(result)
        dim = result.get("requested_dimension") or task.get("dimension")
        fact_blocks.append(
            assemble_facts(
                result,
                task_goal=str(task.get("goal") or ""),
                kpi_id=result.get("kpi_id") or task.get("kpi"),
                group_by=[str(dim)] if dim not in (None, "", "null") else None,
                answer_type=str(task.get("answer_type") or ""),
                time_echo=str(result.get("time_echo") or ""),
            )
        )
        all_rows.extend(result.get("rows") or [])

    facts = "\n\n".join(fact_blocks)
    trace["facts"] = facts
    synthesis_user = (
        f"Original Question: {question.strip()}\n"
        f"Identity: role={role}, org_id={organization_id}, user_id={user_id}\n"
        f"Facts gathered:\n{facts}\n\n"
        "Write the executive briefing from these facts only. Do not invent numbers. "
        "Match the fact grain: a breakdown is a table of groups, not a single total; "
        "list_not_a_total / row_cap_hit means a sample of rows, not a population count. "
        "Rates use display_percent (one decimal). No RESULT: jargon."
    )
    try:
        briefing = call_llm(
            [
                {"role": "system", "content": domain_prompt},
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
                {"role": "system", "content": domain_prompt},
                {
                    "role": "user",
                    "content": (
                        f"{synthesis_user}\n\nPrevious answer:\n{previous}\n\n"
                        "These figures were not in the facts: "
                        + ", ".join(str(n) for n in ungrounded)
                        + "\nRewrite using only numbers present in the facts."
                    ),
                },
            ],
            temperature=0.2,
        )

    try:
        answer, grounded = apply_grounding(briefing, facts, _regen)
    except Exception as exc:
        answer, grounded = briefing, False
        trace["grounding_error"] = str(exc)
    trace["grounded"] = grounded
    trace["briefing_raw"] = briefing
    return {"answer": answer, "trace": trace, "rows": all_rows}
