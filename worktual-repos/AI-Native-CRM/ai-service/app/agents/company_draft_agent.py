"""Company / location draft agents."""

from __future__ import annotations

import re
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
    str_fields,
)
from app.agents.draft_conversation import (
    TONE_RULES,
    company_draft_ready,
    looks_like_create_confirm,
    merge_draft,
    propose_create_company_proposal,
    should_persist_ready_company,
    utterance_is_one_shot_create,
)

COMPANY_SYSTEM = f"""You help a colleague fill a CRM company draft (includes primary location).
Reply ONLY JSON: {{"assistantText":"…","patch":{{…}},"navigate":{{"href":"/contact/new","seedPrompt":"optional"}}}}
Keys: name, domain, industry, locationName, locationAddress, locationType (hq|branch), employeeCount, linkedinUrl.
Collect fields in order (one question at a time): company name → first location name → address → location type (HQ/branch) → domain → industry → employee count → LinkedIn. Only name and location name are required. Address, location type, domain, industry, employee count, and LinkedIn are optional — keep asking the next one, but never block a save because they are still empty.
Ask for address only after a location name exists. Never copy locationName into locationAddress — street address is separate. If they want city-only, skip address (do not duplicate the city).
When they correct a field (e.g. "sorry name is OvalEdge"), acknowledge the correction briefly and continue — never repeat the previous question unchanged.
If they pause this company to create a contact, deal, or other record instead, empty patch and navigate to that create href (/contact/new, /sales/new, /product/new) with seedPrompt — do not write that intent into the company name.
Once name and location name are set, "save", "create", or "yes" means save now. Do not say you still need optional fields. Empty patch and a short confirmation is enough — the app saves.
Do not create/save yourself — only patches. Ask exactly one next natural question (never form labels) unless they just confirmed save.

{TONE_RULES}"""


LOCATION_SYSTEM = f"""You help fill a CRM location draft. Reply ONLY JSON:
{{"assistantText":"…","patch":{{…}}}}
Keys: name, type (hq|branch), address, industry.
Do not create/save — only patches. Ask one clear next question. Recap before offering to save.

{TONE_RULES}"""


class CompanyDraftState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    mode: str  # company | location
    result: dict[str, Any]


def sanitize_company(patch: dict[str, Any] | None) -> dict[str, Any] | None:
    if not patch:
        return None
    out = str_fields(
        patch,
        [
            "name",
            "domain",
            "industry",
            "locationName",
            "locationAddress",
            "employeeCount",
            "linkedinUrl",
        ],
        max_len=300,
    )
    lt = patch.get("locationType")
    if lt in ("hq", "branch"):
        out["locationType"] = lt
    elif isinstance(lt, str):
        t = lt.lower()
        if "branch" in t:
            out["locationType"] = "branch"
        elif "hq" in t or "head" in t:
            out["locationType"] = "hq"
    if "locationAddress" not in out:
        addr = patch.get("address")
        if isinstance(addr, str) and addr.strip():
            out["locationAddress"] = addr.strip()[:300]
    from app.agents.draft_conversation import normalize_company_address_patch

    return normalize_company_address_patch(out, None) or None


def sanitize_location(patch: dict[str, Any] | None) -> dict[str, Any] | None:
    if not patch:
        return None
    out = str_fields(patch, ["name", "address", "industry"], max_len=300)
    t = patch.get("type")
    if t in ("hq", "branch"):
        out["type"] = t
    elif isinstance(t, str):
        tl = t.lower()
        if "branch" in tl:
            out["type"] = "branch"
        elif "hq" in tl or "head" in tl:
            out["type"] = "hq"
    return out or None


def _parse_company_name_correction(text: str) -> str | None:
    """Catch 'sorry name is X', 'actually it's X', 'rename to X', etc."""
    m = re.search(
        r"(?:sorry[,.]?\s+)?(?:the\s+)?(?:company\s+)?name\s+is\s+(.+)$|"
        r"(?:actually|correction|rather)[,:]?\s+(?:it'?s\s+|named\s+|called\s+)?(.+)$|"
        r"(?:it'?s|its)\s+(?:called\s+|named\s+)(.+)$|"
        r"(?:rename|change)\s+(?:(?:the\s+)?name\s+)?(?:to\s+)?(.+)$",
        text.strip(),
        re.I,
    )
    if not m:
        return None
    raw = next((g for g in m.groups() if g and g.strip()), None)
    if not raw:
        return None
    name = re.sub(r"[.!?]+$", "", raw.strip())
    # Drop leading filler like "ovaledge" alone handled elsewhere
    if len(name) < 2 or len(name) > 80:
        return None
    if re.search(r"\b(domain|website|industry|location|office)\b", name, re.I):
        return None
    return name[:80]


