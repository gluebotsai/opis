"""Deal draft field-fill agent."""

from __future__ import annotations

import re
from datetime import date
from typing import Any, TypedDict

from app.agents.native_pipeline import run_steps

from app.agents.coworker_shared import (
    apply_leave_create,
    build_conversation_prompt,
    draft_navigate_tools_from_llm,
    enrich_draft_result,
    last_user_text,
    result_leaves_current_page,
    run_chat_json,
    utterance_looks_like_command,
)
from app.agents.draft_conversation import (
    TONE_RULES,
    deal_draft_ready,
    looks_like_create_confirm,
    merge_draft,
    parse_money_amount,
    propose_create_deal_proposal,
    utterance_is_one_shot_create,
)

DEAL_STAGES = (
    "qualification",
    "discover",
    "propose",
    "negotiate",
    "closed_won",
    "closed_lost",
)

# Chat/UI labels → stored DealStage. "proposal" is the Propose column, not a BRD.
DEAL_STAGE_ALIASES = {
    "qualify": "qualification",
    "qualified": "qualification",
    "qualification": "qualification",
    "discover": "discover",
    "discovery": "discover",
    "propose": "propose",
    "proposal": "propose",
    "negotiate": "negotiate",
    "negotiation": "negotiate",
    "won": "closed_won",
    "closed_won": "closed_won",
    "lost": "closed_lost",
    "closed_lost": "closed_lost",
}


def normalize_deal_stage(raw: Any) -> str | None:
    """Map a spoken/tool stage label onto a stored DealStage, or None."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    key = re.sub(r"[\s-]+", "_", raw.strip().lower())
    resolved = DEAL_STAGE_ALIASES.get(key, key)
    if resolved in DEAL_STAGES:
        return resolved
    return None

SYSTEM = f"""You help a sales rep fill a CRM deal draft, conversationally.
Reply with ONLY valid JSON (no markdown fences):
{{"assistantText":"short friendly reply","patch":{{...optional fields...}}}}

Allowed patch keys (omit unknown): title, stage, amount, companyId, companyName, locationId, contactId, notes, expectedCloseDate.
- stage must be one of: {", ".join(DEAL_STAGES)}
- amount is a numeric string without currency symbols
- expectedCloseDate is YYYY-MM-DD
- companyName, contactName, and title are human names. Never write an id, UUID, or bare number into those fields.
- companyId / locationId / contactId must be ids from the provided catalog when matching by name, and the same patch must also set the catalog name (companyName / contact name).
- If the company is not in the catalog, set companyName to the typed name and omit companyId.
- Never invent ids; if you cannot match a company/contact, say so and omit those ids.
- Accept all fields they volunteer; then ask exactly one next question (title → company → optional amount/stage → ready)
- When title + company are ready, briefly recap then ask if you should save
- If they pause this deal to create a contact, company, or product instead, empty patch and navigate to that create href (/contact/new, /company/new, /product/new) with seedPrompt — never use that sentence as the deal title.
- Do not create or save the deal — only propose field patches

{TONE_RULES}"""


class DealDraftState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    result: dict[str, Any]


_BARE_ID_RE = re.compile(
    r"^(?:\d{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|c[a-z0-9]{24})$",
    re.I,
)


def is_bare_id(value: str | None) -> bool:
    return bool(_BARE_ID_RE.match((value or "").strip()))


def human_name(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text or is_bare_id(text):
        return None
    return text


def coerce_deal_name_fields(
    patch: dict[str, Any] | None,
    catalog: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Keep human company and contact names. Drop ids that were written into name fields."""
    if not patch:
        return patch
    out = dict(patch)
    companies = list((catalog or {}).get("companies") or [])
    raw_name = str(out.get("companyName") or "").strip()
    raw_id = str(out.get("companyId") or "").strip()
    chosen = next(
        (c for c in companies if str(c.get("id") or "") in {raw_id, raw_name} and c.get("id")),
        None,
    )
    if chosen is None and raw_name and not is_bare_id(raw_name):
        chosen = next(
            (
                c
                for c in companies
                if human_name(str(c.get("name") or ""))
                and str(c.get("name") or "").strip().lower() == raw_name.lower()
            ),
            None,
        )
    if chosen is not None:
        label = human_name(str(chosen.get("name") or ""))
        if label:
            out["companyId"] = chosen.get("id")
            out["companyName"] = label
        else:
            out.pop("companyName", None)
            out.pop("companyId", None)
            out.pop("locationId", None)
    elif is_bare_id(raw_name):
        out.pop("companyName", None)
        if is_bare_id(raw_id) or not raw_id:
            out.pop("companyId", None)
    elif raw_name:
        out["companyName"] = raw_name[:200]

    contact_name = str(out.get("contactName") or "").strip()
    if contact_name and is_bare_id(contact_name):
        out.pop("contactName", None)
    return out or None


