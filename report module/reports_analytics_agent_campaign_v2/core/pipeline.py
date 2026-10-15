"""Campaign reports turn: supervisor → Domain plan → SQL (skill + catalog) → brief."""

from __future__ import annotations

import json
from typing import Any, Callable

import yaml

from .access import normalize_role, normalize_scope_level
from .analysis import format_deep_analysis, period_delta
from .examples import dimension_alias_brief
from .facts import assemble_facts
from .grounding import apply_grounding
from .loader import PACK_ROOT, PRODUCT_DIR, merge_effective
from .loop import LoopState
from .sql.kpi_retrieve import format_metric_catalog
from .sql.run_kpi import run_kpi
from .sql.run_sql import run_sql
from .sql.sql_guard import sql_has_groupby
from .sql.views import role_views, view_cards_for_prompt
from .time import previous_equal_window, resolve_expression

CallLLM = Callable[[list[dict[str, str]], float, int], str]

SKILL_METRICS = "skills/campaign-kpi-meaning/SKILL.md"
SKILL_VIEWS = "skills/campaign-sql-views/SKILL.md"


def load_prompt(relative: str) -> str:
    return (PACK_ROOT / relative).read_text()


def extract_json(text: str) -> dict[str, Any]:
    clean = (text or "").strip()
    if "```" in clean:
        start = clean.find("{")
        end = clean.rfind("}")
        if start >= 0 and end > start:
            clean = clean[start : end + 1]
    elif "{" in clean and "}" in clean:
        clean = clean[clean.find("{") : clean.rfind("}") + 1]
    try:
        parsed = json.loads(clean)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _scope_label(role: str) -> str:
    return "All branch campaigns" if role == "admin" else "Your campaigns"


def _task_path(plan: dict[str, Any], task: dict[str, Any]) -> str:
    raw = str(task.get("path") or plan.get("path") or "").strip().lower()
    if raw in {"free_sql", "list", "catalog", "sql", "views"}:
        return "free_sql"
    if raw in {"certified_metric", "metric", "kpi", "certified"}:
        return "certified_metric"
    answer = str(task.get("answer_type") or "").strip().lower()
    if answer in {"list", "roster"}:
        return "free_sql"
    return "certified_metric"


def validate_plan(plan: dict[str, Any]) -> str | None:
    tasks = plan.get("tasks") or []
    if not isinstance(tasks, list) or not tasks:
        return "plan must contain tasks"
    if len(tasks) > 2:
        return "plan may have at most two tasks"
    for task in tasks:
        if not str(task.get("goal") or "").strip():
            return "each task needs a goal in plain language"
        task.pop("kpi", None)
        task.pop("kpi_id", None)
    return None