def _attach_ready_company_save(
    result: dict[str, Any],
    *,
    user_text: str,
    before: dict[str, Any],
    merged: dict[str, Any],
) -> dict[str, Any]:
    """Name + location is a company. Persist it instead of asking for optional fields."""
    if not should_persist_ready_company(user_text, before=before, merged=merged):
        return result
    name = str(merged.get("name") or "").strip() or "this company"
    result["toolProposals"] = [
        propose_create_company_proposal(
            proposal_id="create-company-confirm",
            auto=True,
        )
    ]
    result["assistantText"] = f"Saving **{name}** now."
    return result


def company_heuristic(text: str, draft: dict[str, Any] | None = None) -> dict[str, Any]:
    current = draft if isinstance(draft, dict) else {}
    if looks_like_create_confirm(text) and company_draft_ready(current):
        return {
            "ok": True,
            "toolProposals": [
                propose_create_company_proposal(
                    proposal_id="create-company-confirm",
                    auto=True,
                )
            ],
        }
    if looks_like_create_confirm(text):
        return {"ok": True}

    lower = text.lower().strip()
    li_early = re.search(r"(https?://)?(?:www\.)?linkedin\.com/\S+", text, re.I)
    # Asking for more fields — guide without inventing values
    if (
        not li_early
        and re.search(
            r"\b(other|more|rest|remaining)\b.*\b(info|information|details?|fields?)\b|"
            r"\bwhat about\b|"
            r"\b(industry|linkedin|employee|size|address)\b",
            lower,
        )
        and not re.search(r"\b(is|as|=|:)\b", lower)
    ):
        if not company_draft_ready(current):
            return {"ok": True}
        return {"ok": True}

    patch: dict[str, Any] = {}
    if li_early:
        url = li_early.group(0).rstrip(".,)")
        patch["linkedinUrl"] = (
            url if url.lower().startswith("http") else f"https://{url}"
        )
    corrected = _parse_company_name_correction(text)
    if corrected:
        patch["name"] = corrected
    else:
        named = re.search(
            r"(?:add|create|new|insert)\s+company\s+([A-Za-z0-9&.' -]{2,80})",
            text,
            re.I,
        )
        if named:
            patch["name"] = named.group(1).strip()
        elif not current.get("name") and re.match(
            r"^[A-Za-z0-9&.' -]{2,80}$", text.strip()
        ):
            patch["name"] = text.strip()

    domain = re.search(r"\b([a-z0-9-]+\.[a-z]{2,})(?:\s|$)", text, re.I)
    if domain:
        patch["domain"] = domain.group(1).lower()

    if re.search(r"\bbranch\b", text, re.I):
        patch["locationType"] = "branch"
    elif re.search(r"\bhq\b|headquarters", text, re.I):
        patch["locationType"] = "hq"

    loc = re.search(
        r"(?:hq|headquarters|branch|office|location)\s+(?:in\s+|at\s+|named\s+|called\s+)?"
        r"([A-Za-z0-9&.' -]{2,40})$|"
        r"(?:based|located)\s+in\s+([A-Za-z0-9&.' -]{2,40})",
        text,
        re.I,
    )
    if loc:
        patch["locationName"] = next(g for g in loc.groups() if g).strip()
    elif (
        current.get("name")
        and not current.get("locationName")
        and not patch.get("name")
        and not domain
        and re.match(r"^[A-Za-z0-9&.' -]{2,40}$", text.strip())
        and not re.search(r"\.(com|io|org|net|co)\b", text, re.I)
    ):
        # Bare city / office name while location still needed
        patch["locationName"] = text.strip()

    industry = re.search(
        r"(?:industry|sector)\s*(?:is|:|=|as)?\s*([A-Za-z0-9&./ -]{2,60})",
        text,
        re.I,
    )
    if industry:
        patch["industry"] = industry.group(1).strip()

    emp = re.search(
        r"(?:employee\s*count|company\s*size|headcount|size)\s*(?:is|:|=|as)?\s*(\d[\d,]*)",
        text,
        re.I,
    )
    if emp:
        patch["employeeCount"] = emp.group(1).replace(",", "")
    elif (
        current.get("name")
        and not current.get("employeeCount")
        and re.match(r"^\d{1,7}$", text.strip().replace(",", ""))
    ):
        patch["employeeCount"] = text.strip().replace(",", "")

    addr = re.search(
        r"(?:address|located at|office at)\s*(?:is|:|=)?\s*(.+)$",
        text,
        re.I,
    )
    if addr and (current.get("locationName") or patch.get("locationName")):
        patch["locationAddress"] = addr.group(1).strip()[:300]
    elif (
        current.get("locationName")
        and not current.get("locationAddress")
        and not patch.get("name")
        and not patch.get("locationName")
        and not domain
        and not patch.get("linkedinUrl")
        and len(text.strip()) >= 8
        and re.search(r"\d", text)
        and not re.search(r"\b(industry|linkedin|employee|domain)\b", text, re.I)
    ):
        patch["locationAddress"] = text.strip()[:300]
    elif (
        current.get("name")
        and current.get("locationName")
        and not current.get("industry")
        and not patch.get("name")
        and not patch.get("locationName")
        and not domain
        and not patch.get("locationAddress")
        and not patch.get("linkedinUrl")
        and not patch.get("employeeCount")
        and re.match(r"^[A-Za-z][A-Za-z0-9&./ -]{1,60}$", text.strip())
        and text.strip().lower()
        not in {
            "city",
            "town",
            "skip",
            "hq",
            "branch",
            "headquarters",
            "none",
            "na",
        }
    ):
        patch["industry"] = text.strip()[:60]

    clean = sanitize_company(patch)
    merged = merge_draft(current, clean)
    if (
        clean
        and company_draft_ready(merged)
        and not company_draft_ready(current)
        and utterance_is_one_shot_create(text)
    ):
        return {
            "ok": True,
            "patch": clean,
            "toolProposals": [
                propose_create_company_proposal(
                    proposal_id="create-company-oneshot",
                    auto=True,
                )
            ],
        }
    return {
        "ok": True,
        **({"patch": clean} if clean else {}),
    }


