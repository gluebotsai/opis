"""Canonical enterprise CRM skill catalog and MCP capability groups."""

from __future__ import annotations

from types import MappingProxyType
from typing import Any

from app.agents.llm_result import sectioned_system_prompt
from app.skills.models import CompletionTest, ContextPolicy, SkillPackage, SkillSpec

ALL_ROLES = frozenset(
    {"admin", "sales_manager", "sales_rep", "marketing", "finance", "viewer"}
)
SALES_ROLES = frozenset({"admin", "sales_manager", "sales_rep"})
WRITE_ROLES = frozenset({"admin", "sales_manager", "sales_rep", "marketing", "finance"})
ALL_BUSINESS = frozenset({"b2b", "b2c", "b2b2c"})
B2B_BUSINESS = frozenset({"b2b", "b2b2c"})

MCP_GROUPS = MappingProxyType(
    {
        "navigation": frozenset({"navigate", "open_entity", "set_workspace", "ask_clarification"}),
        "contacts": frozenset(
            {
                "patch_contact_draft", "propose_create_contact", "propose_update_contact",
                "propose_delete_contact", "propose_merge_contacts", "propose_import_contacts",
                "propose_pull_prospect_leads",
                "propose_enrich_contact_zoominfo",
            }
        ),
        "companies": frozenset(
            {
                "patch_company_draft", "patch_location_draft", "propose_create_company",
                "propose_update_company", "propose_delete_company",
            }
        ),
        "proposals": frozenset(
            {
                "propose_create_proposal", "propose_rewrite_proposal_section",
                "propose_personalize_proposal", "propose_send_proposal",
                "propose_delete_proposal",
            }
        ),
        "quotes": frozenset(
            {
                "patch_quote_draft", "propose_create_quote", "propose_update_quote",
                "propose_send_quote", "propose_delete_quote",
            }
        ),
        "invoices": frozenset(
            {
                "patch_invoice_draft", "propose_create_invoice", "propose_update_invoice",
                "propose_send_invoice", "propose_delete_invoice", "propose_mark_invoice_paid",
            }
        ),
        "activities": frozenset({"patch_activity_draft", "propose_create_activity"}),
        "memory": frozenset({"remember_memory", "clear_memory"}),
        # Job agents are LLM-primary. These groups intentionally grant no implicit DB tools.
        "nurture": frozenset(),
        "scoring": frozenset(),
        "lifecycle": frozenset(),
        "meetings": frozenset(),
        "reports": frozenset({"navigate", "ask_clarification"}),
    }
)


def _schema(required: tuple[str, ...] = ()) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {key: {"type": "string"} for key in required},
        "required": list(required),
        "additionalProperties": True,
    }


def _skill(
    name: str,
    description: str,
    *,
    goal: str,
    instructions: str,
    groups: tuple[str, ...],
    roles=frozenset(),
    businesses=frozenset(),
    required: tuple[str, ...] = (),
    completion: str,
) -> SkillSpec:
    return SkillSpec(
        name=name,
        description=description,
        role="Act as the selected Worktual CRM specialist while retaining the parent agent role.",
        goal=goal,
        instructions=instructions,
        context=(
            "Use only request-scoped tenant context, selected entity context, and memory "
            "already authorized for this organization, user, and conversation."
        ),
        output=(
            "Return concise user-visible speech and structured tool calls or validated JSON "
            "required by the parent agent contract."
        ),
        guardrails=(
            "Never invent identifiers, cross tenant/user/conversation scopes, expose secrets, "
            "or claim a mutation completed before its tool result confirms success."
        ),
        context_policy=ContextPolicy(
            allowed_fields=frozenset(
                {
                    "module", "surface", "entityId", "pathname", "draft", "catalog",
                    "sessionMemory", "durableMemory", "businessType", "role",
                }
            )
        ),
        allowed_mcp_groups=frozenset(("navigation", *groups)),
        eligible_roles=roles or ALL_ROLES,
        eligible_business_types=businesses or ALL_BUSINESS,
        input_schema=_schema(required),
        output_schema=_schema(),
        completion_tests=(CompletionTest(name="done", assertion=completion),),
    )


