"""Proactive agents: ASGA, idempotency, Layer 1–3 contracts."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from unittest.mock import patch

os.environ["PROACTIVE_USE_DB"] = "0"
os.environ["PROACTIVE_VIA_API"] = "0"
os.environ["PROACTIVE_WORKER"] = "0"

from app.proactive.asga import gate
from app.proactive.contract import Proposal
from app.proactive.executor import execute_tool
from app.proactive.registry_agents import AGENTS
from app.proactive.retrieval import retrieve
from app.proactive.runtime import (
    _actor_for_event,
    confirm_approval,
    dispatch_event,
    handle_proposal,
)
from app.proactive.store import (
    get_routing_weights,
    get_wloa_brief,
    reset_memory,
    set_routing_weights,
    set_wloa_brief,
)
from app.tools.registry import TOOL_ALLOWLIST, assert_tool_allowed
from app.proactive.tsaa import DEBOUNCE_S, propose as tsaa_propose
from app.proactive import (
    ara,
    crda,
    dssa,
    icpa,
    itra,
    pna,
    rcaa,
    rkaa,
    rqa,
    sema,
    stda,
    tcaa,
    tiaa,
    tsaa,
    wloa,
)


def _proposal(**kwargs) -> Proposal:
    base = dict(
        agent_id="icpa",
        organization_id="org-1",
        ticket_id="t1",
        ticket_number="#1",
        event_id="evt-1",
        output_type="ACTION_PROPOSAL",
        risk_level="low",
        confidence=0.9,
        tool_name="update_ticket",
        tool_args={"ticket_number": "#1", "priority": "high"},
        summary="test",
    )
    base.update(kwargs)
    return Proposal(**base)


def _patch_llms(monkeypatch, fn):
    # ITRA assignment prefers LLM; stub offline so create dispatch stays deterministic.
    for mod in (tcaa, icpa, rkaa, stda, ara, pna, crda, sema, tiaa, rcaa, itra, rqa):
        monkeypatch.setattr(mod, "run_agent_llm", fn)
    # Keep ticket.created dispatch tests offline (no Postgres roster/workload).
    monkeypatch.setattr(
        itra,
        "route_assignment",
        lambda **_kwargs: {
            "agent": None,
            "agent_id": None,
            "resolver": None,
            "resolver_id": None,
            "rationale": "ITRA: test stub",
            "confidence": 0.2,
            "via": "itra",
            "weights_applied": False,
        },
    )


def setup_function() -> None:
    reset_memory()
    tsaa._last.clear()
    sema._swept.clear()
    pna._seen.clear()


def test_asga_blocks_undeclared_tools():
    p = _proposal(tool_name="delete_queue")
    result = gate(p)
    assert result.decision == "reject"
    assert result.reason == "undeclared_tool"


def test_low_confidence_becomes_recommendation():
    p = _proposal(confidence=0.1)
    result = gate(p)
    assert result.decision == "recommend"
    assert result.reason == "low_confidence"


def test_recommendation_dedupe_key_ignores_ticket_counts():
    from app.proactive.store import recommendation_dedupe_key

    a = "Critical SLA risk: breach rate is at 99% with 101 breached tickets."
    b = "Critical SLA risk: breach rate is at 99% with 102 breached tickets."
    assert recommendation_dedupe_key(a) == recommendation_dedupe_key(b)


def test_recommendation_dedupe_skips_near_duplicate_schedule_insight():
    from app.proactive.runtime import apply_decision
    from app.proactive.asga import GateResult
    from app.proactive.store import insert_recommendation, reset_memory

    reset_memory()
    summary = (
        "Critical SLA risk: breach rate is at 99% with 101 breached tickets "
        "and 101 open overdue tickets."
    )
    insert_recommendation(
        {
            "organization_id": "org-dedupe",
            "agent_id": "tiaa",
            "summary": summary,
            "payload": {"dedupe_key": "insight:sla_critical"},
        }
    )
    proposal = Proposal(
        agent_id="tiaa",
        organization_id="org-dedupe",
        event_type="schedule.tiaa",
        output_type="RECOMMENDATION",
        confidence=0.9,
        summary=(
            "Critical SLA risk: breach rate is at 99% with 102 breached tickets "
            "and 102 open overdue tickets. Additionally, there are 554 total overdue "
            "tickets in the system."
        ),
        payload={"dedupe_key": "insight:sla_critical"},
    )
    out = apply_decision(GateResult("recommend", "recommendation_only", proposal))
    assert out["status"] == "skipped"
    assert out["reason"] == "duplicate_recommendation"


def test_recommendation_dedupe_allows_different_tickets():
    from app.proactive.store import recent_similar_recommendation, reset_memory

    reset_memory()
    from app.proactive.store import insert_recommendation

    insert_recommendation(
        {
            "organization_id": "org-tix",
            "agent_id": "rkaa",
            "ticket_number": "#1",
            "summary": "See KB article reset password",
            "payload": {"dedupe_key": "kb:reset"},
        }
    )
    assert not recent_similar_recommendation(
        "org-tix",
        "rkaa",
        "See KB article reset password",
        dedupe_key="kb:reset",
        ticket_number="#2",
        hours=24,
    )


def test_dispatch_sets_tool_actor_from_event(monkeypatch):
    seen: dict = {}

    def fake_llm(*_a, **_k):
        from app.tools.express_client import get_tool_actor

        actor = get_tool_actor()
        seen["user_id"] = getattr(actor, "user_id", None)
        seen["org"] = getattr(actor, "organization_id", None)
        return {"priority": "low", "confidence": 0.2, "assignee": "", "notes": "x"}

    _patch_llms(monkeypatch, fake_llm)
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: {"success": True},
    )
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {"payload": {"subject": "hello"}},
    )
    monkeypatch.setattr(
        "app.tools.ticket_read.list_tickets",
        lambda *_a, **_k: {"payload": []},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_agents",
        lambda *_a, **_k: {"payload": []},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_queues",
        lambda *_a, **_k: {"payload": []},
    )
    monkeypatch.setattr("app.proactive.rkaa.retrieve", lambda *_a, **_k: [])
    monkeypatch.setattr("app.proactive.stda.retrieve", lambda *_a, **_k: [])
    dispatch_event(
        {
            "id": "actor-evt-1",
            "event_type": "ticket.created",
            "organization_id": "org-1",
            "actor": "user-99",
            "ticket_number": "#1",
            "payload": {"ticket_number": "#1", "subject": "hello"},
        }
    )
    assert seen.get("user_id") == "user-99"
    assert seen.get("org") == "org-1"


def test_actor_for_event_uses_org_staff_for_portal_customer(monkeypatch):
    monkeypatch.setattr(
        "app.proactive.runtime._org_actor_user_id",
        lambda _org: "admin-9",
    )
    actor = _actor_for_event(
        {
            "organization_id": "1",
            "actor": "1019",
            "payload": {
                "actor_id": "1019",
                "actor_role": "portal_customer",
                "actor_name": "Sam",
                "created_by_role": "customer",
            },
        }
    )
    assert actor is not None
    assert actor.user_id == "admin-9"
    assert actor.user_role == "admin"


def test_actor_for_event_uses_org_staff_for_api_key_intake(monkeypatch):
    monkeypatch.setattr(
        "app.proactive.runtime._org_actor_user_id",
        lambda _org: "admin-9",
    )
    actor = _actor_for_event(
        {
            "organization_id": "1",
            "actor": "api-key:12",
            "payload": {
                "actor_id": "api-key:12",
                "actor_role": "service",
                "created_by_role": "customer",
            },
        }
    )
    assert actor is not None
    assert actor.user_id == "admin-9"
    assert actor.user_role == "admin"


def test_lean_portal_ticket_created_uses_org_staff_actor(monkeypatch):
    """Support-portal create must enrich + assign as org staff, not the customer."""
    seen: dict = {}
    calls = _patch_lean_enrich_assign(monkeypatch)

    def capture(agent_id, tool_name, args, **kwargs):
        from app.tools.express_client import get_tool_actor

        actor = get_tool_actor()
        seen["user_id"] = getattr(actor, "user_id", None)
        seen["role"] = getattr(actor, "user_role", None)
        calls.append((agent_id, tool_name, dict(args)))
        return {"success": True, "payload": {"ok": True}}

    monkeypatch.setattr("app.proactive.runtime.execute_tool", capture)
    monkeypatch.setattr(
        "app.proactive.runtime._org_actor_user_id",
        lambda _org: "admin-9",
    )
    monkeypatch.setattr(
        "app.proactive.runtime._domain_delegate_once",
        lambda *_a, **_k: None,
    )
    dispatch_event(
        {
            "id": "portal-created-1",
            "event_type": "ticket.created",
            "organization_id": "1",
            "actor": "1019",
            "ticket_number": "#501",
            "payload": {
                "ticket_number": "#501",
                "subject": "vpn broken please help me asap from home office",
                "description": "vpn broken please help me asap from home office",
                "assignee": "Unassigned",
                "triage_complete": False,
                "harness_triage_complete": False,
                "domain_triage_owned": True,
                "actor_id": "1019",
                "actor_role": "portal_customer",
                "created_by_role": "customer",
            },
        }
    )
    assert seen.get("user_id") == "admin-9"
    assert seen.get("role") == "admin"
    assert any(c[0] == "icpa" and c[1] == "update_ticket" for c in calls)
    assert any(c[0] == "itra" and c[1] == "update_ticket" for c in calls)


def test_lean_email_ticket_created_uses_org_staff_actor(monkeypatch):
    """API-key email intake must enrich + assign as org staff, not api-key:."""
    seen: dict = {}
    calls = _patch_lean_enrich_assign(monkeypatch)

    def capture(agent_id, tool_name, args, **kwargs):
        from app.tools.express_client import get_tool_actor

        actor = get_tool_actor()
        seen["user_id"] = getattr(actor, "user_id", None)
        seen["role"] = getattr(actor, "user_role", None)
        calls.append((agent_id, tool_name, dict(args)))
        return {"success": True, "payload": {"ok": True}}

    monkeypatch.setattr("app.proactive.runtime.execute_tool", capture)
    monkeypatch.setattr(
        "app.proactive.runtime._org_actor_user_id",
        lambda _org: "admin-9",
    )
    monkeypatch.setattr(
        "app.proactive.runtime._domain_delegate_once",
        lambda *_a, **_k: None,
    )
    dispatch_event(
        {
            "id": "email-created-1",
            "event_type": "ticket.created",
            "organization_id": "1",
            "actor": "api-key:12",
            "ticket_number": "#111",
            "payload": {
                "ticket_number": "#111",
                "subject": "cannot reset password after lockout",
                "description": "cannot reset password after lockout",
                "assignee": "Unassigned",
                "triage_complete": False,
                "harness_triage_complete": False,
                "domain_triage_owned": True,
                "actor_id": "api-key:12",
                "actor_role": "service",
                "created_by_role": "customer",
            },
        }
    )
    assert seen.get("user_id") == "admin-9"
    assert seen.get("role") == "admin"
    assert any(c[0] == "icpa" and c[1] == "update_ticket" for c in calls)
    assert any(c[0] == "itra" and c[1] == "update_ticket" for c in calls)


def test_idempotent_ticket_created(monkeypatch):
    _patch_llms(
        monkeypatch,
        lambda *_a, **_k: {"priority": "low", "confidence": 0.9, "assignee": ""},
    )
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: {"success": True},
    )
    event = {
        "id": "same-event",
        "event_type": "ticket.created",
        "organization_id": "org-1",
        "ticket_number": "#9",
        "payload": {"ticket_number": "#9", "subject": "hello"},
    }
    first = dispatch_event(event)
    second = dispatch_event(event)
    assert first
    assert second == [{"status": "skipped", "reason": "idempotent"}]


def test_layer1_agents_in_registry():
    for agent in ("tcaa", "icpa", "itra", "dssa"):
        assert agent in TOOL_ALLOWLIST
        assert_tool_allowed(agent, next(iter(TOOL_ALLOWLIST[agent])))


def test_crda_queues_and_ara_executes_status_after_llm(monkeypatch):
    monkeypatch.setattr(
        crda,
        "run_agent_llm",
        lambda *_a, **_k: {"draft": "Hello", "confidence": 0.99},
    )
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "close_ticket",
            "status": "Resolved",
            "confidence": 0.99,
            "rationale": "Customer asked to close",
        },
    )
    executed: list = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: executed.append(a) or {"success": True},
    )
    crda_p = crda.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#1",
            "event_type": "customer.replied",
            "payload": {"ticket_number": "#1", "text": "thanks"},
        }
    )
    assert crda_p is not None
    crda_p.confidence = 0.99
    out = handle_proposal(crda_p)
    assert out and out["status"] == "queued"

    ara_p = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#1",
            "event_type": "customer.replied",
            "payload": {
                "ticket_number": "#1",
                "status": "Resolved",
                "text": "my ticket is resolved, close this ticket now",
            },
        }
    )
    assert ara_p is not None
    assert ara_p.tool_args.get("status") == "Closed"
    ara_p.confidence = 0.99
    out2 = handle_proposal(ara_p)
    assert out2 and out2["status"] == "queued"
    assert executed == []
    crda_executed = [row for row in executed if row[1] == "add_ticket_note"]
    assert crda_executed == []


def _rqa_resolve_event(**payload_extra) -> dict:
    payload = {
        "ticket_number": "#12",
        "statusChanged": True,
        "prev_status": "Open",
        "new_status": "Resolved",
    }
    payload.update(payload_extra)
    return {
        "event_type": "ticket.updated",
        "organization_id": "org-1",
        "ticket_id": "tid-12",
        "ticket_number": "#12",
        "payload": payload,
    }


def _stub_rqa_reads(monkeypatch, *, ticket=None, notes=None) -> None:
    ticket = ticket or {
        "ticketNumber": "#12",
        "status": "Resolved",
        "subject": "VPN down",
        "description": "Cannot connect",
        "ai_summary": "Customer reported VPN issues.",
    }
    notes = notes if notes is not None else []
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {"success": True, "payload": ticket},
    )
    monkeypatch.setattr(
        "app.tools.ticket_read.list_ticket_notes",
        lambda *_a, **_k: {"success": True, "payload": notes},
    )
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket_progress",
        lambda *_a, **_k: {"success": True, "payload": {}},
    )


def test_rqa_silent_when_not_resolve_transition(monkeypatch):
    called = []
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: called.append(1) or {"quality_ok": False, "action": "recommend"},
    )
    assert (
        rqa.propose(
            {
                "event_type": "ticket.updated",
                "organization_id": "org-1",
                "ticket_number": "#12",
                "payload": {
                    "ticket_number": "#12",
                    "statusChanged": False,
                    "prev_status": "Open",
                    "new_status": "Open",
                    "assigneeChanged": True,
                },
            }
        )
        is None
    )
    assert (
        rqa.propose(
            {
                "event_type": "ticket.created",
                "organization_id": "org-1",
                "ticket_number": "#12",
                "payload": {"ticket_number": "#12", "new_status": "Resolved"},
            }
        )
        is None
    )
    assert (
        rqa.propose(
            {
                "event_type": "ticket.updated",
                "organization_id": "org-1",
                "ticket_number": "#12",
                "payload": {
                    "ticket_number": "#12",
                    "prev_status": "Resolved",
                    "new_status": "Resolved",
                    "statusChanged": False,
                },
            }
        )
        is None
    )
    assert called == []


def test_rqa_silent_when_notes_explain_fix(monkeypatch):
    _stub_rqa_reads(
        monkeypatch,
        notes=[{"text": "Reset VPN profile; customer confirmed.", "visibility": "internal"}],
    )
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "quality_ok": True,
            "action": "silence",
            "confidence": 0.9,
            "reason": "Staff note explains the fix.",
        },
    )
    assert rqa.propose(_rqa_resolve_event()) is None


def test_rqa_fails_empty_notes_even_with_ai_summary(monkeypatch):
    _stub_rqa_reads(
        monkeypatch,
        ticket={
            "ticketNumber": "#12",
            "status": "Resolved",
            "subject": "VPN down",
            "ai_summary": "Ticket is Resolved. VPN restored after password reset.",
        },
        notes=[],
    )
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "quality_ok": False,
            "gaps": ["empty_notes"],
            "action": "draft_note",
            "draft": (
                "Resolved without a staff resolution note. Subject: VPN down. "
                "Please record the actual fix."
            ),
            "confidence": 0.86,
            "reason": "#12 was Resolved with no staff note explaining the fix.",
        },
    )
    p = rqa.propose(_rqa_resolve_event())
    assert p is not None
    assert p.agent_id == "rqa"
    assert p.output_type == "ACTION_PROPOSAL"
    assert p.risk_level == "high"
    assert p.tool_name == "add_ticket_note"
    assert p.tool_args.get("visibility") == "internal"
    assert p.tool_name != "update_ticket"
    executed = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: executed.append(a) or {"success": True},
    )
    out = handle_proposal(p)
    assert out and out["status"] == "queued"
    assert executed == []


def test_rqa_recommend_only_when_no_grounded_draft(monkeypatch):
    _stub_rqa_reads(monkeypatch, notes=[])
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "quality_ok": False,
            "action": "recommend",
            "draft": "",
            "confidence": 0.8,
            "reason": "#12 was Resolved without a staff resolution note. Add what was done.",
        },
    )
    p = rqa.propose(_rqa_resolve_event())
    assert p is not None
    assert p.output_type == "RECOMMENDATION"
    assert p.tool_name is None
    out = handle_proposal(p)
    assert out and out["status"] == "recommendation"


def test_rqa_disabled_by_env(monkeypatch):
    monkeypatch.setenv("PROACTIVE_RQA", "0")
    called = []
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: called.append(1) or {"action": "recommend"},
    )
    assert rqa.propose(_rqa_resolve_event()) is None
    assert called == []


def test_rqa_empty_llm_stays_silent(monkeypatch):
    _stub_rqa_reads(monkeypatch, notes=[])
    monkeypatch.setattr(rqa, "run_agent_llm", lambda *_a, **_k: {})
    assert rqa.propose(_rqa_resolve_event()) is None


def test_rqa_dedupes_open_recommendation(monkeypatch):
    from app.proactive.store import insert_recommendation

    _stub_rqa_reads(monkeypatch, notes=[])
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "quality_ok": False,
            "action": "recommend",
            "confidence": 0.8,
            "reason": "#12 was Resolved without a staff resolution note. Add what was done.",
        },
    )
    insert_recommendation(
        {
            "organization_id": "org-1",
            "agent_id": "rqa",
            "ticket_number": "#12",
            "summary": "add a resolution note",
            "payload": {},
        }
    )
    assert rqa.propose(_rqa_resolve_event()) is None


def test_rqa_approval_notifies_assignee_and_resolver(monkeypatch):
    from app.proactive.store import reset_memory

    reset_memory()
    sent: list[dict] = []
    _stub_rqa_reads(
        monkeypatch,
        ticket={
            "ticketNumber": "#12",
            "status": "Resolved",
            "subject": "VPN down",
            "assigneeId": "1001",
            "resolverId": "2002",
        },
        notes=[],
    )
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "quality_ok": False,
            "gaps": ["empty_notes"],
            "action": "draft_note",
            "draft": "Resolved without a staff resolution note. Please record the fix.",
            "confidence": 0.86,
            "reason": "#12 was Resolved with no staff note explaining the fix.",
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.send_staff_notification",
        lambda **kwargs: sent.append(kwargs) or {"success": True},
    )
    out = handle_proposal(rqa.propose(_rqa_resolve_event()))
    assert out and out["status"] == "queued"
    assert out.get("notified_user_ids") == ["1001", "2002"]
    assert [row["user_id"] for row in sent] == ["1001", "2002"]
    assert all("Approvals" in row["message"] for row in sent)
    assert all(row["title"].startswith("Resolution quality review") for row in sent)


def test_rqa_recommendation_notifies_single_resolver(monkeypatch):
    from app.proactive.store import reset_memory

    reset_memory()
    sent: list[dict] = []
    _stub_rqa_reads(
        monkeypatch,
        ticket={
            "ticketNumber": "#12",
            "status": "Resolved",
            "assignee_id": "2002",
            "resolver_id": "2002",
        },
        notes=[],
    )
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "quality_ok": False,
            "action": "recommend",
            "draft": "",
            "confidence": 0.8,
            "reason": "#12 was Resolved without a staff resolution note. Add what was done.",
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.send_staff_notification",
        lambda **kwargs: sent.append(kwargs) or {"success": True},
    )
    out = handle_proposal(rqa.propose(_rqa_resolve_event()))
    assert out and out["status"] == "recommendation"
    assert out.get("notified_user_ids") == ["2002"]
    assert [row["user_id"] for row in sent] == ["2002"]


def test_rkaa_recommendation_notifies_new_ticket_agent_and_resolver(monkeypatch):
    from app.proactive.store import reset_memory

    reset_memory()
    sent: list[dict] = []
    monkeypatch.setattr(
        rkaa,
        "retrieve",
        lambda *_a, **_k: [
            {
                "source": "kb",
                "id": "vpn-1",
                "title": "What to Do When Your VPN Won't Connect",
                "snippet": "switch servers",
                "score": 0.8,
            }
        ]
        if _k.get("source") == "kb"
        else [],
    )
    monkeypatch.setattr(rkaa, "run_agent_llm", lambda *_a, **_k: {})
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {
            "success": True,
            "payload": {
                "subject": "VPN not connecting",
                "description": "VPN not connecting after password reset",
                "ticketNumber": "#12",
                "assigneeId": "1001",
                "resolverId": "3003",
            },
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.send_staff_notification",
        lambda **kwargs: sent.append(kwargs) or {"success": True},
    )
    p = rkaa.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#12",
            "event_type": "ticket.created",
            "payload": {
                "subject": "VPN not connecting",
                "description": "VPN not connecting after password reset",
            },
        }
    )
    out = handle_proposal(p)
    assert out and out["status"] == "recommendation"
    assert out.get("notified_user_ids") == ["1001", "3003"]
    assert [row["user_id"] for row in sent] == ["1001", "3003"]
    assert all("Resolution Knowledge Agent" in row["message"] for row in sent)
    assert all(row["title"].startswith("Resolution knowledge") for row in sent)


def test_rqa_skips_notify_when_ticket_has_no_staff_ids(monkeypatch):
    from app.proactive.store import reset_memory

    reset_memory()
    sent: list[dict] = []
    _stub_rqa_reads(monkeypatch, notes=[])
    monkeypatch.setattr(
        rqa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "quality_ok": False,
            "action": "recommend",
            "confidence": 0.8,
            "reason": "#12 was Resolved without a staff resolution note. Add what was done.",
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.send_staff_notification",
        lambda **kwargs: sent.append(kwargs) or {"success": True},
    )
    out = handle_proposal(rqa.propose(_rqa_resolve_event()))
    assert out and out["status"] == "recommendation"
    assert "notified_user_ids" not in out
    assert sent == []


def test_sema_idempotent_per_sweep(monkeypatch):
    monkeypatch.setattr(
        sema,
        "run_agent_llm",
        lambda *_a, **_k: {
            "action": "alert",
            "ticket_number": "#44",
            "rationale": "Ticket #44 has about 2 hours left. Notify the assignee before breach.",
            "near_breach": True,
            "confidence": 0.8,
        },
    )
    event = {
        "event_type": "schedule.sema",
        "organization_id": "org-1",
        "ticket_number": "#44",
        "payload": {"ticket_number": "#44"},
    }
    first = sema.propose(event)
    second = sema.propose(event)
    assert first is not None
    assert "SLA check" not in (first.summary or "")
    assert "2 hours" in (first.summary or "") or "Notify" in (first.summary or "")
    assert second is None


def test_tsaa_debounce(monkeypatch):
    from app.proactive import tsaa as tsaa_mod

    monkeypatch.setattr(
        tsaa_mod,
        "run_agent_llm",
        lambda *_a, **_k: {"summary": "Customer still waiting.", "confidence": 0.8},
    )
    monkeypatch.setattr(
        tsaa_mod,
        "_load_context",
        lambda *_a, **_k: ({"ticketNumber": "#2"}, {}, []),
    )
    event = {
        "event_type": "ticket.comment_added",
        "organization_id": "org-1",
        "ticket_number": "#2",
        "payload": {"ticket_number": "#2"},
    }
    a = tsaa_propose(event)
    b = tsaa_propose(event)
    assert a is not None
    assert b is None
    assert DEBOUNCE_S > 0


def test_tsaa_resolve_bypasses_debounce_and_sets_resolution_kind(monkeypatch):
    """Marking Resolved must always rewrite — not lose to the 8s mid-life debounce."""
    from app.proactive import tsaa as tsaa_mod

    calls: list[str] = []

    def _llm(agent, sys_prompt, user_prompt):
        calls.append(user_prompt)
        return {
            "summary": "Ticket is Resolved. VPN restored after password reset.",
            "resolution": "Marked Resolved after fix confirmed.",
            "confidence": 0.92,
        }

    monkeypatch.setattr(tsaa_mod, "run_agent_llm", _llm)
    monkeypatch.setattr(
        tsaa_mod,
        "_load_context",
        lambda *_a, **_k: (
            {"ticketNumber": "#9", "status": "Pending"},
            {
                "history": [
                    {"label": "Ticket submitted", "at": "2026-01-01T00:00:00Z"},
                    {"label": "Marked Resolved", "at": "2026-01-02T00:00:00Z", "actor": "Agent"},
                ]
            },
            [{"text": "fixed on my side", "visibility": "public"}],
        ),
    )
    tsaa_mod._last.clear()
    comment = {
        "event_type": "ticket.comment_added",
        "organization_id": "org-1",
        "ticket_number": "#9",
        "payload": {"ticket_number": "#9"},
    }
    assert tsaa_propose(comment) is not None
    # Immediate resolve after a note must still run.
    resolved = tsaa_propose(
        {
            "event_type": "ticket.updated",
            "organization_id": "org-1",
            "ticket_number": "#9",
            "ticket_id": "tid-9",
            "payload": {
                "ticket_number": "#9",
                "statusChanged": True,
                "prev_status": "Pending",
                "new_status": "Resolved",
            },
        }
    )
    assert resolved is not None
    assert resolved.payload.get("summary_kind") == "resolution"
    assert resolved.payload.get("bypass_rate_limit") is True
    stored = resolved.tool_args.get("ai_summary") or ""
    # Overall narrative from summary key — not a labeled Resolution: echo.
    assert "Resolved" in stored
    assert not stored.startswith("Resolution:")
    assert "Marked Resolved after fix confirmed." not in stored or stored.startswith(
        "Ticket is Resolved"
    )
    assert stored == "Ticket is Resolved. VPN restored after password reset."
    assert any("system_events" in c for c in calls)
    assert any("lifecycle_hint" in c for c in calls)
    assert any("status_change=" in c for c in calls)


def test_tsaa_format_prefers_overall_summary_not_resolution_label():
    from app.proactive.tsaa import _format_summary

    out = _format_summary(
        {
            "summary": (
                "Customer opened a VPN outage ticket. Assigned to Deva NS as agent. "
                "After two days of troubleshooting, the ticket was Resolved."
            ),
            "resolution": "The ticket status was updated to Resolved by Deva NS.",
            "confidence": 0.9,
        },
        "resolution",
    )
    assert out.startswith("Customer opened")
    assert not out.startswith("Resolution:")
    assert "status was updated to Resolved by Deva NS" not in out


def test_tsaa_format_falls_back_to_section_prose_without_labels():
    from app.proactive.tsaa import _format_summary

    out = _format_summary(
        {"resolution": "Issue fixed after password reset.", "confidence": 0.8},
        "resolution",
    )
    assert out == "Issue fixed after password reset."
    assert "Resolution:" not in out


def test_tsaa_resolution_not_rate_limited(monkeypatch):
    from app.proactive.asga import gate
    from app.proactive.contract import Proposal

    p = Proposal(
        agent_id="tsaa",
        organization_id="org-1",
        ticket_id="tid-1",
        ticket_number="#1",
        output_type="ACTION_PROPOSAL",
        risk_level="low",
        confidence=0.9,
        tool_name="update_ticket",
        tool_args={"ticket_number": "#1", "ai_summary": "Resolved summary."},
        summary="Resolved summary.",
        payload={"summary_kind": "resolution", "bypass_rate_limit": True},
    )
    result = gate(p, recent_count=99)
    assert result.decision == "execute"
    assert result.reason == "tsaa_summary"


def test_tsaa_executes_ai_summary_not_recommendation(monkeypatch):
    executed: list = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: executed.append(a) or {"success": True},
    )
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "summary": "Customer is blocked on VPN.",
            "conversation": "Customer reports VPN fails after reset.",
            "confidence": 0.9,
        },
    )
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: (
            {"ticketNumber": "#80", "subject": "VPN"},
            {"history": []},
            [{"text": "still broken", "visibility": "public"}],
        ),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "ticket.comment_added",
            "organization_id": "org-1",
            "ticket_number": "#80",
            "payload": {"ticket_number": "#80"},
        }
    )
    assert p is not None
    assert p.output_type == "ACTION_PROPOSAL"
    assert p.tool_name == "update_ticket"
    assert p.tool_args.get("ai_summary")
    assert "status" not in p.tool_args
    out = handle_proposal(p)
    assert out["status"] == "executed"
    assert executed
    assert executed[0][1] == "update_ticket"


def test_tsaa_customer_replied_rewrites(monkeypatch):
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: {"summary": "Portal reply noted.", "confidence": 0.85},
    )
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: ({"ticketNumber": "#9"}, {}, [{"text": "still broken"}]),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "customer.replied",
            "organization_id": "org-1",
            "ticket_number": "#9",
            "payload": {"ticket_number": "#9", "channel": "portal"},
        }
    )
    assert p is not None
    assert p.tool_args.get("ai_summary")


def test_tsaa_ticket_updated_rewrites(monkeypatch):
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "summary": "Reassigned to Tier 2.",
            "handover_brief": "Handed to Tier 2.",
            "confidence": 0.88,
        },
    )
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: ({"ticketNumber": "#11"}, {}, []),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "ticket.updated",
            "organization_id": "org-1",
            "ticket_number": "#11",
            "payload": {
                "ticket_number": "#11",
                "assignee_changed": True,
                "prev_status": "Open",
                "new_status": "Open",
            },
        }
    )
    assert p is not None
    # Prefer overall summary paragraph — not a "Handover:" label block.
    assert p.summary == "Reassigned to Tier 2."
    assert "Handover:" not in (p.summary or "")


def test_tsaa_ticket_created_writes_opening_summary(monkeypatch):
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "summary": "Customer cannot connect to VPN after password reset.",
            "confidence": 0.9,
        },
    )
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: ({}, {}, []),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "ticket.created",
            "organization_id": "org-1",
            "ticket_number": "#101",
            "payload": {
                "ticket_number": "#101",
                "subject": "VPN down",
                "description": "Cannot connect after password reset",
            },
        }
    )
    assert p is not None
    assert p.tool_args.get("ai_summary")
    assert p.payload.get("summary_kind") == "created"


def test_tsaa_created_user_blob_omits_assign_history(monkeypatch):
    blobs: list[str] = []

    def _llm(_agent, _sys, user):
        blobs.append(str(user))
        return {"summary": "Customer wants a refund for a torn shirt.", "confidence": 0.9}

    monkeypatch.setattr(tsaa, "run_agent_llm", _llm)
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: (
            {
                "ticketNumber": "#20025",
                "subject": "Refund torn sweatshirt",
                "description": "Received a torn sweatshirt from order BXUK-1",
                "assignee": "Shobana R",
                "resolver": "Arun Ayyappan",
                "status": "Pending",
            },
            {"history": [{"label": "Assigned Shobana R as agent"}]},
            [],
        ),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "ticket.created",
            "organization_id": "org-1",
            "ticket_number": "#20025",
            "payload": {"ticket_number": "#20025"},
        }
    )
    assert p is not None
    blob = blobs[0]
    assert "Assigned Shobana" not in blob
    assert "system_events" not in blob
    assert "Received a torn sweatshirt" in blob


def test_tsaa_post_create_assign_update_stays_issue_focused(monkeypatch):
    blobs: list[str] = []

    def _llm(_agent, _sys, user):
        blobs.append(str(user))
        return {"summary": "Customer requested a refund for damaged clothing.", "confidence": 0.88}

    monkeypatch.setattr(tsaa, "run_agent_llm", _llm)
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: (
            {
                "ticketNumber": "#11",
                "subject": "Refund",
                "description": "Torn item from order 99",
                "assignee": "Shobana R",
            },
            {"history": [{"label": "Booxoo Admin assigned the ticket"}]},
            [],
        ),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "ticket.updated",
            "organization_id": "org-1",
            "ticket_number": "#11",
            "payload": {
                "ticket_number": "#11",
                "assignee_changed": True,
                "prev_status": "Open",
                "new_status": "Pending",
            },
        }
    )
    assert p is not None
    blob = blobs[0]
    assert "Booxoo Admin assigned" not in blob
    assert "Torn item from order 99" in blob


def test_tsaa_sla_at_risk_rewrites(monkeypatch):
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: {"summary": "Ticket is overdue on SLA.", "confidence": 0.85},
    )
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: ({"ticketNumber": "#102", "status": "Overdue"}, {}, []),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "ticket.sla_at_risk",
            "organization_id": "org-1",
            "ticket_number": "#102",
            "payload": {"ticket_number": "#102", "new_status": "Overdue"},
        }
    )
    assert p is not None
    assert "overdue" in (p.summary or "").lower() or "SLA" in (p.summary or "")


def test_tsaa_skips_ai_summary_only_feedback(monkeypatch):
    called = []
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: called.append(1) or {"summary": "x", "confidence": 0.9},
    )
    assert (
        tsaa.propose(
            {
                "event_type": "ticket.updated",
                "organization_id": "org-1",
                "ticket_number": "#13",
                "payload": {"skip_tsaa": True},
            }
        )
        is None
    )
    assert called == []


def test_tsaa_empty_llm_skips(monkeypatch):
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: {"summary": "", "confidence": 0.9},
    )
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: ({}, {}, []),
    )
    tsaa._last.clear()
    assert (
        tsaa.propose(
            {
                "event_type": "ticket.comment_added",
                "organization_id": "org-1",
                "ticket_number": "#12",
            }
        )
        is None
    )


def test_tiaa_empty_db_is_honest(monkeypatch):
    monkeypatch.setattr(
        "app.tools.catalog_tools.ask_semantic_layer",
        lambda **k: {"success": False, "payload": {}},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.get_analytics",
        lambda **k: {"payload": {}},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.get_metrics",
        lambda **k: {"payload": {}},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.get_csat_reports",
        lambda **k: {"payload": {}},
    )
    out = tiaa.propose({"organization_id": "org-1", "event_type": "schedule.tiaa"})
    assert out is None
    asked = tiaa.propose({"organization_id": "org-1", "event_type": "on_demand.insights"})
    assert asked is not None
    assert asked.output_type == "RECOMMENDATION"
    assert asked.payload.get("empty") is True or "No analytics" in asked.summary


def test_pna_respects_opt_out(monkeypatch):
    monkeypatch.setattr(
        pna,
        "run_agent_llm",
        lambda *_a, **_k: {"title": "x", "message": "y", "confidence": 0.9},
    )
    skipped = pna.propose(
        {
            "organization_id": "org-1",
            "event_type": "ticket.updated",
            "payload": {"notify_user_id": "u1", "opt_out": True},
        }
    )
    assert skipped is None
    ok = pna.propose(
        {
            "organization_id": "org-1",
            "event_type": "ticket.updated",
            "ticket_id": "t9",
            "payload": {"notify_user_id": "u1", "preference_enabled": True},
        }
    )
    assert ok is not None
    with patch(
        "app.proactive.runtime.execute_tool",
        return_value={"success": True},
    ):
        gated = handle_proposal(ok)
    assert gated and gated["status"] == "executed"
    assert gated.get("tool") == "send_staff_notification"


def test_rcaa_writes_config_not_tickets(monkeypatch):
    monkeypatch.setattr(
        rcaa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "weights": {"billing": 1.2},
            "recurring_issues": [{"theme": "billing disputes", "routing_hint": "prefer billing queue"}],
            "notes": "learned billing pattern",
            "confidence": 0.7,
        },
    )
    p = rcaa.propose({"organization_id": "org-1", "event_type": "schedule.rcaa"})
    assert p is not None
    assert p.tool_name is None
    learned = get_routing_weights("org-1")
    assert learned.get("skill_weights") == {"billing": 1.2}
    assert learned.get("recurring_issues") == [
        {"theme": "billing disputes", "routing_hint": "prefer billing queue"}
    ]
    out = handle_proposal(p)
    assert out is not None
    assert out["status"] == "executed"
    assert out.get("agent_id") == "rcaa"
    again = rcaa.propose({"organization_id": "org-1", "event_type": "schedule.rcaa"})
    assert again is None


def test_itra_consumes_weights_without_second_assigner(monkeypatch):
    set_routing_weights(
        "org-1",
        {
            "skill_weights": {"billing": 2.0},
            "recurring_issues": [{"theme": "invoices", "routing_hint": "billing"}],
        },
    )
    seen: dict = {}

    def fake_route(**kwargs):
        seen["kwargs"] = kwargs
        return {
            "agent": None,
            "agent_id": None,
            "resolver": None,
            "resolver_id": None,
            "rationale": "ITRA: no match",
            "confidence": 0.2,
            "via": "itra",
            "weights_applied": True,
        }

    monkeypatch.setattr(itra, "route_assignment", fake_route)
    p = itra.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#3",
            "payload": {"ticket_number": "#3", "subject": "bill"},
        }
    )
    assert p is not None
    assert seen.get("kwargs", {}).get("organization_id") == "org-1"
    assert p.tool_name is None
    assert p.payload.get("weights_applied") is True


def test_itra_route_assignment_skill_fallback_when_llm_empty(monkeypatch):
    """When ITRA LLM returns nothing, validated skill roster fallback assigns L1."""
    monkeypatch.setattr(itra, "run_agent_llm", lambda *_a, **_k: {})
    monkeypatch.setattr(
        "app.tasks.assign.list_org_agents",
        lambda *_a, **_k: [
            {"id": "1", "name": "Mohammed Fazil", "role": "agent"},
            {"id": "2", "name": "Ashika A", "role": "agent"},
        ],
    )
    monkeypatch.setattr(
        "app.tasks.assign.org_skills_by_user",
        lambda *_a, **_k: {
            "1": ["General"],
            "2": ["solve crm related issues", "CRM"],
        },
    )
    monkeypatch.setattr("app.tasks.assign.list_org_teams", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_assignee",
        lambda *_a, **_k: {"Mohammed Fazil": 0, "Ashika A": 2},
    )
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_resolver", lambda *_a, **_k: {}
    )
    out = itra.route_assignment(
        organization_id="org-1",
        issue="my crm is not responding well",
        skill_hint="CRM Performance",
        target_role="agent",
    )
    assert out.get("agent") == "Ashika A"
    assert out.get("agent_id") == "2"
    assert out.get("via") == "itra-skill-fallback"


def test_itra_propose_executes_when_icpa_hints_present(monkeypatch):
    monkeypatch.setattr(itra, "run_agent_llm", lambda *_a, **_k: {})
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {
            "payload": {
                "subject": "voice bot is not working",
                "description": "voice bot is not working",
                "assignee": "Unassigned",
                "category": "Voice",
            }
        },
    )
    monkeypatch.setattr(
        "app.tasks.assign.list_org_agents",
        lambda *_a, **_k: [
            {"id": "1", "name": "Ashika A", "role": "agent"},
            {"id": "2", "name": "Dev Resolver", "role": "resolver"},
        ],
    )
    monkeypatch.setattr(
        "app.tasks.assign.org_skills_by_user",
        lambda *_a, **_k: {"1": ["Voice"], "2": ["Voice"]},
    )
    monkeypatch.setattr("app.tasks.assign.list_org_teams", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_assignee",
        lambda *_a, **_k: {"Ashika A": 1},
    )
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_resolver",
        lambda *_a, **_k: {"Dev Resolver": 0},
    )
    proposal = itra.propose(
        {
            "organization_id": "1000",
            "ticket_number": "#98",
            "payload": {
                "ticket_number": "#98",
                "assignee": "Unassigned",
                "domain_triage_owned": True,
                "triage_complete": False,
                "icpa_routing_hints": {
                    "agent": "Ashika A",
                    "resolver": "Dev Resolver",
                    "skill": "Voice",
                },
            },
        }
    )
    assert proposal is not None
    assert proposal.tool_name == "update_ticket"
    assert proposal.tool_args.get("assignee") == "Ashika A"
    assert proposal.tool_args.get("resolver") == "Dev Resolver"
    assert proposal.output_type == "ACTION_PROPOSAL"


def test_itra_uses_icpa_routing_hints(monkeypatch):
    monkeypatch.setattr(itra, "run_agent_llm", lambda *_a, **_k: {})
    monkeypatch.setattr(
        "app.tasks.assign.list_org_agents",
        lambda *_a, **_k: [
            {"id": "1", "name": "Ashika A", "role": "agent"},
            {"id": "2", "name": "Dev Resolver", "role": "resolver"},
        ],
    )
    monkeypatch.setattr(
        "app.tasks.assign.org_skills_by_user",
        lambda *_a, **_k: {"1": ["Voice"], "2": ["Voice"]},
    )
    monkeypatch.setattr("app.tasks.assign.list_org_teams", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_assignee",
        lambda *_a, **_k: {"Ashika A": 1},
    )
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_resolver",
        lambda *_a, **_k: {"Dev Resolver": 0},
    )
    out = itra.route_assignment(
        organization_id="org-1",
        issue="voice bot is not working",
        skill_hint="Voice",
        routing_hints={"agent": "Ashika A", "resolver": "Dev Resolver", "skill": "Voice"},
    )
    assert out.get("agent") == "Ashika A"
    assert out.get("resolver") == "Dev Resolver"
    assert out.get("via") == "icpa-hints"


def test_itra_route_assignment_llm_picks_roster_names(monkeypatch):
    monkeypatch.setattr(
        itra,
        "run_agent_llm",
        lambda *_a, **_k: {
            "agent": "Ashika A",
            "resolver": "Dev Resolver",
            "confidence": 0.9,
            "rationale": "CRM skill + lower L2 load",
        },
    )
    monkeypatch.setattr(
        "app.tasks.assign.list_org_agents",
        lambda *_a, **_k: [
            {"id": "1", "name": "Mohammed Fazil", "role": "agent"},
            {"id": "2", "name": "Ashika A", "role": "agent"},
            {"id": "3", "name": "Dev Resolver", "role": "resolver"},
        ],
    )
    monkeypatch.setattr(
        "app.tasks.assign.org_skills_by_user",
        lambda *_a, **_k: {
            "1": ["General"],
            "2": ["CRM"],
            "3": ["CRM"],
        },
    )
    monkeypatch.setattr("app.tasks.assign.list_org_teams", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_assignee",
        lambda *_a, **_k: {"Mohammed Fazil": 1, "Ashika A": 0},
    )
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_resolver",
        lambda *_a, **_k: {"Dev Resolver": 0},
    )
    out = itra.route_assignment(
        organization_id="org-1",
        issue="CRM login broken",
        subject="CRM login",
        description="Cannot sign in to CRM",
        skill_hint="CRM",
        queue="",
    )
    assert out.get("agent") == "Ashika A"
    assert out.get("resolver") == "Dev Resolver"
    assert out.get("via") == "itra-llm"


def test_itra_route_assignment_rejects_invented_llm_names(monkeypatch):
    """Invented names are dropped; roles stay empty (no scorer replacement)."""
    monkeypatch.setattr(
        itra,
        "run_agent_llm",
        lambda *_a, **_k: {
            "agent": "Not A Real Person",
            "resolver": "",
            "confidence": 0.99,
            "rationale": "hallucination",
        },
    )
    monkeypatch.setattr(
        "app.tasks.assign.list_org_agents",
        lambda *_a, **_k: [
            {"id": "1", "name": "Mohammed Fazil", "role": "agent"},
            {"id": "2", "name": "Ashika A", "role": "agent"},
        ],
    )
    monkeypatch.setattr(
        "app.tasks.assign.org_skills_by_user",
        lambda *_a, **_k: {"1": ["General"], "2": ["CRM"]},
    )
    monkeypatch.setattr("app.tasks.assign.list_org_teams", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_assignee",
        lambda *_a, **_k: {"Mohammed Fazil": 0, "Ashika A": 2},
    )
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_resolver", lambda *_a, **_k: {}
    )
    out = itra.route_assignment(
        organization_id="org-1",
        issue="my crm is not responding well",
        skill_hint="CRM",
        target_role="agent",
    )
    assert out.get("agent") is None
    assert out.get("agent") != "Not A Real Person"
    assert out.get("via") == "itra-llm"


def test_itra_llm_prompt_assigns_only_by_skills(monkeypatch):
    """ITRA asks the LLM to pick L1/L2 by listed skills, not a code scorer."""
    captured: dict = {}

    def fake_llm(_agent, system, user):
        captured["system"] = system
        captured["user"] = user
        return {
            "agent": "Ashika A",
            "resolver": "Uday kumar G",
            "confidence": 0.92,
            "rationale": "ccaas skill match",
        }

    monkeypatch.setattr(itra, "run_agent_llm", fake_llm)
    monkeypatch.setattr(
        "app.tasks.assign.list_org_agents",
        lambda *_a, **_k: [
            {"id": "1", "name": "Mohammed Fazil", "role": "agent"},
            {"id": "2", "name": "Ashika A", "role": "agent"},
            {"id": "3", "name": "Uday kumar G", "role": "resolver"},
            {"id": "4", "name": "No Skills Person", "role": "agent"},
        ],
    )
    monkeypatch.setattr(
        "app.tasks.assign.org_skills_by_user",
        lambda *_a, **_k: {
            "1": ["General"],
            "2": ["ccaas", "contact center"],
            "3": ["ccaas", "debugging"],
        },
    )
    monkeypatch.setattr("app.tasks.assign.list_org_teams", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_assignee",
        lambda *_a, **_k: {"Mohammed Fazil": 0, "Ashika A": 4, "No Skills Person": 0},
    )
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_resolver",
        lambda *_a, **_k: {"Uday kumar G": 9},
    )
    out = itra.route_assignment(
        organization_id="org-1",
        issue="While creating contact in ccaas in chat it shows created but UI is empty",
        skill_hint="ccaas",
        subject="CCaaS contact missing in UI",
        description="Contact created in chat but not shown in UI",
    )
    system = str(captured.get("system") or "")
    user = str(captured.get("user") or "")
    assert "Assign ONLY by skill overlap" in system
    assert "WLOA load brief is a hint" in system
    assert "Never leave a role empty because of workload" in system
    assert "WLOA load brief (hint only; skill match is required):" in user
    assert "WLOA load brief (hint only; skill match is required):\n(none)" in user
    assert "L1_agent_candidate_count=3" in user
    assert "L2_resolver_candidate_count=1" in user
    assert "skills=ccaas, contact center" in user
    assert "skills=ccaas, debugging" in user
    assert "No Skills Person | role=agent | skills=(none)" in user
    assert out.get("agent") == "Ashika A"
    assert out.get("resolver") == "Uday kumar G"
    assert out.get("via") == "itra-llm"
    assert not hasattr(itra, "_pick_from_pool")


def test_every_named_agent_matches_registry_allowlist():
    expected = {
        "tcaa",
        "icpa",
        "itra",
        "dssa",
        "tsaa",
        "sema",
        "rkaa",
        "crda",
        "ara",
        "wloa",
        "tiaa",
        "stda",
        "pna",
        "rcaa",
        "rqa",
    }
    assert set(AGENTS) == expected
    for agent_id, mod in AGENTS.items():
        spec = mod.SPEC
        assert spec.agent_id == agent_id
        allowed = TOOL_ALLOWLIST[agent_id]
        assert spec.tools_used <= allowed
        assert spec.output_type in {"RECOMMENDATION", "ACTION_PROPOSAL"}
        assert spec.risk_level in {"low", "high"}
        assert spec.trigger
        assert spec.audit_event.startswith("proactive.")


def test_asga_ara_closed_queues_approval_reopen_executes():
    closed = _proposal(
        agent_id="ara",
        tool_args={"ticket_number": "#1", "status": "Closed"},
        risk_level="high",
        confidence=0.99,
    )
    g = gate(closed)
    assert g.decision == "approve"
    assert g.reason == "high_risk"
    reopen = _proposal(
        agent_id="ara",
        tool_args={"ticket_number": "#1", "status": "Reopened"},
        risk_level="low",
        confidence=0.99,
    )
    g2 = gate(reopen)
    assert g2.decision == "execute"
    assert g2.reason == "ara_customer_status"


def test_asga_rate_limit_and_close_ticket_are_gated():
    limited = gate(_proposal(), recent_count=3)
    assert limited.decision == "recommend"
    assert limited.reason == "rate_limited"
    close = _proposal(
        tool_args={"ticket_number": "#1", "status": "resolved"},
        confidence=0.99,
    )
    assert gate(close).decision == "approve"
    assert gate(close).reason == "high_risk"


def test_executor_refuses_undeclared_tool():
    try:
        execute_tool("tcaa", "delete_queue", {})
        raise AssertionError("expected PermissionError")
    except PermissionError as exc:
        assert "delete_queue" in str(exc)


def test_proactive_executor_uses_versioned_skill_scoped_mcp(monkeypatch):
    from app.mcp.authorization import verify_mcp_token
    from app.tools.express_client import ToolActor, tool_actor_scope

    captured: dict = {}

    def fake_call(name, arguments, **kwargs):
        captured.update({"name": name, "arguments": arguments, **kwargs})
        return {"success": True, "payload": {"delivered": True}}

    monkeypatch.setattr("app.mcp.client.call_mcp_tool", fake_call)
    actor = ToolActor(
        user_id="admin-1",
        organization_id="org-1",
        user_role="admin",
    )
    with tool_actor_scope(actor):
        out = execute_tool(
            "pna",
            "send_staff_notification",
            {"user_id": "u1", "title": "Update", "message": "Ready"},
            idempotency_key="event-1",
        )
    assert out["success"] is True
    claims = verify_mcp_token(captured["token"])
    assert captured["name"] == "send_staff_notification"
    assert claims["agent_id"] == "personalized_notification_executor"
    assert claims["task_id"] == "notification.personalize.deliver"
    assert claims["skill_name"] == "notification-personalize-deliver"
    assert claims["skill_version"] == "1.0.0"
    assert claims["route_mode"] == "proactive"
    assert claims["run_id"] == "event-1"


def test_proactive_auto_execute_propagates_tool_failure(monkeypatch):
    from app.proactive.asga import GateResult
    from app.proactive.runtime import apply_decision

    proposal = _proposal(
        agent_id="icpa",
        tool_name="update_ticket",
        event_id="event-failed",
    )
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: {"success": False, "error_code": "UPSTREAM"},
    )
    out = apply_decision(GateResult("execute", "allowed", proposal))
    assert out["status"] == "failed"
    assert out["reason"] == "tool_failed"


def test_dssa_high_confidence_deflect_skips_tcaa(monkeypatch):
    monkeypatch.setattr(
        dssa,
        "load_published_kb_for_llm",
        lambda **_k: [
            {
                "id": "KB-1",
                "title": "Reset Wi-Fi",
                "category": "Network",
                "content": "1. Unplug router. 2. Wait 30s. 3. Plug back in.",
            }
        ],
    )
    monkeypatch.setattr(
        dssa,
        "_fetch_article_bodies",
        lambda org, ids, catalog: catalog[:1],
    )
    calls = {"n": 0}

    def fake_llm(*_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return {
                "deflect": True,
                "article_ids": ["KB-1"],
                "confidence": 0.95,
                "reason": "howto",
            }
        return {
            "reply": "See article Reset Wi-Fi: 1) Unplug…",
            "confidence": 0.95,
        }

    monkeypatch.setattr(dssa, "run_agent_llm", fake_llm)
    monkeypatch.setattr(
        tcaa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "subject": "should not create",
            "customerName": "Pat",
            "confidence": 0.99,
        },
    )
    executed: list = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: executed.append(a) or {"success": True},
    )
    out = dispatch_event(
        {
            "id": "inbound-deflect",
            "event_type": "inbound.message",
            "organization_id": "org-1",
            "payload": {"text": "how do I reset wifi password on the router"},
        }
    )
    assert out
    assert all(r.get("agent_id") != "tcaa" for r in out)
    assert executed == []
    dssa_row = next(r for r in out if r.get("agent_id") == "dssa")
    assert dssa_row.get("status") == "recommendation"
    assert dssa_row.get("deflect") is True
    assert "Reset Wi-Fi" in str(dssa_row.get("summary") or "")
    assert dssa_row.get("confidence", 0) >= 0.75


def test_dssa_loads_one_search_kb_hit(monkeypatch):
    seen: dict = {}

    def _search_kb(**k):
        seen.update(k)
        return {
            "success": True,
            "payload": {
                "hit": {
                    "article_id": "KB-1",
                    "title": "Reset Wi-Fi",
                    "text": "1. Unplug router. 2. Wait 30s.",
                    "steps": ["Unplug router", "Wait 30s"],
                    "score": 0.9,
                }
            },
        }

    monkeypatch.setattr("app.tools.catalog_tools.search_kb", _search_kb)
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_kb",
        lambda **k: (_ for _ in ()).throw(AssertionError("must not dump catalog")),
    )
    articles = dssa.load_published_kb_for_llm(
        organization_id="org-1",
        query="wifi password reset",
    )
    assert seen.get("query") == "wifi password reset"
    assert len(articles) == 1
    assert articles[0]["id"] == "KB-1"
    assert articles[0]["steps"] == ["Unplug router", "Wait 30s"]


def test_tcaa_icpa_itra_call_execute_tool(monkeypatch):
    calls: list[tuple] = []

    def capture(agent_id, tool_name, args, **kwargs):
        calls.append((agent_id, tool_name, args))
        return {"success": True, "payload": {"id": "#100"}}

    monkeypatch.setattr("app.proactive.runtime.execute_tool", capture)
    monkeypatch.setattr(
        dssa,
        "run_agent_llm",
        lambda *_a, **_k: {"deflect": False, "reply": "", "confidence": 0.2},
    )
    monkeypatch.setattr(
        tcaa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "customerName": "Pat Lee",
            "subject": "VPN down",
            "description": "cannot connect",
            "confidence": 0.9,
        },
    )
    inbound = dispatch_event(
        {
            "id": "inbound-create",
            "event_type": "inbound.message",
            "organization_id": "org-1",
            "payload": {"text": "VPN is down for Pat Lee", "skip_create": False},
        }
    )
    assert any(r.get("status") == "executed" and r.get("agent_id") == "tcaa" for r in inbound)
    assert any(c[0] == "tcaa" and c[1] == "create_ticket" for c in calls)

    monkeypatch.setattr(
        icpa,
        "run_agent_llm",
        lambda *_a, **_k: {"priority": "high", "category": "Network", "confidence": 0.95},
    )
    monkeypatch.setattr(
        itra,
        "route_assignment",
        lambda **_k: {
            "agent": "Jane Smith",
            "agent_id": "j1",
            "resolver": None,
            "resolver_id": None,
            "rationale": "ITRA load",
            "confidence": 0.9,
            "via": "itra",
            "weights_applied": False,
        },
    )
    monkeypatch.setattr(
        rkaa,
        "run_agent_llm",
        lambda *_a, **_k: {"notes": "kb", "confidence": 0.4},
    )
    monkeypatch.setattr(
        stda,
        "run_agent_llm",
        lambda *_a, **_k: {"notes": "dup", "confidence": 0.4},
    )
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {"note": "no", "confidence": 0.1},
    )
    created = dispatch_event(
        {
            "id": "created-route",
            "event_type": "ticket.created",
            "organization_id": "org-1",
            "ticket_number": "#100",
            "payload": {"ticket_number": "#100", "subject": "VPN down", "assignee": "Unassigned"},
        }
    )
    assert any(r.get("agent_id") == "icpa" and r.get("status") == "executed" for r in created)
    assert any(c[0] == "icpa" and c[1] == "update_ticket" for c in calls)
    assert any(c[0] == "itra" and c[1] == "update_ticket" for c in calls)


def test_approval_confirm_then_executes_tool(monkeypatch):
    executed: list = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: executed.append((a, k)) or {"success": True},
    )
    monkeypatch.setattr(
        "app.proactive.runtime._org_actor_user_id",
        lambda _org: "admin-1",
    )
    monkeypatch.setattr(
        crda,
        "run_agent_llm",
        lambda *_a, **_k: {"draft": "Thanks, we are on it.", "confidence": 0.99},
    )
    proposal = crda.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#7",
            "payload": {"ticket_number": "#7", "text": "any update?"},
        }
    )
    assert proposal is not None
    queued = handle_proposal(proposal)
    assert queued and queued["status"] == "queued"
    assert executed == []
    denied = confirm_approval("org-1", queued["id"], accept=False)
    assert denied["status"] == "rejected"
    assert executed == []

    queued2 = handle_proposal(proposal)
    ok = confirm_approval(
        "org-1", queued2["id"], accept=True, actor_id="admin-1", actor_role="admin"
    )
    assert ok["ok"] is True
    assert ok["status"] == "approved"
    assert executed, "confirm must hit Tool Registry"


def test_approval_confirm_keeps_pending_when_tool_fails(monkeypatch):
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *_a, **_k: {"success": False, "error": "NO_ACTOR"},
    )
    monkeypatch.setattr(
        crda,
        "run_agent_llm",
        lambda *_a, **_k: {"draft": "Thanks, we are on it.", "confidence": 0.99},
    )
    proposal = crda.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#8",
            "payload": {"ticket_number": "#8", "text": "hello"},
        }
    )
    queued = handle_proposal(proposal)
    assert queued and queued["status"] == "queued"
    out = confirm_approval(
        "org-1", queued["id"], accept=True, actor_id="admin-1", actor_role="admin"
    )
    assert out["ok"] is False
    assert out["error"] == "tool_failed"
    still = confirm_approval(
        "org-1", queued["id"], accept=False, actor_id="admin-1"
    )
    assert still["ok"] is True
    assert still["status"] == "rejected"


def test_crda_confirm_uses_edited_draft_text(monkeypatch):
    captured: list = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: captured.append((a, k)) or {"success": True},
    )
    monkeypatch.setattr(
        crda,
        "run_agent_llm",
        lambda *_a, **_k: {"draft": "Original draft text.", "confidence": 0.99},
    )
    proposal = crda.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#11",
            "payload": {"ticket_number": "#11", "text": "still broken"},
        }
    )
    queued = handle_proposal(proposal)
    assert queued and queued["status"] == "queued"
    ok = confirm_approval(
        "org-1",
        queued["id"],
        accept=True,
        actor_id="admin-1",
        actor_role="admin",
        edited_text="Edited customer reply after review.",
    )
    assert ok["ok"] is True
    assert captured
    _agent, tool, args = captured[0][0]
    assert tool == "add_ticket_note"
    assert args.get("text") == "Edited customer reply after review."
    assert args.get("visibility") == "public"


def test_crda_email_inbound_marks_send_customer_email(monkeypatch):
    monkeypatch.setattr(
        crda,
        "run_agent_llm",
        lambda *_a, **_k: {"draft": "Thanks, we are looking into it.", "confidence": 0.9},
    )
    emailed = crda.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#112",
            "event_type": "customer.replied",
            "payload": {
                "ticket_number": "#112",
                "text": "still waiting",
                "channel": "email",
            },
        }
    )
    assert emailed is not None
    assert emailed.tool_args.get("visibility") == "public"
    assert emailed.tool_args.get("send_customer_email") is True

    portal = crda.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#112",
            "event_type": "customer.replied",
            "payload": {
                "ticket_number": "#112",
                "text": "still waiting",
                "channel": "support_portal",
            },
        }
    )
    assert portal is not None
    assert portal.tool_args.get("send_customer_email") is not True


def test_ara_close_on_customer_resolved_message(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "close_ticket",
            "status": "Closed",
            "confidence": 0.92,
            "rationale": "Customer asked to close",
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#11",
            "event_type": "customer.replied",
            "payload": {
                "ticket_number": "#11",
                "status": "Resolved",
                "subject": "payment link",
                "text": "my ticket is resolved, close this ticket now",
            },
        }
    )
    assert out is not None
    assert out.tool_name == "update_ticket"
    assert out.tool_args.get("status") == "Closed"
    assert out.risk_level == "high"


def test_ara_close_skipped_until_staff_resolved(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "close_ticket",
            "status": "Closed",
            "confidence": 0.92,
            "rationale": "Customer asked to close",
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#11",
            "event_type": "customer.replied",
            "payload": {
                "ticket_number": "#11",
                "status": "Open",
                "text": "close this ticket now",
            },
        }
    )
    assert out is None


def test_ara_reopen_when_customer_says_still_broken(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "reopen_ticket",
            "ticket_number": "#11",
            "status": "Open",
            "confidence": 0.88,
            "rationale": "Customer says still broken",
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#11",
            "event_type": "customer.replied",
            "payload": {
                "ticket_number": "#11",
                "status": "Resolved",
                "text": "still broken, please reopen",
            },
        }
    )
    assert out is not None
    assert out.tool_args.get("status") == "Reopened"
    assert out.tool_args.get("ticket_number") == "#11"


def test_ara_csat_reopen_follows_llm_not_score(monkeypatch):
    """CSAT payload is conversation text. Code never gates on the number."""
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "reopen_ticket",
            "ticket_number": "#11",
            "status": "Reopened",
            "confidence": 0.9,
            "rationale": "Customer says the issue is not resolved",
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#11",
            "event_type": "on_demand.ara",
            "payload": {
                "channel": "csat",
                "ticket_number": "#11",
                "status": "Resolved",
                "text": "CSAT 5/5. The issue is not resolved.",
            },
        }
    )
    assert out is not None
    assert out.tool_args.get("status") == "Reopened"


def test_ara_csat_silence_follows_llm_not_score(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": False,
            "action": "",
            "confidence": 0.85,
            "rationale": "Rating alone, no unresolved-issue meaning",
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#11",
            "event_type": "on_demand.ara",
            "payload": {
                "channel": "csat",
                "ticket_number": "#11",
                "status": "Resolved",
                "text": "CSAT 1/5.",
            },
        }
    )
    assert out is None


def test_ara_portal_chat_resolves_that_ticket_from_conversation(monkeypatch):
    """Portal bot: LLM (not code) picks #9 from history when user says 'that ticket'."""
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "reopen_ticket",
            "ticket_number": "#9",
            "status": "Reopened",
            "confidence": 0.91,
            "rationale": "Customer referred to ticket #9 as still broken",
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "event_type": "on_demand.ara",
            "payload": {
                "channel": "portal_chat",
                "text": "no you reopen that ticket",
                "history": [
                    {
                        "role": "user",
                        "text": "i closed ticket #9 but it is not working good",
                    },
                    {
                        "role": "assistant",
                        "text": "Would you like me to file a new ticket?",
                    },
                    {"role": "user", "text": "no you reopen that ticket"},
                ],
                "customer_tickets": [
                    {
                        "ticket_number": "#14",
                        "status": "Open",
                        "subject": "newer issue",
                    },
                    {
                        "ticket_number": "#9",
                        "status": "Resolved",
                        "subject": "vpn problem",
                    },
                ],
            },
        }
    )
    assert out is not None
    assert out.tool_args.get("ticket_number") == "#9"
    assert out.tool_args.get("status") == "Reopened"