def location_heuristic(text: str) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    named = re.search(
        r"(?:add|create|new)\s+location\s+([A-Za-z0-9&.' -]{2,80})",
        text,
        re.I,
    )
    if named:
        patch["name"] = named.group(1).strip()
    if re.search(r"\bbranch\b", text, re.I):
        patch["type"] = "branch"
    elif re.search(r"\bhq\b|headquarters", text, re.I):
        patch["type"] = "hq"
    addr = re.search(r"(?:at|address)\s+(.+)$", text, re.I)
    if addr:
        patch["address"] = addr.group(1).strip()[:300]
    clean = sanitize_location(patch)
    if not clean or not clean.get("name"):
        return {"ok": True}
    return {"ok": True, "patch": clean}


def _company_offline_create_turn(
    user_text: str,
    draft: dict[str, Any] | None,
) -> dict[str, Any]:
    """LLM unavailable — slot answer + guided prompt only (no heuristics)."""
    from app.agents.draft_conversation import (
        apply_company_slot_answer,
        apply_guided_create_skip,
        clamp_company_patch_to_walk,
        company_mandatory_field_message,
        company_next_ask_key,
        merge_draft,
        next_company_prompt,
        _COMPANY_OPTIONAL_ASK,
    )

    current = draft if isinstance(draft, dict) else {}
    ask_before = company_next_ask_key(current)
    skip = apply_guided_create_skip(
        user_text,
        current,
        next_ask_fn=company_next_ask_key,
        optional_asks=_COMPANY_OPTIONAL_ASK,
        mandatory_message_fn=company_mandatory_field_message,
    )
    if skip and skip.get("_blockSpeech"):
        return {"ok": True, "assistantText": str(skip["_blockSpeech"])}
    patch: dict[str, Any] = {}
    if skip and skip.get("skippedOptional"):
        patch["skippedOptional"] = skip["skippedOptional"]
    slot = apply_company_slot_answer(user_text, current) or {}
    patch.update(slot)
    patch = clamp_company_patch_to_walk(patch, ask=ask_before)
    merged = merge_draft(current, patch or None)
    out: dict[str, Any] = {
        "ok": True,
        "assistantText": next_company_prompt(merged, just_patched=bool(patch)),
    }
    if patch:
        out["patch"] = patch
    return out