SPECS = (
    _skill(
        "contact-crud", "Create, inspect, update, merge, import, and delete contacts.",
        goal="Complete contact work using customer_profile identity plus CRM overlays.",
        instructions="Resolve the contact, collect required fields, confirm destructive actions, then use contact tools.",
        groups=("contacts", "memory"), roles=WRITE_ROLES, required=("intent",),
        completion="The requested contact outcome is confirmed or one precise missing field is requested.",
    ),
    _skill(
        "company-crud", "Create, inspect, update, and delete companies and locations.",
        goal="Complete company work while keeping companies separate from contacts.",
        instructions="Require a company name and first location for create; confirm deletion.",
        groups=("companies", "memory"), roles=WRITE_ROLES, required=("intent",),
        completion="The company action is confirmed or the single next required field is identified.",
    ),
    _skill(
        "proposals", "Create, personalize, rewrite, send, and delete sales proposals.",
        goal="Produce and manage deal-linked proposal documents.",
        instructions="Use existing deal and product IDs only; distinguish proposals from quotes.",
        groups=("proposals",), roles=SALES_ROLES, businesses=B2B_BUSINESS,
        completion="The proposal is linked to an authorized deal and the requested document action is resolved.",
    ),
    _skill(
        "quotes", "Create, update, send, and delete deal-linked quotes.",
        goal="Manage quotes with real deal, product, quantity, and pricing context.",
        instructions="Never invent deal/product IDs; honor quote status restrictions.",
        groups=("quotes",), roles=SALES_ROLES, businesses=B2B_BUSINESS,
        completion="The quote action is confirmed with valid line context or a precise ambiguity is raised.",
    ),
    _skill(
        "invoices", "Create, update, send, mark paid, and delete invoices.",
        goal="Manage deal-linked finance documents under business-type and role controls.",
        instructions="Reject B2C finance; require real lines and respect paid-invoice restrictions.",
        groups=("invoices",), roles=frozenset({"admin", "sales_manager", "sales_rep", "finance"}),
        businesses=B2B_BUSINESS,
        completion="The invoice action is confirmed with required deal/line context.",
    ),
    _skill(
        "activities", "Log CRM calls, meetings, emails, tasks, SMS, and notes.",
        goal="Capture a correctly linked CRM activity.",
        instructions="Resolve the subject entity and activity type; do not silently default the type.",
        groups=("activities",), roles=WRITE_ROLES,
        completion="The activity has a subject and target, or the one missing requirement is requested.",
    ),
    _skill(
        "nurture", "Generate and manage LLM-led lead nurture decisions and content.",
        goal="Choose an appropriate nurture action from authorized lead context.",
        instructions="The LLM must make the primary nurture decision; heuristics are offline fallback only.",
        groups=("nurture",), roles=frozenset({"admin", "sales_manager", "marketing"}),
        completion="A validated nurture decision and next action are returned with source provenance.",
    ),
    _skill(
        "scoring", "Score leads using LLM judgment and validated structured output.",
        goal="Produce an explainable lead score for the existing lead pipeline.",
        instructions="Use the LLM success path and preserve hot/warm/cold contracts; label fallback honestly.",
        groups=("scoring",), roles=frozenset({"admin", "sales_manager", "marketing"}),
        completion="A bounded score, band, rationale, and source are present.",
    ),
    _skill(
        "lifecycle", "Determine and apply lead lifecycle transitions.",
        goal="Recommend a valid lifecycle transition from current CRM context.",
        instructions="The LLM owns the transition decision; validate allowed stages before persistence.",
        groups=("lifecycle",), roles=frozenset({"admin", "sales_manager", "marketing"}),
        completion="A valid transition or explicit no-change result is returned with rationale.",
    ),
    _skill(
        "meetings", "Prepare, assist, summarize, and follow up on customer meetings.",
        goal="Support the meeting workflow using authorized CRM and transcript context.",
        instructions="Do not invent transcript facts or attendees; distinguish drafts from sent communication.",
        groups=("meetings", "activities"), roles=frozenset({"admin", "sales_manager", "sales_rep"}),
        completion="The requested meeting artifact or action is complete and grounded in supplied context.",
    ),
    _skill(
        "reports", "Explain and navigate to CRM reports without inventing metrics.",
        goal="Answer reporting requests from authorized, current data.",
        instructions="State missing data plainly; never fabricate totals or cross-service joins.",
        groups=("reports",), roles=ALL_ROLES,
        completion="The requested report is opened/explained, or its unavailable data dependency is explicit.",
    ),
)


def package_for(spec: SkillSpec) -> SkillPackage:
    tools = frozenset().union(*(MCP_GROUPS[group] for group in spec.allowed_mcp_groups))
    return SkillPackage(
        spec=spec,
        canonicalPromptFragment=sectioned_system_prompt(
            role=spec.role,
            goal=spec.goal,
            instructions=spec.instructions,
            context=spec.context,
            output=spec.output,
            guardrails=spec.guardrails,
        ),
        allowedTools=tuple(sorted(tools)),
    )

