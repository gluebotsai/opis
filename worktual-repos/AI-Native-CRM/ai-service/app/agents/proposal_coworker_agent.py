"""Proposal detail co-worker — rewrite sections, regenerate, or create a new proposal in chat."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.coworker_shared import (
    display_from_catalog,
    looks_like_affirmative,
    wants_delete_intent,
)
from app.agents.deal_coworker_agent import (
    _build_proposal_flow,
    _wants_create_proposal,
    extract_proposal_customer,
    extract_proposal_topic,
    _proposal_title,
)
from app.agents.draft_conversation import (
    parse_quote_line_update,
    propose_create_proposal_doc,
    propose_delete_proposal_doc,
    propose_send_proposal_doc,
    wants_send_proposal,
)
from app.agents.document_section_shared import (
    PROPOSAL_SECTION_ALIASES,
    detect_document_section_key,
    detect_section_key_from_catalog,
    parse_proposal_visible_text_swap,
    wants_document_section_rewrite,
    parse_proposal_table_border_intent,
)
from app.agents.native_pipeline import run_steps

SECTION_ALIASES = PROPOSAL_SECTION_ALIASES


class ProposalCoworkerState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    organization_id: str
    result: dict[str, Any]


def _last_user(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "user":
            return str(m.get("text") or "").strip()
    return ""


def _prior_assistant(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "assistant":
            return str(m.get("text") or "").strip()
    return ""


def _proposal_id(ctx: dict[str, Any]) -> str:
    eid = str(ctx.get("entityId") or "").strip()
    if eid:
        return eid
    path = str(ctx.get("pathname") or "")
    m = re.search(r"/sales/proposals/([^/?#]+)", path)
    return m.group(1).strip() if m else ""


def _deal_id_from_catalog(catalog: dict[str, Any] | None) -> str:
    open_prop = (catalog or {}).get("openProposal")
    if isinstance(open_prop, dict):
        deal_id = str(open_prop.get("dealId") or "").strip()
        if deal_id:
            return deal_id
    return ""


def _detect_section_key(text: str) -> str | None:
    return detect_document_section_key(text, aliases=PROPOSAL_SECTION_ALIASES)


def _wants_rewrite(lower: str) -> bool:
    return wants_document_section_rewrite(lower)


def _wants_full_regenerate(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(regenerate|personalize|rewrite all|refresh (all|everything|the proposal)|"
            r"full (refresh|rewrite)|regenerate for (this |the )?customer)\b",
            lower,
        )
    )


def _wants_generate_from_meeting(lower: str) -> bool:
    if re.search(r"\bcreate proposal for\b", lower):
        return False
    has_meeting = bool(
        re.search(
            r"\b(meeting|conversation|discussion|transcript|last (call|meeting))\b",
            lower,
        )
    )
    if not has_meeting:
        return False
    return bool(
        re.search(
            r"\b(generate|create|build|draft|write|prepare|regenerate|refresh)\b.{0,48}\b(proposal|document)\b",
            lower,
        )
        or re.search(
            r"\b(proposal|document)\b.{0,48}\b(meeting|conversation|discussion|transcript|call)\b",
            lower,
        )
        or re.search(
            r"\b(based on|from)\b.{0,40}\b(meeting|conversation|discussion|transcript|last (call|meeting))\b",
            lower,
        )
    )


def _wants_generate_quote_from_meeting(lower: str) -> bool:
    has_meeting = bool(
        re.search(
            r"\b(meeting|conversation|discussion|transcript|last (call|meeting))\b",
            lower,
        )
    )
    if not has_meeting:
        return False
    return bool(
        re.search(
            r"\b(generate|create|build|draft|write|prepare)\b.{0,48}\b(quote|quotation)\b",
            lower,
        )
        or re.search(
            r"\b(quote|quotation)\b.{0,48}\b(meeting|conversation|discussion|transcript|call)\b",
            lower,
        )
    )


def propose_create_quote_from_proposal(
    *,
    deal_id: str,
    proposal_id: str,
    tool_id: str = "create-quote-from-proposal",
) -> dict[str, Any]:
    return {
        "id": tool_id,
        "name": "propose_create_quote",
        "label": "Create quote from meeting/proposal",
        "args": {
            "dealId": deal_id,
            "proposalId": proposal_id,
            "auto": True,
        },
        "risk": "low",
    }


def _heuristic_proposal_result(
    *,
    text: str,
    proposal_id: str,
    deal_id: str = "",
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    lower = text.lower()
    if not proposal_id:
        return None

    if _wants_generate_quote_from_meeting(lower) and deal_id:
        return {
            "ok": True,
            "assistantText": "Creating a quote draft from the meeting and proposal context now.",
            "toolProposals": [
                propose_create_quote_from_proposal(
                    deal_id=deal_id,
                    proposal_id=proposal_id,
                )
            ],
            "uiRefresh": {
                "modules": ["sales"],
                "entityIds": [proposal_id],
                "reason": "quote_from_meeting",
            },
        }

    if _wants_full_regenerate(lower) or _wants_generate_from_meeting(lower):
        return {
            "ok": True,
            "assistantText": "Regenerating the proposal from your meeting context now.",
            "toolProposals": [propose_personalize_proposal(proposal_id=proposal_id)],
            "uiRefresh": {
                "modules": ["sales"],
                "entityIds": [proposal_id],
                "reason": "proposal_regenerate",
            },
        }

    border_intent = parse_proposal_table_border_intent(text)
    if border_intent:
        adding = border_intent == "on"
        return {
            "ok": True,
            "assistantText": (
                "Adding borders to the tables on this proposal now."
                if adding
                else "Removing the table borders on this proposal now."
            ),
            "toolProposals": [
                propose_patch_proposal_document_text(
                    proposal_id=proposal_id,
                    table_borders=adding,
                )
            ],
            "uiRefresh": {
                "modules": ["sales"],
                "entityIds": [proposal_id],
                "reason": "proposal_table_borders",
            },
        }

    swap = parse_proposal_visible_text_swap(text)
    if swap:
        find, replace = swap
        return {
            "ok": True,
            "assistantText": "Updating that text on the proposal now.",
            "toolProposals": [
                propose_patch_proposal_document_text(
                    proposal_id=proposal_id,
                    find=find,
                    replace=replace,
                )
            ],
            "uiRefresh": {
                "modules": ["sales"],
                "entityIds": [proposal_id],
                "reason": "proposal_text_patch",
            },
        }

    cat = catalog if isinstance(catalog, dict) else {}
    open_prop = cat.get("openProposal")
    section_key = detect_section_key_from_catalog(
        text,
        open_prop.get("sections") if isinstance(open_prop, dict) else None,
        aliases=PROPOSAL_SECTION_ALIASES,
    ) or _detect_section_key(text)
    if section_key and _wants_rewrite(lower):
        instruction = _extract_instruction(text, section_key)
        label = section_key.replace("_", " ")
        return {
            "ok": True,
            "assistantText": f"Updating the {label} section now.",
            "toolProposals": [
                propose_rewrite_proposal_section(
                    proposal_id=proposal_id,
                    section_key=section_key,
                    instruction=instruction or text.strip(),
                )
            ],
            "uiRefresh": {
                "modules": ["sales"],
                "entityIds": [proposal_id],
                "reason": "proposal_rewrite",
            },
        }

    return None


def _extract_instruction(text: str, section_key: str | None) -> str:
    """Strip the rewrite/section command; leftover is the user's instruction."""
    t = text.strip()
    t = re.sub(
        r"^(please\s+)?(rewrite|re-write|rework|revise|improve|enhance|regenerate|refresh|update|change|edit|add|append|insert)\s+"
        r"(the\s+)?(section\s+)?",
        "",
        t,
        flags=re.I,
    )
    if section_key:
        for key, aliases in SECTION_ALIASES:
            if key != section_key:
                continue
            for a in aliases:
                t = re.sub(rf"^(the\s+)?{re.escape(a)}\b[:\s,-]*", "", t, flags=re.I)
                t = re.sub(
                    rf"\s+for\s+(the\s+)?{re.escape(a)}\s*$",
                    "",
                    t,
                    flags=re.I,
                )
    t = re.sub(r"^(to\s+say|to|with|as)\s*[:\-]?\s*", "", t, flags=re.I)
    return t.strip()


