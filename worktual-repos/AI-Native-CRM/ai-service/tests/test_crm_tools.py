"""Native CRM tools: history trim, tool_call mapping, prompts (schemas live on MCP)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.crm_tools import (
    coworker_messages_to_openai,
    map_tool_calls_to_result,
    run_native_agent_turn,
)


def test_propose_import_contacts_maps_csv_text():
    r = map_tool_calls_to_result(
        "I'll import these contacts.",
        [
            {
                "function": {
                    "name": "propose_import_contacts",
                    "arguments": {
                        "csvText": "first_name,last_name,email\nAda,Lovelace,ada@example.com\n",
                    },
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="import this csv",
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(
        t["name"] == "propose_import_contacts"
        and t.get("args", {}).get("auto") is True
        and "ada@example.com" in str(t.get("args", {}).get("csvText") or "")
        for t in props
    )


def test_propose_import_contacts_sample_flag():
    r = map_tool_calls_to_result(
        "Importing the sample now.",
        [
            {
                "function": {
                    "name": "propose_import_contacts",
                    "arguments": {"sample": True},
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="import this sample",
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(
        t["name"] == "propose_import_contacts"
        and t.get("args", {}).get("sample") is True
        for t in props
    )


def test_propose_import_contacts_without_rows_is_skipped():
    r = map_tool_calls_to_result(
        "Here's the sample CSV.",
        [
            {
                "function": {
                    "name": "propose_import_contacts",
                    "arguments": {},
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="import contacts from csv",
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert not any(t["name"] == "propose_import_contacts" for t in props)


def test_propose_create_contact_auto_on_chat_confirm():
    r = map_tool_calls_to_result(
        "Ready to save.",
        [
            {
                "function": {
                    "name": "propose_create_contact",
                    "arguments": {"label": "Create contact"},
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="create",
        current_draft={
            "firstName": "Ada",
            "lastName": "Lovelace",
            "email": "ada@example.com",
        },
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert any(
        t["name"] == "propose_create_contact"
        and t.get("args", {}).get("auto") is True
        and t["risk"] == "low"
        for t in props
    )
    assert r["assistantText"] == "Ready to save."


def test_trivial_okay_after_contact_patch_asks_next_slot():
    r = map_tool_calls_to_result(
        "Okay.",
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {"email": "manojnlp04@gmail.com"},
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="manojnlp04@gmail.com",
        current_draft={"firstName": "Yaswanth", "lastName": "M G"},
    )
    assert r["ok"]
    assert r.get("patch", {}).get("email") == "manojnlp04@gmail.com"
    assert not (r.get("assistantText") or "").strip()


def test_patch_ready_contact_asks_to_say_create_no_button():
    r = map_tool_calls_to_result(
        None,
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {"email": "ada@example.com"},
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="ada@example.com",
        current_draft={"firstName": "Ada", "lastName": "Lovelace"},
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    assert not any(t["name"] == "propose_create_contact" for t in props)
    assert r.get("patch", {}).get("email") == "ada@example.com"
    assert not (r.get("assistantText") or "").strip()


def test_system_prompt_has_role_goal_sections():
    from app.agents.crm_tools import CORE_SYSTEM, build_system_prompt

    for section in (
        "Role:",
        "Goal:",
        "Instructions:",
        "Context:",
        "Output:",
        "Guardrails:",
    ):
        assert section in CORE_SYSTEM

    prompt = build_system_prompt(
        "contact",
        "create",
        {"pathname": "/contact", "draft": {"firstName": "Ada"}},
    )
    markers = [
        "Role:",
        "Goal:",
        "Instructions:",
        "Context:",
        "Output:",
        "Guardrails:",
    ]
    positions = [prompt.index(m) for m in markers]
    assert positions == sorted(positions), "sections must appear in order"
    assert "module=contact" in prompt
    assert "firstName" in prompt
    assert "Module: Contacts" in prompt
    assert prompt.index("Module: Contacts") < prompt.index("Context:")
    assert prompt.index("Context:") < prompt.index("Output:")
    assert prompt.index("Output:") < prompt.index("Guardrails:")


def test_activities_prompt_binds_draft_contact_and_open_deal():
    from app.agents.crm_tools import build_system_prompt

    prompt = build_system_prompt(
        "activities",
        "create",
        {
            "pathname": "/activities/log",
            "draft": {
                "contactId": "c-hitler",
                "subject": "Proposal meet",
                "type": "meeting",
            },
            "catalog": {
                "contacts": [
                    {
                        "id": "c-hitler",
                        "displayName": "Hitler meghanath",
                        "email": "sub@example.com",
                    }
                ],
                "openDeal": {
                    "id": "deal-1",
                    "title": "Hitler hit",
                    "contactId": "c-hitler",
                    "contactName": "Hitler meghanath",
                },
            },
        },
    )
    assert "knownContacts" in prompt
    assert "Hitler meghanath" in prompt
    assert "activityContactRule" in prompt
    assert "openDealRule" in prompt
    assert "missing from CRM" in prompt


def test_hub_system_prompt_forbids_follow_up_questions():
    from app.agents.crm_tools import build_system_prompt

    prompt = build_system_prompt(
        "activities",
        "create",
        {
            "source": "hub",
            "hubExecute": True,
            "skillId": "activities",
            "draft": {"contactId": "42", "subject": "Lead score increased", "type": "note"},
        },
    )
    assert "Hub will not reply" in prompt
    assert "Never call ask_clarification" in prompt
    assert "ask at most one clarifying question" not in prompt.lower()
    assert "Who is this activity about" not in prompt
    assert "hubExecute=true" in prompt


def test_deal_detail_prompt_binds_open_deal_not_open_proposal():
    from app.agents.crm_tools import build_system_prompt

    prompt = build_system_prompt(
        "sales",
        "detail",
        {
            "pathname": "/sales/deal-mice",
            "entityId": "deal-mice",
            "catalog": {
                "openDeal": {
                    "id": "deal-mice",
                    "title": "MICE Global — Divya",
                    "contactName": "Divya",
                    "companyName": "MICE Global",
                },
                "deals": [
                    {
                        "id": "deal-mice",
                        "title": "MICE Global — Divya",
                        "contactName": "Divya",
                    },
                    {"id": "deal-other", "title": "Acme Renew"},
                ],
            },
        },
    )
    assert "openDeal=" in prompt
    assert "MICE Global" in prompt
    assert "openDealRule=" in prompt
    assert "openProposalRule=" not in prompt
    assert "dealId MUST be openDeal.id" in prompt


def test_proposal_detail_prompt_keeps_open_proposal_rule():
    from app.agents.crm_tools import build_system_prompt

    prompt = build_system_prompt(
        "sales",
        "detail",
        {
            "pathname": "/sales/proposals/p1",
            "entityId": "p1",
            "catalog": {
                "openProposal": {
                    "id": "p1",
                    "dealTitle": "Acme Renew",
                    "dealId": "d1",
                    "status": "draft",
                    "visibleText": (
                        "WORKTUAL Commercial Proposal Prepared for Fincity "
                        "11 September 2026 Overview Contact centre for Fincity."
                    ),
                    "sections": [
                        {"key": "overview", "title": "Overview"},
                    ],
                },
            },
        },
    )
    assert "openProposalRule=" in prompt
    assert "openDealRule=" not in prompt
    assert "Acme Renew" in prompt
    assert "openProposalVisibleText=" in prompt
    assert "11 September 2026" in prompt
    assert "openProposalSections=" in prompt
    assert "openProposalEditRule=" in prompt
    assert "propose_patch_proposal_document_text" in prompt
    assert "<strong>" in prompt
    assert "never markdown asterisks" in prompt
    assert "tableBorders" in prompt


def test_patch_deal_draft_maps_proposal_stage_to_propose():
    r = map_tool_calls_to_result(
        "I've set the stage to proposal.",
        [
            {
                "function": {
                    "name": "patch_deal_draft",
                    "arguments": {"stage": "proposal"},
                }
            }
        ],
        mod="sales",
        pathname="/sales",
        user_text="proposal",
        current_draft={"title": "Jonsan Tapes", "companyName": "Jonsan"},
    )
    assert r["ok"]
    assert r.get("patch", {}).get("stage") == "propose"


def test_propose_stage_change_maps_proposal_to_propose():
    r = map_tool_calls_to_result(
        "Moving it to proposal.",
        [
            {
                "function": {
                    "name": "propose_stage_change",
                    "arguments": {"dealId": "deal1", "stage": "proposal"},
                }
            }
        ],
        mod="sales",
        pathname="/sales/deal1",
        user_text="proposal",
        entity_id="deal1",
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    stage_tools = [t for t in props if t.get("name") == "propose_stage_change"]
    assert stage_tools
    assert stage_tools[0]["args"]["stage"] == "propose"
    assert stage_tools[0]["args"]["auto"] is True
    assert stage_tools[0]["risk"] == "low"


def test_sales_create_prompt_binds_proposal_chip_to_propose_stage():
    from app.agents.crm_tools import build_system_prompt

    prompt = build_system_prompt("sales", "create", {"pathname": "/sales"})
    assert "stage=propose" in prompt
    assert "not a proposal document" in prompt


def test_history_drops_email_card_captions():
    out = coworker_messages_to_openai(
        [
            {"role": "user", "text": "sorry for the delivery"},
            {
                "role": "assistant",
                "text": "I've drafted a short apology.",
            },
            {
                "role": "assistant",
                "text": "Draft saved. It stays in Inbox Drafts.",
            },
            {"role": "user", "text": "make it more friendly"},
        ]
    )
    assistant = [m["content"] for m in out if m["role"] == "assistant"]
    assert assistant == ["I've drafted a short apology."]
    assert "Draft saved" not in "\n".join(m["content"] for m in out)


def test_history_trims_complete_pairs():
    msgs = []
    for i in range(20):
        msgs.append({"role": "user", "text": f"u{i}"})
        msgs.append({"role": "assistant", "text": f"a{i}"})
    out = coworker_messages_to_openai(msgs, max_pairs=3)
    assert len([m for m in out if m["role"] == "user"]) == 3


@pytest.mark.asyncio
async def test_native_turn_requires_mcp_tools():
    """No local schemas — empty MCP list skips the native tool turn."""
    with (
        patch("app.llm.is_ai_configured", return_value=True),
        patch(
            "app.mcp_client.McpClient.list_tools",
            new_callable=AsyncMock,
            return_value=[],
        ),
    ):
        out = await run_native_agent_turn(
            mod="contact",
            surface="create",
            messages=[{"role": "user", "text": "create a contact"}],
            context={"module": "contact", "actingUserId": "u1"},
            catalog={},
            user_text="create a contact",
        )
    assert out is None


def test_effective_contact_type_defaults_to_contact():
    from app.agents.crm_tools import (
        effective_contact_type,
        has_reachable_channel,
        resolve_contact_type_for_channels,
    )

    assert effective_contact_type(None) == "contact"
    assert effective_contact_type("") == "contact"
    assert effective_contact_type("lead") == "lead"
    assert not has_reachable_channel({})
    assert has_reachable_channel({"email": "a@b.co"})
    assert (
        resolve_contact_type_for_channels({"email": "a@b.co"}, existing="contact")
        == "lead"
    )
    assert resolve_contact_type_for_channels({}, existing="lead") == "lead"
    assert resolve_contact_type_for_channels({}, existing="contact") == "contact"


def test_set_workspace_create_company_from_contact_becomes_navigate():
    r = map_tool_calls_to_result(
        "I'll set Lyca up as a company.",
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {"companyName": "lyca"},
                }
            },
            {
                "function": {
                    "name": "set_workspace",
                    "arguments": {
                        "mode": "create",
                        "label": "Create company",
                        "seedPrompt": "Lyca",
                    },
                }
            },
        ],
        mod="contact",
        pathname="/contact/new",
        user_text="lyca",
        current_draft={},
    )
    assert r["ok"]
    assert not (r.get("patch") or {}).get("companyName")
    props = r.get("toolProposals") or []
    nav = [t for t in props if t.get("name") == "navigate"]
    assert nav
    assert (nav[0].get("args") or {}).get("href") == "/company/new"
    assert "Lyca" in str((nav[0].get("args") or {}).get("seedPrompt") or "")


def test_navigate_to_company_create_drops_contact_patch():
    r = map_tool_calls_to_result(
        "Got it — Lyca. I'll open company setup.",
        [
            {
                "function": {
                    "name": "patch_contact_draft",
                    "arguments": {"companyName": "lyca"},
                }
            },
            {
                "function": {
                    "name": "navigate",
                    "arguments": {
                        "href": "/company/new",
                        "seedPrompt": "Lyca",
                    },
                }
            },
        ],
        mod="contact",
        pathname="/contact/new",
        user_text="lyca",
        current_draft={},
    )
    assert r["ok"]
    assert not r.get("patch")
    hrefs = [
        str((t.get("args") or {}).get("href") or "")
        for t in (r.get("toolProposals") or [])
        if t.get("name") == "navigate"
    ]
    assert "/company/new" in hrefs


def test_contact_list_filter_args_survive_workspace_mapping():
    r = map_tool_calls_to_result(
        "I've filtered the list to contacts created on 23 August 2026.",
        [
            {
                "function": {
                    "name": "set_workspace",
                    "arguments": {
                        "mode": "list",
                        "createdOn": "2026-08-23",
                        "location": "Bangalore",
                        "leadSource": "worktual",
                        "owner": "Daniel",
                        "leadStatus": "qualified",
                        "company": "Amazon",
                        "email": "a@worktual.com",
                        "phone": "919900000000",
                    },
                }
            }
        ],
        mod="contact",
        pathname="/contact",
        user_text="filter contacts created august 23 in bangalore",
    )
    assert r["ok"]
    props = r.get("toolProposals") or []
    workspace = [t for t in props if t.get("name") == "set_workspace"]
    assert workspace
    args = workspace[0].get("args") or {}
    assert args.get("mode") == "list"
    assert args.get("createdOn") == "2026-08-23"
    assert args.get("location") == "Bangalore"
    assert args.get("leadSource") == "worktual"
    assert args.get("owner") == "Daniel"
    assert args.get("leadStatus") == "qualified"
    assert args.get("company") == "Amazon"
    assert args.get("email") == "a@worktual.com"
    assert args.get("phone") == "919900000000"

