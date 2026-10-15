#!/usr/bin/env python3
"""Verification runner — instruction-first behavioral + scope + adversarial matrices.

Does not change product code. Prints resolved ExecutorJob fields + SQL.
Run with INSTRUCTION_FIRST=1.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["INSTRUCTION_FIRST"] = "1"

from semantic.scope import UserScope
from sql_agent.errors import SqlAgentError
from sql_agent.job import SqlQueryRequest
from sql_agent.mas.harness import constrained_to_executor_job
from sql_agent.mas.intent_gate import hint_intent, run_intent_gate
from sql_agent.mas.intent_kinds import normalize_intent
from sql_agent.mas.metric_validator import validate_metric_against_instruction
from sql_agent.mas.plan_schema import ConstrainedJob, SqlPlan
from sql_agent.mas.super_planner import _gemma_plan
from sql_agent.ticketing_sql.builder import (
    build_ticketing_count_sql,
    build_ticketing_group_sql,
    build_ticketing_list_sql,
)


def _ent():
    return SimpleNamespace(
        skus={"ticketing"},
        channels_for_product=lambda _p: ["email", "chat", "voice"],
    )


def _scope(role: str, uid: str = "1001") -> UserScope:
    return UserScope(
        user_id=uid,
        organization_id="1000",
        role=role,
        visible_user_ids=[uid],
        my_queue_ids=[],
        identity="ticketing_agents",
    )


def _req(instruction: str, *, uid: int = 1001, agent: str = "tk.tickets", mr=None):
    return SqlQueryRequest(
        organization_id=1000,
        user_id=uid,
        origin_product="ticketing",
        origin_agent=agent,
        instruction=instruction,
        limit=20,
        metric_request=mr,
    )


def _job_from_plan(plan: SqlPlan) -> ConstrainedJob:
    return ConstrainedJob(
        product="ticketing",
        table=plan.table or "tickets",
        schema="ticketing",
        select=list(plan.select or ["*"]),
        filters=list(plan.filters),
        limit=plan.limit,
        metric_id=plan.metric_id,
        template_id=plan.template_id,
        group_by=list(plan.group_by),
        scope_mode=plan.scope_mode,
        team_scope=plan.team_scope,
        time_start=plan.time_start,
        time_end=plan.time_end,
        time_grain=plan.time_grain,
    )


def run_harness(plan: SqlPlan, req: SqlQueryRequest, scope: UserScope):
    job = _job_from_plan(plan)
    with (
        patch("sql_agent.mas.harness.lookup_user_scope", return_value=scope),
        patch("sql_agent.mas.harness.load_tenant_entitlements", return_value=_ent()),
        patch(
            "sql_agent.mas.harness.get_template",
            return_value={
                "table": "tickets",
                "sql": "SELECT 1{{extra_where}}",
                "row_scope_column": "assignee_id",
            },
        ),
        patch("sql_agent.mas.harness.assert_metrics_allowed", return_value=None),
        patch(
            "sql_agent.mas.harness.resolve_metric_alias",
            side_effect=lambda x: x or None,
        ),
    ):
        return constrained_to_executor_job(req, plan, job, {"list_only": False})


def sql_for(executor):
    if executor.mode == "list":
        return build_ticketing_list_sql(executor)
    if executor.mode == "count_scalar":
        return build_ticketing_count_sql(executor)
    if executor.mode == "group_count":
        return build_ticketing_group_sql(executor)
    if executor.mode == "metric_fallback":
        # Show prepared scope intent; template SQL mocked
        return (
            f"-- metric_fallback metric_id={executor.metric_id} "
            f"scope={executor.scope} visible={executor.visible_user_ids} "
            f"filters={[ (f.column, f.op, f.values) for f in executor.filters ]}",
            [],
        )
    return f"-- unknown mode {executor.mode}", []


def dump(label, plan, executor, warnings, err=None):
    print(f"\n===== {label} =====")
    if err is not None:
        print(f"ERROR code={getattr(err, 'code', type(err).__name__)} msg={err}")
        if hasattr(err, "reason"):
            print(f"  reason={err.reason} missing={err.missing} candidates={err.candidates}")
        return
    filters = [(f.column, f.op, f.values) for f in executor.filters]
    print(
        f"intent={plan.intent} guard={plan.guard_action} mode={executor.mode} "
        f"metric_id={executor.metric_id} scope={executor.scope} "
        f"visible={executor.visible_user_ids} dual={executor.scope_dual_assignee_resolver}"
    )
    print(f"filters={filters}")
    print(f"group_by={list(executor.group_by)}")
    print(f"limit={executor.limit} order_by={list(executor.order_by)}")
    print(f"warnings={warnings}")
    sql, params = sql_for(executor)
    print(f"SQL:\n{sql}")
    print(f"params={params}")


def case_A():
    """list tickets + metricRequest force removed when IF=1; simulate Gemma list."""
    req = _req(
        "list tickets",
        mr={"metrics": ["open_tickets_metric"]},
    )
    # With IF=1, _gemma_plan should NOT early-force; mock Gemma list
    with patch(
        "sql_agent.mas.super_planner.chat_json",
        return_value={
            "intent": "list",
            "preset_id": "tk.tickets",
            "product": "ticketing",
            "table": "tickets",
            "select": ["ticket_number", "status"],
            "limit": 20,
            "metric_id": None,
        },
    ):
        plan = _gemma_plan(req, {"list_only": False}, "ticketing")
    # Also simulate if Gemma wrongly attaches metric
    if not plan.metric_id:
        # force the bad Gemma attachment path separately as A2
        pass
    executor, warnings = run_harness(plan, req, _scope("agent"))
    dump("A list+metricRequest (Gemma returns list, IF=1)", plan, executor, warnings)

    # A-force-off check: without IF, force happens
    os.environ.pop("INSTRUCTION_FIRST", None)
    try:
        forced = _gemma_plan(req, {"list_only": False}, "ticketing")
        print(
            f"\nA-control IF=off forced intent={forced.intent} metric={forced.metric_id}"
        )
    finally:
        os.environ["INSTRUCTION_FIRST"] = "1"


def case_B():
    req = _req("list tickets")
    plan = SqlPlan(
        plan_id="b",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        metric_id="open_tickets_metric",
        template_id="open_tickets_metric",
        table="tickets",
        select=["ticket_number"],
        limit=20,
    )
    executor, warnings = run_harness(plan, req, _scope("agent"))
    dump("B Gemma list+metric_id", plan, executor, warnings)


def case_C():
    req = _req("list 15 open high priority tickets")
    gate = run_intent_gate(req.instruction, product="ticketing", organization_id=None)
    print(f"\nC gate hint={gate.hint} filters={gate.filters}")
    # Simulate Gemma following instruction (limit 15 if model extracts; else default)
    plan = SqlPlan(
        plan_id="c",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        table="tickets",
        select=["*"],
        filters=list(gate.filters),
        limit=15,  # only if Gemma/gate extracted — we check if gate does
        gate_hint=gate.hint,
    )
    # Did gate extract limit?
    print(f"C note: gate does not set limit; plan.limit manually set to 15 to probe filters")
    # Re-run with default limit 20 to show what happens without Gemma limit extract
    plan_default = SqlPlan(
        plan_id="c2",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        table="tickets",
        select=["*"],
        filters=list(gate.filters),
        limit=20,
        gate_hint=gate.hint,
    )
    executor, warnings = run_harness(plan_default, req, _scope("admin"))
    dump("C list 15 open high priority (limit from req default unless Gemma sets)", plan_default, executor, warnings)


def case_D():
    req = _req("list tickets")
    plan = SqlPlan(
        plan_id="d",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        table="tickets",
        select=["*"],
        limit=20,
    )
    executor, warnings = run_harness(plan, req, _scope("admin"))
    dump("D list tickets default limit", plan, executor, warnings)


def case_E():
    req = _req("ticket count by queue")
    gate = run_intent_gate(req.instruction, product="ticketing", organization_id=None)
    print(f"\nE gate hint={gate.hint} group_by={gate.group_by}")
    plan = SqlPlan(
        plan_id="e",
        preset_id="tk.tickets",
        intent=gate.hint,
        product="ticketing",
        table="tickets",
        group_by=list(gate.group_by),
        limit=20,
    )
    executor, warnings = run_harness(plan, req, _scope("admin"))
    dump("E ticket count by queue", plan, executor, warnings)


def case_F():
    req = _req("how many open tickets")
    # Bad metric path
    plan_bad = SqlPlan(
        plan_id="f1",
        preset_id="metric.certified",
        intent="kpi",
        product="ticketing",
        metric_id="ticket_volume",
        template_id="ticket_volume",
        table="tickets",
        limit=1,
    )
    ex1, w1 = run_harness(plan_bad, req, _scope("admin"))
    dump("F with ticket_volume (must reject)", plan_bad, ex1, w1)

    plan_ok = SqlPlan(
        plan_id="f2",
        preset_id="metric.certified",
        intent="kpi",
        product="ticketing",
        metric_id="open_tickets_metric",
        template_id="open_tickets_metric",
        table="tickets",
        limit=1,
    )
    ex2, w2 = run_harness(plan_ok, req, _scope("admin"))
    dump("F with open_tickets_metric (must pass)", plan_ok, ex2, w2)

    # Gate-only path count_scalar
    gate = run_intent_gate(req.instruction, product="ticketing", organization_id=None)
    plan_sc = SqlPlan(
        plan_id="f3",
        preset_id="tk.tickets",
        intent="count_scalar",
        product="ticketing",
        table="tickets",
        filters=list(gate.filters),
        limit=1,
    )
    ex3, w3 = run_harness(plan_sc, req, _scope("admin"))
    dump("F count_scalar path", plan_sc, ex3, w3)


def case_G():
    req = _req("how many tickets")
    v = validate_metric_against_instruction("ticket_volume", req.instruction)
    print(f"\nG validator ticket_volume ok={v.ok} reason={v.reason}")
    plan = SqlPlan(
        plan_id="g",
        preset_id="metric.certified",
        intent="kpi",
        product="ticketing",
        metric_id="ticket_volume",
        template_id="ticket_volume",
        table="tickets",
        limit=1,
    )
    executor, warnings = run_harness(plan, req, _scope("admin"))
    dump("G how many tickets → ticket_volume", plan, executor, warnings)

    plan2 = SqlPlan(
        plan_id="g2",
        preset_id="tk.tickets",
        intent="count_scalar",
        product="ticketing",
        table="tickets",
        limit=1,
    )
    ex2, w2 = run_harness(plan2, req, _scope("admin"))
    dump("G count_scalar no filter", plan2, ex2, w2)


def case_H():
    instr = "show me how many open tickets"
    hint = hint_intent(instr)
    print(f"\nH hint_intent({instr!r}) = {hint}")
    gate = run_intent_gate(instr, product="ticketing", organization_id=None)
    plan = SqlPlan(
        plan_id="h",
        preset_id="tk.tickets",
        intent=gate.hint,
        product="ticketing",
        table="tickets",
        filters=list(gate.filters),
        limit=20,
    )
    executor, warnings = run_harness(plan, _req(instr), _scope("admin"))
    dump("H show me how many open tickets", plan, executor, warnings)


def case_I():
    instr = "tickets by sentiment"
    print(f"\nI hint={hint_intent(instr)}")
    try:
        gate = run_intent_gate(instr, product="ticketing", organization_id=None)
        print(f"I gate hint={gate.hint} group_by={gate.group_by} filters={gate.filters}")
        # Also try normalize unknown dim as Gemma might emit
        from sql_agent.mas.intent_gate import normalize_filters

        normalize_filters([{"column": "sentiment", "op": "eq", "values": ["angry"]}])
        print("I FAIL: should have raised needs_clarification for sentiment filter")
    except SqlAgentError as exc:
        dump("I tickets by sentiment", None, None, None, err=exc)


def case_J():
    instr = "list Alice's tickets"
    print(f"\nJ hint={hint_intent(instr)}")
    try:
        gate = run_intent_gate(instr, product="ticketing", organization_id=1000)
        print(f"J gate filters={gate.filters}")
    except SqlAgentError as exc:
        dump("J gate error", None, None, None, err=exc)
        return

    # Force assignee name path with ambiguous mock
    with patch(
        "sql_agent.mas.intent_gate.lookup_assignee_ids",
        return_value=[
            {"id": "10", "name": "Alice Smith"},
            {"id": "11", "name": "Alice Jones"},
        ],
    ):
        try:
            from sql_agent.mas.intent_gate import normalize_filters

            normalize_filters(
                [{"column": "assignee_name", "op": "eq", "values": ["Alice"]}],
                organization_id=1000,
                resolve_assignee=True,
            )
            print("J FAIL: expected needs_clarification for ambiguous Alice")
        except SqlAgentError as exc:
            dump("J ambiguous Alice (forced normalize)", None, None, None, err=exc)

    # Natural language possessive — does gate extract Alice?
    print(
        f"J natural extraction from {instr!r}: "
        f"gate returned filters above; if empty, possessive not parsed"
    )


def scope_matrix():
    cases = [
        ("agent", "list open tickets", "list"),
        ("agent", "how many open tickets", "count_scalar"),
        ("agent", "list Bob's tickets", "list"),
        ("agent", "list open tickets", "list", {"scope_mode": "org"}),
        ("resolver", "list open tickets", "list"),
        ("admin", "list open tickets", "list"),
        ("admin", "my tickets", "list"),
        ("viewer", "how many open tickets", "count_scalar"),
    ]
    for item in cases:
        role, instr, intent = item[0], item[1], item[2]
        extra = item[3] if len(item) > 3 else {}
        label = f"SCOPE {role} | {instr!r} | intent={intent} extra={extra}"
        req = _req(instr, uid=1001 if role != "admin" else 1)
        uid = "1001" if role != "admin" else "1"
        if role == "admin" and "my" in instr:
            uid = "1"
        scope = _scope(role, uid=uid)
        try:
            gate = run_intent_gate(instr, product="ticketing", organization_id=None)
            filters = list(gate.filters)
            # Bob's tickets — may not extract; inject name filter to test scope_denied
            if "Bob" in instr and not any(
                f.get("column") in ("assignee_name", "assignee_id") for f in filters
            ):
                filters = [{"column": "assignee_name", "op": "eq", "values": ["Bob"]}]
                print(f"\nNOTE: possessive not extracted; injecting assignee_name=Bob for scope_denied probe")
            plan = SqlPlan(
                plan_id="s",
                preset_id="tk.tickets",
                intent=intent,
                product="ticketing",
                table="tickets",
                select=["*"],
                filters=filters,
                limit=20,
                scope_mode=extra.get("scope_mode"),
            )
            # admin my tickets: personal
            if role == "admin" and "my" in instr:
                plan.scope_mode = "assignee"
            executor, warnings = run_harness(plan, req, scope)
            dump(label, plan, executor, warnings)
        except SqlAgentError as exc:
            dump(label, None, None, None, err=exc)
        except Exception as exc:
            print(f"\n===== {label} =====")
            print(f"UNEXPECTED {type(exc).__name__}: {exc}")
            traceback.print_exc()


def adversarial():
    cases = [
        "list and count all open tickets by status",
        "show tickets then tell me the average",
        ("list closed tickets", {"metrics": ["open_tickets_metric"]}),
        "list all tickets",
        "",
        "tickets",
        "сколько открытых тикетов",
        "😀😀😀",
        "list tickets; DROP TABLE tickets;--",
        "SELECT * FROM tickets WHERE 1=1",
        "how many open tickets grouped by queue",
        "list tickets limit 999999",
    ]
    for i, c in enumerate(cases, 1):
        if isinstance(c, tuple):
            instr, mr = c
        else:
            instr, mr = c, None
        label = f"ADV{i} {instr!r} mr={mr}"
        req = _req(instr or "(empty)", mr=mr)
        try:
            if not (instr or "").strip():
                hint = hint_intent(instr)
                print(f"\n===== {label} =====\nhint={hint}")
                plan = SqlPlan(
                    plan_id="a",
                    preset_id="tk.tickets",
                    intent=hint,
                    product="ticketing",
                    table="tickets",
                    select=["*"],
                    limit=20,
                )
                ex, w = run_harness(plan, req, _scope("admin"))
                dump(label, plan, ex, w)
                continue
            gate = run_intent_gate(instr, product="ticketing", organization_id=None)
            # For list all — max limit probe
            lim = 20
            if "all" in instr.lower() or "999999" in instr:
                lim = 999999  # what a naive Gemma might send
            plan = SqlPlan(
                plan_id="a",
                preset_id="tk.tickets",
                intent=gate.hint,
                product="ticketing",
                table="tickets",
                select=["*"],
                filters=list(gate.filters),
                group_by=list(gate.group_by),
                limit=lim,
                metric_id=(mr or {}).get("metrics", [None])[0] if mr else None,
                template_id=(mr or {}).get("metrics", [None])[0] if mr else None,
            )
            # If mr contradicts list instruction, intent should still be list from gate
            if mr and gate.hint == "list":
                plan.intent = "list"
            ex, w = run_harness(plan, req, _scope("admin"))
            dump(label, plan, ex, w)
        except SqlAgentError as exc:
            dump(label, None, None, None, err=exc)
        except Exception as exc:
            print(f"\n===== {label} =====\nUNEXPECTED {exc}")
            traceback.print_exc()


def print_scope_enforcement_lines():
    print("\n===== SCOPE ENFORCEMENT LOCATIONS =====")
    import inspect
    from sql_agent.ticketing_sql import builder as b
    from sql_agent.mas import scope_clamp as sc
    from sql_agent.metric_fallback import _build_extra_where
    from semantic.ticketing_scope import ticketing_row_scope_clause

    print(f"builder._scope_clause -> {b._scope_clause}")
    src = inspect.getsource(b._scope_clause)
    print(src)
    print("--- clamp_scope_mode ---")
    print(inspect.getsource(sc.clamp_scope_mode))
    print("--- ticketing_row_scope_clause signature ---")
    print(inspect.getsource(ticketing_row_scope_clause)[:800])
    print("--- metric_fallback _build_extra_where (first 40 lines) ---")
    print("\n".join(inspect.getsource(_build_extra_where).splitlines()[:45]))


if __name__ == "__main__":
    print("INSTRUCTION_FIRST=", os.environ.get("INSTRUCTION_FIRST"))
    for fn in [
        case_A,
        case_B,
        case_C,
        case_D,
        case_E,
        case_F,
        case_G,
        case_H,
        case_I,
        case_J,
        scope_matrix,
        adversarial,
        print_scope_enforcement_lines,
    ]:
        try:
            fn()
        except Exception:
            print(f"\n!! FATAL in {fn.__name__}")
            traceback.print_exc()