def propose_patch_proposal_document_text(
    *,
    proposal_id: str,
    find: str = "",
    replace: str = "",
    table_borders: bool | None = None,
    proposal_tool_id: str = "patch-proposal-document-text",
) -> dict[str, Any]:
    args: dict[str, Any] = {
        "proposalId": proposal_id,
        "auto": True,
    }
    if find:
        args["textReplacements"] = [{"find": find[:240], "replace": replace[:240]}]
    if table_borders is not None:
        args["tableBorders"] = bool(table_borders)
    if table_borders is False:
        label = "Remove table borders"
    elif table_borders and not find:
        label = "Add table borders"
    else:
        label = "Update proposal text"
    return {
        "id": proposal_tool_id,
        "name": "propose_patch_proposal_document_text",
        "label": label,
        "args": args,
        "risk": "low",
    }


def propose_rewrite_proposal_section(
    *,
    proposal_id: str,
    section_key: str,
    instruction: str = "",
    proposal_tool_id: str = "rewrite-proposal-section",
) -> dict[str, Any]:
    label = f"Rewrite {section_key.replace('_', ' ')}"
    return {
        "id": proposal_tool_id,
        "name": "propose_rewrite_proposal_section",
        "label": label[:80],
        "args": {
            "proposalId": proposal_id,
            "sectionKey": section_key,
            "auto": True,
            **({"instruction": instruction[:2000]} if instruction else {}),
        },
        "risk": "low",
    }


