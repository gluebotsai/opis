from app.runtime.sse import (
    routing_label_for_agent,
    routing_label_for_path,
    sse_tool_progress,
    sse_writing,
)


def test_routing_label_for_path_destinations() -> None:
    assert "live monitoring" in routing_label_for_path("/admin/monitoring").lower()
    assert "contacts" in routing_label_for_path("/admin/contacts").lower()
    assert "queues" in routing_label_for_path("/admin/workforce/queues").lower()
    assert "tasks" in routing_label_for_path("/agent/tasks").lower()
    assert "dashboard" in routing_label_for_path("/admin/dashboard").lower()
    assert "analytics" in routing_label_for_path("/admin/dashboard/analytics").lower()
    assert "performance" in routing_label_for_path("/agent/performance").lower()


def test_routing_label_for_agent() -> None:
    assert "contacts" in routing_label_for_agent("contact").lower()
    assert "analytics" in routing_label_for_agent("analytics").lower()
    assert "specialist" in routing_label_for_agent("unknown").lower()


def test_sse_tool_progress_semantic_and_sql_chains() -> None:
    ontology = sse_tool_progress("ask_ontology_layer")
    assert "knowledge graph" in ontology[0].lower()

    semantic = sse_tool_progress("ask_semantic_layer")
    assert "Utilizing the semantic layer" in semantic[0]

    kpi = sse_tool_progress("generate_performance_report")
    assert "Generating KPI" in kpi[0]

    sql = sse_tool_progress("sql_analytics", has_presentation=True)
    assert len(sql) == 3
    assert "analytics query" in sql[0]
    assert "Fetching data" in sql[1]
    assert "Constructing the chart" in sql[2]


def test_sse_tool_progress_navigate_uses_path() -> None:
    events = sse_tool_progress("navigate", path="/admin/contacts")
    assert "contacts" in events[0]


def test_sse_writing_says_generating_response() -> None:
    assert "Generating response" in sse_writing()
