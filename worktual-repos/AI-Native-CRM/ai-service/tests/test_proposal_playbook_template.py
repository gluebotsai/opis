from app.agents.proposal_corpus_design_geometry_agent import (
    css_looks_complete,
    extract_design_payload,
    html_looks_like_skeleton,
    _css_from_layout,
    _merge_skeleton_html,
    _reconcile_layout_with_hint,
    _sanitize_template_html,
)
from app.agents.proposal_corpus_features_agent import (
    _heuristic_schema,
    _normalize_tables,
)
from app.agents.proposal_corpus_ingest_agent import (
    _MAX_PAGE_HTML,
    _geometry_hint,
)


def test_css_looks_complete_requires_size_and_spacing():
    complete = (
        ".proposal-blueprint{font-family:Arial,Helvetica,sans-serif;font-size:12px;"
        "padding:16mm;margin:0 auto;line-height:1.45;color:#000}"
        ".proposal-blueprint .bp-cover-title{font-size:24px;font-weight:700}"
        ".proposal-blueprint .bp-h2{font-size:14px;font-weight:700}"
        ".proposal-blueprint .bp-table th{padding:8px;background:#073763}"
    )
    assert css_looks_complete(complete)
    assert not css_looks_complete(
        ".proposal-blueprint{font-family:Arial;font-size:12px;padding:16mm;color:#111}"
    )
    assert not css_looks_complete("font-family:Arial;color:#1f3864")
    assert not css_looks_complete("")


def test_html_skeleton_rejects_scripts_and_requires_slots():
    assert html_looks_like_skeleton(
        '<div class="bp-playbook-root"><header class="bp-playbook-cover">{{vendorName}}</header>'
        '<section data-slot="scope"></section></div>'
    )
    assert not html_looks_like_skeleton("<script>alert(1)</script>")
    assert not html_looks_like_skeleton("<p>Hi</p>")
    assert not html_looks_like_skeleton(
        '<header class="bp-playbook-cover">{{vendorName}}</header>'
    )


def test_sanitize_template_html_strips_price_cells():
    html = '<table><tr><td>$1,200</td><td>ok</td></tr></table>'
    out = _sanitize_template_html(html)
    assert "$1,200" not in out
    assert "<td></td>" in out


def test_merge_skeleton_html_appends_new_slots():
    base = (
        '<div class="bp-playbook-root">'
        '<header class="bp-playbook-cover">{{vendorName}}</header>'
        '<section data-slot="scope"></section></div>'
    )
    extra = '<section data-slot="commercials"><table data-slot-table="commercials"><tbody></tbody></table></section>'
    merged = _merge_skeleton_html(base, extra)
    assert 'data-slot="scope"' in merged
    assert 'data-slot="commercials"' in merged


def test_page_html_budget_covers_two_pages():
    assert _MAX_PAGE_HTML >= 20_000


def test_geometry_hint_extracts_fonts_colors_cover_and_tables():
    shapes = "".join(
        f'<div class="pdf-shape pdf-rect" style="width:30%;background-color:#073763;'
        f'border:1px solid #808080;"></div>'
        for _ in range(14)
    )
    page = (
        '<span class="pdf-text" style="left:8%;font-size:2.4cqw;color:#073763;'
        'font-weight:bold;font-family:Arial">ZIFO</span>'
        '<span class="pdf-text" style="left:8%;font-size:1.8cqw;color:#073763;'
        'font-weight:bold">Commercial Proposal</span>'
        '<span class="pdf-text" style="left:8%;font-size:1.1cqw;color:#000000;'
        'font-weight:normal">Prepared for</span>'
        + shapes
    )
    hint = _geometry_hint([{"id": "page-1", "pageHtml": page}])
    assert hint is not None
    assert hint["observedHeadingColor"] == "#073763"
    assert hint["cover"]["textOrder"][0] == "ZIFO"
    assert "Commercial Proposal" in hint["cover"]["textOrder"]
    assert hint["fonts"]["weights"]
    assert hint["tables"]["detected"] is True
    assert hint["tables"]["headerFill"] == "#073763"
    assert hint["margins"]["leftPct"] == 8.0


def test_extract_design_payload_recovers_truncated_css():
    raw = (
        '{"layoutStyle":{"fontFamily":"Calibri","headingColor":"#0f2942",'
        '"coverStyle":"left","source":"gemini_design"},'
        '"css":".proposal-blueprint{font-size:11px;padding:16mm'
    )
    payload = extract_design_payload(raw)
    layout = payload["layoutStyle"]
    assert layout["headingColor"] == "#0f2942"
    assert layout["coverStyle"] == "left"


def test_reconcile_rewrites_fallback_source():
    out = _reconcile_layout_with_hint(
        {
            "fontFamily": "Calibri",
            "headingColor": "#0f2942",
            "coverStyle": "left",
            "source": "geometry_hint_fallback",
        },
        {"observedHeadingColor": "#1f3864"},
    )
    assert "geometry_hint_fallback" not in str(out["source"])
    compact = _css_from_layout(out)
    assert "font-size" in compact
    assert not css_looks_complete(compact)


def test_heuristic_schema_keeps_table_columns():
    schema = _heuristic_schema(
        "proposal",
        [
            {
                "key": "commercials",
                "tableSpec": {"shape": "line_items", "columns": ["Item", "MRC", "OTC"]},
            }
        ],
    )
    assert schema["tables"][0]["columns"] == ["Item", "MRC", "OTC"]


def test_normalize_tables_drops_empty_and_slugs_keys():
    tables = _normalize_tables(
        [
            {
                "key": "Requested vs Recommended",
                "columns": ["Capability", "Requested", "Recommended"],
                "rowSlots": [
                    {"id": "omnichannel", "label": "Omnichannel routing", "fillFrom": "requirement"}
                ],
            },
            {"key": "", "columns": []},
        ]
    )
    assert tables[0]["key"] == "requested_vs_recommended"
    assert tables[0]["rowSlots"][0]["id"] == "omnichannel"
    assert len(tables) == 1