def test_ara_portal_chat_silent_when_not_lifecycle(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {"needed": False, "action": "", "confidence": 0.3},
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "event_type": "on_demand.ara",
            "payload": {
                "channel": "portal_chat",
                "text": "how do I reset wifi?",
                "history": [{"role": "user", "text": "how do I reset wifi?"}],
                "customer_tickets": [
                    {"ticket_number": "#9", "status": "Open", "subject": "vpn"}
                ],
            },
        }
    )
    assert out is None


def test_ara_silent_when_ambiguous_thanks(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {"needed": False, "action": "", "confidence": 0.4},
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#11",
            "event_type": "customer.replied",
            "payload": {"ticket_number": "#11", "status": "Open", "text": "thanks"},
        }
    )
    assert out is None


def test_ara_ignores_ticket_created(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "close_ticket",
            "status": "Resolved",
            "confidence": 0.99,
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#8",
            "event_type": "ticket.created",
            "payload": {
                "subject": "Need a password reset",
                "description": "unlock account please",
                "text": "close it",
            },
        }
    )
    assert out is None


def test_ara_noop_when_already_closed(monkeypatch):
    monkeypatch.setattr(
        ara,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "action": "close_ticket",
            "status": "Closed",
            "confidence": 0.99,
        },
    )
    out = ara.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#8",
            "event_type": "customer.replied",
            "payload": {
                "ticket_number": "#8",
                "status": "Closed",
                "text": "close this ticket now",
            },
        }
    )
    assert out is None


