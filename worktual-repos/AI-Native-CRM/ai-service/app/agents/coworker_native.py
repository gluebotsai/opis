"""Opt-in native coworker supervisor backed by Redis STM and BoundedToolLoop."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.agents.coworker_shared import last_user_text, sanitize_assistant_text_for_user
from app.agents.agent_md import agent_md_path, load_agent_md
from app.agents.crm_tools import (
    DEAL_AGENT_PROMPT,
    build_system_prompt,
    coworker_messages_to_openai,
)
from app.orchestrator.mutation_gate import (
    seeded_create_navigate,
    with_leading_system_instruction as _with_leading_system,
)
from app.config import get_settings
from app.memory.factory import configured_memory_manager
from app.orchestrator.contracts import (
    AgentContext,
    AgentKind,
    AgentSpec,
    ExecutionEnvelope,
    RunError,
    RunResult,
    RunMetadata,
    ToolBudget,
)
from app.orchestrator.registry import AgentRegistry, RegisteredAgent
from app.orchestrator.router import LlmRouter
from app.orchestrator.supervisor import Supervisor
from app.orchestrator.errors import OrchestratorError
from app.orchestrator.tool_loop import BoundedToolLoop, ToolLoopResult
from app.mcp.catalog import list_tools as list_catalog_tools
from app.mcp_client import McpClient, _merge_refresh, mcp_result_to_turn_parts


DOMAIN_AGENTS = {
    "contact": "contact-agent",
    "company": "company-agent",
    "sales": "deal-agent",
    "proposal": "proposal-agent",
    "product": "product-agent",
    "finance": "finance-agent",
    "quotes": "quotes-agent",
    "reports": "reports-analytics-agent",
    "content": "seo-content-generator",
    "link": "link-agent",
}

_REPORTS_ANALYTICS_MD = load_agent_md(agent_md_path(__file__, "reports-analytics"))

SPECIALIST_INSTRUCTIONS = {
    "contact-agent": (
        "Stay within contact work; navigate or request a validated handoff for another domain. "
        "On contact detail (entityId / catalog.openContact): field changes MUST call "
        "propose_update_contact in the same turn with contactId=entityId, auto=true, and the "
        "new values — never tell the user an update worked or failed without calling that tool. "
        "Lead score is a 0-100 number and is NOT leadStatus. When the user asks to change a "
        "lead score, first collect their reason for that exact score. If no reason was given, "
        "call ask_clarification and ask why the score should change; do not propose any mutation. "
        "Once both score and user-provided reason are known, call propose_set_lead_score with "
        "contactId, score, reason, and auto=true. Never invent the reason, never pass a number "
        "as leadStatus. This tool proposes a browser-owned write, so in that same turn say only "
        "that you will apply the score and refresh the summary; do not say either one is already "
        "updated. The browser reports success or failure after the write finishes. "
        "Deletes on the open record: propose_delete_contact with contactId=entityId and auto=true. "
        "Never ask which contact when entityId is set. "
        "A secondary contact on the person you just saved, or on the open contact, "
        "is extra email or phone on that same person: propose_update_contact with "
        "secondaryEmails and/or secondaryPhones and contactId=entityId (or the id "
        "from lookup_contacts for the name just saved). Ask for the extra email or "
        "phone. Do not call the update until the user gives the new value, and never "
        "copy the existing primary email/phone into a secondary field. Do not open "
        "create and do not ask for another full name. "
        "Context openContact and openCompany are the person and employer on this page — "
        "use them; never ask which contact or which company when entityId or openCompany.id "
        "is set. Company profile → propose_update_company(companyId=openCompany.id). "
        "Company location city/address → propose_update_company_location with "
        "openCompany.id and openCompanyLocation.id. "
        "An email to this customer is compose_customer_email, then propose_save_email_draft "
        "in that same turn, as soon as you know the topic. The draft card is the preview. "
        "Do not paste the subject or body, and do not ask whether to save. "
        "When emailDraft is already open, their latest message is the only change. "
        "Copy subject, body, and to from that draft except for the part they asked to change. "
        "A wording change is compose_customer_email with currentSubject and currentBody "
        "from the draft, then propose_save_email_draft with the saved draftId. "
        "A change to recipients or the subject is propose_save_email_draft with the other "
        "fields copied. Sending is propose_send_email with the draft's subject, body, and to. "
        "Do not compose for a send. Pass to as an array of email addresses, one per item. "
        "A later time is propose_schedule_email with sendAt from now=."
    ),
    "company-agent": (
        "Stay within company/location work; navigate or request a validated handoff for another domain. "
        "On company detail (entityId / catalog.openCompany): field changes MUST call "
        "propose_update_company in the same turn with companyId=entityId, auto=true, and the "
        "new values — never tell the user an update worked or failed without calling that tool. "
        "Deletes on the open record: propose_delete_company with companyId=entityId and auto=true. "
        "Never ask which company when entityId is set. "
        "An email to a customer at this company is compose_customer_email, then "
        "propose_save_email_draft in that same turn. The draft card is the preview. "
        "Do not paste the subject or body, and do not ask whether to save. "
        "When emailDraft is already open, their latest message is the only change. "
        "Copy subject, body, and to from that draft except for the part they asked to change. "
        "A wording change is compose_customer_email with currentSubject and currentBody "
        "from the draft, then propose_save_email_draft with the saved draftId. "
        "A change to recipients or the subject is propose_save_email_draft with the other "
        "fields copied. Sending is propose_send_email with the draft's subject, body, and to. "
        "Do not compose for a send. Pass to as an array of email addresses, one per item. "
        "A later time is propose_schedule_email."
    ),
    "deal-agent": DEAL_AGENT_PROMPT,
    "proposal-agent": (
        "Handle proposal documents only; preserve all confirmation and form-owned gates. "
        "Read openProposalVisibleText. Any on-page mention the user wants changed must "
        "call a tool: propose_patch_proposal_document_text (find copied verbatim from "
        "visible text, or tableBorders true/false for table gridlines) or "
        "propose_rewrite_proposal_section (sectionKey from "
        "openProposalSections). Formatting (bullets, lists, bold, professional "
        "tone) must keep the existing copy and use '## ' subheads plus '- ' "
        "bullets — never ALL-CAPS walls of text. Do not regenerate the whole "
        "proposal for a local edit."
    ),
    "product-agent": (
        "Handle inventory product rows through existing form-owned tools only. "
        "This user already has product-module access; never claim they lack permission. "
        "For list questions, use catalog.products. "
        "On product detail (entityId / catalog.openProduct): field changes MUST call "
        "propose_update_product in the same turn with productId=entityId, auto=true — "
        "never tell the user an update worked or failed without calling that tool."
    ),
    "quotes-agent": (
        "Handle sales quotes through existing form-owned tools only. "
        "On quote detail (entityId / catalog.openQuote): notes, customer/company/vendor "
        "names, discount, and line items MUST call propose_update_quote in the same turn "
        "with quoteId=entityId, auto=true — never tell the user an update worked or failed "
        "without calling that tool. Send → propose_send_quote. Never ask which deal when "
        "entityId is set."
    ),
    "finance-agent": (
        "Handle B2B invoices through existing form-owned tools only. "
        "On invoice detail (entityId / catalog.openInvoice): notes, payment terms, "
        "discount, and line items MUST call propose_update_invoice in the same turn with "
        "invoiceId=entityId, auto=true — never tell the user an update worked or failed "
        "without calling that tool. Send → propose_send_invoice; mark paid → "
        "propose_mark_invoice_paid. Never ask which deal when entityId is set."
    ),
    "link-agent": (
        "Navigate and link modules; do not invent data or perform domain mutations. "
        "Never state CRM metrics, KPIs, percentages, pipeline values, counts, or revenue — "
        "even if catalog or page context looks informative. Analytics questions are handled "
        "only by reports-analytics-agent (warehouse KPIs). "
        "On Dashboard, reply to greetings and general chat without numbers; "
        "use navigate for cross-module moves only."
    ),
    "reports-analytics-agent": _REPORTS_ANALYTICS_MD["instructions"],
    "seo-content-generator": (
        "Digital Marketing on /marketing/seo. Talk like a marketing teammate: "
        "2–4 short sentences, point at the right tab, ask one next question. "
        "Never list volumes or mention tools, LLM estimates, Semrush, or ids "
        "unless asked how the numbers were produced. For keywords, call "
        "seo_research_keywords. For blogs, save with seo_save_generated_content "
        "using keywordQueryId. For social, call seo_repurpose_social with "
        "contentId (do not ask for a seed). Publish via seo_publish_post; "
        "missing Accounts tokens return connect/reauth."
    ),
}

CONTENT_GENERATOR_TOOLS = frozenset(
    {
        "seo_report_progress",
        "seo_research_keywords",
        "seo_save_generated_content",
        "seo_list_generated_content",
        "seo_get_generated_content",
        "seo_repurpose_social",
        "seo_list_social_posts",
        "seo_schedule_post",
        "seo_publish_post",
        "ask_clarification",
        "remember_memory",
        "clear_memory",
    }
)


def is_seo_content_page(context: dict[str, Any] | None) -> bool:
    ctx = context or {}
    pathname = str(ctx.get("pathname") or "")
    if pathname.startswith("/marketing/seo"):
        return True
    return bool(ctx.get("contentAgent"))


def _domain_for(context: dict[str, Any], catalog: dict[str, Any]) -> str:
    """Page/surface domain only. User-text routing is the LLM supervisor."""
    module = str(context.get("module") or "").lower()
    pathname = str(context.get("pathname") or "")
    if is_seo_content_page(context):
        return "content"
    if module == "sales" and (
        catalog.get("openProposal")
        or pathname.startswith("/sales/proposals/")
    ):
        return "proposal"
    if module in {
        "contact",
        "company",
        "sales",
        "product",
        "finance",
        "quotes",
        "reports",
    }:
        return module
    return "link"


def _eligible_specialist_names(domain: str) -> set[str]:
    """Candidates for the LLM router. Reports is always eligible except SEO."""
    if domain == "content":
        return {DOMAIN_AGENTS["content"]}
    return {DOMAIN_AGENTS[domain], DOMAIN_AGENTS["link"], DOMAIN_AGENTS["reports"]}


def _module_for_agent(agent_name: str, context: dict[str, Any]) -> str:
    return {
        "contact-agent": "contact",
        "company-agent": "company",
        "deal-agent": "sales",
        "proposal-agent": "sales",
        "product-agent": "product",
        "finance-agent": "finance",
        "quotes-agent": "quotes",
        "reports-analytics-agent": "reports",
        "seo-content-generator": "marketing",
    }.get(agent_name, str(context.get("module") or "dashboard").lower())


def reports_context_for_handoff(
    memory: dict[str, Any] | None,
    browser_memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Read the reports slot from flat MAS memory; authoritative memory wins."""
    merged = {
        **(browser_memory if isinstance(browser_memory, dict) else {}),
        **(memory if isinstance(memory, dict) else {}),
    }
    slots = merged.get("slots") if isinstance(merged.get("slots"), dict) else {}
    nested = slots.get("reportsContext")
    if isinstance(nested, dict):
        return dict(nested)
    direct = merged.get("reportsContext")
    return dict(direct) if isinstance(direct, dict) else {}