def sanitize_patch(
    patch: dict[str, Any] | None,
    catalog: dict[str, Any],
) -> dict[str, Any] | None:
    if not patch or not isinstance(patch, dict):
        return None
    out: dict[str, Any] = {}
    if isinstance(patch.get("title"), str) and patch["title"].strip():
        out["title"] = patch["title"].strip()[:200]

    resolved_stage = normalize_deal_stage(patch.get("stage"))
    if resolved_stage:
        out["stage"] = resolved_stage

    amount = patch.get("amount")
    if isinstance(amount, (str, int, float)):
        n = re.sub(r"[^0-9.]", "", str(amount))
        if n:
            try:
                float(n)
                out["amount"] = n
            except ValueError:
                pass

    if isinstance(patch.get("notes"), str) and patch["notes"].strip():
        out["notes"] = patch["notes"].strip()[:4000]
    if isinstance(patch.get("expectedCloseDate"), str):
        d = patch["expectedCloseDate"].strip()[:10]
        if re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            out["expectedCloseDate"] = d

    companies = list(catalog.get("companies") or [])
    contacts = list(catalog.get("contacts") or [])
    company_ids = {c["id"] for c in companies if c.get("id")}
    if isinstance(patch.get("companyId"), str) and patch["companyId"] in company_ids:
        out["companyId"] = patch["companyId"]
        company = next((c for c in companies if c.get("id") == patch["companyId"]), None)
        locs = (company or {}).get("locations") or []
        lid = patch.get("locationId")
        if isinstance(lid, str) and any(l.get("id") == lid for l in locs):
            out["locationId"] = lid
        elif locs and locs[0].get("id"):
            out["locationId"] = locs[0]["id"]

    if isinstance(patch.get("companyName"), str) and patch["companyName"].strip():
        out["companyName"] = patch["companyName"].strip()[:200]
    if isinstance(patch.get("contactName"), str) and patch["contactName"].strip():
        out["contactName"] = patch["contactName"].strip()[:200]
    contact_ids = {c["id"] for c in contacts if c.get("id")}
    if isinstance(patch.get("contactId"), str) and patch["contactId"] in contact_ids:
        out["contactId"] = patch["contactId"]

    return coerce_deal_name_fields(out, catalog) or None


def match_company(text: str, companies: list[dict[str, Any]]) -> dict[str, Any] | None:
    lower = text.lower()
    ranked = sorted(
        (
            {
                "c": c,
                "i": lower.find(str(c.get("name") or "").lower()),
                "len": len(str(c.get("name") or "")),
            }
            for c in companies
            if c.get("name")
        ),
        key=lambda x: (-x["len"], x["i"]),
    )
    return next((r["c"] for r in ranked if r["i"] >= 0), None)


def match_contact(
    text: str,
    contacts: list[dict[str, Any]],
    company_id: str | None,
) -> dict[str, Any] | None:
    lower = text.lower()
    pool = (
        [c for c in contacts if not c.get("companyId") or c.get("companyId") == company_id]
        if company_id
        else contacts
    )
    ranked = sorted(
        (
            {
                "c": c,
                "i": lower.find(str(c.get("displayName") or "").lower()),
                "len": len(str(c.get("displayName") or "")),
            }
            for c in pool
            if c.get("displayName")
        ),
        key=lambda x: (-x["len"], x["i"]),
    )
    return next((r["c"] for r in ranked if r["i"] >= 0 and r["len"] >= 2), None)


