from app.services.semantic_layer import (
    adapt_semantic_rows,
    ask_semantic_layer_gateway,
    enrich_query_with_period,
    format_duration_seconds,
    interpret_semantic_response,
    log_semantic_layer_call,
    rows_have_values,
    _summarize_adapted_result,
    _summarize_raw_response,
)
from app.config import Settings


def test_enrich_query_with_period_custom_range() -> None:
    result = enrich_query_with_period(
        "how many handled today?",
        period_start="2026-08-01",
        period_end="2026-08-18",
    )
    assert "2026-08-01" in result
    assert "2026-08-18" in result


async def test_semantic_gateway_sends_organization_id() -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"rows": [{"total_conversations": 1}]}

    class FakeClient:
        async def post(self, url: str, *, json: dict[str, object]) -> FakeResponse:
            captured.update(json)
            return FakeResponse()

        async def aclose(self) -> None:
            return None

    result = await ask_semantic_layer_gateway(
        "handled today",
        tenant_id="1000",
        settings=Settings(semantic_layer_url="http://semantic.test"),
        client=FakeClient(),  # type: ignore[arg-type]
    )
    assert result == {"rows": [{"total_conversations": 1}]}
    assert captured["tenant_id"] == "1000"
    assert captured["organization_id"] == "1000"


def test_scalar_rows_become_kpi_card() -> None:
    result = adapt_semantic_rows(
        [{"total_conversations": 7}],
        query="how many conversations were handled today?",
    )
    assert result["ok"] is True
    assert result["chartType"] == "kpi"
    assert result["data"] == [{"label": "Total Conversations", "value": "7"}]


def test_format_duration_seconds_matches_reports() -> None:
    assert format_duration_seconds(45) == "45s"
    assert format_duration_seconds(120) == "2m"
    assert format_duration_seconds(7020) == "1h 57m"
    assert format_duration_seconds(3600) == "1h"
    assert format_duration_seconds(float("nan")) == "—"


def test_handle_time_rows_format_with_hours() -> None:
    result = adapt_semantic_rows(
        [{"average_handle_time": 7020}],
        query="average handle time",
    )
    assert result["chartType"] == "kpi"
    assert result["data"][0]["value"] == "1h 57m"


def test_rate_rows_format_as_percentage() -> None:
    result = adapt_semantic_rows(
        [{"missed_contact_rate": 0.5581395348837209}],
        query="what is the missed contact rate?",
    )
    assert result["data"][0]["value"] == "55.8%"


def test_day_and_channel_rows_become_multi_series_line() -> None:
    result = adapt_semantic_rows(
        [
            {
                "conversation__channel": "webchat",
                "conversation__created_at__day": "2026-09-02T00:00:00",
                "total_conversations": 3,
            },
            {
                "conversation__channel": "email",
                "conversation__created_at__day": "2026-09-02T00:00:00",
                "total_conversations": 1,
            },
            {
                "conversation__channel": "webchat",
                "conversation__created_at__day": "2026-09-03T00:00:00",
                "total_conversations": 2,
            },
        ],
        query="daily channel count last 7 days",
        chart_type="line",
    )
    assert result["chartType"] == "line"
    assert [row["series"] for row in result["data"]] == ["Web Chat", "Email", "Web Chat"]
    assert [row["value"] for row in result["data"]] == [3, 1, 2]


def test_day_and_channel_defaults_to_multi_series_line_not_pie() -> None:
    result = adapt_semantic_rows(
        [
            {
                "conversation__channel": "webchat",
                "conversation__created_at__day": "2026-09-02T00:00:00",
                "total_conversations": 3,
            },
            {
                "conversation__channel": "email",
                "conversation__created_at__day": "2026-09-02T00:00:00",
                "total_conversations": 1,
            },
        ],
        query="daily channel count last 7 days",
    )
    assert result["chartType"] == "line"
    assert {row["series"] for row in result["data"]} == {"Web Chat", "Email"}


def test_channel_dimension_stays_pie_even_if_query_says_daily() -> None:
    result = adapt_semantic_rows(
        [
            {"conversation__channel": "whatsapp", "total_conversations": 12},
            {"conversation__channel": "webchat", "total_conversations": 25},
        ],
        query="daily channel count last 7 days",
    )
    assert result["chartType"] == "pie"


def test_requested_line_overrides_channel_dimension() -> None:
    result = adapt_semantic_rows(
        [
            {"conversation__channel": "whatsapp", "total_conversations": 12},
            {"conversation__channel": "webchat", "total_conversations": 25},
        ],
        query="channel mix last 7 days",
        chart_type="line",
    )
    assert result["chartType"] == "line"


def test_channel_mix_becomes_pie_chart() -> None:
    result = adapt_semantic_rows(
        [
            {"conversation__channel": "whatsapp", "total_conversations": 12},
            {"conversation__channel": "webchat", "total_conversations": 25},
        ],
        query="channel mix whatsapp vs web chat",
    )
    assert result["ok"] is True
    assert result["chartType"] == "pie"
    assert result["data"][0]["label"] == "WhatsApp"
    assert result["data"][1]["label"] == "Web Chat"