def test_pna_fans_out_notify_user_ids(monkeypatch):
    """ticket.created payload may list assignee + org admins for bell delivery."""
    monkeypatch.setattr(
        pna,
        "run_agent_llm",
        lambda *_a, **_k: {
            "title": "New ticket",
            "message": "Created",
            "kind": "assignment",
            "confidence": 0.9,
        },
    )
    pna._seen.clear()
    prop = pna.propose(
        {
            "organization_id": "org-1",
            "event_type": "ticket.created",
            "ticket_id": "t-fan",
            "ticket_number": "#99",
            "payload": {
                "notify_user_ids": ["1001", "1005"],
                "assignee_id": "1001",
                "customer_name": "Acme",
            },
        }
    )
    assert prop is not None
    assert prop.tool_args["user_ids"] == ["1001", "1005"]
    assert prop.tool_args["user_id"] == "1001"


def test_pna_uses_grounded_change_summary(monkeypatch):
    monkeypatch.setattr(
        pna,
        "run_agent_llm",
        lambda *_a, **_k: {
            "title": "Ticket #103 updated",
            "message": "No status, assignee, or resolver changes.",
            "kind": "update",
            "confidence": 0.9,
        },
    )
    pna._seen.clear()
    prop = pna.propose(
        {
            "organization_id": "org-1",
            "event_type": "ticket.updated",
            "ticket_id": "t-103",
            "payload": {
                "notify_user_ids": ["1001"],
                "assignee_id": "1001",
                "change_summary": "Ticket #103 status changed from Open to Resolved.",
            },
        }
    )
    assert prop is not None
    assert "Resolved" in str(prop.tool_args["message"])
    assert "No status" not in str(prop.tool_args["message"])


def test_bound_update_ticket_passes_ai_summary(monkeypatch):
    """TSAA MCP path must not drop ai_summary (lean Domain resolution write)."""
    import json

    from app.tools.bound import execute_tool_call
    from app.tools.express_client import ToolActor, tool_actor_scope

    captured: dict = {}

    def fake_update(ticket_number, **kwargs):
        captured["ticket_number"] = ticket_number
        captured["kwargs"] = kwargs
        return {"success": True, "payload": {"ok": True}}

    monkeypatch.setattr("app.tools.ticket_write.update_ticket", fake_update)
    actor = ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    with tool_actor_scope(actor):
        raw = execute_tool_call(
            "investigation_summary_executor",
            "update_ticket",
            {
                "ticket_number": "#94",
                "ai_summary": "Customer cannot connect live agent in CCAAS.",
                "description": "enriched body",
                "category": "Network",
            },
            last_query={"pending_update": {"approval_mode": "proactive_asga"}},
        )
    out = json.loads(raw)
    assert out.get("success") is True
    assert captured["ticket_number"] == "#94"
    assert (
        captured["kwargs"].get("ai_summary")
        == "Customer cannot connect live agent in CCAAS."
    )
    assert captured["kwargs"].get("description") == "enriched body"
    assert captured["kwargs"].get("category") == "Network"


def test_bound_send_staff_notification_accepts_user_ids(monkeypatch):
    """PNA MCP path must accept user_ids fan-out without VALIDATION_ERROR."""
    import json

    from app.tools.bound import execute_tool_call
    from app.tools.express_client import ToolActor, tool_actor_scope

    calls: list[str] = []

    def fake_notify(*, user_id, title, message, kind="update", **_k):
        calls.append(user_id)
        return {"success": True, "payload": {"ok": True, "user_id": user_id}}

    monkeypatch.setattr("app.tools.bound.send_staff_notification", fake_notify)
    actor = ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    with tool_actor_scope(actor):
        raw = execute_tool_call(
            "personalized_notification_executor",
            "send_staff_notification",
            {
                "user_id": "1001",
                "user_ids": ["1001", "1005"],
                "title": "New ticket",
                "message": "Created",
                "kind": "assignment",
            },
            last_query={"pending_update": {"approval_mode": "proactive_asga"}},
        )
    out = json.loads(raw)
    assert out.get("success") is True
    assert calls == ["1001", "1005"]


def test_pna_dedupes_same_event_user(monkeypatch):
    monkeypatch.setattr(
        pna,
        "run_agent_llm",
        lambda *_a, **_k: {"title": "Ping", "message": "changed", "confidence": 0.9},
    )
    event = {
        "organization_id": "org-1",
        "event_type": "ticket.updated",
        "ticket_id": "tid-1",
        "payload": {"notify_user_id": "u-22"},
    }
    assert pna.propose(event) is not None
    assert pna.propose(event) is None


