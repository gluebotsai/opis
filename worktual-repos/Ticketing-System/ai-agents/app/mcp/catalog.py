"""MCP tool catalog — single source of truth built from registry + shared JSON."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.contracts.tools import ToolDefinition
from app.tools.registry import (
    MODULE_SURFACE_TOOLS,
    TOOL_ALLOWLIST,
    tool_meta,
    tools_for_agent,
    tools_for_module,
)


_ROOT = Path(__file__).resolve().parents[3]
_CATALOG_PATH = _ROOT / "shared" / "ticketing_tool_catalog.json"

ROUTE_TO_AGENT = ToolDefinition(
    name="route_to_agent",
    description=(
        "Hand the conversation to the specialist that owns the user's capability "
        "intent (not the verb alone). "
        "tickets=ticket work/KPIs/reassign/escalate/create-ticket; "
        "customers=directory/add-customer; teams=queues/members; "
        "kb=articles/categories; macros=canned replies; "
        "admin=priority/status catalog, analytics/CSAT/audit/org prefs; "
        "general=greetings/help only. "
        "agent_name must be one of: tickets, customers, teams, kb, macros, admin, general."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "agent_name": {
                "type": "string",
                "enum": [
                    "tickets",
                    "customers",
                    "teams",
                    "kb",
                    "macros",
                    "admin",
                    "general",
                ],
            },
            "query": {"type": "string"},
        },
        "required": ["agent_name", "query"],
    },
    kind="route",
    risk="low",
)
ROUTE_TO_DOMAIN = ToolDefinition(
    name="route_to_domain",
    description=(
        "Route a new natural-language Ticketing task to exactly one registered "
        "Domain. Do not use this for active task continuation."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "domain_id": {
                "type": "string",
                "enum": [
                    "intake_deflection_domain",
                    "triage_routing_domain",
                    "resolution_lifecycle_domain",
                    "knowledge_domain",
                    "catalog_administration_domain",
                ],
            },
            "query": {"type": "string"},
        },
        "required": ["domain_id", "query"],
    },
    kind="route",
    risk="low",
)


def delegate_to_executor_tool(domain_id: str) -> ToolDefinition:
    from app.runtime.supervisor import executors_for_domain
    from app.skills.catalog import skills_for_executor

    executors = list(executors_for_domain(domain_id))
    skills = sorted(
        {
            skill.name
            for executor in executors
            for skill in skills_for_executor(executor)
        }
    )
    return ToolDefinition(
        name="delegate_to_executor",
        description=(
            "Select the registered Executor, canonical task id, and Skill that "
            "together own the requested operation. Selection must match the "
            "Domain registry."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "executor_id": {"type": "string", "enum": executors},
                "task_id": {"type": "string"},
                "skill_name": {"type": "string", "enum": skills},
                "objective": {"type": "string"},
                "supplied_fields": {"type": "object"},
            },
            "required": [
                "executor_id",
                "task_id",
                "skill_name",
                "objective",
            ],
        },
        kind="route",
        risk="low",
    )

_NAVIGATE_VIEWS = [
    "create-ticket",
    "tickets-list",
    "agent-queues",
    "customers",
    "kb",
    "macros",
    "priorities",
    "dashboard",
    "analytics",
    "csat-reports",
    "audit",
    "escalation-directory",
    "org-preferences",
]

_LOCAL_UI_TOOLS: dict[str, ToolDefinition] = {
    "navigate": ToolDefinition(
        name="navigate",
        description="Open a CRM view (e.g. create-ticket) so the guided progress panel is visible.",
        input_schema={
            "type": "object",
            "properties": {
                "view": {"type": "string", "enum": _NAVIGATE_VIEWS},
            },
            "required": ["view"],
        },
        kind="ui_directive",
        risk="low",
    ),
    "open_customer_import": ToolDefinition(
        name="open_customer_import",
        description=(
            "Open the chat file picker so the admin can upload a customer/contact "
            "import file (CSV, TSV, or Excel). Call when they ask to import "
            "customers or contacts and no csv_text is already available. "
            "Then navigate to customers. Do not call import_customers until "
            "csv_text is present."
        ),
        input_schema={
            "type": "object",
            "properties": {},
        },
        kind="ui_directive",
        risk="low",
    ),
    "patch_ticket_draft": ToolDefinition(
        name="patch_ticket_draft",
        description=(
            "Merge fields into the create-ticket draft and update the right-hand progress panel. "
            "Pass real field values only (customerName, contact/email/phone, issue). "
            "For corrections without a new value, pass awaiting only (e.g. awaiting=name) "
            "and ask the user for the new value — never store phrases like "
            "'change the name' as customerName. "
            "After contact is patched, call verify_ticket_customer before issue/enrich "
            "(no user confirm step before verify). When verify returns exists=true, "
            "ask for the issue immediately — do not ask to confirm the customer match. "
            "Subject/description/queue are polished post-insert by triage Domain, not in chat."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "customerName": {"type": "string"},
                "contact": {"type": "string"},
                "customerEmail": {"type": "string"},
                "customerPhone": {"type": "string"},
                "issue": {"type": "string"},
                "subject": {"type": "string"},
                "description": {"type": "string"},
                "priority": {"type": "string"},
                "queue": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_team_draft": ToolDefinition(
        name="patch_team_draft",
        description="Merge fields into the create-team / add-members draft (name, description, members).",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "members": {"type": "array", "items": {"type": "string"}},
                "members_skipped": {"type": "boolean"},
                "team": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_kb_draft": ToolDefinition(
        name="patch_kb_draft",
        description="Merge fields into the create-KB draft (title, category, body).",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "category": {"type": "string"},
                "body": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_macro_draft": ToolDefinition(
        name="patch_macro_draft",
        description="Merge fields into the create-macro draft (title, body).",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_customer_draft": ToolDefinition(
        name="patch_customer_draft",
        description="Merge fields into the create-customer draft (name, email, phone).",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "accountName": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_priority_draft": ToolDefinition(
        name="patch_priority_draft",
        description="Merge fields into the create-priority draft (displayName, resolutionHours).",
        input_schema={
            "type": "object",
            "properties": {
                "displayName": {"type": "string"},
                "name": {"type": "string"},
                "label": {"type": "string"},
                "resolutionHours": {"type": "number"},
                "hours": {"type": "number"},
                "awaiting": {"type": "string"},
                "step": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_status_draft": ToolDefinition(
        name="patch_status_draft",
        description="Merge fields into the create-status draft (displayName).",
        input_schema={
            "type": "object",
            "properties": {
                "displayName": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_escalate_draft": ToolDefinition(
        name="patch_escalate_draft",
        description="Merge fields into the escalate draft (ticket_number, assignee, note).",
        input_schema={
            "type": "object",
            "properties": {
                "ticket_number": {"type": "string"},
                "assignee": {"type": "string"},
                "note": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
    "patch_reassign_draft": ToolDefinition(
        name="patch_reassign_draft",
        description=(
            "Merge fields into the reassign draft (ticket_number, target_role, person)."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "ticket_number": {"type": "string"},
                "target_role": {"type": "string"},
                "person": {"type": "string"},
                "awaiting": {"type": "string"},
            },
        },
        kind="draft_patch",
        risk="low",
    ),
}


def _kind_for(name: str, meta: dict[str, Any] | None) -> str:
    meta = meta or {}
    if name.startswith("patch_") or name.endswith("_draft"):
        return "draft_patch"
    if name.startswith("propose_"):
        return "propose"
    if name in {"navigate", "open_customer_import", "set_filter", "clear_filters", "set_workspace"}:
        return "ui_directive"
    if meta.get("confirm") or meta.get("write"):
        return "mutation"
    return "read"


@lru_cache
def load_shared_catalog() -> dict[str, Any]:
    if not _CATALOG_PATH.exists():
        return {"schema_version": "1.0", "tools": []}
    return json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))


def clear_catalog_caches() -> None:
    """Drop cached catalog after shared JSON / description edits (tests/reload)."""
    load_shared_catalog.cache_clear()
    catalog_by_name.cache_clear()


@lru_cache
def catalog_by_name() -> dict[str, ToolDefinition]:
    out: dict[str, ToolDefinition] = {ROUTE_TO_AGENT.name: ROUTE_TO_AGENT}
    out.update(_LOCAL_UI_TOOLS)
    shared = load_shared_catalog()
    for item in shared.get("tools") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        meta = tool_meta_safe(name)
        # Prefer richer local UI schemas when both exist
        if name in _LOCAL_UI_TOOLS:
            continue
        out[name] = ToolDefinition(
            name=name,
            description=str(item.get("description") or name),
            input_schema=item.get("input_schema")
            or {"type": "object", "properties": {}},
            kind=_kind_for(name, meta),  # type: ignore[arg-type]
            risk=str((meta or {}).get("risk") or "low"),
            requires_confirm=bool((meta or {}).get("confirm")),
        )
    # Ensure registry tools missing from shared catalog still appear
    for agent, names in TOOL_ALLOWLIST.items():
        for name in names:
            if name in out:
                continue
            meta = tool_meta_safe(name)
            out[name] = ToolDefinition(
                name=name,
                description=str((meta or {}).get("description") or name),
                input_schema={"type": "object", "properties": {}},
                kind=_kind_for(name, meta),  # type: ignore[arg-type]
                risk=str((meta or {}).get("risk") or "low"),
                requires_confirm=bool((meta or {}).get("confirm")),
                agents=[agent],
            )
    return out


def tool_meta_safe(name: str) -> dict[str, Any]:
    try:
        return dict(tool_meta(name) or {})
    except Exception:
        return {}


def tools_for_specialist(
    agent: str,
    *,
    module: str | None = None,
    surface: str | None = None,
    include_route: bool = False,
) -> list[ToolDefinition]:
    from app.tools.registry import module_matches_agent

    allowed = set(tools_for_agent(agent))
    # Scope by page only when the page module matches this specialist.
    # Cross-module handoffs (e.g. dashboard → tickets) keep the full agent allowlist.
    if module and module_matches_agent(module, agent):
        allowed &= set(tools_for_module(module, surface))
    catalog = catalog_by_name()
    tools = [catalog[name] for name in sorted(allowed) if name in catalog]
    if include_route:
        tools = [ROUTE_TO_AGENT, *tools]
    return tools


def list_catalog_public(
    *,
    allowed_names: set[str] | None = None,
) -> list[dict[str, Any]]:
    catalog = catalog_by_name()
    names = set(catalog.keys()) if allowed_names is None else allowed_names
    rows = _cached_public_catalog(
        tuple(sorted(names)),
        catalog_schema_version(),
    )
    return [json.loads(row) for row in rows]


@lru_cache
def catalog_schema_version() -> str:
    raw = _CATALOG_PATH.read_bytes() if _CATALOG_PATH.is_file() else b""
    registry_names = "\n".join(
        sorted({name for names in TOOL_ALLOWLIST.values() for name in names})
    )
    return hashlib.sha256(raw + registry_names.encode("utf-8")).hexdigest()


@lru_cache(maxsize=512)
def _cached_public_catalog(names: tuple[str, ...], version: str) -> tuple[str, ...]:
    del version
    catalog = catalog_by_name()
    rows: list[str] = []
    for name in names:
        tool = catalog.get(name)
        if not tool or name == "route_to_agent":
            continue
        rows.append(
            json.dumps(
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                    "kind": tool.kind,
                    "risk": tool.risk,
                    "requires_confirm": tool.requires_confirm,
                },
                sort_keys=True,
            )
        )
    return tuple(rows)


# Re-export module surface map for MCP auth intersection
MODULE_SURFACE_TOOLS_REF = MODULE_SURFACE_TOOLS
