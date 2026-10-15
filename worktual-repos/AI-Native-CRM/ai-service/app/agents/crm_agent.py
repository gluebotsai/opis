"""
CRM co-worker super-agent / orchestrator.

Deterministic intent router that dispatches to module specialist agents.
Never executes CRM mutations — only proposes patches / toolProposals / actions.

PARALLEL B2B/B2C WORK: high-touch shared file - coordinate before editing.
Both business-type tracks extend the same module routing / business_type
gates here. Log changes in docs/parallel-work-log.md and re-run the
ai-service pytest suite + a manual B2B/B2C coworker smoke test after any
merge (see docs/merge-validation-checklist.md) - a clean git merge does not
guarantee correct behavior in this file.
"""

from __future__ import annotations

import re
from typing import Any, TypedDict, Optional

from app.agents.native_pipeline import run_steps

from app.agents import (
    chat_agent,
    company_coworker_agent,
    company_draft_agent,
    contact_coworker_agent,
    contact_draft_agent,
    deal_coworker_agent,
    deal_draft_agent,
    link_module_coworker_agent,
    misc_draft_agents,
    page_assist_agent,
    product_coworker_agent,
    proposal_coworker_agent,
    quote_coworker_agent,
)
from app.agent_log import fmt, logger, patch_keys, tool_names, trace
from app.agents.coworker_shared import (
    LLM_ERROR_SPEECH,
    build_conversation_prompt,
    classify_coworker_intent,
    drop_non_llm_speech,
    extract_suggestions,
    is_generic_coworker_speech,
    last_assistant_text,
    last_user_text,
    parse_assistant_json,
    sanitize_assistant_text_for_user,
    should_commit_native_turn,
    strip_internal_workspace_sentences,
    utterance_looks_like_command,
)
from app.agents.crm_tools import run_native_agent_turn
from app.agents.nav_routing import (
    configuration_sub_href,
    fuzzy_module_from_text,
    infer_sales_module_from_label,
    navigation_clarification,
)
from app.agents.draft_conversation import (
    CONTACT_FIRST_NAME_Q,
    is_field_add_not_create,
    open_in_shell_create,
    parse_contact_count_reply,
)

# Legacy JSON prompt kept as fallback when native tools are unavailable
AGENT_TURN_SYSTEM = f"""Role:
You are a warm, communicative CRM colleague talking with the user in chat.
Always talk with the user — never reply with only "On it." or a bare status.

Goal:
Help the user create records and navigate CRM modules through conversation. Acknowledge, then take the next step.
When a draft is ready, briefly recap and ask if you should save — never coach "type yes" or "say skip".

Instructions:
- Sound human: acknowledge what they said, then guide. Never mention tools, routing, or set_workspace.
- Ask at most one natural question at a time — never form labels like "Email:" or "First Name:".
- Create vs update: "add a phone/email/title/amount/…" means UPDATE an existing record. Open create only for a clearly NEW record.
- If the destination is unclear or not a real page, ask a short clarifying question — do NOT guess a URL.
- Never invent IDs unless provided in context.entityId
- Never claim you already saved/updated data
- Never tell the user to click Create on the form — confirm save naturally in chat
- Only greet once at the start — never re-greet mid-flow
- Never narrate internal validation, lookups, opening create, or the workspace/right pane
- toolProposals optional, max 3
- set_workspace — ONLY when context.module is already that in-shell module (contact, sales, company, product, finance, activities, quotes). args: {{ mode: "list"|"create"|"detail", entityId?, seedPrompt?, search?, location?, leadSource?, owner?, stage?, leadStatus?, company?, email?, phone?, createdOn?, auto? }}. On Contacts, a filter uses mode list and only the fields the user named. createdOn is YYYY-MM-DD. Do not say the list is filtered unless this tool is in the same turn.
- navigate — use for ANY other module or page (lists AND creates). args: {{ href, seedPrompt?, auto? }}.
  Allowed hrefs ONLY: /dashboard, /contact, /contact/new, /company, /company/new, /product, /product/new,
  /sales, /sales/new, /sales/quotes, /sales/quotes/new, /sales/calendar, /finance, /finance/new,
  /inbox, /activities, /activities/log, /commerce, /configuration/email, /reports, /agents,
  /process-approvals, /service, /marketing/dashboard, /marketing/campaigns, /marketing/create, /marketing/seo.
  Never invent paths like /calendar — sales calendar is /sales/calendar.
- propose_stage_change — args: {{ dealId, stage, auto? }} (when the user asked in chat, set auto:true so it runs without a Confirm button)
- propose_create_contact — args: {{ label? }} (contact create when name+email ready and user agrees to save)
- propose_import_contacts — args: {{ csvText?, sample?, label? }} (chat import only after they pasted/attached CSV or asked to import the sample. Never open a dialog. Never ask paste vs template. First reply with CSV Instructions link — do not paste raw CSV into chat.)
- propose_update_contact — args: {{ contactId, firstName?, lastName?, email?, phone?, title?, notes?, city?, country?, addressLine? }}
- propose_delete_contact — args: {{ contactId, displayName? }} (after user confirms delete in chat)
- propose_update_company — args: {{ companyId, name?, domain?, industry?, linkedinUrl?, employeeCount? }} (company fields on an open contact)
- open_entity — args: {{ href }} (same allowlist)

Context:
(runtime conversation catalog is provided in the user message)

Output:
Reply with ONLY valid JSON:
{{"assistantText":"…","toolProposals":[{{"id":"t1","name":"navigate","label":"Open contacts","args":{{"href":"/contact","auto":true}},"risk":"low"}}]}}

Guardrails:
- Do not invent URLs outside the allowlist.
- Do not invent entity IDs.
- Do not claim a record was saved until the user agrees in chat.
- Do not tell users to type magic words like "create", "yes", or "skip".
- Do not open create when the user only wants to add/change a field on an existing record.
- Act on clear simple intents; only ask clarification when genuinely ambiguous.
"""

# module → (create_href, label, place_name, first_question)
IN_SHELL_CREATE: dict[str, tuple[str, str, str, str]] = {
    "contact": (
        "/contact/new",
        "Create contact",
        "Contacts",
        CONTACT_FIRST_NAME_Q,
    ),
    "sales": (
        "/sales/new",
        "Create deal",
        "Sales",
        "Happy to. What should we call this deal?",
    ),
    "company": (
        "/company/new",
        "Create company",
        "Companies",
        "Sure thing — what's the company name?",
    ),
    "product": (
        "/product/new",
        "Create product",
        "Products",
        "Let's add it. What's the product called?",
    ),
    "finance": (
        "/finance/new",
        "Create invoice",
        "Finance",
        "I can do that. Which deal should this invoice go with?",
    ),
    "activities": (
        "/activities/log",
        "Log activity",
        "Activities",
        "Happy to log it. Who is this about?",
    ),
    "quotes": (
        "/sales/quotes/new",
        "Create quote",
        "Quotes",
        "Sure — which deal is this quote for?",
    ),
}

# List / home routes for "go to contacts" style intents
MODULE_LIST_HREF: dict[str, str] = {
    "contact": "/contact",
    "sales": "/sales",
    "company": "/company",
    "product": "/product",
    "finance": "/finance",
    "activities": "/activities",
    "quotes": "/sales/quotes",
    "calendar": "/sales/calendar",
    "dashboard": "/dashboard",
    "inbox": "/inbox",
    "reports": "/reports",
    "marketing": "/marketing/dashboard",
    "agents": "/agents",
    "commerce": "/commerce",
    "service": "/service",
    "configuration": "/configuration/email",
}

# Only these app paths may be navigated to (plus nested :id routes under them).
ALLOWED_NAV_PREFIXES: tuple[str, ...] = (
    "/dashboard",
    "/contact",
    "/company",
    "/product",
    "/sales",
    "/finance",
    "/inbox",
    "/activities",
    "/commerce",
    "/configuration",
    "/reports",
    "/agents",
    "/process-approvals",
    "/service",
    "/marketing",
)

# Common wrong/short paths the model might invent → real routes
NAV_ALIASES: dict[str, str] = {
    "/calendar": "/sales/calendar",
    "/quotes": "/sales/quotes",
    "/quote": "/sales/quotes",
    "/deals": "/sales",
    "/pipeline": "/sales",
    "/companies": "/company",
    "/contacts": "/contact",
    "/products": "/product",
    "/invoices": "/finance",
    "/billing": "/finance",
    "/home": "/dashboard",
    "/settings": "/configuration/email",
    "/config": "/configuration/email",
    "/email": "/configuration/email",
}

HREF_TO_IN_SHELL_MODULE = {v[0]: k for k, v in IN_SHELL_CREATE.items()}


def normalize_nav_href(href: str) -> str | None:
    """Map aliases and allow only real CRM routes. Returns None if unknown."""
    raw = (href or "").strip()
    if not raw.startswith("/") or raw.startswith("//"):
        return None
    path = raw.split("?")[0].split("#")[0] or "/"
    query = raw[len(path) :] if "?" in raw else ""
    path = NAV_ALIASES.get(path, path)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    allowed = any(
        path == prefix or path.startswith(prefix + "/")
        for prefix in ALLOWED_NAV_PREFIXES
    )
    if not allowed:
        return None
    return path + query


class CrmAgentState(TypedDict, total=False):
    intent: str
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    session_memory: dict[str, Any]
    organization_id: Optional[str]
    role: Optional[str]
    business_type: Optional[str]
    acting_user_id: Optional[str]
    mcp_base_url: Optional[str]
    result: dict[str, Any]


def _is_help_question(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(what can you|what do you|capabilities|how do (you|i)|explain (this|the)|"
            r"help\?|who are you|what are you)\b",
            lower,
        )
    )


def _wants_create(lower: str) -> bool:
    """True when the user is asking to start a create/log flow — not edit/help."""
    if _is_help_question(lower):
        return False
    if re.search(r"\b(edit|update|change|modify|rename)\b", lower):
        return False
    if is_field_add_not_create(lower):
        return False
    # Schedule/book a meeting/call (common on pipeline chat)
    if re.search(
        r"\b(schedule|book|arrange|set\s*up)\b.{0,40}\b"
        r"(meeting|call|appointment|demo|visit|sync)\b|"
        r"\b(meeting|call|appointment|demo)\s+(with|for|against)\b",
        lower,
    ):
        return True
    if re.search(
        r"\b(create|new|start|make|draft|register|set\s*up|insert)\b|"
        r"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|register|insert|schedule|book)\b|"
        r"\blog\b",
        lower,
    ):
        return True
    # "add/want/need <noun>" — don't hand-enumerate every misspelling of the
    # noun; the shared fuzzy matcher (nav_routing) already recognizes typo'd
    # module keywords (finacnce, prodcut, …), so reuse it here too.
    if re.search(
        r"\badd\s+(a\s+|an\s+|new\s+)?[a-z]{3,}\b|"
        r"\b(want|need)\s+(a|an)\s+(new\s+)?[a-z]{3,}\b",
        lower,
    ):
        if re.search(r"\blocations?\b", lower):
            return True
        return bool(fuzzy_module_from_text(lower))
    return False


def _set_workspace_create(
    text: str, label: str, first_question: str
) -> dict[str, Any]:
    return open_in_shell_create(
        text,
        label=label,
        first_question=first_question,
    )


