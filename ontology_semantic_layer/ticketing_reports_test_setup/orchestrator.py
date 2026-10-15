"""Domain Gemma → execute_frame / execute_graph → executor Gemma."""

from __future__ import annotations

import traceback
from dataclasses import asdict
from typing import Any, Callable

from reports_analytics_agent_ticketing.core.access import AccessDenied
from reports_analytics_agent_ticketing.core.context import (
    access_index_lines,
    entity_index_lines,
    graph_index_lines,
    kpi_index_lines,
)
from reports_analytics_agent_ticketing.core.errors import (
    AmbiguousName,
    UnmatchedName,
    public_message,
    repair_prompt,
)
from reports_analytics_agent_ticketing.core.kg_client import apply_runtime
from reports_analytics_agent_ticketing.core.loader import PACK_ROOT, merge_effective
from reports_analytics_agent_ticketing.core.query_frame import (
    Identity,
    QueryFrame,
    frame_from_dict,
    jsonish,
)
from reports_analytics_agent_ticketing.core.present import choose_answer, kg_llm_user_payload, present_job
from reports_analytics_agent_ticketing.core.run_analytics import execute_frame
from reports_analytics_agent_ticketing.core.run_graph import execute_graph
from reports_analytics_agent_ticketing.core.time import utc_now

from llm import GemmaError, complete_json, complete_text

DOMAIN_MD = PACK_ROOT / "domain" / "agent.md"
SQL_MD = PACK_ROOT / "sql_executor" / "agent.md"
KG_MD = PACK_ROOT / "kg_executor" / "agent.md"
HISTORY_CAP = 24

def _without_echo(text: str) -> str:
    marker = "**Echo:**"
    if marker in text:
        return text.split(marker, 1)[0].strip()
    return text.strip()


def _json(obj: Any) -> str:
    import json

    return json.dumps(obj, default=str, ensure_ascii=False, indent=2)


def _frame_dict(frame: QueryFrame) -> dict[str, Any]:
    return asdict(frame)


def _trim(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    chat = [m for m in messages if m.get("role") in {"user", "assistant"}]
    return chat[-HISTORY_CAP:]


def _ok(
    *,
    answer: str,
    plan: dict[str, Any],
    tools: list[dict[str, Any]],
    compiled: list[dict[str, Any]] | None = None,
    previous_frame: dict[str, Any] | None = None,
    echo: str = "",
    executor: str = "",
    llm_messages: list[dict[str, str]] | None = None,
    error: str | None = None,
    traceback_text: str | None = None,
) -> dict[str, Any]:
    return {
        "answer": answer,
        "plan": plan,
        "tools": tools,
        "compiled": compiled or [],
        "previous_frame": previous_frame,
        "echo": echo,
        "executor": executor,
        "llm_messages": llm_messages or [],
        "error": error,
        "traceback": traceback_text,
    }


def domain_system(identity: Identity) -> str:
    catalog = merge_effective(identity.organization_id)
    now = utc_now()
    today = now.date().isoformat()
    return "\n\n".join(
        [
            DOMAIN_MD.read_text(),
            "identity:\n"
            + _json(
                {
                    "organization_id": identity.organization_id,
                    "user_id": identity.user_id,
                    "role": identity.role,
                    "my_queue_ids": identity.my_queue_ids,
                }
            ),
            "access_index:\n" + access_index_lines(catalog["access"], identity.role),
            "kpi_index:\n" + kpi_index_lines(catalog["kpis"]),
            "graph_index:\n" + graph_index_lines(catalog["kg_measures"], catalog.get("kg_concepts")),
            "entity_index:\n" + entity_index_lines(catalog["catalog"]),
            (
                f"clock:\nutc_now: {now.isoformat()}\nutc_today: {today}\n"
                "Relative dates (yesterday, day before yesterday, last N days, Sep 22 without a year) "
                "must use this clock. Sep 22 means utc_today's year unless the user said another year. "
                "Assigned-to a person is filters field agent, not org scope target_mention. "
                "Conversation memory is the prior user and assistant messages. "
                "JSON only. frame.time.start and frame.time.end are ISO UTC. "
                "kind=chat with reply when there is no report. kind=plan with steps otherwise. "
                "Do not write SQL or Cypher."
            ),
        ]
    )


def _usable_steps(steps: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for step in steps:
        doc = jsonish(step)
        match doc:
            case dict():
                frame = jsonish(doc.get("frame"))
            case _:
                continue
        match frame:
            case dict() as payload:
                out.append({**doc, "frame": payload})
            case _:
                continue
    return out


def parse_plan(payload: dict[str, Any]) -> tuple[str, str, list[dict[str, Any]]]:
    reply = str(payload.get("reply") or payload.get("answer") or "")
    raw_steps = jsonish(payload.get("steps"))
    match raw_steps:
        case list() as items:
            steps_in = items
        case _:
            steps_in = []
    match (payload.get("frame"), steps_in):
        case (frame, []) if frame is not None:
            steps_in = [
                {
                    "executor": payload.get("executor") or "sql",
                    "brief": payload.get("brief") or "",
                    "frame": frame,
                }
            ]
        case _:
            pass
    steps = _usable_steps(steps_in)
    return ("plan", reply, steps) if steps else ("chat", reply, [])


def _chat_fallback(history: list[dict[str, str]], timeout: float) -> str:
    try:
        return complete_text(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a helpful ticketing reports assistant. "
                        "Answer the user from conversation memory. Do not invent numbers."
                    ),
                }
            ]
            + history,
            timeout=timeout,
        )
    except GemmaError:
        return "Ask a ticketing report question when you are ready."


