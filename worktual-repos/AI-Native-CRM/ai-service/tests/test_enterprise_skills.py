from __future__ import annotations

import pytest

from app.orchestrator.contracts import AgentKind, AgentSpec
from app.orchestrator.errors import PolicyViolationError
from app.skills import DEFAULT_SKILL_REGISTRY, compose_system_prompt, effective_tool_names


def agent(**overrides) -> AgentSpec:
    data = {
        "name": "enterprise-coworker",
        "version": "1.0",
        "kind": AgentKind.COWORKER,
        "execution": "turn",
        "allowedSkills": [
            "contact-crud", "company-crud", "proposals", "quotes", "invoices",
            "activities", "nurture", "scoring", "lifecycle", "meetings", "reports",
        ],
        "allowedTools": [
            "navigate", "patch_contact_draft", "propose_create_contact",
            "propose_create_invoice", "unrelated_admin_tool",
        ],
    }
    data.update(overrides)
    return AgentSpec.model_validate(data)


def test_catalog_covers_required_skills_and_discloses_summaries_only():
    summaries = DEFAULT_SKILL_REGISTRY.list_summaries()
    assert {item["name"] for item in summaries} == {
        "contact-crud", "company-crud", "proposals", "quotes", "invoices",
        "activities", "nurture", "scoring", "lifecycle", "meetings", "reports",
    }
    assert all(set(item) == {"name", "description"} for item in summaries)


def test_selected_package_loads_full_six_sections_and_contracts():
    package = DEFAULT_SKILL_REGISTRY.load(
        "contact-crud", agent=agent(), role="sales_rep", business_type="b2b"
    )
    for section in ("Role:", "Goal:", "Instructions:", "Context:", "Output:", "Guardrails:"):
        assert section in package.canonical_prompt_fragment
    assert package.spec.context_policy.allowed_fields
    assert package.spec.input_schema["type"] == "object"
    assert package.spec.completion_tests


def test_role_business_and_agent_eligibility_are_enforced():
    with pytest.raises(PolicyViolationError):
        DEFAULT_SKILL_REGISTRY.load(
            "invoices", agent=agent(), role="finance", business_type="b2c"
        )
    with pytest.raises(PolicyViolationError):
        DEFAULT_SKILL_REGISTRY.load(
            "quotes",
            agent=agent(allowedSkills=["reports"]),
            role="sales_rep",
            business_type="b2b",
        )


def test_skill_tool_intersection_never_broadens_agent_tools():
    contact = DEFAULT_SKILL_REGISTRY.load(
        "contact-crud", agent=agent(), role="sales_rep", business_type="b2b"
    )
    allowed = effective_tool_names(agent(), (contact,))
    assert allowed == {
        "navigate", "patch_contact_draft", "propose_create_contact"
    }
    assert "unrelated_admin_tool" not in allowed


def test_prompt_composition_reuses_base_stack_and_redacts_context():
    package = DEFAULT_SKILL_REGISTRY.load(
        "reports", agent=agent(), role="viewer", business_type="b2c"
    )
    composed = compose_system_prompt(
        "Role:\nBase\n\nGoal:\nBase goal",
        (package,),
        context={"module": "reports", "token": "secret", "untrusted": "drop"},
    )
    assert composed.startswith("Role:\nBase")
    assert "Selected skill: reports" in composed
    assert "untrusted" not in composed
    assert "'token'" not in composed

