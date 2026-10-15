import pytest

from app.mcp.context import bind_trusted_context, build_trusted_context
from app.mcp.servers.analytics import (
    AnalyticsMCPServer,
    prefer_canonical_title,
    semantic_reports_kpi_id,
)
from app.schemas.copilot import ToolContext
from app.skills.registry import get_skill_registry


def test_analytics_skill_does_not_keyword_route_charts() -> None:
    skill = get_skill_registry().get_skill("performance-analytics")
    assert skill is not None
    combined = " ".join(
        [
            str(skill.get("body") or ""),
            " ".join(str(item) for item in skill.get("rules") or []),
            " ".join(str(item) for item in skill.get("workflow") or []),
        ]
    ).casefold()
    assert "chart_type" in combined
    assert "one line per channel" in combined
    assert "series_column" in combined
    assert "does not pick a chart" in combined


@pytest.mark.asyncio
async def test_semantic_miss_does_not_regex_to_channel_mix() -> None:
    server = AnalyticsMCPServer()
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    trusted = build_trusted_context(
        "analytics",
        context,
        agent_name="analytics",
        surface="dashboard",
    )
    query = (
        "i need lie chat for dail channel count each each channel to each line. "
        "for last 7 days."
    )
    with bind_trusted_context(trusted):
        result = await server._finish_semantic_result(
            {
                "ok": False,
                "source": "semantic_layer",
                "fallback": "sql_analytics",
                "reason": "Semantic layer URL is not configured.",
            },
            query=query,
            surface="dashboard",
            tenant_id="tenant-1",
        )
    assert result["ok"] is False
    assert result.get("chartType") is None
    assert result.get("title") != "Channel Mix"
    assert result.get("type") != "plot"


def test_overview_line_request_does_not_become_channel_mix_pie() -> None:
    server = AnalyticsMCPServer()
    plot = server._plot_from_overview(
        {
            "channels": [
                {"channel": "webchat", "value": 0},
                {"channel": "email", "value": 0},
            ],
            "daily": [
                {"date": "2026-09-02", "handled": 4},
                {"date": "2026-09-03", "handled": 7},
            ],
            "period": {"start": "2026-09-02", "end": "2026-09-08"},
        },
        metric_ids=["channel_mix"],
        chart_type="line",
        focus=None,
        title=None,
        params={"start": "2026-09-02", "end": "2026-09-08"},
    )
    assert plot is not None
    assert plot["chartType"] == "line"
    assert plot["title"] != "Channel Mix"
    assert [row["value"] for row in plot["data"]] == [4, 7]


def test_format_kpi_duration_uses_hours() -> None:
    server = AnalyticsMCPServer()
    assert server._format_kpi("avgHandleSeconds", 7020) == "1h 57m"
    assert server._format_kpi("avgHandleSeconds", 119) == "1m 59s"
    assert server._format_kpi("avgFirstResponseSeconds", 45) == "45s"
    assert server._format_kpi("avgFirstResponseSeconds", None) == "—"
    assert server._format_kpi("resolutionRate", 88.0) == "88%"


def test_answer_rule_does_not_change_chart_values() -> None:
    server = AnalyticsMCPServer()
    plot = server._with_answer_rule(
        {
            "type": "plot",
            "title": "Daily Handled Trend",
            "chartType": "line",
            "data": [{"label": "26 Sept", "value": 5}],
        }
    )
    assert plot["title"] == "Daily Handled Trend"
    assert plot["chartType"] == "line"
    assert plot["data"] == [{"label": "26 Sept", "value": 5}]
    assert "Do not include an img tag" in plot["answerRule"]
    assert "went live" in plot["answerRule"]


def test_resolution_rate_card_carries_resolved_count() -> None:
    server = AnalyticsMCPServer()
    card = server._kpi_card(
        "resolutionRate",
        {"resolutionRate": 92.3, "resolved": 12, "handled": 13},
    )
    assert card["value"] == "92.3%"
    assert card["resolvedCount"] == 12
    assert card["handledCount"] == 13
    assert card["caption"] == "12 of 13 handled"
    assert "uses resolvedCount" in card["note"]


def test_first_response_kpi_card_empty_is_not_zero() -> None:
    server = AnalyticsMCPServer()
    card = server._kpi_card(
        "avgFirstResponseSeconds",
        {"avgFirstResponseSeconds": None, "firstResponseCount": 0},
    )
    assert card["value"] == "—"
    assert card["sampleSize"] == 0
    assert "not proof of missing logging" in card["note"]


