from reports_analytics_agent_CRM_B2B.core.analysis import compute_period_delta, compute_share_of_total

def test_compute_period_delta():
    res = compute_period_delta(120.0, 100.0)
    assert res["absolute_delta"] == 20.0
    assert res["pct_change"] == 20.0
    assert res["direction"] == "up"

def test_compute_share_of_total():
    segments = [
        {"stage": "qualification", "amount": 200},
        {"stage": "negotiate", "amount": 800}
    ]
    res = compute_share_of_total(segments, "amount")
    assert res[0]["share_pct"] == 20.0
    assert res[1]["share_pct"] == 80.0