def enrich_company_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any],
) -> dict[str, Any]:
    from app.agents.draft_conversation import (
        clamp_company_patch_to_walk,
        company_next_ask_key,
        merge_draft,
        normalize_company_address_patch,
    )

    del user_text
    out = enrich_draft_result(result)
    patch = out.get("patch") if isinstance(out.get("patch"), dict) else None
    current = draft if isinstance(draft, dict) else {}
    ask_before = company_next_ask_key(current)
    clean = dict(sanitize_company(patch) or {})
    clean = dict(clamp_company_patch_to_walk(clean, ask=ask_before))
    clean = dict(normalize_company_address_patch(clean, current) or {})
    if clean:
        out["patch"] = clean
    else:
        out.pop("patch", None)
    merged = merge_draft(current, clean or None)
    ask = company_next_ask_key(merged)
    name = str(merged.get("name") or "").strip()
    tools = out.get("toolProposals") or []
    creating = any(
        isinstance(t, dict) and t.get("name") == "propose_create_company"
        for t in tools
    )
    if creating:
        out["sessionMemoryPatch"] = {
            "pendingIntent": "",
            "pendingAsk": "",
            "slots": {"createModule": "", "companyName": name or ""},
            "lastEntities": ({"companyName": name} if name else {}),
        }
    else:
        out["sessionMemoryPatch"] = {
            "pendingIntent": "create_company",
            "pendingAsk": f"company_{ask}",
            "slots": {
                "createModule": "company",
                **({"companyName": name} if name else {}),
            },
        }
    return out


def enrich_location_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.agents.draft_conversation import (
        _LOCATION_OPTIONAL_ASK,
        apply_guided_create_skip,
        location_mandatory_field_message,
        location_next_ask_key,
        merge_draft,
        next_location_prompt,
        rewrite_early_save_speech,
    )

    out = enrich_draft_result(result)
    patch = out.get("patch") if isinstance(out.get("patch"), dict) else None
    clean = dict(sanitize_location(patch) or {})
    current = draft if isinstance(draft, dict) else {}
    skip_slot = apply_guided_create_skip(
        user_text,
        current,
        next_ask_fn=location_next_ask_key,
        optional_asks=_LOCATION_OPTIONAL_ASK,
        mandatory_message_fn=location_mandatory_field_message,
    )
    if skip_slot and skip_slot.get("_blockSpeech"):
        out["assistantText"] = str(skip_slot["_blockSpeech"])
        out.pop("patch", None)
        merged = current
    else:
        if skip_slot and skip_slot.get("skippedOptional"):
            clean["skippedOptional"] = skip_slot["skippedOptional"]
        if clean:
            out["patch"] = clean
        elif "patch" in out:
            out["patch"] = None
        merged = merge_draft(current, clean or None)
        out["assistantText"] = next_location_prompt(
            merged, just_patched=bool(clean or skip_slot)
        )
    speech = str(out.get("assistantText") or "")
    out["assistantText"] = rewrite_early_save_speech(
        speech,
        merged,
        next_ask_fn=location_next_ask_key,
        next_prompt_fn=next_location_prompt,
    )[:800]
    return out


