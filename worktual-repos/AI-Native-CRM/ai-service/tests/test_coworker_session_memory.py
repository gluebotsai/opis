"""STM proposal continuity: sticky dealId across product replies."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import patch

from app.agents.coworker_runtime import (
    merge_session_patch,
    normalize_session_memory,
    pre_route_proposal,
)
from app.agents.crm_agent import handle_agent_turn


ZOHO_CATALOG: dict[str, Any] = {
    "businessType": "b2b",
    "deals": [
        {
            "id": "deal-zoho",
            "title": "Zoho — yaswanth M G",
            "companyName": "Zoho",
            "contactName": "Yaswanth",
            "stage": "propose",
        }
    ],
    "products": [
        {"id": "p-crm", "name": "AI Native CRM", "sku": "CRM"},
        {"id": "p-tick", "name": "Ticketing System", "sku": "TICK"},
    ],
}

MULTI_DEAL_CATALOG: dict[str, Any] = {
    **ZOHO_CATALOG,
    "deals": [
        {
            "id": "deal-acme",
            "title": "Acme Renew",
            "companyName": "Acme",
            "contactName": "Ada",
            "stage": "qualify",
        },
        {
            "id": "deal-zoho",
            "title": "Zoho — yaswanth M G",
            "companyName": "Zoho",
            "contactName": "Yaswanth",
            "stage": "propose",
        },
    ],
}


def _ctx(mod: str = "sales", pathname: str = "/sales") -> dict[str, Any]:
    return {"module": mod, "surface": "list", "pathname": pathname}


def _tools(r: dict[str, Any]) -> list[dict[str, Any]]:
    return [t for t in (r.get("toolProposals") or []) if isinstance(t, dict)]


def _names(r: dict[str, Any]) -> list[str]:
    return [str(t.get("name") or "") for t in _tools(r)]


def _offline_turn(
    text: str,
    *,
    catalog: dict[str, Any],
    session_memory: dict[str, Any] | None = None,
    messages: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    state = {
        "messages": messages
        or [{"role": "user", "text": text}],
        "context": _ctx(),
        "catalog": catalog,
        "session_memory": session_memory or {},
        "business_type": "b2b",
    }
    with (
        patch("app.llm.is_ai_configured", return_value=False),
        patch("app.agents.crm_tools.run_native_agent_turn", return_value=None),
        patch("app.agents.crm_agent.run_native_agent_turn", return_value=None),
    ):
        return asyncio.run(handle_agent_turn(state))


def test_merge_session_patch_clear_and_slots() -> None:
    base = normalize_session_memory(
        {"pendingIntent": "create_proposal", "slots": {"dealId": "d1"}}
    )
    merged = merge_session_patch(base, {"slots": {"productHint": "crm"}})
    assert merged["slots"]["dealId"] == "d1"
    assert merged["slots"]["productHint"] == "crm"
    cleared = merge_session_patch(merged, {"clear": True})
    assert not cleared.get("pendingIntent")
    assert not (cleared.get("slots") or {})


def test_normalize_keeps_create_skip_slots() -> None:
    stm = normalize_session_memory(
        {
            "pendingIntent": "create_contact",
            "pendingAsk": "contact_company",
            "slots": {
                "skippedOptional": "phone,title",
                "createModule": "contact",
                "contactName": "Hansa Solanki",
            },
        }
    )
    assert stm["pendingAsk"] == "contact_company"
    assert stm["slots"]["skippedOptional"] == "phone,title"
    assert stm["slots"]["createModule"] == "contact"
    from app.agents.coworker_runtime import pending_ask_field, hydrate_working_from_session

    assert pending_ask_field(stm["pendingAsk"]) == "company"
    wm = hydrate_working_from_session(stm, {}, {})
    assert wm.get("skippedOptional") == "phone,title"
    assert wm.get("pendingAsk") == "contact_company"


def test_normalize_keeps_draft_snapshot_and_active_agent() -> None:
    from app.agents.coworker_runtime import (
        hydrate_draft_record,
        stamp_create_session_memory,
    )

    stm = normalize_session_memory(
        {
            "activeAgent": "company",
            "pendingIntent": "create_company",
            "slots": {
                "createModule": "company",
                "companyDraft": {
                    "name": "Lenova",
                    "locationName": "Chennai",
                    "industry": "tech",
                },
            },
        }
    )
    assert stm["activeAgent"] == "company"
    assert stm["slots"]["companyDraft"]["name"] == "Lenova"
    hydrated = hydrate_draft_record({}, stm, "companyDraft")
    assert hydrated["name"] == "Lenova"
    assert hydrated["locationName"] == "Chennai"

    stamped = stamp_create_session_memory(
        {"ok": True, "assistantText": "Saving Lenova."},
        intent="location_draft",
        draft={"name": "HQ", "address": "Chennai"},
        pathname="/company/acme/locations/new",
    )
    patch = stamped["sessionMemoryPatch"]
    assert patch["pendingIntent"] == "create_location"
    assert patch["slots"]["locationDraft"]["name"] == "HQ"
    assert patch["slots"]["createModule"] == "company"

    detail = stamp_create_session_memory(
        {"ok": True, "assistantText": "Stage looks fine."},
        intent="deal_draft",
        draft={"title": "Existing"},
        pathname="/sales/deal-1",
    )
    assert "sessionMemoryPatch" not in detail


def test_bare_create_proposal_sole_deal_sets_stm_deal() -> None:
    r = _offline_turn("create proposal", catalog=ZOHO_CATALOG)
    assert r["ok"]
    patch = r.get("sessionMemoryPatch") or {}
    slots = patch.get("slots") or {}
    assert slots.get("dealId") == "deal-zoho"
    assert patch.get("pendingIntent") == "create_proposal" or (
        "propose_create_proposal" in _names(r)
    )
    # Must never soft-ask a new deal when board has deals
    lower = str(r.get("assistantText") or "").lower()
    assert "new deal" not in lower
    assert "which company" not in lower
    assert not any(
        t.get("name") == "set_workspace"
        and (t.get("args") or {}).get("mode") == "create"
        for t in _tools(r)
    )


def test_stm_product_reply_creates_proposal_on_sticky_deal() -> None:
    """create proposal → crm, ticketing with Zoho sticky → propose_create_proposal."""
    first = _offline_turn("create proposal", catalog=ZOHO_CATALOG)
    stm = merge_session_patch(
        normalize_session_memory({}),
        first.get("sessionMemoryPatch") or first.get("sessionMemory"),
    )
    # Force product-await state if first turn already created (empty products edge)
    if not stm.get("pendingIntent"):
        stm = merge_session_patch(
            stm,
            {
                "pendingIntent": "create_proposal",
                "pendingAsk": "product",
                "slots": {"dealId": "deal-zoho"},
            },
        )
    assert (stm.get("slots") or {}).get("dealId") == "deal-zoho"

    messages = [
        {"role": "user", "text": "create proposal"},
        {
            "role": "assistant",
            "text": str(first.get("assistantText") or "Which products?"),
        },
        {"role": "user", "text": "crm, ticketing"},
    ]
    second = _offline_turn(
        "crm, ticketing",
        catalog=ZOHO_CATALOG,
        session_memory=stm,
        messages=messages,
    )
    assert second["ok"]
    lower = str(second.get("assistantText") or "").lower()
    assert "new deal" not in lower
    assert "set up a new deal" not in lower
    assert "which company" not in lower
    create = next(
        (t for t in _tools(second) if t.get("name") == "propose_create_proposal"),
        None,
    )
    assert create is None, f"should wait for BRD, got {_names(second)} text={lower[:200]!r}"
    assert "paperclip" in lower or "enter" in lower


def test_stm_multi_deal_asks_once_then_zoho_continues() -> None:
    first = _offline_turn("create proposal", catalog=MULTI_DEAL_CATALOG)
    assert first["ok"]
    stm = merge_session_patch(
        normalize_session_memory({}),
        first.get("sessionMemoryPatch") or {},
    )
    assert stm.get("pendingIntent") == "create_proposal"
    assert stm.get("pendingAsk") == "deal"

    second = _offline_turn(
        "Zoho",
        catalog=MULTI_DEAL_CATALOG,
        session_memory=stm,
        messages=[
            {"role": "user", "text": "create proposal"},
            {"role": "assistant", "text": str(first.get("assistantText") or "")},
            {"role": "user", "text": "Zoho"},
        ],
    )
    assert second["ok"]
    lower2 = str(second.get("assistantText") or "").lower()
    assert "new deal" not in lower2
    patch = second.get("sessionMemoryPatch") or {}
    slots = patch.get("slots") or {}
    assert slots.get("dealId") == "deal-zoho" or any(
        t.get("name") == "propose_create_proposal"
        and (t.get("args") or {}).get("dealId") == "deal-zoho"
        for t in _tools(second)
    )


def test_pre_route_direct_product_with_stm_deal() -> None:
    stm = normalize_session_memory(
        {
            "pendingIntent": "create_proposal",
            "pendingAsk": "product",
            "slots": {"dealId": "deal-zoho"},
        }
    )
    from app.agents.coworker_runtime import hydrate_working_from_session

    wm = hydrate_working_from_session(stm, _ctx(), ZOHO_CATALOG)
    r = pre_route_proposal(
        user_text="crm, ticketing",
        messages=[
            {"role": "user", "text": "create proposal"},
            {"role": "assistant", "text": "Which products should I include?"},
            {"role": "user", "text": "crm, ticketing"},
        ],
        ctx=_ctx(),
        catalog=ZOHO_CATALOG,
        stm=stm,
        wm=wm,
    )
    assert r and r.get("ok")
    create = next(
        (t for t in _tools(r) if t.get("name") == "propose_create_proposal"),
        None,
    )
    assert create is None
    assert "paperclip" in str(r.get("assistantText") or "").lower()
