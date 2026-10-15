"""Dual Agent (L1) + Resolver (L2) triage matrix."""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from app.tasks.assign import (
    pick_assignee,
    resolver_auto_assign_min_confidence,
    roster_text,
    skill_score_to_confidence,
)
from app.tasks.pipeline import run_triage_assign
from app.tasks.schemas import TriageAssignRequest


def test_llm_triage_returns_roster_agent_and_resolver():
    from app.tasks.triage import llm_triage

    class _Msg:
        content = (
            '{"subject":"VPN down","description":"Tunnel failed","priority":"high",'
            '"category":"Network","skill":"VPN","queue":"Network",'
            '"agent":"Alice Agent","resolver":"Rita Resolver","confidence":0.91,'
            '"rationale":"VPN skill."}'
        )

    with patch("app.tasks.triage.get_llm") as llm:
        llm.return_value.invoke.return_value = _Msg()
        out = llm_triage(
            customer_name="Pat",
            customer_email="pat@example.com",
            customer_phone=None,
            issue="VPN cannot connect",
            team_names=["Network"],
            teams_context="- Team Network",
            roster_text="- Alice Agent | role: agent",
            agent_names=["Alice Agent"],
            resolver_names=["Rita Resolver"],
        )
    assert out is not None
    assert out["agent"] == "Alice Agent"
    assert out["resolver"] == "Rita Resolver"
    assert out["confidence"] == 0.91
    assert out["enrichedByAi"] is True


def test_no_teams_still_uses_llm_for_subject_and_description():
    """Regression: empty MyAccount teams must not leave subject as raw truncate."""
    from app.tasks.triage import llm_compose_ticket_copy

    class _Msg:
        content = (
            '{"subject":"CCaaS login and glitch issues",'
            '"description":"Customer Deva reports intermittent CCaaS login failures '
            'and AI CCaaS glitches that need fixing.",'
            '"priority":"medium"}'
        )

    rant = (
        "while opening my ccaas account sometimes i face login issue and there "
        "is some glitch in aiccaas fix it soon"
    )
    with patch("app.tasks.triage.get_llm") as llm:
        llm.return_value.invoke.return_value = _Msg()
        copy = llm_compose_ticket_copy(
            customer_name="Deva",
            customer_email="devasekar815@gmail.com",
            customer_phone=None,
            issue=rant,
        )
    assert copy is not None
    assert copy["enrichedByAi"] is True
    assert copy["subject"] == "CCaaS login and glitch issues"
    assert rant not in copy["subject"]
    assert "login" in copy["description"].lower() or "CCaaS" in copy["description"]

    with patch("app.tasks.pipeline.list_org_teams", return_value=[]), patch(
        "app.tasks.pipeline.list_org_agents", return_value=[]
    ), patch(
        "app.tasks.pipeline.org_skills_by_user", return_value={}
    ), patch(
        "app.tasks.pipeline.open_workload_by_assignee", return_value={}
    ), patch(
        "app.tasks.pipeline.open_workload_by_resolver", return_value={}
    ), patch(
        "app.tasks.pipeline.resolve_org_id", return_value="org-no-teams"
    ), patch(
        "app.tasks.pipeline._load_triage_snapshot", return_value=None
    ), patch(
        "app.tasks.triage.get_llm"
    ) as llm:
        llm.return_value.invoke.return_value = _Msg()
        out = run_triage_assign(
            TriageAssignRequest(
                organization_id="org-no-teams",
                customer_name="Deva",
                customer_email="devasekar815@gmail.com",
                issue=rant,
                created_by_role="admin",
            )
        )
    assert out.enrichedByAi is True
    assert out.subject == "CCaaS login and glitch issues"
    assert out.subject != rant[:80]
    assert "No teams configured" in (out.rationale or "")
    assert out.assignee == "Unassigned"