async def handle(state: CompanyDraftState) -> CompanyDraftState:
    messages = state.get("messages") or []
    catalog = state.get("catalog") or {}
    context = state.get("context") or {}
    mode = state.get("mode") or "company"
    user_text = last_user_text(messages)
    if not user_text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to update the draft."},
        }

    draft = catalog.get("currentDraft") or context.get("draft") or {}
    if not isinstance(draft, dict):
        draft = {}

    from app.agents.coworker_shared import is_generic_coworker_speech
    from app.llm import is_ai_configured

    if mode == "location":
        ai = await run_chat_json(
            system=LOCATION_SYSTEM,
            user=build_conversation_prompt(
                {
                    "companyId": catalog.get("companyId"),
                    "currentDraft": draft,
                },
                messages,
            ),
        )
        if ai:
            speech = str(ai.get("assistantText") or "").strip()
            if speech and not is_generic_coworker_speech(speech):
                return {
                    **state,
                    "result": enrich_location_draft_result(
                        {
                            "ok": True,
                            "assistantText": speech,
                            "patch": sanitize_location(ai.get("patch")),
                            "source": "ai",
                        },
                        user_text=user_text,
                        draft=draft,
                    ),
                }
        from app.agents.coworker_shared import llm_unavailable_result

        return {
            **state,
            "result": llm_unavailable_result(
                "llm_not_configured" if not is_ai_configured() else "llm_unusable"
            ),
        }

    from app.agents.crm_tools import run_native_agent_turn

    if is_ai_configured():
        pathname = str(context.get("pathname") or "/company/new")
        native = await run_native_agent_turn(
            mod="company",
            surface="create",
            messages=messages,
            context={
                **context,
                "draft": draft,
                "module": "company",
                "surface": "create",
                "pathname": pathname,
            },
            catalog={**catalog, "currentDraft": draft},
            user_text=user_text,
        )
        if native and native.get("ok"):
            from app.agents.nav_routing import infer_sales_module_from_label

            named = infer_sales_module_from_label(user_text)
            preview = merge_draft(
                draft,
                sanitize_company(native.get("patch"))
                if isinstance(native.get("patch"), dict)
                else None,
            )
            saving_here = should_persist_ready_company(
                user_text, before=draft, merged=preview
            ) or (
                looks_like_create_confirm(user_text)
                and (not named or named == "company")
            )
            if saving_here:
                native = {
                    **native,
                    "source": "ai",
                    "toolProposals": [
                        t
                        for t in (native.get("toolProposals") or [])
                        if not (
                            isinstance(t, dict)
                            and t.get("name") in ("navigate", "open_entity")
                        )
                    ],
                }
            else:
                native = apply_leave_create(
                    {**native, "source": "ai"},
                    pathname=pathname,
                    module="company",
                )
                if result_leaves_current_page(
                    native, pathname=pathname, module="company"
                ):
                    return {**state, "result": native}
            result = enrich_company_draft_result(
                native,
                user_text=user_text,
                draft=draft,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            _attach_ready_company_save(
                result,
                user_text=user_text,
                before=draft,
                merged=merged,
            )
            return {**state, "result": result}

        ai = await run_chat_json(
            system=COMPANY_SYSTEM,
            user=build_conversation_prompt(
                {"currentDraft": draft},
                messages,
            ),
        )
        if ai:
            speech = str(ai.get("assistantText") or "").strip()
            if speech and not is_generic_coworker_speech(speech):
                nav_tools = draft_navigate_tools_from_llm(ai, user_text=user_text)
                preview = merge_draft(
                    draft,
                    sanitize_company(ai.get("patch"))
                    if isinstance(ai.get("patch"), dict)
                    else None,
                )
                if nav_tools and not should_persist_ready_company(
                    user_text, before=draft, merged=preview
                ):
                    return {
                        **state,
                        "result": {
                            "ok": True,
                            "assistantText": speech,
                            "toolProposals": nav_tools,
                            "source": "ai",
                        },
                    }
                result = enrich_company_draft_result(
                    {
                        "ok": True,
                        "assistantText": speech,
                        "patch": sanitize_company(ai.get("patch")),
                        "source": "ai",
                    },
                    user_text=user_text,
                    draft=draft,
                )
                merged = merge_draft(
                    draft,
                    result.get("patch") if isinstance(result.get("patch"), dict) else None,
                )
                _attach_ready_company_save(
                    result,
                    user_text=user_text,
                    before=draft,
                    merged=merged,
                )
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
    mode: str = "company",
) -> dict[str, Any]:
    del organization_id
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
            "mode": mode,
        }
    )
    return result.get("result") or {
        "ok": False,
        "error": "Company draft assist failed.",
    }
