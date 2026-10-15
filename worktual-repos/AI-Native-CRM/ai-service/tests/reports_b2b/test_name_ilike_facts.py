from decimal import Decimal

from app.agents.reports_b2b.core.facts import _num, assemble_facts
from app.agents.reports_b2b.core.grounding import apply_grounding
from app.agents.reports_b2b.core.name_ilike import rewrite_name_predicates


def test_num_decimal():
    assert _num(Decimal("10000.00")) == 10000.0
    assert _num(True) is None


def test_assemble_facts_sums_decimal_pipeline():
    facts = assemble_facts(
        {
            "status": "ok",
            "rows": [
                {"owner": "Yaswanth MG", "total_pipeline": Decimal("10000.00")},
                {"owner": "Raghuram M", "total_pipeline": Decimal("0.00")},
            ],
        },
        kpi_id="total_pipeline",
        group_by=["owner"],
        answer_type="breakdown",
    )
    assert "total_total_pipeline: 10000" in facts
    assert "Yaswanth MG: 10000.00" in facts


def test_grounding_keeps_prose_not_result_dump():
    facts = "catalog_kpi: total_pipeline\nRESULT: 5 group(s)\nYaswanth MG: 10000.00"
    briefing = "Yaswanth holds 100% of the 10,000 pipeline."

    def regen(_prev, _ung):
        return "Yaswanth holds 100% of the 10,000 pipeline."

    answer, grounded = apply_grounding(briefing, facts, regen, max_retries=1)
    assert grounded is False
    assert "catalog_kpi" not in answer
    assert "RESULT:" not in answer
    assert "Yaswanth" in answer
    assert "unverified" in answer.lower()


def test_rewrite_title_equals_to_ilike():
    sql = "SELECT id, title FROM rpt.deals WHERE is_open = TRUE AND title = 'expansion'"
    out = rewrite_name_predicates(sql)
    compact = out.lower().replace(" ", "")
    assert "ilike" in compact
    assert "%expansion%" in compact
    assert "title='expansion'" not in compact


def test_rewrite_leaves_stage_equals():
    sql = "SELECT id FROM rpt.deals WHERE stage = 'closed_won'"
    out = rewrite_name_predicates(sql)
    assert "closed_won" in out
    assert "ILIKE" not in out.upper()


def test_rewrite_already_wildcard_ilike():
    sql = "SELECT id FROM rpt.deals WHERE title ILIKE '%expansion%'"
    out = rewrite_name_predicates(sql)
    assert "%expansion%" in out.replace(" ", "")