def _run_kg(frame: QueryFrame, identity: Identity, *, database_url: str, neo4j_uri: str) -> dict[str, Any]:
    fetch_fn = None
    if database_url:
        from reports_analytics_agent_ticketing.core.db import fetchall as pg_fetchall

        fetch_fn = lambda sql, params: pg_fetchall(database_url, sql, params)
    job = execute_graph(
        frame,
        identity,
        fetch=fetch_fn,
        execute=bool((neo4j_uri or "").strip()),
    )
    return {
        "executor": "kg",
        "store": "kg",
        "system_md": KG_MD.read_text(),
        "status": job.get("status"),
        "cypher": job.get("cypher"),
        "params": job.get("params"),
        "echo": job.get("echo"),
        "rows": job.get("rows") or [],
        "error": job.get("error"),
        "threshold_level": None,
    }


def _run_sql(frame: QueryFrame, identity: Identity, *, database_url: str, neo4j_uri: str) -> dict[str, Any]:
    if not database_url:
        raise RuntimeError("DATABASE_URL is empty, so I cannot run SQL yet.")
    job = execute_frame(frame, identity, dsn=database_url, run=True)
    return {
        "executor": "sql",
        "store": "sql",
        "system_md": SQL_MD.read_text(),
        "status": job.get("status"),
        "sql": job.get("sql"),
        "echo": job.get("echo"),
        "rows": job.get("rows") or [],
        "error": job.get("error"),
        "threshold_level": job.get("threshold_level"),
    }


def _connections(
    identity: Identity,
    *,
    database_url: str,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
) -> dict[str, Any]:
    return {
        "organization_id": identity.organization_id,
        "user_id": identity.user_id,
        "role": identity.role,
        "database_url": database_url,
        "neo4j_uri": neo4j_uri,
        "neo4j_user": neo4j_user,
        "neo4j_password": neo4j_password,
    }


STORE: dict[str, Callable[..., dict[str, Any]]] = {
    "kg": _run_kg,
    "sql": _run_sql,
}


