"""In-process FastMCP catalog + confirm gate + uiRefresh (no DB required)."""

from __future__ import annotations

import pytest

from app.mcp.catalog import get_tool, list_tools
from app.mcp.context import McpRequestContext, get_ctx, reset_ctx, set_ctx
from app.mcp.dispatch import dispatch
from app.mcp.server import begin_agent_mcp_context, end_agent_mcp_context


def test_catalog_filters_by_module() -> None:
    sales = list_tools(module="sales", surface="list")
    names = {t["name"] for t in sales}
    assert "propose_stage_change" in names
    assert "propose_create_proposal" in names
    assert "propose_create_contact" not in names

    create = list_tools(module="sales", surface="create")
    create_names = {t["name"] for t in create}
    assert "propose_create_deal" in create_names


def test_contact_detail_includes_linked_company_tools() -> None:
    names = {t["name"] for t in list_tools(module="contact", surface="detail", entity_id="c1")}
    assert "propose_update_company" in names
    assert "propose_update_company_location" in names


def test_catalog_create_surface_includes_draft_patches() -> None:
    contact = list_tools(module="contact", surface="create")
    names = {t["name"] for t in contact}
    assert "propose_create_contact" in names
    assert "propose_import_contacts" in names
    list_names = {t["name"] for t in list_tools(module="contact", surface="list")}
    assert "propose_import_contacts" in list_names
    assert any(n.startswith("patch_") for n in names) or "patch_contact_draft" in names

    from app.mcp.catalog import FORM_OWNED_TOOLS

    assert "propose_update_contact" in FORM_OWNED_TOOLS
    assert "propose_delete_contact" in FORM_OWNED_TOOLS
    assert "propose_stage_change" in FORM_OWNED_TOOLS

    company = {t["name"] for t in list_tools(module="company", surface="create")}
    assert "patch_company_draft" in company
    assert "patch_location_draft" not in company
    loc_create = {
        t["name"]
        for t in list_tools(module="company", surface="create", entity_id="co_1")
    }
    assert "patch_location_draft" in loc_create
    assert "patch_company_draft" not in loc_create

    sales = {t["name"] for t in list_tools(module="sales", surface="create")}
    assert "patch_deal_draft" in sales
    deal_props = get_tool("patch_deal_draft")["inputSchema"]["properties"]
    assert "notes" in deal_props
    assert "expectedCloseDate" in deal_props
    assert "companyName" in deal_props

    product = {t["name"] for t in list_tools(module="product", surface="create")}
    assert "patch_product_draft" in product
    product_props = get_tool("patch_product_draft")["inputSchema"]["properties"]
    assert "brand" in product_props
    assert "stockOnHand" in product_props
    assert "productUrl" in product_props
    assert "billingType" in product_props

    finance = {t["name"] for t in list_tools(module="finance", surface="create")}
    assert "patch_invoice_draft" in finance
    inv_props = get_tool("patch_invoice_draft")["inputSchema"]["properties"]
    assert "paymentTerms" in inv_props

    quotes = {t["name"] for t in list_tools(module="quotes", surface="create")}
    assert "patch_quote_draft" in quotes

    quote_update = get_tool("propose_update_quote")["inputSchema"]["properties"]
    assert "lines" in quote_update
    assert "discountPct" in quote_update
    assert get_tool("propose_send_quote") is not None

    inv_update = get_tool("propose_update_invoice")["inputSchema"]["properties"]
    assert "lines" in inv_update
    assert "discountPct" in inv_update
    assert get_tool("propose_send_invoice") is not None
    assert get_tool("propose_send_proposal") is not None

    company_props = get_tool("patch_company_draft")["inputSchema"]["properties"]
    assert "locationAddress" in company_props
    assert "linkedinUrl" in company_props


def test_get_tool_known() -> None:
    t = get_tool("propose_create_deal")
    assert t is not None
    assert t["risk"] == "high"
    assert t["kind"] == "mutation"


def test_query_analytics_is_read_only_on_every_crm_surface() -> None:
    tool = get_tool("query_analytics")
    assert tool is not None
    assert tool["annotations"]["readOnlyHint"] is True
    assert "query_analytics" in {
        t["name"] for t in list_tools(module="dashboard", surface="list")
    }
    assert "query_analytics" in {
        t["name"] for t in list_tools(module="sales", surface="list")
    }


