import pytest
from app.agents.proposal_layout import (
    apply_catalog_prices,
    apply_frozen_cover,
    clamp_requested_solutions,
    fill_commercial_table_prices,
    merge_layout,
    normalize_cover,
    scrub_invented_prices,
    seed_price_lines_from_catalog,
)
from app.agents.proposal_pdf_parse import (
    _cover_chrome_align,
    apply_chrome_to_tokens,
    compile_theme_css,
    default_theme_tokens,
    measure_layout,
)
from app.agents.proposal_playbook_freeze_agent import freeze_playbook
from app.agents.proposal_render_html import render_proposal_html
from app.services.proposal_gemini import (
    thinking_config_kwargs,
)


def test_merge_layout_parser_wins_on_nonzero():
    merged = merge_layout(
        {"title_font_pt": 18, "brand_align": "center", "space_after_heading_pt": 40},
        {"title_font_pt": 11, "brand_align": "left", "space_after_heading_pt": 8},
    )
    assert merged["title_font_pt"] == 18
    assert merged["brand_align"] == "center"
    assert merged["space_after_heading_pt"] == 16


def test_normalize_cover_swaps_brand_title():
    cover = normalize_cover(
        {"brand": "ZIFO", "title": "ZIFO", "subtitle": "Commercial Proposal"},
        {"tags_layout": "vertical"},
    )
    assert cover["title"] == "Commercial Proposal"
    assert cover["tag_layout"] == "vertical"


def test_apply_catalog_prices_omits_unknown():
    lines = apply_catalog_prices(
        [
            {"sku_name": "CRM", "qty": "2", "unit_price": "999999"},
            {"sku_name": "Invented Cloud", "qty": "1", "unit_price": "50"},
        ],
        [{"id": "p1", "name": "CRM", "price": "10", "currency": "USD"}],
    )
    assert lines[0]["unit_price"] == "USD 10"
    assert lines[1]["unit_price"] == ""
    assert lines[1]["recommended_amount"] == ""


def test_scrub_invented_prices_drops_unknown_money():
    tables = scrub_invented_prices(
        [
            {
                "id": "t1",
                "headers": ["Item", "Price"],
                "rows": [["CRM", "USD 10"], ["Ghost", "₹99,000"]],
            }
        ],
        [{"name": "CRM", "price": "10", "currency": "USD"}],
    )
    assert "10" in tables[0]["rows"][0][1]
    assert "99" not in tables[0]["rows"][1][1]


def test_seed_price_lines_from_catalog_fills_missing():
    lines = seed_price_lines_from_catalog(
        [],
        [
            {"id": "p1", "name": "CRM", "price": "10", "currency": "USD"},
            {"id": "p2", "name": "CCaaS", "price": "20", "currency": "USD"},
        ],
        {"requested_solutions": [{"name": "CCaaS", "quantities": {"seats": 5}}]},
        quote_lines=[{"name": "CRM", "quantity": 2}],
    )
    by_name = {row["sku_name"]: row for row in lines}
    assert by_name["CRM"]["unit_price"] == "USD 10"
    assert by_name["CRM"]["qty"] == "2"
    assert by_name["CCaaS"]["unit_price"] == "USD 20"
    assert by_name["CCaaS"]["qty"] == "5"


def test_fill_commercial_table_prices_skips_comparison():
    tables = fill_commercial_table_prices(
        [
            {
                "id": "cmp",
                "emphasize_last_col": True,
                "headers": ["Feature", "Price"],
                "rows": [["CRM", ""]],
            },
            {
                "id": "inv",
                "headers": ["Item", "Unit Price"],
                "rows": [["CRM", ""]],
            },
        ],
        [{"name": "CRM", "price": "10", "currency": "USD"}],
    )
    assert tables[0]["rows"][0][1] == ""
    assert tables[1]["rows"][0][1] == "USD 10"


