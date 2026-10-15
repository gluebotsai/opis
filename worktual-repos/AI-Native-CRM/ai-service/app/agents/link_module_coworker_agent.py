"""Quotes / finance / activities co-worker — list, create nav, find/open."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.native_pipeline import run_steps

from app.agents.coworker_shared import (
    display_from_catalog,
    open_entity_id,
    rank_deals_by_name,
    wants_delete_intent,
)
from app.agents.draft_conversation import (
    is_field_add_not_create,
    looks_like_create_confirm,
    next_invoice_prompt,
    open_in_shell_create,
    parse_invoice_field_update,
    parse_quote_field_update,
    parse_quote_line_update,
    parse_quote_section_update,
    resolve_pending_quote_update_on_confirm,
    propose_delete_invoice_proposal,
    propose_delete_quote_proposal,
    propose_mark_invoice_paid_proposal,
    propose_send_invoice_proposal,
    propose_send_quote_proposal,
    propose_update_invoice_proposal,
    propose_update_quote_proposal,
    wants_send_invoice,
    wants_send_quote,
    utterance_has_details,
    wants_mark_invoice_paid,
)


class LinkModuleCoworkerState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    kind: str
    result: dict[str, Any]


def _last_user(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "user":
            return str(m.get("text") or "").strip()
    return ""


def _is_help_question(lower: str) -> bool:
    if re.search(
        r"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|register|insert|schedule|book)\b",
        lower,
    ):
        return False
    return bool(
        re.search(
            r"\b(what can you|how (can|do) you|help me\??$|what do you do|"
            r"help\?|who are you|what are you)\b",
            lower,
        )
        or re.search(r"^\s*help\s*$", lower)
    )


def _wants_create(lower: str, kind: str) -> bool:
    if _is_help_question(lower):
        return False
    if is_field_add_not_create(lower):
        return False
    entity = {
        "quotes": r"quot(?:e|ation)",
        "finance": r"invoice|bill",
        "activities": r"activit|call|meeting|task|note|log|appointment|demo|schedul",
    }.get(kind, r"record")
    return bool(
        re.search(
            rf"\b(create|new|start|make|draft|register|set\s*up|insert|schedule|book|arrange)\b|"
            rf"\badd\s+(a\s+|an\s+|new\s+)?({entity})\b|"
            rf"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|register|insert|schedule|book)\b|"
            rf"\b(want|need)\s+(a|an)\s+(new\s+)?({entity})\b",
            lower,
        )
        or (kind == "activities" and re.search(r"\blog\b", lower))
    )


def _is_list_intent(text: str, kind: str) -> bool:
    lower = text.lower().strip()
    labels = {
        "quotes": r"quotes?",
        "finance": r"invoices?|finance|billing",
        "activities": r"activit(?:y|ies)|tasks?",
    }
    label = labels.get(kind, r"list")
    return bool(
        re.search(rf"\b(show|back to|open)\s+(all\s+)?({label}|list)\b", lower)
        or re.search(rf"^\s*(list|{label})\s*$", lower)
    )


def extract_open_query(text: str, kind: str) -> str | None:
    labels = {
        "quotes": r"quote",
        "finance": r"invoice|bill",
        "activities": r"activit(?:y|ies)?|call|meeting|task|note",
    }
    label = labels.get(kind, r"record")
    # Wrap label alternation so ^ / \s+ bind to the whole entity, not one branch
    m = re.search(
        rf"(?:open|show|view|find|go to)\s+(?:(?:{label})\s+)?(.+)$",
        text,
        re.I,
    ) or re.search(rf"^(?:{label})\s+(.+)$", text, re.I)
    if not m:
        return None
    q = (m.group(1) or "").strip().rstrip(".?!")
    if not q or re.match(r"^(a|the|all|list|new)$", q, re.I):
        return None
    if _is_list_intent(text, kind):
        return None
    # Don't treat create intents as open/find
    if re.search(r"\b(create|new|add|log|draft|make|start)\b", text, re.I):
        return None
    return q[:120]


def resolve_record_match(
    catalog: dict[str, Any] | None,
    query: str,
    *,
    catalog_key: str,
    fields: tuple[str, ...],
) -> dict[str, Any] | None:
    items = (catalog or {}).get(catalog_key)
    if not isinstance(items, list) or not items:
        return None
    q = query.strip().lower()
    if not q:
        return None
    exact: list[dict[str, Any]] = []
    strong: list[dict[str, Any]] = []
    weak: list[dict[str, Any]] = []
    for raw in items:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        hay = " ".join(
            str(raw.get(f) or "").strip().lower() for f in fields if raw.get(f)
        )
        if not hay:
            continue
        if q == hay or any(str(raw.get(f) or "").strip().lower() == q for f in fields):
            exact.append(raw)
        elif hay.startswith(q) or q.startswith(hay.split()[0] if hay else ""):
            strong.append(raw)
        elif q in hay:
            weak.append(raw)
    for bucket in (exact, strong, weak):
        if len(bucket) == 1:
            return bucket[0]
    return None


def _find_or_search(
    query: str,
    *,
    catalog_key: str,
    fields: tuple[str, ...],
    catalog: dict[str, Any],
    entity_label: str,
) -> dict[str, Any]:
    match = resolve_record_match(catalog, query, catalog_key=catalog_key, fields=fields)
    if match:
        name = next(
            (str(match.get(f) or "").strip() for f in fields if match.get(f)),
            query,
        )
        return {
            "ok": True,
            "assistantText": f"Opening **{name}** — it's highlighted on the list.",
            "toolProposals": [
                {
                    "id": "ws-open",
                    "name": "set_workspace",
                    "label": f"Open {entity_label}",
                    "args": {
                        "mode": "list",
                        "entityId": str(match["id"]),
                        "auto": True,
                    },
                    "risk": "low",
                }
            ],
        }
    return {
        "ok": True,
        "assistantText": f"I'll search for **{query}** — check the list on the right.",
        "toolProposals": [
            {
                "id": "ws-search",
                "name": "set_workspace",
                "label": f"Search {entity_label}s",
                "args": {"mode": "list", "search": query, "auto": True},
                "risk": "low",
            }
        ],
    }


_KIND_META: dict[str, dict[str, Any]] = {
    "quotes": {
        "catalog_key": "quotes",
        "fields": ("number", "dealTitle"),
        "entity_label": "quote",
        "place": "Quotes",
        "create_label": "Create quote",
    },
    "finance": {
        "catalog_key": "invoices",
        "fields": ("number", "dealTitle", "companyName"),
        "entity_label": "invoice",
        "place": "Finance",
        "create_label": "Create invoice",
    },
    "activities": {
        "catalog_key": "activities",
        "fields": ("subject", "contactName"),
        "entity_label": "activity",
        "place": "Activities",
        "create_label": "Log activity",
    },
}


def heuristic(
    *,
    kind: str,
    text: str,
    context: dict[str, Any],
    catalog: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    meta = _KIND_META.get(kind)
    if not meta:
        return {"ok": False, "_unhandled": True}

    lower = text.lower().strip()
    surface = str(context.get("surface") or "").lower()
    pathname = str(context.get("pathname") or "")

    if _is_help_question(lower):
        return {
            "ok": True,
            "assistantText": (
                f"I'm with you on **{meta['place']}**. I can help you "
                f"create a new {meta['entity_label']}, find one on the list, "
                f"or switch back from create. Nothing saves until you confirm."
            ),
        }

    entity_id = open_entity_id(context)
    if surface == "detail" and entity_id:
        if kind == "quotes":
            if wants_delete_intent(lower):
                label = (
                    display_from_catalog(
                        catalog,
                        entity_id,
                        list_key="quotes",
                        name_keys=("number", "dealTitle"),
                        open_key="openQuote",
                    )
                    or "this quote"
                )
                return {
                    "ok": True,
                    "assistantText": f"I'll remove **{label}** now.",
                    "toolProposals": [
                        propose_delete_quote_proposal(
                            quote_id=entity_id,
                            display_name=label,
                        )
                    ],
                }
            if wants_send_quote(text):
                label = (
                    display_from_catalog(
                        catalog,
                        entity_id,
                        list_key="quotes",
                        name_keys=("number", "dealTitle"),
                        open_key="openQuote",
                    )
                    or "this quote"
                )
                deal_title = ""
                open_q = catalog.get("openQuote") if isinstance(catalog, dict) else None
                if isinstance(open_q, dict):
                    deal_title = str(open_q.get("dealTitle") or "").strip()
                recap = f"**{label}**"
                if deal_title:
                    recap += f" for **{deal_title}**"
                return {
                    "ok": True,
                    "assistantText": f"Sending {recap} now.",
                    "toolProposals": [
                        propose_send_quote_proposal(
                            quote_id=entity_id,
                            display_name=label,
                        )
                    ],
                }
            lines = parse_quote_line_update(text, catalog)
            if lines:
                recap_bits = []
                for row in lines.get("lines") or []:
                    recap_bits.append(
                        str(row.get("name") or row.get("productId") or "item")
                    )
                if lines.get("discountPct") == 0:
                    recap_bits.append("no discount")
                recap = ", ".join(recap_bits) or "line items"
                return {
                    "ok": True,
                    "assistantText": f"Updating this quote to **{recap}**.",
                    "toolProposals": [
                        propose_update_quote_proposal(
                            quote_id=entity_id,
                            patch=lines,
                        )
                    ],
                }
            section = parse_quote_section_update(text, catalog)
            if section:
                return {
                    "ok": True,
                    "assistantText": "Updating that section on the quote now.",
                    "toolProposals": [
                        propose_update_quote_proposal(
                            quote_id=entity_id,
                            patch=section,
                        )
                    ],
                }
            field = parse_quote_field_update(text)
            if field:
                recap = ", ".join(f"**{k}** → {v}" for k, v in field.items())
                return {
                    "ok": True,
                    "assistantText": f"Updating this quote: {recap}.",
                    "toolProposals": [
                        propose_update_quote_proposal(
                            quote_id=entity_id,
                            patch=field,
                        )
                    ],
                }
            if looks_like_create_confirm(text):
                pending = resolve_pending_quote_update_on_confirm(
                    messages,
                    catalog,
                )
                if pending:
                    return {
                        "ok": True,
                        "assistantText": "Saving that update on the quote now.",
                        "toolProposals": [
                            propose_update_quote_proposal(
                                quote_id=entity_id,
                                patch=pending,
                            )
                        ],
                    }
        if kind == "finance":
            if wants_delete_intent(lower):
                label = (
                    display_from_catalog(
                        catalog,
                        entity_id,
                        list_key="invoices",
                        name_keys=("number", "dealTitle", "companyName"),
                        open_key="openInvoice",
                    )
                    or "this invoice"
                )
                return {
                    "ok": True,
                    "assistantText": f"I'll remove **{label}** now.",
                    "toolProposals": [
                        propose_delete_invoice_proposal(
                            invoice_id=entity_id,
                            display_name=label,
                        )
                    ],
                }
            if wants_mark_invoice_paid(text):
                label = (
                    display_from_catalog(
                        catalog,
                        entity_id,
                        list_key="invoices",
                        name_keys=("number", "dealTitle"),
                        open_key="openInvoice",
                    )
                    or "this invoice"
                )
                return {
                    "ok": True,
                    "assistantText": f"I'll mark **{label}** as paid.",
                    "toolProposals": [
                        propose_mark_invoice_paid_proposal(invoice_id=entity_id)
                    ],
                }
            if wants_send_invoice(text):
                label = (
                    display_from_catalog(
                        catalog,
                        entity_id,
                        list_key="invoices",
                        name_keys=("number", "dealTitle", "companyName"),
                        open_key="openInvoice",
                    )
                    or "this invoice"
                )
                deal_title = ""
                open_inv = catalog.get("openInvoice") if isinstance(catalog, dict) else None
                if isinstance(open_inv, dict):
                    deal_title = str(open_inv.get("dealTitle") or "").strip()
                recap = f"**{label}**"
                if deal_title:
                    recap += f" for **{deal_title}**"
                return {
                    "ok": True,
                    "assistantText": f"Sending {recap} now.",
                    "toolProposals": [
                        propose_send_invoice_proposal(
                            invoice_id=entity_id,
                            display_name=label,
                        )
                    ],
                }
            lines = parse_quote_line_update(text, catalog)
            if lines:
                recap_bits = []
                for row in lines.get("lines") or []:
                    recap_bits.append(
                        str(row.get("name") or row.get("productId") or "item")
                    )
                if lines.get("discountPct") == 0:
                    recap_bits.append("no discount")
                recap = ", ".join(recap_bits) or "line items"
                return {
                    "ok": True,
                    "assistantText": f"Updating this invoice to **{recap}**.",
                    "toolProposals": [
                        propose_update_invoice_proposal(
                            invoice_id=entity_id,
                            patch=lines,
                        )
                    ],
                }
            field = parse_invoice_field_update(text)
            if field:
                recap = ", ".join(f"**{k}** → {v}" for k, v in field.items())
                return {
                    "ok": True,
                    "assistantText": f"Updating this invoice: {recap}.",
                    "toolProposals": [
                        propose_update_invoice_proposal(
                            invoice_id=entity_id,
                            patch=field,
                        )
                    ],
                }

    if _is_list_intent(text, kind):
        return {
            "ok": True,
            "assistantText": "Alright — back to the list. Chat stays right here.",
            "toolProposals": [
                {
                    "id": "ws-list",
                    "name": "set_workspace",
                    "label": "Show list",
                    "args": {"mode": "list", "auto": True},
                    "risk": "low",
                }
            ],
        }

    open_q = extract_open_query(text, kind)
    if open_q:
        return _find_or_search(
            open_q,
            catalog_key=meta["catalog_key"],
            fields=tuple(meta["fields"]),
            catalog=catalog,
            entity_label=meta["entity_label"],
        )

    if is_field_add_not_create(lower):
        return {
            "ok": True,
            "assistantText": (
                f"Which {meta['entity_label']} should I update? "
                f"Or did you want to create a new one?"
            ),
        }

    if _wants_create(lower, kind):
        if surface == "create":
            return {"ok": False, "_unhandled": True}
        rich = utterance_has_details(text)
        # Finance: if the utterance already names a deal, open create with it
        # linked and ask to save — don't stall on optional notes/currency.
        invoice_patch: dict[str, Any] | None = None
        if kind == "finance" and rich:
            deals = catalog.get("deals") if isinstance(catalog.get("deals"), list) else []
            exact = next(
                (
                    d
                    for d in deals
                    if isinstance(d, dict)
                    and d.get("id")
                    and d.get("title")
                    and str(d["title"]).lower() in lower
                ),
                None,
            )
            if exact:
                invoice_patch = {"dealId": str(exact["id"])}
            else:
                ranked = rank_deals_by_name(catalog, text, min_score=0.78, limit=2)
                if len(ranked) == 1 or (
                    len(ranked) >= 2 and ranked[0][0] >= ranked[1][0] + 0.08
                ):
                    invoice_patch = {"dealId": str(ranked[0][1]["id"])}

        if invoice_patch:
            return {
                "ok": True,
                "assistantText": next_invoice_prompt(
                    invoice_patch, just_patched=True
                ),
                "patch": invoice_patch,
                "toolProposals": [
                    {
                        "id": "ws-create",
                        "name": "set_workspace",
                        "label": meta["create_label"],
                        "args": {"mode": "create", "auto": True},
                        "risk": "low",
                    }
                ],
            }

        return open_in_shell_create(
            text,
            label=meta["create_label"],
            first_question={
                "quotes": "Sure — which deal is this quote for?",
                "finance": "Alright — which deal should this invoice link to?",
                "activities": "Sure — who is this activity about?",
            }.get(kind, "Let's set that up."),
        )

    return {"ok": False, "_unhandled": True}


async def handle(state: LinkModuleCoworkerState) -> LinkModuleCoworkerState:
    messages = state.get("messages") or []
    context = state.get("context") or {}
    catalog = state.get("catalog") or {}
    kind = state.get("kind") or "quotes"
    text = _last_user(messages)
    if not text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to continue."},
        }

    # Create-surface draft turns belong to the module create path (crm_agent /
    # misc_draft_agents). Running native tools here first used to return a
    # soft-confirm "yes" as "deal not found" and skip deterministic deal/product
    # resolution on the create path.
    surface = str(context.get("surface") or "").lower()
    if surface == "create":
        return {
            **state,
            "result": {"ok": True, "assistantText": "", "_unhandled": True},
        }

    from app.agents.coworker_shared import (
        last_assistant_text,
        should_commit_native_turn,
    )
    from app.agents.crm_tools import run_native_agent_turn
    from app.llm import is_ai_configured

    last_ask = last_assistant_text(messages)
    asked_create_slot = bool(
        last_ask
        and re.search(
            {
                "activities": r"\b(who is this|which contact|activity (for|about)|name the contact|what kind|call, meeting|subject|note say|due date|shall i save|log this)\b",
                "finance": r"\b(which deal|invoice (link|for)|deal should this)\b",
                "quotes": r"\b(which deal|quote for)\b",
            }.get(kind, r"(?!)"),
            last_ask,
            re.I,
        )
    )
    if asked_create_slot and not _wants_create(text.lower(), kind):
        return {
            **state,
            "result": {"ok": True, "assistantText": "", "_unhandled": True},
        }

    # Logging from the list must not run list-native search (q=name) —
    # that hides the create workspace and drops the matched contact.
    skip_native = kind == "activities" and _wants_create(text.lower(), kind)

    if not is_ai_configured():
        from app.agents.coworker_shared import llm_unavailable_result

        return {
            **state,
            "result": llm_unavailable_result("llm_unavailable"),
        }

    mod = kind if kind in {"quotes", "finance", "activities"} else "quotes"
    native: dict[str, Any] | None = None
    if not skip_native:
        native = await run_native_agent_turn(
            mod=mod,
            surface=surface or "list",
            messages=messages,
            context={**context, "module": mod},
            catalog=catalog,
            user_text=text,
        )
        if native and should_commit_native_turn(native, user_text=text):
            return {**state, "result": {**native, "source": "ai"}}
        if is_ai_configured() and native and native.get("ok"):
            return {**state, "result": {**native, "source": "ai"}}

    return {
        **state,
        "result": native
        if native and native.get("ok")
        else {"ok": True, "assistantText": "", "_unhandled": True},
    }


_PIPELINE_STEPS = (
    handle,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    *,
    messages: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    catalog: dict[str, Any] | None = None,
    organization_id: str | None = None,
    kind: str = "quotes",
) -> dict[str, Any]:
    del organization_id
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
            "kind": kind,
        }
    )
    return result.get("result") or {"ok": False, "_unhandled": True}
