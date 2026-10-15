"""Domain SQL specialist. One skill per path. No Domain briefing."""

from __future__ import annotations

import json
from typing import Any, Callable

from ..access import AccessDenied, assert_scope_allowed, normalize_role, normalize_scope_level
from ..context import EXECUTOR_PROMPT, SKILL_METRICS, SKILL_VIEWS, executor_user_payload, load_skill
from ..facts import assemble_facts
from ..loader import merge_effective
from ..loop import LoopState
from ..time import TimeBounds, TimeSpec, resolve_time
from .run_kpi import run_kpi
from .run_sql import run_sql

CallLLM = Callable[[list[dict[str, str]], float, int], str]

_TASK_KEYS = ("id", "goal", "time", "scope", "slice", "answer_type", "path")


def extract_json(text: str) -> dict[str, Any]:
    clean = (text or "").strip()
    if "{" in clean and "}" in clean:
        clean = clean[clean.find("{") : clean.rfind("}") + 1]
    try:
        parsed = json.loads(clean)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _clean_task(task: dict[str, Any]) -> dict[str, Any]:
    slice_raw = task.get("slice") or task.get("dimensions") or []
    if isinstance(slice_raw, str):
        slice_raw = [slice_raw] if slice_raw.strip() else []
    return {
        "id": task.get("id"),
        "goal": str(task.get("goal") or "").strip(),
        "time": task.get("time"),
        "scope": task.get("scope"),
        "slice": [str(s) for s in slice_raw if s],
        "answer_type": task.get("answer_type") or "",
        "path": task.get("path"),
    }


def _task_path(task: dict[str, Any], answer_type: str = "") -> str:
    raw = str(task.get("path") or "").strip().lower()
    if raw in {"free_sql", "list", "catalog", "sql", "views"}:
        return "free_sql"
    if raw in {"certified_metric", "metric", "kpi", "certified"}:
        return "certified_metric"
    answer = str(task.get("answer_type") or answer_type or "").strip().lower()
    if answer in {"list", "roster"}:
        return "free_sql"
    return "certified_metric"


def _llm(call_llm: CallLLM | None) -> CallLLM:
    if call_llm is not None:
        return call_llm
    from ..llm import call_llm as default_llm

    return default_llm