def mcp_scope_for_handoff(
    page_context: dict[str, Any],
    *,
    fallback_module: str,
    fallback_surface: str,
) -> tuple[str, str]:
    """Keep delegated MCP calls inside the page scope signed by Fastify."""
    module = str(page_context.get("module") or fallback_module).strip().lower()
    surface = str(page_context.get("surface") or fallback_surface).strip().lower()
    return module, surface


def _allowed_tools(
    module: str,
    *,
    proposal_only: bool = False,
    hub_execute: bool = False,
    agent_name: str = "",
) -> list[str]:
    names = sorted(
        {
            str(tool["name"])
            for surface in ("list", "create", "detail")
            for tool in list_catalog_tools(
                module=module,
                surface=surface,
                entity_id="entity" if surface == "detail" else None,
            )
        }
    )
    if agent_name == "seo-content-generator":
        names = [name for name in names if name in CONTENT_GENERATOR_TOOLS]
    if proposal_only:
        common = {"navigate", "open_entity", "ask_clarification", "remember_memory", "clear_memory"}
        names = [
            name
            for name in names
            if name in common or "proposal" in name
        ]
    if hub_execute:
        names = [name for name in names if name != "ask_clarification"]
    return names


def _proposal_heuristic_hit(
    *,
    page_context: dict[str, Any],
    catalog: dict[str, Any],
    messages: list[dict[str, Any]],
    user_text: str,
) -> dict[str, Any] | None:
    from app.agents.proposal_coworker_agent import (
        _deal_id_from_catalog,
        _heuristic_proposal_result,
        _proposal_id,
    )

    hit = _heuristic_proposal_result(
        text=user_text or last_user_text(messages),
        proposal_id=_proposal_id(page_context),
        deal_id=_deal_id_from_catalog(catalog),
        catalog=catalog,
    )
    if hit and hit.get("ok") and hit.get("toolProposals"):
        return hit
    return None


def _run_result_from_proposal_heuristic(
    *,
    context: AgentContext,
    agent_name: str,
    hit: dict[str, Any],
    started: float,
) -> RunResult:
    proposals = hit.get("toolProposals") if isinstance(hit.get("toolProposals"), list) else []
    ui_refresh = hit.get("uiRefresh") if isinstance(hit.get("uiRefresh"), dict) else None
    return RunResult(
        runId=context.envelope.run_id,
        traceId=context.envelope.trace_id,
        assistantText=str(hit.get("assistantText") or ""),
        toolProposals=proposals or None,
        sessionMemoryPatch={
            "activeAgent": agent_name,
            "activeDomain": str(context.metadata.get("activeDomain") or ""),
        },
        uiRefresh=ui_refresh,
        source="heuristic",
        runMetadata=RunMetadata(
            agentVersion="1.0",
            promptVersion="crm-tools-v1",
            toolPolicyVersion=get_settings().mcp_policy_version,
            latencyMs=max(0, int((time.monotonic() - started) * 1000)),
            memorySource="redis" if configured_memory_manager().enabled else "compatibility",
        ),
    )