def test_wloa_and_stda_are_recommendations_only(monkeypatch):
    monkeypatch.setattr(
        wloa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "notes": "Jane has 3 open tickets and Alex has 1 — move one ticket to Alex.",
            "confidence": 0.8,
        },
    )
    monkeypatch.setattr(
        "app.tools.ticket_read.list_tickets",
        lambda **k: {
            "payload": [
                {"status": "Open", "assignee": "Jane"},
                {"status": "Open", "assignee": "Jane"},
                {"status": "Open", "assignee": "Jane"},
                {"status": "Open", "assignee": "Alex"},
            ]
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_agents",
        lambda **k: {"payload": [{"name": "Jane"}, {"name": "Alex"}]},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_queues",
        lambda **k: {"payload": []},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.get_metrics",
        lambda **k: {"payload": {}},
    )
    w = wloa.propose({"organization_id": "org-1", "event_type": "schedule.wloa"})
    assert w is not None
    assert w.output_type == "RECOMMENDATION"
    assert w.tool_name is None
    assert handle_proposal(w)["status"] == "recommendation"
    assert handle_proposal(w)["status"] == "skipped"

    monkeypatch.setattr(
        stda,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "is_duplicate_or_repeat": True,
            "notes": "Duplicate of #1 — reuse VPN reset notes and the VPN macro.",
            "possible_duplicates": ["#1"],
            "recommended_solutions": [
                "Apply macro VPN Password Reset",
                "See note on #1: reset MFA then reconnect",
            ],
            "confidence": 0.8,
        },
    )
    monkeypatch.setattr(
        stda,
        "retrieve",
        lambda *_a, **_k: [
            {"id": "#1", "title": "vpn down", "snippet": "cannot connect", "source": "ticket"}
        ],
    )
    monkeypatch.setattr(stda, "_notes_from_similar", lambda *_a, **_k: [])
    monkeypatch.setattr(stda, "_macros_for_query", lambda *_a, **_k: [])
    s = stda.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#12",
            "payload": {"subject": "vpn", "description": "vpn down"},
        }
    )
    assert s is not None
    assert s.output_type == "RECOMMENDATION"
    assert s.tool_name is None
    assert "Duplicate" in (s.summary or "") or "VPN" in (s.summary or "")
    assert s.payload.get("possible_duplicates") == ["#1"]


def test_wloa_stays_quiet_when_load_is_even(monkeypatch):
    monkeypatch.setattr(
        wloa,
        "run_agent_llm",
        lambda *_a, **_k: {"needed": True, "notes": "should not run", "confidence": 0.9},
    )
    monkeypatch.setattr(
        "app.tools.ticket_read.list_tickets",
        lambda **k: {
            "payload": [
                {"status": "Open", "assignee": "Jane"},
                {"status": "Open", "assignee": "Alex"},
            ]
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_agents",
        lambda **k: {"payload": [{"name": "Jane"}, {"name": "Alex"}]},
    )
    assert wloa.propose({"organization_id": "org-1", "event_type": "schedule.wloa"}) is None


def test_wloa_persists_brief_and_itra_reads_it(monkeypatch):
    """WLOA stores a load brief; ITRA injects it. WLOA still does not assign."""
    monkeypatch.setattr(
        wloa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "notes": "Jane has 3 open tickets and Alex has 1 — move one ticket to Alex.",
            "overloaded": ["Jane"],
            "lighter": ["Alex"],
            "confidence": 0.8,
        },
    )
    monkeypatch.setattr(
        "app.tools.ticket_read.list_tickets",
        lambda **k: {
            "payload": [
                {"status": "Open", "assignee": "Jane"},
                {"status": "Open", "assignee": "Jane"},
                {"status": "Open", "assignee": "Jane"},
                {"status": "Open", "assignee": "Alex"},
            ]
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_agents",
        lambda **k: {"payload": [{"name": "Jane"}, {"name": "Alex"}]},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_queues",
        lambda **k: {"payload": []},
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.get_metrics",
        lambda **k: {"payload": {}},
    )
    w = wloa.propose({"organization_id": "org-1", "event_type": "schedule.wloa"})
    assert w is not None
    assert w.tool_name is None
    brief = get_wloa_brief("org-1")
    assert brief.get("notes", "").startswith("Jane has 3")
    assert brief.get("overloaded") == ["Jane"]
    assert brief.get("lighter") == ["Alex"]

    captured: dict = {}

    def fake_itra_llm(_agent, system, user):
        captured["system"] = system
        captured["user"] = user
        return {}

    monkeypatch.setattr(itra, "run_agent_llm", fake_itra_llm)
    monkeypatch.setattr(
        "app.tasks.assign.list_org_agents",
        lambda *_a, **_k: [
            {"id": "1", "name": "Jane", "role": "agent"},
            {"id": "2", "name": "Alex", "role": "resolver"},
        ],
    )
    monkeypatch.setattr(
        "app.tasks.assign.org_skills_by_user",
        lambda *_a, **_k: {"1": ["ccaas"], "2": ["ccaas"]},
    )
    monkeypatch.setattr("app.tasks.assign.list_org_teams", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_assignee",
        lambda *_a, **_k: {"Jane": 3},
    )
    monkeypatch.setattr(
        "app.tasks.assign.open_workload_by_resolver",
        lambda *_a, **_k: {"Alex": 1},
    )
    itra.route_assignment(
        organization_id="org-1",
        issue="ccaas contact missing in UI",
        skill_hint="ccaas",
    )
    user = str(captured.get("user") or "")
    assert "overloaded=Jane" in user
    assert "lighter=Alex" in user
    assert "Jane has 3" in user
    assert "Never pick a WLOA name that lacks a skill match" in str(
        captured.get("system") or ""
    )


def test_rcaa_preserves_wloa_brief(monkeypatch):
    set_wloa_brief(
        "org-1",
        {"notes": "keep me", "overloaded": ["Jane"], "lighter": ["Alex"]},
    )
    monkeypatch.setattr(
        rcaa,
        "run_agent_llm",
        lambda *_a, **_k: {
            "needed": True,
            "weights": {"billing": 1.2},
            "recurring_issues": [{"theme": "invoices", "routing_hint": "billing"}],
            "notes": "learned billing pattern for routing",
            "confidence": 0.7,
        },
    )
    p = rcaa.propose({"organization_id": "org-1", "event_type": "schedule.rcaa"})
    assert p is not None
    learned = get_routing_weights("org-1")
    assert learned.get("skill_weights") == {"billing": 1.2}
    assert get_wloa_brief("org-1").get("notes") == "keep me"


def test_retrieval_ranks_semantic_kb_hits(monkeypatch):
    seen: dict = {}

    def _search_kb(**k):
        seen.update(k)
        return {
            "success": True,
            "payload": {
                "hit": {
                    "article_id": "a1",
                    "title": "Reset VPN client",
                    "text": "vpn tunnel steps",
                    "steps": ["Reconnect the client"],
                    "symptoms": ["vpn tunnel"],
                    "score": 0.88,
                }
            },
        }

    monkeypatch.setattr("app.tools.catalog_tools.search_kb", _search_kb)
    hits = retrieve("vpn tunnel client", source="kb", limit=2)
    assert seen.get("query") == "vpn tunnel client"
    assert hits
    assert hits[0]["id"] == "a1"
    assert len(hits) == 1


def test_retrieval_matches_paraphrased_vpn_title(monkeypatch):
    """Ticket phrase must still hit a differently worded published article."""
    monkeypatch.setattr(
        "app.tools.catalog_tools.search_kb",
        lambda **k: {
            "success": True,
            "payload": {
                "hit": {
                    "article_id": "vpn-1",
                    "title": "What to Do When Your VPN Won't Connect",
                    "text": "switch servers, change protocol, check firewall, flush DNS",
                    "score": 0.8,
                }
            },
        },
    )
    hits = retrieve(
        "VPN not connecting after password reset",
        source="kb",
        limit=2,
    )
    assert hits
    assert hits[0]["id"] == "vpn-1"


def test_rkaa_proposes_when_llm_empty_but_kb_matches(monkeypatch):
    monkeypatch.setattr(
        rkaa,
        "retrieve",
        lambda *_a, **_k: [
            {
                "source": "kb",
                "id": "vpn-1",
                "title": "What to Do When Your VPN Won't Connect",
                "snippet": "switch servers…",
                "score": 0.42,
            }
        ]
        if _k.get("source") == "kb"
        else [],
    )
    monkeypatch.setattr(rkaa, "run_agent_llm", lambda *_a, **_k: {})
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {
            "success": True,
            "payload": {
                "subject": "VPN not connecting after password reset",
                "description": "VPN not connecting after password reset",
                "ticketNumber": "#12",
            },
        },
    )
    p = rkaa.propose(
        {
            "organization_id": "1",
            "ticket_number": "#12",
            "event_type": "ticket.created",
            "payload": {
                "subject": "VPN not connecting after password reset",
                "description": "VPN not connecting after password reset",
            },
        }
    )
    assert p is not None
    assert p.agent_id == "rkaa"
    assert p.output_type == "RECOMMENDATION"
    assert "VPN" in (p.summary or "")
    assert (p.payload or {}).get("next_best_action") is True


def test_rkaa_respects_needed_false(monkeypatch):
    monkeypatch.setattr(
        rkaa,
        "retrieve",
        lambda *_a, **_k: [
            {"source": "kb", "id": "x", "title": "Unrelated", "snippet": "", "score": 0.1}
        ]
        if _k.get("source") == "kb"
        else [],
    )
    monkeypatch.setattr(
        rkaa,
        "run_agent_llm",
        lambda *_a, **_k: {"needed": False, "notes": "not related", "confidence": 0.9},
    )
    assert (
        rkaa.propose(
            {
                "organization_id": "1",
                "ticket_number": "#99",
                "event_type": "ticket.created",
                "payload": {"subject": "hello"},
            }
        )
        is None
    )


def test_proactive_http_requires_tasks_key():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    res = client.post(
        "/proactive/event",
        json={
            "event_type": "ticket.created",
            "organization_id": "org-1",
        },
    )
    assert res.status_code == 401


def test_proactive_http_event_and_lists(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app

    monkeypatch.setattr(
        icpa,
        "run_agent_llm",
        lambda *_a, **_k: {"priority": "low", "confidence": 0.2},
    )
    monkeypatch.setattr(
        itra,
        "route_assignment",
        lambda **_k: {
            "agent": None,
            "agent_id": None,
            "resolver": None,
            "resolver_id": None,
            "rationale": "ITRA: test stub",
            "confidence": 0.2,
            "via": "itra",
            "weights_applied": False,
        },
    )
    monkeypatch.setattr(
        rkaa,
        "run_agent_llm",
        lambda *_a, **_k: {"notes": "kb", "confidence": 0.2},
    )
    monkeypatch.setattr(
        stda,
        "run_agent_llm",
        lambda *_a, **_k: {"notes": "none", "confidence": 0.2},
    )
    headers = {"X-Coworker-Tasks-Key": "worktual-tasks-dev-secret"}
    client = TestClient(app)
    res = client.post(
        "/proactive/event",
        headers=headers,
        json={
            "id": "http-evt-1",
            "event_type": "ticket.created",
            "organization_id": "org-1",
            "ticket_number": "#55",
            "payload": {"ticket_number": "#55", "subject": "printer jam"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("ok") is True
    assert isinstance(body.get("results"), list)
    recs = client.get(
        "/proactive/recommendations",
        headers=headers,
        params={"organization_id": "org-1"},
    )
    assert recs.status_code == 200
    assert "items" in recs.json()
    appr = client.get(
        "/proactive/approvals",
        headers=headers,
        params={"organization_id": "org-1"},
    )
    assert appr.status_code == 200
    assert "items" in appr.json()


# --- Spec acceptance (§3, §4, §11) — every ACTION_PROPOSAL + isolation ---

ACTION_PROPOSAL_AGENTS = ("tcaa", "icpa", "itra", "sema", "crda", "ara", "pna", "tsaa")
# RCAA keeps output_type RECOMMENDATION but ASGA executes silently (no Approvals card).
RECOMMENDATION_AGENTS = ("dssa", "rkaa", "wloa", "tiaa", "stda")
CATALOG_TOOLS = {name for names in TOOL_ALLOWLIST.values() for name in names}


def test_spec_asga_is_middleware_not_peer_and_not_llm():
    import inspect
    from app.proactive import asga as asga_mod

    assert "asga" not in AGENTS
    src = inspect.getsource(asga_mod)
    assert "get_llm" not in src
    assert "run_agent_llm" not in src


def test_spec_chat_frozen_no_proactive_in_orchestrator():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "app" / "agents"
    for name in (
        "workflow_manager.py",
        "tickets.py",
        "admin.py",
        "router.py",
        "general.py",
    ):
        text = (root / name).read_text(encoding="utf-8")
        assert "app.proactive" not in text
        assert "proactive." not in text


def test_spec_every_agent_declares_full_contract():
    for agent_id, mod in AGENTS.items():
        spec = mod.SPEC
        assert spec.trigger
        assert spec.inputs_required
        assert spec.tools_used
        assert spec.output_type in {"RECOMMENDATION", "ACTION_PROPOSAL"}
        assert spec.risk_level in {"low", "high"}
        assert 0 < spec.confidence_threshold <= 1
        assert spec.audit_event
        for tool in spec.tools_used:
            assert tool in CATALOG_TOOLS
            assert "/" not in tool
            assert not tool.startswith("SELECT")


def test_spec_action_proposal_low_confidence_high_risk_idempotent():
    executed: list = []
    for agent_id in ACTION_PROPOSAL_AGENTS:
        spec = AGENTS[agent_id].SPEC
        tool = next(iter(spec.tools_used))
        # Prefer a write/notify tool so gate paths stay meaningful for each agent.
        if agent_id == "pna":
            tool = "send_staff_notification"
        low = _proposal(
            agent_id=agent_id,
            confidence=max(0.0, spec.confidence_threshold - 0.05),
            output_type="ACTION_PROPOSAL",
            risk_level=spec.risk_level,
            tool_name=tool,
            event_id=f"idemp-{agent_id}",
        )
        low_gate = gate(low)
        if tool == "send_staff_notification":
            # Inbox pings: low confidence skips delivery (no Approvals queue).
            assert low_gate.decision == "reject"
            assert low_gate.reason == "low_confidence"
        else:
            assert low_gate.decision == "recommend"
            assert low_gate.reason == "low_confidence"

        high = _proposal(
            agent_id=agent_id,
            confidence=0.99,
            output_type="ACTION_PROPOSAL",
            risk_level="high",
            tool_name=tool,
        )
        high_gate = gate(high)
        if tool == "send_staff_notification":
            assert high_gate.decision == "execute"
            assert high_gate.reason == "inbox_notification"
        else:
            assert high_gate.decision == "approve"

        once = _proposal(
            agent_id=agent_id,
            confidence=0.99,
            output_type="ACTION_PROPOSAL",
            risk_level=spec.risk_level,
            tool_name=tool,
            event_id=f"dup-{agent_id}",
        )
        first = gate(once, already_handled=False)
        second = gate(once, already_handled=True)
        assert second.decision == "reject"
        assert second.reason == "idempotent_skip"
        if first.decision == "execute":
            executed.append(agent_id)
    assert "crda" not in executed


def test_spec_recommendation_agents_never_execute_tools():
    for agent_id in RECOMMENDATION_AGENTS:
        spec = AGENTS[agent_id].SPEC
        assert spec.output_type == "RECOMMENDATION"
        p = _proposal(
            agent_id=agent_id,
            confidence=0.99,
            output_type="RECOMMENDATION",
            risk_level="low",
            tool_name=next(iter(spec.tools_used)),
        )
        result = gate(p)
        assert result.decision == "recommend"


def test_spec_close_send_steal_always_approval():
    for kwargs in (
        {"tool_name": "update_ticket", "tool_args": {"status": "closed"}},
        {"tool_name": "update_ticket", "tool_args": {"status": "resolved"}},
        {
            "agent_id": "crda",
            "tool_name": "add_ticket_note",
            "tool_args": {"visibility": "public", "text": "hi", "ticket_number": "#1"},
        },
        {
            "agent_id": "itra",
            "tool_name": "update_ticket",
            "tool_args": {"assignee": "Bob", "steal_assignment": True},
        },
        {"agent_id": "sema", "tool_name": "escalate_ticket", "tool_args": {"ticket_number": "#1"}},
        {
            "agent_id": "ara",
            "risk_level": "high",
            "tool_name": "update_ticket",
            "tool_args": {"status": "resolved"},
        },
    ):
        p = _proposal(confidence=0.99, output_type="ACTION_PROPOSAL", **kwargs)
        assert gate(p).decision == "approve", kwargs


def test_pna_notification_executes_without_approval():
    """Personalized Notifications deliver to the inbox; no Approvals Confirm/Reject."""
    p = _proposal(
        confidence=0.99,
        output_type="ACTION_PROPOSAL",
        agent_id="pna",
        risk_level="high",  # even if mislabeled high-risk
        tool_name="send_staff_notification",
        tool_args={"user_id": "u", "title": "t", "message": "m"},
    )
    gated = gate(p)
    assert gated.decision == "execute"
    assert gated.reason == "inbox_notification"
    assert pna.SPEC.risk_level == "low"


def test_list_org_approvals_drains_stale_pna(monkeypatch):
    """Stale PNA pending rows are delivered to the bell and hidden from Approvals."""
    from app.proactive import runtime as runtime_mod
    from app.proactive.store import insert_approval, reset_memory

    reset_memory()
    row = insert_approval(
        {
            "organization_id": "org-1",
            "agent_id": "pna",
            "summary": "Ticket Assignment Update",
            "tool_name": "send_staff_notification",
            "tool_args": {"user_id": "u", "title": "t", "message": "m"},
        }
    )
    other = insert_approval(
        {
            "organization_id": "org-1",
            "agent_id": "itra",
            "summary": "Assign Bob",
            "tool_name": "update_ticket",
            "tool_args": {"assignee": "Bob"},
        }
    )
    calls: list[str] = []

    def fake_exec(agent_id, tool, args, **kwargs):
        calls.append(tool)
        return {"ok": True}

    monkeypatch.setattr(runtime_mod, "execute_tool", fake_exec)
    items = runtime_mod.list_org_approvals("org-1")
    assert calls == ["send_staff_notification"]
    assert all(str(i.get("id")) != str(row["id"]) for i in items)
    assert any(str(i.get("id")) == str(other["id"]) for i in items)

def test_spec_asga_audit_before_tool_execute(monkeypatch):
    from app.proactive import store as store_mod

    order: list[str] = []

    def fake_exec(*_a, **_k):
        order.append("tool")
        return {"success": True}

    orig_audit = store_mod.write_audit

    def wrapped_audit(row):
        order.append("audit")
        return orig_audit(row)

    monkeypatch.setattr(store_mod, "write_audit", wrapped_audit)
    monkeypatch.setattr("app.proactive.runtime.execute_tool", fake_exec)
    monkeypatch.setattr("app.proactive.runtime.write_audit", wrapped_audit)
    p = _proposal(confidence=0.99, agent_id="icpa", tool_name="update_ticket")
    out = handle_proposal(p)
    assert out and out["status"] == "executed"
    assert order[0] == "audit"
    assert "tool" in order
    assert order.index("audit") < order.index("tool")


def test_spec_dssa_never_closes_or_creates():
    assert "create_ticket" not in dssa.SPEC.tools_used
    assert "update_ticket" not in dssa.SPEC.tools_used
    assert dssa.SPEC.output_type == "RECOMMENDATION"


def test_native_portal_prepare_dssa_seeds_pending_kb(monkeypatch):
    """Portal issue with KB hit → draft awaiting kb_resolution + dssa agent meta."""
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.orchestrator import prepare_portal_dssa

    monkeypatch.setattr(
        "app.proactive.dssa.evaluate_deflection",
        lambda *a, **k: {
            "deflect": True,
            "reply": "Try the VPN reconnect steps in the article.",
            "confidence": 0.92,
            "article_ids": ["a-vpn"],
            "chosen_articles": [
                {
                    "id": "a-vpn",
                    "title": "VPN connection issues",
                    "category": "Network",
                    "content": "1. Disconnect\n2. Reconnect",
                }
            ],
        },
    )
    memory = SharedMemory(organization_id="org1", user_id="c1", session_id="s1")
    request = RunRequest(
        message="i am facing the VPN connection issue",
        session_id="s1",
        actor=ActorContext(
            user_id="c1",
            organization_id="org1",
            user_role="portal_customer",
            user_name="Alex",
        ),
        module="portal",
        surface="home",
        page="Support portal",
        page_surface="home",
    )
    meta = prepare_portal_dssa(request, memory)
    assert meta.get("agent") == "dssa"
    assert meta.get("dssa_deflected") is True
    assert meta.get("articles")
    assert meta["articles"][0]["title"] == "VPN connection issues"
    draft = memory.durable.get("ticket_draft") or {}
    assert draft.get("surface") == "portal"
    assert draft.get("awaiting") == "kb_resolution"
    assert draft.get("kb_offered") is True
    assert isinstance(draft.get("pending_kb"), dict)
    assert memory.durable.get("active_agent") == "kb"


def test_native_portal_prepare_skips_dssa_on_greeting():
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.orchestrator import prepare_portal_dssa

    memory = SharedMemory(organization_id="org1", user_id="c1", session_id="s1")
    request = RunRequest(
        message="hi",
        session_id="s1",
        actor=ActorContext(
            user_id="c1",
            organization_id="org1",
            user_role="portal_guest",
            user_name="Visitor",
        ),
        module="portal",
        surface="home",
    )
    meta = prepare_portal_dssa(request, memory)
    assert meta.get("agent") == "kb"
    assert not meta.get("articles")
    assert memory.durable.get("ticket_draft") is None


def test_native_portal_prepare_miss_does_not_pin_create(monkeypatch):
    from app.contracts.execution import ActorContext, RunRequest
    from app.memory.session import SharedMemory
    from app.runtime.orchestrator import prepare_portal_dssa

    monkeypatch.setattr(
        "app.proactive.dssa.evaluate_deflection",
        lambda *a, **k: {"deflect": False, "reply": "", "confidence": 0.1, "articles": []},
    )
    memory = SharedMemory(organization_id="org1", user_id="c1", session_id="s1")
    request = RunRequest(
        message="i cannot sign in and need to reset my account password",
        session_id="s1",
        actor=ActorContext(
            user_id="c1",
            organization_id="org1",
            user_role="portal_customer",
            user_name="Alex",
        ),
        module="portal",
        surface="home",
        page="Support portal",
        page_surface="home",
    )
    meta = prepare_portal_dssa(request, memory)
    assert not meta.get("dssa_deflected")
    assert not memory.durable.get("current_workflow")
    draft = memory.durable.get("ticket_draft") or {}
    assert draft.get("awaiting") not in {"confirm", "kb_resolution"}
    assert not draft.get("issue")


def test_task_id_portal_kb_resolution_is_deflection_not_create():
    from app.agents.ticketing_coworker import _task_id_for_active_draft

    assert (
        _task_id_for_active_draft(
            "create_ticket",
            "ticket_draft",
            {
                "surface": "portal",
                "awaiting": "kb_resolution",
                "pending_kb": {"articles": [{"id": "a1", "title": "VPN"}]},
            },
        )
        == "intake.self.service.deflection"
    )
    assert (
        _task_id_for_active_draft(
            "create_ticket",
            "ticket_draft",
            {
                "surface": "portal",
                "awaiting": "confirm",
                "kb_offered": True,
                "pending_kb": {"articles": []},
            },
        )
        == "ticket.create"
    )
    assert (
        _task_id_for_active_draft(
            "create_ticket",
            "ticket_draft",
            {"awaiting": "issue", "customerName": "Ada"},
        )
        == "ticket.create"
    )


def test_portal_articles_from_list_kb_outcome():
    from app.memory.session import SharedMemory
    from app.runtime.orchestrator import _portal_articles_from_memory

    memory = SharedMemory(organization_id="org1", user_id="c1", session_id="s1")
    memory.durable["last_tool_outcome"] = {
        "tool": "list_kb",
        "payload": {
            "articles": [
                {
                    "id": "KB-1",
                    "title": "Reset password",
                    "excerpt": "Use the login page reset link.",
                }
            ]
        },
    }
    rows = _portal_articles_from_memory(memory)
    assert rows[0]["title"] == "Reset password"
    assert rows[0]["id"] == "KB-1"


def test_hydrate_portal_force_create_only_after_kb_confirm():
    from app.agents.ticketing_coworker import _hydrate_portal_create_ticket_args
    from app.memory.session import SharedMemory

    memory = SharedMemory(organization_id="org1", user_id="c1", session_id="s1")
    memory.durable["ticket_draft"] = {
        "issue": "vpn down",
        "pending_kb": {"articles": [{"id": "a1"}]},
        "kb_offered": True,
        "awaiting": "kb_resolution",
    }
    mid = _hydrate_portal_create_ticket_args(memory, {})
    assert not mid.get("force_create")
    memory.durable["ticket_draft"]["awaiting"] = "confirm"
    done = _hydrate_portal_create_ticket_args(memory, {})
    assert done.get("force_create") is True


def test_native_portal_kb_prompt_uses_self_service():
    from app.prompts.builder import build_kb_prompt

    text = build_kb_prompt(
        module="portal",
        surface="home",
        memory_snapshot={"durable": {}},
        actor_role="portal_customer",
        page="Support portal",
    )
    assert "CUSTOMER SUPPORT PORTAL" in text or "self-service" in text.lower()
    assert "customerName" not in text or "Never ask for the customer's full name" in text
    assert "Never ask for the customer's full name" in text


def test_spec_icpa_before_itra_on_ticket_created():
    from app.proactive.registry_agents import agents_for_event

    order = [aid for aid, _ in agents_for_event("ticket.created")]
    assert order.index("icpa") < order.index("itra")


def test_spec_shared_retrieval_one_module():
    import app.proactive.rkaa as rkaa_mod
    import app.proactive.stda as stda_mod
    from app.proactive import retrieval as retrieval_mod

    # RKAA + STDA share one retrieval module (DSSA lists published KB itself).
    assert rkaa_mod.retrieve is retrieval_mod.retrieve
    assert stda_mod.retrieve is retrieval_mod.retrieve


def test_spec_failed_retrieval_does_not_fabricate(monkeypatch):
    monkeypatch.setattr(
        "app.tools.catalog_tools.search_kb",
        lambda **k: {"success": True, "payload": {"hit": None}},
    )
    monkeypatch.setattr("app.tools.ticket_read.list_tickets", lambda **k: {"payload": {}})
    hits = retrieve("anything at all", source="both", limit=5)
    assert hits == []


def test_spec_tsaa_recommendation_does_not_mutate(monkeypatch):
    # Kept name for suite stability; TSAA now auto-executes ai_summary writes.
    executed: list = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: executed.append(a) or {"success": True},
    )
    monkeypatch.setattr(
        tsaa,
        "run_agent_llm",
        lambda *_a, **_k: {"summary": "Customer is blocked on VPN.", "confidence": 0.9},
    )
    monkeypatch.setattr(
        tsaa,
        "_load_context",
        lambda *_a, **_k: ({"ticketNumber": "#80"}, {}, []),
    )
    tsaa._last.clear()
    p = tsaa.propose(
        {
            "event_type": "ticket.comment_added",
            "organization_id": "org-1",
            "ticket_number": "#80",
            "payload": {"ticket_number": "#80"},
        }
    )
    assert p is not None
    assert p.output_type == "ACTION_PROPOSAL"
    out = handle_proposal(p)
    assert out["status"] == "executed"
    assert executed


def test_spec_sema_alert_vs_near_breach(monkeypatch):
    monkeypatch.setattr(
        sema,
        "run_agent_llm",
        lambda *_a, **_k: {
            "action": "alert",
            "ticket_number": "#90",
            "rationale": "2h left",
            "confidence": 0.9,
        },
    )
    alert = sema.propose(
        {
            "event_type": "ticket.updated",
            "organization_id": "org-1",
            "ticket_number": "#90",
            "payload": {"ticket_number": "#90"},
        }
    )
    assert alert is not None
    assert alert.output_type == "RECOMMENDATION"
    assert "SLA check" not in (alert.summary or "")
    assert "2h left" in (alert.summary or "")
    assert handle_proposal(alert)["status"] == "recommendation"

    sema._swept.clear()
    monkeypatch.setattr(
        sema,
        "run_agent_llm",
        lambda *_a, **_k: {
            "action": "escalate",
            "ticket_number": "#91",
            "assignee": "Jane Smith",
            "rationale": "near breach",
            "near_breach": True,
            "confidence": 0.9,
        },
    )
    executed: list = []
    monkeypatch.setattr(
        "app.proactive.runtime.execute_tool",
        lambda *a, **k: executed.append(a) or {"success": True},
    )
    esc = sema.propose(
        {
            "event_type": "ticket.updated",
            "organization_id": "org-1",
            "ticket_id": "tid-91",
            "ticket_number": "#91",
            "payload": {"ticket_number": "#91"},
        }
    )
    assert esc is not None
    assert esc.output_type == "ACTION_PROPOSAL"
    assert esc.tool_name == "escalate_ticket"
    out = handle_proposal(esc)
    assert out["status"] == "queued"
    assert executed == []


def test_sema_stays_quiet_when_no_sla_risk(monkeypatch):
    monkeypatch.setattr(
        sema,
        "run_agent_llm",
        lambda *_a, **_k: {"action": "none", "rationale": "SLA check", "confidence": 0.9},
    )
    out = sema.propose(
        {
            "event_type": "schedule.sema",
            "organization_id": "org-1",
            "ticket_number": "#90",
            "payload": {"ticket_number": "#90"},
        }
    )
    assert out is None


def test_spec_rkaa_stored_for_chat_tool_not_orchestrator():
    assert "list_ticket_recommendations" in TOOL_ALLOWLIST["tickets"]
    assert "list_ticket_recommendations" in TOOL_ALLOWLIST["rkaa"]
    assert rkaa.SPEC.output_type == "RECOMMENDATION"


def test_spec_tiaa_tool_on_frozen_admin_specialist():
    from app.tools.registry import SEMANTIC_REPORTING_AGENTS

    assert "ask_semantic_layer" not in TOOL_ALLOWLIST["admin"]
    assert "ask_knowledge_graph" in TOOL_ALLOWLIST["admin"]
    assert "ask_semantic_layer" in TOOL_ALLOWLIST["tiaa"]
    assert "ask_knowledge_graph" in TOOL_ALLOWLIST["tiaa"]
    assert "get_analytics" in TOOL_ALLOWLIST["tiaa"]
    assert "ask_semantic_layer" in TOOL_ALLOWLIST["analytics_audit_query_executor"]
    assert "ask_semantic_layer" in TOOL_ALLOWLIST["insights_analytics_executor"]
    assert "ask_semantic_layer" not in TOOL_ALLOWLIST["ticket_lifecycle_executor"]
    assert "ask_semantic_layer" not in TOOL_ALLOWLIST["root_cause_learning_executor"]
    assert SEMANTIC_REPORTING_AGENTS == frozenset(
        {
            "analytics_audit_query_executor",
            "insights_analytics_executor",
            "tiaa",
        }
    )


def test_ask_semantic_layer_sends_organization_id(monkeypatch):
    from app.tools.catalog_tools import ask_semantic_layer
    from app.tools.express_client import ToolActor, tool_actor_scope

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"open_tickets_metric": 12}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["url"] = url
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1001", organization_id="1000", user_role="admin")
    ):
        out = ask_semantic_layer(
            metrics=["open_tickets_metric"],
            agent="analytics_audit_query_executor",
        )
    get_settings.cache_clear()
    assert out.get("success") is True
    assert captured["url"].endswith("/v1/semantic/query")
    assert captured["json"]["organizationId"] == 1000
    assert captured["json"]["userId"] == 1001
    assert captured["json"]["metrics"] == ["open_tickets_metric"]
    assert captured["json"]["product"] == "ticketing"
    assert captured["json"]["agent"] == "analytics_audit_query_executor"


def test_ask_semantic_layer_requires_context_layer_url(monkeypatch):
    from app.tools.catalog_tools import ask_semantic_layer
    from app.tools.express_client import ToolActor, tool_actor_scope

    monkeypatch.delenv("CONTEXT_LAYER_URL", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    with tool_actor_scope(
        ToolActor(user_id="1001", organization_id="1000", user_role="admin")
    ):
        out = ask_semantic_layer(
            metrics=["open_tickets_metric"],
            agent="analytics_audit_query_executor",
        )
    get_settings.cache_clear()
    assert out.get("success") is False
    assert "CONTEXT_LAYER_URL" in str(out.get("message") or "")


def test_get_ontology_slice_uses_runtime_agent_id(monkeypatch):
    from app.tools.catalog_tools import clear_ontology_slice_cache, get_ontology_slice

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {
                "prompt": "You may list tickets.",
                "metrics": [],
                "agent": "ticket_lifecycle_executor",
            }

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["url"] = url
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    out = get_ontology_slice(
        organization_id="1000",
        user_id="1005",
        agent="ticket_lifecycle_executor",
    )
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is True
    assert captured["url"].endswith("/v1/ontology/slice")
    assert captured["json"]["agent"] == "ticket_lifecycle_executor"
    assert captured["json"]["organizationId"] == 1000
    assert captured["json"]["userId"] == 1005
    assert captured["json"]["product"] == "ticketing"


def test_ask_semantic_layer_context_layer_uses_metrics(monkeypatch):
    from app.tools.catalog_tools import (
        _ONTOLOGY_SLICE_CACHE,
        ask_semantic_layer,
        clear_ontology_slice_cache,
    )
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"open_tickets_metric": 12}], "status": "ok"}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["url"] = url
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    _ONTOLOGY_SLICE_CACHE[("1000", "1005", "analytics_audit_query_executor")] = {
        "prompt": "",
        "metrics": [
            {
                "id": "open_tickets_metric",
                "dims": ["queue_name", "assignee_name"],
            }
        ],
    }
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(metrics=["open_tickets_metric"])
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is True
    assert captured["url"].endswith("/v1/semantic/query")
    assert captured["json"]["organizationId"] == 1000
    assert captured["json"]["userId"] == 1005
    assert captured["json"]["agent"] == "analytics_audit_query_executor"
    assert captured["json"]["metrics"] == ["open_tickets_metric"]
    assert captured["json"]["product"] == "ticketing"
    assert "query" not in captured["json"]