@pytest.mark.asyncio
async def test_query_analytics_uses_trusted_mcp_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    async def fake_run_reports(**kwargs):
        captured.update(kwargs)
        return {
            "ok": True,
            "assistantText": "Pipeline is ₹10.",
            "source": "ai",
            "analytics": {"visual": {"kind": "kpi"}},
            "suggestions": ["Break down by owner"],
            "reportsContextPatch": {
                "objectLock": "deals",
                "timePhrase": "this month",
            },
        }

    monkeypatch.setattr(
        "app.agents.reports_analytics_agent.run",
        fake_run_reports,
    )
    begin_agent_mcp_context(
        acting_user_id="user-7",
        organization_id="1003",
        role="sales_rep",
        business_type="b2b",
        module="dashboard",
        surface="list",
        run_id="run-reports",
    )
    try:
        result = await dispatch(
            "query_analytics",
            {
                "question": "What is my pipeline?",
                "timePhrase": "this month",
                "objectLock": "deals",
                "reportsContext": {"lastKpiId": "total_pipeline"},
                "recentMessages": [
                    {"role": "user", "content": "Show my open deals"},
                ],
            },
        )
        assert result["ok"] is True
        assert result["kind"] == "executed"
        assert result["data"]["analytics"]["visual"]["kind"] == "kpi"
        assert captured["organization_id"] == "1003"
        assert captured["actor_id"] == "user-7"
        assert captured["role"] == "sales_rep"
        assert captured["business_type"] == "b2b"
        assert captured["time_phrase"] == "this month"
        assert captured["object_lock"] == "deals"
        assert captured["working_memory"]["slots"]["reportsContext"][
            "lastKpiId"
        ] == "total_pipeline"
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_stage_change_is_form_owned_without_confirm_click() -> None:
    begin_agent_mcp_context(
        acting_user_id="user-1",
        organization_id="1000",
        role="sales_rep",
        module="sales",
        surface="list",
    )
    try:
        result = await dispatch(
            "propose_stage_change",
            {"dealId": "deal_x", "stage": "negotiate"},
        )
        assert result["ok"] is True
        assert result["kind"] == "form_owned"
        assert result["proposal"]["name"] == "propose_stage_change"
        assert result["proposal"]["args"]["auto"] is True
        assert end_agent_mcp_context() == {}
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_ui_directive_no_db() -> None:
    begin_agent_mcp_context(
        acting_user_id="user-1",
        organization_id="1000",
        role="sales_rep",
        module="contact",
        surface="list",
    )
    try:
        result = await dispatch("navigate", {"href": "/contact"})
        assert result["ok"] is True
        assert result["kind"] == "ui_directive"
        assert result["proposal"]["args"]["href"] == "/contact"
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_viewer_denied_on_confirmed_mutation(monkeypatch: pytest.MonkeyPatch) -> None:
    begin_agent_mcp_context(
        acting_user_id="user-1",
        organization_id="1000",
        role="viewer",
        module="sales",
        surface="detail",
        entity_id="deal_x",
    )

    async def _boom(*_a, **_k):
        raise AssertionError("DB must not be called for viewer")

    monkeypatch.setattr("app.mcp.db.fetchrow", _boom)
    monkeypatch.setattr("app.mcp.db.execute", _boom)

    try:
        result = await dispatch(
            "remember_memory",
            {"slotKey": "note", "slotValue": "x"},
        )
        assert result["ok"] is False
        assert "role" in (result.get("error") or "").lower()
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_hub_confirmed_stage_change_notes_ui_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    begin_agent_mcp_context(
        acting_user_id="hub:crm",
        organization_id="1000",
        role="sales_rep",
        module="sales",
        surface="detail",
        entity_id="deal_x",
        execution_token="tok",
    )

    async def fake_forward(command: str, arguments: dict):
        assert command == "update_deal_stage"
        assert arguments["dealId"] == "deal_x"
        return {"dealId": "deal_x", "stage": "negotiate", "contactId": "cdp-1"}

    monkeypatch.setattr("app.mcp.dispatch.forward_business_command", fake_forward)

    try:
        result = await dispatch(
            "propose_stage_change",
            {"dealId": "deal_x", "stage": "negotiate", "confirmed": True},
        )
        assert result["ok"] is True
        assert result["kind"] == "executed"
        refresh = end_agent_mcp_context()
        assert "sales" in (refresh.get("modules") or [])
        assert "deal_x" in (refresh.get("entityIds") or [])
        assert refresh.get("reason") == "deal_stage"
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_org_required_for_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    set_ctx(
        McpRequestContext(
            acting_user_id="user-1",
            organization_id="",
            role="admin",
            module="sales",
        )
    )

    async def _boom(*_a, **_k):
        raise AssertionError("DB must not run without org")

    monkeypatch.setattr("app.mcp.db.fetchrow", _boom)

    try:
        result = await dispatch(
            "remember_memory",
            {"slotKey": "note", "slotValue": "x"},
        )
        assert result["ok"] is False
        assert "organization" in (result.get("error") or "").lower()
    finally:
        reset_ctx()


def test_note_refresh_accumulates() -> None:
    ctx = McpRequestContext()
    ctx.note_refresh(modules=["sales"], entity_ids=["a"], reason="one")
    ctx.note_refresh(modules=["contact"], entity_ids=["b"], reason="two")
    assert set(ctx.ui_refresh["modules"]) == {"sales", "contact"}
    assert set(ctx.ui_refresh["entityIds"]) == {"a", "b"}
    assert ctx.ui_refresh["reason"] == "two"
    assert get_ctx().acting_user_id == ""  # default empty when unset