def _invoke(
    call_llm: CallLLM,
    path: str,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    skill = SKILL_METRICS if path == "certified_metric" else SKILL_VIEWS
    raw = call_llm(
        [
            {"role": "system", "content": load_skill(EXECUTOR_PROMPT) + "\n\n" + load_skill(skill)},
            {"role": "user", "content": json.dumps(payload, default=str)},
        ],
        0.0,
        900,
    )
    return extract_json(raw), raw


def _deny_result(message: str) -> dict[str, Any]:
    return {
        "status": "error",
        "store": "sql",
        "error_type": "DENY",
        "error": message,
        "certified": False,
        "rows": [],
    }


def execute_sql_task(
    task: dict[str, Any],
    *,
    organization_id: int,
    user_id: int,
    role: str,
    dsn: str,
    queue_ids: list[int] | None = None,
    call_llm: CallLLM | None = None,
) -> dict[str, Any]:
    """Domain handoff. Task has path, goal, time words, scope words, slice words. No KPI id."""
    task = dict(task or {})
    task.pop("kpi", None)
    task.pop("kpi_id", None)
    task.pop("sql", None)
    clean = _clean_task(task)
    path = _task_path(clean, str(clean.get("answer_type") or ""))
    clean["path"] = path

    catalog = merge_effective(organization_id)
    access = catalog["access"]
    role = normalize_role(role, access)
    scope_level = normalize_scope_level(str(clean.get("scope") or ""), role, access)
    queue_ids = list(queue_ids or [])
    try:
        assert_scope_allowed(role, scope_level, access)
        if scope_level == "queue" and not queue_ids:
            raise AccessDenied("scope_denied: queue scope requires queue_ids from the UI.")
    except AccessDenied as exc:
        result = _deny_result(str(exc))
        result["facts"] = assemble_facts(result, task_goal=clean.get("goal") or "")
        result["loop"] = None
        return result

    time_words = str(clean.get("time") or "") or None
    if time_words and time_words.strip():
        try:
            bounds = resolve_time(TimeSpec(expression=time_words))
        except ValueError as exc:
            result = {
                "status": "error",
                "error_type": "REPLAN",
                "error": str(exc),
                "rows": [],
            }
            result["facts"] = assemble_facts(result, task_goal=clean.get("goal") or "")
            return result
    else:
        bounds = TimeBounds(None, None, "")

    llm = _llm(call_llm)
    loop = LoopState()
    result = _run_skill_path(
        path=path,
        clean=clean,
        bounds=bounds,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        dsn=dsn,
        queue_ids=queue_ids,
        scope_level=scope_level,
        call_llm=llm,
        loop=loop,
        repair="",
        certified_override=None,
    )
    if (
        result.get("status") == "error"
        and result.get("error_type") == "REPAIR"
        and loop.should_retry(result) == "REPAIR"
    ):
        result = _run_skill_path(
            path=path,
            clean=clean,
            bounds=bounds,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            dsn=dsn,
            queue_ids=queue_ids,
            scope_level=scope_level,
            call_llm=llm,
            loop=loop,
            repair=str(result.get("error") or ""),
            certified_override=result.get("certified"),
        )
        if result.get("status") == "error" and result.get("error_type") != "DENY":
            result["error_type"] = "REPLAN"

    facts = assemble_facts(
        result,
        task_goal=str(clean.get("goal") or ""),
        kpi_id=result.get("kpi_id"),
        answer_type=str(clean.get("answer_type") or ""),
        time_echo=bounds.echo or result.get("time_echo") or "",
    )
    result["facts"] = facts
    if result.get("status") == "error":
        loop.record_error(result)
        result["loop"] = loop.should_retry(result)
    else:
        result["loop"] = None
    return result


def _run_skill_path(
    *,
    path: str,
    clean: dict[str, Any],
    bounds: TimeBounds,
    organization_id: int,
    user_id: int,
    role: str,
    dsn: str,
    queue_ids: list[int],
    scope_level: str,
    call_llm: CallLLM,
    loop: LoopState,
    repair: str,
    certified_override: bool | None,
) -> dict[str, Any]:
    loop.record_attempt()
    payload = executor_user_payload(
        task=clean,
        role=role,
        path=path,
        time_echo=bounds.echo,
        start=bounds.start.isoformat() if bounds.start else None,
        end=bounds.end.isoformat() if bounds.end else None,
        organization_id=organization_id,
        user_id=user_id,
        dsn=dsn,
        repair=repair,
    )
    try:
        tool, raw = _invoke(call_llm, path, payload)
    except Exception as exc:
        return {
            "status": "error",
            "error_type": "REPLAN",
            "error": str(exc),
            "raw": "",
            "rows": [],
        }
    name = str(tool.get("tool") or "").strip().lower()

    if name == "clarify":
        return {
            "status": "clarify",
            "question": tool.get("question"),
            "raw": raw,
            "certified": False,
            "rows": [],
        }

    if name == "unavailable":
        reason = str(tool.get("reason") or "That measure is not in Contact Center reports.")
        return {
            "status": "unavailable",
            "unavailable": True,
            "reason": reason,
            "error": reason,
            "raw": raw,
            "certified": False,
            "rows": [],
        }

    if name == "needs_free_sql":
        if path != "certified_metric":
            return {
                "status": "error",
                "error_type": "REPAIR",
                "error": "needs_free_sql is only valid on the certified_metric skill.",
                "raw": raw,
                "rows": [],
            }
        reason = str(tool.get("reason") or "card cannot express this slice or filter")
        follow = dict(clean)
        follow["path"] = "free_sql"
        follow["goal"] = f"{clean.get('goal') or ''} ({reason})".strip()
        inner_loop = LoopState()
        result = _run_skill_path(
            path="free_sql",
            clean=follow,
            bounds=bounds,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            dsn=dsn,
            queue_ids=queue_ids,
            scope_level=scope_level,
            call_llm=call_llm,
            loop=inner_loop,
            repair="",
            certified_override=False,
        )
        if (
            result.get("status") == "error"
            and result.get("error_type") == "REPAIR"
            and inner_loop.should_retry(result) == "REPAIR"
        ):
            result = _run_skill_path(
                path="free_sql",
                clean=follow,
                bounds=bounds,
                organization_id=organization_id,
                user_id=user_id,
                role=role,
                dsn=dsn,
                queue_ids=queue_ids,
                scope_level=scope_level,
                call_llm=call_llm,
                loop=inner_loop,
                repair=str(result.get("error") or ""),
                certified_override=False,
            )
            if result.get("status") == "error" and result.get("error_type") != "DENY":
                result["error_type"] = "REPLAN"
        result["certified"] = False
        result["needs_free_sql_reason"] = reason
        return result

    if path == "certified_metric":
        if name != "run_kpi":
            return {
                "status": "error",
                "error_type": "REPAIR",
                "error": "This task is a certified metric. Return run_kpi, clarify, needs_free_sql, or unavailable.",
                "raw": raw,
                "rows": [],
            }
        kpi = str(tool.get("kpi") or tool.get("kpi_id") or "").strip()
        if not kpi:
            return {
                "status": "error",
                "error_type": "REPAIR",
                "error": "run_kpi needs a kpi id from the metric cards.",
                "raw": raw,
                "rows": [],
            }
        dims = [str(d) for d in (tool.get("dimensions") or []) if d]
        for word in clean.get("slice") or []:
            text = str(word).strip()
            if text and text not in dims:
                dims.append(text)
        filters = tool.get("filters") if isinstance(tool.get("filters"), dict) else {}
        result = run_kpi(
            kpi,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            queue_ids=queue_ids,
            scope_level=scope_level,
            time_window=str(clean.get("time") or "") or None,
            dimensions=list(dims or []),
            filters=filters,
            dsn=dsn,
        )
        if certified_override is False:
            result["certified"] = False
        result["raw"] = raw
        return result

    if name != "run_sql":
        return {
            "status": "error",
            "error_type": "REPAIR",
            "error": "This task is free SQL. Return run_sql with one SELECT on rpt.*.",
            "raw": raw,
            "rows": [],
        }
    sql = str(tool.get("sql") or "").strip()
    if not sql:
        return {
            "status": "error",
            "error_type": "REPAIR",
            "error": "run_sql needs a SELECT on rpt.*.",
            "raw": raw,
            "rows": [],
        }
    params: dict[str, Any] = {}
    if bounds.start and bounds.end:
        params["start"] = bounds.start
        params["end"] = bounds.end
    result = run_sql(
        sql,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        queue_ids=queue_ids,
        scope_level=scope_level,
        params=params,
        dsn=dsn,
    )
    result["certified"] = False if certified_override is False else result.get("certified", False)
    result["raw"] = raw
    return result


def run_sql_task(
    *,
    path: str,
    goal: str,
    organization_id: int,
    user_id: int,
    role: str,
    dsn: str,
    queue_ids: list[int] | None = None,
    scope_level: str = "org",
    time_words: str | None = None,
    dimensions: list[str] | None = None,
    filters: dict[str, Any] | None = None,
    kpi_id: str | None = None,
    sql: str | None = None,
    answer_type: str = "",
    call_llm: CallLLM | None = None,
) -> dict[str, Any]:
    """SQL-only shortcut. Domain should call execute_sql_task. kpi_id/sql skip the executor LLM."""
    if kpi_id and call_llm is None:
        result = run_kpi(
            kpi_id,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            queue_ids=queue_ids,
            scope_level=scope_level,
            time_window=time_words,
            dimensions=dimensions,
            filters=filters,
            dsn=dsn,
        )
        result["facts"] = assemble_facts(
            result, task_goal=goal, kpi_id=result.get("kpi_id"), time_echo=result.get("time_echo") or ""
        )
        return result
    if sql and call_llm is None:
        bounds = (
            resolve_time(TimeSpec(expression=time_words))
            if time_words and str(time_words).strip()
            else TimeBounds(None, None, "")
        )
        params: dict[str, Any] = {}
        if bounds.start and bounds.end:
            params["start"] = bounds.start
            params["end"] = bounds.end
        result = run_sql(
            sql,
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            queue_ids=queue_ids,
            scope_level=scope_level,
            params=params,
            dsn=dsn,
        )
        result["facts"] = assemble_facts(result, task_goal=goal, time_echo=bounds.echo)
        return result
    task = {
        "path": path,
        "goal": goal,
        "time": time_words,
        "scope": scope_level,
        "slice": dimensions or [],
        "answer_type": answer_type,
    }
    return execute_sql_task(
        task,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        dsn=dsn,
        queue_ids=queue_ids,
        call_llm=call_llm,
    )