def test_ask_semantic_layer_coerces_json_string_metrics(monkeypatch):
    from app.tools.catalog_tools import (
        ask_semantic_layer,
        clear_ontology_slice_cache,
    )
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"tickets_created_today_metric": 4}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(
                metrics='["tickets_created_today_metric"]',
            )
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is True
    assert captured["json"]["metrics"] == ["tickets_created_today_metric"]


def test_ask_semantic_layer_surfaces_context_layer_400_detail(monkeypatch):
    from app.tools.catalog_tools import (
        ask_semantic_layer,
        clear_ontology_slice_cache,
    )
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    class _FakeResp:
        status_code = 400

        def json(self):
            return {
                "detail": {
                    "code": "invalid_metric",
                    "message": "unknown metric id",
                }
            }

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(metrics=["tickets_created_today_metric"])
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is False
    assert out.get("error_code") == "VALIDATION_ERROR"
    assert "unknown metric id" in str(out.get("message") or "")
    assert out.get("payload", {}).get("status_code") == 400


def test_ontology_slice_prompt_block_metrics_without_prompt(monkeypatch):
    from app.tools.catalog_tools import (
        _ONTOLOGY_SLICE_CACHE,
        clear_ontology_slice_cache,
        ontology_slice_prompt_block,
    )

    clear_ontology_slice_cache()
    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    _ONTOLOGY_SLICE_CACHE[("1000", "1005", "analytics_audit_query_executor")] = {
        "prompt": "",
        "metrics": [{"id": "ticket_volume", "dims": ["queue_name"]}],
    }
    block = ontology_slice_prompt_block(
        organization_id="1000",
        user_id="1005",
        agent="analytics_audit_query_executor",
    )
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert "Certified metrics" in block
    assert "closest purpose" in block
    assert "ticket_volume" in block
    assert "queue_name" in block


def test_ask_semantic_layer_forbidden_for_non_reporting_agents(monkeypatch):
    from app.tools.catalog_tools import ask_semantic_layer
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("ticket_lifecycle_executor"):
            out = ask_semantic_layer(metrics=["ticket_volume"])
        with runtime_agent_scope("root_cause_learning_executor"):
            rcaa_out = ask_semantic_layer(metrics=["ticket_volume"])
    get_settings.cache_clear()
    assert out.get("success") is False
    assert out.get("error_code") == "FORBIDDEN"
    assert rcaa_out.get("success") is False
    assert rcaa_out.get("error_code") == "FORBIDDEN"


def test_ask_semantic_layer_passes_non_headline_metric_to_context_layer(monkeypatch):
    from app.tools.catalog_tools import (
        _ONTOLOGY_SLICE_CACHE,
        ask_semantic_layer,
        clear_ontology_slice_cache,
    )
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"ticket_count": 3}], "status": "ok"}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    _ONTOLOGY_SLICE_CACHE[("1000", "1005", "analytics_audit_query_executor")] = {
        "prompt": "",
        "metrics": [{"id": "open_tickets_metric", "dims": ["queue_name"]}],
    }
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(
                metrics=["ticket_count"],
                group_by=["queue"],
            )
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is True
    assert captured["json"]["metrics"] == ["ticket_count"]


def test_get_ontology_slice_remaps_proactive_agent_id(monkeypatch):
    from app.tools.catalog_tools import clear_ontology_slice_cache, get_ontology_slice

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"prompt": "insights", "metrics": [{"id": "open_tickets_metric"}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    out = get_ontology_slice(organization_id="1000", user_id="1005", agent="tiaa")
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is True
    assert captured["json"]["agent"] == "insights_analytics_executor"


def test_ask_semantic_layer_remaps_tiaa_to_insights_executor(monkeypatch):
    from app.tools.catalog_tools import ask_semantic_layer, clear_ontology_slice_cache
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"open_tickets_metric": 1}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("tiaa"):
            out = ask_semantic_layer(metrics=["open_tickets_metric"])
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is True
    assert captured["json"]["agent"] == "insights_analytics_executor"


def test_context_layer_http_error_maps_kpi_message_without_code():
    from app.tools.catalog_tools import _context_layer_http_error

    class _Resp:
        status_code = 400

        def json(self):
            return {
                "detail": {
                    "message": "Agent 'ticket_lifecycle_executor' cannot run KPI queries. Route to reporting agent."
                }
            }

    out = _context_layer_http_error(_Resp())
    assert out.get("success") is False
    assert out.get("error_code") == "FORBIDDEN"
    assert (out.get("payload") or {}).get("kpi_not_allowed") is True


def test_ask_sql_layer_list_tickets(monkeypatch):
    from app.tools.catalog_tools import ask_sql_layer
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {
                "rows": [{"ticket_id": "115", "status": "open"}],
                "_meta": {"source": "sql_list", "presetId": "tk.tickets"},
            }

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["url"] = url
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("ticket_lifecycle_executor"):
            out = ask_sql_layer(
                instruction="List open tickets assigned to the current user",
                entity_hint="wt:Ticket",
            )
    get_settings.cache_clear()
    assert out.get("success") is True
    assert captured["url"].endswith("/v1/sql/query")
    assert set(captured["json"]) == {
        "organizationId",
        "userId",
        "originProduct",
        "originAgent",
        "instruction",
    }
    assert captured["json"]["originAgent"] == "ticket_lifecycle_executor"
    assert captured["json"]["originProduct"] == "ticketing"
    assert "List open tickets assigned to the current user" in captured["json"]["instruction"]
    assert "Entity dimension: wt:Ticket" in captured["json"]["instruction"]
    rows = out.get("payload", {}).get("rows") or []
    assert rows[0].get("id") == "115"


def test_ask_sql_layer_empty_instruction_is_bad_input():
    from app.tools.catalog_tools import ask_sql_layer
    from app.tools.express_client import ToolActor, runtime_agent_scope, tool_actor_scope

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("ticket_lifecycle_executor"):
            out = ask_sql_layer()
    assert out.get("success") is False
    assert "instruction is required" in str(out.get("message") or "")


def test_ask_sql_layer_accepts_camelcase_and_string_filters(monkeypatch):
    from app.tools.bound import execute_tool_call
    from app.tools.express_client import ToolActor, tool_actor_scope

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"ticket_id": "9", "queue_name": "Billing"}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        raw = execute_tool_call(
            "ticket_lifecycle_executor",
            "ask_sql_layer",
            {
                "instruction": "List overdue tickets sorted by due date",
                "entityHint": "wt:Ticket",
                "filters": '{"due": "overdue"}',
                "limit": "12",
            },
        )
    get_settings.cache_clear()
    out = json.loads(raw)
    assert out.get("success") is True
    assert captured["json"]["originAgent"] == "ticket_lifecycle_executor"
    assert set(captured["json"]) == {
        "organizationId",
        "userId",
        "originProduct",
        "originAgent",
        "instruction",
    }
    text = captured["json"]["instruction"]
    assert "List overdue tickets sorted by due date" in text
    assert "Entity dimension: wt:Ticket" in text
    assert "Limit: 12 rows" in text
    assert "due eq overdue" in text


def test_ask_semantic_layer_maps_time_preset_and_group_by(monkeypatch):
    from app.tools.catalog_tools import ask_semantic_layer
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"open_tickets_metric": 3}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="42", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(
                metrics=["open_tickets_metric"],
                group_by=["queue_name"],
                time={"preset": "last_7d", "grain": "day"},
                data_scope="org",
                filters=[{"field": "priority", "operator": "in", "values": ["high"]}],
            )
    get_settings.cache_clear()
    assert out.get("success") is True
    assert captured["json"]["group_by"] == ["queue_name"]
    assert "groupBy" not in captured["json"]
    assert "orderBy" not in captured["json"]
    assert captured["json"]["time"] == {"grain": "day", "period": "last_7_days"}
    assert captured["json"]["dataScope"] == "org"
    assert captured["json"]["filters"] == [
        {"dimension": "priority", "op": "in", "values": ["high"]}
    ]


def test_ask_semantic_layer_keeps_json_string_time_period(monkeypatch):
    from app.tools.catalog_tools import ask_semantic_layer
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"ticket_volume": 4}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1028", organization_id="1012", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(
                metrics='["ticket_volume"]',
                time='{"period": "this_week", "start": null, "end": null, "grain": null}',
                data_scope="mine",
            )
    get_settings.cache_clear()
    assert out.get("success") is True
    body = captured["json"]
    assert body["metrics"] == ["ticket_volume"]
    assert body["time"] == {"period": "this_week"}
    assert body["dataScope"] == "mine"
    assert "websiteId" not in body
    assert "start" not in body["time"]
    assert "end" not in body["time"]
    assert "grain" not in body["time"]


def test_ask_semantic_layer_prefers_explicit_dates_over_period(monkeypatch):
    from app.tools.catalog_tools import ask_semantic_layer
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"ticket_volume": 4}]}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1028", organization_id="1012", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(
                metrics=["ticket_volume"],
                time={
                    "period": "this_week",
                    "start": "2026-09-15",
                    "end": "2026-09-21",
                    "grain": "day",
                },
            )
    get_settings.cache_clear()
    assert out.get("success") is True
    assert captured["json"]["time"] == {
        "start": "2026-09-15",
        "end": "2026-09-21",
        "grain": "day",
    }
    assert "period" not in captured["json"]["time"]


def test_agent_prompts_include_context_layer_contract():
    from app.prompts.builder import load_agent_definition

    load_agent_definition.cache_clear()
    super_prompt = load_agent_definition("ticketing_super_agent").prompt
    assert "Do not call slice, ask_semantic_layer, or ask_sql_layer" in super_prompt
    domain_prompt = load_agent_definition("catalog_administration_domain").prompt
    assert "Only delegate_to_executor" in domain_prompt
    semantic_prompt = load_agent_definition("analytics_audit_query_executor").prompt
    assert "group_by" in semantic_prompt
    assert "groupBy" not in semantic_prompt
    assert "last_7_days" in semantic_prompt
    assert "read ALL certified metrics and dimensions" in semantic_prompt
    assert "closest match" in semantic_prompt
    sql_prompt = load_agent_definition("ticket_lifecycle_executor").prompt
    assert "Never empty args" in sql_prompt
    assert "rows: []" in sql_prompt
    assert "Do not call `list_tickets` after a successful SQL read" in sql_prompt
    assert "In Progress" in sql_prompt
    assert "status=In Progress" in sql_prompt
    super_prompt_full = load_agent_definition("ticketing_super_agent").prompt
    assert "Do not rewrite In Progress as Open" in super_prompt_full
    other = load_agent_definition("kb_quality_crud_executor").prompt
    assert "Do not call ask_semantic_layer or ask_sql_layer" in other


def test_shared_catalog_lists_ask_sql_layer_schema():
    from app.mcp.catalog import catalog_by_name, clear_catalog_caches

    clear_catalog_caches()
    tool = catalog_by_name()["ask_sql_layer"]
    assert "instruction" in (tool.input_schema.get("required") or [])
    assert "instruction" in (tool.input_schema.get("properties") or {})


def test_ask_semantic_layer_accepts_slice_metric_and_dimension(monkeypatch):
    from app.tools.catalog_tools import (
        _ONTOLOGY_SLICE_CACHE,
        ask_semantic_layer,
        clear_ontology_slice_cache,
    )
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    captured: dict = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {"rows": [{"ticket_volume": 42}], "status": "ok"}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):
            captured["json"] = json
            return _FakeResp()

    monkeypatch.setenv("CONTEXT_LAYER_URL", "http://context.test:8765")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_ontology_slice_cache()
    _ONTOLOGY_SLICE_CACHE[("1000", "1005", "analytics_audit_query_executor")] = {
        "prompt": "",
        "metrics": [{"id": "ticket_volume", "dims": ["queue_name"]}],
    }
    monkeypatch.setattr("httpx.Client", _FakeClient)

    with tool_actor_scope(
        ToolActor(user_id="1005", organization_id="1000", user_role="admin")
    ):
        with runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(
                metrics=["ticket_volume"],
                group_by=["queue_name"],
            )
    get_settings.cache_clear()
    clear_ontology_slice_cache()
    assert out.get("success") is True
    assert captured["json"]["metrics"] == ["ticket_volume"]
    assert captured["json"]["group_by"] == ["queue_name"]
    assert "groupBy" not in captured["json"]
    assert "orderBy" not in captured["json"]


