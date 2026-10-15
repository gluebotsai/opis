"""
Coworker runtime: working memory + short-term session memory, pre/post hooks.

Deterministic pre-hooks run before the LLM. Session memory is client-held and
patched each turn (no Redis / long-term store in this pass).
"""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.coworker_shared import open_entity_id


class SessionSlots(TypedDict, total=False):
    dealId: str
    productIds: list[str]
    productHint: str
    companyId: str
    companyName: str
    contactId: str
    contactName: str
    proposalTitle: str
    # Contact/company create-flow progress (client STM — not durable memory).
    skippedOptional: str
    createModule: str


class SessionMemory(TypedDict, total=False):
    conversationId: str
    activeAgent: str
    activeDomain: str
    pendingIntent: str
    pendingAsk: str
    slots: SessionSlots
    lastEntities: dict[str, str]


class WorkingMemory(TypedDict, total=False):
    intent: str
    dealId: str
    productIds: list[str]
    productHint: str
    companyName: str
    contactName: str
    proposalTitle: str
    pendingAsk: str
    skippedOptional: str


def empty_session_memory() -> SessionMemory:
    return {"slots": {}, "pendingIntent": "", "pendingAsk": "", "lastEntities": {}}


# Collected create fields. Kept as short string maps so a refresh or the next
# turn still knows which record is in progress.
_DRAFT_SLOT_FIELDS: dict[str, tuple[str, ...]] = {
    "contactDraft": (
        "firstName",
        "lastName",
        "email",
        "phone",
        "title",
        "companyName",
        "companyId",
        "city",
        "country",
        "leadSource",
        "skippedOptional",
    ),
    "companyDraft": (
        "name",
        "locationName",
        "locationAddress",
        "locationType",
        "domain",
        "industry",
        "employeeCount",
        "linkedinUrl",
        "skippedOptional",
    ),
    "locationDraft": ("name", "type", "address", "industry", "skippedOptional"),
    "dealDraft": (
        "title",
        "stage",
        "amount",
        "companyId",
        "companyName",
        "locationId",
        "contactId",
        "contactName",
        "currency",
        "notes",
        "expectedCloseDate",
    ),
    "productDraft": (
        "name",
        "sku",
        "brand",
        "category",
        "description",
        "price",
        "currency",
        "status",
        "productType",
        "skippedOptional",
    ),
    "invoiceDraft": (
        "dealId",
        "currency",
        "notes",
        "paymentTerms",
        "issueDate",
        "dueDate",
        "productId",
        "quantity",
    ),
    "activityDraft": (
        "contactId",
        "type",
        "subject",
        "body",
        "dueAt",
        "skippedOptional",
    ),
    "quoteDraft": ("dealId", "discountPct", "productId", "quantity", "offerId"),
}

_CREATE_INTENT_MEMORY: dict[str, tuple[str, str, str]] = {
    "contact_draft": ("create_contact", "contact", "contactDraft"),
    "company_draft": ("create_company", "company", "companyDraft"),
    "location_draft": ("create_location", "company", "locationDraft"),
    "deal_draft": ("create_deal", "sales", "dealDraft"),
    "product_draft": ("create_product", "product", "productDraft"),
    "invoice_draft": ("create_invoice", "finance", "invoiceDraft"),
    "activity_draft": ("create_activity", "activities", "activityDraft"),
    "quote_draft": ("create_quote", "quotes", "quoteDraft"),
}


def _clean_string_map(raw: Any, keys: tuple[str, ...]) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key in keys:
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()[:500]
    return out


def _clean_pending_duplicates(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    rows: list[dict[str, str]] = []
    for item in raw[:8]:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "").strip()[:80]
        if not cid:
            continue
        row = {"id": cid}
        for key in ("displayName", "email", "phone", "name"):
            val = str(item.get(key) or "").strip()[:200]
            if val:
                row[key] = val
        rows.append(row)
    return rows