def test_lola_alias_fills_ccaas_catalog_price():
    catalog = [
        {
            "id": "ccaas1",
            "name": "Proactive Contact Centre",
            "price": "42",
            "currency": "USD",
            "category": "ccaas",
        },
        {
            "id": "crm1",
            "name": "Intelligent CRM",
            "price": "10",
            "currency": "USD",
            "category": "crm",
        },
    ]
    lines = apply_catalog_prices(
        [{"sku_name": "Lola Voicebot", "qty": "1", "unit_price": ""}],
        catalog,
    )
    assert lines[0]["unit_price"] == "USD 42"
    tables = fill_commercial_table_prices(
        [
            {
                "id": "inv",
                "headers": ["Item", "Unit Price"],
                "rows": [["AI Chatbot", ""]],
            }
        ],
        catalog,
    )
    assert tables[0]["rows"][0][1] == "USD 42"
    seeded = seed_price_lines_from_catalog(
        [],
        catalog[:1],
        quote_lines=[{"name": "Lola", "productId": "ccaas1", "quantity": 3}],
    )
    assert seeded[0]["qty"] == "3"
    assert seeded[0]["unit_price"] == "USD 42"


def test_clamp_requested_solutions_keeps_catalog_only():
    brd = clamp_requested_solutions(
        {
            "requested_solutions": [
                {"name": "CRM", "details": "pipeline"},
                {"name": "Invented Cloud", "details": "nope"},
            ]
        },
        [{"id": "p1", "name": "Intelligent CRM", "price": "10"}],
        ["Intelligent CRM"],
    )
    names = [s["name"] for s in brd["requested_solutions"]]
    assert names == ["Intelligent CRM"]


def test_is_gemini_unavailable_on_high_demand():
    from app.services.proposal_gemini import is_gemini_unavailable

    assert is_gemini_unavailable(
        "503 UNAVAILABLE. This model is currently experiencing high demand."
    )
    assert is_gemini_unavailable("429 RESOURCE_EXHAUSTED")
    assert not is_gemini_unavailable("Unterminated string starting at: line 4 (char 503)")


def test_thinking_config_requests_high():
    kwargs = thinking_config_kwargs("high")
    cfg = kwargs.get("thinking_config")
    assert cfg is not None
    dumped = (
        cfg.model_dump()
        if hasattr(cfg, "model_dump")
        else (dict(cfg) if isinstance(cfg, dict) else {})
    )
    level = dumped.get("thinking_level")
    assert str(getattr(level, "value", level) or "").lower() == "high" or dumped.get(
        "thinking_budget"
    ) in (
        -1,
        32_768,
    )
    thoughts = dumped.get("include_thoughts")
    if thoughts is not None:
        assert thoughts is False


def test_generate_json_sync_uses_chat_send_message(monkeypatch):
    from types import SimpleNamespace

    from pydantic import BaseModel

    from app.services import proposal_gemini as gem

    class Draft(BaseModel):
        body: str = ""

    sent: dict = {}

    class FakeChat:
        def send_message(self, message, config=None):
            sent["used_chat"] = True
            sent["max_output_tokens"] = getattr(config, "max_output_tokens", None)
            afc = getattr(config, "automatic_function_calling", None)
            sent["afc_disabled"] = bool(getattr(afc, "disable", False))
            thinking = getattr(config, "thinking_config", None)
            sent["include_thoughts"] = getattr(thinking, "include_thoughts", None)
            return SimpleNamespace(text='{"body":"ok"}', candidates=[], parsed=None)

    class FakeChats:
        def create(self, *, model, config=None, history=None):
            sent["model"] = model
            return FakeChat()

    class FakeModels:
        def generate_content(self, *args, **kwargs):
            raise AssertionError("must not call Models.generate_content")

    class FakeClient:
        def __init__(self, *args, **kwargs):
            sent["client_kwargs"] = kwargs
            self.chats = FakeChats()
            self.models = FakeModels()

    monkeypatch.setattr(
        gem,
        "get_settings",
        lambda: SimpleNamespace(
            proposal_llm_model="gemini-3.5-flash",
            proposal_llm_thinking_level="high",
            proposal_llm_api_key="paid-key",
            gemini_api_key="",
            proposal_llm_base_url="",
        ),
    )
    import google.genai as genai_mod

    monkeypatch.setattr(genai_mod, "Client", FakeClient)

    out = gem.generate_json_sync("write", Draft)
    assert out.body == "ok"
    assert sent.get("used_chat") is True
    assert sent.get("afc_disabled") is True
    assert sent.get("max_output_tokens") == gem.PROPOSAL_GEMINI_MAX_OUTPUT_TOKENS
    assert sent.get("include_thoughts") is False
    http = (sent.get("client_kwargs") or {}).get("http_options")
    timeout = getattr(http, "timeout", None)
    if timeout is None and isinstance(http, dict):
        timeout = http.get("timeout")
    assert int(timeout) == gem.PROPOSAL_GEMINI_TIMEOUT_MS
    assert gem.PROPOSAL_GEMINI_TIMEOUT_MS == 180_000