def test_consume_ontology_sse_and_ask_knowledge_graph_org_scope(monkeypatch):
    from app.tools.catalog_tools import ask_knowledge_graph, consume_ontology_sse
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import OPERATION_TOOL

    # Metric ops stay on semantic — ontology is narrative-only.
    assert OPERATION_TOOL["GET_METRICS"] == "ask_semantic_layer"
    assert OPERATION_TOOL["GET_ANALYTICS"] == "ask_semantic_layer"

    parsed = consume_ontology_sse(
        [
            "event: status",
            'data: {"phase":"understanding","label":"Understanding your question…"}',
            "",
            "event: activity",
            'data: {"title":"Pipeline step","status":"running"}',
            "",
            "event: block",
            'data: {"label":"Drivers","summary":"Billing drove the spike.","status":"success"}',
            "",
            "event: text_delta",
            'data: {"delta":"Volume rose because "}',
            "",
            "event: text_delta",
            'data: {"delta":"billing themes dominated."}',
            "",
            "event: done",
            'data: {"elapsed_seconds":1.2,"turnId":"t1"}',
            "",
        ],
        emit=False,
    )
    assert "billing themes" in parsed["answer"]
    assert parsed["turn_id"] == "t1"
    assert any("Understanding" in t for t in parsed["trail"])
    assert any("Pipeline step" in t for t in parsed["trail"])
    assert any("Billing drove" in t for t in parsed["trail"])

    from app.runtime.progress import progress_sink
    import queue

    emit_q: queue.Queue = queue.Queue()
    with progress_sink(emit_q):
        consume_ontology_sse(
            [
                "event: status",
                'data: {"phase":"understanding","label":"Understanding your question…"}',
                "",
                "event: activity",
                'data: {"title":"Pipeline step","status":"running"}',
                "",
                "event: status",
                'data: {"phase":"fetching","label":"Fetching: MATCH (t:Ticket) WITH coalesce(t.channel, \'Unknown\') AS dimensi…"}',
                "",
                "event: tool_call",
                'data: {"id":"call_1","name":"knowledge_graph","arguments":{"cypher_query":"MATCH (t:Ticket) RETURN t"}}',
                "",
                "event: block",
                'data: {"label":"Drivers","summary":"Billing drove the spike.","status":"success"}',
                "",
            ],
            emit=True,
        )
    emitted = []
    while not emit_q.empty():
        emitted.append(emit_q.get_nowait())
    assert all(e.get("kind") == "status" for e in emitted)
    labels = [str(e.get("label") or "") for e in emitted]
    assert any("Understanding your question" in x for x in labels)
    assert any(x == "Fetching analytics…" for x in labels)
    assert not any("MATCH" in x for x in labels)
    assert not any("Pipeline" in x for x in labels)
    assert not any("Billing" in x for x in labels)

    captured: dict = {}

    class _StreamResp:
        status_code = 200

        def iter_lines(self):
            yield from [
                "event: status",
                'data: {"phase":"concepts","label":"Found: Ticket Volume"}',
                "",
                "event: activity",
                'data: {"title":"Searching graph","status":"running"}',
                "",
                "event: block",
                'data: {"label":"Analysis","summary":"Mostly login failures leaked.","status":"success"}',
                "",
                "event: text_delta",
                'data: {"delta":"Mostly login failures."}',
                "",
                "event: done",
                'data: {"elapsed_seconds":0.5,"turnId":"abc"}',
                "",
            ]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def stream(self, method, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            return _StreamResp()

    monkeypatch.setenv("ONTOLOGY_CHAT_URL", "http://ontology.test:8000")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)

    from app.runtime.progress import progress_sink
    import queue

    q: queue.Queue = queue.Queue()
    with tool_actor_scope(
        ToolActor(user_id="u1", organization_id="42", user_role="admin")
    ):
        with progress_sink(q):
            out = ask_knowledge_graph(query="why did tickets increase?", session_id="s1")
    get_settings.cache_clear()

    assert out.get("success") is True
    assert "login failures" in (out.get("payload") or {}).get("answer", "")
    assert captured["json"]["organization_id"] == "42"
    assert captured["json"]["sessionID"] == "s1"
    assert "/chat/stream" in captured["url"]
    # Only status progress events reach the UI (not activity/block/answer text).
    labels = []
    kinds = []
    while not q.empty():
        item = q.get_nowait()
        if isinstance(item, dict) and item.get("label"):
            labels.append(item["label"])
            kinds.append(str(item.get("kind") or ""))
    assert any("knowledge graph" in str(x).lower() for x in labels)
    assert any("Ticket Volume" in str(x) for x in labels)
    assert all(k == "status" for k in kinds)
    assert not any("Searching graph" in str(x) for x in labels)
    assert not any("login failures leaked" in str(x) for x in labels)
    assert not any("Analysis" == str(x) for x in labels)


def test_hub_remainder_body_and_ask_hub_no_cdp(monkeypatch):
    from app.tools.hub_a2a_client import build_remainder_body
    from app.tools.catalog_tools import ask_hub
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import TOOL_ALLOWLIST

    body = build_remainder_body(
        cdp_id="bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
        query="I was charged twice this month and I want that fixed now.",
        organization_id="1000",
        channel="chat",
    )
    assert body == {
        "cdp_id": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
        "spoke": "Ticketing System",
        "recent_event": {
            "channel": "chat",
            "query": "I was charged twice this month and I want that fixed now.",
        },
        "organization_id": 1000,
    }
    assert "ask_hub" in TOOL_ALLOWLIST["general"]
    assert "ask_hub" in TOOL_ALLOWLIST["tickets"]

    with tool_actor_scope(
        ToolActor(user_id="u1", organization_id="1000", user_role="admin")
    ):
        out = ask_hub(query="suggest next best action for this contact")
    err_code = str(out.get("error_code") or "")
    payload_code = str((out.get("payload") or {}).get("code") or "")
    assert out.get("success") is False
    assert err_code == "VALIDATION_ERROR" or payload_code == "NO_CDP" or "cdp" in str(out).lower()


def test_ask_hub_sends_remainder_with_minted_token(monkeypatch):
    from app.tools.catalog_tools import ask_hub
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.config import get_settings

    calls: list[dict] = []

    class _Resp:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload
            self.text = str(payload)
            self.content = b"{}"

        def json(self):
            return self._payload

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None, headers=None):
            calls.append({"url": url, "json": json, "headers": headers or {}})
            if str(url).endswith("/token"):
                return _Resp(
                    200,
                    {
                        "access_token": "hub-access-test",
                        "refresh_token": "hub-refresh-test",
                        "expires_in": 21600,
                    },
                )
            return _Resp(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": "1",
                    "result": {"status": "submitted", "reply": "Hub will follow up."},
                },
            )

    monkeypatch.setenv("HUB_A2A_URL", "http://hub.test:8030")
    monkeypatch.setenv("HUB_A2A_CLIENT_ID", "worktual-ticketing-hub")
    monkeypatch.setenv("HUB_A2A_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("HUB_A2A_SERVER_NAME", "worktual-hub")
    monkeypatch.setenv("HUB_A2A_SPOKE_LABEL", "Ticketing System")
    get_settings.cache_clear()
    monkeypatch.setattr("httpx.Client", _FakeClient)
    monkeypatch.setattr(
        "app.tools.hub_a2a_client._load_client_row",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        "app.tools.hub_a2a_client._persist_tokens",
        lambda **_k: None,
    )

    with tool_actor_scope(
        ToolActor(user_id="u1", organization_id="1000", user_role="admin")
    ):
        out = ask_hub(
            query="Suggest the next best action only.",
            cdp_id="bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
            channel="chat",
        )
    get_settings.cache_clear()

    assert out.get("success") is True
    payload = out.get("payload") or {}
    assert "Hub will follow up" in str(payload.get("reply") or "")
    rem = payload.get("remainder") or {}
    assert rem.get("spoke") == "Ticketing System"
    assert rem.get("cdp_id") == "bbbbbbbb-cccc-4ddd-8eee-ffff00000001"
    assert rem.get("organization_id") == 1000
    assert rem.get("recent_event", {}).get("channel") == "chat"
    assert any(str(c["url"]).endswith("/token") for c in calls)
    invoke = next(
        c
        for c in calls
        if "/token" not in str(c["url"]) and "8030" in str(c["url"])
    )
    assert invoke["headers"].get("Authorization") == "Bearer hub-access-test"
    parts = (
        ((invoke["json"] or {}).get("params") or {}).get("message") or {}
    ).get("parts") or []
    assert parts and parts[0]["data"]["spoke"] == "Ticketing System"


def test_spec_rcaa_has_no_ticket_write_tools():
    writes = {"update_ticket", "create_ticket", "add_ticket_note", "escalate_ticket"}
    assert rcaa.SPEC.tools_used.isdisjoint(writes)
    assert rcaa.SPEC.output_type == "RECOMMENDATION"


def test_spec_rcaa_learning_is_silent_execute_not_approvals():
    """RCAA feeds ITRA weights; ASGA must not insert Approvals recommendations."""
    p = _proposal(
        agent_id="rcaa",
        confidence=0.9,
        output_type="RECOMMENDATION",
        risk_level="low",
        tool_name=None,
        summary="learned billing pattern",
    )
    result = gate(p)
    assert result.decision == "execute"
    assert result.reason == "rcaa_learning"
    out = handle_proposal(p)
    assert out is not None
    assert out["status"] == "executed"
    assert out.get("agent_id") == "rcaa"


def test_spec_pna_preference_hard_gate_not_suggestion(monkeypatch):
    monkeypatch.setattr(
        pna,
        "run_agent_llm",
        lambda *_a, **_k: {"title": "x", "message": "y", "confidence": 0.99},
    )
    assert (
        pna.propose(
            {
                "organization_id": "org-1",
                "event_type": "ticket.updated",
                "payload": {"notify_user_id": "u1", "preference_enabled": False},
            }
        )
        is None
    )


def test_spec_event_vocabulary_has_subscribers():
    from app.proactive.registry_agents import agents_for_event

    vocab = {
        "ticket.created": {"icpa", "itra", "rkaa", "stda", "pna", "tsaa"},
        "ticket.updated": {"sema", "pna", "tsaa", "rqa"},
        "ticket.comment_added": {"tsaa", "pna"},
        "ticket.escalated": {"tsaa"},
        "ticket.sla_at_risk": {"sema", "pna", "tsaa"},
        "customer.replied": {"crda", "pna", "ara", "tsaa"},
        "inbound.message": {"tcaa", "dssa"},
        "on_demand.ara": {"ara"},
        "on_demand.summary": {"tsaa"},
        "schedule.sema": {"sema"},
        "schedule.wloa": {"wloa"},
        "schedule.tiaa": {"tiaa"},
        "schedule.rcaa": {"rcaa"},
    }
    for et, must in vocab.items():
        got = {aid for aid, _ in agents_for_event(et)}
        if et == "inbound.message":
            assert "inbound.message" in dssa.SPEC.trigger
            assert "inbound.message" in tcaa.SPEC.trigger
            continue
        assert must <= got, (et, must - got)


def test_spec_executor_only_catalog_tools():
    from app.proactive.executor import TOOL_FNS

    for name in TOOL_FNS:
        assert name in CATALOG_TOOLS
        assert name in set().union(*TOOL_ALLOWLIST.values())


def test_classify_insights_question_values_vs_why():
    from app.tools.insights_routing import (
        classify_insights_question,
        requires_insights_gateway,
    )

    assert classify_insights_question("how many open tickets do we have") == "values"
    assert classify_insights_question("what is our csat score") == "values"
    assert classify_insights_question("why did ticket volume drop compared to yesterday") == "why"
    assert classify_insights_question("how many tickets and why did volume rise") == "both"
    assert requires_insights_gateway("how many open tickets", "LIST_TICKETS") is True
    assert requires_insights_gateway("average ticket resolution time", "LIST_TICKETS") is True
    assert requires_insights_gateway("how many tickets breached SLA", "LIST_TICKETS") is True
    assert requires_insights_gateway("why are agents not resolving tickets", "LIST_TICKETS") is True
    assert requires_insights_gateway("analyze our ticket resolution trend", "LIST_TICKETS") is True
    assert classify_insights_question("interpret agent performance") == "why"
    assert requires_insights_gateway("show open tickets", "LIST_TICKETS") is False


def test_semantic_result_usable_rejects_no_match():
    from app.tools.insights_routing import semantic_result_usable

    assert (
        semantic_result_usable(
            {
                "success": True,
                "payload": {
                    "how many open tickets": [
                        {
                            "ok": False,
                            "error": {"code": "NO_MATCH_OR_INCOMPLETE"},
                        }
                    ]
                },
            }
        )
        is False
    )
    assert semantic_result_usable({"success": True, "payload": {"openTickets": 12}}) is True


def test_execute_ticket_metrics_prefers_semantic_before_express(monkeypatch):
    from app.agents.workflow_manager import _execute_ticket_metrics
    from app.tools.express_client import ToolActor, tool_actor_scope

    calls: list[str] = []

    def _sem(query, *, organization_id=None, scope_hint=None):
        calls.append("semantic")
        return {"success": True, "payload": {"openTickets": 7}}

    def _ont(query, *, organization_id=None, session_id=None):
        calls.append("ontology")
        return {"success": False}

    monkeypatch.setattr(
        "app.tools.insights_routing.try_semantic_metrics",
        lambda *a, **k: _sem(*a, **k),
    )
    monkeypatch.setattr(
        "app.tools.insights_routing.try_ontology_narrative",
        lambda *a, **k: _ont(*a, **k),
    )
    monkeypatch.setattr(
        "app.tools.insights_routing.log_insights_routing",
        lambda **k: None,
    )
    monkeypatch.setattr(
        "app.tasks.chat_commands._llm_phrase",
        lambda **k: "Seven open tickets.",
    )

    actor = ToolActor(user_id="u1", organization_id="org-1", user_role="admin")
    state = {
        "organization_id": "org-1",
        "session_id": "s1",
        "page": "Home",
        "user_role": "admin",
    }
    request = {"operation": "GET_METRICS", "filters": {"topic": "overview"}}

    with tool_actor_scope(actor):
        out = _execute_ticket_metrics(
            state,
            "how many open tickets",
            request,
            operation="GET_METRICS",
            actor=actor,
            parked_result=None,
            on_home=True,
            fail=lambda r: r,
        )

    assert out.get("data", {}).get("_tool_name") == "ask_semantic_layer"
    assert calls == ["semantic"]
    assert "semantic" in out.get("data", {})


def test_execute_ticket_metrics_routes_why_to_ontology(monkeypatch):
    from app.agents.workflow_manager import _execute_ticket_metrics
    from app.tools.express_client import ToolActor, tool_actor_scope

    monkeypatch.setattr(
        "app.tools.insights_routing.try_semantic_metrics",
        lambda *a, **k: {"success": False},
    )
    monkeypatch.setattr(
        "app.tools.insights_routing.try_ontology_narrative",
        lambda *a, **k: {
            "success": True,
            "payload": {"answer": "Billing themes drove the spike."},
        },
    )
    monkeypatch.setattr(
        "app.tools.insights_routing.log_insights_routing",
        lambda **k: None,
    )
    monkeypatch.setattr(
        "app.tasks.chat_commands._llm_phrase",
        lambda **k: "Billing themes drove the spike.",
    )

    actor = ToolActor(user_id="u1", organization_id="org-1", user_role="admin")
    state = {
        "organization_id": "org-1",
        "session_id": "s1",
        "page": "Analytics",
        "user_role": "admin",
    }
    request = {"operation": "GET_ANALYTICS", "filters": {"topic": "analytics"}}

    with tool_actor_scope(actor):
        out = _execute_ticket_metrics(
            state,
            "why did ticket volume drop compared to yesterday",
            request,
            operation="GET_METRICS",
            actor=actor,
            parked_result=None,
            on_home=False,
            fail=lambda r: r,
        )

    assert out.get("data", {}).get("_tool_name") == "ask_knowledge_graph"
    assert "ontology" in out.get("data", {})


def test_all_proactive_agents_have_valid_harness_bindings():
    from app.proactive.registry_agents import (
        AGENTS,
        PROACTIVE_HARNESS_BINDINGS,
        validate_proactive_harness_bindings,
    )

    assert len(AGENTS) == 15
    assert set(PROACTIVE_HARNESS_BINDINGS) == set(AGENTS)
    validate_proactive_harness_bindings()
    assert (
        PROACTIVE_HARNESS_BINDINGS["itra"]["executor"]
        == "intelligent_assignment_executor"
    )
    assert (
        PROACTIVE_HARNESS_BINDINGS["rqa"]["executor"]
        == "resolution_quality_executor"
    )


def test_lean_ticket_created_domain_sequencer_enrich_then_assign(monkeypatch):
    """Lean insert: triage Domain classify→assign, then resolution Domain summary→notify."""
    calls: list[tuple] = []
    domain_calls: list[dict] = []

    def capture(agent_id, tool_name, args, **kwargs):
        calls.append((agent_id, tool_name, dict(args)))
        return {"success": True, "payload": {"ok": True}}

    def fake_delegate(messages, *, domain_id="triage_routing_domain"):
        domain_calls.append({"domain_id": domain_id, "messages": messages})
        n = sum(1 for c in domain_calls if c["domain_id"] == domain_id)
        if domain_id == "triage_routing_domain":
            if n == 1:
                return {
                    "executor_id": "classification_priority_executor",
                    "task_id": "ticket.classify.prioritize",
                    "skill_name": "ticket-classify-prioritize",
                    "objective": "classify lean ticket",
                }
            return {
                "executor_id": "intelligent_assignment_executor",
                "task_id": "ticket.assign.best",
                "skill_name": "ticket-assign-best",
                "objective": "assign L1/L2",
            }
        if domain_id == "resolution_lifecycle_domain":
            if n == 1:
                return {
                    "executor_id": "investigation_summary_executor",
                    "task_id": "ticket.investigation.summary",
                    "skill_name": "ticket-investigation-summary",
                    "objective": "summarize investigation",
                }
            return {
                "executor_id": "personalized_notification_executor",
                "task_id": "notification.personalize.deliver",
                "skill_name": "notification-personalize-deliver",
                "objective": "notify staff",
            }
        return None

    monkeypatch.setattr("app.proactive.runtime.execute_tool", capture)
    monkeypatch.setattr(
        "app.proactive.runtime._domain_delegate_once", fake_delegate
    )
    monkeypatch.setattr(
        icpa,
        "_triage_enrich_fields",
        lambda **_k: {
            "subject": "Cannot connect to VPN",
            "description": "Customer cannot connect to corporate VPN from home.",
            "priority": "high",
            "category": "Network",
            "queue": "Network Support",
            "skill": "VPN",
            "enrichedByAi": True,
        },
    )
    monkeypatch.setattr(
        itra,
        "route_assignment",
        lambda **_k: {
            "agent": "Jane Smith",
            "agent_id": "j1",
            "resolver": "Alex Resolver",
            "resolver_id": "r1",
            "rationale": "ITRA skill match",
            "confidence": 0.9,
            "via": "itra",
            "weights_applied": False,
        },
    )
    for mod in (rkaa, stda, ara, tsaa, pna):
        if hasattr(mod, "run_agent_llm"):
            monkeypatch.setattr(
                mod,
                "run_agent_llm",
                lambda *_a, **_k: {"confidence": 0.1, "notes": "skip"},
            )
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {
            "payload": {
                "subject": "vpn broken please help me asap from home office",
                "description": "vpn broken please help me asap from home office",
                "assignee": "Unassigned",
                "priority": "medium",
            }
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_queues",
        lambda *_a, **_k: {"payload": []},
    )
    monkeypatch.setattr("app.proactive.rkaa.retrieve", lambda *_a, **_k: [])
    monkeypatch.setattr("app.proactive.stda.retrieve", lambda *_a, **_k: [])

    out = dispatch_event(
        {
            "id": "lean-created-1",
            "event_type": "ticket.created",
            "organization_id": "org-1",
            "ticket_number": "#501",
            "payload": {
                "ticket_number": "#501",
                "subject": "vpn broken please help me asap from home office",
                "description": "vpn broken please help me asap from home office",
                "assignee": "Unassigned",
                "triage_complete": False,
                "harness_triage_complete": False,
                "domain_triage_owned": True,
                "created_by_role": "admin",
            },
        }
    )
    assert len(domain_calls) == 4
    assert (
        sum(1 for c in domain_calls if c["domain_id"] == "triage_routing_domain")
        == 2
    )
    assert (
        sum(
            1
            for c in domain_calls
            if c["domain_id"] == "resolution_lifecycle_domain"
        )
        == 2
    )
    icpa_calls = [c for c in calls if c[0] == "icpa"]
    itra_calls = [c for c in calls if c[0] == "itra"]
    assert len(icpa_calls) == 1
    assert len(itra_calls) == 1
    assert icpa_calls[0][1] == "update_ticket"
    assert icpa_calls[0][2].get("subject") == "Cannot connect to VPN"
    assert "description" in icpa_calls[0][2]
    assert icpa_calls[0][2].get("priority") == "high"
    assert itra_calls[0][2].get("assignee") == "Jane Smith"
    assert itra_calls[0][2].get("resolver") == "Alex Resolver"
    assert calls.index(icpa_calls[0]) < calls.index(itra_calls[0])
    assert any(r.get("agent_id") == "icpa" for r in out)
    assert any(r.get("agent_id") == "itra" for r in out)
    assert any(r.get("via") == "domain-delegate" for r in out)


def _lean_create_event(eid: str = "lean-created-x") -> dict:
    return {
        "id": eid,
        "event_type": "ticket.created",
        "organization_id": "org-1",
        "ticket_number": "#501",
        "payload": {
            "ticket_number": "#501",
            "subject": "vpn broken please help me asap from home office",
            "description": "vpn broken please help me asap from home office",
            "assignee": "Unassigned",
            "triage_complete": False,
            "harness_triage_complete": False,
            "domain_triage_owned": True,
            "created_by_role": "admin",
        },
    }


def _patch_lean_enrich_assign(monkeypatch):
    calls: list[tuple] = []

    def capture(agent_id, tool_name, args, **kwargs):
        calls.append((agent_id, tool_name, dict(args)))
        return {"success": True, "payload": {"ok": True}}

    monkeypatch.setattr("app.proactive.runtime.execute_tool", capture)
    monkeypatch.setattr(
        icpa,
        "_triage_enrich_fields",
        lambda **_k: {
            "subject": "Cannot connect to VPN",
            "description": "Customer cannot connect to corporate VPN from home.",
            "priority": "high",
            "category": "Network",
            "queue": "Network Support",
            "skill": "VPN",
            "enrichedByAi": True,
        },
    )
    monkeypatch.setattr(
        itra,
        "route_assignment",
        lambda **_k: {
            "agent": "Jane Smith",
            "agent_id": "j1",
            "resolver": "Alex Resolver",
            "resolver_id": "r1",
            "rationale": "ITRA skill match",
            "confidence": 0.9,
            "via": "itra",
            "weights_applied": False,
        },
    )
    for mod in (rkaa, stda, ara, tsaa, pna):
        if hasattr(mod, "run_agent_llm"):
            monkeypatch.setattr(
                mod,
                "run_agent_llm",
                lambda *_a, **_k: {"confidence": 0.1, "notes": "skip"},
            )
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {
            "payload": {
                "subject": "vpn broken please help me asap from home office",
                "description": "vpn broken please help me asap from home office",
                "assignee": "Unassigned",
                "priority": "medium",
            }
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_queues",
        lambda *_a, **_k: {"payload": []},
    )
    monkeypatch.setattr("app.proactive.rkaa.retrieve", lambda *_a, **_k: [])
    monkeypatch.setattr("app.proactive.stda.retrieve", lambda *_a, **_k: [])
    return calls


def test_lean_domain_wrong_order_then_correct_or_fallback(monkeypatch):
    """Wrong first triage delegate is rejected; resolution still planned after."""
    calls = _patch_lean_enrich_assign(monkeypatch)
    attempts: list[str] = []

    def fake_delegate(messages, *, domain_id="triage_routing_domain"):
        attempts.append(domain_id)
        triage_n = sum(1 for d in attempts if d == "triage_routing_domain")
        if domain_id == "triage_routing_domain":
            # First attempt for classify step: wrong executor (assign)
            if triage_n == 1:
                return {
                    "executor_id": "intelligent_assignment_executor",
                    "task_id": "ticket.assign.best",
                    "skill_name": "ticket-assign-best",
                    "objective": "wrong order",
                }
            # Retry for classify: correct
            if triage_n == 2:
                return {
                    "executor_id": "classification_priority_executor",
                    "task_id": "ticket.classify.prioritize",
                    "skill_name": "ticket-classify-prioritize",
                    "objective": "classify",
                }
            return {
                "executor_id": "intelligent_assignment_executor",
                "task_id": "ticket.assign.best",
                "skill_name": "ticket-assign-best",
                "objective": "assign",
            }
        res_n = sum(1 for d in attempts if d == "resolution_lifecycle_domain")
        if res_n == 1:
            return {
                "executor_id": "investigation_summary_executor",
                "task_id": "ticket.investigation.summary",
                "skill_name": "ticket-investigation-summary",
                "objective": "summarize",
            }
        return {
            "executor_id": "personalized_notification_executor",
            "task_id": "notification.personalize.deliver",
            "skill_name": "notification-personalize-deliver",
            "objective": "notify",
        }

    monkeypatch.setattr(
        "app.proactive.runtime._domain_delegate_once", fake_delegate
    )
    out = dispatch_event(_lean_create_event("lean-wrong-order-1"))
    icpa_calls = [c for c in calls if c[0] == "icpa"]
    itra_calls = [c for c in calls if c[0] == "itra"]
    assert len(icpa_calls) == 1
    assert len(itra_calls) == 1
    assert calls.index(icpa_calls[0]) < calls.index(itra_calls[0])
    assert any(r.get("agent_id") == "icpa" for r in out)
    assert any(r.get("agent_id") == "itra" for r in out)
    assert sum(1 for d in attempts if d == "resolution_lifecycle_domain") == 2


def test_lean_domain_total_failure_falls_back_to_icpa_itra(monkeypatch):
    """Domain LLM failure still enriches/assigns and runs resolution fallback."""
    calls = _patch_lean_enrich_assign(monkeypatch)
    monkeypatch.setattr(
        "app.proactive.runtime._domain_delegate_once",
        lambda *_a, **_k: None,
    )
    out = dispatch_event(_lean_create_event("lean-fallback-1"))
    icpa_calls = [c for c in calls if c[0] == "icpa"]
    itra_calls = [c for c in calls if c[0] == "itra"]
    assert len(icpa_calls) == 1
    assert len(itra_calls) == 1
    assert calls.index(icpa_calls[0]) < calls.index(itra_calls[0])
    assert any(r.get("via") == "domain-fallback" for r in out)
    assert any(r.get("agent_id") == "icpa" for r in out)
    assert any(r.get("agent_id") == "itra" for r in out)


def test_icpa_skips_when_pre_insert_triage_complete(monkeypatch):
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {
            "payload": {
                "priority": "high",
                "category": "Network",
                "subject": "VPN",
            }
        },
    )
    proposal = icpa.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#9",
            "payload": {
                "ticket_number": "#9",
                "triage_complete": True,
                "harness_triage_complete": True,
                "priority": "high",
                "category": "Network",
            },
        }
    )
    assert proposal is not None
    assert proposal.tool_name is None
    assert "skipped" in (proposal.summary or "").lower()


