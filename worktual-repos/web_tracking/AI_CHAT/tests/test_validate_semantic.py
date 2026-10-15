"""Validate semantic plan against slice allowlists."""

from app.mas.models import SemanticPlan
from app.mas.validate import ValidationError, validate_semantic_plan
from app.services.context_layer import MetricDescriptor, OntologySlice


def _slice() -> OntologySlice:
    return OntologySlice(
        prompt="ontology stub",
        metrics=[
            MetricDescriptor(
                id="unique_visitors",
                dims=("country", "website_id"),
                when="Distinct visitors",
            ),
            MetricDescriptor(
                id="web_session_volume",
                dims=("country", "device", "website_id"),
                when="Session count",
            ),
            MetricDescriptor(
                id="online_visitors",
                dims=("website_id",),
                when="Active in last 5 minutes",
            ),
            MetricDescriptor(
                id="product_interaction_count",
                dims=("product_id", "product_name", "website_id"),
                when="Product page views",
            ),
        ],
    )


def test_accepts_valid_plan():
    plan = SemanticPlan(
        metrics=["web_session_volume"],
        filters=[{"dimension": "device", "op": "eq", "values": ["mobile"]}],
        time={"period": "last_7_days"},
    )
    out = validate_semantic_plan(plan, _slice())
    assert out.metrics == ["web_session_volume"]


def test_rejects_unknown_metric():
    plan = SemanticPlan(metrics=["not_a_metric"])
    try:
        validate_semantic_plan(plan, _slice())
        assert False, "expected ValidationError"
    except ValidationError as exc:
        assert "not certified" in exc.message


def test_normalizes_this_month_and_strips_time_for_online():
    plan = SemanticPlan(
        metrics=["online_visitors"],
        time={"period": "this_month"},
    )
    out = validate_semantic_plan(plan, _slice())
    assert out.time is None

    plan2 = SemanticPlan(
        metrics=["web_session_volume"],
        time={"period": "this_month"},
    )
    out2 = validate_semantic_plan(plan2, _slice())
    assert out2.time == {"period": "month"}

    plan3 = SemanticPlan(
        metrics=["web_session_volume"],
        time={"period": "month"},
    )
    out3 = validate_semantic_plan(plan3, _slice(), dashboard_period="month")
    assert out3.time == {"period": "month"}


def test_product_ranking_gets_group_by_and_limit():
    plan = SemanticPlan(metrics=["product_interaction_count"], time={"period": "month"})
    out = validate_semantic_plan(plan, _slice(), dashboard_period="month")
    assert out.group_by == ["product_id"]
    assert out.limit == 10
    assert out.order_by == ["product_interaction_count"]


def test_least_product_sets_sort_asc():
    plan = SemanticPlan(
        metrics=["product_interaction_count"],
        group_by=["product_id"],
        order_by=["product_interaction_count"],
        limit=1,
        time={"period": "month"},
    )
    out = validate_semantic_plan(
        plan,
        _slice(),
        dashboard_period="month",
        standalone_query="Which product was visited the least this month?",
    )
    assert out.sort_direction == "asc"


def test_most_product_sets_sort_desc():
    plan = SemanticPlan(
        metrics=["product_interaction_count"],
        group_by=["product_id"],
        limit=1,
        time={"period": "month"},
    )
    out = validate_semantic_plan(
        plan,
        _slice(),
        standalone_query="Which product was visited the most this month?",
    )
    assert out.sort_direction == "desc"


def test_normalizes_empty_dimension_product_filter():
    plan = SemanticPlan(
        metrics=["product_interaction_count"],
        filters=[{"dimension": "", "op": "eq", "values": ["CONTRASTING MIDI DRESS"]}],
        time={"period": "month"},
    )
    out = validate_semantic_plan(plan, _slice(), dashboard_period="month")
    assert out.filters[0]["dimension"] == "product_name"
    assert out.group_by == []


def test_product_filter_does_not_force_group_by():
    plan = SemanticPlan(
        metrics=["product_interaction_count"],
        filters=[{"dimension": "product_name", "op": "eq", "values": ["CONTRASTING MIDI DRESS"]}],
        time={"period": "month"},
    )
    out = validate_semantic_plan(plan, _slice(), dashboard_period="month")
    assert out.group_by == []


def test_rejects_device_on_visitors_when_not_in_dims():
    plan = SemanticPlan(
        metrics=["unique_visitors"],
        filters=[{"dimension": "device", "op": "eq", "values": ["mobile"]}],
    )
    try:
        validate_semantic_plan(plan, _slice())
        assert False, "expected ValidationError"
    except ValidationError as exc:
        assert "device" in exc.message