def test_http_options_timeout_is_milliseconds():
    from types import SimpleNamespace

    from app.services.proposal_gemini import _http_options

    class FakeHttpOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    timeout = _http_options(SimpleNamespace(HttpOptions=FakeHttpOptions))
    assert timeout.kwargs["timeout"] == 180_000


def test_response_text_skips_thoughts_and_uses_parsed():
    from types import SimpleNamespace

    from app.services.proposal_gemini import extract_json_object, response_text

    mixed = SimpleNamespace(
        parsed=None,
        text="",
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(
                    parts=[
                        SimpleNamespace(text="scratch: {", thought=True),
                        SimpleNamespace(text='{"cover": {"brand": "A"}}', thought=False),
                    ]
                )
            )
        ],
    )
    assert response_text(mixed) == '{"cover": {"brand": "A"}}'
    parsed = SimpleNamespace(
        parsed={"body": "ok"},
        text='{"body": "trunc',
        candidates=[],
    )
    assert '"ok"' in response_text(parsed)
    prefixed = 'Reasoning first.\n{"key": "scope", "body": "done"}'
    assert extract_json_object(prefixed) == '{"key": "scope", "body": "done"}'


def test_response_text_reads_candidate_parts_when_text_empty():
    from types import SimpleNamespace

    from app.services.proposal_gemini import response_text

    empty = SimpleNamespace(text="", candidates=[])
    assert response_text(empty) == ""
    filled = SimpleNamespace(
        text="",
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(
                    parts=[SimpleNamespace(text='{"cover": {}}')]
                )
            )
        ],
    )
    assert response_text(filled) == '{"cover": {}}'


def test_freeze_playbook_emits_skeleton_and_css():
    gold = {
        "instance": {
            "cover": {"brand": "Vendor", "title": "Proposal"},
            "sections": [
                {
                    "id": "scope",
                    "heading": "Scope",
                    "kind": "prose",
                    "blocks": [{"kind": "prose", "text": "old"}],
                },
                {
                    "id": "commercials",
                    "heading": "Charges",
                    "kind": "table",
                    "blocks": [{"kind": "table", "table_id": "charges"}],
                },
            ],
            "tables": [
                {
                    "id": "charges",
                    "headers": ["Item", "Qty"],
                    "rows": [["CRM", "1"]],
                }
            ],
        },
        "layout": {"title_align": "left", "title_font_pt": 18},
        "themeTokens": default_theme_tokens(),
    }
    frozen = freeze_playbook(gold=gold, instances=[gold["instance"]])
    html = frozen["blueprint"]["html"]
    css = frozen["blueprint"]["css"]
    assert "bp-playbook-cover" in html
    assert 'data-slot="scope"' in html
    assert "cover-title" in css
    assert "font-size" in css
    assert "bp-table" in css
    assert frozen["assets"]["goldInstance"]["cover"]["brand"] == "Vendor"
    assert "page-break-after" in css
    assert "cover-align-left" in html