def test_llm_triage_drops_invented_people():
    from app.tasks.triage import llm_triage

    class _Msg:
        content = (
            '{"subject":"VPN down","description":"Tunnel failed","priority":"high",'
            '"category":"Network","skill":"VPN","queue":"Network",'
            '"agent":"Invented Person","resolver":"Nobody","confidence":0.9,'
            '"rationale":"made up."}'
        )

    with patch("app.tasks.triage.get_llm") as llm:
        llm.return_value.invoke.return_value = _Msg()
        out = llm_triage(
            customer_name="Pat",
            customer_email="pat@example.com",
            customer_phone=None,
            issue="VPN cannot connect",
            team_names=["Network"],
            teams_context="- Team Network",
            roster_text="- Alice Agent | role: agent",
            agent_names=["Alice Agent"],
            resolver_names=["Rita Resolver"],
        )
    assert out is not None
    assert out["agent"] is None
    assert out["resolver"] is None


def test_llm_triage_prompt_always_picks_resolver():
    from app.tasks.triage import llm_triage

    class _Msg:
        content = (
            '{"subject":"VPN down","description":"Tunnel failed","priority":"high",'
            '"category":"Network","skill":"VPN","queue":"Network",'
            '"agent":"Alice Agent","resolver":"Rita Resolver","confidence":0.4,'
            '"rationale":"Named Rita despite low confidence."}'
        )

    with patch("app.tasks.triage.get_llm") as llm:
        llm.return_value.invoke.return_value = _Msg()
        llm_triage(
            customer_name="Pat",
            customer_email="pat@example.com",
            customer_phone=None,
            issue="VPN cannot connect",
            team_names=["Network"],
            teams_context="- Team Network",
            roster_text="- Rita Resolver | role: resolver | skills: VPN | L2 open tickets: 1",
            agent_names=["Alice Agent"],
            resolver_names=["Rita Resolver"],
        )
    system = llm.return_value.invoke.call_args[0][0][0]["content"]
    assert "ALWAYS pick a resolver" in system
    assert "confidence describes skill fit only" in system
    assert "Never invent a person" in system


def test_llm_pick_resolver_returns_roster_name():
    from app.tasks.triage import llm_pick_resolver

    class _Msg:
        content = (
            '{"resolver":"Rita Resolver","confidence":0.77,'
            '"rationale":"VPN skill and lighter L2 load."}'
        )

    with patch("app.tasks.triage.get_llm") as llm:
        llm.return_value.invoke.return_value = _Msg()
        out = llm_pick_resolver(
            issue="VPN cannot connect",
            priority="high",
            skill="VPN",
            queue="Network",
            roster_text="- Rita Resolver | role: resolver | skills: VPN | L2 open tickets: 1",
            resolver_names=["Rita Resolver", "Bob Resolver"],
            exclude_name="Alice Agent",
        )
    assert out is not None
    assert out["resolver"] == "Rita Resolver"
    assert out["confidence"] == 0.77
    system = llm.return_value.invoke.call_args[0][0][0]["content"]
    assert "Rita Resolver" in system
    assert "Always name a resolver" in system


def test_llm_pick_resolver_drops_invented_and_excluded():
    from app.tasks.triage import llm_pick_resolver

    class _Invented:
        content = '{"resolver":"Nobody","confidence":0.9,"rationale":"made up."}'

    with patch("app.tasks.triage.get_llm") as llm:
        llm.return_value.invoke.return_value = _Invented()
        out = llm_pick_resolver(
            issue="VPN cannot connect",
            priority="high",
            skill="VPN",
            queue="Network",
            roster_text="- Rita Resolver | role: resolver",
            resolver_names=["Rita Resolver"],
        )
    assert out is None

    class _Self:
        content = '{"resolver":"Alice Agent","confidence":0.9,"rationale":"self."}'

    with patch("app.tasks.triage.get_llm") as llm:
        llm.return_value.invoke.return_value = _Self()
        skipped = llm_pick_resolver(
            issue="VPN cannot connect",
            priority="high",
            skill="VPN",
            queue="Network",
            roster_text="- Rita Resolver | role: resolver",
            resolver_names=["Rita Resolver", "Alice Agent"],
            exclude_name="Alice Agent",
        )
    assert skipped is None


