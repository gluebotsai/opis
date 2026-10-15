from pathlib import Path

from app.agents.reports_b2b.core.prompt_load import listed_skill_ids, load_agent_prompt, skill_body

PACK = Path(__file__).resolve().parents[2] / "app" / "agents" / "reports_b2b"


def test_listed_skill_ids_and_compose():
    domain = PACK / "domain" / "agent.md"
    ids = listed_skill_ids(domain.read_text())
    assert ids == [
        "crm-kpi-catalog",
        "crm-terms",
        "crm-object-lock",
        "crm-money",
        "crm-plan-kg",
        "crm-user-brief",
    ]
    prompt = load_agent_prompt(domain)
    assert "Lock the **object**" in prompt
    assert "`lead_count`" in prompt
    assert "won_revenue" in prompt
    sql = load_agent_prompt(PACK / "sql_executor" / "agent.md")
    assert "rpt.deals" in sql
    kg = load_agent_prompt(PACK / "kg_executor" / "agent.md")
    assert "Cypher" in kg or "cypher" in kg
    assert "DIRECT EXECUTIVE ANSWER" not in kg
    brief = skill_body("crm-kg-briefing")
    assert "NEVER MIX" in brief.upper() or "Never mix" in brief