def test_icpa_lean_enrich_always_sends_description(monkeypatch):
    monkeypatch.setattr(
        "app.tools.ticket_read.get_ticket",
        lambda *_a, **_k: {
            "payload": {
                "subject": "order BXUK unfulfilled",
                "description": "Order BXUK-20260922 has no tracking.",
            }
        },
    )
    monkeypatch.setattr(
        "app.tools.catalog_tools.list_queues",
        lambda *_a, **_k: {"payload": []},
    )
    monkeypatch.setattr(
        icpa,
        "_triage_enrich_fields",
        lambda **_k: {
            "subject": "Order BXUK Unfulfilled — No Tracking",
            "priority": "high",
            "queue": "Order Management",
            "enrichedByAi": True,
        },
    )
    proposal = icpa.propose(
        {
            "organization_id": "org-1",
            "ticket_number": "#15588",
            "payload": {
                "ticket_number": "#15588",
                "triage_complete": False,
                "domain_triage_owned": True,
                "description": "Order BXUK-20260922 has no tracking.",
            },
        }
    )
    assert proposal is not None
    assert proposal.tool_name == "update_ticket"
    assert proposal.tool_args.get("subject")
    assert str(proposal.tool_args.get("description") or "").strip()
    assert "BXUK" in str(proposal.tool_args.get("description"))


def test_stda_still_assists_on_ticket_created():
    from app.proactive.stda import SPEC

    assert "ticket.created" in SPEC.trigger
    assert SPEC.output_type == "RECOMMENDATION"
    assert "list_tickets" in SPEC.tools_used
    assert "list_kb" in SPEC.tools_used


def test_tcaa_does_not_propose_create_when_same_open_ticket(monkeypatch):
    from app.proactive import tcaa

    monkeypatch.setattr(
        "app.tools.ticket_read.list_tickets",
        lambda **_k: {
            "success": True,
            "payload": {
                "data": [
                    {
                        "ticket_number": "#88",
                        "subject": "VPN down",
                        "status": "Open",
                        "description": "cannot connect",
                    }
                ]
            },
        },
    )
    turns = {"n": 0}

    def _llm(*_a, **_k):
        turns["n"] += 1
        if turns["n"] == 1:
            return {
                "customerName": "Pat Lee",
                "customerEmail": "pat@example.com",
                "subject": "VPN down",
                "description": "cannot connect",
                "confidence": 0.9,
            }
        return {
            "same_open_ticket": True,
            "ticket_number": "#88",
            "confidence": 0.9,
        }

    monkeypatch.setattr(tcaa, "run_agent_llm", _llm)
    proposal = tcaa.propose(
        {
            "id": "inbound-dup",
            "event_type": "inbound.message",
            "organization_id": "org-1",
            "payload": {"text": "VPN is still down", "skip_create": False},
        }
    )
    assert proposal is not None
    assert proposal.tool_name is None
    assert proposal.output_type == "RECOMMENDATION"
    assert "#88" in (proposal.summary or "")


# --- Context Layer vs Express reports/analytics (test-only coverage) ---

_CL_REPORT_TOOLS = (
    "get_analytics",
    "get_csat_reports",
    "export_analytics",
    "list_audit",
    "list_tickets",
    "get_metrics",
    "get_triage_stats",
    "get_dashboard_chart",
    "list_activities",
)
_CL_DASHBOARD_KEEP = frozenset(
    {
        "get_metrics",
        "get_triage_stats",
        "get_dashboard_chart",
        "list_activities",
    }
)
_ROOT_DIR = Path(__file__).resolve().parents[2]
_CATALOG_JSON = _ROOT_DIR / "shared" / "ticketing_tool_catalog.json"
_COVERAGE_LOG = (
    Path(__file__).resolve().parents[1] / "logs" / "cl-coverage-report.json"
)


def _catalog_tool_names() -> set[str]:
    data = json.loads(_CATALOG_JSON.read_text(encoding="utf-8"))
    tools = data.get("tools") if isinstance(data, dict) else data
    names: set[str] = set()
    if isinstance(tools, list):
        for item in tools:
            if isinstance(item, dict) and item.get("name"):
                names.add(str(item["name"]))
    return names


def _skill_allowed_tools(skill: str) -> set[str]:
    path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "skills"
        / skill
        / "SKILL.md"
    )
    text = path.read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("allowed-tools:"):
            return set(line.split(":", 1)[1].split())
    return set()


def test_cl_reports_catalog_and_skill_inventory():
    names = _catalog_tool_names()
    for tool in _CL_REPORT_TOOLS:
        assert tool in names, f"{tool} missing from MCP catalog"
    assert "ask_semantic_layer" in names
    assert "ask_sql_layer" not in names
    assert "ask_semantic_layer" in _skill_allowed_tools("analytics-query")
    assert "get_analytics" in _skill_allowed_tools("analytics-query")
    assert "get_csat_reports" in _skill_allowed_tools("csat-report")
    assert "export_analytics" in _skill_allowed_tools("analytics-export")
    assert "list_audit" in _skill_allowed_tools("audit-query")
    assert "ask_sql_layer" in _skill_allowed_tools("ticket-read-search")
    assert "list_tickets" in _skill_allowed_tools("ticket-read-search")
    assert "get_metrics" in _skill_allowed_tools("dashboard-metrics-read")


def _parse_number(raw: Any) -> float | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw or "").strip().replace(",", "").replace("%", "")
    if not text:
        return None
    try:
        return float(text.split("/")[0])
    except ValueError:
        return None


def _walk_numbers(blob: Any, into: dict[str, float], prefix: str = "") -> None:
    if isinstance(blob, dict):
        for key, value in blob.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            num = _parse_number(value)
            if num is not None and not isinstance(value, (dict, list)):
                into[path] = num
            else:
                _walk_numbers(value, into, path)
    elif isinstance(blob, list):
        for idx, item in enumerate(blob[:12]):
            _walk_numbers(item, into, f"{prefix}[{idx}]")


def _first_numeric(blob: Any) -> float | None:
    found: dict[str, float] = {}
    _walk_numbers(blob, found)
    if not found:
        return None
    for key, value in found.items():
        low = key.lower()
        if any(part in low for part in ("total", "count", "value", "score", "avg")):
            return value
    return next(iter(found.values()))


def _ticket_number_set(rows: Any) -> set[str]:
    out: set[str] = set()
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = (
            row.get("ticket_number")
            or row.get("id")
            or row.get("ticket_id")
            or row.get("ticketNumber")
        )
        text = str(raw or "").strip()
        if text:
            out.add(text.lstrip("#").lower())
    return out


def _pick_slice_metric(metric_ids: set[str], *needles: str) -> str | None:
    ranked: list[str] = []
    for mid in sorted(metric_ids):
        low = mid.lower()
        if all(n in low for n in needles):
            ranked.append(mid)
    if ranked:
        return ranked[0]
    for mid in sorted(metric_ids):
        low = mid.lower()
        if any(n in low for n in needles):
            return mid
    return None


def _resolve_coverage_actor() -> tuple[str, str] | None:
    org = str(os.environ.get("CL_TEST_ORG_ID") or "").strip()
    user = str(os.environ.get("CL_TEST_USER_ID") or "").strip()
    if org and user:
        return org, user
    from app.config import get_settings

    if not str(get_settings().database_url or "").strip():
        return None
    try:
        from app.db import fetch_one

        row = fetch_one(
            """
            SELECT id::text AS id, organization_id::text AS organization_id
              FROM agents
             WHERE lower(coalesce(role, '')) = 'admin'
             ORDER BY id
             LIMIT 1
            """
        )
    except Exception:  # noqa: BLE001
        return None
    if not row:
        return None
    org = str(row.get("organization_id") or "").strip()
    user = str(row.get("id") or "").strip()
    if org and user:
        return org, user
    return None


def _record(
    rows: list[dict[str, Any]],
    *,
    tool: str,
    cl_tool: str,
    status: str,
    **extra: Any,
) -> None:
    item = {"tool": tool, "cl_tool": cl_tool, "status": status, **extra}
    rows.append(item)


def _compare_numbers(
    express_value: float | None, cl_value: float | None, *, tol: float = 0.15
) -> str:
    if express_value is None or cl_value is None:
        return "GAP"
    if abs(express_value - cl_value) <= max(tol, abs(express_value) * 0.02):
        return "PASS"
    return "MISMATCH"


def test_cl_reports_live_coverage_against_express_and_db():
    from datetime import datetime, timedelta, timezone

    from app.config import get_settings
    from app.tools.catalog_tools import (
        ask_semantic_layer,
        ask_sql_layer,
        clear_ontology_slice_cache,
        export_analytics,
        get_analytics,
        get_csat_reports,
        get_ontology_slice,
        list_audit,
    )
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )
    from app.tools.ticket_read import list_tickets

    settings = get_settings()
    cl_url = str(settings.context_layer_url or "").strip()
    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "context_layer_url_set": bool(cl_url),
        "express_base_url": settings.express_base_url,
        "cases": [],
    }
    cases: list[dict[str, Any]] = report["cases"]

    names = _catalog_tool_names()
    _record(
        cases,
        tool="ask_sql_layer",
        cl_tool="mcp_catalog",
        status="GAP" if "ask_sql_layer" not in names else "PASS",
        message="ask_sql_layer missing from shared/ticketing_tool_catalog.json",
    )
    _record(
        cases,
        tool="export_analytics",
        cl_tool="neither",
        status="GAP",
        message="CSV href has no Context Layer equivalent",
        dashboard_keep=False,
    )

    actor_ids = _resolve_coverage_actor()
    if not actor_ids:
        _record(
            cases,
            tool="live_stack",
            cl_tool="both",
            status="SKIP",
            message="No CL_TEST_ORG_ID/CL_TEST_USER_ID and no admin row in Postgres",
        )
        _COVERAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
        _COVERAGE_LOG.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        return

    org, user = actor_ids
    report["organization_id"] = org
    report["user_id"] = user
    actor = ToolActor(
        user_id=user, organization_id=org, user_role="admin"
    )
    if not cl_url:
        _record(
            cases,
            tool="live_stack",
            cl_tool="both",
            status="SKIP",
            message="CONTEXT_LAYER_URL is not configured",
        )
        _COVERAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
        _COVERAGE_LOG.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        return

    clear_ontology_slice_cache()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    time_win = {
        "start": start.date().isoformat(),
        "end": end.date().isoformat(),
    }

    with tool_actor_scope(actor):
        with runtime_agent_scope("analytics_audit_query_executor"):
            slice_res = get_ontology_slice(
                organization_id=org,
                user_id=user,
                agent="analytics_audit_query_executor",
                format="json",
                use_cache=False,
            )
            metric_ids: set[str] = set()
            if slice_res.get("success"):
                payload = slice_res.get("payload") or {}
                for metric in payload.get("metrics") or []:
                    if isinstance(metric, dict) and metric.get("id"):
                        metric_ids.add(str(metric["id"]))
                    elif isinstance(metric, str) and metric.strip():
                        metric_ids.add(metric.strip())
            else:
                _record(
                    cases,
                    tool="ontology_slice",
                    cl_tool="ask_semantic_layer",
                    status="CL_ERROR",
                    error_code=slice_res.get("error_code"),
                    message=slice_res.get("message"),
                )

            analytics = get_analytics(range="7days")
            csat = get_csat_reports(range="7days")
            export_res = export_analytics(range="7days")
            audit = list_audit(limit=25, range="7days")

        tickets = None
        with runtime_agent_scope("ticket_lifecycle_executor"):
            tickets = list_tickets(limit=50, created_range="last_7d", scope="org")
            ticket_rows = (tickets.get("payload") or {}).get("data") if tickets else []
            if tickets and tickets.get("success") and not ticket_rows:
                tickets = list_tickets(limit=50, scope="org")

        express_total = None
        if analytics.get("success"):
            nums: dict[str, float] = {}
            _walk_numbers(analytics.get("payload"), nums)
            express_total = nums.get("totalTickets") or nums.get("payload.totalTickets")
            if express_total is None:
                for key, value in nums.items():
                    if "totalticket" in key.lower() or key.endswith("total"):
                        express_total = value
                        break
        else:
            _record(
                cases,
                tool="get_analytics",
                cl_tool="ask_semantic_layer",
                status="EXPRESS_ERROR",
                error_code=analytics.get("error_code"),
                message=analytics.get("message") or "Express get_analytics failed",
            )

        volume_id = _pick_slice_metric(
            metric_ids, "created"
        ) or _pick_slice_metric(metric_ids, "volume") or _pick_slice_metric(
            metric_ids, "ticket"
        )
        if volume_id and analytics.get("success"):
            with runtime_agent_scope("analytics_audit_query_executor"):
                sem = ask_semantic_layer(
                    metrics=[volume_id],
                    time=time_win,
                    agent="analytics_audit_query_executor",
                )
            cl_val = _first_numeric(sem.get("payload") if sem.get("success") else None)
            status = (
                "CL_ERROR"
                if not sem.get("success")
                else _compare_numbers(express_total, cl_val)
            )
            _record(
                cases,
                tool="get_analytics",
                cl_tool="ask_semantic_layer",
                status=status,
                metric_id=volume_id,
                express_value=express_total,
                cl_value=cl_val,
                error_code=sem.get("error_code"),
                message=sem.get("message"),
            )
        elif analytics.get("success"):
            _record(
                cases,
                tool="get_analytics",
                cl_tool="ask_semantic_layer",
                status="GAP",
                message="Ontology slice had no created/volume metric id",
                express_value=express_total,
            )

        csat_express = None
        if csat.get("success"):
            csat_nums: dict[str, float] = {}
            _walk_numbers(csat.get("payload"), csat_nums)
            for key, value in csat_nums.items():
                if "avg" in key.lower() or "score" in key.lower():
                    csat_express = value
                    break
        csat_id = _pick_slice_metric(metric_ids, "csat")
        if csat_id:
            with runtime_agent_scope("analytics_audit_query_executor"):
                sem_csat = ask_semantic_layer(
                    metrics=[csat_id],
                    time=time_win,
                    agent="analytics_audit_query_executor",
                )
            cl_csat = _first_numeric(
                sem_csat.get("payload") if sem_csat.get("success") else None
            )
            status = (
                "CL_ERROR"
                if not sem_csat.get("success")
                else _compare_numbers(csat_express, cl_csat, tol=0.2)
            )
            _record(
                cases,
                tool="get_csat_reports",
                cl_tool="ask_semantic_layer",
                status=status,
                metric_id=csat_id,
                express_value=csat_express,
                cl_value=cl_csat,
                error_code=sem_csat.get("error_code"),
                message=sem_csat.get("message"),
            )
        else:
            _record(
                cases,
                tool="get_csat_reports",
                cl_tool="ask_semantic_layer",
                status="GAP" if csat.get("success") else "SKIP",
                message="No CSAT metric on slice or Express CSAT failed",
                error_code=csat.get("error_code"),
                express_value=csat_express,
            )

        _record(
            cases,
            tool="export_analytics",
            cl_tool="neither",
            status="GAP",
            message="export_analytics returns a download href only",
            express_href=(export_res.get("payload") or {}).get("href")
            if export_res.get("success")
            else None,
        )

        express_tickets = _ticket_number_set(
            (tickets.get("payload") or {}).get("data") if tickets else None
        )
        ticket_total = None
        if tickets and tickets.get("success"):
            ticket_total = (tickets.get("payload") or {}).get("totalRows")
        with runtime_agent_scope("ticket_lifecycle_executor"):
            sql = ask_sql_layer(
                instruction=(
                    "List tickets created in the last 7 days for this organization, "
                    "including ticket number, status, and assignee."
                ),
                entity_hint="wt:Ticket",
                limit=50,
            )
        if not sql.get("success"):
            _record(
                cases,
                tool="list_tickets",
                cl_tool="ask_sql_layer",
                status="CL_ERROR",
                error_code=sql.get("error_code"),
                message=sql.get("message"),
                express_value=ticket_total,
                kpi_not_allowed=(sql.get("payload") or {}).get("kpi_not_allowed"),
            )
        else:
            cl_tickets = _ticket_number_set((sql.get("payload") or {}).get("rows"))
            missing = sorted(express_tickets - cl_tickets)
            extra = sorted(cl_tickets - express_tickets)
            status = "PASS"
            if not cl_tickets and express_tickets:
                status = "MISMATCH"
            elif missing or extra:
                status = "MISMATCH"
            _record(
                cases,
                tool="list_tickets",
                cl_tool="ask_sql_layer",
                status=status,
                express_value=len(express_tickets),
                cl_value=len(cl_tickets),
                missing_in_cl=missing[:20],
                extra_in_cl=extra[:20],
            )

        if volume_id and ticket_total is not None:
            with runtime_agent_scope("analytics_audit_query_executor"):
                count_sem = ask_semantic_layer(
                    metrics=[volume_id],
                    time=time_win,
                    agent="analytics_audit_query_executor",
                )
            cl_count = _first_numeric(
                count_sem.get("payload") if count_sem.get("success") else None
            )
            status = (
                "CL_ERROR"
                if not count_sem.get("success")
                else _compare_numbers(float(ticket_total), cl_count)
            )
            _record(
                cases,
                tool="list_tickets_count",
                cl_tool="ask_semantic_layer",
                status=status,
                metric_id=volume_id,
                express_value=ticket_total,
                cl_value=cl_count,
                error_code=count_sem.get("error_code"),
                message=count_sem.get("message"),
            )

        express_audit = _ticket_number_set(
            (audit.get("payload") or {}).get("data")
            if isinstance((audit.get("payload") or {}), dict)
            else audit.get("payload")
        )
        if not express_audit and isinstance(audit.get("payload"), list):
            express_audit = _ticket_number_set(audit.get("payload"))
        with runtime_agent_scope("ticket_lifecycle_executor"):
            sql_audit = ask_sql_layer(
                instruction=(
                    "List recent audit events for this organization from the last 7 days."
                ),
                entity_hint="wt:Ticket",
                limit=25,
            )
        if not sql_audit.get("success"):
            _record(
                cases,
                tool="list_audit",
                cl_tool="ask_sql_layer",
                status="CL_ERROR" if audit.get("success") else "GAP",
                error_code=sql_audit.get("error_code"),
                message=sql_audit.get("message"),
            )
        else:
            cl_audit = _ticket_number_set((sql_audit.get("payload") or {}).get("rows"))
            missing_a = sorted(express_audit - cl_audit) if express_audit else []
            extra_a = sorted(cl_audit - express_audit) if express_audit else []
            status = "GAP"
            if express_audit:
                status = "MISMATCH" if missing_a or extra_a else "PASS"
            _record(
                cases,
                tool="list_audit",
                cl_tool="ask_sql_layer",
                status=status,
                express_value=len(express_audit),
                cl_value=len(cl_audit),
                missing_in_cl=missing_a[:20],
                extra_in_cl=extra_a[:20],
                message="Audit mart may not exist; ticket-shaped SQL is not an audit log",
            )

        for dash in sorted(_CL_DASHBOARD_KEEP):
            _record(
                cases,
                tool=dash,
                cl_tool="neither",
                status="SKIP",
                dashboard_keep=True,
                message="Dashboard-required Express tool — not compared for replacement",
            )

    report["summary"] = {
        "pass": sum(1 for c in cases if c.get("status") == "PASS"),
        "mismatch": sum(1 for c in cases if c.get("status") == "MISMATCH"),
        "cl_error": sum(1 for c in cases if c.get("status") == "CL_ERROR"),
        "express_error": sum(1 for c in cases if c.get("status") == "EXPRESS_ERROR"),
        "gap": sum(1 for c in cases if c.get("status") == "GAP"),
        "skip": sum(1 for c in cases if c.get("status") == "SKIP"),
    }
    _COVERAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
    _COVERAGE_LOG.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")


_SEP20_ORG = "1012"
_SEP20_REPORT = _ROOT_DIR / "docs" / "sep20-cl-layer-test-v1.md"
_TICKET_DIMS = frozenset(
    {
        "priority",
        "status",
        "queue_name",
        "channel",
        "assignee_name",
        "resolver_name",
        "category",
        "customer_name",
        "created_by_name",
    }
)


def _sep20_agents() -> list[dict[str, Any]]:
    from app.db import fetch_all

    return fetch_all(
        """
        SELECT a.id::text AS id, a.role,
               trim(both from concat_ws(' ', su.first_name, su.last_name)) AS name,
               su.work_email AS email
          FROM ticketing.agents a
          JOIN accounts.setup_users su ON su.id = a.setup_user_id
         WHERE a.organization_id = %s
         ORDER BY a.id
        """,
        (int(_SEP20_ORG),),
    )


def _sep20_window_sql(start: str | None, end: str | None, col: str = "created_at") -> tuple[str, list[Any]]:
    if not start and not end:
        return "TRUE", []
    if start and end and start == end:
        return f"({col} AT TIME ZONE 'UTC')::date = %s::date", [start]
    params: list[Any] = []
    parts: list[str] = []
    if start:
        parts.append(f"{col} >= %s::date")
        params.append(start)
    if end:
        parts.append(f"{col} < (%s::date + INTERVAL '1 day')")
        params.append(end)
    return " AND ".join(parts) or "TRUE", params