def test_measure_layout_finds_commercial_proposal_title():
    lines = [
        {"page": 0, "text": "ZIFO", "bbox": [200, 40, 390, 70], "size": 24, "bold": True, "color": "#000"},
        {"page": 0, "text": "Commercial Proposal", "bbox": [40, 120, 280, 140], "size": 14, "bold": True, "color": "#073763"},
        {"page": 0, "text": "Prepared for Acme", "bbox": [40, 150, 300, 164], "size": 11, "bold": False, "color": "#111"},
        {"page": 0, "text": "9 September 2026", "bbox": [40, 168, 200, 182], "size": 11, "bold": False, "color": "#111"},
        {"page": 0, "text": "Client", "bbox": [40, 220, 100, 234], "size": 11, "bold": False, "color": "#111"},
        {"page": 0, "text": "Acme", "bbox": [120, 220, 200, 234], "size": 11, "bold": False, "color": "#111"},
        {"page": 0, "text": "Document", "bbox": [40, 240, 110, 254], "size": 11, "bold": False, "color": "#111"},
        {"page": 0, "text": "Commercial Proposal", "bbox": [120, 240, 280, 254], "size": 11, "bold": False, "color": "#111"},
        {"page": 0, "text": "Overview", "bbox": [40, 280, 140, 296], "size": 11, "bold": True, "color": "#073763"},
    ]
    layout = measure_layout(lines, 595, 842, 11)
    assert layout.get("title_font_pt") == 14
    assert layout.get("brand_font_pt") == 24
    assert layout.get("brand_align") == "center"
    assert layout.get("title_align") == "left"
    assert layout.get("cover_align") == "left"
    assert layout.get("has_cover_meta_table") is True
    assert any(r.get("label") == "Client" for r in (layout.get("meta_rows") or []))


def test_freeze_playbook_empty_instance_still_has_slot():
    frozen = freeze_playbook(
        gold={"instance": {"cover": {"title": "Proposal"}, "sections": []}},
        instances=[],
    )
    html = frozen["blueprint"]["html"]
    assert "data-slot=" in html
    assert "proposal-doc" in html or "bp-playbook-cover" in html


def test_render_uses_frozen_css_and_no_css_in_content():
    content = {
        "cover": {"brand": "Vendor", "title": "New deal", "date": "9 September 2026"},
        "sections": [
            {
                "id": "scope",
                "heading": "Scope",
                "kind": "prose",
                "blocks": [{"kind": "prose", "text": "Deliver CRM for this customer."}],
            }
        ],
        "tables": [],
        "assumptions": [],
    }
    css = compile_theme_css(default_theme_tokens())
    html = render_proposal_html(content, theme_css=css)
    assert "proposal-doc" in html
    assert css.split("{")[0] in html or "<style>" in html
    assert "stylesheet" not in str(content).lower()
    assert "<style" not in str(content["sections"])


def test_cover_chrome_align_group_prefers_center():
    assert _cover_chrome_align(["center", "left", "center", "center"]) == "center"
    assert _cover_chrome_align(["left", "left", "left", "center"]) == "left"


def test_measure_layout_centered_cover_keeps_left_section_headings():
    lines = [
        {
            "page": 0,
            "text": "WORKTUAL",
            "bbox": [220, 50, 375, 80],
            "size": 24,
            "bold": True,
            "color": "#000",
        },
        {
            "page": 0,
            "text": "Commercial Proposal",
            "bbox": [80, 110, 515, 150],
            "size": 36,
            "bold": True,
            "color": "#073763",
        },
        {
            "page": 0,
            "text": "Prepared for Acme",
            "bbox": [200, 160, 395, 176],
            "size": 11,
            "bold": False,
            "color": "#111",
        },
        {
            "page": 0,
            "text": "9 September 2026",
            "bbox": [230, 178, 365, 192],
            "size": 11,
            "bold": False,
            "color": "#111",
        },
        {
            "page": 0,
            "text": "Overview",
            "bbox": [48, 280, 140, 296],
            "size": 12,
            "bold": True,
            "color": "#073763",
        },
    ]
    layout = measure_layout(lines, 595, 842, 11)
    assert layout.get("cover_align") == "center"
    assert layout.get("title_align") == "center"
    assert layout.get("heading_align") == "left"


def test_compile_theme_css_cover_align_center_overrides_leftover_title_left():
    tokens = default_theme_tokens()
    tokens["layout"] = {"cover_align": "center", "title_align": "left", "heading_align": "left"}
    css = compile_theme_css(tokens)
    assert ".cover-block.cover-align-center" in css
    assert ".proposal-doc .cover-title" in css
    assert "text-align: center" in css
    title_rule = css.split(".proposal-doc .cover-title")[1].split("}")[0]
    assert "text-align: center" in title_rule
    heading_rule = css.split(".proposal-doc h1.sec-h")[1].split("}")[0]
    assert "text-align: left" in heading_rule