def test_first_response_kpi_card_zero_with_sample_explains_rounding() -> None:
    server = AnalyticsMCPServer()
    card = server._kpi_card(
        "avgFirstResponseSeconds",
        {"avgFirstResponseSeconds": 0, "firstResponseCount": 12},
    )
    assert card["value"] == "0s"
    assert card["sampleSize"] == 12
    assert "under 0.5 seconds" in card["note"]
    assert "incorrectly recorded" in card["note"]


def test_format_plot_metric_value_adds_duration_units() -> None:
    server = AnalyticsMCPServer()
    assert server._format_plot_metric_value("Average Handle Time", 7020) == "1h 57m"
    assert server._format_plot_metric_value("avg_handle_minutes", 119) == "1h 59m"
    assert server._format_plot_metric_value("Average Handle Time", "1h 57m") == "1h 57m"
    assert server._format_plot_metric_value("Handled conversations", 412) == 412


def test_overview_plot_sums_ai_and_agent_channels() -> None:
    server = AnalyticsMCPServer()
    plot = server._plot_from_overview(
        {
            "channels": [
                {"channel": "webchat", "value": 8},
                {"channel": "webchat", "value": 2},
                {"channel": "whatsapp", "value": 3},
            ],
            "period": {"start": "2026-08-30T00:00:00Z", "end": "2026-09-05T12:00:00Z"},
        },
        metric_ids=["channel_mix"],
        chart_type="bar",
        focus=None,
        title=None,
        params={"start": "2026-08-30", "end": "2026-09-05"},
    )
    assert plot is not None
    assert plot["chartType"] == "bar"
    by_label = {row["label"]: row["value"] for row in plot["data"]}
    assert by_label["Webchat"] == 10
    assert by_label["WhatsApp"] == 3


def test_overview_plot_filters_webchat_kpi() -> None:
    server = AnalyticsMCPServer()
    plot = server._plot_from_overview(
        {
            "channels": [
                {"channel": "webchat", "value": 8},
                {"channel": "webchat", "value": 2},
                {"channel": "whatsapp", "value": 3},
            ],
            "period": {"start": "2026-09-01", "end": "2026-09-05"},
        },
        metric_ids=["channel_mix"],
        chart_type="kpi",
        focus=["webchat"],
        title=None,
        params={"start": "2026-09-01", "end": "2026-09-05"},
    )
    assert plot is not None
    assert plot["chartType"] == "kpi"
    assert plot["kpis"][0]["value"] == 10


def test_overview_daily_aht_keeps_numeric_seconds() -> None:
    server = AnalyticsMCPServer()
    plot = server._plot_from_overview(
        {
            "daily": [
                {"date": "2026-08-20", "handled": 43, "avgHandleSeconds": 7020},
                {"date": "2026-08-21", "handled": 0, "avgHandleSeconds": None},
            ],
            "period": {"start": "2026-08-20", "end": "2026-08-21"},
        },
        metric_ids=["avg_handle_time"],
        chart_type="line",
        focus=["handle_time"],
        title=None,
        params={"start": "2026-08-20", "end": "2026-08-21"},
    )
    assert plot is not None
    assert plot["chartType"] == "line"
    assert plot["data"][0]["value"] == 7020
    assert plot["data"][1]["value"] == 0


def test_overview_plot_two_channel_kpis_and_daily_avg() -> None:
    server = AnalyticsMCPServer()
    channels = server._plot_from_overview(
        {
            "channels": [
                {"channel": "instagram", "value": 2},
                {"channel": "email", "value": 7},
            ],
            "period": {"start": "2026-08-07", "end": "2026-09-05"},
        },
        metric_ids=["channel_mix"],
        chart_type="kpi",
        focus=["instagram", "email"],
        title=None,
        params={"start": "2026-08-07", "end": "2026-09-05"},
    )
    assert channels is not None
    assert [card["label"] for card in channels["kpis"]] == [
        "Instagram conversations",
        "Email conversations",
    ]
    assert [card["value"] for card in channels["kpis"]] == [2, 7]

    whatsapp = server._plot_from_overview(
        {
            "channels": [{"channel": "whatsapp", "value": 13}],
            "period": {"start": "2026-08-24", "end": "2026-08-30"},
        },
        metric_ids=["channel_mix"],
        chart_type="kpi",
        focus=["whatsapp", "daily_avg"],
        title=None,
        params={"start": "2026-08-24", "end": "2026-08-30"},
    )
    assert whatsapp is not None
    assert whatsapp["kpis"][0]["value"] == 13
    assert whatsapp["kpis"][1]["label"] == "Daily average"
    assert whatsapp["kpis"][1]["value"] == "1.86"

    exclusive_end = server._plot_from_overview(
        {
            "channels": [{"channel": "whatsapp", "value": 13}],
            "daily": [{"date": f"2026-08-{day:02d}", "handled": 0} for day in range(24, 31)],
            "period": {
                "start": "2026-08-24T00:00:00.000Z",
                "end": "2026-08-31T00:00:00.000Z",
            },
        },
        metric_ids=["channel_mix"],
        chart_type="kpi",
        focus=["whatsapp", "daily_avg"],
        title=None,
        params={"start": "2026-08-24", "end": "2026-08-30"},
    )
    assert exclusive_end is not None
    assert exclusive_end["kpis"][1]["value"] == "1.86"