def heuristic(
    user_text: str,
    draft: dict[str, Any],
    catalog: dict[str, Any],
) -> dict[str, Any]:
    if looks_like_create_confirm(user_text) and deal_draft_ready(draft):
        return {
            "ok": True,
            "toolProposals": [
                propose_create_deal_proposal(
                    proposal_id="create-deal-confirm",
                    auto=True,
                )
            ],
        }
    if looks_like_create_confirm(user_text):
        return {"ok": True}

    companies = list(catalog.get("companies") or [])
    contacts = list(catalog.get("contacts") or [])
    patch: dict[str, Any] = {}
    lower = user_text.lower()

    amount = parse_money_amount(user_text)
    if amount:
        patch["amount"] = amount

    for re_pat, stage in (
        (r"\b(closed\s*won|mark(?:ed)?\s*won)\b", "closed_won"),
        (r"\b(closed\s*lost|mark(?:ed)?\s*lost)\b", "closed_lost"),
        (r"\bnegotiat", "negotiate"),
        (r"\bpropos", "propose"),
        (r"\bdiscover", "discover"),
        (r"\bqualif", "qualification"),
    ):
        if re.search(re_pat, user_text, re.I):
            patch["stage"] = stage
            break

    company = match_company(user_text, companies)
    if company:
        patch["companyId"] = company["id"]
        if company.get("name"):
            patch["companyName"] = str(company["name"]).strip()[:200]
        locs = company.get("locations") or []
        patch["locationId"] = (locs[0].get("id") if locs else None) or draft.get(
            "locationId"
        )
    elif (
        draft.get("title")
        and not draft.get("companyId")
        and not draft.get("companyName")
        and not amount
        and re.match(r"^[A-Za-z0-9&.' -]{2,80}$", user_text.strip())
        and not re.search(
            r"\b(deal|stage|amount|qualif|propos|negotiat|won|lost)\b",
            user_text,
            re.I,
        )
    ):
        patch["companyName"] = user_text.strip()[:200]

    contact = match_contact(
        user_text, contacts, patch.get("companyId") or draft.get("companyId")
    )
    if contact:
        patch["contactId"] = contact["id"]
        if contact.get("companyId") and not patch.get("companyId"):
            patch["companyId"] = contact["companyId"]
            c = next((x for x in companies if x.get("id") == contact["companyId"]), None)
            locs = (c or {}).get("locations") or []
            if locs and locs[0].get("id"):
                patch["locationId"] = locs[0]["id"]

    title_match = re.search(
        r"(?:create|new|add|insert)\s+deal\s+(?:called\s+|named\s+)?[\"']?([^\"'.,]+?)[\"']?(?:\s+for\s+|\s+with\s+|$)",
        user_text,
        re.I,
    )
    if title_match and title_match.group(1).strip() and len(title_match.group(1).strip()) >= 2:
        patch["title"] = title_match.group(1).strip()[:120]
    elif not draft.get("title") and re.match(
        r"^[A-Za-z0-9&.' -]{2,80}$", user_text.strip()
    ) and not utterance_looks_like_command(user_text):
        patch["title"] = user_text.strip()[:120]
    elif not draft.get("title") and (company or contact):
        who = (company or {}).get("name") or (contact or {}).get("displayName") or "Opportunity"
        patch["title"] = f"{who} deal"

    date_match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", user_text)
    if date_match:
        patch["expectedCloseDate"] = date_match.group(1)
    elif re.search(r"\bthis month\b", lower):
        today = date.today()
        from calendar import monthrange

        last = monthrange(today.year, today.month)[1]
        patch["expectedCloseDate"] = date(today.year, today.month, last).isoformat()

    clean = sanitize_patch(patch, catalog)
    merged = merge_draft(draft, clean)
    if (
        clean
        and deal_draft_ready(merged)
        and not deal_draft_ready(draft)
        and utterance_is_one_shot_create(user_text)
    ):
        return {
            "ok": True,
            "patch": clean,
            "toolProposals": [
                propose_create_deal_proposal(
                    proposal_id="create-deal-oneshot",
                    auto=True,
                )
            ],
        }
    return {
        "ok": True,
        **({"patch": clean} if clean else {}),
    }


