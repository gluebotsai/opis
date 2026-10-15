from app.reports.traffic_sources import is_traffic_sources_query, try_traffic_sources_plan
from app.services.context_layer import MetricDescriptor, OntologySlice


def _slice() -> OntologySlice:
    return OntologySlice(
        prompt="stub",
        metrics=[
            MetricDescriptor(
                id="web_session_volume",
                dims=("website_id", "utm_source", "country"),
            ),
        ],
    )


def test_detect_traffic_sources_phrase():
    assert is_traffic_sources_query("give the Traffic Sources")


def test_build_traffic_plan():
    plan = try_traffic_sources_plan(
        "give the Traffic Sources",
        slice_data=_slice(),
        dashboard_period="month",
    )
    assert plan is not None
    assert plan.metrics == ["web_session_volume"]
    assert plan.group_by == ["utm_source"]
    assert plan.time == {"period": "month"}
