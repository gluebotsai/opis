"""Tests for proposal detail coworker — create / regenerate in chat via LLM."""

from unittest.mock import AsyncMock, patch

from app.agents.proposal_coworker_agent import handle
import asyncio


def _run(messages, ctx=None, catalog=None, *, native_result=None):
    state = {
        "messages": messages,
        "context": ctx or {"entityId": "prop1", "pathname": "/sales/proposals/prop1"},
        "catalog": catalog
        or {
            "openProposal": {
                "id": "prop1",
                "dealId": "deal1",
                "number": "PROP-0011",
            },
            "products": [
                {"id": "p1", "name": "CCaaS Voice"},
                {"id": "p2", "name": "Campaign Management"},
            ],
        },
    }
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.agents.crm_tools.run_native_agent_turn",
            new_callable=AsyncMock,
            return_value=native_result,
        ),
    ):
        out = asyncio.run(handle(state))
    return out["result"]


def test_create_proposal_for_product_from_proposal_page():
    native = {
        "ok": True,
        "assistantText": "Creating a proposal for Campaign Management.",
        "toolProposals": [
            {
                "name": "propose_create_proposal",
                "args": {
                    "dealId": "deal1",
                    "productIds": ["p2"],
                    "productHint": "campaign management",
                },
            }
        ],
    }
    r = _run(
        [{"role": "user", "text": "create proposal for campaign management"}],
        native_result=native,
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    create = next(p for p in props if p["name"] == "propose_create_proposal")
    assert create["args"]["dealId"] == "deal1"
    assert create["args"].get("productIds") == ["p2"]
    assert "campaign" in str(create["args"].get("productHint") or "").lower()


def test_does_not_point_at_regenerate_button():
    native = {
        "ok": True,
        "assistantText": "Creating a proposal for Campaign Management.",
        "toolProposals": [
            {
                "name": "propose_create_proposal",
                "args": {"dealId": "deal1", "productIds": ["p2"]},
            }
        ],
    }
    r = _run(
        [{"role": "user", "text": "create proposal for campaign management"}],
        native_result=native,
    )
    assert "regenerate for this customer" not in str(r.get("assistantText") or "").lower()


def test_yes_after_help_does_not_rewrite_intro():
    messages = [
        {"role": "user", "text": "create proposal for campaign management"},
        {
            "role": "assistant",
            "text": (
                "On this proposal I can rewrite sections \u2014 for example "
                "\u201crewrite the introduction\u201d or \u201cimprove the features section\u201d. "
                "For a full customer refresh, use **Regenerate for this customer**."
            ),
        },
        {"role": "user", "text": "yes"},
    ]
    native = {
        "ok": True,
        "assistantText": "Sure! What would you like me to do with the proposal?",
    }
    r = _run(messages, native_result=native)
    props = r.get("toolProposals") or []
    assert not any(p.get("name") == "propose_rewrite_proposal_section" for p in props)


def test_regenerate_runs_in_chat():
    native = {
        "ok": True,
        "assistantText": "Regenerating the proposal now.",
        "toolProposals": [
            {
                "name": "propose_personalize_proposal",
                "args": {"proposalId": "prop1", "auto": True},
            }
        ],
    }
    r = _run(
        [{"role": "user", "text": "regenerate the proposal"}],
        native_result=native,
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(p.get("name") == "propose_personalize_proposal" for p in props)
    assert "button" not in str(r.get("assistantText") or "").lower()


def test_enhance_implementation_plan_uses_heuristic_rewrite():
    r = _run(
        [{"role": "user", "text": "enhance the implementation plan content"}],
        native_result={"ok": True, "_unhandled": True},
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    rewrite = next(
        (p for p in props if p.get("name") == "propose_rewrite_proposal_section"),
        None,
    )
    assert rewrite is not None
    assert rewrite["args"]["sectionKey"] == "implementation"
    assert rewrite["args"]["proposalId"] == "prop1"


def test_change_overview_section_uses_catalog_title():
    r = _run(
        [{"role": "user", "text": "change the Overview section to mention telecom CRM rollout"}],
        catalog={
            "openProposal": {
                "id": "prop1",
                "dealId": "deal1",
                "number": "PROP-0003",
                "sections": [
                    {"key": "overview", "title": "Overview", "bodyPreview": "Old copy"},
                ],
            },
            "products": [],
        },
        native_result={"ok": True, "_unhandled": True},
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    rewrite = next(
        (p for p in props if p.get("name") == "propose_rewrite_proposal_section"),
        None,
    )
    assert rewrite is not None
    assert rewrite["args"]["sectionKey"] == "overview"
    assert "telecom" in str(rewrite["args"].get("instruction") or "").lower()


def test_add_bullets_keeps_requested_solution_section() -> None:
    r = _run(
        [{"role": "user", "text": "add bullet points for requested solution"}],
        catalog={
            "openProposal": {
                "id": "prop1",
                "dealId": "deal1",
                "number": "PROP-0005",
                "sections": [
                    {"key": "requested_solution", "title": "Requested Solution"},
                ],
            },
            "products": [],
        },
        native_result={"ok": True, "_unhandled": True},
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    rewrite = next(
        (p for p in props if p.get("name") == "propose_rewrite_proposal_section"),
        None,
    )
    assert rewrite is not None
    assert rewrite["args"]["sectionKey"] == "requested_solution"
    instruction = str(rewrite["args"].get("instruction") or "").lower()
    assert "bullet" in instruction
    assert "regenerat" not in instruction


def test_parse_cover_date_change_this_to_abbrev_month() -> None:
    from app.agents.document_section_shared import parse_proposal_visible_text_swap

    assert parse_proposal_visible_text_swap(
        "11 September 2026 change this to 17 nov"
    ) == ("11 September 2026", "17 November 2026")
    assert parse_proposal_visible_text_swap(
        "change the 11 September 2026 to 12 September 2026"
    ) == ("11 September 2026", "12 September 2026")
    assert parse_proposal_visible_text_swap("rewrite the overview to mention Q4") is None


def test_change_cover_date_patches_document_text() -> None:
    r = _run(
        [{"role": "user", "text": "change the 11 September 2026 to 12 September 2026"}],
        native_result={
            "ok": True,
            "assistantText": "I've updated that date for you.",
        },
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    patch = next(
        (p for p in props if p.get("name") == "propose_patch_proposal_document_text"),
        None,
    )
    assert patch is not None
    rows = patch["args"].get("textReplacements") or []
    assert rows[0]["find"] == "11 September 2026"
    assert rows[0]["replace"] == "12 September 2026"
    assert "i've updated" not in str(r.get("assistantText") or "").lower()


def test_change_cover_date_informal_phrase_patches_document_text() -> None:
    r = _run(
        [{"role": "user", "text": "11 September 2026 change this to 17 nov"}],
        native_result={
            "ok": False,
            "assistantText": "I couldn't finish generating that. Send the topic again and I'll retry.",
            "source": "error",
        },
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    patch = next(
        (p for p in props if p.get("name") == "propose_patch_proposal_document_text"),
        None,
    )
    assert patch is not None
    rows = patch["args"].get("textReplacements") or []
    assert rows[0]["find"] == "11 September 2026"
    assert rows[0]["replace"] == "17 November 2026"


def test_generate_from_meeting_uses_heuristic_without_llm():
    r = _run(
        [{"role": "user", "text": "generate proposal based on the meeting discussion"}],
        native_result={"ok": True, "_unhandled": True},
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(p.get("name") == "propose_personalize_proposal" for p in props)
    assert r.get("source") == "heuristic"


def test_send_this_does_not_ask_which_deal():
    native = {
        "ok": True,
        "assistantText": "Sending proposal PROP-0011 for Zendesk expansion.",
        "toolProposals": [
            {"name": "propose_send_proposal", "args": {"proposalId": "prop1"}},
        ],
    }
    r = _run(
        [{"role": "user", "text": "ok fine. send this"}],
        catalog={
            "openProposal": {
                "id": "prop1",
                "dealId": "deal1",
                "number": "PROP-0011",
                "dealTitle": "Zendesk expansion",
            },
            "products": [
                {"id": "p1", "name": "CCaaS Voice"},
                {"id": "p2", "name": "Campaign Management"},
            ],
        },
        native_result=native,
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(p.get("name") == "propose_send_proposal" for p in props)
    assert "which deal" not in str(r.get("assistantText") or "").lower()


def test_update_products_personalizes_open_proposal():
    native = {
        "ok": True,
        "assistantText": "Updating products to Campaign Management.",
        "toolProposals": [
            {
                "name": "propose_personalize_proposal",
                "args": {"proposalId": "prop1", "productIds": ["p2"]},
            }
        ],
    }
    r = _run(
        [{"role": "user", "text": "update product as campaign management"}],
        native_result=native,
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    update = next(p for p in props if p["name"] == "propose_personalize_proposal")
    assert update["args"]["proposalId"] == "prop1"
    assert update["args"].get("productIds") == ["p2"]


def test_delete_this_proposal():
    native = {
        "ok": True,
        "assistantText": "Deleting proposal PROP-0011.",
        "toolProposals": [
            {"name": "propose_delete_proposal", "args": {"proposalId": "prop1"}},
        ],
    }
    r = _run(
        [{"role": "user", "text": "delete this proposal"}],
        native_result=native,
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(p.get("name") == "propose_delete_proposal" for p in props)
    delete = next(p for p in props if p["name"] == "propose_delete_proposal")
    assert delete["args"]["proposalId"] == "prop1"


def test_generate_quote_from_meeting_heuristic_without_llm():
    with patch("app.llm.is_ai_configured", return_value=False):
        r = _run(
            [
                {
                    "role": "user",
                    "text": "generate a quote from the last meeting conversation",
                }
            ],
        )
    assert r["ok"]
    assert r.get("source") == "heuristic"
    props = r.get("toolProposals") or []
    create = next(p for p in props if p["name"] == "propose_create_quote")
    assert create["args"]["dealId"] == "deal1"
    assert create["args"]["proposalId"] == "prop1"


def test_proposal_content_surgical_prompt_keeps_existing_copy() -> None:
    from app.agents.proposal_content_agent import _system_prompt

    surgical = _system_prompt(surgical=True).lower()
    assert "existing" in surgical
    assert "do not invent" in surgical
    assert "bullet" in surgical
    assert "##" in _system_prompt(surgical=True)
    assert "all caps" in surgical


def test_add_table_borders_patches_document_style() -> None:
    r = _run(
        [{"role": "user", "text": "add borders to tables"}],
        native_result={
            "ok": True,
            "assistantText": "I'll add borders to the tables in the proposal for you.",
            "toolProposals": [],
        },
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    patch = next(
        (p for p in props if p.get("name") == "propose_patch_proposal_document_text"),
        None,
    )
    assert patch is not None
    assert patch["args"].get("tableBorders") is True
    assert "i'll add borders" not in str(r.get("assistantText") or "").lower()


def test_remove_table_borders_does_not_add_them() -> None:
    r = _run(
        [{"role": "user", "text": "remove boarders for table"}],
        native_result={
            "ok": True,
            "assistantText": "Adding borders to the tables on this proposal now.",
            "toolProposals": [],
        },
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    patch = next(
        (p for p in props if p.get("name") == "propose_patch_proposal_document_text"),
        None,
    )
    assert patch is not None
    assert patch["args"].get("tableBorders") is False
    assert "adding borders" not in str(r.get("assistantText") or "").lower()
    assert "removing" in str(r.get("assistantText") or "").lower()


def test_do_not_commit_remove_borders_when_tool_adds() -> None:
    from app.agents.coworker_shared import should_commit_native_turn

    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "Adding borders to the tables on this proposal now.",
            "toolProposals": [
                {
                    "name": "propose_patch_proposal_document_text",
                    "args": {"proposalId": "prop1", "tableBorders": True},
                }
            ],
        },
        user_text="i said remove the table borders",
    )


def test_do_not_commit_table_border_speech_without_tool() -> None:
    from app.agents.coworker_shared import should_commit_native_turn

    assert not should_commit_native_turn(
        {
            "ok": True,
            "assistantText": "I'll add borders to the tables. Updated — table styling has been adjusted.",
            "toolProposals": [],
        },
        user_text="add borders to tables",
    )