def _seo_terminal_ok(loop_result: ToolLoopResult) -> bool:
    terminal = {
        "seo_save_generated_content",
        "seo_research_keywords",
        "seo_repurpose_social",
        "seo_schedule_post",
        "seo_publish_post",
    }
    for item in loop_result.tool_results:
        name = str(item.get("name") or "")
        raw = item.get("result") if isinstance(item.get("result"), dict) else {}
        if name in terminal and raw.get("ok"):
            return True
    return False


def _should_nudge_seo_save(loop_result: ToolLoopResult) -> bool:
    """Only follow up when the model drafted a long article in chat without saving.

    Short replies (including failed social turns) must not be steered into
    keyword research / seo_save_generated_content.
    """
    if _seo_terminal_ok(loop_result):
        return False
    return len(str(loop_result.content or "").strip()) >= 400


async def _ensure_seo_package_saved(
    *,
    loop_result: ToolLoopResult,
    context: AgentContext,
    client: _LoopMcpClient,
    module: str,
    max_tokens: int,
) -> ToolLoopResult:
    if not _should_nudge_seo_save(loop_result) or context.envelope.remaining_seconds() < 20:
        return loop_result
    spec = _specialist_spec("seo-content-generator", module)
    save_spec = spec.model_copy(
        update={"allowed_tools": ["seo_save_generated_content"]}
    )
    nudge = {
        "role": "user",
        "content": (
            "The Digital Marketing article is not saved yet. Call "
            "seo_save_generated_content with keywordQueryId, contentType=package, "
            "title, slug, seoScore, and body.blog.markdown (400-800 words). "
            "Do not invent Semrush volumes. Do not write the article in chat."
        ),
    }
    try:
        follow = await BoundedToolLoop().run(
            spec=save_spec,
            context=context,
            messages=[*loop_result.messages, nudge],
            client=client,
            max_tokens=max_tokens,
        )
    except Exception:
        import logging

        logging.getLogger(__name__).exception("seo content save follow-up failed")
        return loop_result
    return ToolLoopResult(
        content=follow.content or loop_result.content,
        messages=follow.messages,
        rounds=loop_result.rounds + follow.rounds,
        calls=loop_result.calls + follow.calls,
        tool_results=tuple(loop_result.tool_results) + tuple(follow.tool_results),
    )


def _collect_tool_loop_parts(
    loop_result: ToolLoopResult,
    *,
    proposals: list[dict[str, Any]],
    patch: dict[str, Any],
    ui_refresh: dict[str, Any],
) -> dict[str, Any] | None:
    analytics: dict[str, Any] | None = None
    for item in loop_result.tool_results:
        name = str(item.get("name") or "")
        raw = item.get("result") if isinstance(item.get("result"), dict) else {}
        parts = mcp_result_to_turn_parts(name, raw)
        if isinstance(parts.get("patch"), dict):
            patch.update(parts["patch"])
        if isinstance(parts.get("toolProposal"), dict):
            proposals.append(parts["toolProposal"])
        if isinstance(parts.get("uiRefresh"), dict):
            _merge_refresh(ui_refresh, parts["uiRefresh"])
        executed = parts.get("executedData")
        if isinstance(executed, dict) and isinstance(executed.get("analytics"), dict):
            analytics = executed["analytics"]
    return analytics


def _detail_field_heuristic_fallback(
    *,
    agent_name: str,
    entity_id: str,
    field_hint: dict[str, Any],
    detail_update_tool: str,
    catalog: dict[str, Any],
) -> tuple[dict[str, Any], str] | None:
    """When the LLM tool loop misses a parsed detail edit, emit the mutation tool."""
    from app.agents.draft_conversation import (
        describe_contact_patch,
        propose_update_company_proposal,
        propose_update_contact_proposal,
        propose_update_invoice_proposal,
        propose_update_product_proposal,
        propose_update_quote_proposal,
        propose_update_deal_proposal,
    )
    if not field_hint:
        return None

    if agent_name == "contact-agent" and detail_update_tool == "propose_update_contact":
        oc = catalog.get("openContact")
        name = (
            str(oc.get("displayName") or "").strip()
            if isinstance(oc, dict)
            else ""
        )
        who = f"**{name}**" if name else "this contact"
        what = describe_contact_patch({k: str(v) for k, v in field_hint.items()})
        prop = propose_update_contact_proposal(
            contact_id=entity_id, patch={k: str(v) for k, v in field_hint.items()}
        )
        return prop, f"Sure — I'll update the {what} for {who}."

    if agent_name == "company-agent" and detail_update_tool == "propose_update_company":
        co = catalog.get("openCompany")
        name = str(co.get("name") or "").strip() if isinstance(co, dict) else ""
        who = f"**{name}**" if name else "this company"
        prop = propose_update_company_proposal(company_id=entity_id, patch=field_hint)
        return prop, f"Got it — updating {who} now."

    if agent_name == "product-agent" and detail_update_tool == "propose_update_product":
        prop = propose_update_product_proposal(product_id=entity_id, patch=field_hint)
        return prop, "Got it — updating this product now."

    if agent_name == "finance-agent" and detail_update_tool == "propose_update_invoice":
        prop = propose_update_invoice_proposal(invoice_id=entity_id, patch=field_hint)
        return prop, "Got it — updating this invoice now."

    if agent_name == "quotes-agent" and detail_update_tool == "propose_update_quote":
        prop = propose_update_quote_proposal(quote_id=entity_id, patch=field_hint)
        return prop, "Got it — updating this quote now."

    if agent_name == "deal-agent":
        from app.agents.deal_coworker_agent import _stage_change_tool

        picked = _deal_detail_tool_from_hint(field_hint)
        if not picked:
            return None
        tool_name, hint = picked
        if tool_name == "propose_stage_change":
            stage = str(hint["stage"])
            prop = _stage_change_tool(entity_id, stage)
            return prop, f"Moving this deal to **{stage.replace('_', ' ')}**."
        prop = propose_update_deal_proposal(deal_id=entity_id, patch=hint)
        return prop, "Got it — updating this deal now."

    return None


def _deal_detail_tool_from_hint(
    field_hint: dict[str, Any] | None,
) -> tuple[str, dict[str, Any]] | None:
    if not field_hint:
        return None
    non_stage = {k: v for k, v in field_hint.items() if k != "stage"}
    if "stage" in field_hint and not non_stage:
        return ("propose_stage_change", {"stage": field_hint["stage"]})
    if non_stage:
        return ("propose_update_deal", non_stage)
    return None


_EMAIL_DRAFT_AGENTS = frozenset({"contact-agent", "company-agent", "deal-agent"})
_EMAIL_DRAFT_TOOLS = frozenset(
    {
        "compose_customer_email",
        "propose_save_email_draft",
        "propose_send_email",
        "propose_schedule_email",
    }
)


def session_memory_for_prompt(
    page_context: dict[str, Any], working: Any
) -> dict[str, Any]:
    """Keep the chat's saved email draft when Redis working memory omitted it.

    The card is written in the browser after the turn returns, then sent back
    on the next request. A stored working record must not hide that slot.
    """
    memory = dict(working) if isinstance(working, dict) else {}
    request = page_context.get("sessionMemory")
    if not isinstance(request, dict):
        return memory
    request_slots = request.get("slots")
    if not isinstance(request_slots, dict) or "emailDraft" not in request_slots:
        return memory
    slots = dict(memory.get("slots") or {}) if isinstance(memory.get("slots"), dict) else {}
    incoming = request_slots.get("emailDraft")
    if isinstance(incoming, dict) and str(incoming.get("subject") or "").strip():
        slots["emailDraft"] = incoming
    else:
        slots.pop("emailDraft", None)
    memory["slots"] = slots
    return memory