def test_skill_score_to_confidence_mapping():
    assert skill_score_to_confidence(2) == 1.0
    assert skill_score_to_confidence(1) == 0.5
    assert skill_score_to_confidence(0) == 0.0


def test_parse_confidence_clamps():
    from app.tasks.triage import parse_confidence

    assert parse_confidence(0.9) == 0.9
    assert parse_confidence("0.75") == 0.75
    assert parse_confidence(1.5) == 1.0
    assert parse_confidence(-0.2) == 0.0
    assert parse_confidence(None) is None
    assert parse_confidence("bad") is None


def test_resolver_threshold_default(monkeypatch):
    monkeypatch.delenv("RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE", raising=False)
    assert resolver_auto_assign_min_confidence() == 0.5
    monkeypatch.setenv("RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE", "0.9")
    assert resolver_auto_assign_min_confidence() == 0.9


AGENT = {
    "id": "a1",
    "name": "Alice Agent",
    "role": "agent",
    "status": "Active",
}
RESOLVER = {
    "id": "r1",
    "name": "Rita Resolver",
    "role": "resolver",
    "status": "Active",
}
TEAM = {
    "id": "t1",
    "name": "Network",
    "member_ids": ["a1", "r1"],
}


@contextmanager
def _fake_db_conn():
    yield MagicMock()


@pytest.fixture
def no_db():
    with patch("app.db.db_conn", _fake_db_conn):
        yield


@pytest.fixture
def triage_env(monkeypatch, no_db):
    monkeypatch.setenv("RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE", "0.5")

    def fake_categorize(**_kwargs):
        return {
            "subject": "VPN down",
            "description": "Cannot connect VPN",
            "priority": "high",
            "category": "Network",
            "skill": "VPN",
            "queue": "Network",
            "confidence": None,
            "rationale": "Matched Network.",
            "enrichedByAi": False,
        }

    def fake_itra_llm(*_a, **_k):
        return {
            "agent": "Alice Agent",
            "resolver": "Rita Resolver",
            "confidence": 0.9,
            "rationale": "ITRA LLM VPN fit",
        }

    with (
        patch("app.tasks.pipeline.resolve_org_id", return_value="org-1"),
        patch("app.tasks.pipeline.list_org_teams", return_value=[dict(TEAM)]),
        patch(
            "app.tasks.pipeline.list_org_agents",
            return_value=[dict(AGENT), dict(RESOLVER)],
        ),
        patch(
            "app.tasks.pipeline.org_skills_by_user",
            return_value={
                "a1": ["General"],
                "r1": ["VPN", "Network"],
            },
        ),
        patch("app.tasks.pipeline.open_workload_by_assignee", return_value={}),
        patch("app.tasks.pipeline.open_workload_by_resolver", return_value={}),
        patch("app.tasks.pipeline.categorize_ticket", side_effect=fake_categorize),
        patch("app.tasks.assign.list_org_teams", return_value=[dict(TEAM)]),
        patch(
            "app.tasks.assign.list_org_agents",
            return_value=[dict(AGENT), dict(RESOLVER)],
        ),
        patch(
            "app.tasks.assign.org_skills_by_user",
            return_value={
                "a1": ["General"],
                "r1": ["VPN", "Network"],
            },
        ),
        patch("app.tasks.assign.open_workload_by_assignee", return_value={}),
        patch("app.tasks.assign.open_workload_by_resolver", return_value={}),
        patch("app.proactive.itra.run_agent_llm", side_effect=fake_itra_llm),
    ):
        yield


def test_customer_high_confidence_sets_resolver(triage_env):
    with patch(
        "app.tasks.pipeline.categorize_ticket",
        return_value={
            "subject": "VPN down",
            "description": "Cannot connect VPN",
            "priority": "high",
            "category": "Network",
            "skill": "VPN",
            "queue": "Network",
            "agent": "Alice Agent",
            "resolver": "Rita Resolver",
            "confidence": 0.91,
            "rationale": "VPN skill on Rita.",
            "enrichedByAi": True,
        },
    ):
        out = run_triage_assign(
            TriageAssignRequest(
                organization_id="org-1",
                customer_name="Pat",
                customer_email="pat@example.com",
                issue="VPN cannot connect to office",
                created_by_role="customer",
            )
        )
    assert out.assignee == "Alice Agent"
    assert out.assignee_id == "a1"
    assert out.resolver == "Rita Resolver"
    assert out.resolver_id == "r1"
    assert out.resolver_confidence is not None
    assert "L1 assigned by ITRA" in out.rationale
    assert "L2 resolver assigned by ITRA" in out.rationale


