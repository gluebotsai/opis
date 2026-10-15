from app.agents.reports_analytics_adapter import (
    build_structured_analytics,
    peel_card_choice,
)


def test_multi_kpi_won_and_lost_visual():
    plan = {
        "kind": "plan",
        "tasks": [
            {"id": "t1", "kpi": "won_revenue", "answer_type": "scalar"},
            {"id": "t2", "kpi": "lost_revenue", "answer_type": "scalar"},
        ],
    }
    kpi_slices = [
        {"id": "r1", "kpi_id": "won_revenue", "rows": [{"won_revenue": 0}]},
        {"id": "r2", "kpi_id": "lost_revenue", "rows": [{"lost_revenue": 1255}]},
    ]
    out = build_structured_analytics(
        plan=plan,
        rows=[{"lost_revenue": 1255}],
        assistant_text="Won 0; lost 1255.",
        organization_id="1003",
        business_type="b2b",
        had_kg=False,
        kpi_slices=kpi_slices,
        card_choice={"kind": "kpi", "result": "r2"},
    )
    visual = out["visual"]
    assert visual["kind"] == "kpi"
    assert len(visual["kpis"]) == 1
    assert visual["kpis"][0]["label"] == "Lost Revenue"
    assert "1255" in visual["kpis"][0]["value"].replace(",", "")
    assert "visuals" not in out


def test_two_breakdowns_become_two_cards():
    plan = {
        "kind": "plan",
        "tasks": [
            {
                "id": "t1",
                "kpi": "won_deal_count",
                "dimension": "owner",
                "answer_type": "breakdown",
            },
            {
                "id": "t2",
                "kpi": "lost_deal_count",
                "dimension": "owner",
                "answer_type": "breakdown",
            },
        ],
    }
    won_rows = [{"owner": "Raghuram M", "won_deal_count": 2}]
    lost_rows = [
        {"owner": "DivyaPrasath RS", "lost_deal_count": 1},
        {"owner": "Manoj M", "lost_deal_count": 1},
        {"owner": "Raghuram M", "lost_deal_count": 1},
    ]
    out = build_structured_analytics(
        plan=plan,
        rows=lost_rows,
        assistant_text="Raghuram M has the most won deals with 2.",
        organization_id="1003",
        business_type="b2b",
        had_kg=False,
        breakdowns=[
            {
                "id": "r1",
                "kpi_id": "won_deal_count",
                "rows": won_rows,
                "goal": "won deals by owner",
                "time": "all time",
                "dimension": "owner",
            },
            {
                "id": "r2",
                "kpi_id": "lost_deal_count",
                "rows": lost_rows,
                "goal": "lost deals by owner",
                "time": "all time",
                "dimension": "owner",
            },
        ],
        card_choice={"kind": "bar", "result": "r1"},
    )
    assert "visuals" not in out
    visual = out["visual"]
    assert visual["kind"] == "bar"
    assert visual["title"] == "Won Deal Count"
    assert visual["chart"]["data"] == [
        {"owner": "Raghuram M", "won_deal_count": 2}
    ]
    assert all(row.get("owner") != "Manoj M" for row in visual["chart"]["data"])


def test_status_mix_drops_rows_that_have_no_count():
    plan = {
        "kind": "plan",
        "tasks": [
            {"id": "t1", "kpi": "lead_status_mix", "answer_type": "breakdown"},
        ],
    }
    mix = [
        {"lead_status": "new", "contact_count": 991},
        {"lead_status": "contacted", "contact_count": 96},
        {"lead_status": "40", "contact_count": 1},
    ]
    leads = [
        {
            "lead_status": "active",
            "company": "HCL",
            "owner": "Yaswanth MG",
            "last_touch_date": "2026-09-01",
        }
    ]
    out = build_structured_analytics(
        plan=plan,
        rows=mix,
        assistant_text="Most leads are new.",
        organization_id="1003",
        business_type="b2b",
        had_kg=True,
        breakdowns=[
            {
                "id": "r1",
                "kpi_id": "lead_status_mix",
                "rows": mix + leads,
                "goal": "lead status mix",
                "answer_type": "breakdown",
            },
            {
                "id": "r2",
                "kpi_id": "",
                "rows": leads,
                "goal": "Leads to follow up",
                "answer_type": "list",
            },
        ],
        card_choice={"kind": "bar", "result": "r1"},
    )
    assert "visuals" not in out
    visual = out["visual"]
    assert visual["kind"] == "bar"
    labels = [row["lead_status"] for row in visual["chart"]["data"]]
    assert labels == ["new", "contacted", "40"]
    assert "active" not in labels


def test_single_kpi_from_slices_shows_value_in_card():
    plan = {"kind": "plan", "tasks": [{"id": "t1", "kpi": "lead_count", "time": "yesterday"}]}
    out = build_structured_analytics(
        plan=plan,
        rows=[],
        assistant_text="1 lead was created yesterday.",
        organization_id="1003",
        business_type="b2b",
        had_kg=False,
        kpi_slices=[
            {
                "id": "r1",
                "kpi_id": "lead_count",
                "rows": [{"lead_count": 1}],
                "time": "yesterday",
            },
        ],
        card_choice={"kind": "kpi", "result": "r1"},
    )
    visual = out["visual"]
    assert visual["kind"] == "kpi"
    assert len(visual["kpis"]) == 1
    assert visual["kpis"][0]["value"] == "1"
    assert "yesterday" in (visual.get("description") or "").lower()


