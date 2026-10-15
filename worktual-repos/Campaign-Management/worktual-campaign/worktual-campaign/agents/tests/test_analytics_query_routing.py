from app.services.analytics_query_routing import question_wants_monitoring_status_counts


def test_monitoring_phrase_routing_disabled_for_chat():
    assert not question_wants_monitoring_status_counts("How many campaigns are in past?")
    assert not question_wants_monitoring_status_counts("last week performance")