def run_turn(
    *,
    question: str,
    organization_id: int,
    user_id: int,
    branch_id: int,
    role: str,
    dsn: str,
    call_llm: CallLLM,
) -> dict[str, Any]:
    role = normalize_role(role)
    catalog = merge_effective(organization_id)
    kpis = catalog["kpis"]
    identity = {
        "organization_id": organization_id,
        "user_id": user_id,
        "branch_id": branch_id,
        "role": role,
        "scope_label": _scope_label(role),
        "timezone": "UTC",
    }
    trace: dict[str, Any] = {"identity": identity, "question": question}

    sup = call_llm(
        [
            {"role": "system", "content": load_prompt("supervisor/agent.md")},
            {"role": "user", "content": json.dumps({"identity": identity, "question": question})},
        ],
        0.1,
        400,
    )
    sup_js = extract_json(sup)
    trace["supervisor"] = sup_js
    trace["supervisor_raw"] = sup
    if sup_js.get("kind") == "chat":
        reply = str(sup_js.get("reply") or "").strip()
        q = (question or "").strip().lower()
        greet_only = q in {"hi", "hello", "hey", "thanks", "thank you", "ok", "okay"} or (
            q.startswith("thank") and len(q.split()) <= 4
        )
        if greet_only:
            return {"answer": reply or "Hello. Ask about campaign performance in this workspace.", "trace": trace, "facts": ""}
        trace["supervisor_overridden"] = "analytics question was not treated as small talk"

    dims_doc: dict[str, Any] = {}
    try:
        dims_doc = yaml.safe_load((PRODUCT_DIR / "dimensions.yml").read_text()) or {}
    except Exception:
        dims_doc = {}

    loop = LoopState(max_attempts=2)
    facts_blocks: list[str] = []
    last_plan: dict[str, Any] = {}
    trace["task_results"] = []
    understanding: dict[str, Any] = {}

    while True:
        loop.record_attempt()
        plan_user: dict[str, Any] = {
            "mode": "plan",
            "identity": identity,
            "question": question,
        }
        if loop.errors:
            plan_user["replan"] = loop.replan_payload()
        plan_raw = call_llm(
            [
                {"role": "system", "content": load_prompt("domain/agent.md")},
                {"role": "user", "content": json.dumps(plan_user)},
            ],
            0.1,
            1400,
        )
        plan = extract_json(plan_raw)
        last_plan = plan
        trace["plan"] = plan
        trace["plan_raw"] = plan_raw
        understanding = {
            "need": plan.get("understanding") or question,
            "time": "",
            "slice": "",
        }
        if plan.get("tasks"):
            t0 = plan["tasks"][0]
            understanding["time"] = t0.get("time") or ""
            understanding["slice"] = t0.get("slice") or t0.get("dimensions") or ""
        trace["interpret"] = understanding
        if str(plan.get("ask_user") or "").strip() and not (plan.get("tasks") or []):
            return {"answer": str(plan["ask_user"]), "trace": trace, "facts": ""}
        if plan.get("kind") != "plan":
            err = {"status": "error", "error_type": "REPLAN", "error": "Domain did not return a plan"}
            loop.record_error(err)
            if not loop.should_replan(err):
                break
            continue

        verr = validate_plan(plan)
        if verr:
            err = {"status": "error", "error_type": "REPLAN", "error": verr}
            loop.record_error(err)
            if not loop.should_replan(err):
                facts_blocks.append(assemble_facts(err, task_goal=verr))
                break
            continue

        facts_blocks = []
        failed = None
        for task in plan.get("tasks") or []:
            path = _task_path(plan, task)
            task["path"] = path
            result = _run_task(
                task,
                plan=plan,
                organization_id=organization_id,
                user_id=user_id,
                branch_id=branch_id,
                role=role,
                dsn=dsn,
                call_llm=call_llm,
                kpis=kpis,
                dims_doc=dims_doc,
            )
            if result.get("status") == "error" and result.get("error_type") == "REPAIR":
                result = _run_task(
                    task,
                    plan=plan,
                    organization_id=organization_id,
                    user_id=user_id,
                    branch_id=branch_id,
                    role=role,
                    dsn=dsn,
                    call_llm=call_llm,
                    kpis=kpis,
                    dims_doc=dims_doc,
                    repair=str(result.get("error") or ""),
                )
                if result.get("status") == "error":
                    result["error_type"] = "REPLAN"
            slice_dims = task.get("slice") or task.get("dimensions") or []
            if isinstance(slice_dims, str):
                slice_dims = [slice_dims] if slice_dims else []
            facts_blocks.append(
                assemble_facts(
                    result,
                    task_goal=str(task.get("goal") or ""),
                    kpi_id=result.get("kpi_id"),
                    group_by=list(slice_dims),
                    answer_type=str(task.get("answer_type") or ""),
                    time_echo=result.get("time_echo") or "",
                )
            )
            rows = list(result.get("rows") or [])
            trace["task_results"].append(
                {
                    "task": task,
                    "status": result.get("status"),
                    "error_type": result.get("error_type"),
                    "error": result.get("error"),
                    "kpi_id": result.get("kpi_id"),
                    "store": result.get("store"),
                    "sql": result.get("sql"),
                    "row_count": len(rows),
                    "time_echo": result.get("time_echo"),
                    "path": path,
                    "rows": rows,
                }
            )
            if result.get("status") == "error":
                failed = result
                break
            analysis_text = _comparison_analysis(
                task,
                result,
                organization_id=organization_id,
                user_id=user_id,
                branch_id=branch_id,
                role=role,
                dsn=dsn,
            )
            if analysis_text:
                facts_blocks.append(analysis_text)
        if failed is None:
            break
        loop.record_error(failed)
        if failed.get("error_type") == "DENY" or not loop.should_replan(failed):
            break

    facts = "\n\n".join(facts_blocks) if facts_blocks else assemble_facts(loop.final_error())
    trace["facts"] = facts
    trace["loop_errors"] = loop.errors
    trace["briefing_raw"] = ""

    brief_raw = call_llm(
        [
            {"role": "system", "content": load_prompt("domain/agent.md")},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "mode": "brief",
                        "identity": identity,
                        "question": question,
                        "plan": last_plan,
                        "facts": facts,
                    }
                ),
            },
        ],
        0.2,
        900,
    )
    answer = (brief_raw or "").strip()
    trace["briefing_raw"] = brief_raw

    def _regen(_prev: str, ungrounded: list[str]) -> str:
        return call_llm(
            [
                {"role": "system", "content": load_prompt("domain/agent.md")},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "mode": "brief",
                            "identity": identity,
                            "question": question,
                            "facts": facts,
                            "ungrounded": ungrounded,
                            "instruction": "Rewrite using only numbers present in facts.",
                        }
                    ),
                },
            ],
            0.1,
            700,
        )

    grounded_answer, ok = apply_grounding(answer, facts, _regen, max_retries=1)
    trace["grounded"] = ok
    return {"answer": grounded_answer, "trace": trace, "facts": facts}


