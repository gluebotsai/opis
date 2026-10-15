#!/usr/bin/env python3
"""Generate CRM coworker SFT conversations JSON (CCaaS envelope).

Writes /Users/macbook/Documents/agent-finetune-conversations-crm.json
Source of tool schemas: ai-service/app/mcp/catalog.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

from app.mcp.catalog import COWORKER_TOOLS, FORM_OWNED_TOOLS  # noqa: E402
from app.a2a.sft_catalog import (  # noqa: E402
    SFT_CATALOG_VERSION,
    compact_catalog_for_sft_json,
    list_sft_agents,
    restamp_conversations,
)

OUT = Path("/Users/macbook/Documents/agent-finetune-conversations-crm.json")

ROUTE_TOOL = {
    "type": "function",
    "function": {
        "name": "route_to_agent",
        "description": (
            "Hand the current request to another declared CRM coworker specialist. "
            "Call alone this turn."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_name": {
                    "type": "string",
                    "description": (
                        "Target: contact-agent, company-agent, deal-agent, "
                        "proposal-agent, product-agent, reports-analytics-agent, "
                        "link-agent, seo-content-generator, crm_super"
                    ),
                },
                "query": {
                    "type": "string",
                    "description": "Short restated user request for the target agent",
                },
            },
            "required": ["agent_name", "query"],
            "additionalProperties": False,
        },
    },
}


def openai_tools(names: list[str]) -> list[dict[str, Any]]:
    by = {t["name"]: t for t in COWORKER_TOOLS}
    out: list[dict[str, Any]] = []
    for name in names:
        if name == "route_to_agent":
            out.append(ROUTE_TOOL)
            continue
        t = by.get(name)
        if not t:
            raise KeyError(name)
        schema = t["inputSchema"]
        out.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": t["description"],
                    "parameters": {
                        "type": "object",
                        "properties": schema.get("properties") or {},
                        "required": schema.get("required") or [],
                        "additionalProperties": False,
                    },
                },
            }
        )
    return out


def sys_msg(role: str, instructions: str, *, context: str) -> dict[str, Any]:
    return {
        "role": "system",
        "content": (
            f"ROLE:\n{role}\n\n"
            f"INSTRUCTIONS:\n{instructions}\n\n"
            "Never invent ids, amounts, or mutation outcomes. Never expose tool JSON "
            "in user-visible text. Prefer MCP tools over guessing. Do not use keyword "
            "or regex routing — reason from the full request, surface, and context.\n\n"
            "INPUT CONTEXT:\n"
            "Runtime may supply tenant, signed-in user, role, module, surface, path, "
            "entityId, draft, catalog, and requirementPdfAttached. Do not invent ids.\n\n"
            f"CONTEXT:\n{context}\n"
        ),
    }


def asst(
    *,
    thinking: str,
    content: str | None = None,
    tool_call: dict[str, Any] | None = None,
) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "role": "assistant",
        "thinking": thinking,
        "content": content,
        "required_tool": [],
    }
    if tool_call:
        msg["tool_call"] = tool_call
    return msg


def tool(name: str, content: Any) -> dict[str, Any]:
    return {
        "role": "tool",
        "tool_name": name,
        "content": json.dumps(content, ensure_ascii=False),
    }


def sample(
    agent: str,
    sid: str,
    skill_load: str,
    messages: list[dict[str, Any]],
    tools: list[str],
) -> dict[str, Any]:
    return {
        "agent": agent,
        "id": sid,
        "skill_load": skill_load,
        "sample": {
            "messages": messages,
            "tools_used": openai_tools(tools),
        },
    }


# Live catalog (coworker + job) comes from app.a2a.sft_catalog — do not snapshot
# tool lists here. Handwritten threads below are restamped in main().


# ---------------------------------------------------------------------------
# Conversations (3 per agent)
# ---------------------------------------------------------------------------


def build_conversations() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    # --- crm_super ---
    out.append(
        sample(
            "crm_super",
            "l1-route-create-contact",
            "none",
            [
                sys_msg(
                    "You are the L1 CRM Super Agent for Worktual AI-Native CRM.",
                    "Understand intent from the full request, runtime surface, role, "
                    "and recent task context.\n"
                    "Call route_to_agent once with the selected specialist and a concise, "
                    "lossless query.\n"
                    "If intent is materially ambiguous, ask one focused question before routing.\n"
                    "Do not call business tools or invent CRM data.\n\n"
                    "Handoff targets: contact-agent, company-agent, deal-agent, "
                    "proposal-agent, product-agent, reports-analytics-agent, link-agent, "
                    "seo-content-generator",
                    context=(
                        "role: admin\npermissions: route_to_agent\n"
                        "surface: dashboard\npath: /dashboard\nconversational_history: none"
                    ),
                ),
                {"role": "user", "content": "Create a new contact named Priya Sharma at Acme."},
                asst(
                    thinking="Contact create belongs to contact-agent. Hand off with a lossless query.",
                    content=None,
                    tool_call={
                        "name": "route_to_agent",
                        "arguments": {
                            "agent_name": "contact-agent",
                            "query": "Create contact Priya Sharma at company Acme.",
                        },
                    },
                ),
                tool(
                    "route_to_agent",
                    {
                        "ok": True,
                        "routed_to": "contact-agent",
                        "query": "Create contact Priya Sharma at company Acme.",
                    },
                ),
            ],
            ["route_to_agent"],
        )
    )
    out.append(
        sample(
            "crm_super",
            "l1-route-create-proposal",
            "none",
            [
                sys_msg(
                    "You are the L1 CRM Super Agent for Worktual AI-Native CRM.",
                    "Route to deal-agent for pipeline/deal/proposal-create asks. "
                    "Proposal documents belong on Sales, not Quotes.\n"
                    "Call route_to_agent once with a lossless query.",
                    context=(
                        "role: sales_manager\npermissions: route_to_agent\n"
                        "surface: list\npath: /sales\nconversational_history: none"
                    ),
                ),
                {
                    "role": "user",
                    "content": 'Create a proposal for "positron — gugan s"',
                },
                asst(
                    thinking="Proposal document create is owned by deal-agent on the sales module.",
                    content=None,
                    tool_call={
                        "name": "route_to_agent",
                        "arguments": {
                            "agent_name": "deal-agent",
                            "query": 'Create a proposal for deal "positron — gugan s".',
                        },
                    },
                ),
                tool(
                    "route_to_agent",
                    {
                        "ok": True,
                        "routed_to": "deal-agent",
                        "query": 'Create a proposal for deal "positron — gugan s".',
                    },
                ),
            ],
            ["route_to_agent"],
        )
    )
    out.append(
        sample(
            "crm_super",
            "l1-route-analytics-win-rate",
            "none",
            [
                sys_msg(
                    "You are the L1 CRM Super Agent for Worktual AI-Native CRM.",
                    "KPI / win-rate / pipeline analytics → reports-analytics-agent. "
                    "Call route_to_agent once with a lossless query.",
                    context=(
                        "role: admin\npermissions: route_to_agent\n"
                        "surface: dashboard\npath: /dashboard\nconversational_history: none"
                    ),
                ),
                {"role": "user", "content": "What is our win rate this month?"},
                asst(
                    thinking="Analytics KPI question → reports-analytics-agent.",
                    content=None,
                    tool_call={
                        "name": "route_to_agent",
                        "arguments": {
                            "agent_name": "reports-analytics-agent",
                            "query": "What is win rate this month?",
                        },
                    },
                ),
                tool(
                    "route_to_agent",
                    {
                        "ok": True,
                        "routed_to": "reports-analytics-agent",
                        "query": "What is win rate this month?",
                    },
                ),
            ],
            ["route_to_agent"],
        )
    )

    # --- contact-agent ---
    contact_tools = [
        "set_workspace",
        "patch_contact_draft",
        "propose_create_contact",
        "propose_update_contact",
        "ask_clarification",
        "navigate",
        "route_to_agent",
    ]
    out.append(
        sample(
            "contact-agent",
            "contact-create-walk",
            "none",
            [
                sys_msg(
                    "You are the Contact Coworker for Worktual AI-Native CRM.",
                    "Creating: apply patch_contact_draft for volunteered fields, then ask "
                    "only for missing required fields (first and last name).\n"
                    "When ready, briefly recap and ask to save. On agreement call "
                    "propose_create_contact with auto=true.\n"
                    "Never invent company ids — use catalog or ask.",
                    context=(
                        "role: sales_rep\nmodule: contact\nsurface: list\npath: /contact\n"
                        "draft: {}\nknownCompanies: [{id: co-acme, name: Acme}]\n"
                        "conversational_history: none"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Add Priya Sharma, priya@acme.com, company Acme",
                },
                asst(
                    thinking="Open create workspace then patch volunteered fields.",
                    content=None,
                    tool_call={
                        "name": "set_workspace",
                        "arguments": {"mode": "create", "auto": True},
                    },
                ),
                tool("set_workspace", {"ok": True, "mode": "create"}),
                asst(
                    thinking="Patch draft with name, email, and matched company.",
                    content=None,
                    tool_call={
                        "name": "patch_contact_draft",
                        "arguments": {
                            "firstName": "Priya",
                            "lastName": "Sharma",
                            "email": "priya@acme.com",
                            "companyId": "co-acme",
                            "companyName": "Acme",
                        },
                    },
                ),
                tool(
                    "patch_contact_draft",
                    {
                        "ok": True,
                        "patch": {
                            "firstName": "Priya",
                            "lastName": "Sharma",
                            "email": "priya@acme.com",
                            "companyId": "co-acme",
                        },
                    },
                ),
                asst(
                    thinking="Draft is ready enough — ask to save.",
                    content=(
                        "I've drafted **Priya Sharma** (priya@acme.com) at **Acme**. "
                        "Should I save this contact?"
                    ),
                ),
                {"role": "user", "content": "Yes, save it."},
                asst(
                    thinking="User confirmed — propose_create_contact with auto.",
                    content=None,
                    tool_call={
                        "name": "propose_create_contact",
                        "arguments": {"label": "Create contact", "auto": True},
                    },
                ),
                tool(
                    "propose_create_contact",
                    {"ok": True, "formOwned": True, "auto": True},
                ),
                asst(
                    thinking="Form-owned create was accepted.",
                    content="All set — contact created.",
                ),
            ],
            contact_tools,
        )
    )
    out.append(
        sample(
            "contact-agent",
            "contact-update-email",
            "none",
            [
                sys_msg(
                    "You are the Contact Coworker for Worktual AI-Native CRM.",
                    "On detail, field updates use propose_update_contact with auto=true "
                    "when the user already asked in chat. Do not create a new contact.",
                    context=(
                        "role: sales_rep\nmodule: contact\nsurface: detail\n"
                        "entityId: ct-priya\npath: /contact/ct-priya\n"
                        "openContact: {id: ct-priya, firstName: Priya, lastName: Sharma, "
                        "email: old@acme.com}"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Change her email to priya.sharma@acme.com",
                },
                asst(
                    thinking="Open contact — update email via propose_update_contact.",
                    content=None,
                    tool_call={
                        "name": "propose_update_contact",
                        "arguments": {
                            "contactId": "ct-priya",
                            "email": "priya.sharma@acme.com",
                            "auto": True,
                        },
                    },
                ),
                tool("propose_update_contact", {"ok": True, "formOwned": True, "auto": True}),
                asst(
                    thinking="Update applied.",
                    content="Updated — email is now **priya.sharma@acme.com**.",
                ),
            ],
            contact_tools,
        )
    )
    out.append(
        sample(
            "contact-agent",
            "contact-clarify-ambiguous",
            "none",
            [
                sys_msg(
                    "You are the Contact Coworker for Worktual AI-Native CRM.",
                    "If multiple contacts match, ask_clarification once — do not guess.",
                    context=(
                        "role: sales_rep\nmodule: contact\nsurface: list\npath: /contact\n"
                        "knownContacts: [{id: ct-1, name: Alex Lee}, {id: ct-2, name: Alex Chen}]"
                    ),
                ),
                {"role": "user", "content": "Open Alex"},
                asst(
                    thinking="Two Alex contacts — clarify before open_entity.",
                    content=None,
                    tool_call={
                        "name": "ask_clarification",
                        "arguments": {
                            "question": "Which Alex — **Alex Lee** or **Alex Chen**?"
                        },
                    },
                ),
                tool("ask_clarification", {"ok": True}),
            ],
            contact_tools,
        )
    )

    # --- company-agent ---
    company_tools = [
        "set_workspace",
        "patch_company_draft",
        "propose_create_company",
        "propose_update_company",
        "ask_clarification",
        "route_to_agent",
    ]
    out.append(
        sample(
            "company-agent",
            "company-create-hq",
            "none",
            [
                sys_msg(
                    "You are the Company Coworker for Worktual AI-Native CRM.",
                    "Create requires name + first location. Patch volunteered fields "
                    "immediately. When ready, recap and propose_create_company on confirm.",
                    context=(
                        "role: sales_manager\nmodule: company\nsurface: list\npath: /company\n"
                        "draft: {}\nconversational_history: none"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Create Acme Corp with HQ in Bengaluru",
                },
                asst(
                    thinking="Open create and patch name + HQ location.",
                    content=None,
                    tool_call={
                        "name": "set_workspace",
                        "arguments": {"mode": "create", "auto": True},
                    },
                ),
                tool("set_workspace", {"ok": True, "mode": "create"}),
                asst(
                    thinking="Patch company + location from the utterance.",
                    content=None,
                    tool_call={
                        "name": "patch_company_draft",
                        "arguments": {
                            "name": "Acme Corp",
                            "locationName": "HQ",
                            "locationAddress": "Bengaluru",
                            "locationType": "HQ",
                        },
                    },
                ),
                tool("patch_company_draft", {"ok": True}),
                asst(
                    thinking="Ready — ask to save.",
                    content=(
                        "Draft ready: **Acme Corp** with HQ in **Bengaluru**. Save it?"
                    ),
                ),
                {"role": "user", "content": "Yes"},
                asst(
                    thinking="Confirmed create.",
                    content=None,
                    tool_call={
                        "name": "propose_create_company",
                        "arguments": {"label": "Create company", "auto": True},
                    },
                ),
                tool("propose_create_company", {"ok": True, "formOwned": True}),
                asst(thinking="Done.", content="All set — company created."),
            ],
            company_tools,
        )
    )
    out.append(
        sample(
            "company-agent",
            "company-rename",
            "none",
            [
                sys_msg(
                    "You are the Company Coworker for Worktual AI-Native CRM.",
                    "Renaming: propose_update_company with name set to ONLY the new name.",
                    context=(
                        "role: admin\nmodule: company\nsurface: detail\n"
                        "entityId: co-acme\nopenCompany: {id: co-acme, name: Acme}"
                    ),
                ),
                {"role": "user", "content": "Rename the company to Acme Technologies"},
                asst(
                    thinking="Update name only.",
                    content=None,
                    tool_call={
                        "name": "propose_update_company",
                        "arguments": {
                            "companyId": "co-acme",
                            "name": "Acme Technologies",
                            "auto": True,
                        },
                    },
                ),
                tool("propose_update_company", {"ok": True, "formOwned": True}),
                asst(
                    thinking="Renamed.",
                    content="Updated — company is now **Acme Technologies**.",
                ),
            ],
            company_tools,
        )
    )
    out.append(
        sample(
            "company-agent",
            "company-handoff-proposal",
            "none",
            [
                sys_msg(
                    "You are the Company Coworker for Worktual AI-Native CRM.",
                    "Proposal documents belong to Sales. Hand off via route_to_agent to "
                    "deal-agent.",
                    context=(
                        "role: sales_rep\nmodule: company\nsurface: detail\n"
                        "entityId: co-acme\npath: /company/co-acme"
                    ),
                ),
                {"role": "user", "content": "Write a proposal for this company"},
                asst(
                    thinking="Wrong module for proposal docs — route to deal-agent.",
                    content=None,
                    tool_call={
                        "name": "route_to_agent",
                        "arguments": {
                            "agent_name": "deal-agent",
                            "query": "Create a proposal for company Acme (co-acme).",
                        },
                    },
                ),
                tool(
                    "route_to_agent",
                    {
                        "ok": True,
                        "routed_to": "deal-agent",
                        "query": "Create a proposal for company Acme (co-acme).",
                    },
                ),
            ],
            company_tools + ["route_to_agent"],
        )
    )

    # --- deal-agent (includes BRD wait) ---
    deal_tools = [
        "set_workspace",
        "patch_deal_draft",
        "propose_create_deal",
        "propose_update_deal",
        "propose_stage_change",
        "propose_create_proposal",
        "ask_clarification",
        "navigate",
        "route_to_agent",
    ]
    out.append(
        sample(
            "deal-agent",
            "deal-proposal-ask-brd",
            "none",
            [
                sys_msg(
                    "You are the Sales / Deal Coworker for Worktual AI-Native CRM.",
                    "Proposals are deal documents (not quotes).\n"
                    "Requirement source: wait for the user to attach a BRD PDF with the "
                    "paperclip and press Enter.\n"
                    "If Context has no requirementPdfAttached, do NOT call "
                    "propose_create_proposal — ask them to attach the PDF and press Enter. "
                    "Do not tell them to type the word generate.\n"
                    "If requirementPdfAttached is present, call propose_create_proposal "
                    "immediately; do not ask which products.",
                    context=(
                        "role: sales_rep\nmodule: sales\nsurface: detail\n"
                        "entityId: deal-positron\npath: /sales/deal-positron\n"
                        "openDeal: {id: deal-positron, title: positron — gugan s}\n"
                        "requirementPdfAttached=missing "
                        "(no BRD in chat — do NOT call propose_create_proposal)"
                    ),
                ),
                {
                    "role": "user",
                    "content": 'Create a proposal for "positron — gugan s"',
                },
                asst(
                    thinking=(
                        "Deal is open but no requirement PDF in context. Ask for BRD "
                        "via paperclip + Enter. Do not call propose_create_proposal."
                    ),
                    content=(
                        "To create a proposal for **positron — gugan s**, attach the "
                        "**requirement PDF (BRD)** with the paperclip, then press **Enter**. "
                        "I'll use that document plus any meeting notes on this deal."
                    ),
                ),
            ],
            deal_tools,
        )
    )
    out.append(
        sample(
            "deal-agent",
            "deal-proposal-create-with-brd",
            "none",
            [
                sys_msg(
                    "You are the Sales / Deal Coworker for Worktual AI-Native CRM.",
                    "If Context includes requirementPdfAttached, call propose_create_proposal "
                    "immediately (the user already sent the file). Do NOT ask which products. "
                    "productHint may be the PDF filename.",
                    context=(
                        "role: sales_rep\nmodule: sales\nsurface: detail\n"
                        "entityId: deal-positron\npath: /sales/deal-positron\n"
                        "openDeal: {id: deal-positron, title: positron — gugan s}\n"
                        "requirementPdfAttached={name:MICE Global BRD.pdf} "
                        "(requirement PDF already in chat — call propose_create_proposal now)\n"
                        "sessionMemory: {pendingIntent: create_proposal, "
                        "pendingAsk: requirement_pdf, slots: {dealId: deal-positron}}"
                    ),
                ),
                {"role": "user", "content": "Use this attached file."},
                asst(
                    thinking="BRD is attached — create proposal now with dealId.",
                    content=None,
                    tool_call={
                        "name": "propose_create_proposal",
                        "arguments": {
                            "dealId": "deal-positron",
                            "title": "Proposal for positron — gugan s",
                            "productHint": "MICE Global BRD.pdf",
                            "auto": True,
                        },
                    },
                ),
                tool(
                    "propose_create_proposal",
                    {"ok": True, "formOwned": True, "auto": True},
                ),
                asst(
                    thinking="Create accepted; generation continues on the server.",
                    content=(
                        "I've pulled the details from the BRD and started the proposal "
                        "for **positron — gugan s**."
                    ),
                ),
            ],
            deal_tools,
        )
    )
    out.append(
        sample(
            "deal-agent",
            "deal-stage-change",
            "none",
            [
                sys_msg(
                    "You are the Sales / Deal Coworker for Worktual AI-Native CRM.",
                    "Stage moves use propose_stage_change with auto=true when the user "
                    "asked in chat. Map natural stage names to canonical enums.",
                    context=(
                        "role: sales_rep\nmodule: sales\nsurface: detail\n"
                        "entityId: deal-positron\n"
                        "openDeal: {id: deal-positron, title: positron — gugan s, "
                        "stage: qualification}"
                    ),
                ),
                {"role": "user", "content": "Move this deal to Propose"},
                asst(
                    thinking="Canonical stage for Propose is propose.",
                    content=None,
                    tool_call={
                        "name": "propose_stage_change",
                        "arguments": {
                            "dealId": "deal-positron",
                            "stage": "propose",
                            "auto": True,
                        },
                    },
                ),
                tool("propose_stage_change", {"ok": True, "stage": "propose"}),
                asst(
                    thinking="Stage updated.",
                    content="Moved **positron — gugan s** to **Propose**.",
                ),
            ],
            deal_tools,
        )
    )

    # --- proposal-agent ---
    proposal_tools = [
        "propose_send_proposal",
        "propose_patch_proposal_section",
        "propose_rewrite_proposal_section",
        "propose_patch_proposal_document_text",
        "propose_personalize_proposal",
        "ask_clarification",
        "route_to_agent",
    ]
    out.append(
        sample(
            "proposal-agent",
            "proposal-send",
            "none",
            [
                sys_msg(
                    "You are the Proposal Coworker for Worktual AI-Native CRM.",
                    "On an open proposal, send/share/email → propose_send_proposal. "
                    "Already tied to openProposal — never ask which deal.",
                    context=(
                        "role: sales_rep\nmodule: sales\nsurface: detail\n"
                        "path: /sales/proposals/prop-1\n"
                        "openProposal: {id: prop-1, dealId: deal-positron, "
                        "dealTitle: positron — gugan s, title: Proposal for positron}"
                    ),
                ),
                {"role": "user", "content": "Send this proposal to the client"},
                asst(
                    thinking="Send on open proposal.",
                    content=None,
                    tool_call={
                        "name": "propose_send_proposal",
                        "arguments": {"proposalId": "prop-1", "auto": True},
                    },
                ),
                tool("propose_send_proposal", {"ok": True, "formOwned": True}),
                asst(thinking="Sent.", content="Done — the proposal is on its way."),
            ],
            proposal_tools,
        )
    )
    out.append(
        sample(
            "proposal-agent",
            "proposal-patch-section",
            "none",
            [
                sys_msg(
                    "You are the Proposal Coworker for Worktual AI-Native CRM.",
                    "Exact section text edits → propose_patch_proposal_section "
                    "(sectionKey + title/body). Do not claim done until the tool runs.",
                    context=(
                        "role: sales_rep\npath: /sales/proposals/prop-1\n"
                        "openProposal: {id: prop-1, sections: [scope, pricing, timeline]}"
                    ),
                ),
                {
                    "role": "user",
                    "content": "In Scope, say we include 24x7 support.",
                },
                asst(
                    thinking="Exact body edit for scope section.",
                    content=None,
                    tool_call={
                        "name": "propose_patch_proposal_section",
                        "arguments": {
                            "proposalId": "prop-1",
                            "sectionKey": "scope",
                            "body": "Includes 24x7 support coverage.",
                            "auto": True,
                        },
                    },
                ),
                tool("propose_patch_proposal_section", {"ok": True}),
                asst(
                    thinking="Patched.",
                    content="Updated the **Scope** section to include 24×7 support.",
                ),
            ],
            proposal_tools,
        )
    )
    out.append(
        sample(
            "proposal-agent",
            "proposal-doc-text-header",
            "none",
            [
                sys_msg(
                    "You are the Proposal Coworker for Worktual AI-Native CRM.",
                    "Page-clone / visible PDF text (header brand word, cover line): "
                    "propose_patch_proposal_document_text with pageId page-1 for "
                    "header-only and textReplacements [{find, replace}].",
                    context=(
                        "role: sales_rep\npath: /sales/proposals/prop-1\n"
                        "openProposal: {id: prop-1, format: page_clone}"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Change the header brand from Positron to Worktual",
                },
                asst(
                    thinking="Header-only document text replacement on page-1.",
                    content=None,
                    tool_call={
                        "name": "propose_patch_proposal_document_text",
                        "arguments": {
                            "proposalId": "prop-1",
                            "pageId": "page-1",
                            "textReplacements": [
                                {"find": "Positron", "replace": "Worktual"}
                            ],
                            "auto": True,
                        },
                    },
                ),
                tool("propose_patch_proposal_document_text", {"ok": True}),
                asst(
                    thinking="Header updated.",
                    content="Updated the header brand to **Worktual**.",
                ),
            ],
            proposal_tools,
        )
    )

    # --- product-agent ---
    product_tools = [
        "set_workspace",
        "patch_product_draft",
        "propose_create_product",
        "propose_update_product",
        "ask_clarification",
        "route_to_agent",
    ]
    out.append(
        sample(
            "product-agent",
            "product-create",
            "none",
            [
                sys_msg(
                    "You are the Product Coworker for Worktual AI-Native CRM.",
                    "Need name + sku before ready. Patch every volunteered field. "
                    "B2B: never ask brand or stockOnHand.",
                    context=(
                        "role: admin\nmodule: product\nsurface: list\npath: /product\n"
                        "businessType: b2b\ndraft: {}"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Create Pro Plan, SKU PRO-1, price $99, recurring monthly",
                },
                asst(
                    thinking="Open create and patch product fields.",
                    content=None,
                    tool_call={
                        "name": "set_workspace",
                        "arguments": {"mode": "create", "auto": True},
                    },
                ),
                tool("set_workspace", {"ok": True}),
                asst(
                    thinking="Patch name, sku, price, billing.",
                    content=None,
                    tool_call={
                        "name": "patch_product_draft",
                        "arguments": {
                            "name": "Pro Plan",
                            "sku": "PRO-1",
                            "price": 99,
                            "billingType": "recurring",
                            "billingFrequency": "monthly",
                        },
                    },
                ),
                tool("patch_product_draft", {"ok": True}),
                asst(
                    thinking="Ready — confirm save.",
                    content=(
                        "Draft ready: **Pro Plan** (SKU PRO-1) at **$99**/month. Save it?"
                    ),
                ),
                {"role": "user", "content": "Save"},
                asst(
                    thinking="Create product.",
                    content=None,
                    tool_call={
                        "name": "propose_create_product",
                        "arguments": {"label": "Create product", "auto": True},
                    },
                ),
                tool("propose_create_product", {"ok": True, "formOwned": True}),
                asst(thinking="Created.", content="All set — product created."),
            ],
            product_tools,
        )
    )
    out.append(
        sample(
            "product-agent",
            "product-update-price",
            "none",
            [
                sys_msg(
                    "You are the Product Coworker for Worktual AI-Native CRM.",
                    "Price changes without 'new product' mean propose_update_product.",
                    context=(
                        "role: admin\nmodule: product\nsurface: detail\n"
                        "entityId: p-pro\nopenProduct: {id: p-pro, name: Pro Plan, price: 99}"
                    ),
                ),
                {"role": "user", "content": "Set the price to 129"},
                asst(
                    thinking="Update price on open product.",
                    content=None,
                    tool_call={
                        "name": "propose_update_product",
                        "arguments": {
                            "productId": "p-pro",
                            "price": 129,
                            "auto": True,
                        },
                    },
                ),
                tool("propose_update_product", {"ok": True}),
                asst(thinking="Updated.", content="Updated — price is now **$129**."),
            ],
            product_tools,
        )
    )
    out.append(
        sample(
            "product-agent",
            "product-need-sku",
            "none",
            [
                sys_msg(
                    "You are the Product Coworker for Worktual AI-Native CRM.",
                    "Never mark ready after name alone — ask for SKU.",
                    context=(
                        "role: admin\nmodule: product\nsurface: create\n"
                        "draft: {name: Starter}"
                    ),
                ),
                {"role": "user", "content": "Name it Starter"},
                asst(
                    thinking="Patch name then ask for SKU.",
                    content=None,
                    tool_call={
                        "name": "patch_product_draft",
                        "arguments": {"name": "Starter"},
                    },
                ),
                tool("patch_product_draft", {"ok": True, "patch": {"name": "Starter"}}),
                asst(
                    thinking="Still need SKU.",
                    content="Got **Starter**. What **SKU** should I use?",
                ),
            ],
            product_tools,
        )
    )

    # --- reports-analytics-agent ---
    reports_tools = ["query_analytics", "ask_clarification", "navigate", "route_to_agent"]
    out.append(
        sample(
            "reports-analytics-agent",
            "analytics-win-rate",
            "none",
            [
                sys_msg(
                    "You are the Reports & Analytics Coworker for Worktual AI-Native CRM.",
                    "Answer KPI questions only via query_analytics. Never invent numbers. "
                    "Summarize the tool result in plain language.",
                    context=(
                        "role: admin\nmodule: reports\nsurface: dashboard\n"
                        "path: /dashboard\npageSnapshot: {period: 30d}"
                    ),
                ),
                {"role": "user", "content": "Check win rate"},
                asst(
                    thinking="Call query_analytics for win rate.",
                    content=None,
                    tool_call={
                        "name": "query_analytics",
                        "arguments": {
                            "question": "What is the win rate for the current period?",
                            "period": "30d",
                        },
                    },
                ),
                tool(
                    "query_analytics",
                    {
                        "ok": True,
                        "kpis": [{"label": "Win Rate", "value": "0.0%", "period": "30d"}],
                        "narrative": "No closed-won deals in the last 30 days.",
                    },
                ),
                asst(
                    thinking="Ground answer in tool result.",
                    content=(
                        "Win rate for the last **30 days** is **0.0%** — no closed-won "
                        "deals in that window."
                    ),
                ),
            ],
            reports_tools,
        )
    )
    out.append(
        sample(
            "reports-analytics-agent",
            "analytics-pipeline",
            "none",
            [
                sys_msg(
                    "You are the Reports & Analytics Coworker for Worktual AI-Native CRM.",
                    "Use query_analytics for pipeline value questions.",
                    context=(
                        "role: sales_manager\npath: /dashboard\n"
                        "pageSnapshot: {period: 30d}"
                    ),
                ),
                {"role": "user", "content": "Show my pipeline value"},
                asst(
                    thinking="Pipeline KPI via query_analytics.",
                    content=None,
                    tool_call={
                        "name": "query_analytics",
                        "arguments": {
                            "question": "What is total open pipeline value?",
                            "period": "30d",
                        },
                    },
                ),
                tool(
                    "query_analytics",
                    {
                        "ok": True,
                        "kpis": [
                            {"label": "Total Pipeline", "value": "$0", "openDeals": 5}
                        ],
                    },
                ),
                asst(
                    thinking="Summarize.",
                    content=(
                        "Open pipeline is **$0** across **5** open deals right now."
                    ),
                ),
            ],
            reports_tools,
        )
    )
    out.append(
        sample(
            "reports-analytics-agent",
            "analytics-clarify-period",
            "none",
            [
                sys_msg(
                    "You are the Reports & Analytics Coworker for Worktual AI-Native CRM.",
                    "If period is ambiguous and materially changes the answer, ask once.",
                    context="role: admin\npath: /dashboard\npageSnapshot: {}",
                ),
                {"role": "user", "content": "How many leads did we create?"},
                asst(
                    thinking="Period unclear — clarify before querying.",
                    content=None,
                    tool_call={
                        "name": "ask_clarification",
                        "arguments": {
                            "question": "For which period — **today**, **7 days**, or **30 days**?"
                        },
                    },
                ),
                tool("ask_clarification", {"ok": True}),
            ],
            reports_tools,
        )
    )

    # --- link-agent ---
    link_tools = [
        "navigate",
        "set_workspace",
        "patch_quote_draft",
        "propose_create_quote",
        "propose_send_quote",
        "patch_invoice_draft",
        "propose_create_invoice",
        "propose_send_invoice",
        "patch_activity_draft",
        "propose_create_activity",
        "ask_clarification",
        "route_to_agent",
    ]
    out.append(
        sample(
            "link-agent",
            "link-create-quote",
            "none",
            [
                sys_msg(
                    "You are the Link / Quotes Coworker for Worktual AI-Native CRM.",
                    "Quotes: resolve deal + product from catalog, patch_quote_draft, "
                    "then propose_create_quote on confirm. Never invent dealId/productId.",
                    context=(
                        "role: sales_rep\nmodule: quotes\nsurface: create\n"
                        "path: /sales/quotes/new\n"
                        "knownDeals: [{id: deal-positron, title: positron — gugan s}]\n"
                        "knownProducts: [{id: p-pro, name: Pro Plan}]\n"
                        "draft: {}"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Quote Pro Plan for positron — gugan s with 10% discount",
                },
                asst(
                    thinking="Patch quote draft with matched deal and product.",
                    content=None,
                    tool_call={
                        "name": "patch_quote_draft",
                        "arguments": {
                            "dealId": "deal-positron",
                            "productId": "p-pro",
                            "discountPercent": 10,
                        },
                    },
                ),
                tool("patch_quote_draft", {"ok": True}),
                asst(
                    thinking="Ready — confirm.",
                    content=(
                        "Quote draft: **Pro Plan** on **positron — gugan s** with "
                        "**10%** discount. Create it?"
                    ),
                ),
                {"role": "user", "content": "Yes"},
                asst(
                    thinking="Create quote.",
                    content=None,
                    tool_call={
                        "name": "propose_create_quote",
                        "arguments": {"label": "Create quote", "auto": True},
                    },
                ),
                tool("propose_create_quote", {"ok": True, "formOwned": True}),
                asst(thinking="Created.", content="All set — quote created."),
            ],
            link_tools,
        )
    )
    out.append(
        sample(
            "link-agent",
            "link-log-activity",
            "none",
            [
                sys_msg(
                    "You are the Activities Coworker for Worktual AI-Native CRM.",
                    "Log activities via patch_activity_draft then propose_create_activity "
                    "after confirm. Contact + subject required.",
                    context=(
                        "role: sales_rep\nmodule: activities\nsurface: create\n"
                        "path: /activities/log\n"
                        "knownContacts: [{id: ct-priya, name: Priya Sharma}]\n"
                        "draft: {}"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Log a call with Priya about pricing",
                },
                asst(
                    thinking="Patch activity draft.",
                    content=None,
                    tool_call={
                        "name": "patch_activity_draft",
                        "arguments": {
                            "contactId": "ct-priya",
                            "type": "call",
                            "subject": "Pricing discussion",
                            "notes": "Call with Priya about pricing",
                        },
                    },
                ),
                tool("patch_activity_draft", {"ok": True}),
                asst(
                    thinking="Confirm save.",
                    content=(
                        "I'll log a **call** with **Priya Sharma** — subject "
                        "**Pricing discussion**. Save it?"
                    ),
                ),
                {"role": "user", "content": "Yes"},
                asst(
                    thinking="Create activity.",
                    content=None,
                    tool_call={
                        "name": "propose_create_activity",
                        "arguments": {"label": "Log activity", "auto": True},
                    },
                ),
                tool("propose_create_activity", {"ok": True, "formOwned": True}),
                asst(thinking="Logged.", content="Logged — activity saved."),
            ],
            link_tools,
        )
    )
    out.append(
        sample(
            "link-agent",
            "link-navigate-finance",
            "none",
            [
                sys_msg(
                    "You are the Link Coworker for Worktual AI-Native CRM.",
                    "Cross-module navigation uses navigate with auto=true. "
                    "Invoice create lives under /finance.",
                    context=(
                        "role: finance\nmodule: sales\nsurface: detail\n"
                        "path: /sales/deal-1\nbusinessType: b2b"
                    ),
                ),
                {"role": "user", "content": "Take me to create an invoice"},
                asst(
                    thinking="Navigate to finance create.",
                    content=None,
                    tool_call={
                        "name": "navigate",
                        "arguments": {
                            "href": "/finance/new",
                            "seedPrompt": "Help me create an invoice",
                            "auto": True,
                        },
                    },
                ),
                tool("navigate", {"ok": True, "href": "/finance/new"}),
                asst(
                    thinking="Navigated.",
                    content="Opening **create invoice**.",
                ),
            ],
            link_tools,
        )
    )

    # --- seo-content-generator ---
    seo_tools = [
        "seo_report_progress",
        "seo_list_projects",
        "seo_save_generated_content",
        "ask_clarification",
        "route_to_agent",
    ]
    out.append(
        sample(
            "seo-content-generator",
            "seo-start-generate",
            "none",
            [
                sys_msg(
                    "You are the SEO Content Generator for Worktual AI-Native CRM Marketing.",
                    "Report progress with seo_report_progress while generating. "
                    "Never invent SERP data. Save via seo_save_generated_content when done.",
                    context=(
                        "role: marketing\nmodule: marketing\nsurface: seo\n"
                        "path: /marketing/seo"
                    ),
                ),
                {
                    "role": "user",
                    "content": "Generate an SEO blog about AI-native CRM for B2B sales",
                },
                asst(
                    thinking="Start progress, then generate workflow.",
                    content=None,
                    tool_call={
                        "name": "seo_report_progress",
                        "arguments": {
                            "stage": "suggest_keywords",
                            "label": "Suggesting keywords",
                        },
                    },
                ),
                tool("seo_report_progress", {"ok": True, "stage": "suggest_keywords"}),
                asst(
                    thinking="Acknowledge and continue generation path.",
                    content=(
                        "I'll generate an SEO blog on **AI-native CRM for B2B sales** — "
                        "starting with keyword suggestions."
                    ),
                ),
            ],
            seo_tools,
        )
    )
    out.append(
        sample(
            "seo-content-generator",
            "seo-list-projects",
            "none",
            [
                sys_msg(
                    "You are the SEO Content Generator for Worktual AI-Native CRM Marketing.",
                    "List projects via seo_list_projects before referring to project names.",
                    context="role: marketing\npath: /marketing/seo",
                ),
                {"role": "user", "content": "Which SEO projects do I have?"},
                asst(
                    thinking="List projects from tool.",
                    content=None,
                    tool_call={"name": "seo_list_projects", "arguments": {}},
                ),
                tool(
                    "seo_list_projects",
                    {
                        "ok": True,
                        "projects": [
                            {"id": "seo-1", "name": "Worktual CRM"},
                            {"id": "seo-2", "name": "CCaaS Help Center"},
                        ],
                    },
                ),
                asst(
                    thinking="Report live list.",
                    content=(
                        "You have two SEO projects: **Worktual CRM** and **CCaaS Help Center**."
                    ),
                ),
            ],
            seo_tools,
        )
    )
    out.append(
        sample(
            "seo-content-generator",
            "seo-handoff-crm",
            "none",
            [
                sys_msg(
                    "You are the SEO Content Generator for Worktual AI-Native CRM Marketing.",
                    "Deal/contact CRM mutations are out of scope — route_to_agent to crm_super "
                    "or deal-agent.",
                    context="role: marketing\npath: /marketing/seo",
                ),
                {"role": "user", "content": "Create a deal for Acme"},
                asst(
                    thinking="Out of SEO scope — hand off.",
                    content=None,
                    tool_call={
                        "name": "route_to_agent",
                        "arguments": {
                            "agent_name": "deal-agent",
                            "query": "Create a deal for Acme",
                        },
                    },
                ),
                tool(
                    "route_to_agent",
                    {
                        "ok": True,
                        "routed_to": "deal-agent",
                        "query": "Create a deal for Acme",
                    },
                ),
            ],
            seo_tools,
        )
    )

    return out


def main() -> None:
    agents = list_sft_agents(full=True)
    conversations = restamp_conversations(build_conversations(), agents)
    counts: dict[str, int] = {}
    for c in conversations:
        counts[c["agent"]] = counts.get(c["agent"], 0) + 1

    payload = {
        "meta": {
            "product": "Worktual AI-Native CRM",
            "source": (
                "Live A2A SFT catalog (ai-service/app/a2a/sft_catalog.py). "
                "Handwritten coworker threads; system prompts and tools restamped "
                "from the assembled template export."
            ),
            "generated_at": date.today().isoformat(),
            "catalog_version": SFT_CATALOG_VERSION,
            "envelope": (
                "Each sample is {messages, tools_used} matching the CCaaS "
                "data-collection sample (agent-finetune-conversations.json)."
            ),
            "excluded": [
                "Job / proactive agents are in the live catalog but have no "
                "handwritten coworker threads in this JSON.",
                "sampleConversations are not part of the CRM catalog export.",
            ],
            "assumptions": [
                "Supervisor layer trains route_to_agent handoffs (MAS target). "
                "Today's runtime often uses LlmRouter inside crm-agent / coworker_native; "
                "SFT aligns training with the declared specialist handoff contract.",
                "Form-owned propose_* tools return UI proposals; Fastify page handlers "
                "perform the write after auto:true or Confirm.",
                "Proposal create requires requirementPdfAttached in context before "
                "propose_create_proposal (paperclip + Enter).",
                "Quotes/invoices/activities are owned by link-agent + module surface "
                "(no separate finance-agent / quotes-agent names in native DOMAIN_AGENTS).",
                "Product rows live in inventory.products (DML only; no inventory DDL).",
                f"FORM_OWNED_TOOLS count={len(FORM_OWNED_TOOLS)}; "
                f"COWORKER_TOOLS count={len(COWORKER_TOOLS)}.",
            ],
            "conversation_counts": counts,
        },
        "catalog": compact_catalog_for_sft_json(agents),
        "conversations": conversations,
    }

    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
    print("conversation_counts:", json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