def run_turn(
    identity: Identity,
    *,
    conversation: list[dict[str, str]],
    database_url: str,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    previous_frame: dict[str, Any] | None,
    llm_timeout: float = 90.0,
) -> dict[str, Any]:
    tools: list[dict[str, Any]] = []
    history = _trim(conversation)
    try:
        domain_messages = [{"role": "system", "content": domain_system(identity)}] + history
    except Exception as exc:
        return _ok(
            answer=f"Catalog failed to load: {exc}",
            plan={"kind": "chat", "steps": []},
            tools=[{"tool": "catalog", "error": str(exc)}],
            previous_frame=previous_frame,
            llm_messages=history,
            error=str(exc),
            traceback_text=traceback.format_exc(),
        )
    if previous_frame:
        domain_messages.insert(
            1,
            {"role": "system", "content": "previous_frame:\n" + _json(previous_frame)},
        )

    tools.append({"tool": "domain_gemma", "messages": domain_messages, "status": "called"})
    try:
        plan_raw = complete_json(messages=domain_messages, timeout=llm_timeout)
    except GemmaError as exc:
        tools.append({"tool": "domain_llm_failed", "error": str(exc)})
        return _ok(
            answer=_chat_fallback(history, llm_timeout),
            plan={"kind": "chat", "steps": []},
            tools=tools,
            previous_frame=previous_frame,
            llm_messages=domain_messages,
            error=str(exc),
            traceback_text=traceback.format_exc(),
        )

    tools.append({"tool": "domain_plan", "payload": plan_raw})
    kind, chat_reply, steps = parse_plan(plan_raw)
    if kind == "chat":
        return _ok(
            answer=chat_reply or _chat_fallback(history, llm_timeout),
            plan=plan_raw,
            tools=tools,
            previous_frame=previous_frame,
            llm_messages=domain_messages,
        )

    answers: list[str] = []
    last_frame: dict[str, Any] | None = previous_frame
    last_echo = ""
    last_executor = ""
    compiled: list[dict[str, Any]] = []
    last_llm_messages = domain_messages
    apply_runtime(neo4j_uri or None, neo4j_user or None, neo4j_password)

    for raw_step in steps[:4]:
        executor = str(raw_step.get("executor") or "sql").lower()
        brief = str(raw_step.get("brief") or "")
        try:
            frame = frame_from_dict(raw_step.get("frame") or {})
        except Exception as exc:
            answers.append(f"I could not read that plan step: {exc}")
            tools.append({"tool": "bad_frame", "error": str(exc), "traceback": traceback.format_exc()})
            continue
        last_frame = _frame_dict(frame)
        last_executor = executor
        runner = STORE.get(executor, _run_sql)
        try:
            job = runner(frame, identity, database_url=database_url, neo4j_uri=neo4j_uri)
        except UnmatchedName as exc:
            msg = public_message(exc)
            tools.append({"tool": "unmatched_name", "message": msg})
            answers.append(msg)
            continue
        except AmbiguousName as exc:
            msg = public_message(exc)
            tools.append({"tool": "ambiguous_name", "message": msg})
            answers.append(msg)
            continue
        except AccessDenied as exc:
            msg = public_message(exc)
            tools.append({"tool": "access_denied", "message": msg})
            answers.append(msg)
            continue
        except Exception as exc:
            job = {
                "executor": executor,
                "system_md": SQL_MD.read_text() if executor != "kg" else KG_MD.read_text(),
                "status": "error",
                "error": public_message(exc),
                "rows": [],
            }
            tools.append({"tool": "step_error", "error": job["error"], "traceback": traceback.format_exc()})

        if job.get("error"):
            repair_messages = domain_messages + [
                {
                    "role": "user",
                    "content": repair_prompt(error=str(job.get("error")), frame=last_frame, brief=brief),
                }
            ]
            tools.append({"tool": "domain_repair", "messages": repair_messages, "status": "called"})
            try:
                repaired = complete_json(messages=repair_messages, timeout=llm_timeout)
                tools.append({"tool": "domain_repair_plan", "payload": repaired})
                _, _, repair_steps = parse_plan(repaired)
            except GemmaError as exc:
                tools.append({"tool": "domain_repair_failed", "error": str(exc)})
                repair_steps = []
            if repair_steps:
                raw_step = repair_steps[0]
                executor = str(raw_step.get("executor") or executor).lower()
                brief = str(raw_step.get("brief") or brief)
                try:
                    frame = frame_from_dict(raw_step.get("frame") or {})
                    last_frame = _frame_dict(frame)
                    last_executor = executor
                    runner = STORE.get(executor, _run_sql)
                    job = runner(frame, identity, database_url=database_url, neo4j_uri=neo4j_uri)
                except (UnmatchedName, AmbiguousName, AccessDenied) as exc:
                    msg = public_message(exc)
                    tools.append({"tool": "repair_named", "message": msg})
                    answers.append(msg)
                    continue
                except Exception as exc:
                    answers.append(public_message(exc))
                    tools.append({"tool": "repair_error", "error": public_message(exc)})
                    continue
            if job.get("error"):
                answers.append(str(job.get("error")))
                compiled.append(
                    {
                        "executor": job.get("executor", executor),
                        "sql": job.get("sql"),
                        "cypher": job.get("cypher"),
                        "params": job.get("params"),
                        "rows": job.get("rows") or [],
                        "error": job.get("error"),
                    }
                )
                continue

        compiled.append(
            {
                "executor": job["executor"],
                "sql": job.get("sql"),
                "cypher": job.get("cypher"),
                "params": job.get("params"),
                "rows": job.get("rows") or [],
                "error": job.get("error"),
                "threshold_level": job.get("threshold_level"),
            }
        )
        tools.append(
            {
                "tool": f"execute_{job['executor']}",
                "status": job.get("status"),
                "error": job.get("error"),
                "frame": last_frame,
                "sql": job.get("sql"),
                "cypher": job.get("cypher"),
                "params": job.get("params"),
                "rows": job.get("rows") or [],
                **_connections(
                    identity,
                    database_url=database_url,
                    neo4j_uri=neo4j_uri,
                    neo4j_user=neo4j_user,
                    neo4j_password=neo4j_password,
                ),
            }
        )

        if job.get("executor") == "kg" and not job.get("error"):
            facts = present_job(job, frame, brief=brief)
            exec_messages = (
                [{"role": "system", "content": job["system_md"]}]
                + history
                + [
                    {
                        "role": "user",
                        "content": _json(
                            kg_llm_user_payload(
                                brief=brief,
                                frame=frame,
                                facts=facts,
                                rows=list(job.get("rows") or []),
                            )
                        ),
                    }
                ]
            )
            last_llm_messages = exec_messages
            tools.append({"tool": "kg_gemma", "status": "called", "messages": exec_messages})
            try:
                spoken = complete_text(messages=exec_messages, timeout=llm_timeout)
            except GemmaError as exc:
                tools.append({"tool": "kg_gemma_failed", "error": str(exc)})
                spoken = ""
            answers.append(choose_answer(spoken, job, frame, brief=brief))
        else:
            answers.append(present_job(job, frame, brief=brief))

    return _ok(
        answer="\n\n".join(a for a in answers if a) or "No report steps ran.",
        plan=plan_raw,
        tools=tools,
        compiled=compiled,
        previous_frame=last_frame,
        echo=last_echo,
        executor=last_executor,
        llm_messages=last_llm_messages,
    )