def _run_task(
    task: dict[str, Any],
    *,
    plan: dict[str, Any],
    organization_id: int,
    user_id: int,
    branch_id: int,
    role: str,
    dsn: str,
    call_llm: CallLLM,
    kpis: dict[str, Any],
    dims_doc: dict[str, Any],
    repair: str = "",
) -> dict[str, Any]:
    time_phrase = str(task.get("time") or "all time")
    bounds = resolve_expression(time_phrase)
    start = bounds.start.isoformat() if bounds.start else None
    end = bounds.end.isoformat() if bounds.end else None
    if role != "admin":
        scope = "mine"
    else:
        scope = normalize_scope_level(task.get("scope") or "org", role)

    slice_raw = task.get("slice") or task.get("dimensions") or []
    if isinstance(slice_raw, str):
        slice_raw = [slice_raw] if slice_raw.strip() else []
    dims = [str(d) for d in slice_raw if d]

    path = _task_path(plan, task)
    if path == "certified_metric":
        skill = load_prompt(SKILL_METRICS)
        catalog_text = format_metric_catalog(kpis, dimensions_doc=dims_doc, role=role)
        user_payload: dict[str, Any] = {
            "task": {k: task.get(k) for k in ("id", "goal", "time", "scope", "slice", "answer_type", "path")},
            "resolved": {"start": start, "end": end, "time_echo": bounds.echo},
            "skill": skill,
            "metric_catalog": catalog_text,
            "dimension_aliases": dimension_alias_brief(dims_doc),
        }
    else:
        skill = load_prompt(SKILL_VIEWS)
        names = list(role_views(role).keys())
        user_payload = {
            "task": {k: task.get(k) for k in ("id", "goal", "time", "scope", "slice", "answer_type", "path")},
            "resolved": {"start": start, "end": end, "time_echo": bounds.echo},
            "skill": skill,
            "view_cards": view_cards_for_prompt(role, names),
            "dimension_aliases": dimension_alias_brief(dims_doc),
        }
    if repair:
        user_payload["repair"] = repair

    raw = call_llm(
        [
            {"role": "system", "content": load_prompt("sql_executor/agent.md")},
            {"role": "user", "content": json.dumps(user_payload)},
        ],
        0.1,
        2500,
    )
    parsed = extract_json(raw)
    tool = str(parsed.get("tool") or "").lower()
    kpi = parsed.get("kpi") or parsed.get("kpi_id")

    if path == "certified_metric" and tool != "run_kpi":
        return {
            "status": "error",
            "error_type": "REPAIR",
            "error": "This task is a certified metric. Output run_kpi and pick one METRIC name from the catalog.",
            "rows": [],
        }
    if path == "certified_metric" and kpi:
        result = run_kpi(
            str(kpi),
            organization_id=organization_id,
            user_id=user_id,
            branch_id=branch_id,
            role=role,
            scope_level=scope,
            time_start=start,
            time_end=end,
            dimensions=list(parsed.get("dimensions") or dims or []) or None,
            dsn=dsn,
        )
        result["time_echo"] = bounds.echo
        return result

    if tool == "run_kpi" and kpi:
        result = run_kpi(
            str(kpi),
            organization_id=organization_id,
            user_id=user_id,
            branch_id=branch_id,
            role=role,
            scope_level=scope,
            time_start=start,
            time_end=end,
            dimensions=list(parsed.get("dimensions") or dims or []) or None,
            dsn=dsn,
        )
        result["time_echo"] = bounds.echo
        return result

    sql = str(parsed.get("sql") or "").strip().rstrip(";")
    if not sql:
        return {
            "status": "error",
            "error_type": "REPAIR",
            "error": "SQL executor returned neither run_kpi nor SQL.",
            "rows": [],
        }
    slice_text = " ".join(str(x) for x in dims)
    answer_type = str(task.get("answer_type") or "").lower()
    if slice_text and answer_type not in {"list", "roster"} and not sql_has_groupby(sql):
        return {
            "status": "error",
            "error_type": "REPAIR",
            "error": "A breakdown was requested. GROUP BY the matching rpt column, or use run_kpi with dimensions.",
            "rows": [],
        }
    params: dict[str, Any] = {}
    if start and end:
        params["start"] = start
        params["end"] = end
    result = run_sql(
        sql,
        organization_id=organization_id,
        user_id=user_id,
        branch_id=branch_id,
        role=role,
        params=params,
        dsn=dsn,
        row_cap=100000,
    )
    result["time_echo"] = bounds.echo
    return result