def test_customer_no_llm_resolver_uses_itra(triage_env):
    """Create-time L1/L2 come from ITRA skill-first routing."""
    out = run_triage_assign(
        TriageAssignRequest(
            organization_id="org-1",
            customer_name="Pat",
            customer_email="pat@example.com",
            issue="Something vague about access",
            created_by_role="customer",
        )
    )
    assert out.assignee == "Alice Agent"
    assert out.resolver == "Rita Resolver"
    assert out.resolver_id == "r1"
    assert "ITRA" in (out.rationale or "")


def test_agent_create_forces_self_and_excludes_from_resolver(triage_env):
    with patch(
        "app.tasks.pipeline.categorize_ticket",
        return_value={
            "subject": "VPN down",
            "description": "Cannot connect VPN",
            "priority": "high",
            "category": "Network",
            "skill": "VPN",
            "queue": "Network",
            "agent": "Alice Agent",
            "resolver": "Rita Resolver",
            "confidence": 0.9,
            "rationale": "VPN skill.",
            "enrichedByAi": True,
        },
    ):
        out = run_triage_assign(
            TriageAssignRequest(
                organization_id="org-1",
                customer_name="Pat",
                customer_email="pat@example.com",
                issue="VPN tunnel flapping",
                created_by_role="agent",
                force_assignee_id="a1",
                force_assignee_name="Alice Agent",
            )
        )
    assert out.assignee == "Alice Agent"
    assert out.assignee_id == "a1"
    assert out.resolver == "Rita Resolver"
    assert out.resolver_id == "r1"
    assert out.resolver_id != out.assignee_id


def test_itra_picks_skill_matched_resolver_not_categorize_names(triage_env):
    """ITRA ignores categorize agent/resolver names; LLM picks from roster."""
    other_resolver = {
        "id": "r2",
        "name": "Bob Resolver",
        "role": "resolver",
        "status": "Active",
    }
    team_with_bob = {
        "id": "t1",
        "name": "Network",
        "member_ids": ["a1", "r1", "r2"],
    }
    with (
        patch(
            "app.tasks.pipeline.list_org_teams",
            return_value=[dict(team_with_bob)],
        ),
        patch(
            "app.tasks.assign.list_org_teams",
            return_value=[dict(team_with_bob)],
        ),
        patch(
            "app.tasks.pipeline.list_org_agents",
            return_value=[dict(AGENT), dict(RESOLVER), dict(other_resolver)],
        ),
        patch(
            "app.tasks.assign.list_org_agents",
            return_value=[dict(AGENT), dict(RESOLVER), dict(other_resolver)],
        ),
        patch(
            "app.tasks.pipeline.org_skills_by_user",
            return_value={
                "a1": ["General"],
                "r1": ["VPN", "Network"],
                "r2": ["Billing", "Invoice"],
            },
        ),
        patch(
            "app.tasks.assign.org_skills_by_user",
            return_value={
                "a1": ["General"],
                "r1": ["VPN", "Network"],
                "r2": ["Billing", "Invoice"],
            },
        ),
        patch(
            "app.tasks.pipeline.categorize_ticket",
            return_value={
                "subject": "Invoice dispute",
                "description": "Wrong charge",
                "priority": "medium",
                "category": "Billing",
                "skill": "Billing",
                "queue": "Network",
                "agent": "Alice Agent",
                "resolver": "Rita Resolver",
                "confidence": 0.88,
                "rationale": "Would have picked Rita via LLM.",
                "enrichedByAi": True,
            },
        ),
        patch(
            "app.proactive.itra.run_agent_llm",
            return_value={
                "agent": "Alice Agent",
                "resolver": "Bob Resolver",
                "confidence": 0.9,
                "rationale": "Billing skill on Bob",
            },
        ),
    ):
        out = run_triage_assign(
            TriageAssignRequest(
                organization_id="org-1",
                customer_name="Pat",
                customer_email="pat@example.com",
                issue="Invoice charged twice",
                created_by_role="customer",
            )
        )
    assert out.assignee == "Alice Agent"
    assert out.assignee_id == "a1"
    assert out.resolver == "Bob Resolver"
    assert out.resolver_id == "r2"
    assert "L1 assigned by ITRA" in out.rationale
    assert "L2 resolver assigned by ITRA" in out.rationale