def open_email_tool_instruction(draft: dict[str, Any]) -> str:
    """Ask the model to act on the open draft. The model chooses the tool."""
    body = str(draft.get("body") or "")[:2000]
    return (
        "An email draft is already saved and shown to the user as a card. "
        "Read their latest message and call the one tool that does what they asked. "
        "Copy every field they did not ask to change. "
        f"draftId={draft.get('draftId')}. to={draft.get('to')}. "
        f"subject={draft.get('subject')}. contactId={draft.get('contactId')}. "
        f"body={body}. "
        "Sending this draft is propose_send_email with this subject, body, and to. "
        "Do not compose a new email for a send. "
        "A later time is propose_schedule_email with sendAt taken from now=. "
        "A wording change is compose_customer_email with currentSubject and currentBody "
        "set to this draft, and instruction set to only what they asked to change, "
        "then propose_save_email_draft with this draftId. "
        "A change to the recipients or the subject is propose_save_email_draft "
        "with the other fields copied from this draft. "
        "Pass to as an array of email addresses, one address per item. "
        "If their latest message is not about this email, do not call an email tool."
    )


def _open_email_draft(memory: dict[str, Any]) -> dict[str, Any] | None:
    slots = memory.get("slots") if isinstance(memory.get("slots"), dict) else {}
    draft = slots.get("emailDraft") if isinstance(slots, dict) else None
    if not isinstance(draft, dict) or not str(draft.get("subject") or "").strip():
        return None
    if str(draft.get("status") or "") == "sent":
        return None
    return draft


async def _repair_open_email_draft(
    *,
    agent_name: str,
    context: AgentContext,
    spec: AgentSpec,
    base_messages: list[dict[str, Any]],
    loop_client: Any,
    proposals: list[dict[str, Any]],
    loop_max_tokens: int,
    session_memory: dict[str, Any],
) -> ToolLoopResult | None:
    """Second tool pass when a saved email draft is open and the first pass did not touch it.

    The model chooses the tool from the user's message. This pass does not pick one.
    """
    if agent_name not in _EMAIL_DRAFT_AGENTS:
        return None
    if any(p.get("name") in _EMAIL_DRAFT_TOOLS for p in proposals):
        return None
    draft = _open_email_draft(session_memory)
    if not draft or context.envelope.remaining_seconds() <= 12:
        return None
    try:
        return await BoundedToolLoop().run(
            spec=spec,
            context=context,
            messages=_with_leading_system(base_messages, open_email_tool_instruction(draft)),
            client=loop_client,
            max_tokens=min(700, loop_max_tokens),
            tool_choice="required",
            tool_choice_rounds=1,
        )
    except OrchestratorError:
        return None


def ensure_email_draft_save_proposal(
    proposals: list[dict[str, Any]],
    tool_results: list[dict[str, Any]],
    draft: dict[str, Any] | None,
) -> None:
    """Save the composed email when the model drafted it and did not save it.

    The card is the preview. Subject, body, and To come from the compose result.
    """
    if any(item.get("name") == "propose_save_email_draft" for item in proposals):
        return
    composed: dict[str, Any] | None = None
    for item in tool_results:
        if str(item.get("name") or "") != "compose_customer_email":
            continue
        result = item.get("result") if isinstance(item.get("result"), dict) else {}
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        if str(data.get("body") or "").strip():
            composed = data
    if not composed:
        return
    prior = draft if isinstance(draft, dict) else {}
    from app.mcp.dispatch import email_address_list

    proposals.append(
        {
            "id": "mcp-propose_save_email_draft-from-compose",
            "name": "propose_save_email_draft",
            "label": "save email draft",
            "args": {
                "to": email_address_list(composed.get("to"))
                or email_address_list(prior.get("to")),
                "subject": str(composed.get("subject") or prior.get("subject") or ""),
                "body": str(composed.get("body") or ""),
                "contactId": str(composed.get("contactId") or prior.get("contactId") or ""),
                "contactName": str(composed.get("contactName") or ""),
                "draftId": str(prior.get("draftId") or ""),
                "auto": True,
            },
            "risk": "low",
        }
    )


def keep_one_email_send(proposals: list[dict[str, Any]]) -> None:
    """One send action per turn. The model sometimes emits the same send several times."""
    seen = False
    kept: list[dict[str, Any]] = []
    for proposal in proposals:
        if proposal.get("name") != "propose_send_email":
            kept.append(proposal)
            continue
        if seen:
            continue
        seen = True
        kept.append(proposal)
    proposals[:] = kept


def discard_proposals_when_clarifying(
    proposals: list[dict[str, Any]],
    tool_results: list[dict[str, Any]],
) -> None:
    """A clarification question is terminal for UI actions in the current turn.

    Read tools may have already run, and draft patches may still be useful, but
    form-owned mutation/navigation proposals must not execute behind the
    question shown to the user.
    """
    if any(
        str(item.get("name") or "") == "ask_clarification"
        and bool(
            item.get("result", {}).get("ok", True)
            if isinstance(item.get("result"), dict)
            else False
        )
        for item in tool_results
        if isinstance(item, dict)
    ):
        proposals.clear()