def _navigate_create(
    text: str, href: str, label: str, place_name: str
) -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            f"I'll take you over to **{place_name}** so we can set that up."
        ),
        "toolProposals": [
            {
                "id": f"nav-{label.split()[-1].lower()}",
                "name": "navigate",
                "label": label,
                "args": {
                    "href": href,
                    "seedPrompt": text.strip()[:2000],
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


def _infer_module_from_label(label: str) -> str | None:
    return infer_sales_module_from_label(label)


def _explicit_module_mention(lower: str) -> str | None:
    return infer_sales_module_from_label(lower)


def _navigate_to_href(href: str, *, label: str, speech: str) -> dict[str, Any]:
    normalized = normalize_nav_href(href)
    if not normalized:
        return _clarify_destination()
    return {
        "ok": True,
        "assistantText": speech,
        "toolProposals": [
            {
                "id": f"nav-{label.replace(' ', '-').lower()[:24]}",
                "name": "navigate",
                "label": label,
                "args": {"href": normalized, "auto": True},
                "risk": "low",
            }
        ],
    }


def _clarify_destination() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Happy to take you there — which area did you mean? "
            "Contacts, Sales pipeline, Sales calendar, Companies, Products, "
            "Finance, Activities, Inbox, or Dashboard?"
        ),
    }


def _navigate_to_module(
    target_mod: str, *, mode: str = "list", seed: str = ""
) -> dict[str, Any]:
    place_names = {
        "calendar": "Sales calendar",
        "configuration": "Configuration",
        "commerce": "Commerce",
        "service": "Service",
        "agents": "Agents",
    }
    place = (
        IN_SHELL_CREATE[target_mod][2]
        if target_mod in IN_SHELL_CREATE
        else place_names.get(target_mod, target_mod.replace("_", " ").title())
    )
    if mode == "create" and target_mod in IN_SHELL_CREATE:
        href, label, place_name, _q = IN_SHELL_CREATE[target_mod]
        return _navigate_create(seed or f"Open {place}", href, label, place_name)
    href = MODULE_LIST_HREF.get(target_mod)
    if not href:
        return _clarify_destination()
    href = normalize_nav_href(href)
    if not href:
        return _clarify_destination()
    return {
        "ok": True,
        "assistantText": f"Sure — taking you to **{place}**.",
        "toolProposals": [
            {
                "id": f"nav-{target_mod}",
                "name": "navigate",
                "label": f"Open {place}",
                "args": {"href": href, "auto": True},
                "risk": "low",
            }
        ],
    }


def _is_show_or_clear_list_intent(lower: str) -> bool:
    """True for 'show all contacts', 'show list', 'clear search' — not bare navigation."""
    return bool(
        re.search(
            r"\b(show|list)\b.+\b(all|list|board|pipeline)\b|"
            r"\b(show|list)\s+(all\s+)?(contacts?|companies|deals?|products?|"
            r"invoices?|quotes?|activit)|"
            r"\b(back|return)\s+to\s+(the\s+)?(list|board|pipeline|contacts?|"
            r"companies|deals?|products?)\b|"
            r"\b(show list|list view|clear (the\s+)?(search|filter|filters))\b",
            lower,
        )
    )


def resolve_go_to_module(text: str, mod: str) -> dict[str, Any] | None:
    """Handle 'move to contacts', 'go to sales', 'open calendar', etc."""
    lower = text.lower().strip()
    if _wants_create(lower):
        return None
    mentioned = _explicit_module_mention(lower)
    # "show list" / "show all contacts" reset the current module.
    # "show companies" from Contacts is a page change.
    same_module_show = _is_show_or_clear_list_intent(lower) and (
        not mentioned or mentioned == mod
    )
    if same_module_show:
        return None
    go_intent = bool(
        re.search(
            r"\b(move|go|switch|take|open|show|bring)\b.+\b(to|into)?\b|"
            r"\b(open|show)\s+(the\s+)?(contacts?|companies|deals?|sales|pipeline|"
            r"products?|invoices?|finance|quotes?|activit|dashboard|inbox|reports?|"
            r"marketing|calendar|agents?|commerce|service|configuration|settings)\b|"
            r"\b(move|go|switch)\s+to\b",
            lower,
        )
    )
    if not go_intent:
        return None

    clarify = navigation_clarification(lower)
    if clarify:
        return {"ok": True, "assistantText": clarify}

    config_href = configuration_sub_href(lower)
    if config_href:
        place = config_href.rsplit("/", 1)[-1].replace("-", " ").title()
        return _navigate_to_href(
            config_href,
            label=f"Open {place}",
            speech=f"Sure — opening **{place}** in Configuration.",
        )

    target = _explicit_module_mention(lower)
    if not target:
        # Explicit "go/move/switch to …" with no known module → ask.
        # "open Acme" / "show Yaswanth" must reach specialists (entity open).
        if re.search(r"\b(go|move|switch)\s+to\b", lower):
            return _clarify_destination()
        return None
    # Already on that module — don't swallow "show all …" (must clear filters)
    if target == mod or (
        target == "quotes" and mod in ("quotes", "sales") and "quote" in lower
    ):
        if target == mod:
            if _is_show_or_clear_list_intent(lower):
                return None
            place = (
                IN_SHELL_CREATE[mod][2]
                if mod in IN_SHELL_CREATE
                else mod.title()
            )
            return {
                "ok": True,
                "assistantText": f"You're already on **{place}** — what would you like to do here?",
            }
    return _navigate_to_module(target, mode="list")


def _explicit_create_target(lower: str) -> str | None:
    if configuration_sub_href(lower):
        return None
    if navigation_clarification(lower):
        return None
    # "schedule a demo for an existing contact" is an activity. The word
    # "contact" must not open a new contact draft.
    if re.search(
        r"\b(schedule|book|arrange)\b.{0,48}\b"
        r"(meeting|call|appointment|demo|visit|sync)\b|"
        r"\b(demo|meeting|call|appointment)\s+(with|for)\b",
        lower,
    ):
        return "activities"
    explicit = [
        (r"\b(contact|lead|person|people)\b", "contact"),
        (r"\b(compan(y|ies)|account|organization|org)\b", "company"),
        (r"\b(deal|opportunit(y|ies)|pipeline)\b", "sales"),
        (r"\bquot(?:e|ation)s?\b", "quotes"),
        (r"\b(products?|sku|catalog)\b", "product"),
        (r"\b(invoice|bill|finance|financ(e|ial))\b", "finance"),
        # Schedule / meetings / calls → activity log (before bare "sales")
        (
            r"\b(activit(y|ies)|call|meeting|task|note|appointment|demo|"
            r"schedul(?:e|ing)|calendar)\b",
            "activities",
        ),
    ]
    for re_pat, target_mod in explicit:
        if re.search(re_pat, lower):
            return target_mod
    # Typo-tolerant fallback (e.g. "procduct", "finacnce") — one shared
    # matcher instead of hand-enumerating every misspelling per module.
    fuzzy = fuzzy_module_from_text(lower)
    if fuzzy in IN_SHELL_CREATE:
        return fuzzy
    return None


def _is_cross_module_navigate(
    result: dict[str, Any] | None, mod: str
) -> bool:
    """True when the turn navigates away from the current in-shell module."""
    if not isinstance(result, dict):
        return False
    m = (mod or "").lower()
    for tool in result.get("toolProposals") or []:
        if not isinstance(tool, dict) or tool.get("name") != "navigate":
            continue
        href = str((tool.get("args") or {}).get("href") or "").split("?")[0]
        if not href.startswith("/"):
            continue
        target_mod = HREF_TO_IN_SHELL_MODULE.get(href)
        if target_mod and target_mod != m:
            return True
        if href.startswith("/sales") and m != "sales":
            return True
    return False


def _create_is_in_shell(mod: str, href: str, pathname: str = "") -> bool:
    target_mod = HREF_TO_IN_SHELL_MODULE.get(href.split("?")[0])
    if not target_mod:
        return False
    if mod == target_mod:
        return True
    # Quotes list uses moduleId=quotes; also treat /sales/quotes* as quotes shell
    if target_mod == "quotes" and (
        mod == "quotes" or pathname.startswith("/sales/quotes")
    ):
        return True
    return False


def _is_company_detail(pathname: str) -> bool:
    """True for /company/:id (not the companies list)."""
    path = (pathname or "").split("?")[0].rstrip("/")
    return bool(re.match(r"^/company/[^/]+$", path)) and path != "/company/new"


def _wants_location_create(lower: str) -> bool:
    return bool(
        re.search(r"\b(locations?|branch|hq|headquarters)\b", lower)
    ) and _wants_create(lower)


def resolve_create_navigate(
    text: str, mod: str, pathname: str = ""
) -> dict[str, Any] | None:
    lower = text.lower()
    if not _wants_create(lower):
        return None

    # Proposal documents attach to deals — never open vague deal-create here.
    from app.agents.deal_coworker_agent import _wants_create_proposal

    if _wants_create_proposal(lower):
        return None

    # Company detail: Add location opens in-shell location draft (not company create)
    if _is_company_detail(pathname) and (
        _wants_location_create(lower)
        or (
            mod == "company"
            and not re.search(r"\b(compan(y|ies)|account|contact|deal)\b", lower)
        )
    ):
        return _set_workspace_create(
            text,
            "Add location",
            "Sure — what's the location name?",
        )

    target_mod = _explicit_create_target(lower)
    if target_mod:
        href, label, place_name, first_q = IN_SHELL_CREATE[target_mod]
        if _create_is_in_shell(mod, href, pathname):
            return _set_workspace_create(text, label, first_q)
        return _navigate_create(text, href, label, place_name)

    # Vague "create" / "add" while already on an in-shell module
    if mod in IN_SHELL_CREATE and re.search(
        r"\b(create|add|new|start|make|draft|log|register|set up)\b|"
        r"\bhelp me (to )?(create|add|make|draft|log|start|set up)\b",
        lower,
    ):
        # On company detail, vague add → location (handled above); list stays company
        if mod == "company" and _is_company_detail(pathname):
            return _set_workspace_create(
                text,
                "Add location",
                "Sure — what's the location name?",
            )
        href, label, _place, first_q = IN_SHELL_CREATE[mod]
        return _set_workspace_create(text, label, first_q)
    if mod == "dashboard" and re.search(
        r"\b(deal|opportunit|pipeline)\b", lower
    ):
        href, label, place_name, _q = IN_SHELL_CREATE["sales"]
        return _navigate_create(text, href, label, place_name)
    return None


def resolve_cross_module_create(
    text: str, mod: str, pathname: str = ""
) -> dict[str, Any] | None:
    """Route create intents aimed at a *different* module before draft fill."""
    lower = text.lower()
    if not _wants_create(lower):
        return None
    target_mod = _explicit_create_target(lower)
    if not target_mod:
        return None
    href, label, place_name, first_q = IN_SHELL_CREATE[target_mod]
    if _create_is_in_shell(mod, href, pathname):
        return None
    return _navigate_create(text, href, label, place_name)


def sanitize_tool_proposals(
    raw: Any, user_text: str, mod: str, pathname: str = ""
) -> list[dict[str, Any]] | None:
    if not isinstance(raw, list):
        return None
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        label = item.get("label")
        if not isinstance(name, str) or not isinstance(label, str):
            continue
        name = name.strip()
        if name not in (
            "navigate",
            "propose_stage_change",
            "propose_create_contact",
            "propose_import_contacts",
            "propose_update_contact",
            "propose_delete_contact",
            "propose_create_deal",
            "propose_update_deal",
            "propose_reassign_deal_owner",
            "propose_delete_deal",
            "propose_create_company",
            "propose_update_company",
            "propose_delete_company",
            "propose_create_product",
            "propose_update_product",
            "propose_delete_product",
            "propose_create_invoice",
            "propose_update_invoice",
            "propose_delete_invoice",
            "propose_send_invoice",
            "propose_mark_invoice_paid",
            "propose_create_activity",
            "propose_create_quote",
            "propose_update_quote",
            "propose_delete_quote",
            "propose_send_quote",
            "propose_create_proposal",
            "propose_rewrite_proposal_section",
            "propose_patch_proposal_section",
            "propose_patch_proposal_document_text",
            "propose_rewrite_quote_section",
            "propose_update_document_asset",
            "propose_personalize_proposal",
            "propose_send_proposal",
            "propose_delete_proposal",
            "open_entity",
            "set_workspace",
        ):
            continue
        args = item.get("args") if isinstance(item.get("args"), dict) else {}
        args = dict(args)
        if name == "propose_create_contact":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Create contact",
                    "args": {"auto": True} if auto else {},
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_import_contacts":
            tid = item.get("id")
            import_args: dict[str, Any] = {"auto": True}
            csv_text = str(args.get("csvText") or args.get("csv") or "").strip()
            if csv_text:
                import_args["csvText"] = csv_text[:200_000]
            sample = (
                args.get("sample") is True
                or str(args.get("sample") or "").lower() == "true"
            )
            if not csv_text and not sample:
                continue
            if sample:
                import_args["sample"] = True
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Import contacts",
                    "args": import_args,
                    "risk": "low",
                }
            )
            continue
        if name == "propose_update_contact":
            tid = item.get("id")
            contact_id = str(args.get("contactId") or "").strip()
            if not contact_id:
                continue
            clean_args: dict[str, Any] = {
                "contactId": contact_id,
                "auto": bool(args.get("auto")),
            }
            for key in (
                "firstName",
                "lastName",
                "email",
                "phone",
                "title",
                "notes",
                "city",
                "country",
                "addressLine",
            ):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean_args[key] = val.strip()[:2000]
            if len(clean_args) <= 2:  # only contactId + auto
                continue
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update contact",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_delete_contact":
            tid = item.get("id")
            contact_id = str(args.get("contactId") or "").strip()
            if not contact_id:
                continue
            clean_args = {
                "contactId": contact_id,
                "auto": bool(args.get("auto")),
            }
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Delete contact",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_create_deal":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Create deal",
                    "args": {"auto": True} if auto else {},
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_update_deal":
            tid = item.get("id")
            deal_id = str(args.get("dealId") or "").strip()
            if not deal_id:
                continue
            clean_args = {"dealId": deal_id, "auto": bool(args.get("auto"))}
            for key in ("title", "amount", "notes", "expectedCloseDate"):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean_args[key] = val.strip()[:4000]
                elif isinstance(val, (int, float)) and not isinstance(val, bool):
                    clean_args[key] = str(val)
            if len(clean_args) <= 2:
                continue
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update deal",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_reassign_deal_owner":
            tid = item.get("id")
            deal_id = str(args.get("dealId") or "").strip()
            owner_id = str(args.get("ownerUserId") or "").strip()
            if not deal_id or not owner_id:
                continue
            clean_args = {
                "dealId": deal_id,
                "ownerUserId": owner_id[:80],
                "auto": bool(args.get("auto", True)),
            }
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Reassign owner",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_delete_deal":
            tid = item.get("id")
            deal_id = str(args.get("dealId") or "").strip()
            if not deal_id:
                continue
            clean_args = {"dealId": deal_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Delete deal",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name in (
            "propose_create_company",
            "propose_create_product",
            "propose_create_invoice",
            "propose_create_activity",
            "propose_create_quote",
        ):
            tid = item.get("id")
            auto = bool(args.get("auto"))
            default_labels = {
                "propose_create_company": "Create company",
                "propose_create_product": "Create product",
                "propose_create_invoice": "Create invoice",
                "propose_create_activity": "Log activity",
                "propose_create_quote": "Create quote",
            }
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or default_labels[name],
                    "args": {"auto": True} if auto else {},
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_create_proposal":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            deal_id = str(args.get("dealId") or "").strip()
            if not deal_id:
                continue
            clean_args: dict[str, Any] = {"dealId": deal_id[:80]}
            if auto:
                clean_args["auto"] = True
            title_arg = args.get("title")
            if isinstance(title_arg, str) and title_arg.strip():
                clean_args["title"] = title_arg.strip()[:200]
            hint_arg = args.get("productHint")
            if isinstance(hint_arg, str) and hint_arg.strip():
                clean_args["productHint"] = hint_arg.strip()[:200]
            ids_arg = args.get("productIds")
            if isinstance(ids_arg, list):
                cleaned_ids = [
                    str(x).strip()
                    for x in ids_arg
                    if isinstance(x, (str, int)) and str(x).strip()
                ][:10]
                if cleaned_ids:
                    clean_args["productIds"] = cleaned_ids
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Create proposal",
                    "args": clean_args,
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_personalize_proposal":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            proposal_id = str(args.get("proposalId") or "").strip()
            if not proposal_id:
                continue
            clean_args = {
                "proposalId": proposal_id[:80],
                **({"auto": True} if auto else {}),
            }
            hint = args.get("productHint")
            if isinstance(hint, str) and hint.strip():
                clean_args["productHint"] = hint.strip()[:200]
            raw_ids = args.get("productIds")
            if isinstance(raw_ids, list):
                ids = [str(x).strip() for x in raw_ids if str(x).strip()][:10]
                if ids:
                    clean_args["productIds"] = ids
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Regenerate proposal",
                    "args": clean_args,
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_send_proposal":
            tid = item.get("id")
            proposal_id = str(args.get("proposalId") or "").strip()
            if not proposal_id:
                continue
            clean_args = {"proposalId": proposal_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Share proposal",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_rewrite_proposal_section":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            proposal_id = str(args.get("proposalId") or "").strip()
            section_key = str(args.get("sectionKey") or args.get("section") or "").strip()
            if not proposal_id or not section_key:
                continue
            clean_args = {
                "proposalId": proposal_id[:80],
                "sectionKey": section_key[:64],
            }
            if auto:
                clean_args["auto"] = True
            instruction = args.get("instruction")
            if isinstance(instruction, str) and instruction.strip():
                clean_args["instruction"] = instruction.strip()[:2000]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Rewrite section",
                    "args": clean_args,
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_patch_proposal_document_text":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            proposal_id = str(args.get("proposalId") or "").strip()
            replacements = args.get("textReplacements")
            remove_images = args.get("removeImageAssetIds")
            if not proposal_id:
                continue
            cleaned_rows: list[dict[str, str]] = []
            if isinstance(replacements, list):
                for row in replacements[:12]:
                    if not isinstance(row, dict):
                        continue
                    find = str(row.get("find") or "").strip()
                    if not find:
                        continue
                    cleaned_rows.append(
                        {
                            "find": find[:240],
                            "replace": str(row.get("replace") or "")[:240],
                        }
                    )
            cleaned_images: list[str] = []
            if isinstance(remove_images, list):
                for row in remove_images[:8]:
                    val = str(row or "").strip()
                    if val:
                        cleaned_images.append(val[:64])
            table_raw = args.get("tableBorders")
            table_borders: bool | None = None
            if table_raw is True or str(table_raw).lower() in ("true", "1", "on"):
                table_borders = True
            elif table_raw is False or str(table_raw).lower() in ("false", "0", "off"):
                table_borders = False
            if not cleaned_rows and not cleaned_images and table_borders is None:
                continue
            clean_args: dict[str, Any] = {
                "proposalId": proposal_id[:80],
                "textReplacements": cleaned_rows,
            }
            if cleaned_images:
                clean_args["removeImageAssetIds"] = cleaned_images
            if table_borders is not None:
                clean_args["tableBorders"] = table_borders
            page_id = str(args.get("pageId") or "").strip()
            if page_id:
                clean_args["pageId"] = page_id[:64]
            if auto:
                clean_args["auto"] = True
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update document text",
                    "args": clean_args,
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_patch_proposal_section":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            proposal_id = str(args.get("proposalId") or "").strip()
            section_key = str(args.get("sectionKey") or args.get("section") or "").strip()
            if not proposal_id or not section_key:
                continue
            clean_args: dict[str, Any] = {
                "proposalId": proposal_id[:80],
                "sectionKey": section_key[:64],
            }
            if auto:
                clean_args["auto"] = True
            for key in ("title", "body"):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean_args[key] = val.strip()[:8000 if key == "body" else 200]
            if len(clean_args) <= 2:
                continue
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update section",
                    "args": clean_args,
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_rewrite_quote_section":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            quote_id = str(args.get("quoteId") or "").strip()
            section_key = str(args.get("sectionKey") or args.get("section") or "").strip()
            if not quote_id or not section_key:
                continue
            clean_args = {
                "quoteId": quote_id[:80],
                "sectionKey": section_key[:64],
            }
            if auto:
                clean_args["auto"] = True
            instruction = args.get("instruction")
            if isinstance(instruction, str) and instruction.strip():
                clean_args["instruction"] = instruction.strip()[:2000]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Rewrite quote section",
                    "args": clean_args,
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_update_document_asset":
            tid = item.get("id")
            auto = bool(args.get("auto"))
            proposal_id = str(args.get("proposalId") or "").strip()
            quote_id = str(args.get("quoteId") or "").strip()
            if not proposal_id and not quote_id:
                continue
            clean_args: dict[str, Any] = {}
            if proposal_id:
                clean_args["proposalId"] = proposal_id[:80]
            if quote_id:
                clean_args["quoteId"] = quote_id[:80]
            asset_id = str(args.get("assetId") or "logo").strip()[:64]
            clean_args["assetId"] = asset_id or "logo"
            if auto:
                clean_args["auto"] = True
            for key in ("imageUrl", "dataBase64", "mime"):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean_args[key] = val.strip()[:2_000_000 if key == "dataBase64" else 2000]
            kind = args.get("kind")
            if isinstance(kind, str) and kind.strip() in ("logo", "image"):
                clean_args["kind"] = kind.strip()
            if not clean_args.get("imageUrl") and not clean_args.get("dataBase64"):
                continue
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update image",
                    "args": clean_args,
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_update_company":
            tid = item.get("id")
            company_id = str(args.get("companyId") or "").strip()
            if not company_id:
                continue
            clean_args = {"companyId": company_id, "auto": bool(args.get("auto"))}
            for key in ("name", "domain", "industry", "notes"):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean_args[key] = val.strip()[:2000]
            if len(clean_args) <= 2:
                continue
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update company",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_delete_company":
            tid = item.get("id")
            company_id = str(args.get("companyId") or "").strip()
            if not company_id:
                continue
            clean_args = {"companyId": company_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Delete company",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_update_product":
            tid = item.get("id")
            product_id = str(args.get("productId") or "").strip()
            if not product_id:
                continue
            clean_args = {"productId": product_id, "auto": bool(args.get("auto"))}
            for key in (
                "name",
                "sku",
                "price",
                "maxDiscountPercent",
                "currency",
                "description",
                "brand",
                "category",
                "subcategory",
                "stockOnHand",
                "productUrl",
                "status",
                "productType",
                "billingType",
                "billingFrequency",
                "tags",
                "imageUrl",
                "galleryUrls",
                "unit",
            ):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean_args[key] = val.strip()[:2000]
                elif isinstance(val, (int, float)) and not isinstance(val, bool):
                    clean_args[key] = str(val)
            if isinstance(args.get("offers"), list):
                clean_args["offers"] = args["offers"]
            if isinstance(args.get("addons"), list):
                clean_args["addons"] = args["addons"]
            if len(clean_args) <= 2:
                continue
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update product",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_delete_product":
            tid = item.get("id")
            product_id = str(args.get("productId") or "").strip()
            if not product_id:
                continue
            clean_args = {"productId": product_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Delete product",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_update_quote":
            tid = item.get("id")
            quote_id = str(args.get("quoteId") or "").strip()
            if not quote_id:
                continue
            from app.agents.draft_conversation import sanitize_quote_update_args

            clean_args = sanitize_quote_update_args(args, quote_id=quote_id)
            if not clean_args:
                continue
            clean_args["auto"] = bool(args.get("auto"))
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update quote",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_send_quote":
            tid = item.get("id")
            quote_id = str(args.get("quoteId") or "").strip()
            if not quote_id:
                continue
            clean_args = {"quoteId": quote_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Send quote",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_delete_quote":
            tid = item.get("id")
            quote_id = str(args.get("quoteId") or "").strip()
            if not quote_id:
                continue
            clean_args = {"quoteId": quote_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Delete quote",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_update_invoice":
            tid = item.get("id")
            invoice_id = str(args.get("invoiceId") or "").strip()
            if not invoice_id:
                continue
            from app.agents.draft_conversation import sanitize_invoice_update_args

            clean_args = sanitize_invoice_update_args(args, invoice_id=invoice_id)
            if not clean_args:
                continue
            clean_args["auto"] = bool(args.get("auto"))
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Update invoice",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_send_invoice":
            tid = item.get("id")
            invoice_id = str(args.get("invoiceId") or "").strip()
            if not invoice_id:
                continue
            clean_args = {"invoiceId": invoice_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Send invoice",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_delete_invoice":
            tid = item.get("id")
            invoice_id = str(args.get("invoiceId") or "").strip()
            if not invoice_id:
                continue
            clean_args = {"invoiceId": invoice_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Delete invoice",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name == "propose_mark_invoice_paid":
            tid = item.get("id")
            invoice_id = str(args.get("invoiceId") or "").strip()
            if not invoice_id:
                continue
            auto = bool(args.get("auto"))
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Mark invoice paid",
                    "args": {
                        "invoiceId": invoice_id,
                        **({"auto": True} if auto else {}),
                    },
                    "risk": "low" if auto else "high",
                }
            )
            continue
        if name == "propose_delete_proposal":
            tid = item.get("id")
            proposal_id = str(args.get("proposalId") or "").strip()
            if not proposal_id:
                continue
            clean_args = {"proposalId": proposal_id, "auto": bool(args.get("auto"))}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                clean_args["displayName"] = display.strip()[:120]
            out.append(
                {
                    "id": (
                        str(tid).strip()[:40]
                        if isinstance(tid, str) and tid.strip()
                        else f"t{len(out)}"
                    ),
                    "name": name,
                    "label": label.strip()[:80] or "Delete proposal",
                    "args": clean_args,
                    "risk": "low" if clean_args.get("auto") else "high",
                }
            )
            continue
        if name in ("navigate", "open_entity"):
            href = normalize_nav_href(str(args.get("href") or "").strip())
            if not href:
                continue
            path = href.split("?")[0]
            # rewrite in-module create → set_workspace
            if _create_is_in_shell(mod, path, pathname):
                name = "set_workspace"
                args = {
                    "mode": "create",
                    "seedPrompt": (
                        str(args.get("seedPrompt") or "").strip()
                        or user_text.strip()[:2000]
                    ),
                    "auto": True,
                }
            else:
                args["href"] = href
                args["auto"] = True
                if isinstance(args.get("seedPrompt"), str):
                    args["seedPrompt"] = args["seedPrompt"].strip()[:2000]
        if name == "set_workspace":
            mode = str(args.get("mode") or "").strip()
            if mode not in ("list", "create", "detail"):
                continue
            args["mode"] = mode
            if isinstance(args.get("seedPrompt"), str):
                args["seedPrompt"] = args["seedPrompt"].strip()[:2000]

            # Cross-module / non-shell pages cannot run set_workspace — use navigate.
            inferred = _infer_module_from_label(label) or (
                mod if mod in IN_SHELL_CREATE else None
            )
            needs_navigate = (
                mod not in IN_SHELL_CREATE
                or (inferred is not None and inferred != mod)
            )
            if needs_navigate and inferred:
                if mode == "create" and inferred in IN_SHELL_CREATE:
                    href = normalize_nav_href(IN_SHELL_CREATE[inferred][0])
                    if not href:
                        continue
                    seed = str(args.get("seedPrompt") or user_text or "").strip()[
                        :2000
                    ]
                    name = "navigate"
                    args = {
                        "href": href,
                        "auto": True,
                        **({"seedPrompt": seed} if seed else {}),
                    }
                else:
                    href = normalize_nav_href(MODULE_LIST_HREF.get(inferred) or "")
                    if not href:
                        continue
                    name = "navigate"
                    args = {"href": href, "auto": True}
            elif needs_navigate and not inferred:
                # Unknown target — drop the tool rather than fail in the UI
                continue
            else:
                args["auto"] = True
        tid = item.get("id")
        out.append(
            {
                "id": str(tid).strip()[:40]
                if isinstance(tid, str) and tid.strip()
                else f"t{len(out)}",
                "name": name,
                "label": label.strip()[:80],
                "args": args,
                "risk": "high" if item.get("risk") == "high" else "low",
            }
        )
    return out[:3] or None


def resolve_show_list(text: str, mod: str) -> dict[str, Any] | None:
    if mod not in IN_SHELL_CREATE:
        return None
    lower = text.lower()
    if not re.search(
        r"\b(show|list|back|return)\b.+\b(list|board|pipeline|all)\b|\bback\s+to\s+(list|board|pipeline)\b|\bshow\s+(all\s+)?(contacts?|companies|deals?|products?|invoices?|quotes?|activit)",
        lower,
    ) and not re.search(r"\b(back to list|show list|list view)\b", lower):
        return None
    mentioned = _explicit_module_mention(lower)
    if mentioned and mentioned != mod:
        return None
    labels = {
        "contact": "Show contacts",
        "sales": "Show pipeline",
        "company": "Show companies",
        "product": "Show products",
        "finance": "Show invoices",
        "activities": "Show activities",
        "quotes": "Show quotes",
    }
    return {
        "ok": True,
        "assistantText": "Alright — showing the full list again. Chat stays right here.",
        "toolProposals": [
            {
                "id": "ws-list",
                "name": "set_workspace",
                "label": labels.get(mod, "Show list"),
                # Empty search clears any leftover filter from prior find/delete flows.
                "args": {"mode": "list", "auto": True, "search": ""},
                "risk": "low",
            }
        ],
    }


def resolve_pending_route(
    user_text: str,
    mod: str,
    pathname: str = "",
    *,
    surface: str = "list",
) -> dict[str, Any] | None:
    """High-confidence go/show/cross-create/create-navigate before LLM specialists."""
    show = resolve_show_list(user_text, mod)
    if show:
        return {
            **show,
            "source": "heuristic",
            "reason": "route_show_list",
        }

    go = resolve_go_to_module(user_text, mod)
    if go:
        if go.get("toolProposals") or go.get("actions") or not is_ai_configured():
            return {
                **go,
                "source": "heuristic",
                "reason": "route_go_to_module",
            }
        # Speech-only (e.g. already on module) — still answer deterministically.
        if str(go.get("assistantText") or "").strip():
            return {**go, "source": "heuristic", "reason": "route_go_to_module"}

    cross = resolve_cross_module_create(user_text, mod, pathname)
    if cross:
        return {
            **cross,
            "source": "heuristic",
            "reason": "route_cross_create",
        }

    create = resolve_create_navigate(user_text, mod, pathname)
    if not create:
        return None

    tools = create.get("toolProposals") or []
    same_create = any(
        t.get("name") == "set_workspace"
        and str((t.get("args") or {}).get("mode") or "") == "create"
        for t in tools
    )
    if same_create and (surface or "") == "create":
        return None
    return {
        **create,
        "source": "heuristic",
        "reason": "route_create_navigate",
    }


def _proposal_href(tool: dict[str, Any]) -> str:
    args = tool.get("args") if isinstance(tool.get("args"), dict) else {}
    return str(args.get("href") or "").split("?")[0].rstrip("/")


def bind_native_module_route(
    result: dict[str, Any] | None,
    *,
    user_text: str,
    module: str,
    pathname: str = "",
    surface: str = "list",
) -> dict[str, Any] | None:
    """Navigation is an LLM tool call. Do not overlay keyword routes."""
    del user_text, module, pathname, surface
    return result


def native_turn_changes_page(
    result: dict[str, Any] | None, pathname: str
) -> bool:
    from app.agents.coworker_shared import result_leaves_current_page

    return result_leaves_current_page(result, pathname=pathname)


def result_from_classified_intent(
    classified: dict[str, Any],
    *,
    user_text: str,
    mod: str,
) -> dict[str, Any] | None:
    """Turn LLM intent into navigate / clarify / cancel. None = continue create."""
    intent = str(classified.get("intent") or "")
    if intent == "continue_create":
        return None
    speech = sanitize_assistant_text_for_user(
        str(classified.get("assistantText") or "")
    ).strip()
    target = str(classified.get("targetModule") or "").strip() or None

    if intent == "cancel":
        return {
            "ok": True,
            "assistantText": speech
            or "Okay — leaving this draft. What would you like to do next?",
            "source": "ai",
            "toolProposals": [
                {
                    "id": "ws-leave-create",
                    "name": "set_workspace",
                    "label": "Show list",
                    "args": {"mode": "list", "auto": True, "search": ""},
                    "risk": "low",
                }
            ],
        }

    if intent == "switch_intent":
        if target and target != (mod or "").lower():
            routed = _navigate_to_module(target, mode="list")
            if speech:
                routed = {**routed, "assistantText": speech, "source": "ai"}
            else:
                routed = {**routed, "source": "ai"}
            return routed
        go = resolve_go_to_module(user_text, mod)
        if go and (go.get("toolProposals") or go.get("actions")):
            if speech:
                return {**go, "assistantText": speech, "source": "ai"}
            return {**go, "source": "ai"}
        return {
            "ok": True,
            "source": "ai",
            "assistantText": speech
            or (
                "Do you want to leave this draft and open another area, "
                "or keep filling this record?"
            ),
        }

    if intent in {"clarify", "query"}:
        return {
            "ok": True,
            "source": "ai",
            "assistantText": speech
            or (
                "Do you want to leave this and open Activities, "
                "or is that the name for this record?"
            ),
        }
    return None


def _route_has_action_tools(route: dict[str, Any] | None) -> bool:
    if not route:
        return False
    for tool in route.get("toolProposals") or []:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or "")
        if name in {"navigate", "set_workspace", "open_entity"}:
            return True
    return bool(route.get("actions"))


def _speech_suggests_wrong_direction(speech: str, route: dict[str, Any]) -> bool:
    """LLM said 'back/return' while route navigates forward or opens create."""
    lower = speech.lower().strip()
    if not lower:
        return False
    if not _route_has_action_tools(route):
        return False
    if re.search(r"\b(back|return|head back|previous view)\b", lower):
        return True
    route_speech = str(route.get("assistantText") or "").lower()
    if route_speech and route_speech[:24] not in lower and lower[:24] not in route_speech:
        for tool in route.get("toolProposals") or []:
            if not isinstance(tool, dict):
                continue
            if tool.get("name") == "navigate":
                return True
    return False


def offline_agent_turn(text: str, ctx: dict[str, Any]) -> dict[str, Any]:
    mod = str(ctx.get("module") or "").lower()
    pathname = str(ctx.get("pathname") or "")
    go = resolve_go_to_module(text, mod)
    if go:
        return go
    show = resolve_show_list(text, mod)
    if show:
        return show
    create = resolve_create_navigate(text, mod, pathname)
    if create:
        return create

    lower = text.lower()
    entity_id = ctx.get("entityId")
    # Prefer proposal *document* over stage when the user said create proposal.
    from app.agents.deal_coworker_agent import _wants_create_proposal

    if (
        (mod == "sales" or "stage" in lower)
        and entity_id
        and not _wants_create_proposal(lower)
        and re.search(
            r"\b(move|change|set|update|advance)\b.+\b(stage|propos|negotiat|qualif|discover|won|lost)\b|"
            r"\bstage\s*(to|as|=|:)",
            lower,
        )
    ):
        stage = "propose"
        if re.search(r"negotiat", lower):
            stage = "negotiate"
        elif re.search(r"discover", lower):
            stage = "discover"
        elif re.search(r"qualif", lower):
            stage = "qualification"
        elif re.search(r"won", lower):
            stage = "closed_won"
        elif re.search(r"lost", lower):
            stage = "closed_lost"
        return {
            "ok": True,
            "assistantText": (
                f"Moving the deal to **{stage.replace('_', ' ')}**."
            ),
            "toolProposals": [
                {
                    "id": "stage",
                    "name": "propose_stage_change",
                    "label": f"Move stage to {stage.replace('_', ' ')}",
                    "args": {
                        "dealId": entity_id,
                        "stage": stage,
                        "auto": True,
                    },
                    "risk": "low",
                }
            ],
        }

    if re.search(r"help|what can you|capabilities|how do", lower):
        return {
            "ok": True,
            "assistantText": (
                "Happy to help — I can walk you through creating a contact, company, deal, "
                "product, invoice, quotation, or proposal, scheduling a meeting, "
                "or logging an activity. Just tell me what you need "
                "in plain language. Nothing is saved until you confirm in chat."
            ),
        }

    return {
        "ok": True,
        "assistantText": (
            f"I'm here on **{ctx.get('module') or 'CRM'}** with you. "
            'Say something like "create a contact named …" and I’ll take it from there.'
        ),
    }


def _overlay_route_actions(
    result: dict[str, Any],
    route: dict[str, Any] | None,
) -> dict[str, Any]:
    """Fill deterministic navigate/create tools; prefer route speech when it conflicts."""
    if not route:
        return result
    out = dict(result)
    route_speech = str(route.get("assistantText") or "").strip()
    result_speech = str(out.get("assistantText") or "").strip()
    if not out.get("toolProposals") and route.get("toolProposals"):
        out["toolProposals"] = route["toolProposals"]
    if route_speech and (
        not result_speech
        or is_generic_coworker_speech(result_speech)
        or _speech_suggests_wrong_direction(result_speech, route)
        or (_route_has_action_tools(route) and route_speech != result_speech)
    ):
        out["assistantText"] = route_speech
        if str(out.get("source") or "") != "ai" or _route_has_action_tools(route):
            out["source"] = route.get("source") or "heuristic"
    elif not result_speech and route_speech:
        out["assistantText"] = route_speech
    if not out.get("sessionMemoryPatch") and route.get("sessionMemoryPatch"):
        out["sessionMemoryPatch"] = route["sessionMemoryPatch"]
    if not out.get("workspaceHint") and route.get("workspaceHint"):
        out["workspaceHint"] = route["workspaceHint"]
    if not out.get("actions") and route.get("actions"):
        out["actions"] = route["actions"]
    return out


def _filled_draft_summary(draft: dict[str, Any] | None) -> str:
    if not isinstance(draft, dict):
        return ""
    parts: list[str] = []
    for key, val in draft.items():
        if val in (None, "", [], {}) or isinstance(val, (dict, list)):
            continue
        text = str(val).strip()
        if not text:
            continue
        parts.append(f"{key}={text[:80]}")
        if len(parts) >= 16:
            break
    return ", ".join(parts)


def _merged_draft_for_speech(
    draft: dict[str, Any] | None,
    result: dict[str, Any],
) -> dict[str, Any]:
    current = dict(draft or {}) if isinstance(draft, dict) else {}
    patch = result.get("patch") or result.get("contactDraftPatch")
    if isinstance(patch, dict):
        current.update(patch)
    return current


def _opening_create(result: dict[str, Any] | None) -> bool:
    tools = (result or {}).get("toolProposals") or []
    return any(
        isinstance(t, dict)
        and t.get("name") == "set_workspace"
        and str((t.get("args") or {}).get("mode") or "") == "create"
        for t in tools
    )


_CREATE_WALK_MODS = frozenset(
    {"contact", "company", "sales", "product", "finance", "quotes", "activities"}
)

_CREATE_SLOT_ASK = {
    "activities": r"\b(who is this|which contact|activity (for|about)|name the contact|what kind|call, meeting|subject|note say|due date|shall i save|log this)\b",
    "finance": r"\b(which deal|invoice (link|for)|deal should this)\b",
    "quotes": r"\b(which deal|quote for)\b",
    "sales": r"\b(deal (title|called)|which company|call this deal)\b",
    "company": r"\b(company (called|name)|company's name|name of the company|where is .{0,40} located|location name|which city)\b",
    "product": r"\b(product name|what sku|product called)\b",
    "contact": r"\b(full name|their name|first name|what's their)\b",
}

_CREATE_WS_LABEL = {
    "contact": "Create contact",
    "company": "Create company",
    "sales": "Create deal",
    "product": "Create product",
    "finance": "Create invoice",
    "quotes": "Create quote",
    "activities": "Log activity",
}


def _looks_like_list_command(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    # "Help me log/create …" is a create walk, not a list filter.
    if re.search(
        r"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|"
        r"register|insert|schedule|book)\b",
        t,
        re.I,
    ):
        return False
    if re.search(
        r"^(show|list|filter|search|find|open|overdue|upcoming|logged)\b",
        t,
        re.I,
    ):
        return True
    if re.search(r"^\s*help\s*$", t, re.I):
        return True
    return bool(
        re.search(
            r"\b(show|list|filter|search for|find all)\b.{0,24}\b"
            r"(activit|contact|deal|compan|product|invoice|quote)",
            t,
            re.I,
        )
    )


def _looks_like_activity_log(text: str) -> bool:
    """True when the user is logging an activity, not searching the list."""
    t = (text or "").strip()
    if not t or _looks_like_list_command(t):
        return False
    if re.search(
        r"\bhelp me (to )?(log|record|create|add)\b",
        t,
        re.I,
    ):
        return True
    if re.search(
        r"\b(log|record)\b.{0,48}\b"
        r"(note|call|meeting|task|sms|activit(?:y|ies)?|appointment|demo)\b",
        t,
        re.I,
    ):
        return True
    return bool(
        re.search(
            r"\b(create|add|new)\b.{0,24}\b"
            r"(note|call|meeting|task|activit(?:y|ies)?)",
            t,
            re.I,
        )
    )


def _has_entity_open(result: dict[str, Any] | None) -> bool:
    for t in (result or {}).get("toolProposals") or []:
        if not isinstance(t, dict):
            continue
        args = t.get("args") if isinstance(t.get("args"), dict) else {}
        if t.get("name") == "navigate":
            return True
        if t.get("name") == "set_workspace" and args.get("entityId"):
            return True
    return False


def _answering_create_slot(
    mod: str,
    messages: list[dict[str, Any]] | None,
    surface: str | None,
    user_text: str | None = None,
) -> bool:
    if (mod or "").lower() not in _CREATE_WALK_MODS:
        return False
    if (surface or "").lower() == "create":
        return True
    last = last_assistant_text(messages)
    pat = _CREATE_SLOT_ASK.get((mod or "").lower())
    if not (pat and last and re.search(pat, last, re.I)):
        return False
    return not _looks_like_list_command(user_text or "")


def _wants_create_walk(
    mod: str,
    surface: str | None,
    result: dict[str, Any] | None,
    messages: list[dict[str, Any]] | None = None,
    user_text: str | None = None,
    context: dict[str, Any] | None = None,
) -> bool:
    from app.agents.crm_tools import is_hub_execute

    if is_hub_execute(context):
        return False
    m = (mod or "").lower()
    if m not in _CREATE_WALK_MODS:
        return False
    from app.agents.coworker_shared import result_leaves_current_page

    if result_leaves_current_page(
        result,
        pathname=str((context or {}).get("pathname") or ""),
        module=m,
    ):
        return False
    if re.search(
        r"\b(schedule|book|arrange)\b.{0,48}\b"
        r"(meeting|call|appointment|demo|visit|sync)\b|"
        r"\b(demo|meeting|call|appointment)\s+(with|for)\b",
        user_text or "",
        re.I,
    ):
        return False
    if (surface or "").lower() == "create":
        from app.agents.deal_coworker_agent import _wants_create_proposal

        if m == "quotes" and _wants_create_proposal((user_text or "").lower()):
            return False
        return True
    if m == "activities" and _looks_like_activity_log(user_text or ""):
        return True
    if _opening_create(result):
        return True
    if isinstance((result or {}).get("patch"), dict):
        return True
    if isinstance((result or {}).get("contactDraftPatch"), dict):
        return True
    if _has_entity_open(result):
        return False
    return _answering_create_slot(m, messages, surface, user_text)


def _user_wants_new_contact(text: str) -> bool:
    raw = text or ""
    # Extra email or phone on someone already saved. The specialist updates
    # that contact; this matcher must not reopen a blank create.
    if re.search(r"\bsecondary\s+contacts?\b", raw, re.I):
        return False
    return bool(
        re.search(
            r"\b(create|add|new|start|make)\b.{0,24}\b(contact|lead|person)\b",
            raw,
            re.I,
        )
    )


def bind_native_contact_create(
    result: dict[str, Any] | None,
    *,
    messages: list[dict[str, Any]] | None,
    context: dict[str, Any] | None,
    catalog: dict[str, Any] | None,
    session_memory: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Put spoken create-walk answers onto the contact draft and open setup.

    The native coworker often acknowledges create-walk answers in chat.
    Field values must come from the LLM patch — never regex gap-fill.
    """
    if not isinstance(result, dict) or result.get("ok") is False:
        return result
    ctx = context if isinstance(context, dict) else {}
    if str(ctx.get("module") or "").lower() != "contact":
        return result
    surface = str(ctx.get("surface") or "list").lower()
    if surface == "detail":
        return result
    user_text = last_user_text(messages) or ""
    # "Add the secondary contact" updates the person just saved. Do not fold
    # that turn into the blank create walk (which asks for a new full name).
    if re.search(r"\bsecondary\s+contacts?\b", user_text, re.I):
        return result
    stm = session_memory if isinstance(session_memory, dict) else {}
    slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
    in_flow = (
        surface == "create"
        or str(stm.get("pendingIntent") or "") == "create_contact"
        or slots.get("createModule") == "contact"
        or _answering_create_slot("contact", messages, surface, user_text)
        or _opening_create(result)
        or _user_wants_new_contact(user_text)
    )
    if not in_flow:
        return result
    if _has_entity_open(result) and not _opening_create(result):
        return result
    from app.agents.contact_draft_agent import enrich_contact_draft_result

    cat = catalog if isinstance(catalog, dict) else {}
    draft = ctx.get("draft") or cat.get("currentDraft") or {}
    if not isinstance(draft, dict):
        draft = {}
    enriched = enrich_contact_draft_result(
        result,
        user_text=user_text,
        companies=list(cat.get("companies") or []),
        draft=draft,
        messages=messages,
        session_memory=stm,
    )
    return _ensure_create_workspace(enriched, "contact")


_BARE_CREATE_COMPANY_RE = re.compile(
    r"^\s*(please\s+)?(help\s+me\s+(to\s+)?)?"
    r"(create|add|new|start|make)(\s+a|\s+new)?\s+compan(y|ies)"
    r"\s*[.!]?\s*$",
    re.I,
)

_COMPANY_DRAFT_KEYS = (
    "name",
    "locationName",
    "locationAddress",
    "locationType",
    "domain",
    "industry",
    "employeeCount",
    "linkedinUrl",
    "skippedOptional",
)


def _user_wants_new_company(text: str) -> bool:
    return bool(
        re.search(
            r"\b(create|add|new|start|make)\b.{0,32}\bcompan",
            text or "",
            re.I,
        )
    )


def _prior_company_answers(
    messages: list[dict[str, Any]] | None,
    user_text: str,
) -> dict[str, Any]:
    """Replay earlier company replies so the current answer hits the right slot."""
    from app.agents.draft_conversation import apply_company_slot_answer, merge_draft

    current = (user_text or "").strip()
    texts: list[str] = []
    for msg in messages or []:
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        text = str(msg.get("text") or msg.get("content") or "").strip()
        if text:
            texts.append(text)
    if texts and texts[-1] == current:
        texts = texts[:-1]
    local: dict[str, Any] = {}
    for text in texts:
        if _BARE_CREATE_COMPANY_RE.match(text):
            continue
        slot = apply_company_slot_answer(text, local) or {}
        local = merge_draft(local, slot)
    return local


def bind_native_company_create(
    result: dict[str, Any] | None,
    *,
    messages: list[dict[str, Any]] | None,
    context: dict[str, Any] | None,
    catalog: dict[str, Any] | None,
    session_memory: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Write company create answers onto the setup panel.

    The model can say "Lyca in Chennai" and ask about location type while
    Location name on the right stays empty.
    """
    if not isinstance(result, dict) or result.get("ok") is False:
        return result
    ctx = context if isinstance(context, dict) else {}
    if str(ctx.get("module") or "").lower() != "company":
        return result
    surface = str(ctx.get("surface") or "list").lower()
    if surface == "detail":
        return result
    user_text = last_user_text(messages) or ""
    stm = session_memory if isinstance(session_memory, dict) else {}
    slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
    in_flow = (
        surface == "create"
        or str(stm.get("pendingIntent") or "") == "create_company"
        or slots.get("createModule") == "company"
        or _answering_create_slot("company", messages, surface, user_text)
        or _opening_create(result)
        or _user_wants_new_company(user_text)
    )
    if not in_flow:
        return result
    if _has_entity_open(result) and not _opening_create(result):
        return result
    if _BARE_CREATE_COMPANY_RE.match(user_text.strip()):
        return _ensure_create_workspace(result, "company")

    from app.agents.company_draft_agent import enrich_company_draft_result

    client = ctx.get("draft") or (catalog or {}).get("currentDraft") or {}
    if not isinstance(client, dict):
        client = {}
    stored = slots.get("companyDraft") if isinstance(slots.get("companyDraft"), dict) else {}
    prior = _prior_company_answers(messages, user_text)
    base = dict(client)
    for source in (stored, prior):
        for key in _COMPANY_DRAFT_KEYS:
            if str(base.get(key) or "").strip():
                continue
            val = str(source.get(key) or "").strip()
            if val:
                base[key] = val
    enriched = enrich_company_draft_result(
        result,
        user_text=user_text,
        draft=base,
    )
    patch = enriched.get("patch") if isinstance(enriched.get("patch"), dict) else {}
    extra = {
        key: base[key]
        for key in _COMPANY_DRAFT_KEYS
        if str(base.get(key) or "").strip() and not str(client.get(key) or "").strip()
    }
    merged_patch = {**extra, **patch}
    if merged_patch:
        enriched["patch"] = merged_patch
    merged = {**base, **merged_patch}
    stm_patch = dict(enriched.get("sessionMemoryPatch") or {})
    stm_slots = dict(stm_patch.get("slots") or {})
    stm_slots["companyDraft"] = {
        key: str(merged.get(key) or "").strip()
        for key in _COMPANY_DRAFT_KEYS
        if str(merged.get(key) or "").strip()
    }
    stm_patch["slots"] = stm_slots
    enriched["sessionMemoryPatch"] = stm_patch
    return _ensure_create_workspace(enriched, "company")


def _ensure_create_workspace(
    result: dict[str, Any],
    mod: str,
) -> dict[str, Any]:
    """Keep create-walk answers on the draft — never list search."""
    from app.agents.coworker_shared import result_leaves_current_page, strip_draft_patch

    if result_leaves_current_page(result, module=mod):
        return strip_draft_patch(result)
    out = dict(result)
    tools = list(out.get("toolProposals") or [])
    kept: list[dict[str, Any]] = []
    has_create = False
    for t in tools:
        if not isinstance(t, dict):
            kept.append(t)
            continue
        if t.get("name") != "set_workspace":
            kept.append(t)
            continue
        args = dict(t.get("args") or {})
        mode = str(args.get("mode") or "")
        if mode == "create":
            has_create = True
            args.pop("search", None)
            kept.append({**t, "args": args})
        elif mode == "list" and args.get("search"):
            continue
        else:
            kept.append(t)
    if not has_create:
        kept.append(
            {
                "id": "ws-create-walk",
                "name": "set_workspace",
                "label": _CREATE_WS_LABEL.get(mod, "Create"),
                "args": {"mode": "create", "auto": True},
                "risk": "low",
            }
        )
    out["toolProposals"] = kept
    return out


def _next_slot_hint(
    mod: str,
    draft: dict[str, Any],
    *,
    route_speech: str = "",
    business_type: str | None = None,
) -> str:
    try:
        from app.agents.draft_conversation import next_question

        if (mod or "").lower() in _CREATE_WALK_MODS:
            return str(
                next_question(
                    (mod or "").lower(),
                    draft,
                    just_patched=True,
                    business_type=business_type,
                )
                or ""
            ).strip()[:240]
        hint = str(route_speech or "").strip()
        if hint:
            return hint[:240]
        return str(next_question(mod, draft, just_patched=True) or "").strip()[:240]
    except Exception:  # noqa: BLE001
        return ""


async def _ensure_llm_route_speech(
    result: dict[str, Any],
    route: dict[str, Any] | None,
    *,
    user_text: str,
    mod: str,
    surface: str | None = None,
    draft: dict[str, Any] | None = None,
    business_type: str | None = None,
) -> dict[str, Any]:
    """If tools/patch ran but chat was empty/internal, ask the LLM once for speech."""
    from app.agents.llm_result import sectioned_system_prompt
    from app.llm import generate_ai_text, is_ai_configured

    out = dict(result)
    speech = strip_internal_workspace_sentences(
        str(out.get("assistantText") or "")
    )
    route_speech = str((route or {}).get("assistantText") or "").strip()
    if route and route_speech and _route_has_action_tools(route):
        if (
            not speech
            or is_generic_coworker_speech(speech)
            or _speech_suggests_wrong_direction(speech, route)
        ):
            out["assistantText"] = route_speech
            out["source"] = route.get("source") or "heuristic"
            return out
    if speech and not is_generic_coworker_speech(speech):
        out["assistantText"] = speech
        if str(out.get("source") or "") != "heuristic":
            out["source"] = "ai"
        return out

    tools = out.get("toolProposals") or (route or {}).get("toolProposals") or []
    has_work = bool(
        route
        or out.get("patch")
        or out.get("contactDraftPatch")
        or tools
    )
    merged_draft = _merged_draft_for_speech(draft, out)
    slot_hint = _next_slot_hint(
        mod,
        merged_draft,
        route_speech=str((route or {}).get("assistantText") or ""),
        business_type=business_type,
    )

    def _fallback_hint(reason: str) -> dict[str, Any]:
        from app.agents.coworker_shared import LLM_ERROR_SPEECH

        if not str(out.get("assistantText") or "").strip():
            out["assistantText"] = LLM_ERROR_SPEECH
        out["source"] = "error"
        out["reason"] = reason
        return out

    if not is_ai_configured():
        logger.error(
            fmt(
                agent="crm-agent",
                step="ensure_speech",
                module=mod,
                surface=surface,
                ok=False,
                reason="llm_not_configured",
                tools=tool_names(out) or tool_names(route),
                patchKeys=patch_keys(out),
            )
        )
        return _fallback_hint("llm_not_configured")
    if not has_work:
        logger.error(
            fmt(
                agent="crm-agent",
                step="ensure_speech",
                module=mod,
                surface=surface,
                ok=False,
                reason="no_work",
            )
        )
        return out

    opening_create = any(
        isinstance(t, dict)
        and t.get("name") == "set_workspace"
        and str((t.get("args") or {}).get("mode") or "") == "create"
        for t in tools
    )
    navigating = any(
        isinstance(t, dict) and t.get("name") == "navigate" for t in tools
    )
    saving = any(
        isinstance(t, dict)
        and str(t.get("name") or "").startswith("propose_create_")
        for t in tools
    )
    filled_fields = _filled_draft_summary(merged_draft)
    logger.info(
        fmt(
            agent="crm-agent",
            step="ensure_speech",
            module=mod,
            surface=surface,
            reason="ask_llm",
            openingCreate=opening_create,
            navigating=navigating,
            saving=saving,
            filled=filled_fields,
            nextHint=slot_hint,
            tools=tool_names(out) or tool_names(route),
            patchKeys=patch_keys(out),
        )
    )
    system = sectioned_system_prompt(
        role="You are a warm CRM colleague talking with the user in chat.",
        goal=(
            "Briefly recap that you are saving now. One short spoken sentence."
            if saving
            else "Acknowledge what they just gave, then ask the next natural "
            "question. One short spoken sentence."
        ),
        instructions=(
            "Never mention tools, routing, set_workspace, the right pane, or "
            "opening create. Never start with a dash or bullet. "
            + (
                "Do not ask another question — they already agreed to save."
                if saving
                else "Acknowledge briefly, then ask ONE question matching "
                "nextSlotHint. Do not re-ask fields already filled. "
                "Do NOT ask 'ready to save?' or 'shall I save?' unless "
                "nextSlotHint is itself a save offer."
            )
        ),
        context=(
            f"- module={mod}\n"
            f"- surface={surface or ''}\n"
            f"- openingCreate={opening_create}\n"
            f"- navigating={navigating}\n"
            f"- saving={saving}\n"
            f"- filledFields={filled_fields or '(none)'}\n"
            f"- nextSlotHint={slot_hint}"
        ),
        output="One or two short spoken sentences only. No JSON. No markdown bullets.",
        guardrails="Do not invent field values. Do not say something went wrong.",
    )
    text = await generate_ai_text(
        system=system,
        user=f'The user said: "{(user_text or "").strip()[:500]}"',
        max_tokens=400,
    )
    filled = strip_internal_workspace_sentences(
        sanitize_assistant_text_for_user(text or "")
    )
    if filled and not is_generic_coworker_speech(filled):
        out["assistantText"] = filled
        out["source"] = "ai"
        logger.info(
            fmt(
                agent="crm-agent",
                step="ensure_speech",
                module=mod,
                surface=surface,
                ok=True,
                speech=out["assistantText"],
                tools=tool_names(out) or tool_names(route),
                patchKeys=patch_keys(out),
            )
        )
        return out
    logger.error(
        fmt(
            agent="crm-agent",
            step="ensure_speech",
            module=mod,
            surface=surface,
            ok=False,
            reason="llm_unusable",
            tools=tool_names(out) or tool_names(route),
            patchKeys=patch_keys(out),
        )
    )
    return _fallback_hint("llm_unusable")


async def handle_agent_turn(state: CrmAgentState) -> dict[str, Any]:
    messages = state.get("messages") or []
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    # MCP auth context from agent-turn
    if state.get("acting_user_id") and not ctx.get("actingUserId"):
        ctx = {**ctx, "actingUserId": state["acting_user_id"]}
        catalog = {**catalog, "actingUserId": state["acting_user_id"]}
    if state.get("organization_id") and not ctx.get("organizationId"):
        ctx = {**ctx, "organizationId": state["organization_id"]}
        catalog = {**catalog, "organizationId": state["organization_id"]}
    if state.get("role") and not ctx.get("role"):
        ctx = {**ctx, "role": state["role"]}
        catalog = {**catalog, "role": state["role"]}
    business_type = str(
        state.get("business_type") or catalog.get("businessType") or ""
    )
    mod = str(ctx.get("module") or "").lower()
    surface = str(ctx.get("surface") or "").lower()
    pathname = str(ctx.get("pathname") or "")
    user_text = last_user_text(messages)
    if not user_text:
        return {"ok": False, "error": "Send a message to work with the agent."}
    logger.info(
        fmt(
            agent="crm-agent",
            step="start",
            module=mod,
            surface=surface,
            pathname=pathname,
            user=user_text,
            entityId=str(ctx.get("entityId") or "") or None,
        )
    )

    from app.agents.coworker_runtime import (
        hydrate_working_from_session,
        normalize_session_memory,
        post_commit,
        pre_route_proposal,
        run_skill_turn,
        stamp_create_session_memory,
    )

    stm_in = normalize_session_memory(
        state.get("session_memory")
        or ctx.get("sessionMemory")
        or catalog.get("sessionMemory")
    )
    # Specialists read sticky slots from context.sessionMemory
    ctx = {**ctx, "sessionMemory": stm_in}
    from app.agents.coworker_runtime import hydrate_draft_record as _hydrate_draft

    _slot_for_intent = {
        "create_contact": "contactDraft",
        "create_company": "companyDraft",
        "create_location": "locationDraft",
        "create_deal": "dealDraft",
        "create_product": "productDraft",
        "create_invoice": "invoiceDraft",
        "create_activity": "activityDraft",
        "create_quote": "quoteDraft",
        "create_proposal": "quoteDraft",
    }
    remembered_intent = str(stm_in.get("pendingIntent") or "")
    remembered = _slot_for_intent.get(remembered_intent)
    remembered_mod = {
        "create_contact": "contact",
        "create_company": "company",
        "create_location": "company",
        "create_deal": "sales",
        "create_product": "product",
        "create_invoice": "finance",
        "create_activity": "activities",
        "create_quote": "quotes",
        "create_proposal": "sales",
    }.get(remembered_intent, "")
    if remembered and remembered_mod == mod:
        raw_draft = ctx.get("draft") if isinstance(ctx.get("draft"), dict) else {}
        ctx = {**ctx, "draft": _hydrate_draft(raw_draft, stm_in, remembered)}
    wm = hydrate_working_from_session(stm_in, ctx, catalog)

    clear_contact_count = False

    def _finish(result: dict[str, Any]) -> dict[str, Any]:
        # Extract LLM-generated suggestions before speech processing.
        raw_text = str((result or {}).get("assistantText") or "")
        cleaned_text, suggestions = extract_suggestions(raw_text)
        if isinstance(result, dict) and (cleaned_text != raw_text or suggestions):
            result = {**result, "assistantText": cleaned_text, "suggestions": suggestions}
        prior_speech = str((result or {}).get("assistantText") or "")
        result = drop_non_llm_speech(result)
        if clear_contact_count and isinstance(result, dict) and result.get("ok"):
            patch = dict(result.get("sessionMemoryPatch") or {})
            if "pendingAsk" not in patch:
                patch["pendingAsk"] = ""
            result = {**result, "sessionMemoryPatch": patch}
        finish_ok = bool(isinstance(result, dict) and result.get("ok") is not False)
        finish_msg = fmt(
            agent="crm-agent",
            step="finish",
            module=mod,
            surface=surface,
            source=result.get("source") if isinstance(result, dict) else None,
            reason=result.get("reason") if isinstance(result, dict) else None,
            speech=result.get("assistantText") if isinstance(result, dict) else None,
            tools=tool_names(result if isinstance(result, dict) else None),
            patchKeys=patch_keys(result if isinstance(result, dict) else None),
            speechDropped=(
                True
                if prior_speech
                != str((result or {}).get("assistantText") or "")
                else None
            ),
            ok=finish_ok,
            error=result.get("error") if isinstance(result, dict) else None,
        )
        if finish_ok:
            logger.info(finish_msg)
        else:
            logger.error(finish_msg)
        if (
            finish_ok
            and isinstance(result, dict)
            and surface == "create"
        ):
            intent_for_mod = {
                "contact": "contact_draft",
                "company": "company_draft",
                "sales": "deal_draft",
                "product": "product_draft",
                "finance": "invoice_draft",
                "activities": "activity_draft",
                "quotes": "quote_draft",
            }.get(mod)
            if mod == "company" and "/location" in pathname:
                intent_for_mod = "location_draft"
            if intent_for_mod:
                live = ctx.get("draft") if isinstance(ctx.get("draft"), dict) else {}
                turned = result.get("patch") or result.get("contactDraftPatch") or {}
                result = stamp_create_session_memory(
                    result,
                    intent=intent_for_mod,
                    draft={
                        **live,
                        **(turned if isinstance(turned, dict) else {}),
                    },
                    pathname=pathname,
                )
        return post_commit(result, stm=stm_in)

    from app.agents.crm_tools import is_hub_execute
    from app.llm import is_ai_configured as _hub_ai_configured

    if is_hub_execute(ctx):
        if _hub_ai_configured():
            native = await run_native_agent_turn(
                mod=mod or "contact",
                surface=surface or "create",
                messages=messages,
                context=ctx,
                catalog={
                    **catalog,
                    "currentDraft": ctx.get("draft") or catalog.get("currentDraft") or {},
                },
                user_text=user_text,
            )
            if native and isinstance(native, dict) and native.get("ok") is not False:
                return _finish({**native, "source": native.get("source") or "ai"})
        return _finish(
            {
                "ok": False,
                "error": "Hub instruction could not be executed.",
                "source": "error",
                "reason": "hub_execute_failed",
            }
        )

    async def _finish_draft(draft_res: dict[str, Any]) -> dict[str, Any]:
        m = str(mod or "").lower()
        d = draft_now if isinstance(draft_now, dict) else {}
        from app.agents.coworker_shared import apply_leave_create

        draft_res = apply_leave_create(
            draft_res,
            pathname=str(ctx.get("pathname") or ""),
            module=m,
        )
        walk = _wants_create_walk(m, surface, draft_res, messages, user_text, ctx)
        if m == "contact" and walk:
            from app.agents.contact_draft_agent import enrich_contact_draft_result

            draft_res = enrich_contact_draft_result(
                draft_res,
                user_text=user_text,
                companies=list(catalog.get("companies") or []),
                draft=d,
                messages=messages,
                session_memory=stm_in,
            )
        elif m == "product" and walk:
            from app.agents.misc_draft_agents import enrich_product_draft_result

            draft_res = enrich_product_draft_result(
                draft_res,
                user_text=user_text,
                draft=d,
                business_type=business_type,
            )
        elif m == "company" and walk:
            from app.agents.company_draft_agent import enrich_company_draft_result

            draft_res = enrich_company_draft_result(
                draft_res, user_text=user_text, draft=d
            )
        elif m == "sales" and walk:
            from app.agents.deal_draft_agent import enrich_deal_draft_result

            draft_res = enrich_deal_draft_result(
                draft_res,
                user_text=user_text,
                draft=d,
                catalog=catalog,
            )
        elif m == "finance" and walk:
            from app.agents.misc_draft_agents import enrich_invoice_draft_result

            draft_res = enrich_invoice_draft_result(
                draft_res,
                user_text=user_text,
                draft=d,
                deals=list(catalog.get("deals") or []),
                products=list(catalog.get("products") or []),
            )
        elif m == "activities" and walk:
            from app.agents.misc_draft_agents import enrich_activity_draft_result

            draft_res = enrich_activity_draft_result(
                draft_res,
                user_text=user_text,
                draft=d,
                contacts=list(catalog.get("contacts") or []),
                messages=messages,
                catalog=catalog,
            )
        elif m == "quotes" and walk:
            from app.agents.misc_draft_agents import enrich_quote_draft_result

            draft_res = enrich_quote_draft_result(
                draft_res,
                user_text=user_text,
                draft=d,
                catalog=catalog,
                messages=messages,
            )
        if walk:
            draft_res = _ensure_create_workspace(draft_res, m)
        if isinstance(draft_res, dict) and draft_res.get("ok") is not False:
            merged_draft = _merged_draft_for_speech(d, draft_res)
            draft_res = await _ensure_llm_route_speech(
                {**draft_res, "source": draft_res.get("source") or "ai"},
                None,
                user_text=user_text,
                mod=m or mod,
                surface=surface,
                draft=merged_draft,
                business_type=business_type,
            )
            if walk:
                from app.agents.draft_conversation import (
                    activity_draft_ready,
                    company_draft_ready,
                    contact_draft_ready,
                    deal_draft_ready,
                    explain_product_slot,
                    invoice_draft_ready,
                    is_product_slot_meta_question,
                    looks_like_create_confirm,
                    next_question,
                    product_draft_ready,
                    product_next_ask_key,
                    quote_draft_ready,
                )

                merged_draft = _merged_draft_for_speech(d, draft_res)
                ready = {
                    "contact": contact_draft_ready,
                    "company": company_draft_ready,
                    "sales": deal_draft_ready,
                    "product": product_draft_ready,
                    "finance": invoice_draft_ready,
                    "quotes": quote_draft_ready,
                    "activities": activity_draft_ready,
                }.get(m)
                user_saving = looks_like_create_confirm(user_text) and (
                    ready(merged_draft) if ready else False
                )
                just_patched = bool(
                    (
                        isinstance(draft_res.get("patch"), dict)
                        and draft_res.get("patch")
                    )
                    or (
                        isinstance(draft_res.get("contactDraftPatch"), dict)
                        and draft_res.get("contactDraftPatch")
                    )
                )
                if m == "product" and is_product_slot_meta_question(
                    user_text,
                    product_next_ask_key(merged_draft, business_type=business_type),
                ):
                    draft_res["assistantText"] = explain_product_slot(
                        product_next_ask_key(
                            merged_draft, business_type=business_type
                        )
                    )
                elif not user_saving:
                    existing = str(draft_res.get("assistantText") or "")
                    if "couldn't match" not in existing.lower():
                        nxt = str(
                            next_question(
                                m,
                                merged_draft,
                                just_patched=just_patched,
                                business_type=business_type,
                            )
                            or ""
                        ).strip()
                        if nxt:
                            draft_res["assistantText"] = nxt
        logger.info(
            fmt(
                agent="crm-agent",
                step="draft",
                module=m,
                surface=surface,
                source=draft_res.get("source") if isinstance(draft_res, dict) else None,
                speech=draft_res.get("assistantText")
                if isinstance(draft_res, dict)
                else None,
                emptySpeech=not str(
                    (draft_res.get("assistantText") or "")
                    if isinstance(draft_res, dict)
                    else ""
                ).strip(),
                tools=tool_names(draft_res if isinstance(draft_res, dict) else None),
                patchKeys=patch_keys(
                    draft_res if isinstance(draft_res, dict) else None
                ),
                patch=(
                    (draft_res.get("patch") or draft_res.get("contactDraftPatch"))
                    if isinstance(draft_res, dict)
                    else None
                ),
            )
        )
        return _finish(_attach_workspace_hint(draft_res))

    from app.agents.deal_coworker_agent import resolve_proposal_not_quote_turn

    prop_not_quote = resolve_proposal_not_quote_turn(
        user_text=user_text,
        mod=mod,
        pathname=pathname,
        catalog=catalog,
    )
    if prop_not_quote:
        return _finish(prop_not_quote)

    if ctx.get("module") == "finance" and business_type == "b2c":
        return _finish({
            "ok": True,
            "assistantText": (
                "Finance isn’t available for B2C workspaces. Try Contacts or Commerce instead."
            ),
            "source": "heuristic",
            "reason": "rbac_gate",
        })

    from app.llm import is_ai_configured
    from app.agents.deal_coworker_agent import _wants_create_proposal

    wants_proposal = _wants_create_proposal(user_text.lower()) and not re.search(
        r"/sales/proposals/[^/?#]+", pathname
    )

    pending_route: dict[str, Any] | None = None
    # Pages without an in-shell create form (dashboard, inbox, …) must still
    # leave when the user asks to create a record — the LLM often speaks
    # without calling navigate.
    if mod not in IN_SHELL_CREATE:
        pending_route = resolve_pending_route(
            user_text, mod, pathname, surface=surface
        )

    draft_now = ctx.get("draft") or catalog.get("currentDraft") or {}
    if not isinstance(draft_now, dict):
        draft_now = {}

    # Offline keyword start only. When the LLM is up, the sales coworker
    # decides whether to wait for a BRD or call propose_create_proposal.
    prop_pre = pre_route_proposal(
        user_text=user_text,
        messages=messages,
        ctx=ctx,
        catalog=catalog,
        stm=stm_in,
        wm=wm,
        allow_keyword_intent=False,
    )
    if prop_pre:
        return _finish(prop_pre)

    # ------------------------------------------------------------------
    # Deterministic routing BEFORE native LLM — same class of bug as
    # proposal→quote: a speech/tool-happy model must not block go/show/cross.
    # Tools stay heuristic; chat speech is never labeled AI unless the LLM
    # actually produced it.
    # ------------------------------------------------------------------
    if mod == "contact" and (surface or "") == "create":
        from app.agents.deal_coworker_agent import resolve_proposal_not_quote_turn

        handoff = resolve_proposal_not_quote_turn(
            user_text=user_text,
            mod=mod,
            pathname=pathname,
            catalog=catalog,
        )
        if handoff:
            return _finish(handoff)
        if str(stm_in.get("pendingAsk") or "") == "contact_count":
            # Legacy multi-create ask — we only create one contact. Drop the
            # count slot and don't treat a bare number as a name.
            clear_contact_count = True
            if parse_contact_count_reply(user_text) is not None:
                filled = await _ensure_llm_route_speech(
                    {"ok": True, "source": "ai", "assistantText": ""},
                    None,
                    user_text="create a contact",
                    mod="contact",
                    surface="create",
                    draft=draft_now,
                )
                return _finish(filled)

    # All routing decisions (navigate, create, show list) are handled by the
    # LLM via MCP tools — no heuristic interception.

    # All routing, field collection, and actions are LLM/MCP only.
    on_proposal_page = bool(re.search(r"/sales/proposals/[^/?#]+", pathname))

    native_speech_fallback: dict[str, Any] | None = None
    if (
        is_ai_configured()
        and mod
        and not (wants_proposal and mod == "sales")
        and not on_proposal_page
        and not (
            mod in ("quotes", "finance", "activities", "contact", "company", "sales", "product")
            and (
                (surface or "") == "create"
                or _answering_create_slot(mod, messages, surface, user_text)
                or (mod == "activities" and _looks_like_activity_log(user_text))
            )
        )
    ):
        native_first = await run_skill_turn(
            mod=mod,
            surface=surface or "list",
            messages=messages,
            context=ctx,
            catalog={**catalog, "currentDraft": draft_now},
            user_text=user_text,
            stm=stm_in,
        )
        commit_native = should_commit_native_turn(native_first, user_text=user_text)
        native_speech = str((native_first or {}).get("assistantText") or "")
        logger.info(
            fmt(
                agent="crm-agent",
                step="native_first",
                module=mod,
                surface=surface,
                commit=commit_native,
                generic=is_generic_coworker_speech(native_speech),
                emptySpeech=not native_speech.strip(),
                speechLen=len(native_speech.strip()),
                speech=native_speech if native_first else None,
                tools=tool_names(
                    native_first if isinstance(native_first, dict) else None
                ),
                patchKeys=patch_keys(
                    native_first if isinstance(native_first, dict) else None
                ),
                unhandled=True if (native_first or {}).get("_unhandled") else None,
            )
        )
        if commit_native:
            merged = _overlay_route_actions(
                {**native_first, "source": "ai"}, pending_route
            )
            merged = await _ensure_llm_route_speech(
                merged,
                pending_route,
                user_text=user_text,
                mod=mod,
                surface=surface,
                draft=draft_now,
                business_type=business_type,
            )
            if _wants_create_walk(mod, surface, merged, messages, user_text):
                return await _finish_draft(merged)
            return _finish(merged)
        if (
            native_first
            and native_first.get("ok")
            and not native_first.get("_unhandled")
            and not is_generic_coworker_speech(
                str(native_first.get("assistantText") or "")
            )
        ):
            native_speech_fallback = _overlay_route_actions(
                {**native_first, "source": "ai"},
                pending_route,
            )
            if pending_route:
                return _finish(native_speech_fallback)
        if pending_route:
            merged = _overlay_route_actions(
                {**(native_first or {}), "ok": True, "source": "ai"},
                pending_route,
            )
            merged = await _ensure_llm_route_speech(
                merged,
                pending_route,
                user_text=user_text,
                mod=mod,
                surface=surface,
                draft=draft_now,
                business_type=business_type,
            )
            if _wants_create_walk(mod, surface, merged, messages, user_text):
                return await _finish_draft(merged)
            return _finish(merged)

    lower = user_text.lower()

    # LLM owns help/greetings. If it is down, fail closed.
    if not is_ai_configured() and (
        _is_help_question(lower)
        or re.search(r"^\s*(hi|hello|hey)\b|what can you help", lower)
    ):
        from app.agents.coworker_shared import llm_unavailable_result

        return _finish(llm_unavailable_result("llm_not_configured"))

    # Contacts: list / create / open intents first
    if mod == "contact":
        logger.info(
            fmt(
                agent="crm-agent",
                step="specialist",
                module="contact",
                surface=surface,
            )
        )
        contact_res = await contact_coworker_agent.run(
            messages=messages,
            context=ctx,
            catalog=catalog,
            organization_id=state.get("organization_id"),
        )
        if contact_res and not contact_res.get("_unhandled"):
            # Attach workspace tools for list-leave from draft path
            if contact_res.get("workspaceHint") and not contact_res.get("toolProposals"):
                hint = contact_res["workspaceHint"]
                contact_res["toolProposals"] = [
                    {
                        "id": "ws-from-hint",
                        "name": "set_workspace",
                        "label": hint.get("label") or "Show contacts",
                        "args": {
                            "mode": hint.get("mode") or "list",
                            "auto": True,
                            **(
                                {"search": hint["search"]}
                                if hint.get("search")
                                else {}
                            ),
                        },
                        "risk": "low",
                    }
                ]
            return (
                _finish(contact_res)
                if _is_cross_module_navigate(contact_res, mod)
                else (
                    await _finish_draft(contact_res)
                    if _wants_create_walk(
                        "contact", surface, contact_res, messages, user_text
                    )
                    else _finish(contact_res)
                )
            )

        # In-shell create, or a slot answer while the list is still showing
        if surface == "create" or _answering_create_slot(
            "contact", messages, surface, user_text
        ):
            from app.agents.deal_coworker_agent import resolve_proposal_not_quote_turn

            handoff = resolve_proposal_not_quote_turn(
                user_text=user_text,
                mod=mod,
                pathname=pathname,
                catalog=catalog,
            )
            if handoff:
                return _finish(handoff)
            draft_now = ctx.get("draft") or catalog.get("currentDraft") or {}
            if not isinstance(draft_now, dict):
                draft_now = {}
            native_create = await run_native_agent_turn(
                mod=mod,
                surface="create",
                messages=messages,
                context=ctx,
                catalog={
                    **catalog,
                    "currentDraft": draft_now,
                },
                user_text=user_text,
            )
            if native_create and native_create.get("ok"):
                logger.info(
                    fmt(
                        agent="crm-agent",
                        step="draft",
                        module="contact",
                        surface="create",
                        source="native",
                        speech=native_create.get("assistantText"),
                        tools=tool_names(native_create),
                    )
                )
                return await _finish_draft(native_create)
            logger.info(
                fmt(
                    agent="crm-agent",
                    step="draft",
                    module="contact",
                    surface="create",
                    source="contact-draft",
                )
            )
            draft_res = await contact_draft_agent.run(
                messages=messages,
                context=ctx,
                catalog=catalog,
                organization_id=state.get("organization_id"),
            )
            return await _finish_draft(draft_res)

    # Sales / deals: list / create / open intents first
    if mod == "sales":
        logger.info(
            fmt(agent="crm-agent", step="specialist", module="sales", surface=surface)
        )
        pathname = str(ctx.get("pathname") or "")
        if re.search(r"/sales/proposals/[^/?#]+", pathname):
            prop_res = await proposal_coworker_agent.run(
                messages=messages,
                context=ctx,
                catalog=catalog,
                organization_id=state.get("organization_id"),
            )
            if prop_res and not prop_res.get("_unhandled"):
                return _finish(prop_res)

        deal_res = await deal_coworker_agent.run(
            messages=messages,
            context=ctx,
            catalog=catalog,
            organization_id=state.get("organization_id"),
        )
        if deal_res and not deal_res.get("_unhandled"):
            if deal_res.get("workspaceHint") and not deal_res.get("toolProposals"):
                hint = deal_res["workspaceHint"]
                deal_res["toolProposals"] = [
                    {
                        "id": "ws-from-hint",
                        "name": "set_workspace",
                        "label": hint.get("label") or "Show pipeline",
                        "args": {
                            "mode": hint.get("mode") or "list",
                            "auto": True,
                            **(
                                {"search": hint["search"]}
                                if hint.get("search")
                                else {}
                            ),
                            **(
                                {"entityId": hint["entityId"]}
                                if hint.get("entityId")
                                else {}
                            ),
                        },
                        "risk": "low",
                    }
                ]
            return (
                await _finish_draft(deal_res)
                if _wants_create_walk("sales", surface, deal_res, messages, user_text)
                else _finish(deal_res)
            )

        if surface == "create" or _answering_create_slot(
            "sales", messages, surface, user_text
        ):
            draft_now = ctx.get("draft") or catalog.get("currentDraft") or {}
            if not isinstance(draft_now, dict):
                draft_now = {}
            native_create = await run_native_agent_turn(
                mod=mod,
                surface="create",
                messages=messages,
                context=ctx,
                catalog={
                    **catalog,
                    "currentDraft": draft_now,
                },
                user_text=user_text,
            )
            if native_create and native_create.get("ok"):
                return await _finish_draft(native_create)
            draft_res = await deal_draft_agent.run(
                messages=messages,
                context=ctx,
                catalog=catalog,
                organization_id=state.get("organization_id"),
            )
            return await _finish_draft(draft_res)

    # Companies: list / create / open intents first
    if mod == "company":
        logger.info(
            fmt(agent="crm-agent", step="specialist", module="company", surface=surface)
        )
        company_res = await company_coworker_agent.run(
            messages=messages,
            context=ctx,
            catalog=catalog,
            organization_id=state.get("organization_id"),
        )
        if company_res and not company_res.get("_unhandled"):
            if company_res.get("workspaceHint") and not company_res.get("toolProposals"):
                hint = company_res["workspaceHint"]
                company_res["toolProposals"] = [
                    {
                        "id": "ws-from-hint",
                        "name": "set_workspace",
                        "label": hint.get("label") or "Show companies",
                        "args": {
                            "mode": hint.get("mode") or "list",
                            "auto": True,
                            **(
                                {"search": hint["search"]}
                                if hint.get("search")
                                else {}
                            ),
                            **(
                                {"entityId": hint["entityId"]}
                                if hint.get("entityId")
                                else {}
                            ),
                        },
                        "risk": "low",
                    }
                ]
            return (
                await _finish_draft(company_res)
                if _wants_create_walk(
                    "company", surface, company_res, messages, user_text
                )
                else _finish(company_res)
            )

        if surface == "create" or _answering_create_slot(
            "company", messages, surface, user_text
        ):
            draft_now = ctx.get("draft") or catalog.get("currentDraft") or {}
            if not isinstance(draft_now, dict):
                draft_now = {}
            native_create = await run_native_agent_turn(
                mod=mod,
                surface="create",
                messages=messages,
                context=ctx,
                catalog={
                    **catalog,
                    "currentDraft": draft_now,
                },
                user_text=user_text,
            )
            if native_create and native_create.get("ok"):
                return await _finish_draft(native_create)
            mode = "location" if ctx.get("entityId") else "company"
            draft_res = await company_draft_agent.run(
                messages=messages,
                context=ctx,
                catalog=catalog,
                organization_id=state.get("organization_id"),
                mode=mode,
            )
            return await _finish_draft(draft_res)

    # Products: list / create / open intents first
    if mod == "product":
        logger.info(
            fmt(agent="crm-agent", step="specialist", module="product", surface=surface)
        )
        product_res = await product_coworker_agent.run(
            messages=messages,
            context=ctx,
            catalog=catalog,
            organization_id=state.get("organization_id"),
        )
        if product_res and not product_res.get("_unhandled"):
            if product_res.get("workspaceHint") and not product_res.get("toolProposals"):
                hint = product_res["workspaceHint"]
                product_res["toolProposals"] = [
                    {
                        "id": "ws-from-hint",
                        "name": "set_workspace",
                        "label": hint.get("label") or "Show products",
                        "args": {
                            "mode": hint.get("mode") or "list",
                            "auto": True,
                            **(
                                {"search": hint["search"]}
                                if hint.get("search")
                                else {}
                            ),
                            **(
                                {"entityId": hint["entityId"]}
                                if hint.get("entityId")
                                else {}
                            ),
                        },
                        "risk": "low",
                    }
                ]
            return (
                await _finish_draft(product_res)
                if _wants_create_walk(
                    "product", surface, product_res, messages, user_text
                )
                else _finish(product_res)
            )

        if surface == "create" or _answering_create_slot(
            "product", messages, surface, user_text
        ):
            draft_now = ctx.get("draft") or catalog.get("currentDraft") or {}
            if not isinstance(draft_now, dict):
                draft_now = {}
            native_create = await run_native_agent_turn(
                mod=mod,
                surface="create",
                messages=messages,
                context=ctx,
                catalog={
                    **catalog,
                    "currentDraft": draft_now,
                },
                user_text=user_text,
            )
            if native_create and native_create.get("ok"):
                return await _finish_draft(native_create)
            draft_res = await misc_draft_agents.run(
                messages=messages,
                context=ctx,
                catalog=catalog,
                organization_id=state.get("organization_id"),
                kind="product",
            )
            return await _finish_draft(draft_res)

    _LINK_KIND = {"quotes": "quotes", "finance": "finance", "activities": "activities"}
    if mod == "quotes" and re.search(r"/sales/quotes/[^/?#]+", pathname):
        quote_res = await quote_coworker_agent.run(
            messages=messages,
            context=ctx,
            catalog=catalog,
            organization_id=state.get("organization_id"),
        )
        if quote_res and not quote_res.get("_unhandled"):
            return _finish(quote_res)

    if mod in _LINK_KIND:
        link_res = await link_module_coworker_agent.run(
            messages=messages,
            context=ctx,
            catalog=catalog,
            organization_id=state.get("organization_id"),
            kind=_LINK_KIND[mod],
        )
        if link_res and not link_res.get("_unhandled"):
            if link_res.get("workspaceHint") and not link_res.get("toolProposals"):
                hint = link_res["workspaceHint"]
                link_res["toolProposals"] = [
                    {
                        "id": "ws-from-hint",
                        "name": "set_workspace",
                        "label": hint.get("label") or "Show list",
                        "args": {
                            "mode": hint.get("mode") or "list",
                            "auto": True,
                            **(
                                {"search": hint["search"]}
                                if hint.get("search")
                                else {}
                            ),
                            **(
                                {"entityId": hint["entityId"]}
                                if hint.get("entityId")
                                else {}
                            ),
                        },
                        "risk": "low",
                    }
                ]
            return (
                await _finish_draft(link_res)
                if _wants_create_walk(mod, surface, link_res, messages, user_text)
                else _finish(link_res)
            )

        if (
            surface == "create"
            or _answering_create_slot(mod, messages, surface, user_text)
            or (mod == "activities" and _looks_like_activity_log(user_text))
        ):
            draft_now = ctx.get("draft") or catalog.get("currentDraft") or {}
            if not isinstance(draft_now, dict):
                draft_now = {}
            draft_res = await _run_module_draft(
                mod,
                messages=messages,
                context=ctx,
                catalog=catalog,
                organization_id=state.get("organization_id"),
            )
            if (
                draft_res
                and draft_res.get("ok")
                and not draft_res.get("_unhandled")
                and (
                    draft_res.get("patch")
                    or draft_res.get("toolProposals")
                    or str(draft_res.get("assistantText") or "").strip()
                )
            ):
                return await _finish_draft(draft_res)
            native_create = await run_native_agent_turn(
                mod=mod,
                surface="create",
                messages=messages,
                context=ctx,
                catalog={
                    **catalog,
                    "currentDraft": draft_now,
                },
                user_text=user_text,
            )
            if should_commit_native_turn(native_create, user_text=user_text):
                return await _finish_draft(native_create)
            if draft_res and draft_res.get("ok"):
                return await _finish_draft(draft_res)

    # In-shell create: specialist draft first, native only if it actually acts
    if surface == "create" and mod in IN_SHELL_CREATE and mod not in (
        "contact",
        "sales",
        "company",
        "product",
    ):
        draft_res = await _run_module_draft(
            mod,
            messages=messages,
            context=ctx,
            catalog=catalog,
            organization_id=state.get("organization_id"),
        )
        if (
            draft_res
            and draft_res.get("ok")
            and not draft_res.get("_unhandled")
            and (
                draft_res.get("patch")
                or draft_res.get("toolProposals")
                or str(draft_res.get("assistantText") or "").strip()
            )
        ):
            return await _finish_draft(draft_res)
        native_create = await run_native_agent_turn(
            mod=mod,
            surface="create",
            messages=messages,
            context=ctx,
            catalog={
                **catalog,
                "currentDraft": ctx.get("draft") or catalog.get("currentDraft") or {},
            },
            user_text=user_text,
        )
        if should_commit_native_turn(native_create, user_text=user_text):
            return await _finish_draft(native_create)
        if draft_res:
            return await _finish_draft(draft_res)

    # Second native attempt (e.g. after module routing changed context)
    if is_ai_configured():
        native = await run_native_agent_turn(
            mod=mod,
            surface=surface,
            messages=messages,
            context=ctx,
            catalog=catalog,
            user_text=user_text,
        )
        if should_commit_native_turn(native, user_text=user_text):
            merged_native = {**native, "source": "ai"}
            if _wants_create_walk(
                mod, surface, merged_native, messages, user_text
            ):
                return await _finish_draft(merged_native)
            return _finish(merged_native)
        if (
            native
            and native.get("ok")
            and not native.get("_unhandled")
            and not native_speech_fallback
            and not is_generic_coworker_speech(
                str(native.get("assistantText") or "")
            )
        ):
            native_speech_fallback = {**native, "source": "ai"}

    # Fallback: JSON-in-text chat (still LLM)
    full_catalog = {
        "role": state.get("role") or catalog.get("role"),
        "businessType": business_type,
        "context": ctx,
        **{k: v for k, v in catalog.items() if k not in ("role", "businessType")},
    }
    chat = await chat_agent.run(
        system=AGENT_TURN_SYSTEM,
        user=build_conversation_prompt(full_catalog, messages),
        max_tokens=600,
        timeout_ms=20_000,
        organization_id=state.get("organization_id"),
    )
    if chat.get("ok") and (chat.get("text") or "").strip():
        parsed = parse_assistant_json(str(chat["text"]))
        if parsed and isinstance(parsed.get("assistantText"), str):
            raw_tools = parsed.get("toolProposals")
            tools = sanitize_tool_proposals(
                raw_tools,
                user_text,
                mod,
                pathname,
            )
            had_nav = isinstance(raw_tools, list) and any(
                isinstance(t, dict)
                and str(t.get("name") or "") in ("navigate", "open_entity")
                for t in raw_tools
            )
            has_nav = bool(
                tools
                and any(
                    t.get("name") in ("navigate", "open_entity") for t in tools
                )
            )
            # Model invented an unknown URL — ask instead of 404
            if had_nav and not has_nav:
                return _finish({**_clarify_destination(), "source": "heuristic"})
            out: dict[str, Any] = {
                "ok": True,
                "assistantText": sanitize_assistant_text_for_user(
                    str(parsed["assistantText"])
                )[:800],
                "source": "ai",
            }
            if tools:
                out["toolProposals"] = tools
                return _finish(out)
            # Speech-only JSON chat: prefer earlier native speech if any, else this
            if not native_speech_fallback:
                native_speech_fallback = out

    if native_speech_fallback and not is_generic_coworker_speech(
        str(native_speech_fallback.get("assistantText") or "")
    ):
        return _finish(native_speech_fallback)

    # LLM is required — no offline heuristic fallback.
    return _finish({
        "ok": False,
        "assistantText": LLM_ERROR_SPEECH,
        "source": "error",
        "reason": "llm_no_response",
    })

def _attach_workspace_hint(draft_res: dict[str, Any]) -> dict[str, Any]:
    text = draft_res.get("assistantText")
    if isinstance(text, str) and text.strip():
        draft_res = {
            **draft_res,
            "assistantText": sanitize_assistant_text_for_user(text),
        }
    if draft_res.get("workspaceHint") and not draft_res.get("toolProposals"):
        hint = draft_res["workspaceHint"]
        draft_res["toolProposals"] = [
            {
                "id": "ws-from-draft",
                "name": "set_workspace",
                "label": hint.get("label") or "Show list",
                "args": {
                    "mode": hint.get("mode") or "list",
                    "auto": True,
                },
                "risk": "low",
            }
        ]
    return draft_res


async def _run_module_draft(
    mod: str,
    *,
    messages: list[dict[str, Any]],
    context: dict[str, Any],
    catalog: dict[str, Any],
    organization_id: str | None,
) -> dict[str, Any] | None:
    common = dict(
        messages=messages,
        context=context,
        catalog=catalog,
        organization_id=organization_id,
    )
    if mod == "sales":
        return await deal_draft_agent.run(**common)
    if mod == "company":
        mode = "location" if context.get("entityId") else "company"
        return await company_draft_agent.run(**common, mode=mode)
    if mod == "product":
        return await misc_draft_agents.run(**common, kind="product")
    if mod == "finance":
        return await misc_draft_agents.run(**common, kind="invoice")
    if mod == "activities":
        return await misc_draft_agents.run(**common, kind="activity")
    if mod == "quotes":
        return await misc_draft_agents.run(**common, kind="quote")
    return None


async def route(state: CrmAgentState) -> CrmAgentState:
    intent = str(state.get("intent") or "agent_turn").strip()
    messages = state.get("messages") or []
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    org = state.get("organization_id")

    from app.agents.coworker_runtime import (
        hydrate_draft_record,
        normalize_session_memory,
        post_commit,
        stamp_create_session_memory,
    )

    stm_in = normalize_session_memory(
        state.get("session_memory") or ctx.get("sessionMemory") or {}
    )
    ctx = {**ctx, "sessionMemory": stm_in}
    draft_slot = {
        "contact_draft": "contactDraft",
        "company_draft": "companyDraft",
        "location_draft": "locationDraft",
        "deal_draft": "dealDraft",
        "product_draft": "productDraft",
        "invoice_draft": "invoiceDraft",
        "activity_draft": "activityDraft",
        "quote_draft": "quoteDraft",
    }.get(intent)
    if draft_slot:
        raw_draft = ctx.get("draft") if isinstance(ctx.get("draft"), dict) else {}
        if not raw_draft and isinstance(catalog.get("currentDraft"), dict):
            raw_draft = catalog.get("currentDraft") or {}
        hydrated = hydrate_draft_record(raw_draft, stm_in, draft_slot)
        ctx = {**ctx, "draft": hydrated}
        catalog = {**catalog, "currentDraft": hydrated}
    common = dict(
        messages=messages,
        context=ctx,
        catalog=catalog,
        organization_id=org,
    )

    if intent == "contact_draft":
        result = await contact_draft_agent.run(**common)
    elif intent == "company_draft":
        result = await company_draft_agent.run(**common, mode="company")
    elif intent == "location_draft":
        result = await company_draft_agent.run(**common, mode="location")
    elif intent == "deal_draft":
        result = await deal_draft_agent.run(**common)
    elif intent == "product_draft":
        result = await misc_draft_agents.run(**common, kind="product")
    elif intent == "invoice_draft":
        result = await misc_draft_agents.run(**common, kind="invoice")
    elif intent == "activity_draft":
        result = await misc_draft_agents.run(**common, kind="activity")
    elif intent == "quote_draft":
        result = await misc_draft_agents.run(**common, kind="quote")
    elif intent == "page_assist":
        result = await page_assist_agent.run(**common)
    else:
        # agent_turn (default)
        result = await handle_agent_turn(state)

    if not isinstance(result, dict):
        result = {"ok": False, "error": "CRM agent failed."}
    if intent.endswith("_draft"):
        result_patch = result.get("patch") or result.get("contactDraftPatch") or {}
        merged_draft = {
            **(ctx.get("draft") if isinstance(ctx.get("draft"), dict) else {}),
            **(result_patch if isinstance(result_patch, dict) else {}),
        }
        result = stamp_create_session_memory(
            result,
            intent=intent,
            draft=merged_draft,
            pathname=str(ctx.get("pathname") or ""),
        )
        result = post_commit(result, stm=stm_in)
    # Extract LLM-generated suggestions before speech validation.
    raw_text = str(result.get("assistantText") or "")
    cleaned, suggestions = extract_suggestions(raw_text)
    if cleaned != raw_text or suggestions:
        result = {**result, "assistantText": cleaned, "suggestions": suggestions}
    return {**state, "result": drop_non_llm_speech(result)}


_PIPELINE_STEPS = (
    route,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    intent: str = "agent_turn",
    messages: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    catalog: dict[str, Any] | None = None,
    sessionMemory: dict[str, Any] | None = None,
    session_memory: dict[str, Any] | None = None,
    organizationId: str | None = None,
    organization_id: str | None = None,
    role: str | None = None,
    businessType: str | None = None,
    business_type: str | None = None,
    actingUserId: str | None = None,
    acting_user_id: str | None = None,
    mcpBaseUrl: str | None = None,
    mcp_base_url: str | None = None,
    mcpExecutionToken: str | None = None,
    mcp_execution_token: str | None = None,
    confirmTool: dict[str, Any] | None = None,
    confirm_tool: dict[str, Any] | None = None,
    executionMode: str | None = None,
    execution_mode: str | None = None,
    **_extra: Any,
) -> dict[str, Any]:
    """Unified CRM co-worker entrypoint."""
    ctx = dict(context or {})
    cat = dict(catalog or {})
    execution_token = mcp_execution_token or mcpExecutionToken
    if execution_token:
        ctx["mcpExecutionToken"] = execution_token
    actor = acting_user_id or actingUserId
    org = organization_id or organizationId
    if actor:
        ctx["actingUserId"] = actor
        cat["actingUserId"] = actor
    if org:
        ctx["organizationId"] = org
        cat["organizationId"] = org
    if role:
        ctx["role"] = role
        cat["role"] = role
    business = str(business_type or businessType or "").strip()
    if business:
        ctx["businessType"] = business
        cat["businessType"] = business
    mode = str(executionMode or execution_mode or "").strip()
    if mode:
        ctx["executionMode"] = mode
    for body_key, extra_keys in (
        ("runId", ("runId", "run_id")),
        ("traceId", ("traceId", "trace_id")),
        ("idempotencyKey", ("idempotencyKey", "idempotency_key")),
    ):
        current = str(ctx.get(body_key) or "").strip()
        if current:
            continue
        for extra_key in extra_keys:
            value = str(_extra.get(extra_key) or "").strip()
            if value:
                ctx[body_key] = value
                break

    from app.agents.org_clock import attach_organization_clock

    await attach_organization_clock(ctx)

    # UI Confirm chip → HTTP MCP (or in-process fallback) with confirmed=true.
    conf = confirm_tool or confirmTool
    if isinstance(conf, dict) and conf.get("name"):
        from app.config import get_settings
        from app.mcp.server import begin_agent_mcp_context, end_agent_mcp_context
        from app.mcp_client import McpClient

        name = str(conf.get("name") or "").strip()
        args = conf.get("args") if isinstance(conf.get("args"), dict) else {}
        args = {**args, "confirmed": True}
        draft = ctx.get("draft") if isinstance(ctx.get("draft"), dict) else {}
        begin_agent_mcp_context(
            acting_user_id=str(actor or ""),
            organization_id=str(org or ""),
            role=str(role or ""),
            module=str(ctx.get("module") or ""),
            surface=str(ctx.get("surface") or "list"),
            entity_id=str(ctx.get("entityId") or "") or None,
            pathname=str(ctx.get("pathname") or "") or None,
            draft=draft,
        )
        mcp = McpClient(
            acting_user_id=str(actor or "") or None,
            organization_id=str(org or "") or None,
            role=str(role or "") or None,
            execution_token=mcp_execution_token or mcpExecutionToken,
            execution_context={
                "agentName": "crm-agent",
                "executionMode": str(executionMode or execution_mode or ctx.get("executionMode") or "native"),
                "businessType": str(business_type or businessType or ctx.get("businessType") or ""),
                "module": str(ctx.get("module") or ""),
                "surface": str(ctx.get("surface") or "list"),
                "policyVersion": get_settings().mcp_policy_version,
                "runId": str(ctx.get("runId") or ""),
                "traceId": str(ctx.get("traceId") or ""),
                "idempotencyKey": str(ctx.get("idempotencyKey") or ""),
            },
        )
        ui_refresh: dict[str, Any] = {}
        try:
            result = await mcp.call_tool(
                name,
                args,
                context={
                    **ctx,
                    "actingUserId": actor,
                    "organizationId": org,
                    "role": role,
                },
            )
        finally:
            ui_refresh = end_agent_mcp_context()
            from app.mcp_client import _merge_refresh

            http_refresh = mcp.drain_ui_refresh()
            if http_refresh:
                _merge_refresh(ui_refresh, http_refresh)
        if not isinstance(result, dict):
            return {
                "ok": False,
                "error": "Tool failed",
                "assistantText": LLM_ERROR_SPEECH,
            }
        # Vite/Fastify page handler owns the write — do not report success here.
        if result.get("kind") == "form_owned":
            return {
                "ok": False,
                "error": "form_owned",
                "reason": "form_owned",
            }
        speech = str(result.get("assistantText") or result.get("error") or "").strip()
        out: dict[str, Any] = {
            "ok": bool(result.get("ok", True)),
            "source": "heuristic",
            "reason": "confirm_tool",
        }
        if speech:
            out["assistantText"] = speech
        if result.get("kind") == "error" or result.get("ok") is False:
            out["ok"] = False
            out["error"] = str(result.get("error") or "Tool failed")
            out["assistantText"] = LLM_ERROR_SPEECH
            frag = result.get("uiRefresh")
            if isinstance(frag, dict):
                _merge_refresh(ui_refresh, frag)
            if ui_refresh:
                out["uiRefresh"] = ui_refresh
            return out
        frag = result.get("uiRefresh")
        if isinstance(frag, dict):
            _merge_refresh(ui_refresh, frag)
        if ui_refresh:
            out["uiRefresh"] = ui_refresh
        return drop_non_llm_speech(out, fallback=None)

    requested_mode = execution_mode or executionMode or str(ctx.get("executionMode") or "")
    if intent == "agent_turn" and not (isinstance(conf, dict) and conf.get("name")):
        from app.a2a.escalate import maybe_escalate_coworker_turn

        escalated = await maybe_escalate_coworker_turn(
            messages=messages,
            context=ctx,
            organization_id=org,
        )
        if escalated:
            return escalated
    if intent == "agent_turn" and org and actor:
        from app.agents.coworker_native import (
            is_seo_content_page,
            native_enabled_for,
            run_native_coworker,
        )
        from app.agents.crm_tools import is_hub_execute

        use_native = (
            not is_hub_execute(ctx)
            and (
                is_seo_content_page(ctx)
                or native_enabled_for(str(org), str(actor), requested_mode)
            )
        )
        if use_native:
            stm_in = session_memory or sessionMemory or {}
            native_result = await run_native_coworker(
                messages=messages or [],
                context=ctx,
                catalog=cat,
                session_memory=stm_in,
                organization_id=str(org),
                actor_id=str(actor),
                role=str(role or ""),
                business_type=str(business_type or businessType or ""),
                mcp_execution_token=execution_token,
            )
            if isinstance(native_result, dict):
                route_text = last_user_text(messages or []) or ""
                route_path = str(ctx.get("pathname") or "")
                native_result = bind_native_module_route(
                    native_result,
                    user_text=route_text,
                    module=str(ctx.get("module") or ""),
                    pathname=route_path,
                    surface=str(ctx.get("surface") or "list"),
                )
                if not native_turn_changes_page(native_result, route_path):
                    native_result = bind_native_contact_create(
                        native_result,
                        messages=messages or [],
                        context=ctx,
                        catalog=cat,
                        session_memory=stm_in if isinstance(stm_in, dict) else {},
                    )
                    native_result = bind_native_company_create(
                        native_result,
                        messages=messages or [],
                        context=ctx,
                        catalog=cat,
                        session_memory=stm_in if isinstance(stm_in, dict) else {},
                    )
            return drop_non_llm_speech(
                native_result if isinstance(native_result, dict) else {"ok": False}
            )

    result = await _run_pipeline(
        {
            "intent": intent or "agent_turn",
            "messages": messages or [],
            "context": ctx,
            "catalog": cat,
            "session_memory": session_memory or sessionMemory or {},
            "organization_id": org,
            "role": role,
            "business_type": business_type or businessType,
            "acting_user_id": actor,
            "mcp_base_url": None,
        }
    )
    out = result.get("result")
    if not isinstance(out, dict):
        return {
            "ok": False,
            "error": "CRM agent failed.",
            "assistantText": LLM_ERROR_SPEECH,
        }
    if "ok" not in out:
        out = {**out, "ok": True}
    return drop_non_llm_speech(out)