def test_daily_trend_becomes_line_chart() -> None:
    result = adapt_semantic_rows(
        [
            {
                "conversation__created_at__day": "2026-08-17T00:00:00",
                "unique_contacts_handled": 8,
            },
            {
                "conversation__created_at__day": "2026-08-18T00:00:00",
                "unique_contacts_handled": 2,
            },
        ],
        query="daily handled trend last 14 days",
    )
    assert result["chartType"] == "line"
    assert result["data"][0]["label"] == "17 Aug"


def test_interpret_semantic_response_answer_falls_back() -> None:
    result = interpret_semantic_response(
        {"answer": "I don't track xyz123"},
        query="xyz123",
    )
    assert result["ok"] is False
    assert result["fallback"] == "sql_analytics"


def test_interpret_semantic_response_error_falls_back() -> None:
    result = interpret_semantic_response(
        {"error": "MF query failed"},
        query="top agents",
    )
    assert result["ok"] is False
    assert result["fallback"] == "sql_analytics"


def test_null_rows_signal_fallback() -> None:
    assert rows_have_values([{"sla_breach_rate": None}]) is False
    result = interpret_semantic_response(
        {"rows": [{"sla_breach_rate": None}]},
        query="SLA breach rate",
    )
    assert result["ok"] is False
    assert result["fallback"] == "sql_analytics"


def test_summarize_raw_and_adapted_payloads() -> None:
    raw = _summarize_raw_response(
        {"rows": [{"total_conversations": 7}, {"total_conversations": 3}]}
    )
    assert raw["response_type"] == "rows"
    assert raw["row_count"] == 2

    adapted = _summarize_adapted_result(
        {
            "ok": True,
            "chartType": "kpi",
            "data": [{"label": "Handled", "value": "7"}],
            "rows": [{"total_conversations": 7}],
        }
    )
    assert adapted["ok"] is True
    assert adapted["chart_type"] == "kpi"
    assert adapted["data_point_count"] == 1


def test_metric_array_scalar_kpis_become_strip() -> None:
    result = interpret_semantic_response(
        [
            {
                "ok": True,
                "metric_id": "total_conversations",
                "rows": [{"total_conversations": 48}],
            },
            {
                "ok": True,
                "metric_id": "missed_contact_rate",
                "rows": [{"missed_contact_rate": 0.58}],
            },
        ],
        query="handled count and missed contact rate last 7 days",
    )
    assert result["ok"] is True
    assert result["chartType"] == "kpi"
    assert len(result["data"]) == 2
    assert result["data"][0]["value"] == "48"
    assert result["data"][1]["value"] == "58%"


def test_metric_array_channel_mix() -> None:
    result = interpret_semantic_response(
        [
            {
                "ok": True,
                "metric_id": "total_conversations",
                "rows": [
                    {"conversation__channel": "whatsapp", "total_conversations": 12},
                    {"conversation__channel": "webchat", "total_conversations": 25},
                ],
            }
        ],
        query="channel mix last 7 days",
    )
    assert result["ok"] is True
    assert result["chartType"] == "pie"


def test_metric_array_partial_failures_still_succeed() -> None:
    result = interpret_semantic_response(
        [
            {
                "ok": False,
                "metric_id": "total_transfers",
                "error": {"code": "NO_DATA", "message": "No data"},
            },
            {
                "ok": True,
                "metric_id": "average_handle_time",
                "rows": [{"average_handle_time": 120.0}],
            },
        ],
        query="transfers and average handle time",
    )
    assert result["ok"] is True
    assert result["chartType"] == "kpi"
    assert result["data"][0]["value"] == "2m"


def test_first_response_zero_includes_grounded_note() -> None:
    result = interpret_semantic_response(
        [
            {
                "ok": True,
                "metric_id": "avg_first_response",
                "rows": [{"avg_first_response": 0}],
            }
        ],
        query="average first response last 30 days",
    )
    assert result["ok"] is True
    card = (result.get("kpis") or result.get("data") or [])[0]
    assert "incorrectly recorded" in str(card.get("note") or "")
    assert "sample count" in card["note"]


def test_metric_array_not_found_falls_back() -> None:
    result = interpret_semantic_response(
        [
            {
                "ok": False,
                "error": {
                    "code": "METRIC_NOT_FOUND",
                    "message": "No predefined metric matches this question",
                },
            }
        ],
        query="performance metrics",
    )
    assert result["ok"] is False
    assert result["fallback"] == "sql_analytics"


def test_metric_array_multiple_charts_returns_plots() -> None:
    result = interpret_semantic_response(
        [
            {
                "ok": True,
                "metric_id": "total_conversations",
                "rows": [
                    {
                        "conversation__created_at__day": "2026-08-17T00:00:00",
                        "total_conversations": 16,
                    }
                ],
            },
            {
                "ok": True,
                "metric_id": "missed_contact_rate",
                "rows": [
                    {
                        "conversation__created_at__day": "2026-08-17T00:00:00",
                        "missed_contact_rate": 0.5,
                    }
                ],
            },
        ],
        query="daily trend and missed rate",
    )
    assert result["ok"] is True
    assert result["chartType"] == "line"
    assert isinstance(result.get("plots"), list)
    assert len(result["plots"]) == 2