class _LoopMcpClient:
    def __init__(
        self,
        client: McpClient,
        *,
        module: str,
        surface: str,
        entity_id: str | None,
    ) -> None:
        self.client = client
        self.module = module
        self.surface = surface
        self.entity_id = entity_id

    async def list_tools(self, *, context: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        del context
        return await self.client.list_tools(
            module=self.module, surface=self.surface, entity_id=self.entity_id
        )

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
        *,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        return await self.client.call_tool(name, arguments, context=context)


def _specialist_spec(agent_name: str, module: str, *, hub_execute: bool = False) -> AgentSpec:
    descriptions = {
        "contact-agent": "Contacts specialist for people, leads and contact drafts.",
        "company-agent": "Companies specialist for accounts and locations.",
        "deal-agent": "Sales deal specialist for pipeline records.",
        "proposal-agent": "Sales proposal document specialist.",
        "product-agent": "Shared inventory product catalog specialist.",
        "finance-agent": "Finance invoice specialist for draft create and invoice detail edits.",
        "quotes-agent": "Sales quote specialist for quote draft create and quote detail edits.",
        "link-agent": "Cross-module navigation and CRM linking specialist.",
        "reports-analytics-agent": _REPORTS_ANALYTICS_MD["goal"],
        "seo-content-generator": (
            "Conversational Digital Marketing assistant for keywords, SEO content, "
            "and Instagram / Facebook / LinkedIn posts."
        ),
    }
    return AgentSpec(
        name=agent_name,
        version="1.0",
        kind=AgentKind.ANALYTICS if agent_name == "reports-analytics-agent" else AgentKind.COWORKER,
        execution="turn",
        description=descriptions[agent_name],
        promptBuilder="app.agents.crm_tools.build_system_prompt",
        allowedTools=_allowed_tools(
            module,
            proposal_only=agent_name == "proposal-agent",
            hub_execute=hub_execute,
            agent_name=agent_name,
        ),
        maxHandoffs=3,
        mutationCapable=agent_name != "reports-analytics-agent",
    )


async def _run_specialist(context: AgentContext) -> RunResult:
    payload = context.input
    page_context = dict(payload.get("context") or {})
    catalog = dict(payload.get("catalog") or {})
    agent_name = str(context.metadata.get("specialistName") or "")
    user_q = last_user_text(context.messages) or str(payload.get("userText") or "")
    try:
        from app.observability.turn_log import record_attending_agent, turn_active

        if turn_active() and agent_name:
            record_attending_agent(agent_name)
    except Exception:  # noqa: BLE001
        pass
    module = _module_for_agent(agent_name, page_context)
    surface = str(page_context.get("surface") or "list").lower()
    entity_id = str(page_context.get("entityId") or "").strip() or None
    prompt_context = {
        **page_context,
        "catalog": catalog,
        "deals": catalog.get("deals"),
        "products": catalog.get("products"),
        "businessType": context.envelope.business_type,
        "sessionMemory": session_memory_for_prompt(page_context, context.memory),
    }
    specialist_instruction = SPECIALIST_INSTRUCTIONS[agent_name]
    if agent_name == "contact-agent" and surface == "detail":
        open_contact = catalog.get("openContact")
        oc_name = (
            str(open_contact.get("displayName") or "").strip()
            if isinstance(open_contact, dict)
            else ""
        )
        eid = str(page_context.get("entityId") or "").strip()
        open_co = catalog.get("openCompany")
        co_name = (
            str(open_co.get("name") or "").strip()
            if isinstance(open_co, dict)
            else ""
        )
        open_loc = catalog.get("openCompanyLocation")
        loc_city = (
            str(open_loc.get("city") or "").strip()
            if isinstance(open_loc, dict)
            else ""
        )
        specialist_instruction += (
            f"\n\nOpen record: entityId={eid or '(missing)'}"
            + (f", {oc_name}." if oc_name else ".")
            + (f" Employer: {co_name}." if co_name else "")
            + (f" Company location city now: {loc_city or '(none)'}." if co_name else "")
            + " Person-field replies (their city, email, phone, …) → propose_update_contact "
            "(contactId=entityId, auto=true). Company profile on this contact → "
            "propose_update_company(companyId=openCompany.id). Company office location → "
            "propose_update_company_location — never ask which company when openCompany is set."
        )
    elif agent_name == "company-agent" and surface == "detail":
        open_company = catalog.get("openCompany")
        co_name = (
            str(open_company.get("name") or "").strip()
            if isinstance(open_company, dict)
            else ""
        )
        eid = str(page_context.get("entityId") or "").strip()
        specialist_instruction += (
            f"\n\nOpen record: entityId={eid or '(missing)'}"
            + (f", {co_name}." if co_name else ".")
            + " Shorthand like \"industry SaaS\" or \"domain acme.io\" require propose_update_company "
            "in this turn (companyId=entityId, auto=true) before your chat reply."
        )
    elif agent_name == "deal-agent" and surface == "create":
        specialist_instruction += (
            "\n\nCreate form is open. Call patch_deal_draft this turn with title, "
            "company, and contact from the user message or catalog. Then ask only "
            "for the next missing field (usually amount). Do not claim the deal is "
            "set without that tool."
        )
    elif agent_name == "deal-agent" and surface == "detail":
        open_deal = catalog.get("openDeal")
        deal_title = (
            str(open_deal.get("title") or "").strip()
            if isinstance(open_deal, dict)
            else ""
        )
        eid = str(page_context.get("entityId") or "").strip()
        specialist_instruction += (
            f"\n\nOpen record: entityId={eid or '(missing)'}"
            + (f", {deal_title}." if deal_title else ".")
            + " Amount/title/notes need propose_update_deal (dealId=entityId, auto=true). "
            "Stage-only moves need propose_stage_change (dealId=entityId, auto=true). "
            "Owner reassignment: when canAssignOwner=true, propose_reassign_deal_owner "
            "(dealId=entityId, ownerUserId from assignableOwners). When "
            "canAssignOwner=false, say only an admin or sales manager can reassign."
        )
    elif agent_name == "quotes-agent" and surface == "detail":
        open_quote = catalog.get("openQuote")
        quote_label = (
            str(open_quote.get("number") or open_quote.get("dealTitle") or "").strip()
            if isinstance(open_quote, dict)
            else ""
        )
        eid = str(page_context.get("entityId") or "").strip()
        specialist_instruction += (
            f"\n\nOpen record: entityId={eid or '(missing)'}"
            + (f", {quote_label}." if quote_label else ".")
            + " Shorthand like \"notes as Net 30\" or \"customer name as Jane\" "
            "require propose_update_quote (quoteId=entityId, auto=true) before your chat reply."
        )
    elif agent_name == "finance-agent" and surface == "detail":
        open_invoice = catalog.get("openInvoice")
        inv_label = (
            str(open_invoice.get("number") or open_invoice.get("dealTitle") or "").strip()
            if isinstance(open_invoice, dict)
            else ""
        )
        eid = str(page_context.get("entityId") or "").strip()
        specialist_instruction += (
            f"\n\nOpen record: entityId={eid or '(missing)'}"
            + (f", {inv_label}." if inv_label else ".")
            + " Shorthand like \"notes as Net 30\" or \"payment terms as Due on receipt\" "
            "require propose_update_invoice (invoiceId=entityId, auto=true) before your chat reply."
        )
    elif agent_name == "product-agent" and surface == "detail":
        open_product = catalog.get("openProduct")
        prod_name = (
            str(open_product.get("name") or "").strip()
            if isinstance(open_product, dict)
            else ""
        )
        eid = str(page_context.get("entityId") or "").strip()
        specialist_instruction += (
            f"\n\nOpen record: entityId={eid or '(missing)'}"
            + (f", {prod_name}." if prod_name else ".")
            + " Shorthand like \"price as 99\" or \"sku as ABC-1\" require "
            "propose_update_product (productId=entityId, auto=true) before your chat reply."
        )
    elif agent_name == "proposal-agent" and surface == "detail":
        open_prop = catalog.get("openProposal")
        prop_label = (
            str(open_prop.get("title") or open_prop.get("dealTitle") or "").strip()
            if isinstance(open_prop, dict)
            else ""
        )
        eid = str(page_context.get("entityId") or "").strip()
        specialist_instruction += (
            f"\n\nOpen proposal: entityId={eid or '(missing)'}"
            + (f", {prop_label}." if prop_label else ".")
            + " Document or section edits require the matching propose_patch_proposal_* "
            "or propose_send_proposal tool in this turn — never claim saved without a tool result."
        )
    if surface == "create" and agent_name not in {
        "reports-analytics-agent",
        "seo-content-generator",
    }:
        specialist_instruction += (
            " The user is already on the create form. Call the matching patch_*_draft "
            "tool immediately with every field they provided. Do not only acknowledge in chat."
        )
    from app.agents.crm_tools import is_hub_execute

    if is_hub_execute(page_context):
        specialist_instruction += (
            " Hub delegated this turn and will not reply. Execute now with tools. "
            "Never ask a clarifying question or wait for confirmation."
        )
    messages = [
        {
            "role": "system",
            "content": build_system_prompt(module, surface, prompt_context)
            + f"\n\nNative specialist:\n{specialist_instruction}",
        },
        *coworker_messages_to_openai(context.messages),
    ]
    if not any(item.get("role") == "user" for item in messages):
        messages.append({"role": "user", "content": str(payload.get("userText") or "")})

    if agent_name == "reports-analytics-agent":
        question = last_user_text(context.messages) or str(payload.get("userText") or "")
        page = payload.get("context") if isinstance(payload.get("context"), dict) else {}
        snapshot = page.get("pageSnapshot") if isinstance(page.get("pageSnapshot"), dict) else {}
        metrics_period = str(snapshot.get("metricsPeriod") or "").strip()
        mcp_module, mcp_surface = mcp_scope_for_handoff(
            page,
            fallback_module=module,
            fallback_surface=surface,
        )

        page_mem = page.get("sessionMemory")
        reports_context = reports_context_for_handoff(
            context.memory if isinstance(context.memory, dict) else None,
            page_mem if isinstance(page_mem, dict) else None,
        )
        from app.agent_log import trace

        trace(
            agent="reports-analytics-agent",
            step="specialist",
            user=question.strip(),
            fromAgent=str(context.metadata.get("handoffFrom") or "native-coworker"),
        )
        started = time.monotonic()
        mcp = McpClient(
            acting_user_id=context.envelope.actor_id,
            organization_id=context.envelope.organization_id,
            role=context.envelope.role,
            timeout_s=max(
                20.0, min(110.0, context.envelope.remaining_seconds())
            ),
            execution_token=str(payload.get("mcpExecutionToken") or "") or None,
            execution_context={
                "agentName": "crm-agent",
                "executionMode": "native",
                "businessType": context.envelope.business_type,
                # These fields must match the Fastify-issued JWT claims. The
                # analytics tool is read-only and can be invoked from any CRM
                # surface after the supervisor routes to this specialist.
                "module": mcp_module,
                "surface": mcp_surface,
                "policyVersion": get_settings().mcp_policy_version,
                "organizationId": context.envelope.organization_id,
                "actingUserId": context.envelope.actor_id,
                "role": context.envelope.role,
                "runId": context.envelope.run_id,
                "traceId": context.envelope.trace_id,
                "idempotencyKey": context.envelope.idempotency_key,
            },
        )
        tool_result = await mcp.call_tool(
            "query_analytics",
            {
                "question": question,
                "sessionId": context.envelope.run_id,
                "timePhrase": metrics_period,
                "objectLock": str(reports_context.get("objectLock") or ""),
                "reportsContext": reports_context,
                "recentMessages": coworker_messages_to_openai(context.messages)[-8:],
            },
        )
        result = tool_result if isinstance(tool_result, dict) else {
            "ok": False,
            "error": "reports_mcp_unavailable",
            "assistantText": (
                "I couldn't load CRM analytics right now. Please try again."
            ),
        }
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        analytics = data.get("analytics") if isinstance(data.get("analytics"), dict) else None
        suggestions = data.get("suggestions") if isinstance(data.get("suggestions"), list) else None
        speech = sanitize_assistant_text_for_user(str(result.get("assistantText") or ""))
        reports_patch = data.get("reportsContextPatch")
        slots_patch: dict[str, Any] = {}
        if isinstance(reports_patch, dict) and reports_patch:
            slots_patch["reportsContext"] = reports_patch
        memory_patch: dict[str, Any] = {
            "activeAgent": agent_name,
            "activeDomain": str(context.metadata.get("activeDomain") or "reports"),
        }
        if slots_patch:
            memory_patch["slots"] = slots_patch
        reports_ok = result.get("ok") is not False
        return RunResult(
            runId=context.envelope.run_id,
            traceId=context.envelope.trace_id,
            ok=reports_ok,
            assistantText=speech,
            sessionMemoryPatch=memory_patch,
            source=str(data.get("source") or "ai"),
            analytics=analytics,
            suggestions=suggestions,
            error=(
                RunError(
                    code=str(data.get("reason") or "reports_turn_failed"),
                    message=str(result.get("error") or speech[:400]),
                )
                if not reports_ok
                else None
            ),
            runMetadata=RunMetadata(
                agentVersion="1.0",
                promptVersion="crm-tools-v1",
                toolPolicyVersion=get_settings().mcp_policy_version,
                latencyMs=max(0, int((time.monotonic() - started) * 1000)),
                memorySource="redis" if configured_memory_manager().enabled else "compatibility",
            ),
        )

    started = time.monotonic()
    mcp_timeout = 90.0 if agent_name == "seo-content-generator" else 70.0
    open_for_compose = _open_email_draft(
        prompt_context.get("sessionMemory")
        if isinstance(prompt_context.get("sessionMemory"), dict)
        else {}
    )
    mcp = McpClient(
        acting_user_id=context.envelope.actor_id,
        organization_id=context.envelope.organization_id,
        role=context.envelope.role,
        timeout_s=max(20.0, min(mcp_timeout, context.envelope.remaining_seconds())),
        execution_token=str(payload.get("mcpExecutionToken") or "") or None,
        execution_context={
            # Fastify issues the execution JWT for the public crm-agent endpoint.
            # The specialist name remains orchestration metadata, not a new auth grant.
            "agentName": "crm-agent",
            "executionMode": "native",
            "businessType": context.envelope.business_type,
            "module": module,
            "surface": surface,
            "policyVersion": get_settings().mcp_policy_version,
            "organizationId": context.envelope.organization_id,
            "actingUserId": context.envelope.actor_id,
            "role": context.envelope.role,
            "runId": context.envelope.run_id,
            "traceId": context.envelope.trace_id,
            "idempotencyKey": context.envelope.idempotency_key,
            **({"entityId": entity_id} if entity_id else {}),
            **(
                {
                    "emailDraft": {
                        "draftId": open_for_compose.get("draftId"),
                        "to": open_for_compose.get("to"),
                        "subject": open_for_compose.get("subject"),
                        "body": open_for_compose.get("body"),
                        "contactId": open_for_compose.get("contactId"),
                        "status": open_for_compose.get("status") or "draft",
                    }
                }
                if open_for_compose
                else {}
            ),
        },
    )
    loop_max_tokens = 6000 if agent_name == "seo-content-generator" else 900
    loop_client = _LoopMcpClient(
        mcp, module=module, surface=surface, entity_id=entity_id
    )
    specialist_spec = _specialist_spec(agent_name, module)
    try:
        loop_result = await BoundedToolLoop().run(
            spec=specialist_spec,
            context=context,
            messages=messages,
            client=loop_client,
            max_tokens=loop_max_tokens,
        )
    except OrchestratorError:
        raise
    if agent_name == "seo-content-generator":
        loop_result = await _ensure_seo_package_saved(
            loop_result=loop_result,
            context=context,
            client=loop_client,
            module=module,
            max_tokens=loop_max_tokens,
        )
    proposals: list[dict[str, Any]] = []
    patch: dict[str, Any] = {}
    ui_refresh: dict[str, Any] = {}
    analytics: dict[str, Any] | None = _collect_tool_loop_parts(
        loop_result, proposals=proposals, patch=patch, ui_refresh=ui_refresh
    )
    loop_content = loop_result.content
    tool_outcomes = list(loop_result.tool_results)
    email_repair = await _repair_open_email_draft(
        agent_name=agent_name,
        context=context,
        spec=specialist_spec,
        base_messages=messages,
        loop_client=loop_client,
        proposals=proposals,
        loop_max_tokens=loop_max_tokens,
        session_memory=prompt_context.get("sessionMemory")
        if isinstance(prompt_context.get("sessionMemory"), dict)
        else {},
    )
    if email_repair:
        before = len(proposals)
        tool_outcomes.extend(email_repair.tool_results)
        repair_analytics = _collect_tool_loop_parts(
            email_repair, proposals=proposals, patch=patch, ui_refresh=ui_refresh
        )
        if repair_analytics:
            analytics = repair_analytics
        if len(proposals) > before or any(
            str(item.get("name") or "") in _EMAIL_DRAFT_TOOLS
            for item in email_repair.tool_results
        ):
            loop_content = email_repair.content or ""
    from app.orchestrator.coworker_mutation_finalize import (
        block_false_mutation_success_speech,
        repair_open_record_mutation,
    )

    open_record_outcome = await repair_open_record_mutation(
        agent_name=agent_name,
        module=module,
        surface=surface,
        entity_id=entity_id,
        context=context,
        spec=specialist_spec,
        base_messages=messages,
        loop_client=loop_client,
        proposals=proposals,
        loop_max_tokens=loop_max_tokens,
        catalog=catalog,
        user_text=last_user_text(context.messages) or str(payload.get("userText") or ""),
        with_leading_system=_with_leading_system,
        loop_content=loop_content,
    )
    if open_record_outcome.result:
        before_mut = len(proposals)
        tool_outcomes.extend(open_record_outcome.result.tool_results)
        repair_analytics = _collect_tool_loop_parts(
            open_record_outcome.result,
            proposals=proposals,
            patch=patch,
            ui_refresh=ui_refresh,
        )
        if repair_analytics:
            analytics = repair_analytics
        if len(proposals) > before_mut:
            loop_content = open_record_outcome.result.content or loop_content
    loop_content = await block_false_mutation_success_speech(
        agent_name=agent_name,
        module=module,
        surface=surface,
        entity_id=entity_id,
        catalog=catalog,
        user_text=last_user_text(context.messages) or str(payload.get("userText") or ""),
        proposals=proposals,
        patch=patch,
        loop_content=loop_content,
        mutation_requested_hint=open_record_outcome.mutation_requested,
        remaining_seconds=context.envelope.remaining_seconds(),
        messages=context.messages,
    )
    open_draft = _open_email_draft(
        prompt_context.get("sessionMemory")
        if isinstance(prompt_context.get("sessionMemory"), dict)
        else {}
    )
    ensure_email_draft_save_proposal(proposals, tool_outcomes, open_draft)
    keep_one_email_send(proposals)
    discard_proposals_when_clarifying(proposals, tool_outcomes)
    _merge_refresh(ui_refresh, mcp.drain_ui_refresh())
    memory_patch = {
        "activeAgent": agent_name,
        "activeDomain": str(context.metadata.get("activeDomain") or ""),
    }
    if seeded_create_navigate(proposals):
        speech = ""
    else:
        speech = await _ensure_user_speech(
            content=loop_content,
            proposals=proposals,
            patch=patch,
            ui_refresh=ui_refresh,
            module=module,
            surface=surface,
            messages=context.messages,
            remaining_seconds=context.envelope.remaining_seconds(),
        )
    return RunResult(
        runId=context.envelope.run_id,
        traceId=context.envelope.trace_id,
        assistantText=speech,
        patch=patch or None,
        toolProposals=proposals or None,
        sessionMemoryPatch=memory_patch,
        uiRefresh=ui_refresh or None,
        source="ai",
        analytics=analytics,
        runMetadata=RunMetadata(
            agentVersion="1.0",
            promptVersion="crm-tools-v1",
            toolPolicyVersion=get_settings().mcp_policy_version,
            latencyMs=max(0, int((time.monotonic() - started) * 1000)),
            memorySource="redis" if configured_memory_manager().enabled else "compatibility",
            toolOutcomes=[
                {
                    "tool": str(item.get("name") or ""),
                    "ok": bool(
                        item.get("result", {}).get("ok", True)
                        if isinstance(item.get("result"), dict)
                        else False
                    ),
                }
                for item in tool_outcomes
            ],
        ),
    )


def build_native_registry(context: dict[str, Any]) -> AgentRegistry:
    from app.agents.crm_tools import is_hub_execute

    hub = is_hub_execute(context)
    entries = []
    for domain, name in DOMAIN_AGENTS.items():
        module = _module_for_agent(name, context)

        async def runner(agent_context: AgentContext, *, selected=name) -> RunResult:
            metadata = {**agent_context.metadata, "specialistName": selected}
            result = await _run_specialist(
                agent_context.model_copy(update={"metadata": metadata})
            )
            return result.model_copy(update={"agent": selected})

        entries.append(
            RegisteredAgent(_specialist_spec(name, module, hub_execute=hub), runner)
        )
    return AgentRegistry(entries)


def native_enabled_for(organization_id: str, actor_id: str, requested_mode: str | None) -> bool:
    settings = get_settings()
    if not settings.coworker_native_enabled or str(requested_mode or "").lower() != "native":
        return False
    allow = {item.strip() for item in settings.coworker_native_allowlist.split(",") if item.strip()}
    return "*" in allow or organization_id in allow or f"{organization_id}:{actor_id}" in allow


async def _ensure_user_speech(
    *,
    content: str,
    proposals: list[dict[str, Any]],
    patch: dict[str, Any],
    module: str,
    surface: str,
    messages: list[dict[str, Any]],
    remaining_seconds: float,
    ui_refresh: dict[str, Any] | None = None,
) -> str:
    """When the tool loop exits with actions but no chat text, ask the LLM once."""
    speech = sanitize_assistant_text_for_user(content).strip()
    acted = bool(proposals or patch or ui_refresh)
    if speech or not acted:
        return speech
    from app.agent_log import console_coworker
    from app.llm import chat_with_tools, is_ai_configured

    if not is_ai_configured() or remaining_seconds <= 0:
        return speech
    prompt = (
        "The user already received the workspace actions for this turn. "
        "Reply in one or two short natural sentences — acknowledge and guide next. "
        "Do not mention tools, workspace, or internal UI."
    )
    if module == "marketing":
        prompt = (
            "Reply like a marketing teammate in 2–4 short sentences. "
            "Say what is ready and which tab to look at. Ask one next question. "
            "Do not mention tools, LLM, Semrush, volumes, or ids."
        )
    try:
        response = await asyncio.wait_for(
            chat_with_tools(
                messages=[
                    {
                        "role": "system",
                        "content": build_system_prompt(
                            module,
                            surface,
                            {"module": module, "surface": surface},
                        )
                        + f"\n\n{prompt}",
                    },
                    *coworker_messages_to_openai(messages),
                ],
                tools=None,
                max_tokens=160,
                timeout_ms=max(1, int(min(remaining_seconds, 20) * 1000)),
                temperature=0.2,
            ),
            timeout=min(remaining_seconds, 20),
        )
    except Exception:
        return speech
    speech_out = sanitize_assistant_text_for_user(
        str((response or {}).get("content") or "")
    ).strip()
    console_coworker("llm", kind="final_speech", text=speech_out or "(no text)")
    return speech_out


async def run_native_coworker(
    *,
    messages: list[dict[str, Any]],
    context: dict[str, Any],
    catalog: dict[str, Any],
    session_memory: dict[str, Any],
    organization_id: str,
    actor_id: str,
    role: str,
    business_type: str,
    mcp_execution_token: str | None,
) -> dict[str, Any]:
    from app.agent_log import trace
    from app.agents.coworker_shared import LLM_ERROR_SPEECH, drop_non_llm_speech
    from app.orchestrator.errors import OrchestratorError

    user_text = last_user_text(messages)
    mod = str(context.get("module") or "").lower()
    surface = str(context.get("surface") or "list").lower()
    context = {**context, "userText": user_text}

    trace(agent="native-coworker", step="receive", module=mod, surface=surface, user=user_text)

    settings = get_settings()
    conversation_id = str(
        session_memory.get("conversationId")
        or context.get("conversationId")
        or (
            context.get("sessionMemory", {}).get("conversationId")
            if isinstance(context.get("sessionMemory"), dict)
            else ""
        )
        or ""
    ).strip()
    if not conversation_id:
        conversation_id = f"compat-{uuid.uuid4().hex}"
    token_claims: dict[str, Any] = {}
    if mcp_execution_token:
        try:
            token_claims = jwt.decode(
                mcp_execution_token,
                options={"verify_signature": False, "verify_exp": False},
                algorithms=["HS256"],
            )
        except jwt.PyJWTError:
            token_claims = {}
    run_id = str(token_claims.get("runId") or f"coworker-{uuid.uuid4().hex}")
    trace_id = str(token_claims.get("traceId") or f"trace-{uuid.uuid4().hex}")
    idempotency_key = str(token_claims.get("idempotencyKey") or run_id)
    deadline_s = max(10, min(settings.coworker_native_deadline_seconds, 210))
    if is_seo_content_page(context):
        deadline_s = max(deadline_s, 180)
    envelope = ExecutionEnvelope(
        runId=run_id,
        traceId=trace_id,
        organizationId=organization_id,
        actorId=actor_id,
        role=role,
        businessType=business_type,
        mode="native",
        deadline=datetime.now(timezone.utc) + timedelta(seconds=deadline_s),
        idempotencyKey=idempotency_key,
        conversationId=conversation_id,
        toolBudget=ToolBudget(maxRounds=6, maxCalls=10, maxRepeatedCall=2),
    )
    manager = configured_memory_manager()

    async def execute() -> RunResult:
        record = await manager.load(
            organization_id,
            actor_id,
            conversation_id,
            compatibility_memory=session_memory,
        )
        working = dict(record.get("working") or {})
        domain = _domain_for(context, catalog)
        previous_agent = str(working.get("activeAgent") or "")
        registry = build_native_registry(context)
        eligible_names = _eligible_specialist_names(domain)
        if previous_agent not in eligible_names:
            previous_agent = ""
        candidates = tuple(
            spec for spec in registry.specs() if spec.name in eligible_names
        )
        agent_context = AgentContext(
            envelope=envelope,
            input={
                "context": context,
                "catalog": catalog,
                "userText": last_user_text(messages),
                "mcpExecutionToken": mcp_execution_token,
            },
            messages=messages,
            memory=working,
            metadata={
                "activeDomain": domain,
                "previousAgent": previous_agent,
                "surfaceModule": str(context.get("module") or ""),
                "pathname": str(context.get("pathname") or ""),
            },
        )
        result = await Supervisor(
            registry, LlmRouter(), max_handoffs=3
        ).run(
            context=agent_context,
            candidates=candidates,
            user_text=last_user_text(messages),
            active_agent=previous_agent or None,
        )
        agent_name = str(result.agent or DOMAIN_AGENTS[domain])
        chosen_domain = next(
            (key for key, name in DOMAIN_AGENTS.items() if name == agent_name),
            domain,
        )
        patch = {
            **(result.session_memory_patch or {}),
            "conversationId": conversation_id,
            "activeAgent": agent_name,
            "activeDomain": chosen_domain,
        }
        result = result.model_copy(update={"session_memory_patch": patch, "agent": agent_name})
        if manager.enabled:
            saved = await manager.apply_patch(
                organization_id,
                actor_id,
                conversation_id,
                current=record,
                patch=patch,
                source=agent_name,
                run_id=run_id,
            )
            result = result.model_copy(update={"session_memory": saved.get("working")})
        else:
            result = result.model_copy(update={"session_memory": {**working, **patch}})
        return result

    try:
        if manager.enabled:
            async with manager.conversation_lock(
                organization_id, actor_id, conversation_id
            ):
                result = await execute()
        else:
            result = await execute()
        payload = result.compatibility_dict()
        raw_text = str(payload.get("assistantText") or "")
        from app.agents.coworker_shared import extract_suggestions

        cleaned, suggestions = extract_suggestions(raw_text)
        payload["assistantText"] = cleaned
        if suggestions:
            payload["suggestions"] = suggestions
        from app.agent_log import console_coworker, trace

        turn_ok = payload.get("ok") is not False
        trace(
            agent="native-coworker",
            step="finish",
            ok=turn_ok,
            targetAgent=str(payload.get("agent") or result.agent or ""),
            speech=str(payload.get("assistantText") or "")[:600],
            source=payload.get("source"),
            error=str(payload.get("error") or "")[:200] or None,
        )
        console_coworker(
            "final",
            agent=str(payload.get("agent") or result.agent or "native-coworker"),
            ok=turn_ok,
            text=str(payload.get("assistantText") or ""),
        )
        return drop_non_llm_speech(payload)
    except OrchestratorError as exc:
        from app.agent_log import console_coworker

        trace(
            agent="native-coworker",
            step="error",
            code=getattr(exc, "code", "orchestrator_error"),
            error=str(exc),
        )
        console_coworker(
            "error",
            code=getattr(exc, "code", "orchestrator_error"),
            text=str(exc),
        )
        speech = (
            "I couldn't finish generating that. Send the topic again and I'll retry."
            if getattr(exc, "code", "")
            in {"tool_cycle_detected", "budget_exceeded", "deadline_exceeded"}
            else LLM_ERROR_SPEECH
        )
        return drop_non_llm_speech(
            {
                "ok": False,
                "assistantText": speech,
                "source": "error",
                "reason": getattr(exc, "code", "orchestrator_error"),
            }
        )
    except Exception as exc:  # noqa: BLE001
        from app.agent_log import console_coworker

        trace(agent="native-coworker", step="error", error=str(exc))
        console_coworker("error", text=str(exc))
        return drop_non_llm_speech(
            {
                "ok": False,
                "assistantText": LLM_ERROR_SPEECH,
                "source": "error",
                "reason": "native_failed",
                "error": "native_failed",
            }
        )