def enrich_deal_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any],
    catalog: dict[str, Any],
) -> dict[str, Any]:
    from app.agents.draft_conversation import merge_draft

    del user_text
    out = enrich_draft_result(result)
    patch = out.get("patch") if isinstance(out.get("patch"), dict) else None
    clean = dict(sanitize_patch(patch, catalog) or {})
    current = draft if isinstance(draft, dict) else {}
    if clean:
        out["patch"] = clean
    else:
        out.pop("patch", None)
    merge_draft(current, clean or None)
    return out


async def handle(state: DealDraftState) -> DealDraftState:
    messages = state.get("messages") or []
    catalog = state.get("catalog") or {}
    context = state.get("context") or {}
    user_text = last_user_text(messages)
    if not user_text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to update the deal draft."},
        }

    draft = catalog.get("currentDraft") or context.get("draft") or {}
    if not isinstance(draft, dict):
        draft = {}
    full_catalog = {
        "companies": catalog.get("companies") or [],
        "contacts": (catalog.get("contacts") or [])[:80],
        "stages": list(DEAL_STAGES),
        "currentDraft": draft,
    }

    from app.agents.coworker_shared import is_generic_coworker_speech
    from app.agents.crm_tools import run_native_agent_turn
    from app.llm import is_ai_configured

    if is_ai_configured():
        native = await run_native_agent_turn(
            mod="sales",
            surface="create",
            messages=messages,
            context={
                **context,
                "draft": draft,
                "module": "sales",
                "surface": "create",
                "pathname": str(context.get("pathname") or "/sales/new"),
            },
            catalog={**catalog, **full_catalog},
            user_text=user_text,
        )
        if native and native.get("ok"):
            pathname = str(context.get("pathname") or "/sales/new")
            native = apply_leave_create(
                {**native, "source": "ai"},
                pathname=pathname,
                module="sales",
            )
            if result_leaves_current_page(
                native, pathname=pathname, module="sales"
            ):
                return {**state, "result": native}
            result = enrich_deal_draft_result(
                {**native, "source": "ai"},
                user_text=user_text,
                draft=draft,
                catalog=full_catalog,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and deal_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_deal_proposal(
                        proposal_id="create-deal-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}

        from app.agents.org_clock import local_now_line

        ai = await run_chat_json(
            system=SYSTEM + "\n" + local_now_line(context),
            user=build_conversation_prompt(full_catalog, messages),
        )
        if ai:
            speech = str(ai.get("assistantText") or "").strip()
            if speech and not is_generic_coworker_speech(speech):
                nav_tools = draft_navigate_tools_from_llm(ai, user_text=user_text)
                if nav_tools:
                    return {
                        **state,
                        "result": {
                            "ok": True,
                            "assistantText": speech,
                            "toolProposals": nav_tools,
                            "source": "ai",
                        },
                    }
                result = enrich_deal_draft_result(
                    {
                        "ok": True,
                        "assistantText": speech,
                        "patch": sanitize_patch(ai.get("patch"), full_catalog),
                        "source": "ai",
                    },
                    user_text=user_text,
                    draft=draft,
                    catalog=full_catalog,
                )
                merged = merge_draft(
                    draft,
                    result.get("patch") if isinstance(result.get("patch"), dict) else None,
                )
                if looks_like_create_confirm(user_text) and deal_draft_ready(merged):
                    result["toolProposals"] = [
                        propose_create_deal_proposal(
                            proposal_id="create-deal-confirm",
                            auto=True,
                        )
                    ]
                return {**state, "result": result}

        from app.agents.coworker_shared import llm_unavailable_result

        return {
            **state,
            "result": llm_unavailable_result("llm_unusable"),
        }

    from app.agents.coworker_shared import llm_unavailable_result

    return {
        **state,
        "result": llm_unavailable_result("llm_not_configured"),
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
) -> dict[str, Any]:
    del organization_id
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
        }
    )
    return result.get("result") or {"ok": False, "error": "Deal draft assist failed."}