def test_append_derived_cards_uses_days_with_volume() -> None:
    server = AnalyticsMCPServer()
    cards = server._append_derived_cards(
        [],
        {
            "kpis": {"handled": 20},
            "daily": [
                {"date": "2026-08-20", "handled": 12},
                {"date": "2026-08-21", "handled": 8},
                {"date": "2026-08-22", "handled": 0},
            ],
        },
        {"start": "2026-08-07", "end": "2026-09-05"},
        ["daily_avg", "peak_day"],
    )
    assert cards[0] == {"label": "Daily avg handled", "value": 10}
    assert cards[1]["value"] == 12
    assert "20 Aug" in cards[1]["label"]


@pytest.mark.asyncio
async def test_sql_line_plot_keeps_channel_as_series() -> None:
    server = AnalyticsMCPServer()
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    context.executed_tool_results["__agent_name_map__"] = {}
    points = await server._build_plot_points(
        [
            {"day": "2026-09-02", "channel": "webchat", "count": 3},
            {"day": "2026-09-02", "channel": "email", "count": 1},
            {"day": "2026-09-03", "channel": "webchat", "count": 2},
        ],
        {
            "chart_type": "line",
            "label_column": "day",
            "value_column": "count",
            "title": "Daily by channel",
        },
        context,
    )
    assert [point["label"] for point in points] == [
        "2026-09-02",
        "2026-09-02",
        "2026-09-03",
    ]
    assert [point["series"] for point in points] == ["Webchat", "Email", "Webchat"]
    assert [point["value"] for point in points] == [3, 1, 2]


@pytest.mark.asyncio
async def test_sql_line_plot_infers_day_channel_columns() -> None:
    server = AnalyticsMCPServer()
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    context.executed_tool_results["__agent_name_map__"] = {}
    points = await server._build_plot_points(
        [
            {"channel": "webchat", "day": "2026-09-02", "count": 4},
            {"channel": "email", "day": "2026-09-02", "count": 1},
        ],
        {"chart_type": "line", "title": "Daily by channel"},
        context,
    )
    assert [point["label"] for point in points] == ["2026-09-02", "2026-09-02"]
    assert [point["series"] for point in points] == ["Webchat", "Email"]


@pytest.mark.asyncio
async def test_generate_plot_stamps_series_from_channel() -> None:
    server = AnalyticsMCPServer()
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    context.recent_tool_data.append({"day": "2026-09-02", "channel": "webchat", "count": 3})
    trusted = build_trusted_context(
        "analytics",
        context,
        agent_name="analytics",
        surface="dashboard",
    )
    with bind_trusted_context(trusted):
        result = await server.generate_plot(
            title="Daily chat volume by channel",
            chart_type="line",
            data=[
                {"day": "2026-09-02", "channel": "webchat", "count": 3},
                {"day": "2026-09-02", "channel": "email", "count": 1},
            ],
        )
    assert result["chartType"] == "line"
    assert [point["series"] for point in result["data"]] == ["Webchat", "Email"]
    assert [point["label"] for point in result["data"]] == ["2026-09-02", "2026-09-02"]


def test_disposition_cards_filter_requested_labels() -> None:
    server = AnalyticsMCPServer()
    cards = server._disposition_cards(
        {
            "dispositions": [
                {"label": "Issue resolved", "value": 21},
                {"label": "Follow-up", "value": 9},
                {"label": "Customer disconnected", "value": 3},
            ]
        },
        ["issue resolved", "follow-up"],
    )
    assert cards == [
        {"label": "Issue resolved", "value": 21},
        {"label": "Follow-up", "value": 9},
    ]


def test_semantic_reports_kpi_id_maps_response_sla_card() -> None:
    assert (
        semantic_reports_kpi_id(
            {
                "ok": True,
                "chartType": "kpi",
                "metric_id": "response_sla",
                "kpis": [{"label": "Response SLA", "value": "66.7%"}],
            }
        )
        == "response_sla_60s"
    )


