"""Companies module co-worker — list / create / detail workspace intents."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.draft_conversation import (
    company_field_change_without_value,
    describe_company_patch,
    is_field_add_not_create,
    open_in_shell_create,
    parse_company_field_update,
    propose_delete_company_proposal,
    propose_update_company_proposal,
)
from app.agents.coworker_shared import (
    display_from_catalog,
    has_compound_delete_intent,
    has_open_record,
    looks_like_affirmative,
    looks_like_decline,
    open_entity_id,
    wants_delete_intent,
)
from app.agents.native_pipeline import run_steps


class CompanyCoworkerState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    result: dict[str, Any]


def _last_user(messages: list[dict[str, Any]] | None) -> str:
    if not messages:
        return ""
    for m in reversed(messages):
        if m.get("role") == "user" and isinstance(m.get("text"), str):
            t = m["text"].strip()
            if t:
                return t
    return ""


def _last_assistant(messages: list[dict[str, Any]] | None) -> str:
    if not messages:
        return ""
    for m in reversed(messages):
        if m.get("role") == "assistant" and isinstance(m.get("text"), str):
            t = m["text"].strip()
            if t:
                return t
    return ""


def is_companies_list_intent(text: str) -> bool:
    lower = text.lower()
    return bool(
        re.search(r"show\s+(all\s+)?compan", lower)
        or re.search(r"list\s+(all\s+)?compan", lower)
        or re.search(r"back\s+to\s+(the\s+)?(list|compan)", lower)
        or re.search(r"return\s+to\s+(the\s+)?(list|compan)", lower)
        or re.search(r"\b(view|open)\s+(the\s+)?(company\s+)?list\b", lower)
        or re.search(r"\bclear\s+(the\s+)?(search|filter|filters)\b", lower)
        or re.search(r"^\s*show\s+all\s*$", lower)
        or lower in ("show companies", "companies")
    )


def _is_help_question(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(what can you|what do you|capabilities|how do (you|i)|explain (this|the)|"
            r"who are you|what are you)\b",
            lower,
        )
        or re.search(r"what can you help", lower)
    )


def _wants_delete(lower: str) -> bool:
    return wants_delete_intent(lower)


def _wants_edit(lower: str) -> bool:
    if _wants_delete(lower):
        return False
    if is_field_add_not_create(lower):
        return True
    return bool(
        re.search(
            r"\b(edit|update|change|modify|rename)\b|"
            r"\b(fix|correct)\s+(the\s+)?(company|name|domain|industry|details?)\b",
            lower,
        )
    )


def _wants_create(lower: str) -> bool:
    if _is_help_question(lower) or _wants_edit(lower) or _wants_delete(lower):
        return False
    if is_field_add_not_create(lower):
        return False
    return bool(
        re.search(
            r"\b(create|new|start|make|draft|register|set\s*up|insert)\b|"
            r"\badd\s+(a\s+|an\s+|new\s+)?(company|account|organization|org|location)\b|"
            r"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|register|insert)\b|"
            r"\b(want|need)\s+(a|an)\s+(new\s+)?(company|account|organization|org)\b",
            lower,
        )
    )


def extract_delete_query(text: str) -> str | None:
    m = re.search(
        r"(?:delete|remove|erase)\s+"
        r"(?:the\s+)?(?:company\s+)?(?:for\s+|named\s+|of\s+)?"
        r"(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(
        r"^(a|the|this|that|company|companies|account|them|it|here|"
        r"this\s+company|the\s+company|current\s+company)$",
        q,
        re.I,
    ):
        return None
    q = re.sub(r"^(?:the\s+)?company\s+", "", q, flags=re.I).strip()
    return q[:120] if q else None


def _looks_like_delete_confirm(text: str) -> bool:
    if looks_like_affirmative(text):
        return True
    return bool(
        re.match(
            r"^\s*(delete(\s+(it|them|this|that))?(\s+(the\s+)?(company|account))?|"
            r"remove(\s+(it|them|this|that))?(\s+(the\s+)?(company|account))?)\s*[.!]?\s*$",
            text.strip(),
            re.I,
        )
    )


def extract_open_query(text: str) -> str | None:
    m = re.search(
        r"(?:open|show|view|find|go to)\s+(?:company\s+)?(.+)$",
        text,
        re.I,
    ) or re.search(r"^company\s+(.+)$", text, re.I)
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(r"^(a|the|all|list|new)$", q, re.I):
        return None
    if is_companies_list_intent(text):
        return None
    if re.match(r"^(company|this|them|it)$", q, re.I):
        return None
    return q[:120]


def extract_edit_query(text: str) -> str | None:
    if parse_company_field_update(text):
        return None
    m = re.search(
        r"(?:edit|update|change|modify|rename)\s+"
        r"(?:the\s+)?(?:company\s+)?(?:for\s+|named\s+|of\s+)?"
        r"(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(
        r"^(a|the|this|that|company|companies|account|it|details?|info|domain|industry|"
        r"this\s+company|the\s+company|current\s+company)$",
        q,
        re.I,
    ):
        return None
    if re.search(r"\bof\s+(?:this|the)\s+company\b", q, re.I):
        return None
    q = re.sub(r"^(?:the\s+)?company\s+", "", q, flags=re.I).strip()
    if not q:
        return None
    if parse_company_field_update(q):
        return None
    return q[:120]


def _awaiting_company_identity(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    if (
        _awaiting_delete_identity(messages)
        or _awaiting_delete_confirm(messages)
        or _awaiting_field_update_target(messages)
    ):
        return False
    return bool(
        re.search(
            r"which company|name or domain|who (do you|should|would)|"
            r"provide (a |the )?name|tell me which",
            last,
        )
    )


def _awaiting_field_update_target(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(r"which company should we update", last)
        and re.search(r"i'?ll set the|set the", last)
    )


def _awaiting_delete_identity(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(r"\bdelete\b|\bremove\b", last)
        and re.search(r"which company|name or domain|who (should|would|do)", last)
    )


def _awaiting_delete_confirm(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(
            r"want me to remove|permanently remove|confirm.*(delete|remov)|"
            r"ready to delete|say \*\*delete\*\*",
            last,
        )
    )


def _looks_like_company_identity(text: str) -> bool:
    stripped = text.strip()
    if not stripped or len(stripped) > 80:
        return False
    lower = stripped.lower()
    if (
        _wants_create(lower)
        or _wants_edit(lower)
        or _wants_delete(lower)
        or is_companies_list_intent(stripped)
    ):
        return False
    if re.search(
        r"\b(help|what can|show|list|create|add|new|edit|update|cancel|never\s*mind)\b",
        lower,
    ):
        return False
    if re.search(r"^[\w.-]+\.[a-z]{2,}$", stripped, re.I):
        return True
    words = re.findall(r"[A-Za-z0-9][\w'-]*", stripped)
    return 1 <= len(words) <= 5


def resolve_company_match(
    catalog: dict[str, Any] | None, query: str
) -> dict[str, Any] | None:
    """Return a single catalog company when the query uniquely identifies them.

    Same exact/strong/weak bucket pattern as resolve_contact_match / resolve_deal_match.
    """
    companies = (catalog or {}).get("companies")
    if not isinstance(companies, list) or not companies:
        return None
    q = query.strip().lower()
    if not q:
        return None

    exact: list[dict[str, Any]] = []
    strong: list[dict[str, Any]] = []
    weak: list[dict[str, Any]] = []

    for raw in companies:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        name = str(raw.get("name") or "").strip()
        domain = str(raw.get("domain") or "").strip()
        name_l = name.lower()
        domain_l = domain.lower()
        if not name_l and not domain_l:
            continue
        if q == name_l or (domain_l and q == domain_l):
            exact.append(raw)
            continue
        if name_l.startswith(q + " ") or name_l.startswith(q) or (
            domain_l and domain_l.startswith(q)
        ):
            strong.append(raw)
            continue
        if q in name_l or (domain_l and q in domain_l):
            weak.append(raw)

    for bucket in (exact, strong, weak):
        if len(bucket) == 1:
            return bucket[0]
    return None


def _open_company_result(company: dict[str, Any], *, query: str) -> dict[str, Any]:
    name = str(company.get("name") or query).strip() or query
    return {
        "ok": True,
        "assistantText": (
            f"Opening **{name}** — tell me what you'd like to change "
            "(name, domain, industry, …)."
        ),
        "toolProposals": [
            {
                "id": "ws-detail",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": str(company["id"]),
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


def _delete_candidate_result(company: dict[str, Any], *, query: str) -> dict[str, Any]:
    name = str(company.get("name") or query).strip() or query
    return {
        "ok": True,
        "assistantText": f"I found **{name}**. Want me to remove it permanently?",
        "toolProposals": [
            {
                "id": "ws-detail-delete",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": str(company["id"]),
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


def _find_or_search_company(
    query: str, catalog: dict[str, Any] | None
) -> dict[str, Any]:
    match = resolve_company_match(catalog, query)
    if match:
        return _open_company_result(match, query=query)
    q = query.strip()[:120]
    return {
        "ok": True,
        "assistantText": (
            f"I couldn't uniquely match **{q}** — I've filtered the list. "
            "Say the full company name or domain and I'll open it."
        ),
        "toolProposals": [
            {
                "id": "ws-search",
                "name": "set_workspace",
                "label": "Search companies",
                "args": {"mode": "list", "search": q, "auto": True},
                "risk": "low",
            }
        ],
    }


def _find_or_search_for_delete(
    query: str, catalog: dict[str, Any] | None
) -> dict[str, Any]:
    match = resolve_company_match(catalog, query)
    if match:
        return _delete_candidate_result(match, query=query)
    q = query.strip()[:120]
    return {
        "ok": True,
        "assistantText": (
            f"I couldn't uniquely match **{q}** — I've filtered the list. "
            "Say the full name or domain of the company to delete."
        ),
        "toolProposals": [
            {
                "id": "ws-search-delete",
                "name": "set_workspace",
                "label": "Search companies",
                "args": {"mode": "list", "search": q, "auto": True},
                "risk": "low",
            }
        ],
    }


def _looks_like_simple_yes(text: str) -> bool:
    return looks_like_affirmative(text)


def _apply_field_update(
    entity_id: str, field_patch: dict[str, str]
) -> dict[str, Any]:
    from app.agents.draft_conversation import sanitize_company_field_patch

    clean = sanitize_company_field_patch(field_patch)
    if not clean:
        return {
            "ok": True,
            "assistantText": (
                "What's the new company name? Just the name itself "
                "(e.g. Red Bull) — not the whole sentence."
            ),
        }
    what = describe_company_patch(clean)
    return {
        "ok": True,
        "assistantText": f"Sure — I'll update the {what} now.",
        "toolProposals": [
            propose_update_company_proposal(
                company_id=str(entity_id),
                patch=clean,
                auto=True,
            )
        ],
    }


def _ask_which_company() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which company should we open? Share a name or domain and I'll find it."
        ),
    }


def _ask_which_company_for_field(field_patch: dict[str, str]) -> dict[str, Any]:
    what = describe_company_patch(field_patch)
    return {
        "ok": True,
        "assistantText": (
            f"Which company should we update — I'll set the {what}. "
            "Share a name or domain."
        ),
    }


def _open_and_apply_field_update(
    company: dict[str, Any], field_patch: dict[str, str]
) -> dict[str, Any]:
    from app.agents.draft_conversation import sanitize_company_field_patch

    clean = sanitize_company_field_patch(field_patch) or field_patch
    name = str(company.get("name") or "this company").strip() or "this company"
    what = describe_company_patch(clean)
    return {
        "ok": True,
        "assistantText": f"Updating **{name}** — setting the {what} now.",
        "toolProposals": [
            {
                "id": "ws-detail-field",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": str(company["id"]),
                    "auto": True,
                },
                "risk": "low",
            },
            propose_update_company_proposal(
                company_id=str(company["id"]),
                patch=clean,
                auto=True,
            ),
        ],
    }


def _ask_which_company_to_delete() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which company would you like to delete? Share a name or domain."
        ),
    }


def _execute_delete(
    company_id: str, *, display_name: str = ""
) -> dict[str, Any]:
    name = display_name.strip() or "this company"
    return {
        "ok": True,
        "assistantText": f"Removing **{name}** now.",
        "toolProposals": [
            propose_delete_company_proposal(
                company_id=str(company_id),
                display_name=display_name,
                auto=True,
            )
        ],
    }


def companies_heuristic(
    text: str,
    ctx: dict[str, Any],
    *,
    messages: list[dict[str, Any]] | None = None,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    surface = str(ctx.get("surface") or "").lower()
    lower = text.lower()
    entity_id = open_entity_id(ctx)
    open_in_memory = has_open_record(ctx)

    if is_companies_list_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "Alright — showing all companies again."
                if surface == "list"
                else "Alright — back to the companies list. Chat stays here."
            ),
            "toolProposals": [
                {
                    "id": "ws-list",
                    "name": "set_workspace",
                    "label": "Show companies",
                    "args": {"mode": "list", "auto": True, "search": ""},
                    "risk": "low",
                }
            ],
        }

    if _awaiting_delete_confirm(messages) and looks_like_decline(text):
        display = ""
        for c in (catalog or {}).get("companies") or []:
            if isinstance(c, dict) and str(c.get("id")) == str(entity_id):
                display = str(c.get("name") or "")
                break
        who = f"**{display}**" if display else "that company"
        return {
            "ok": True,
            "assistantText": f"No problem — I won't delete {who}. Anything else you need?",
        }

    if _awaiting_delete_confirm(messages) and (
        _looks_like_delete_confirm(text) or _wants_delete(lower)
    ):
        if entity_id:
            display = ""
            for c in (catalog or {}).get("companies") or []:
                if isinstance(c, dict) and str(c.get("id")) == str(entity_id):
                    display = str(c.get("name") or "")
                    break
            return _execute_delete(str(entity_id), display_name=display)
        return {
            "ok": True,
            "assistantText": (
                "I still need to know which company to delete — share a name or domain."
            ),
        }

    if _awaiting_delete_identity(messages) and _looks_like_company_identity(text):
        return _find_or_search_for_delete(text, catalog)

    if has_compound_delete_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "That sounds like more than one request — should I update this "
                "company, delete it, or create a new one? Let's do one at a time."
            ),
        }

    if _wants_delete(lower):
        q = extract_delete_query(text)
        if open_in_memory and entity_id:
            if q:
                match = resolve_company_match(catalog, q)
                if match and str(match.get("id")) != str(entity_id):
                    return _find_or_search_for_delete(q, catalog)
            display = display_from_catalog(
                catalog,
                entity_id,
                list_key="companies",
                name_keys=("name", "displayName"),
            )
            return _execute_delete(str(entity_id), display_name=display)
        if q:
            return _find_or_search_for_delete(q, catalog)
        return _ask_which_company_to_delete()

    if _awaiting_field_update_target(messages) and _looks_like_company_identity(text):
        pending = parse_company_field_update(_last_assistant(messages))
        if pending:
            match = resolve_company_match(catalog, text)
            if match:
                return _open_and_apply_field_update(match, pending)
            return {
                "ok": True,
                "assistantText": (
                    f"I couldn't uniquely match **{text.strip()[:80]}** — "
                    "share the full company name or domain to update."
                ),
                "toolProposals": [
                    {
                        "id": "ws-search-field",
                        "name": "set_workspace",
                        "label": "Search companies",
                        "args": {
                            "mode": "list",
                            "search": text.strip()[:120],
                            "auto": True,
                        },
                        "risk": "low",
                    }
                ],
            }

    if _awaiting_company_identity(messages) and _looks_like_company_identity(text):
        return _find_or_search_company(text, catalog)

    field_patch = parse_company_field_update(text)
    if field_patch:
        if entity_id:
            return _apply_field_update(str(entity_id), field_patch)
        return _ask_which_company_for_field(field_patch)

    company_field_pending = company_field_change_without_value(text)
    if company_field_pending and open_in_memory and entity_id:
        labels = {
            "name": "company name",
            "industry": "industry",
            "domain": "domain / website",
            "linkedinUrl": "LinkedIn URL",
            "employeeCount": "company size",
        }
        label = labels.get(company_field_pending, company_field_pending)
        name = display_from_catalog(
            catalog,
            entity_id,
            list_key="companies",
            name_keys=("name", "displayName"),
            open_key="openCompany",
        ) or "this company"
        return {
            "ok": True,
            "assistantText": f"Sure — what's the {label} for **{name}**?",
        }

    if surface == "detail" and entity_id:
        pending_offer = parse_company_field_update(_last_assistant(messages))
        if pending_offer and looks_like_decline(text):
            return {
                "ok": True,
                "assistantText": "No problem — I'll leave that as is. Anything else?",
            }
        if pending_offer and _looks_like_simple_yes(text):
            return _apply_field_update(str(entity_id), pending_offer)
        if _wants_edit(lower) and not extract_edit_query(text):
            return {
                "ok": True,
                "assistantText": (
                    "What should we change — name, domain, industry, or LinkedIn URL? "
                    'For example: "domain acme.com".'
                ),
            }

    if _wants_edit(lower):
        if entity_id and surface == "detail" and not extract_edit_query(text):
            return {
                "ok": True,
                "assistantText": (
                    "What should we change — name, domain, industry, or LinkedIn URL?"
                ),
            }
        q = extract_edit_query(text)
        if q:
            return _find_or_search_company(q, catalog)
        return _ask_which_company()

    company_create = _wants_create(lower) and (
        bool(re.search(r"\b(company|compan|account|organization|org)\b", lower))
        or not bool(
            re.search(r"\b(contact|deal|product|invoice|quote|activit|location)\b", lower)
        )
    )
    if company_create:
        if surface == "create":
            return None
        return open_in_shell_create(
            text,
            label="Create company",
            first_question="Sure thing — what's the company name?",
        )

    open_q = extract_open_query(text)
    if open_q and entity_id and re.search(r"this|current|it", open_q, re.I):
        return {
            "ok": True,
            "assistantText": "Keeping this company open on the right.",
            "toolProposals": [
                {
                    "id": "ws-detail",
                    "name": "set_workspace",
                    "label": "Open company",
                    "args": {"mode": "detail", "entityId": entity_id, "auto": True},
                    "risk": "low",
                }
            ],
        }
    if open_q and not re.search(r"create|add|new", lower):
        return _find_or_search_company(open_q, catalog)

    if _is_help_question(lower) or re.search(r"^\s*help\b", lower):
        return {
            "ok": True,
            "assistantText": (
                "I can add a new company, find or update an account, or take you back "
                "to the list — just tell me what you need in plain language."
            ),
        }

    return None


async def handle(state: CompanyCoworkerState) -> CompanyCoworkerState:
    messages = state.get("messages") or []
    text = _last_user(messages)
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    if not text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to work with the agent."},
        }

    from app.agents.coworker_shared import (
        should_commit_native_turn,
    )
    from app.agents.crm_tools import run_native_agent_turn
    from app.llm import is_ai_configured

    if not is_ai_configured():
        from app.agents.coworker_shared import LLM_ERROR_SPEECH

        return {
            **state,
            "result": {"ok": False, "assistantText": LLM_ERROR_SPEECH, "source": "error", "reason": "llm_unavailable"},
        }

    native = await run_native_agent_turn(
        mod="company",
        surface=str(ctx.get("surface") or "list"),
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
    return result.get("result") or {"ok": False, "error": "Company co-worker failed."}