def normalize_session_memory(raw: Any) -> SessionMemory:
    if not isinstance(raw, dict):
        return empty_session_memory()
    slots_raw = raw.get("slots") if isinstance(raw.get("slots"), dict) else {}
    slots: SessionSlots = {}
    for key in (
        "dealId",
        "productHint",
        "companyId",
        "companyName",
        "contactId",
        "contactName",
        "proposalTitle",
        "skippedOptional",
        "createModule",
    ):
        val = slots_raw.get(key)
        if isinstance(val, str) and val.strip():
            slots[key] = val.strip()[:500]  # type: ignore[literal-required]
    pids = slots_raw.get("productIds")
    if isinstance(pids, list):
        cleaned = [str(p).strip() for p in pids if str(p).strip()]
        if cleaned:
            slots["productIds"] = cleaned[:10]
    for slot_key, fields in _DRAFT_SLOT_FIELDS.items():
        snap = _clean_string_map(slots_raw.get(slot_key), fields)
        if snap:
            slots[slot_key] = snap  # type: ignore[literal-required]
    dupes = _clean_pending_duplicates(slots_raw.get("pendingDuplicateContacts"))
    if dupes:
        slots["pendingDuplicateContacts"] = dupes  # type: ignore[literal-required]
    last = raw.get("lastEntities") if isinstance(raw.get("lastEntities"), dict) else {}
    last_entities = {
        str(k): str(v)[:200]
        for k, v in last.items()
        if isinstance(k, str) and v is not None and str(v).strip()
    }
    return {
        "conversationId": str(raw.get("conversationId") or "")[:80],
        "activeAgent": str(raw.get("activeAgent") or "")[:80],
        "activeDomain": str(raw.get("activeDomain") or "")[:80],
        "pendingIntent": str(raw.get("pendingIntent") or "")[:80],
        "pendingAsk": str(raw.get("pendingAsk") or "")[:80],
        "slots": slots,
        "lastEntities": last_entities,
    }


def merge_session_patch(
    current: SessionMemory, patch: dict[str, Any] | None
) -> SessionMemory:
    if not patch:
        return current
    if patch.get("clear"):
        return empty_session_memory()
    base = normalize_session_memory(current)
    if "pendingIntent" in patch:
        base["pendingIntent"] = str(patch.get("pendingIntent") or "")[:80]
    if "pendingAsk" in patch:
        base["pendingAsk"] = str(patch.get("pendingAsk") or "")[:80]
    if "conversationId" in patch and patch.get("conversationId"):
        base["conversationId"] = str(patch["conversationId"])[:80]
    if "activeAgent" in patch:
        base["activeAgent"] = str(patch.get("activeAgent") or "")[:80]
    if "activeDomain" in patch:
        base["activeDomain"] = str(patch.get("activeDomain") or "")[:80]
    if isinstance(patch.get("slots"), dict):
        slots = dict(base.get("slots") or {})
        for k, v in patch["slots"].items():
            if v is None or v == "" or v == []:
                slots.pop(k, None)
            else:
                slots[k] = v  # type: ignore[literal-required]
        base["slots"] = slots  # type: ignore[assignment]
    if isinstance(patch.get("lastEntities"), dict):
        last = dict(base.get("lastEntities") or {})
        for k, v in patch["lastEntities"].items():
            if v is None or v == "":
                last.pop(k, None)
            else:
                last[str(k)] = str(v)[:200]
        base["lastEntities"] = last
    return base