def test_semantic_reports_kpi_id_skips_line_charts_and_custom_metrics() -> None:
    assert (
        semantic_reports_kpi_id(
            {
                "ok": True,
                "chartType": "line",
                "metric_id": "response_sla",
            },
            chart_type="line",
        )
        is None
    )
    assert (
        semantic_reports_kpi_id(
            {
                "ok": True,
                "chartType": "kpi",
                "metric_id": "missed_contact_rate",
                "kpis": [{"label": "Missed contact rate", "value": "12%"}],
            }
        )
        is None
    )


def test_prefer_canonical_title_folds_channel_ix() -> None:
    assert prefer_canonical_title("AI channel IX", "AI Channel Mix") == "AI Channel Mix"
    assert prefer_canonical_title("Q3 volume by queue", "Channel Mix") == "Q3 volume by queue"


def test_sla_composition_names_who_missed() -> None:
    server = AnalyticsMCPServer()
    text = server._sla_composition_text(
        {
            "kpis": {"firstResponseCount": 19, "withinSlaCount": 16, "slaRate": 84.2},
            "slaBreakdown": [
                {
                    "channel": "webchat",
                    "handler": "ai",
                    "missedSlaCount": 2,
                },
                {
                    "channel": "whatsapp",
                    "handler": "agent",
                    "missedSlaCount": 1,
                },
            ],
        }
    )
    assert text is not None
    assert "16 of 19" in text
    assert "Webchat · AI: 2" in text
    assert "WhatsApp · Agent: 1" in text


def test_ai_channel_ix_title_becomes_canonical_mix() -> None:
    server = AnalyticsMCPServer()
    plot = server._plot_from_overview(
        {
            "channels": [
                {"channel": "webchat", "handler": "ai", "value": 107},
                {"channel": "whatsapp", "handler": "ai", "value": 6},
            ],
            "period": {"start": "2026-08-11", "end": "2026-09-09"},
        },
        metric_ids=["channel_mix"],
        chart_type="pie",
        focus=["ai"],
        title="AI channel IX",
        params={"start": "2026-08-11", "end": "2026-09-09"},
    )
    assert plot is not None
    assert plot["title"] == "AI Channel Mix"
    assert plot["canonicalNames"] == ["AI channel mix"]


@pytest.mark.asyncio
async def test_semantic_sla_kpi_is_replaced_with_reports_overview() -> None:
    server = AnalyticsMCPServer()

    async def fake_request(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {
            "kpis": {
                "handled": 129,
                "resolutionRate": 17.1,
                "avgFirstResponseSeconds": 0,
                "avgHandleSeconds": 790,
                "slaRate": 84.2,
                "transferred": 1,
                "firstResponseCount": 19,
                "withinSlaCount": 16,
            },
            "slaBreakdown": [
                {
                    "channel": "webchat",
                    "handler": "ai",
                    "firstResponseCount": 15,
                    "withinSlaCount": 13,
                    "missedSlaCount": 2,
                    "slaRate": 86.7,
                },
                {
                    "channel": "whatsapp",
                    "handler": "agent",
                    "firstResponseCount": 4,
                    "withinSlaCount": 3,
                    "missedSlaCount": 1,
                    "slaRate": 75.0,
                },
            ],
            "period": {"start": "2026-08-10", "end": "2026-09-08"},
            "range": "30d",
        }

    server.http.request = fake_request  # type: ignore[method-assign]
    context = ToolContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        period_start="2026-08-10",
        period_end="2026-09-08",
        period_range="30d",
    )
    trusted = build_trusted_context(
        "analytics",
        context,
        agent_name="analytics",
        surface="dashboard",
    )
    semantic = {
        "ok": True,
        "source": "semantic_layer",
        "type": "plot",
        "title": "Response SLA",
        "chartType": "kpi",
        "metric_id": "response_sla",
        "data": [{"label": "Response SLA", "value": "66.7%"}],
        "kpis": [{"label": "Response SLA", "value": "66.7%"}],
    }
    with bind_trusted_context(trusted):
        grounded = await server._ground_semantic_to_reports(semantic, chart_type="kpi")
    assert grounded is not None
    assert grounded["title"] == "First-Reply SLA"
    assert grounded["kpis"][0]["value"] == "84.2%"
    assert grounded["replacedSemantic"] is True
    assert "16 of 19" in str(grounded.get("composition"))
    assert "Webchat · AI: 2" in str(grounded.get("composition"))
    assert "66.7" not in str(grounded.get("kpis"))


