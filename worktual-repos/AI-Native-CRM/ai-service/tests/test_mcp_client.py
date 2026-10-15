"""Coworker MCP client + result mapping (offline unit tests)."""

from __future__ import annotations

from app.mcp_client import mcp_result_to_turn_parts, mcp_tools_to_openai


def test_mcp_tools_to_openai_shape() -> None:
    tools = mcp_tools_to_openai(
        [
            {
                "name": "propose_create_proposal",
                "description": "Create proposal",
                "inputSchema": {
                    "type": "object",
                    "properties": {"dealId": {"type": "string"}},
                    "required": ["dealId"],
                },
            }
        ]
    )
    assert len(tools) == 1
    assert tools[0]["type"] == "function"
    assert tools[0]["function"]["name"] == "propose_create_proposal"
    assert tools[0]["function"]["parameters"]["required"] == ["dealId"]


def test_filter_product_openai_tools_by_motion() -> None:
    from app.agents.crm_tools import filter_product_openai_tools

    raw = [
        {
            "type": "function",
            "function": {
                "name": "patch_product_draft",
                "description": "Update draft",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "brand": {"type": "string"},
                        "stockOnHand": {"type": "string"},
                        "productType": {"type": "string"},
                        "billingType": {"type": "string"},
                    },
                },
            },
        }
    ]
    b2b = filter_product_openai_tools(raw, "b2b")
    props = b2b[0]["function"]["parameters"]["properties"]
    assert "brand" not in props
    assert "stockOnHand" not in props
    assert "productType" in props
    b2c = filter_product_openai_tools(raw, "b2c")
    props_c = b2c[0]["function"]["parameters"]["properties"]
    assert "brand" in props_c
    assert "productType" not in props_c
    assert "billingType" not in props_c
    both = filter_product_openai_tools(raw, "b2b2c")
    props_u = both[0]["function"]["parameters"]["properties"]
    assert "brand" in props_u
    assert "productType" in props_u


def test_mcp_form_owned_becomes_auto_proposal() -> None:
    parts = mcp_result_to_turn_parts(
        "propose_create_contact",
        {
            "ok": True,
            "kind": "form_owned",
            "proposal": {
                "id": "p1",
                "name": "propose_create_contact",
                "label": "Create contact",
                "args": {"auto": True},
                "risk": "low",
            },
        },
    )
    assert parts["toolProposal"]["name"] == "propose_create_contact"
    assert parts["toolProposal"]["args"]["auto"] is True
    assert parts["ok"] is True


def test_mcp_draft_patch() -> None:
    parts = mcp_result_to_turn_parts(
        "patch_contact_draft",
        {
            "ok": True,
            "kind": "draft_patch",
            "patch": {"firstName": "Ada"},
            "proposal": {
                "id": "p2",
                "name": "patch_contact_draft",
                "label": "patch",
                "args": {"firstName": "Ada", "auto": True},
                "risk": "low",
            },
        },
    )
    assert parts["patch"]["firstName"] == "Ada"
    assert "toolProposal" not in parts


def test_mcp_clarify_is_speech_only() -> None:
    parts = mcp_result_to_turn_parts(
        "ask_clarification",
        {
            "ok": True,
            "kind": "clarify",
            "assistantText": "Which deal should I use?",
        },
    )
    assert parts["assistantText"] == "Which deal should I use?"
    assert "toolProposal" not in parts


def test_mcp_needs_confirm_becomes_proposal() -> None:
    parts = mcp_result_to_turn_parts(
        "propose_create_contact",
        {
            "ok": True,
            "kind": "needs_confirm",
            "proposal": {
                "id": "p1",
                "name": "propose_create_contact",
                "label": "Create contact",
                "args": {"auto": False},
                "risk": "high",
            },
        },
    )
    assert parts["toolProposal"]["name"] == "propose_create_contact"
    assert parts["toolProposal"]["risk"] == "high"


def _load_crm_tools():
    """Load crm_tools without importing the full agent registry."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "app" / "agents" / "crm_tools.py"
    spec = importlib.util.spec_from_file_location("crm_tools_under_test", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    # Minimal deps already importable; skip full package side effects.
    try:
        spec.loader.exec_module(mod)
    except ModuleNotFoundError as exc:
        # Incomplete local venv — skip conversational assertions.
        import pytest

        pytest.skip(f"crm_tools deps missing: {exc}")
    return mod


def test_conversational_shared_exports() -> None:
    ct = _load_crm_tools()
    shared = getattr(ct, "CONVERSATIONAL_SHARED", "")
    addons = getattr(ct, "MODULE_ADDONS", {})
    assert "Shall I save" in shared or "save" in shared.lower()
    assert (
        "click Create" in shared
        or "magic" in shared.lower()
        or "say create" in shared.lower()
    )
    for mod in (
        "contact",
        "sales",
        "company",
        "product",
        "finance",
        "quotes",
        "activities",
    ):
        assert mod in addons
        assert len(addons[mod]) > 40


def test_no_local_tool_schema_catalog() -> None:
    """Schemas must come from MCP — Python must not redefine OpenAI tool catalogs."""
    ct = _load_crm_tools()
    assert not hasattr(ct, "tools_for_module")
    assert not hasattr(ct, "NAVIGATE_TOOL")
    assert not hasattr(ct, "PROPOSE_CREATE_CONTACT_TOOL")