def _scalar_number(result: dict[str, Any]) -> float | None:
    rows = list(result.get("rows") or [])
    if len(rows) != 1:
        return None
    values = [v for v in rows[0].values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if len(values) != 1:
        return None
    return float(values[0])


def _comparison_analysis(
    task: dict[str, Any],
    result: dict[str, Any],
    *,
    organization_id: int,
    user_id: int,
    branch_id: int,
    role: str,
    dsn: str,
) -> str:
    if str(task.get("answer_type") or "").lower() != "comparison" or result.get("status") != "ok":
        return ""
    kpi = result.get("kpi_id")
    if not kpi:
        return ""
    current = _scalar_number(result)
    if current is None:
        return ""
    time_phrase = str(task.get("time") or "all time")
    bounds = resolve_expression(time_phrase)
    prev = previous_equal_window(bounds)
    if prev is None or prev.start is None or prev.end is None:
        return ""
    if role != "admin":
        scope = "mine"
    else:
        scope = normalize_scope_level(task.get("scope") or "org", role)
    slice_raw = task.get("slice") or task.get("dimensions") or []
    if isinstance(slice_raw, str):
        slice_raw = [slice_raw] if slice_raw else []
    dims = [str(d) for d in slice_raw if d]
    previous = run_kpi(
        str(kpi),
        organization_id=organization_id,
        user_id=user_id,
        branch_id=branch_id,
        role=role,
        scope_level=scope,
        time_start=prev.start.isoformat(),
        time_end=prev.end.isoformat(),
        dimensions=dims or None,
        dsn=dsn,
    )
    previous_n = _scalar_number(previous)
    if previous_n is None:
        return ""
    delta = period_delta(current, previous_n)
    return format_deep_analysis(primary=delta)