def test_itra_assigns_even_when_categorize_confidence_low(triage_env):
    """ITRA assignment is independent of categorize confidence metadata."""
    with patch(
        "app.tasks.pipeline.categorize_ticket",
        return_value={
            "subject": "VPN down",
            "description": "x",
            "priority": "high",
            "category": "Network",
            "skill": "VPN",
            "queue": "Network",
            "agent": "Alice Agent",
            "resolver": "Rita Resolver",
            "confidence": 0.4,
            "rationale": "LLM named Rita.",
            "enrichedByAi": True,
        },
    ):
        out = run_triage_assign(
            TriageAssignRequest(
                organization_id="org-1",
                customer_name="Pat",
                customer_email="pat@example.com",
                issue="VPN cannot connect",
                created_by_role="customer",
            )
        )
    assert out.resolver == "Rita Resolver"
    assert out.resolver_id == "r1"
    assert "ITRA" in (out.rationale or "")


def test_itra_fills_l2_when_triage_omits_names(triage_env):
    out = run_triage_assign(
        TriageAssignRequest(
            organization_id="org-1",
            customer_name="Pat",
            customer_email="pat@example.com",
            issue="VPN cannot connect",
            created_by_role="customer",
        )
    )
    assert out.resolver == "Rita Resolver"
    assert out.resolver_id == "r1"
    assert "ITRA" in (out.rationale or "")


def test_pick_assignee_prefer_resolvers_uses_resolver_pool(no_db):
    with (
        patch("app.tasks.assign.open_workload_by_resolver", return_value={}),
        patch("app.tasks.assign.open_workload_by_assignee", return_value={}),
    ):
        picked = pick_assignee(
            org_id="org-1",
            skill="VPN",
            queue="Network",
            agents=[dict(AGENT), dict(RESOLVER)],
            skills_map={"a1": ["VPN"], "r1": ["VPN"]},
            team=dict(TEAM),
            prefer_agents=False,
            prefer_resolvers=True,
            exclude_user_id="a1",
        )
    assert picked["assignee"] == "Rita Resolver"
    assert picked["confidence"] == 1.0


def test_roster_text_uses_l2_load_for_resolvers():
    text = roster_text(
        [dict(AGENT), dict(RESOLVER)],
        {"a1": ["General"], "r1": ["VPN"]},
        {"Alice Agent": 9, "Rita Resolver": 9},
        resolver_workload={"Rita Resolver": 2},
    )
    assert "Alice Agent" in text and "open tickets: 9" in text
    assert "L2 open tickets: 2" in text
    rita_line = next(line for line in text.splitlines() if "Rita Resolver" in line)
    assert "L2 open tickets: 2" in rita_line
    assert "open tickets: 9" not in rita_line


def test_agent_create_forces_self_itra_still_picks_resolver(triage_env):
    out = run_triage_assign(
        TriageAssignRequest(
            organization_id="org-1",
            customer_name="Pat",
            customer_email="pat@example.com",
            issue="VPN tunnel flapping",
            created_by_role="agent",
            force_assignee_id="a1",
            force_assignee_name="Alice Agent",
        )
    )
    assert out.assignee == "Alice Agent"
    assert out.resolver == "Rita Resolver"
    assert "creating agent" in (out.rationale or "").lower() or out.assignee_id == "a1"
    assert "ITRA" in (out.rationale or "")