def propose_personalize_proposal(
    *,
    proposal_id: str,
    proposal_tool_id: str = "personalize-proposal",
    product_ids: list[str] | None = None,
    product_hint: str | None = None,
) -> dict[str, Any]:
    args: dict[str, Any] = {"proposalId": proposal_id, "auto": True}
    if product_ids:
        args["productIds"] = [str(x).strip() for x in product_ids if str(x).strip()][:10]
    if product_hint and product_hint.strip():
        args["productHint"] = product_hint.strip()[:200]
    return {
        "id": proposal_tool_id,
        "name": "propose_personalize_proposal",
        "label": "Update proposal products" if product_ids else "Regenerate proposal",
        "args": args,
        "risk": "low",
    }


def _pending_section_from_assistant(asst: str) -> str | None:
    """Only when we asked the user what a section should say — not help text examples."""
    lower = asst.lower()
    # Help / capability blurbs list “rewrite the introduction” as an example.
    if re.search(
        r"for example|try [“\"]|i can rewrite|on this proposal i can|"
        r"regenerate for this customer|full customer refresh",
        lower,
    ):
        return None
    if re.search(
        r"what should (the )?(introduction|intro|features|scope|commercials).*(say|be|include)",
        lower,
    ):
        return _detect_section_key(asst) or "introduction"
    if re.search(r"want me to rewrite (the )?", lower):
        return _detect_section_key(asst)
    return None


def _awaiting_regenerate_offer(asst: str) -> bool:
    lower = asst.lower()
    return bool(
        re.search(
            r"regenerate (the )?proposal|rewrite (the )?whole proposal|"
            r"full refresh|personalize (this |the )?proposal|"
            r"shall i regenerate|want me to regenerate",
            lower,
        )
    )


async def handle(state: ProposalCoworkerState) -> ProposalCoworkerState:
    messages = state.get("messages") or []
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    text = _last_user(messages)
    lower = text.lower()
    proposal_id = _proposal_id(ctx)

    if not proposal_id:
        return {
            **state,
            "result": {"ok": True, "_unhandled": True},
        }

    from app.agents.coworker_shared import should_commit_native_turn
    from app.agents.crm_tools import run_native_agent_turn
    from app.llm import is_ai_configured

    if not is_ai_configured():
        from app.agents.coworker_shared import llm_unavailable_result

        return {
            **state,
            "result": llm_unavailable_result("llm_unavailable"),
        }

    native = await run_native_agent_turn(
        mod="sales",
        surface=str(ctx.get("surface") or "detail"),
        messages=messages,
        context=ctx,
        catalog=catalog,
        user_text=text,
    )
    if should_commit_native_turn(native, user_text=text):
        return {**state, "result": {**native, "source": "ai"}}

    return {
        **state,
        "result": {"ok": True, "assistantText": "", "_unhandled": True},
    }


_PIPELINE_STEPS = (
    handle,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    messages: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    catalog: dict[str, Any] | None = None,
    organization_id: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
            "organization_id": organization_id or "",
        }
    )
    out = result.get("result")
    return out if isinstance(out, dict) else {"ok": True, "_unhandled": True}