def test_render_cover_block_gets_cover_align_class():
    html = render_proposal_html(
        {
            "cover": {
                "brand": "WORKTUAL",
                "title": "Commercial Proposal",
                "cover_align": "center",
            },
            "sections": [],
        },
        tokens=default_theme_tokens(),
    )
    assert 'class="cover-block bp-playbook-cover cover-align-center"' in html


def test_compile_theme_css_cover_meta_spans_content():
    tokens = default_theme_tokens()
    tokens["cover_meta"] = {
        "border_color": "#bfbfbf",
        "label_width_pt": 85.5,
        "width_pt": 90,
    }
    css = compile_theme_css(tokens)
    assert "width: 100%" in css
    assert "85.5pt" in css
    assert "table-layout: fixed" in css
    assert ".proposal-doc .cover-meta" in css


def test_compile_theme_css_applies_header_token_without_fill_flag():
    tokens = default_theme_tokens()
    tokens["table"] = {"header_fill": False, "emphasize_last_col": False}
    tokens["colors"]["table_header_bg"] = "#1f4e79"
    css = compile_theme_css(tokens)
    assert "background: #1f4e79" in css
    assert ".proposal-doc table.grid th" in css


def test_apply_chrome_preserves_clustered_header_fill():
    tokens = {
        "table": {"header_fill": True},
        "colors": {"table_header_bg": "#123456"},
    }
    chrome = {
        "table": {
            "header_fill": False,
            "borders": "grid",
            "emphasize_last_col": False,
        }
    }
    out = apply_chrome_to_tokens(tokens, chrome)
    assert out["table"]["header_fill"] is True
    assert out["table"]["borders"] == "grid"


def test_freeze_prefers_parser_meta_over_brd_dump():
    frozen = freeze_playbook(
        gold={
            "instance": {
                "cover": {
                    "brand": "WORKTUAL",
                    "title": "Commercial Proposal",
                    "meta_rows": [
                        {"label": "Client Name", "value": "Old"},
                        {"label": "Industry", "value": "Healthcare"},
                    ],
                },
                "sections": [],
            },
            "layout": {
                "title_align": "left",
                "meta_rows": [
                    {"label": "Client", "value": "Old Co"},
                    {"label": "Document", "value": "Commercial Proposal"},
                    {"label": "Validity", "value": "30 days"},
                ],
            },
            "themeTokens": default_theme_tokens(),
        },
        instances=[],
    )
    labels = [
        r["label"]
        for r in (frozen["assets"]["coverLayout"].get("meta_rows") or [])
    ]
    assert labels == ["Client", "Document", "Validity"]
    html = frozen["blueprint"]["html"]
    assert "cover-meta" in html
    assert "{{customerName}}" in html
    assert "Client Name" not in html


def test_apply_frozen_cover_keeps_gold_brand_and_meta_labels():
    cover = apply_frozen_cover(
        {
            "title": "Customer Engagement & Proactive Contact Centre Solution",
            "date": "9 September 2026",
            "meta_rows": [
                {"label": "Client Name", "value": "Positron"},
                {"label": "Industry", "value": "Healthcare"},
            ],
        },
        {
            "brand": "WORKTUAL",
            "title": "Commercial Proposal",
            "prepared_for": "Prepared for Historical Co",
            "date": "October 24, 2023",
            "product_tags": ["Intelligent CRM with Sales & Marketing and Web Tracking"],
            "meta_rows": [
                {"label": "Client", "value": "Historical Co"},
                {"label": "Document", "value": "Commercial Proposal"},
                {"label": "Validity", "value": "30 days"},
            ],
        },
        {"client": {"name": "MICE Global"}},
        vendor_name="ZIFO",
    )
    assert cover["brand"] == "WORKTUAL"
    assert "MICE Global" in cover["prepared_for"]
    assert cover["title"] == "Customer Engagement & Proactive Contact Centre Solution"
    assert [r["label"] for r in cover["meta_rows"]] == ["Client", "Document", "Validity"]
    assert cover["meta_rows"][0]["value"] == "MICE Global"
    assert cover["meta_rows"][1]["value"] == "Customer Engagement & Proactive Contact Centre Solution"


