from pathlib import Path
import importlib.util

PACK = Path(__file__).resolve().parents[2]


def _load(name: str, rel: str):
    path = PACK / rel
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


prompt_load = _load("crm_copy_prompt_load", "core/prompt_load.py")


def test_listed_skill_ids_and_compose():
    domain = PACK / "domain" / "agent.md"
    ids = prompt_load.listed_skill_ids(domain.read_text())
    assert ids == ["crm-kpi-catalog", "crm-object-lock", "crm-money", "crm-plan-kg"]
    prompt = prompt_load.load_agent_prompt(domain)
    assert "end_goal" in prompt
    assert "Lock the **object**" in prompt
    assert "`lead_count`" in prompt
    assert "won_revenue" in prompt
    sql = prompt_load.load_agent_prompt(PACK / "sql_executor" / "agent.md")
    assert "rpt.deals" in sql
    assert "KPI path" in sql
    kg = prompt_load.load_agent_prompt(PACK / "kg_executor" / "agent.md")
    assert "organization_id" in kg
    assert "DIRECT EXECUTIVE ANSWER" not in kg
    brief = prompt_load.skill_body("crm-kg-briefing")
    assert "### Descriptive" in brief
    assert "### Predictive" in brief
    assert "### Recommended" in brief
    assert "NEVER MIX" in brief.upper() or "Never mix" in brief
