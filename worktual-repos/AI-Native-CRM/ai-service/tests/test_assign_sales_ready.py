from app.agents.assign_sales_agent import _is_model_failure, _must_assign


def test_score_at_least_40_must_assign():
    assert _must_assign({"score": 40}) is True
    assert _must_assign({"score": "41"}) is True
    assert _must_assign({"score": 39}) is False
    assert _must_assign({}) is False


def test_refusing_a_sales_ready_owner_is_a_model_failure():
    assert _is_model_failure("llm_invalid:ValueError") is True
    assert _is_model_failure("No sales rep fit this lead.") is False
