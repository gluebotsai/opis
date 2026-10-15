"""Products module co-worker — list / create / detail workspace intents."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.draft_conversation import (
    describe_product_patch,
    is_field_add_not_create,
    open_in_shell_create,
    parse_product_field_update,
    propose_delete_product_proposal,
    propose_update_product_proposal,
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


class ProductCoworkerState(TypedDict, total=False):
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


def is_products_list_intent(text: str) -> bool:
    lower = text.lower()
    return bool(
        re.search(r"show\s+(all\s+)?products?", lower)
        or re.search(r"list\s+(all\s+)?products?", lower)
        or re.search(r"back\s+to\s+(the\s+)?(list|catalog|products?)", lower)
        or re.search(r"return\s+to\s+(the\s+)?(list|catalog|products?)", lower)
        or re.search(r"\b(view|open)\s+(the\s+)?(product\s+)?(list|catalog)\b", lower)
        or re.search(r"\bclear\s+(the\s+)?(search|filter|filters)\b", lower)
        or re.search(r"^\s*show\s+all\s*$", lower)
        or lower in ("show products", "products", "catalog")
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
            r"\b(fix|correct)\s+(the\s+)?(product|name|sku|price|details?)\b",
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
            r"\badd\s+(a\s+|an\s+|new\s+)?(product|sku|catalog\s+item)\b|"
            r"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|register|insert)\b|"
            r"\b(want|need)\s+(a|an)\s+(new\s+)?(product|sku|catalog\s+item)\b",
            lower,
        )
    )


def extract_delete_query(text: str) -> str | None:
    m = re.search(
        r"(?:delete|remove|erase)\s+"
        r"(?:the\s+)?(?:product\s+)?(?:for\s+|named\s+|of\s+)?"
        r"(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(
        r"^(a|the|this|that|product|products|sku|it|here|"
        r"this\s+product|the\s+product|current\s+product)$",
        q,
        re.I,
    ):
        return None
    q = re.sub(r"^(?:the\s+)?product\s+", "", q, flags=re.I).strip()
    return q[:120] if q else None


def _looks_like_delete_confirm(text: str) -> bool:
    if looks_like_affirmative(text):
        return True
    return bool(
        re.match(
            r"^\s*(delete(\s+(it|them|this|that))?(\s+(the\s+)?product)?|"
            r"remove(\s+(it|them|this|that))?(\s+(the\s+)?product)?)\s*[.!]?\s*$",
            text.strip(),
            re.I,
        )
    )


def extract_open_query(text: str) -> str | None:
    m = re.search(
        r"(?:open|show|view|find|go to)\s+(?:product\s+)?(.+)$",
        text,
        re.I,
    ) or re.search(r"^product\s+(.+)$", text, re.I)
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(r"^(a|the|all|list|catalog|new)$", q, re.I):
        return None
    if is_products_list_intent(text):
        return None
    if re.match(r"^(product|this|it|sku)$", q, re.I):
        return None
    return q[:120]


def extract_edit_query(text: str) -> str | None:
    if parse_product_field_update(text):
        return None
    m = re.search(
        r"(?:edit|update|change|modify|rename)\s+"
        r"(?:the\s+)?(?:product\s+)?(?:for\s+|named\s+|of\s+)?"
        r"(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(
        r"^(a|the|this|that|product|products|it|details?|info|sku|price|name|"
        r"this\s+product|the\s+product|current\s+product)$",
        q,
        re.I,
    ):
        return None
    if re.search(r"\bof\s+(?:this|the)\s+product\b", q, re.I):
        return None
    q = re.sub(r"^(?:the\s+)?product\s+", "", q, flags=re.I).strip()
    if not q or parse_product_field_update(q):
        return None
    return q[:120]


def _awaiting_product_identity(messages: list[dict[str, Any]] | None) -> bool:
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
            r"which product|name or sku|who (do you|should|would)|tell me which",
            last,
        )
    )


def _awaiting_field_update_target(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(r"which product should we update", last)
        and re.search(r"i'?ll set the|set the", last)
    )


def _awaiting_delete_identity(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(r"\bdelete\b|\bremove\b", last)
        and re.search(r"which product|name or sku|who (should|would|do)", last)
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


def _looks_like_product_identity(text: str) -> bool:
    stripped = text.strip()
    if not stripped or len(stripped) > 80:
        return False
    lower = stripped.lower()
    if (
        _wants_create(lower)
        or _wants_edit(lower)
        or _wants_delete(lower)
        or is_products_list_intent(stripped)
    ):
        return False
    if re.search(
        r"\b(help|what can|show|list|create|add|new|edit|update|cancel|never\s*mind)\b",
        lower,
    ):
        return False
    if re.match(r"^[A-Za-z0-9][\w-]{1,40}$", stripped):
        return True
    words = re.findall(r"[A-Za-z0-9][\w'-]*", stripped)
    return 1 <= len(words) <= 5


def resolve_product_match(
    catalog: dict[str, Any] | None, query: str
) -> dict[str, Any] | None:
    """Return a single catalog product when the query uniquely identifies them.

    Same exact/strong/weak bucket pattern as resolve_contact_match / resolve_deal_match.
    """
    products = (catalog or {}).get("products")
    if not isinstance(products, list) or not products:
        return None
    q = query.strip().lower()
    if not q:
        return None

    exact: list[dict[str, Any]] = []
    strong: list[dict[str, Any]] = []
    weak: list[dict[str, Any]] = []

    for raw in products:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        name = str(raw.get("name") or "").strip()
        sku = str(raw.get("sku") or "").strip()
        name_l = name.lower()
        sku_l = sku.lower()
        if not name_l and not sku_l:
            continue
        if q == name_l or (sku_l and q == sku_l):
            exact.append(raw)
            continue
        if name_l.startswith(q) or (sku_l and sku_l.startswith(q)):
            strong.append(raw)
            continue
        if q in name_l or (sku_l and q in sku_l):
            weak.append(raw)

    for bucket in (exact, strong, weak):
        if len(bucket) == 1:
            return bucket[0]
    return None


def _open_product_result(product: dict[str, Any], *, query: str) -> dict[str, Any]:
    name = str(product.get("name") or query).strip() or query
    return {
        "ok": True,
        "assistantText": (
            f"Opening **{name}** — tell me what you'd like to change "
            "(name, SKU, price, …)."
        ),
        "toolProposals": [
            {
                "id": "ws-detail",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": str(product["id"]),
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


def _delete_candidate_result(product: dict[str, Any], *, query: str) -> dict[str, Any]:
    name = str(product.get("name") or query).strip() or query
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
                    "entityId": str(product["id"]),
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


def _find_or_search_product(
    query: str, catalog: dict[str, Any] | None
) -> dict[str, Any]:
    match = resolve_product_match(catalog, query)
    if match:
        return _open_product_result(match, query=query)
    q = query.strip()[:120]
    return {
        "ok": True,
        "assistantText": (
            f"I couldn't uniquely match **{q}** — I've filtered the list. "
            "Say the full product name or SKU and I'll open it."
        ),
        "toolProposals": [
            {
                "id": "ws-search",
                "name": "set_workspace",
                "label": "Search products",
                "args": {"mode": "list", "search": q, "auto": True},
                "risk": "low",
            }
        ],
    }


def _find_or_search_for_delete(
    query: str, catalog: dict[str, Any] | None
) -> dict[str, Any]:
    match = resolve_product_match(catalog, query)
    if match:
        return _delete_candidate_result(match, query=query)
    q = query.strip()[:120]
    return {
        "ok": True,
        "assistantText": (
            f"I couldn't uniquely match **{q}** — I've filtered the list. "
            "Say the full name or SKU of the product to delete."
        ),
        "toolProposals": [
            {
                "id": "ws-search-delete",
                "name": "set_workspace",
                "label": "Search products",
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
    what = describe_product_patch(field_patch)
    return {
        "ok": True,
        "assistantText": f"Sure — I'll update the {what} now.",
        "toolProposals": [
            propose_update_product_proposal(
                product_id=str(entity_id),
                patch=field_patch,
                auto=True,
            )
        ],
    }


def _ask_which_product() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which product should we open? Share a name or SKU and I'll find it."
        ),
    }


def _ask_which_product_for_field(field_patch: dict[str, str]) -> dict[str, Any]:
    what = describe_product_patch(field_patch)
    return {
        "ok": True,
        "assistantText": (
            f"Which product should we update — I'll set the {what}. "
            "Share a name or SKU."
        ),
    }


def _open_and_apply_field_update(
    product: dict[str, Any], field_patch: dict[str, str]
) -> dict[str, Any]:
    name = str(product.get("name") or "this product").strip() or "this product"
    what = describe_product_patch(field_patch)
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
                    "entityId": str(product["id"]),
                    "auto": True,
                },
                "risk": "low",
            },
            propose_update_product_proposal(
                product_id=str(product["id"]),
                patch=field_patch,
                auto=True,
            ),
        ],
    }


def _ask_which_product_to_delete() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which product would you like to delete? Share a name or SKU."
        ),
    }


def _execute_delete(
    product_id: str, *, display_name: str = ""
) -> dict[str, Any]:
    name = display_name.strip() or "this product"
    return {
        "ok": True,
        "assistantText": f"Removing **{name}** now.",
        "toolProposals": [
            propose_delete_product_proposal(
                product_id=str(product_id),
                display_name=display_name,
                auto=True,
            )
        ],
    }


def products_heuristic(
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

    if is_products_list_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "Alright — showing all products again."
                if surface == "list"
                else "Alright — back to the products list. Chat stays here."
            ),
            "toolProposals": [
                {
                    "id": "ws-list",
                    "name": "set_workspace",
                    "label": "Show products",
                    "args": {"mode": "list", "auto": True, "search": ""},
                    "risk": "low",
                }
            ],
        }

    if _awaiting_delete_confirm(messages) and looks_like_decline(text):
        display = ""
        for p in (catalog or {}).get("products") or []:
            if isinstance(p, dict) and str(p.get("id")) == str(entity_id):
                display = str(p.get("name") or "")
                break
        who = f"**{display}**" if display else "that product"
        return {
            "ok": True,
            "assistantText": f"No problem — I won't delete {who}. Anything else you need?",
        }

    if _awaiting_delete_confirm(messages) and (
        _looks_like_delete_confirm(text) or _wants_delete(lower)
    ):
        if entity_id:
            display = ""
            for p in (catalog or {}).get("products") or []:
                if isinstance(p, dict) and str(p.get("id")) == str(entity_id):
                    display = str(p.get("name") or "")
                    break
            return _execute_delete(str(entity_id), display_name=display)
        return {
            "ok": True,
            "assistantText": (
                "I still need to know which product to delete — share a name or SKU."
            ),
        }

    if _awaiting_delete_identity(messages) and _looks_like_product_identity(text):
        return _find_or_search_for_delete(text, catalog)

    if has_compound_delete_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "That sounds like more than one request — should I update this "
                "product, delete it, or create a new one? Let's do one at a time."
            ),
        }

    if _wants_delete(lower):
        q = extract_delete_query(text)
        if open_in_memory and entity_id:
            if q:
                match = resolve_product_match(catalog, q)
                if match and str(match.get("id")) != str(entity_id):
                    return _find_or_search_for_delete(q, catalog)
            display = display_from_catalog(
                catalog,
                entity_id,
                list_key="products",
                name_keys=("name", "sku"),
            )
            return _execute_delete(str(entity_id), display_name=display)
        if q:
            return _find_or_search_for_delete(q, catalog)
        return _ask_which_product_to_delete()

    if _awaiting_field_update_target(messages) and _looks_like_product_identity(text):
        pending = parse_product_field_update(_last_assistant(messages))
        if pending:
            match = resolve_product_match(catalog, text)
            if match:
                return _open_and_apply_field_update(match, pending)
            return {
                "ok": True,
                "assistantText": (
                    f"I couldn't uniquely match **{text.strip()[:80]}** — "
                    "share the full product name or SKU to update."
                ),
                "toolProposals": [
                    {
                        "id": "ws-search-field",
                        "name": "set_workspace",
                        "label": "Search products",
                        "args": {
                            "mode": "list",
                            "search": text.strip()[:120],
                            "auto": True,
                        },
                        "risk": "low",
                    }
                ],
            }

    if _awaiting_product_identity(messages) and _looks_like_product_identity(text):
        return _find_or_search_product(text, catalog)

    field_patch = parse_product_field_update(text)
    if field_patch:
        if entity_id:
            return _apply_field_update(str(entity_id), field_patch)
        return _ask_which_product_for_field(field_patch)

    if surface == "detail" and entity_id:
        pending_offer = parse_product_field_update(_last_assistant(messages))
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
                    "What should we change — name, SKU, price, or description? "
                    'For example: "price 99".'
                ),
            }

    if _wants_edit(lower):
        if entity_id and surface == "detail" and not extract_edit_query(text):
            return {
                "ok": True,
                "assistantText": (
                    "What should we change — name, SKU, price, or description?"
                ),
            }
        q = extract_edit_query(text)
        if q:
            return _find_or_search_product(q, catalog)
        return _ask_which_product()

    product_create = _wants_create(lower) and (
        bool(re.search(r"\b(product|sku|catalog)\b", lower))
        or not bool(
            re.search(r"\b(contact|deal|compan|invoice|quote|activit)\b", lower)
        )
    )
    if product_create:
        if surface == "create":
            return None
        return open_in_shell_create(
            text,
            label="Create product",
            first_question="Sure — what's the product name?",
        )

    open_q = extract_open_query(text)
    if open_q and entity_id and re.search(r"this|current|it", open_q, re.I):
        return {
            "ok": True,
            "assistantText": "Keeping this product open on the right.",
            "toolProposals": [
                {
                    "id": "ws-detail",
                    "name": "set_workspace",
                    "label": "Open product",
                    "args": {"mode": "detail", "entityId": entity_id, "auto": True},
                    "risk": "low",
                }
            ],
        }
    if open_q and not re.search(r"create|add|new", lower):
        return _find_or_search_product(open_q, catalog)

    if _is_help_question(lower) or re.search(r"^\s*help\b", lower):
        return {
            "ok": True,
            "assistantText": (
                "I can add a new product, find or update one in the catalog, or take you "
                "back to the list — just tell me what you need in plain language."
            ),
        }

    return None


async def handle(state: ProductCoworkerState) -> ProductCoworkerState:
    messages = state.get("messages") or []
    text = _last_user(messages)
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    if not text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to work with the agent."},
        }

    surface = str(ctx.get("surface") or "list").lower()
    # Create walk must go through enrich_product_draft_result / next_product_prompt
    # (crm_agent _finish_draft). Committing native here skips that and desyncs chat.
    if surface == "create":
        return {
            **state,
            "result": {"ok": True, "assistantText": "", "_unhandled": True},
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
        mod="product",
        surface=surface,
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
    return result.get("result") or {"ok": False, "error": "Product co-worker failed."}