def _sep20_db_metric(
    metric_id: str,
    start: str | None,
    end: str | None,
    group_by: str | None,
) -> Any:
    from app.db import fetch_all, fetch_one

    mid = (metric_id or "").lower()
    win, wparams = _sep20_window_sql(start, end)
    org = int(_SEP20_ORG)
    base = f"FROM tickets WHERE organization_id = %s AND {win}"
    params: list[Any] = [org, *wparams]
    gcol = {
        "priority": "lower(priority)",
        "status": "status",
        "queue_name": "queue_name",
        "channel": "channel",
        "assignee_name": "assignee_name",
        "resolver_name": "resolver_name",
        "category": "category",
        "customer_name": "customer_name",
        "created_by_name": None,
    }.get(group_by or "")
    if group_by == "created_by_name":
        return None
    if "csat" in mid and "rate" not in mid and "promoter" not in mid and "detractor" not in mid and "neutral" not in mid and "rated" not in mid:
        expr = "AVG(csat_score)::float"
        extra = " AND csat_score IS NOT NULL"
    elif "csat_rated" in mid:
        expr = "COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int"
        extra = ""
    elif "promoter" in mid and "rate" not in mid:
        expr = "COUNT(*) FILTER (WHERE csat_score >= 4)::int"
        extra = ""
    elif "detractor" in mid and "rate" not in mid:
        expr = "COUNT(*) FILTER (WHERE csat_score <= 2)::int"
        extra = ""
    elif "neutral" in mid and "csat" in mid:
        expr = "COUNT(*) FILTER (WHERE csat_score > 2 AND csat_score < 4)::int"
        extra = ""
    elif "open" in mid or "active_ticket" in mid:
        expr = "COUNT(*) FILTER (WHERE status NOT IN ('Resolved','Closed'))::int"
        extra = ""
    elif "closed_ticket" in mid:
        expr = "COUNT(*) FILTER (WHERE status = 'Closed')::int"
        extra = ""
    elif "resolved" in mid and "hour" not in mid:
        expr = "COUNT(*) FILTER (WHERE status IN ('Resolved','Closed'))::int"
        extra = ""
    elif "overdue" in mid or "breach" in mid:
        expr = "COUNT(*) FILTER (WHERE status = 'Overdue' OR (due_at IS NOT NULL AND due_at < NOW() AND status NOT IN ('Resolved','Closed')))::int"
        extra = ""
    elif "assigned_ticket" in mid:
        expr = "COUNT(*) FILTER (WHERE assignee_id IS NOT NULL AND assignee_name NOT IN ('', 'Unassigned'))::int"
        extra = ""
    elif "resolution_time" in mid or "resolution_hours" in mid:
        expr = "AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at))/3600) FILTER (WHERE status IN ('Resolved','Closed'))::float"
        extra = ""
    elif "first_response" in mid and "minute" in mid:
        expr = "AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL)::float"
        extra = ""
    elif "first_response" in mid:
        expr = "AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) FILTER (WHERE first_response_at IS NOT NULL)::float"
        extra = ""
    elif any(tok in mid for tok in ("created", "volume", "ticket_volume", "tickets_created", "accounts_served")):
        expr = "COUNT(*)::int"
        extra = ""
    else:
        return None
    if gcol:
        rows = fetch_all(
            f"SELECT {gcol} AS bucket, {expr} AS value {base}{extra} GROUP BY 1 ORDER BY 1",
            tuple(params),
        )
        return {str(r.get("bucket") or ""): r.get("value") for r in rows}
    row = fetch_one(f"SELECT {expr} AS value {base}{extra}", tuple(params))
    return None if not row else row.get("value")


def _sep20_cl_number(payload: Any, metric_id: str) -> float | None:
    found: dict[str, float] = {}
    _walk_numbers(payload, found)
    if metric_id in found:
        return found[metric_id]
    for key, value in found.items():
        if metric_id in key or key.endswith("value") or key.endswith(metric_id):
            return value
    return _first_numeric(payload)


def _sep20_ticket_scope_sql(role: str, agent_id: str) -> tuple[str, list[Any]]:
    role_l = (role or "").strip().lower()
    if role_l == "admin":
        return "organization_id = %s", [int(_SEP20_ORG)]
    if role_l == "resolver":
        return (
            "organization_id = %s AND (resolver_id = %s OR assignee_id = %s)",
            [int(_SEP20_ORG), int(agent_id), int(agent_id)],
        )
    return "organization_id = %s AND assignee_id = %s", [int(_SEP20_ORG), int(agent_id)]


def _sep20_ticket_numbers(where: str, params: list[Any], extra: str = "", limit: int = 50) -> set[str]:
    from app.db import fetch_all

    rows = fetch_all(
        f"SELECT ticket_number FROM tickets WHERE {where} {extra} ORDER BY created_at DESC LIMIT {int(limit)}",
        tuple(params),
    )
    return {str(r.get("ticket_number") or "").lstrip("#").lower() for r in rows if r.get("ticket_number")}


def test_cl_layer_org_1012_sep20_v1():
    from datetime import datetime, timedelta, timezone

    from app.config import get_settings
    from app.db import fetch_all, fetch_one
    from app.tools.catalog_tools import (
        ask_semantic_layer,
        ask_sql_layer,
        clear_ontology_slice_cache,
        get_ontology_slice,
    )
    from app.tools.express_client import (
        ToolActor,
        runtime_agent_scope,
        tool_actor_scope,
    )

    settings = get_settings()
    today = datetime.now(timezone.utc).date()
    windows = [
        ("all_time", None, None),
        ("today", today.isoformat(), today.isoformat()),
        ("last_7d", (today - timedelta(days=7)).isoformat(), today.isoformat()),
        ("last_30d", (today - timedelta(days=30)).isoformat(), today.isoformat()),
    ]
    agents = _sep20_agents()
    cases: list[dict[str, Any]] = []
    assert agents, "No ticketing.agents rows for organization 1012"

    clear_ontology_slice_cache()
    admin = next((a for a in agents if str(a.get("role") or "").lower() == "admin"), agents[0])

    def flush_report() -> None:
        counts = {}
        for row in cases:
            key = str(row.get("status") or "GAP")
            counts[key] = counts.get(key, 0) + 1
        lines = [
            "# Sep 20 CL layer test v1",
            "",
            f"Organization `{_SEP20_ORG}`. From-scratch run. Context Layer `{settings.context_layer_url}`.",
            f"Partial write: **{len(cases)}** cases so far.",
            "",
            "## Agents (`ticketing.agents`)",
            "",
            "| id | role | name | email |",
            "|---|---|---|---|",
        ]
        for actor in agents:
            lines.append(
                f"| {actor['id']} | {actor.get('role')} | {actor.get('name')} | {actor.get('email')} |"
            )
        lines += [
            "",
            "## Summary",
            "",
            f"- Cases: **{len(cases)}** · "
            + " · ".join(f"{k} {v}" for k, v in sorted(counts.items())),
            "",
            "## Failed queries (CL_ERROR / FALLBACK_FAIL)",
            "",
        ]
        failed = [c for c in cases if c.get("status") in {"CL_ERROR", "FALLBACK_FAIL"}]
        lines.append("None." if not failed else "")
        for row in failed[:120]:
            lines.append(
                f"- **{row.get('query')}** (agent {row.get('agent_id')} {row.get('role')}): `{row.get('error_code')}` {row.get('cl_error') or row.get('fallback_error') or ''}"
            )
        lines += ["", "## Mismatches (CL vs Postgres)", ""]
        bad = [c for c in cases if c.get("status") == "MISMATCH"]
        lines.append("None." if not bad else "")
        for row in bad[:120]:
            lines.append(
                f"- **{row.get('query')}** (agent {row.get('agent_id')} {row.get('role')}): CL `{row.get('cl_value')}` vs DB `{row.get('db_value')}`"
            )
        lines += [
            "",
            "## How to overcome",
            "",
            "- Use date-only `time.start` / `time.end` (`YYYY-MM-DD`). Full ISO timestamps broke Context Layer SQL.",
            "- UNMAPPED metrics need a certified warehouse SQL definition before CL can be SoT.",
            "- Customer/team/status/priority lists need a warehouse entityHint; ticket-only SQL will error or GAP.",
            "- Agent/resolver rows must stay scoped to assignee/resolver id; extra ticket numbers are RBAC leaks.",
            "- Add `ask_sql_layer` to `shared/ticketing_tool_catalog.json` so MCP clients can discover it.",
            "",
            "## All queries",
            "",
            "| kind | agent | role | query | status | CL | DB |",
            "|---|---|---|---|---|---|---|",
        ]
        for row in cases:
            q = str(row.get("query") or "").replace("|", "/")
            lines.append(
                f"| {row.get('kind')} | {row.get('agent_id')} | {row.get('role')} | {q} | {row.get('status')} | {row.get('cl_value')} | {row.get('db_value')} |"
            )
        _SEP20_REPORT.parent.mkdir(parents=True, exist_ok=True)
        _SEP20_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def record(**row: Any) -> None:
        cases.append(row)
        if len(cases) % 25 == 0:
            flush_report()
            print(f"[sep20] {len(cases)} cases last={row.get('query')} {row.get('status')}", flush=True)

    def call_semantic(actor: dict[str, Any], metric_id: str, group_by: str | None, win_name: str, start: str | None, end: str | None) -> dict[str, Any]:
        ta = ToolActor(
            user_id=str(actor["id"]),
            organization_id=_SEP20_ORG,
            user_role=str(actor.get("role") or "agent"),
            user_name=str(actor.get("name") or "") or None,
        )
        kwargs: dict[str, Any] = {
            "metrics": [metric_id],
            "agent": "analytics_audit_query_executor",
        }
        if start and end:
            kwargs["time"] = {"start": start, "end": end}
        if group_by:
            kwargs["group_by"] = [group_by]
        with tool_actor_scope(ta), runtime_agent_scope("analytics_audit_query_executor"):
            out = ask_semantic_layer(**kwargs)
        db_val = _sep20_db_metric(metric_id, start, end, group_by)
        if not out.get("success"):
            status = "CL_ERROR"
            cl_val = None
            fallback = None
            with tool_actor_scope(ta), runtime_agent_scope("analytics_audit_query_executor"):
                fallback = ask_sql_layer(
                    instruction=f"Compute {metric_id} for this organization",
                    entity_hint="wt:Ticket",
                    metric_request={
                        "metrics": [metric_id],
                        "agent": "analytics_audit_query_executor",
                        **({"time": {"start": start, "end": end}} if start and end else {}),
                        **({"group_by": [group_by]} if group_by else {}),
                    },
                )
            if fallback.get("success"):
                cl_val = _sep20_cl_number(fallback.get("payload"), metric_id)
                if db_val is None:
                    status = "FALLBACK_PASS" if cl_val is not None else "FALLBACK_FAIL"
                else:
                    status = (
                        "FALLBACK_PASS"
                        if _compare_numbers(_parse_number(db_val) if not isinstance(db_val, dict) else None, cl_val) == "PASS"
                        else "FALLBACK_FAIL"
                    )
            record(
                kind="semantic",
                agent_id=actor["id"],
                role=actor.get("role"),
                query=f"{metric_id} group_by={group_by or '-'} time={win_name}",
                payload=kwargs,
                status=status,
                cl_error=out.get("message"),
                error_code=out.get("error_code"),
                cl_value=cl_val,
                db_value=db_val if not isinstance(db_val, dict) else "grouped",
                fallback_error=None if fallback.get("success") else fallback.get("message"),
            )
            return out
        cl_val = _sep20_cl_number(out.get("payload"), metric_id)
        if db_val is None:
            status = "UNMAPPED" if cl_val is not None else "GAP"
        elif isinstance(db_val, dict):
            status = "PASS" if cl_val is not None else "MISMATCH"
        else:
            status = _compare_numbers(_parse_number(db_val), cl_val)
        record(
            kind="semantic",
            agent_id=actor["id"],
            role=actor.get("role"),
            query=f"{metric_id} group_by={group_by or '-'} time={win_name}",
            payload=kwargs,
            status=status,
            cl_value=cl_val,
            db_value=db_val if not isinstance(db_val, dict) else f"{len(db_val)} buckets",
            cl_error=None,
        )
        return out

    # Slice + full semantic matrix for admin; 7d totals for every other agent.
    ta_admin = ToolActor(
        user_id=str(admin["id"]),
        organization_id=_SEP20_ORG,
        user_role="admin",
        user_name=str(admin.get("name") or "") or None,
    )
    with tool_actor_scope(ta_admin), runtime_agent_scope("analytics_audit_query_executor"):
        slice_res = get_ontology_slice(
            organization_id=_SEP20_ORG,
            user_id=str(admin["id"]),
            agent="analytics_audit_query_executor",
            format="json",
            use_cache=False,
        )
    assert slice_res.get("success"), slice_res
    metrics_raw = (slice_res.get("payload") or {}).get("metrics") or []
    metric_dims: list[tuple[str, list[str]]] = []
    for item in metrics_raw:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        dims: list[str] = []
        for key in ("dims", "dimensions"):
            raw_dims = item.get(key) or []
            if isinstance(raw_dims, list):
                for dim in raw_dims:
                    if isinstance(dim, dict):
                        did = str(dim.get("id") or dim.get("name") or "").strip()
                    else:
                        did = str(dim or "").strip()
                    if did and did not in dims:
                        dims.append(did)
        metric_dims.append((str(item["id"]), dims))

    for metric_id, dims in metric_dims:
        for win_name, start, end in windows:
            call_semantic(admin, metric_id, None, win_name, start, end)
        start7, end7 = windows[2][1], windows[2][2]
        for dim in dims:
            call_semantic(admin, metric_id, dim, "last_7d", start7, end7)

    start7, end7 = windows[2][1], windows[2][2]
    for actor in agents:
        if str(actor["id"]) == str(admin["id"]):
            continue
        for metric_id, _dims in metric_dims:
            call_semantic(actor, metric_id, None, "last_7d", start7, end7)

    live_status = fetch_one(
        "SELECT status FROM tickets WHERE organization_id = %s GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1",
        (int(_SEP20_ORG),),
    )
    live_priority = fetch_one(
        "SELECT priority FROM tickets WHERE organization_id = %s GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1",
        (int(_SEP20_ORG),),
    )
    live_customer = fetch_one(
        """
        SELECT customer_email, customer_name
          FROM tickets
         WHERE organization_id = %s AND coalesce(customer_email,'') <> ''
         GROUP BY 1, 2
         ORDER BY COUNT(*) DESC
         LIMIT 1
        """,
        (int(_SEP20_ORG),),
    )
    live_queue = fetch_one(
        "SELECT id::text AS id, queue_name FROM agent_queues WHERE organization_id = %s ORDER BY id LIMIT 1",
        (int(_SEP20_ORG),),
    )
    status_label = str((live_status or {}).get("status") or "Open")
    priority_label = str((live_priority or {}).get("priority") or "high")
    customer_email = str((live_customer or {}).get("customer_email") or "")
    queue_name = str((live_queue or {}).get("queue_name") or "")

    sql_scenarios = [
        ("list_tickets", "wt:Ticket", "List tickets for this organization", ""),
        ("my_tickets", "wt:Ticket", "List tickets assigned to me", "ASSIGNED"),
        ("created_by_me", "wt:Ticket", "List tickets created by me", "CREATED"),
        ("unassigned", "wt:Ticket", "List unassigned tickets", "UNASSIGNED"),
        ("by_status", "wt:Ticket", f"List tickets with status {status_label}", f"AND status = '{status_label}'"),
        ("by_priority", "wt:Ticket", f"List {priority_label} priority tickets", f"AND lower(priority) = '{priority_label.lower()}'"),
        ("by_date_7d", "wt:Ticket", "List tickets created in the last 7 days", "AND created_at >= (CURRENT_DATE - INTERVAL '7 days')"),
        ("top_n", "wt:Ticket", "List the 10 most recently created tickets", "TOP10"),
        ("list_customers", "wt:Customer", "List customers in this organization", "CUSTOMERS"),
        ("find_customer", "wt:Customer", f"Find the customer with email {customer_email}", "FIND_CUSTOMER"),
        ("list_statuses", "wt:Ticket", "List ticket statuses", "STATUSES"),
        ("list_priorities", "wt:Ticket", "List ticket priorities", "PRIORITIES"),
        ("list_teams", "wt:Queue", "List teams", "TEAMS"),
        ("find_team", "wt:Queue", f"Find the team named {queue_name}", "FIND_TEAM"),
        ("team_members", "wt:Queue", f"Show the members of the team {queue_name}", "MEMBERS"),
    ]

    for actor in agents:
        scope_sql, scope_params = _sep20_ticket_scope_sql(str(actor.get("role")), str(actor["id"]))
        ta = ToolActor(
            user_id=str(actor["id"]),
            organization_id=_SEP20_ORG,
            user_role=str(actor.get("role") or "agent"),
            user_name=str(actor.get("name") or "") or None,
        )
        for name, hint, instruction, extra in sql_scenarios:
            with tool_actor_scope(ta), runtime_agent_scope("ticket_lifecycle_executor"):
                sql_out = ask_sql_layer(
                    instruction=instruction,
                    entity_hint=hint,
                    limit=20,
                )
            db_set: set[str] | list[str] | None
            if extra == "ASSIGNED":
                db_set = _sep20_ticket_numbers(
                    "organization_id = %s AND assignee_id = %s",
                    [int(_SEP20_ORG), int(actor["id"])],
                    limit=20,
                )
            elif extra == "CREATED":
                db_set = _sep20_ticket_numbers(
                    "organization_id = %s AND created_by_id = %s",
                    [int(_SEP20_ORG), int(actor["id"])],
                    limit=20,
                )
            elif extra == "UNASSIGNED":
                if str(actor.get("role") or "").lower() != "admin":
                    db_set = set()
                else:
                    db_set = _sep20_ticket_numbers(
                        "organization_id = %s AND (assignee_id IS NULL OR assignee_name IN ('','Unassigned'))",
                        [int(_SEP20_ORG)],
                        limit=20,
                    )
            elif extra == "TOP10":
                db_set = _sep20_ticket_numbers(scope_sql, scope_params, limit=10)
            elif extra.startswith("AND"):
                db_set = _sep20_ticket_numbers(scope_sql, scope_params, extra=extra, limit=20)
            elif extra == "CUSTOMERS":
                rows = fetch_all(
                    """
                    SELECT DISTINCT customer_email
                      FROM tickets
                     WHERE organization_id = %s AND coalesce(customer_email,'') <> ''
                     ORDER BY 1 LIMIT 20
                    """,
                    (int(_SEP20_ORG),),
                )
                db_set = {str(r.get("customer_email") or "").lower() for r in rows}
            elif extra == "FIND_CUSTOMER":
                db_set = {customer_email.lower()} if customer_email else set()
            elif extra == "STATUSES":
                rows = fetch_all(
                    "SELECT DISTINCT status FROM tickets WHERE organization_id = %s ORDER BY 1",
                    (int(_SEP20_ORG),),
                )
                db_set = {str(r.get("status") or "") for r in rows}
            elif extra == "PRIORITIES":
                rows = fetch_all(
                    "SELECT DISTINCT priority FROM tickets WHERE organization_id = %s ORDER BY 1",
                    (int(_SEP20_ORG),),
                )
                db_set = {str(r.get("priority") or "").lower() for r in rows}
            elif extra == "TEAMS":
                rows = fetch_all(
                    "SELECT queue_name FROM agent_queues WHERE organization_id = %s ORDER BY 1",
                    (int(_SEP20_ORG),),
                )
                db_set = {str(r.get("queue_name") or "") for r in rows}
            elif extra == "FIND_TEAM":
                db_set = {queue_name} if queue_name else set()
            elif extra == "MEMBERS":
                rows = fetch_all(
                    """
                    SELECT trim(both from concat_ws(' ', su.first_name, su.last_name)) AS name
                      FROM agent_queue_members m
                      JOIN agents a ON a.id = m.user_id
                      JOIN accounts.setup_users su ON su.id = a.setup_user_id
                     WHERE m.organization_id = %s AND m.queue_id = %s
                    """,
                    (int(_SEP20_ORG), int((live_queue or {}).get("id") or 0)),
                )
                db_set = {str(r.get("name") or "") for r in rows if r.get("name")}
            else:
                db_set = _sep20_ticket_numbers(scope_sql, scope_params, limit=20)

            if not sql_out.get("success"):
                record(
                    kind="sql",
                    agent_id=actor["id"],
                    role=actor.get("role"),
                    query=instruction,
                    payload={"entityHint": hint, "limit": 20},
                    status="CL_ERROR",
                    cl_error=sql_out.get("message"),
                    error_code=sql_out.get("error_code"),
                    db_value=len(db_set) if isinstance(db_set, set) else db_set,
                )
                continue
            rows = (sql_out.get("payload") or {}).get("rows") or []
            if extra in {"CUSTOMERS", "FIND_CUSTOMER"}:
                cl_set = {
                    str(r.get("email") or r.get("customer_email") or "").lower()
                    for r in rows
                    if isinstance(r, dict)
                }
            elif extra in {"STATUSES"}:
                cl_set = {
                    str(r.get("status") or r.get("name") or r.get("displayName") or "")
                    for r in rows
                    if isinstance(r, dict)
                }
            elif extra in {"PRIORITIES"}:
                cl_set = {
                    str(r.get("priority") or r.get("name") or r.get("displayName") or "").lower()
                    for r in rows
                    if isinstance(r, dict)
                }
            elif extra in {"TEAMS", "FIND_TEAM"}:
                cl_set = {
                    str(r.get("queue_name") or r.get("name") or r.get("team") or "")
                    for r in rows
                    if isinstance(r, dict)
                }
            elif extra == "MEMBERS":
                cl_set = {
                    str(r.get("name") or r.get("member") or r.get("assignee_name") or "")
                    for r in rows
                    if isinstance(r, dict)
                }
            else:
                cl_set = _ticket_number_set(rows)
            db_cmp = db_set if isinstance(db_set, set) else set()
            leak = False
            if extra not in {
                "CUSTOMERS",
                "FIND_CUSTOMER",
                "STATUSES",
                "PRIORITIES",
                "TEAMS",
                "FIND_TEAM",
                "MEMBERS",
                "UNASSIGNED",
            } and str(actor.get("role") or "").lower() != "admin":
                allowed = _sep20_ticket_numbers(scope_sql, scope_params, limit=500)
                leak = bool(cl_set - allowed)
            status = "CL_ERROR"
            if sql_out.get("success"):
                if leak:
                    status = "MISMATCH"
                elif not db_cmp and not cl_set:
                    status = "PASS"
                elif extra == "UNASSIGNED" and str(actor.get("role") or "").lower() != "admin" and cl_set:
                    status = "MISMATCH"
                elif db_cmp and cl_set and (cl_set <= db_cmp or db_cmp <= cl_set or cl_set & db_cmp):
                    status = "PASS" if cl_set == db_cmp or (cl_set <= db_cmp) else "MISMATCH"
                elif db_cmp and not cl_set:
                    status = "MISMATCH"
                else:
                    status = "GAP"
            record(
                kind="sql",
                agent_id=actor["id"],
                role=actor.get("role"),
                query=instruction,
                payload={"entityHint": hint, "limit": 20},
                status=status,
                cl_value=sorted(cl_set)[:12],
                db_value=sorted(db_cmp)[:12],
                leak=leak,
            )

    flush_report()
    assert len(cases) > 0