def test_none_choice_on_wide_rows_sends_no_card():
    wide = [
        {
            "name": "Asha",
            "status": "new",
            "owner": "Raghuram M",
            "last_touch": "2026-09-01",
        },
        {
            "name": "Kavin",
            "status": "contacted",
            "owner": "Hansa Solanki",
            "last_touch": "2026-08-12",
        },
    ]
    plan = {"kind": "plan", "tasks": [{"id": "t1", "answer_type": "list"}]}
    out = build_structured_analytics(
        plan=plan,
        rows=wide,
        assistant_text="22 leads are waiting.",
        organization_id="1003",
        business_type="b2b",
        had_kg=False,
        breakdowns=[{"id": "r1", "rows": wide, "goal": "Leads to follow up"}],
        card_choice={"kind": "none"},
    )
    assert "visual" not in out
    assert "chart" not in out
    assert out["findings"]["rows"] == []
    assert out["findings"]["summary"] == "22 leads are waiting."


def test_missing_choice_sends_no_card():
    out = build_structured_analytics(
        plan={"kind": "plan", "tasks": [{"id": "t1"}]},
        rows=[{"owner": "Raghuram M", "amount": 10, "stage": "open"}],
        assistant_text="One open deal.",
        organization_id="1003",
        business_type="b2b",
        had_kg=False,
        breakdowns=[
            {
                "id": "r1",
                "rows": [{"owner": "Raghuram M", "amount": 10, "stage": "open"}],
            }
        ],
    )
    assert "visual" not in out
    assert "chart" not in out


def test_bar_choice_without_a_number_sends_no_card():
    leads = [{"lead_status": "active", "company": "HCL", "owner": "Yaswanth MG"}]
    out = build_structured_analytics(
        plan={"kind": "plan", "tasks": [{"id": "t1"}]},
        rows=leads,
        assistant_text="One lead.",
        organization_id="1003",
        business_type="b2b",
        had_kg=False,
        breakdowns=[{"id": "r1", "rows": leads, "goal": "Leads"}],
        card_choice={"kind": "bar", "result": "r1"},
    )
    assert "visual" not in out


def test_table_choice_copies_only_the_named_result():
    leads = [{"name": "Asha", "status": "new", "owner": "Raghuram M"}]
    mix = [{"lead_status": "new", "contact_count": 991}]
    out = build_structured_analytics(
        plan={"kind": "plan", "tasks": [{"id": "t1"}, {"id": "t2"}]},
        rows=mix,
        assistant_text="Asha is still new.",
        organization_id="1003",
        business_type="b2b",
        had_kg=True,
        breakdowns=[
            {"id": "r1", "kpi_id": "lead_status_mix", "rows": mix},
            {"id": "r2", "rows": leads, "goal": "Leads to follow up"},
        ],
        card_choice={"kind": "table", "result": "r2"},
    )
    assert "visuals" not in out
    visual = out["visual"]
    assert visual["kind"] == "table"
    assert visual["title"] == "Leads to follow up"
    assert visual["table"]["rows"] == leads


def test_peel_card_choice_keeps_html():
    html = "<p><strong>Win rate</strong></p>\n<p>The win rate is 66.67.</p>"
    text, choice = peel_card_choice(html + "\ncard: kpi r1")
    assert text == html
    assert choice == {"kind": "kpi", "result": "r1"}
    bare, missing = peel_card_choice(html)
    assert bare == html
    assert missing is None
    wrapped, none_choice = peel_card_choice(html + "\n<p>card: none</p>")
    assert wrapped == html
    assert none_choice == {"kind": "none"}


def test_peel_card_choice_strips_wording_variants():
    html = "<p><strong>Leads</strong></p>\n<p>There are 4 leads.</p>"
    for suffix in (
        "card : none",
        'card: "none"',
        "card: <em>none</em>",
        "card:&nbsp;none",
        "<p><strong>card: none</strong></p>",
    ):
        text, choice = peel_card_choice(html + "\n" + suffix)
        assert "card" not in text.lower()
        assert "There are 4 leads." in text
        assert choice == {"kind": "none"}
    text, choice = peel_card_choice(html + "\ncard : kpi r2")
    assert choice == {"kind": "kpi", "result": "r2"}
    assert "There are 4 leads." in text


def test_peel_card_choice_strips_embedded_card_and_plan_json():
    html = "<p><strong>Leads</strong></p>\n<p>There are 4 leads.</p>"
    raw = html + '\n<p>card: None</p>\n{"kind": "plan", "kpi": null, "tasks": []}'
    text, choice = peel_card_choice(raw)
    assert "card:" not in text.lower()
    assert "tasks" not in text
    assert "There are 4 leads." in text
    assert choice == {"kind": "none"}