@pytest.mark.asyncio
async def test_semantic_grounding_leaves_custom_metrics_alone() -> None:
    server = AnalyticsMCPServer()
    semantic = {
        "ok": True,
        "source": "semantic_layer",
        "chartType": "kpi",
        "metric_id": "missed_contact_rate",
        "kpis": [{"label": "Missed contact rate", "value": "12%"}],
    }
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    trusted = build_trusted_context(
        "analytics",
        context,
        agent_name="analytics",
        surface="dashboard",
    )
    with bind_trusted_context(trusted):
        grounded = await server._ground_semantic_to_reports(semantic, chart_type="kpi")
    assert grounded is None


def _analytics_snapshot_payload() -> dict:
    return {
        "period": {"start": "2026-09-09", "end": "2026-09-16"},
        "diagnostic": {
            "selectedIncidentId": "inc-1",
            "healthy": False,
            "incidents": [
                {
                    "id": "inc-1",
                    "headline": "Weekly missed contact spike on WhatsApp queue 1003",
                    "summary": "Missed-contact rate increased to 166.7% with 5 unique missed conversations.",
                    "factors": [
                        {"label": "No agents available", "value": 54.5},
                        {"label": "Offer timeout", "value": 45.5},
                    ],
                    "currentFacts": {
                        "uniqueMissedConversations": 5,
                        "agentDemandConversations": 3,
                        "missedContactRate": 166.7,
                        "missedEventCount": 11,
                    },
                }
            ],
            "weeklyComparison": {
                "thisWeek": {
                    "missedContactRate": 166.7,
                    "uniqueMissedConversations": 5,
                    "agentDemandConversations": 3,
                },
                "lastWeek": {
                    "missedContactRate": 100.0,
                    "uniqueMissedConversations": 3,
                    "agentDemandConversations": 3,
                },
            },
        },
        "predictive": {
            "summary": {"peakHour": "10:00-11:00", "expectedContacts": 62},
            "hourlyVolume": {
                "peakHour": "10:00-11:00",
                "source": "forecast_expected",
                "windowDays": 7,
                "points": [
                    {"label": "09:00-10:00", "actual": 4, "forecast": 5},
                    {"label": "10:00-11:00", "actual": 9, "forecast": 12},
                    {"label": "11:00-12:00", "actual": 6, "forecast": 7},
                ],
                "supportingHours": [
                    {"label": "10:00-11:00", "actual": 9, "forecast": 12},
                ],
            },
        },
        "prescriptive": {"recommendations": []},
        "meta": {"dataStatus": "partial"},
    }


class _FakeAnalyticsHTTP:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.paths: list[str] = []

    async def request(self, method: str, path: str, *_args: object, **_kwargs: object) -> dict:
        del method
        self.paths.append(path)
        return self.payload


@pytest.mark.asyncio
async def test_dashboard_snapshot_keeps_rate_over_100_as_valid_metric() -> None:
    server = AnalyticsMCPServer()
    server.http = _FakeAnalyticsHTTP(_analytics_snapshot_payload())  # type: ignore[method-assign]
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    trusted = build_trusted_context(
        "analytics",
        context,
        agent_name="analytics",
        surface="analytics",
    )
    with bind_trusted_context(trusted):
        result = await server.get_dashboard_analytics_snapshot()

    assert result["ok"] is True
    assert result["metricContract"]["missedContactRate"]["canExceed100"] is True
    assert result["kpis"][0]["value"] == "166.7%"
    assert "reporting" not in str(result["kpis"][0].get("note") or "").casefold()
    assert result["incidentCatalog"]["live"][0]["code"] == "missed_contact_spike"
    assert server.http.paths == ["/api/v1/dashboard/analytics"]  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_hourly_volume_tool_returns_peak_hour_plot() -> None:
    server = AnalyticsMCPServer()
    server.http = _FakeAnalyticsHTTP(_analytics_snapshot_payload())  # type: ignore[method-assign]
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    trusted = build_trusted_context(
        "analytics",
        context,
        agent_name="analytics",
        surface="analytics",
    )
    with bind_trusted_context(trusted):
        result = await server.get_analytics_hourly_volume()

    assert result["ok"] is True
    assert result["type"] == "plot"
    assert result["chartType"] == "line"
    assert result["xAxisLabel"] == "Hour of day"
    assert result["yAxisLabel"] == "Inbound conversations"
    assert result["peakHour"] == "10:00-11:00"
    assert result["peakHourEvidence"]["peakHour"] == "10:00-11:00"
    peak = next(point for point in result["data"] if point["label"] == "10:00-11:00")
    assert peak["actual"] == 9
    assert peak["forecast"] == 12