def catalog_deals(catalog: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw = (catalog or {}).get("deals") if isinstance(catalog, dict) else None
    if not isinstance(raw, list):
        return []
    return [d for d in raw if isinstance(d, dict) and d.get("id")]


def hydrate_working_from_session(
    stm: SessionMemory,
    ctx: dict[str, Any],
    catalog: dict[str, Any] | None,
) -> WorkingMemory:
    slots = stm.get("slots") or {}
    wm: WorkingMemory = {
        "intent": str(stm.get("pendingIntent") or ""),
        "pendingAsk": str(stm.get("pendingAsk") or ""),
    }
    if slots.get("dealId"):
        wm["dealId"] = str(slots["dealId"])
    entity = open_entity_id(ctx) or ctx.get("entityId")
    if (
        not wm.get("dealId")
        and entity
        and str(ctx.get("module") or "").lower() == "sales"
    ):
        wm["dealId"] = str(entity)
    deals = catalog_deals(catalog)
    if (
        not wm.get("dealId")
        and len(deals) == 1
        and stm.get("pendingIntent") == "create_proposal"
    ):
        wm["dealId"] = str(deals[0]["id"])
    if slots.get("productIds"):
        wm["productIds"] = list(slots["productIds"])
    if slots.get("productHint"):
        wm["productHint"] = str(slots["productHint"])
    if slots.get("companyName"):
        wm["companyName"] = str(slots["companyName"])
    if slots.get("contactName"):
        wm["contactName"] = str(slots["contactName"])
    if slots.get("proposalTitle"):
        wm["proposalTitle"] = str(slots["proposalTitle"])
    if slots.get("skippedOptional"):
        wm["skippedOptional"] = str(slots["skippedOptional"])
    return wm


def pending_ask_field(pending_ask: str | None) -> str:
    """Strip module prefix from pendingAsk (contact_phone → phone)."""
    raw = str(pending_ask or "").strip()
    if not raw:
        return ""
    for prefix in ("contact_", "company_", "deal_", "product_"):
        if raw.startswith(prefix):
            return raw[len(prefix) :]
    return raw


def _deal_label(deal: dict[str, Any]) -> str:
    return str(
        deal.get("title")
        or deal.get("contactName")
        or deal.get("companyName")
        or "Untitled deal"
    )


def _proposal_pre_route_result(
    flow: dict[str, Any],
    *,
    reason: str,
    slots: dict[str, Any] | None = None,
    last_entities: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Preserve pendingAsk from _build_proposal_flow when LLM is configured."""
    existing = flow.get("sessionMemoryPatch")
    if isinstance(existing, dict) and existing.get("pendingAsk") == "requirement_pdf":
        return {**flow, "source": "heuristic", "reason": reason}
    tools = flow.get("toolProposals") or []
    creating = any(
        isinstance(t, dict) and t.get("name") == "propose_create_proposal"
        for t in tools
    )
    patch: SessionMemory = {
        "pendingIntent": "" if creating else "create_proposal",
        "pendingAsk": "" if creating else "product",
        "slots": slots or {},
    }
    if creating and last_entities:
        patch["lastEntities"] = last_entities
    return {**flow, "sessionMemoryPatch": patch, "source": "heuristic", "reason": reason}


def pre_route_proposal(
    *,
    user_text: str,
    messages: list[dict[str, Any]],
    ctx: dict[str, Any],
    catalog: dict[str, Any],
    stm: SessionMemory,
    wm: WorkingMemory,
    allow_keyword_intent: bool = True,
) -> dict[str, Any] | None:
    """Proposal continuity + optional offline keyword start.

    When ``allow_keyword_intent`` is False (LLM configured), never short-circuit
    — the coworker agent owns proposal create/wait-for-BRD.
    """
    if not allow_keyword_intent:
        return None

    from app.agents.deal_coworker_agent import (
        _ask_which_proposal_product,
        _awaiting_proposal_deal_pick,
        _awaiting_proposal_product,
        _awaiting_requirement_brd,
        _build_proposal_flow,
        _defers_products_to_requirement_pdf,
        _match_deals_for_proposal,
        _product_rows,
        _proposal_title,
        _requirement_pdf_name,
        _prior_user_text,
        _wants_create_proposal,
        extract_proposal_customer,
        extract_proposal_doc_title,
        extract_proposal_topic,
        match_products_for_proposal,
        resolve_deal_match,
    )

    mod = str(ctx.get("module") or "").lower()
    pathname = str(ctx.get("pathname") or "")
    surface = str(ctx.get("surface") or "").lower()
    on_quotes = mod == "quotes" or pathname.startswith("/sales/quotes")
    lower = user_text.lower().strip()
    deals = catalog_deals(catalog)
    pending = str(stm.get("pendingIntent") or wm.get("intent") or "")
    requirement_pdf = _requirement_pdf_name(ctx)
    wants = _wants_create_proposal(lower) or (
        bool(requirement_pdf) and _defers_products_to_requirement_pdf(user_text)
    )

    # Continue: BRD attach / generate while proposal pending
    if pending == "create_proposal" and (
        _awaiting_requirement_brd(messages)
        or stm.get("pendingAsk") == "requirement_pdf"
        or _awaiting_proposal_product(messages)
        or stm.get("pendingAsk") == "product"
    ):
        deal_id = str(wm.get("dealId") or (stm.get("slots") or {}).get("dealId") or "")
        detail_id = open_entity_id(ctx)
        if surface == "detail" and detail_id:
            deal_id = str(detail_id)
        topic = (
            wm.get("productHint")
            or (stm.get("slots") or {}).get("productHint")
            or extract_proposal_topic(_prior_user_text(messages) or user_text)
            or extract_proposal_topic(user_text)
        )
        deal_id = str(wm.get("dealId") or (stm.get("slots") or {}).get("dealId") or "")
        if surface == "detail" and detail_id:
            deal_id = str(detail_id)
        if not deal_id and len(deals) == 1:
            deal_id = str(deals[0]["id"])
        if not deal_id:
            hits = _match_deals_for_proposal(catalog, user_text)
            if len(hits) == 1:
                deal_id = str(hits[0]["id"])
        if not deal_id and deals:
            names = ", ".join(f"**{_deal_label(d)}**" for d in deals[:5])
            return {
                "ok": True,
                "assistantText": f"Got it. Which deal is this for — {names}?",
                "sessionMemoryPatch": {
                    "pendingIntent": "create_proposal",
                    "pendingAsk": "deal",
                    "slots": {"productHint": topic},
                },
                "source": "heuristic",
                "reason": "stm_proposal_need_deal",
            }
        if not deal_id:
            return {
                "ok": True,
                "assistantText": (
                    "There's no deal on the board yet — I'll create one with you, "
                    "then write the proposal. Who's the customer or company?"
                ),
                "toolProposals": [
                    {
                        "id": "ws-create-for-prop",
                        "name": "set_workspace",
                        "label": "Create deal",
                        "args": {
                            "mode": "create",
                            "auto": True,
                            "afterCreate": "proposal",
                            "seedPrompt": user_text[:2000],
                        },
                        "risk": "low",
                    }
                ],
                "sessionMemoryPatch": {
                    "pendingIntent": "create_proposal",
                    "pendingAsk": "deal_create",
                    "slots": {"productHint": topic},
                },
                "source": "heuristic",
                "reason": "stm_proposal_no_deals",
            }
        customer = (
            wm.get("contactName")
            or (stm.get("slots") or {}).get("contactName")
            or extract_proposal_customer(user_text)
        )
        title = (
            wm.get("proposalTitle")
            or (stm.get("slots") or {}).get("proposalTitle")
            or _proposal_title(customer, topic)
        )
        flow = _build_proposal_flow(
            text=user_text,
            catalog=catalog,
            deal_id=deal_id,
            customer=customer,
            topic=topic,
            title=title,
            requirement_pdf=requirement_pdf,
        )
        patch_slots: dict[str, Any] = {"dealId": deal_id, "productHint": topic}
        return _proposal_pre_route_result(
            flow,
            reason="stm_proposal_products",
            slots=patch_slots,
        )

    # Continue: deal pick / soft entity while proposal pending
    if pending == "create_proposal" and (
        _awaiting_proposal_deal_pick(messages)
        or stm.get("pendingAsk") == "deal"
        or (
            not wants
            and not re.search(r"\b(new deal|create (a )?deal)\b", lower)
            and 0 < len(user_text.strip()) < 80
        )
    ):
        q = user_text.strip()[:160]
        if q and not re.match(r"^(ok|okay|yes|sure|yep|yeah)$", q, re.I):
            hits = _match_deals_for_proposal(catalog, q)
            match = hits[0] if len(hits) == 1 else resolve_deal_match(catalog, q)
            if match and match.get("id"):
                deal_id = str(match["id"])
                customer = (
                    str(match.get("contactName") or match.get("companyName") or "")
                    or None
                )
                topic = (
                    wm.get("productHint")
                    or (stm.get("slots") or {}).get("productHint")
                    or extract_proposal_topic(user_text)
                )
                title = (
                    wm.get("proposalTitle")
                    or (stm.get("slots") or {}).get("proposalTitle")
                    or _proposal_title(customer, topic)
                )
                products: list[dict[str, Any]] = []
                if topic:
                    products = match_products_for_proposal(catalog, topic)
                if products or not _product_rows(catalog):
                    flow = _build_proposal_flow(
                        text=user_text,
                        catalog=catalog,
                        deal_id=deal_id,
                        customer=customer,
                        topic=topic,
                        title=title,
                        requirement_pdf=requirement_pdf,
                    )
                    return _proposal_pre_route_result(
                        flow,
                        reason="stm_proposal_deal_picked",
                        slots={
                            "dealId": deal_id,
                            **({"productHint": topic} if topic else {}),
                        },
                        last_entities={"dealId": deal_id},
                    )
                ask = _ask_which_proposal_product(
                    catalog, customer=customer or _deal_label(match)
                )
                return {
                    **ask,
                    "sessionMemoryPatch": {
                        "pendingIntent": "create_proposal",
                        "pendingAsk": "product",
                        "slots": {
                            "dealId": deal_id,
                            **({"productHint": topic} if topic else {}),
                        },
                    },
                    "source": "heuristic",
                    "reason": "stm_proposal_deal_then_product",
                }
            if len(hits) > 1:
                names = ", ".join(f"**{_deal_label(d)}**" for d in hits[:5])
                return {
                    "ok": True,
                    "assistantText": (
                        f"A few deals match — {names}. Which should I use?"
                    ),
                    "sessionMemoryPatch": {
                        "pendingIntent": "create_proposal",
                        "pendingAsk": "deal",
                    },
                    "source": "heuristic",
                    "reason": "stm_proposal_deal_ambiguous",
                }

    if not wants:
        return None

    # Quotes / non-sales leave early handoff in crm_agent
    if mod != "sales" or on_quotes:
        return None

    customer = extract_proposal_customer(user_text)
    topic = extract_proposal_topic(user_text)
    title = extract_proposal_doc_title(user_text) or _proposal_title(customer, topic)

    hits = []
    if customer:
        hits = _match_deals_for_proposal(catalog, customer)
    if not hits and wm.get("dealId"):
        for d in deals:
            if str(d.get("id")) == wm["dealId"]:
                hits = [d]
                break

    if surface == "detail" and open_entity_id(ctx):
        deal_id = str(open_entity_id(ctx))
        flow = _build_proposal_flow(
            text=user_text,
            catalog=catalog,
            deal_id=deal_id,
            customer=customer,
            topic=topic,
            title=title,
            requirement_pdf=requirement_pdf,
        )
        return _proposal_pre_route_result(
            flow,
            reason="stm_proposal_detail",
            slots={
                "dealId": deal_id,
                **({"productHint": topic} if topic else {}),
                **({"proposalTitle": title} if title else {}),
            },
        )

    if len(hits) == 1:
        deal = hits[0]
        flow = _build_proposal_flow(
            text=user_text,
            catalog=catalog,
            deal_id=str(deal["id"]),
            customer=customer or str(deal.get("contactName") or None),
            topic=topic,
            title=title,
            requirement_pdf=requirement_pdf,
        )
        return _proposal_pre_route_result(
            flow,
            reason="stm_proposal_matched",
            slots={
                "dealId": str(deal["id"]),
                **({"productHint": topic} if topic else {}),
                **({"proposalTitle": title} if title else {}),
            },
            last_entities={"dealId": str(deal["id"])},
        )

    if len(hits) > 1:
        names = ", ".join(f"**{_deal_label(d)}**" for d in hits[:5])
        return {
            "ok": True,
            "assistantText": f"Sure — which deal is this for? {names}.",
            "sessionMemoryPatch": {
                "pendingIntent": "create_proposal",
                "pendingAsk": "deal",
                "slots": {
                    **({"productHint": topic} if topic else {}),
                    **({"proposalTitle": title} if title else {}),
                },
            },
            "source": "heuristic",
            "reason": "stm_proposal_which_deal",
        }

    if deals:
        if len(deals) == 1:
            deal = deals[0]
            flow = _build_proposal_flow(
                text=user_text,
                catalog=catalog,
                deal_id=str(deal["id"]),
                customer=customer or str(deal.get("contactName") or None),
                topic=topic,
                title=title,
                requirement_pdf=requirement_pdf,
            )
            return _proposal_pre_route_result(
                flow,
                reason="stm_proposal_sole_deal",
                slots={
                    "dealId": str(deal["id"]),
                    **({"productHint": topic} if topic else {}),
                    **({"proposalTitle": title} if title else {}),
                },
                last_entities={"dealId": str(deal["id"])},
            )
        names = ", ".join(f"**{_deal_label(d)}**" for d in deals[:5])
        more = f" (+{len(deals) - 5} more)" if len(deals) > 5 else ""
        return {
            "ok": True,
            "assistantText": f"Sure — which deal is this for? {names}{more}.",
            "sessionMemoryPatch": {
                "pendingIntent": "create_proposal",
                "pendingAsk": "deal",
                "slots": {
                    **({"productHint": topic} if topic else {}),
                    **({"proposalTitle": title} if title else {}),
                },
            },
            "source": "heuristic",
            "reason": "stm_proposal_pick_deal",
        }

    return {
        "ok": True,
        "assistantText": (
            "There's no deal on the board yet — I'll create one with you, then "
            "write the proposal. Who's the customer or company?"
        ),
        "toolProposals": [
            {
                "id": "ws-create-for-prop",
                "name": "set_workspace",
                "label": "Create deal",
                "args": {
                    "mode": "create",
                    "auto": True,
                    "afterCreate": "proposal",
                    **(
                        {"seedPrompt": user_text[:2000]}
                        if customer or extract_proposal_doc_title(user_text)
                        else {}
                    ),
                },
                "risk": "low",
            }
        ],
        "sessionMemoryPatch": {
            "pendingIntent": "create_proposal",
            "pendingAsk": "deal_create",
            "slots": {
                **({"productHint": topic} if topic else {}),
                **({"proposalTitle": title} if title else {}),
            },
        },
        "source": "heuristic",
        "reason": "stm_proposal_empty_board",
    }


def hydrate_draft_record(
    record: dict[str, Any] | None,
    stm: SessionMemory | dict[str, Any] | None,
    slot_key: str,
) -> dict[str, Any]:
    """Fill empty draft fields from the snapshot stored on the previous turn."""
    out = dict(record) if isinstance(record, dict) else {}
    fields = _DRAFT_SLOT_FIELDS.get(slot_key)
    if not fields or not isinstance(stm, dict):
        return out
    slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
    stored = slots.get(slot_key) if isinstance(slots, dict) else None
    if not isinstance(stored, dict):
        return out
    for key in fields:
        if str(out.get(key) or "").strip():
            continue
        val = stored.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()[:500]
    return out


def _on_create_page(pathname: str) -> bool:
    path = (pathname or "").split("?")[0].rstrip("/")
    return path.endswith("/new") or path.endswith("/log")


def stamp_create_session_memory(
    result: dict[str, Any],
    *,
    intent: str,
    draft: dict[str, Any] | None,
    pathname: str = "",
) -> dict[str, Any]:
    """Remember which create is in progress, including the fields already collected.

    An explicit empty pendingIntent (the agent cleared the task) is left alone.
    A navigate away from this module does not get glued back onto the old record.
    """
    spec = _CREATE_INTENT_MEMORY.get(intent)
    if not spec or not isinstance(result, dict) or result.get("ok") is False:
        return result
    pending, module, slot_key = spec
    from app.agents.coworker_shared import result_leaves_current_page

    patch = (
        dict(result.get("sessionMemoryPatch"))
        if isinstance(result.get("sessionMemoryPatch"), dict)
        else {}
    )
    slots = dict(patch.get("slots")) if isinstance(patch.get("slots"), dict) else {}
    tools = result.get("toolProposals") or []
    creating = any(
        isinstance(tool, dict)
        and str(tool.get("name") or "").startswith("propose_create_")
        for tool in tools
    )
    if creating:
        patch["pendingIntent"] = ""
        patch["pendingAsk"] = ""
        slots["createModule"] = ""
        slots[slot_key] = {}
    elif result_leaves_current_page(result, pathname=pathname, module=module):
        if "pendingIntent" not in patch:
            patch["pendingIntent"] = ""
            patch["pendingAsk"] = ""
            slots["createModule"] = ""
    elif not _on_create_page(pathname) and "pendingIntent" not in patch:
        return result
    else:
        if "pendingIntent" not in patch and _on_create_page(pathname):
            patch["pendingIntent"] = pending
            patch["pendingAsk"] = str(patch.get("pendingAsk") or "")
        if (
            str(patch.get("pendingIntent") or "") == pending
            and not str(slots.get("createModule") or "").strip()
        ):
            slots["createModule"] = module
        if str(patch.get("pendingIntent") or "") == pending or _on_create_page(pathname):
            snap = _clean_string_map(draft, _DRAFT_SLOT_FIELDS[slot_key])
            if snap:
                slots[slot_key] = snap
    patch["slots"] = slots
    return {**result, "sessionMemoryPatch": patch}


def post_commit(
    result: dict[str, Any],
    *,
    stm: SessionMemory,
) -> dict[str, Any]:
    """Attach / merge sessionMemoryPatch onto the agent result."""
    if not isinstance(result, dict) or not result.get("ok"):
        return result
    patch = result.get("sessionMemoryPatch")
    if not isinstance(patch, dict):
        patch = {}
    tools = result.get("toolProposals") or []
    if any(
        isinstance(t, dict) and t.get("name") == "propose_create_proposal"
        for t in tools
    ):
        deal_id = None
        for t in tools:
            if isinstance(t, dict) and t.get("name") == "propose_create_proposal":
                args = t.get("args") or {}
                if isinstance(args, dict) and args.get("dealId"):
                    deal_id = str(args["dealId"])
                break
        patch = {
            **patch,
            "pendingIntent": "",
            "pendingAsk": "",
            "slots": {
                **(patch.get("slots") if isinstance(patch.get("slots"), dict) else {}),
                **({"dealId": deal_id} if deal_id else {}),
            },
            "lastEntities": {
                **(
                    patch.get("lastEntities")
                    if isinstance(patch.get("lastEntities"), dict)
                    else {}
                ),
                **({"dealId": deal_id} if deal_id else {}),
            },
        }
    merged = merge_session_patch(stm, patch)
    return {**result, "sessionMemoryPatch": patch, "sessionMemory": merged}


async def run_skill_turn(
    *,
    mod: str,
    surface: str,
    messages: list[dict[str, Any]],
    context: dict[str, Any],
    catalog: dict[str, Any],
    user_text: str,
    stm: SessionMemory | None = None,
) -> dict[str, Any] | None:
    """Native tool turn with STM in context."""
    from app.agents.crm_tools import run_native_agent_turn

    ctx = dict(context or {})
    if stm:
        ctx["sessionMemory"] = stm
    return await run_native_agent_turn(
        mod=mod,
        surface=surface,
        messages=messages,
        context=ctx,
        catalog=catalog,
        user_text=user_text,
    )