def test_seo_tools_are_marketing_only() -> None:
    names = {t["name"] for t in list_tools(module="marketing", surface="list")}
    for tool in (
        "seo_list_projects",
        "seo_get_snapshots",
        "seo_request_ad_hoc_sync",
        "seo_save_generated_content",
        "seo_list_generated_content",
        "seo_get_generated_content",
        "seo_report_progress",
    ):
        assert tool in names
    assert "seo_research_keywords" in names
    assert "seo_repurpose_social" in names
    assert "seo_publish_post" in names
    repurpose = get_tool("seo_repurpose_social")
    assert repurpose is not None
    assert repurpose["inputSchema"]["required"] == ["contentId"]
    sales = {t["name"] for t in list_tools(module="sales", surface="list")}
    assert "seo_list_projects" not in sales


def test_note_refresh_seo_fields() -> None:
    ctx = McpRequestContext()
    ctx.note_refresh(
        seo_progress={"stage": "keyword_research", "label": "Keyword research"},
        seo_content={"id": "seoc_1"},
    )
    assert ctx.ui_refresh["seoProgress"]["stage"] == "keyword_research"
    assert ctx.ui_refresh["seoContent"]["id"] == "seoc_1"
    assert "marketing" in ctx.ui_refresh["modules"]
    assert ctx.ui_refresh["reason"] == "seo_content"


def test_merge_refresh_preserves_seo_fields() -> None:
    from app.mcp_client import _merge_refresh

    into: dict = {"modules": ["sales"]}
    _merge_refresh(
        into,
        {
            "modules": ["marketing"],
            "href": "/marketing/seo",
            "seoProgress": {"stage": "content_draft", "label": "Content draft"},
            "seoContent": {"title": "Hello"},
        },
    )
    assert set(into["modules"]) == {"sales", "marketing"}
    assert into["href"] == "/marketing/seo"
    assert into["seoProgress"]["stage"] == "content_draft"
    assert into["seoContent"]["title"] == "Hello"


def test_normalize_dsn_strips_prisma_schema() -> None:
    from app.mcp.db import _normalize_dsn

    dsn, path = _normalize_dsn(
        "postgresql://u:p@host:5432/worktual?schema=crm&sslmode=require"
    )
    assert "schema=" not in dsn
    assert "sslmode=require" in dsn
    assert path.startswith("crm")
    assert "inventory" in path


ORG = "1000"


@pytest.mark.asyncio
async def test_form_owned_update_contact_returns_proposal() -> None:
    begin_agent_mcp_context(
        acting_user_id="user-1",
        organization_id=ORG,
        role="sales_rep",
        module="contact",
        surface="detail",
        entity_id="c1",
    )
    try:
        result = await dispatch(
            "propose_update_contact",
            {"confirmed": True, "contactId": "c1", "title": "Developer"},
        )
        assert result["ok"] is True
        assert result["kind"] == "form_owned"
        prop = result.get("proposal") or {}
        assert prop.get("name") == "propose_update_contact"
        assert (prop.get("args") or {}).get("title") == "Developer"
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_form_owned_create_deal_returns_proposal() -> None:
    begin_agent_mcp_context(
        acting_user_id="user-1",
        organization_id=ORG,
        role="sales_rep",
        module="sales",
        surface="create",
        draft={"title": "Acme expansion", "companyId": "co_1"},
    )
    try:
        result = await dispatch("propose_create_deal", {"confirmed": True})
        assert result["ok"] is True
        assert result["kind"] == "form_owned"
        prop = result.get("proposal") or {}
        assert prop.get("name") == "propose_create_deal"
        assert (prop.get("args") or {}).get("auto") is True
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_form_owned_import_contacts_returns_proposal() -> None:
    begin_agent_mcp_context(
        acting_user_id="",
        organization_id="",
        role="sales_rep",
        module="contact",
        surface="list",
    )
    try:
        result = await dispatch(
            "propose_import_contacts",
            {"confirmed": True, "sample": True},
        )
        assert result["ok"] is True
        assert result["kind"] == "form_owned"
        prop = result.get("proposal") or {}
        assert prop.get("name") == "propose_import_contacts"
        assert (prop.get("args") or {}).get("auto") is True
        assert (prop.get("args") or {}).get("sample") is True
    finally:
        reset_ctx()


@pytest.mark.asyncio
async def test_form_owned_create_contact_returns_proposal() -> None:
    begin_agent_mcp_context(
        acting_user_id="",
        organization_id="",
        role="sales_rep",
        module="contact",
        surface="create",
        draft={"firstName": "Ada", "email": "ada@example.com"},
    )
    try:
        result = await dispatch("propose_create_contact", {"confirmed": True})
        assert result["ok"] is True
        assert result["kind"] == "form_owned"
        prop = result.get("proposal") or {}
        assert prop.get("name") == "propose_create_contact"
        assert (prop.get("args") or {}).get("auto") is True
    finally:
        reset_ctx()