def test_apply_frozen_cover_drops_brd_meta_when_gold_has_none():
    cover = apply_frozen_cover(
        {
            "brand": "WORKTUAL",
            "title": "Commercial Proposal",
            "meta_rows": [
                {"label": "Client Name", "value": "Positron"},
                {"label": "Industry", "value": "Healthcare"},
                {"label": "Website", "value": "https://example.com"},
                {"label": "Lead Source", "value": "Ashu"},
            ],
        },
        {"brand": "WORKTUAL", "title": "Commercial Proposal", "meta_rows": []},
        {"client": {"name": "Positron"}},
        vendor_name="WORKTUAL",
    )
    assert cover["meta_rows"] == []
    assert cover["brand"] == "WORKTUAL"


def test_apply_frozen_cover_drops_internal_doc_meta():
    from app.agents.proposal_layout import apply_frozen_cover

    cover = apply_frozen_cover(
        {"title": "Commercial Proposal", "meta_rows": []},
        {
            "brand": "ZIFO",
            "title": "Product Portfolio, Capabilities, Architecture and Product Policies",
            "layout": {"has_cover_meta_table": False},
            "meta_rows": [
                {"label": "Document Owner", "value": "Product Management"},
                {"label": "Document Classification", "value": "Internal Product Knowledge"},
                {"label": "Version", "value": "1.0"},
            ],
        },
        {"client": {"name": "MICE Global"}},
        vendor_name="ZIFO",
    )
    assert cover["meta_rows"] == []


def test_select_cover_product_tags_does_not_dump_catalog():
    from app.agents.proposal_layout import select_cover_product_tags

    tags = select_cover_product_tags(
        ["AI Chatbot", "Proactive Contact Centre"],
        allowed_names=[
            "AI Native CRM",
            "Web Tracking",
            "AI Native Campaign Management",
        ],
        gold_tags=["Intelligent CRM with Sales & Marketing and Web Tracking"],
    )
    assert tags == ["AI Chatbot", "Proactive Contact Centre"]
    assert "Intelligent CRM with Sales & Marketing and Web Tracking" not in tags
    assert "AI Native CRM" not in tags


def test_usable_running_chrome_rejects_section_titles():
    from app.agents.proposal_pdf_parse import usable_running_chrome

    assert usable_running_chrome("1. Product Portfolio Overview") is False
    assert usable_running_chrome("ZIFO Confidential") is True
    assert (
        usable_running_chrome(
            "This integrated approach enables Rockwell Industries to connect customer"
        )
        is False
    )
    assert usable_running_chrome("Commercial Proposal | 1") is True


@pytest.mark.asyncio
async def test_proposal_generate_fails_fast_when_kb_down(monkeypatch):
    from app.agents import proposal_generate_agent as agent

    async def fake_probe(**_kwargs):
        return {
            "available": False,
            "reason": "kb_unavailable",
            "error": "ConnectTimeout: ",
        }

    async def fake_json(*_args, **_kwargs):
        raise AssertionError("Gemini must not run when product KB is down")

    monkeypatch.setattr(agent, "probe_product_knowledge", fake_probe)
    monkeypatch.setattr(agent, "generate_json", fake_json)
    monkeypatch.setattr(agent, "proposal_gemini_configured", lambda: True)

    out = await agent.run(
        {"organizationId": "1003", "requirementText": "Need a CRM for sales"}
    )
    assert out["ok"] is False
    assert out["reason"] == "kb_unavailable"
    assert out["source"] == "heuristic"
    assert "temporarily unavailable" in out["error"]


@pytest.mark.asyncio
async def test_load_product_kb_aborts_on_first_transport_failure(monkeypatch):
    from app.agents import proposal_generate_agent as agent

    calls = {"n": 0}

    async def fake_sales(_query, **_kwargs):
        calls["n"] += 1
        return {
            "status": "failure",
            "errorType": "ConnectTimeout",
            "error": "ConnectTimeout: ",
        }

    monkeypatch.setattr(agent, "get_sales_knowledge", fake_sales)
    text, reason = await agent._load_product_kb(
        [
            {"id": "a", "name": "Alpha"},
            {"id": "b", "name": "Beta"},
            {"id": "c", "name": "Gamma"},
        ],
        organization_id="1003",
        requirement_summary="need crm",
    )
    assert text == ""
    assert reason == "kb_unavailable"
    assert calls["n"] == 1
