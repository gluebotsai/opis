"""Sales / deals co-worker — list / create / detail workspace intents."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.draft_conversation import (
    is_field_add_not_create,
    open_in_shell_create,
    parse_money_amount,
    propose_create_deal_proposal,
    propose_create_proposal_doc,
    propose_delete_deal_proposal,
    propose_update_deal_proposal,
)
from app.agents.coworker_shared import (
    display_from_catalog,
    has_compound_delete_intent,
    has_open_record,
    looks_like_affirmative,
    looks_like_decline,
    open_entity_id,
    rank_deals_by_name,
    trim_at_next_field,
    wants_delete_intent,
)
from app.agents.native_pipeline import run_steps


class DealCoworkerState(TypedDict, total=False):
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


def _last_assistant(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "assistant":
            return str(m.get("text") or "").strip()
    return ""


def _is_help_question(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(what can you|how (can|do) you|help me\??$|what do you do|"
            r"help\?|who are you|what are you)\b",
            lower,
        )
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
            r"\b(move|advance)\s+(to\s+)?(stage|propose|negotiat|discover|qualif|won|lost)\b",
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
            r"\badd\s+(a\s+|an\s+|new\s+)?(deal|opportunit)\b|"
            r"\bhelp me (to )?(create|add|make|draft|log|start|set\s*up|register|insert)\b|"
            r"\b(want|need)\s+(a|an)\s+(new\s+)?(deal|opportunit)",
            lower,
        )
    )


def _wants_create_proposal(lower: str) -> bool:
    """Sales proposal *document*, not pipeline stage “propose”."""
    if _wants_delete(lower) or _wants_edit(lower):
        return False
    if re.search(
        r"\b(move|change|set|update|advance|push)\s+(to\s+)?(propos(?:e|al)|negotiat)",
        lower,
    ):
        return False
    return bool(
        re.search(
            r"\b(create|draft|write|prepare|generate|make|start|build)\b"
            r".{0,40}\b(propos(?:al|e)|rfp)\b|"
            r"\b(new|a|an)\s+(sales\s+)?proposal\b|"
            r"\bpropos(?:al|e)\s+for\b|"
            r"^\s*(the\s+)?proposal\s*$",
            lower,
        )
    )


def _requirement_pdf_name(ctx: dict[str, Any] | None) -> str | None:
    """Filename when the chat turn has a requirement file attached (UI state)."""
    if not isinstance(ctx, dict):
        return None
    raw = ctx.get("requirementPdfAttached")
    if raw is True:
        return "requirement.pdf"
    if isinstance(raw, str) and raw.strip():
        return raw.strip()[:200]
    if isinstance(raw, dict):
        name = str(raw.get("name") or "").strip()
        if name:
            return name[:200]
        if raw.get("attached"):
            return "requirement.pdf"
    return None


def _defers_products_to_requirement_pdf(text: str) -> bool:
    """User sends the attached file, or says products/scope are in the BRD."""
    lower = (text or "").strip().lower()
    if not lower:
        return True
    if re.match(
        r"^(generate|create|go|proceed|continue|yes|ok|okay|sure|yep|yeah|"
        r"do it|make it|use (it|that|the )?(pdf|docx|word|txt|file)|"
        r"use this attached file|"
        r"attached .*)\s*\.?!?$",
        lower,
    ):
        return True
    return bool(
        re.search(
            r"\b(in|from|see|check|read|use|present|already|inside|attached)\b.{0,40}"
            r"\b(pdf|docx|word|txt|requirement|brd|rfp|document|doc|brief|file)\b|"
            r"\b(pdf|docx|requirement|brd)\b.{0,30}\b(itself|has|contains|lists)\b|"
            r"\buse this attached file\b",
            lower,
        )
    )


def resolve_proposal_handoff(text: str, mod: str) -> dict[str, Any] | None:
    """Leave another module's create draft and open Sales for a proposal doc."""
    m = (mod or "").lower()
    if m == "sales" or not _wants_create_proposal(text.lower()):
        return None
    here = {
        "contact": "a contact",
        "company": "a company",
        "product": "a product",
        "finance": "an invoice",
        "quotes": "a quote",
        "activities": "an activity",
    }.get(m, "this record")
    return {
        "ok": True,
        "assistantText": (
            f"That's a **proposal** (a deal document), not {here} — "
            "I'll open Sales and continue from there."
        ),
        "toolProposals": [
            {
                "id": "nav-proposal",
                "name": "navigate",
                "label": "Open Sales for proposal",
                "args": {
                    "href": "/sales",
                    "seedPrompt": text.strip()[:2000],
                    "auto": True,
                },
                "risk": "low",
            }
        ],
        "sessionMemoryPatch": {
            "pendingIntent": "create_proposal",
            "pendingAsk": "deal",
            "slots": {},
        },
        "source": "heuristic",
        "reason": "proposal_handoff",
    }


def resolve_proposal_not_quote_turn(
    *,
    user_text: str,
    mod: str,
    pathname: str,
    catalog: dict[str, Any],
) -> dict[str, Any] | None:
    """Proposal docs belong on Sales — never quote-draft fill on Quotes create."""
    m = (mod or "").lower()
    path = pathname or ""
    on_quotes_surface = m == "quotes" or path.startswith("/sales/quotes")
    lower = user_text.lower()
    if not _wants_create_proposal(lower):
        return None
    if re.search(r"/sales/proposals/[^/?#]+", path):
        return None
    # Sales pipeline (not Quotes) owns proposal natively via deal coworker.
    if m == "sales" and not on_quotes_surface:
        return None

    from app.agents.coworker_shared import clear_rank_winner, rank_deals_by_name

    deals = [
        d for d in (catalog.get("deals") or []) if isinstance(d, dict) and d.get("id")
    ]
    winner = clear_rank_winner(
        rank_deals_by_name({"deals": deals}, user_text, min_score=0.78, limit=2)
    )
    if winner and winner.get("id"):
        customer = extract_proposal_customer(user_text) or str(
            winner.get("contactName") or winner.get("companyName") or ""
        ) or None
        topic = extract_proposal_topic(user_text)
        title = extract_proposal_doc_title(user_text) or _proposal_title(customer, topic)
        flow = _build_proposal_flow(
            text=user_text,
            catalog=catalog,
            deal_id=str(winner["id"]),
            customer=customer,
            topic=topic,
            title=title,
        )
        creating = any(
            t.get("name") == "propose_create_proposal"
            for t in (flow.get("toolProposals") or [])
        )
        return {
            **flow,
            "sessionMemoryPatch": {
                "pendingIntent": "" if creating else "create_proposal",
                "pendingAsk": "" if creating else "requirement_pdf",
                "slots": {
                    "dealId": str(winner["id"]),
                    **({"productHint": topic} if topic else {}),
                    **({"proposalTitle": title} if title else {}),
                },
                **({"lastEntities": {"dealId": str(winner["id"])}} if creating else {}),
            },
            "source": "heuristic",
            "reason": "proposal_not_quote",
        }

    here = {
        "contact": "a contact",
        "company": "a company",
        "product": "a product",
        "finance": "an invoice",
        "quotes": "a quote",
        "activities": "an activity",
    }.get(m, "this record")
    return {
        "ok": True,
        "assistantText": (
            f"That's a **proposal** (a deal document), not {here} — "
            "I'll open Sales and continue from there."
        ),
        "toolProposals": [
            {
                "id": "nav-proposal",
                "name": "navigate",
                "label": "Open Sales for proposal",
                "args": {
                    "href": "/sales",
                    "seedPrompt": user_text.strip()[:2000],
                    "auto": True,
                },
                "risk": "low",
            }
        ],
        "sessionMemoryPatch": {
            "pendingIntent": "create_proposal",
            "pendingAsk": "deal",
            "slots": {},
        },
        "source": "heuristic",
        "reason": "proposal_not_quote",
    }


def extract_proposal_doc_title(text: str) -> str | None:
    """Explicit title: titled 'Product proposal' / title: Foo."""
    m = re.search(
        r"\btitled?\s*[:=]?\s*[\"']([^\"']{2,120})[\"']",
        text,
        re.I,
    )
    if m:
        return m.group(1).strip()[:200]
    m2 = re.search(
        r"\btitle\s*[:=]\s*[\"']?([^\"'\n,]{2,120})",
        text,
        re.I,
    )
    if m2:
        return m2.group(1).strip().rstrip(".!")[:200]
    return None


def extract_proposal_customer(text: str) -> str | None:
    """Customer/contact hint from “proposal for Manoj …”."""
    # “create/draft a proposal for <product>” — the trailing noun is the topic,
    # not a customer (deal context already has the customer).
    if re.search(
        r"\b(create|draft|write|prepare|generate|make|start|build)\b"
        r".{0,40}\bpropos(?:al|e)\s+for\b",
        text,
        re.I,
    ) and not re.search(
        r"\bpropos(?:al|e)\s+for\s+.+\s+(?:for|about|regarding)\s+",
        text,
        re.I,
    ):
        return None
    m = re.search(
        r"\bpropos(?:al|e)\s+for\s+(.+?)(?:\s+for\s+|\s+about\s+|\s+regarding\s+|"
        r"\s+on\s+|\s*[—\-–]\s*|$)",
        text,
        re.I,
    )
    if not m:
        return None
    name = m.group(1).strip().rstrip(".?!,")
    name = re.sub(
        r"^(a|an|the|customer|client|contact)\s+",
        "",
        name,
        flags=re.I,
    ).strip()
    if not name or len(name) < 2:
        return None
    if re.match(r"^(this|that|the)\s+deal\b", name, re.I):
        return None
    return name[:80]


def extract_proposal_topic(text: str) -> str | None:
    """Product/scope after a second “for/about”, e.g. CRM + ticketing."""
    m = re.search(
        r"\bpropos(?:al|e)\s+for\s+.+?\s+(?:for|about|regarding)\s+(.+)$",
        text,
        re.I,
    )
    if m:
        topic = m.group(1).strip().rstrip(".?!")
        return topic[:160] if topic else None
    # “proposal … covering CRM and Ticketing”
    m_cover = re.search(
        r"\bcovering\s+(.+)$",
        text,
        re.I,
    )
    if m_cover:
        topic = m_cover.group(1).strip().rstrip(".?!")
        if topic and len(topic) >= 2:
            return topic[:160]
    # “proposal for nvidia — Contact Centre”
    m_dash = re.search(
        r"\bpropos(?:al|e)\s+for\s+.+?\s*[—\-–]\s*(.+)$",
        text,
        re.I,
    )
    if m_dash:
        topic = m_dash.group(1).strip().rstrip(".?!")
        if topic and len(topic) >= 2:
            return topic[:160]
    # “create/draft a proposal for Ticketing” → Ticketing is the product.
    m_verb = re.search(
        r"\b(create|draft|write|prepare|generate|make|start|build)\b"
        r".{0,40}\bpropos(?:al|e)\s+for\s+(.+)$",
        text,
        re.I,
    )
    if m_verb:
        topic = m_verb.group(2).strip().rstrip(".?!")
        topic = re.sub(
            r"^(a|an|the|product|solution)\s+",
            "",
            topic,
            flags=re.I,
        ).strip()
        if topic and len(topic) >= 2:
            # Pronouns / placeholders are not products or customers.
            if re.match(
                r"^(this|that)(\s+(customer|client|contact|opportunity|deal))?$",
                topic,
                re.I,
            ):
                return None
            return topic[:160]
    # “ticketing proposal” / “proposal about ticketing” / “covering ticketing”
    m2 = re.search(
        r"\b(?:propos(?:al|e)|proposal)\s+(?:about|regarding|covering|on)\s+(.+)$",
        text,
        re.I,
    )
    if m2:
        topic = m2.group(1).strip().rstrip(".?!")
        return topic[:160] if topic else None
    m3 = re.search(
        r"\b([a-z0-9][\w\s\-/+]{1,60}?)\s+propos(?:al|e)\b",
        text,
        re.I,
    )
    if m3:
        topic = m3.group(1).strip()
        # Ignore “create/new/customer/sales proposal” and “create a proposal”
        if re.match(
            r"^(create|new|a|an|the|customer|sales|company|draft|"
            r"write|prepare|generate|make|start|build)"
            r"(\s+(a|an|the|new|sales))?$",
            topic,
            re.I,
        ):
            return None
        return topic[:160]
    return None


def _product_rows(catalog: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw = (catalog or {}).get("products") if catalog else None
    if not isinstance(raw, list):
        return []
    return [p for p in raw if isinstance(p, dict) and p.get("id") and p.get("name")]


def _score_product(query: str, name: str) -> float:
    q = (query or "").lower().strip()
    n = (name or "").lower().strip()
    if not q or not n:
        return 0.0
    if n in q or q in n:
        return 10.0 + min(len(n), 40) / 10.0
    q_parts = [p for p in re.split(r"[^a-z0-9]+", q) if len(p) > 2]
    n_parts = [p for p in re.split(r"[^a-z0-9]+", n) if len(p) > 2]
    if not q_parts:
        return 0.0
    hits = sum(1 for p in q_parts if p in n or any(p in np or np in p for np in n_parts))
    if hits == 0:
        return 0.0
    return hits * 3.0 + hits / max(len(q_parts), 1)


def match_products_for_proposal(
    catalog: dict[str, Any] | None,
    query: str | None,
    *,
    limit: int = 5,
    min_score: float = 3.0,
) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    scored: list[tuple[float, dict[str, Any]]] = []
    for p in _product_rows(catalog):
        score = _score_product(q, str(p.get("name") or ""))
        if score >= min_score:
            scored.append((score, p))
    scored.sort(key=lambda x: -x[0])
    if not scored:
        return []
    top = scored[0][0]
    return [p for s, p in scored if s >= top - 2.0][:limit]


def _meeting_text_blob(catalog: dict[str, Any] | None) -> str:
    meetings = (catalog or {}).get("meetings") if catalog else None
    if not isinstance(meetings, list) or not meetings:
        return ""
    parts: list[str] = []
    for m in meetings[:12]:
        if not isinstance(m, dict):
            continue
        parts.append(str(m.get("subject") or ""))
        parts.append(str(m.get("body") or "")[:600])
    return "\n".join(parts)


def _awaiting_proposal_product(messages: list[dict[str, Any]] | None) -> bool:
    """Last assistant asked which product(s) for the proposal."""
    if not messages:
        return False
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "") != "assistant":
            continue
        text = str(msg.get("text") or "").lower()
        return bool(
            re.search(
                r"which\s+\**product|what\s+\**product|"
                r"products?\s+should\s+(this|the)\s+proposal|"
                r"which\s+\**solution|interested\s+in\s+which",
                text,
            )
        )
    return False


def _ask_for_requirement_brd(
    *,
    who: str,
    deal_id: str | None = None,
) -> dict[str, Any]:
    slots: dict[str, Any] = {}
    if deal_id:
        slots["dealId"] = deal_id
    return {
        "ok": True,
        "assistantText": (
            f"To create a proposal for **{who}**, attach the **BRD** "
            "(PDF, Word, or text) with the paperclip, then press **Enter**. "
            "I'll use that document plus any meeting notes on this deal."
        ),
        "toolProposals": [],
        "sessionMemoryPatch": {
            "pendingIntent": "create_proposal",
            "pendingAsk": "requirement_pdf",
            "slots": slots,
        },
    }


def _awaiting_requirement_brd(messages: list[dict[str, Any]] | None) -> bool:
    if not messages:
        return False
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "") != "assistant":
            continue
        text = str(msg.get("text") or "").lower()
        return bool(
            re.search(
                r"attach the \**requirement pdf|requirement pdf \(brd\)|"
                r"attach the \**brd|pdf, word, or text|"
                r"paperclip below the chat|press \**enter|"
                r"with the paperclip",
                text,
            )
        )
    return False


def _ask_which_proposal_product(
    catalog: dict[str, Any] | None,
    *,
    customer: str | None = None,
    had_meetings: bool = False,
) -> dict[str, Any]:
    products = _product_rows(catalog)[:8]
    names = ", ".join(f"**{p.get('name')}**" for p in products) if products else ""
    who = customer or "this opportunity"
    meeting_note = (
        "I checked prior meetings/calls but couldn't tell which solution they want. "
        if had_meetings
        else ""
    )
    listing = f" Available products: {names}." if names else ""
    return {
        "ok": True,
        "assistantText": (
            f"{meeting_note}Before I create a proposal for **{who}**, which "
            f"**product or products** should it cover?{listing}"
        ),
        "toolProposals": [],
    }


def _proposal_create_result(
    *,
    deal_id: str,
    title: str | None,
    product_hint: str | None,
    products: list[dict[str, Any]],
    who: str,
) -> dict[str, Any]:
    product_ids = [str(p["id"]) for p in products if p.get("id")]
    hint = product_hint or (
        ", ".join(str(p.get("name")) for p in products) if products else None
    )
    scope = hint or "the agreed solution"
    return {
        "ok": True,
        "assistantText": (
            f"I'll create a **company proposal** for **{who}** covering "
            f"**{scope}** from your active template."
        ),
        "toolProposals": [
            propose_create_proposal_doc(
                deal_id=str(deal_id),
                title=title,
                auto=True,
                product_hint=hint,
                product_ids=product_ids or None,
            )
        ],
    }


def _resolve_proposal_products(
    text: str,
    topic: str | None,
    catalog: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], str | None, bool]:
    """Returns (matched_products, hint_used, had_meetings)."""
    meetings_blob = _meeting_text_blob(catalog)
    had_meetings = bool(meetings_blob.strip())

    hint = (topic or "").strip() or None
    if hint:
        matches = match_products_for_proposal(catalog, hint)
        if matches:
            return matches, hint, had_meetings

    # Match catalog product names mentioned anywhere in the utterance.
    matches = match_products_for_proposal(catalog, text, min_score=4.0)
    if matches:
        names = ", ".join(str(p.get("name")) for p in matches)
        # Prefer catalog hits over an unmatched free-text topic (e.g. "create a").
        return matches, names, had_meetings

    # Infer from prior meetings/calls/notes.
    if had_meetings:
        matches = match_products_for_proposal(catalog, meetings_blob, min_score=4.0)
        if matches:
            names = ", ".join(str(p.get("name")) for p in matches)
            return matches, names, had_meetings

    # Soft: keep hint even without catalog match so cover won't use wrong product.
    return [], hint, had_meetings


def _build_proposal_flow(
    *,
    text: str,
    catalog: dict[str, Any] | None,
    deal_id: str,
    customer: str | None,
    topic: str | None,
    title: str | None,
    requirement_pdf: str | None = None,
) -> dict[str, Any]:
    who = customer or "this customer"
    if not requirement_pdf:
        return _ask_for_requirement_brd(who=who, deal_id=deal_id)
    products, hint, _had_meetings = _resolve_proposal_products(text, topic, catalog)
    product_ids = [str(p["id"]) for p in products if p.get("id")]
    assistant = (
        f"I'll create the proposal for **{who}** using the attached "
        f"BRD (**{requirement_pdf}**) plus any meeting notes. "
        "Preferred products, capabilities, and prices come from that "
        "requirement and the product catalog."
    )
    scope_hint = hint or requirement_pdf
    return {
        "ok": True,
        "assistantText": assistant,
        "toolProposals": [
            propose_create_proposal_doc(
                deal_id=str(deal_id),
                title=title,
                auto=True,
                product_hint=scope_hint,
                product_ids=product_ids or None,
            )
        ],
        "sessionMemoryPatch": {
            "pendingIntent": "",
            "pendingAsk": "",
        },
    }


def _proposal_title(customer: str | None, topic: str | None) -> str | None:
    if topic and customer:
        return f"Proposal for {customer.title()} — {topic}"
    if topic:
        return topic[:200]
    if customer:
        return f"Proposal for {customer.title()}"
    return None


def _match_deals_for_proposal(
    catalog: dict[str, Any] | None, query: str
) -> list[dict[str, Any]]:
    """Substring + fuzzy (typo-tolerant) deal match for proposal create."""
    q = (query or "").strip()
    if not q or not catalog:
        return []
    ranked = rank_deals_by_name(catalog, q, min_score=0.72, limit=8)
    if not ranked:
        return []
    # Keep near-ties so the caller can ask which deal; drop clear losers.
    top = ranked[0][0]
    return [deal for score, deal in ranked if score >= top - 0.08]


def is_deals_list_intent(text: str) -> bool:
    lower = text.lower().strip()
    return bool(
        re.search(
            r"\b(show|back to|open)\s+(all\s+)?(deals?|pipeline|board|list)\b|"
            r"\b(deal|pipeline)\s+list\b|"
            r"\bclear\s+(the\s+)?(search|filter|filters)\b|"
            r"^\s*(list|pipeline|board|show\s+all)\s*$",
            lower,
        )
    )


def extract_open_query(text: str) -> str | None:
    m = (
        re.search(
            r"(?:open|show|view|find|go to)\s+(?:deal\s+)?(.+)$",
            text,
            re.I,
        )
        or re.search(r"^deal\s+(.+)$", text, re.I)
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(r"^(a|the|all|list|new|pipeline|board)$", q, re.I):
        return None
    if is_deals_list_intent(text):
        return None
    return q[:120]


def extract_edit_query(text: str) -> str | None:
    m = re.search(
        r"(?:edit|update|change|modify|rename)\s+"
        r"(?:the\s+)?(?:deal\s+)?(?:for\s+|named\s+|of\s+)?"
        r"(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(
        r"^(a|the|this|that|deal|deals?|it|them|title|amount|stage|"
        r"this\s+deal|the\s+deal|current\s+deal)$",
        q,
        re.I,
    ):
        return None
    if re.search(r"\bof\s+(?:this|the)\s+deal\b", q, re.I):
        return None
    return q[:120]


def extract_delete_query(text: str) -> str | None:
    m = re.search(
        r"(?:delete|remove|erase)\s+(?:the\s+)?(?:deal\s+)?(?:for\s+|named\s+|of\s+)?(.+)$",
        text,
        re.I,
    )
    if not m:
        return None
    q = m.group(1).strip().rstrip(".?!")
    if not q or re.match(
        r"^(a|the|this|that|deal|deals?|it|them|here|"
        r"this\s+deal|the\s+deal|current\s+deal)$",
        q,
        re.I,
    ):
        return None
    return q[:120]


def _looks_like_simple_yes(text: str) -> bool:
    return looks_like_affirmative(text)


def _awaiting_delete_confirm(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    return bool(
        re.search(r"want me to remove|permanently remove|ready to delete", last)
    )


def _awaiting_identity(messages: list[dict[str, Any]] | None) -> bool:
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(
            r"which deal|name or title|who (do you|should|would)|tell me which",
            last,
        )
    )


def _awaiting_proposal_deal_pick(messages: list[dict[str, Any]] | None) -> bool:
    """Last assistant asked which deal to attach a proposal to."""
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(
            r"which (one|deal)|proposals? attach to|"
            r"which deal should (this|the) proposal|"
            r"attach (this|the) proposal to",
            last,
        )
    )


def _awaiting_proposal_create(messages: list[dict[str, Any]] | None) -> bool:
    """Last assistant offered / started creating a proposal document."""
    last = _last_assistant(messages).lower()
    if not last:
        return False
    return bool(
        re.search(
            r"i('ll| will) create (a )?(customer |company )?proposal|"
            r"creating (the |a )?(customer |company )?proposal|"
            r"create a (customer |company )?proposal from|"
            r"proposal.*from your active template",
            last,
        )
    )


def _prior_user_text(messages: list[dict[str, Any]] | None) -> str | None:
    """Second-to-last user message when available (for product-reply turns)."""
    if not messages:
        return None
    users: list[str] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "") != "user":
            continue
        t = str(msg.get("text") or "").strip()
        if t:
            users.append(t)
    if len(users) >= 2:
        return users[-2]
    if users:
        return users[-1]
    return None


def resolve_deal_match(
    catalog: dict[str, Any] | None, query: str
) -> dict[str, Any] | None:
    q = (query or "").strip().lower()
    if not q:
        return None
    deals = (catalog or {}).get("deals") or []
    exact: list[dict[str, Any]] = []
    strong: list[dict[str, Any]] = []
    weak: list[dict[str, Any]] = []
    for raw in deals:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        title = str(raw.get("title") or "").strip().lower()
        company = str(raw.get("companyName") or "").strip().lower()
        contact = str(raw.get("contactName") or "").strip().lower()
        if title == q or company == q or contact == q:
            exact.append(raw)
        elif (
            title.startswith(q)
            or q.startswith(title)
            or (company and q in company)
            or (contact and q in contact)
        ):
            strong.append(raw)
        elif q in title or (company and company in q) or (contact and contact in q):
            weak.append(raw)
    for bucket in (exact, strong, weak):
        if len(bucket) == 1:
            return bucket[0]
    # Typo-tolerant fallback (monaj → Manoj)
    ranked = rank_deals_by_name(catalog, q, min_score=0.78, limit=3)
    if len(ranked) == 1:
        return ranked[0][1]
    if len(ranked) >= 2 and ranked[0][0] >= ranked[1][0] + 0.08:
        return ranked[0][1]
    return None


def parse_deal_field_update(text: str) -> dict[str, Any] | None:
    stripped = (text or "").strip()
    if not stripped:
        return None
    # Don't treat "create proposal" / document asks as a pipeline stage.
    if _wants_create_proposal(stripped.lower()):
        return None
    patch: dict[str, Any] = {}
    title_m = re.search(
        r"(?:set\s+)?(?:the\s+)?(?:deal\s+)?title\s*(?:as|to|:|=)\s*(.+)$",
        stripped,
        re.I,
    )
    if title_m:
        patch["title"] = trim_at_next_field(
            title_m.group(1).strip().rstrip(".!")
        )[:200]
    amount = parse_money_amount(stripped)
    if amount:
        patch["amount"] = amount
    notes_m = re.search(
        r"(?:set\s+)?(?:the\s+)?notes?\s*(?:as|to|:|=)\s*(.+)$",
        stripped,
        re.I,
    )
    if notes_m:
        patch["notes"] = trim_at_next_field(notes_m.group(1).strip())[:4000]
    # Stage only when the user clearly asks to move/set stage — not bare "proposal".
    stage_m = re.search(
        r"(?:(?:move|change|set|update|advance|push)\s+"
        r"(?:(?:the\s+)?(?:deal\s+)?(?:to\s+)?(?:stage\s+(?:to\s+|as\s+)?)?)?|"
        r"stage\s*(?:to|as|=|:)\s*)"
        r"(qualification|discover(?:y)?|propos(?:e|al)|negotiat(?:e|ion)|"
        r"closed\s*won|won|closed\s*lost|lost)\b",
        stripped,
        re.I,
    )
    if stage_m:
        from app.agents.deal_draft_agent import normalize_deal_stage

        resolved = normalize_deal_stage(stage_m.group(1))
        if resolved:
            patch["stage"] = resolved
    return patch or None


def _stage_change_tool(deal_id: str, stage: str) -> dict[str, Any]:
    """Chat-requested stage move — auto-apply in chat (no Confirm button)."""
    return {
        "id": "stage-change",
        "name": "propose_stage_change",
        "label": f"Move to {stage}",
        "args": {
            "dealId": str(deal_id),
            "stage": stage,
            "auto": True,
        },
        "risk": "low",
    }


def _open_deal_result(deal: dict[str, Any], *, query: str) -> dict[str, Any]:
    name = str(deal.get("title") or query).strip() or query
    return {
        "ok": True,
        "assistantText": (
            f"Opening **{name}** — tell me what to change (title, amount, stage, …)."
        ),
        "toolProposals": [
            {
                "id": "ws-detail",
                "name": "set_workspace",
                "label": f"Open {name}",
                "args": {
                    "mode": "detail",
                    "entityId": str(deal["id"]),
                    "auto": True,
                },
                "risk": "low",
            }
        ],
    }


def _find_or_search_deal(query: str, catalog: dict[str, Any] | None) -> dict[str, Any]:
    match = resolve_deal_match(catalog, query)
    if match:
        return _open_deal_result(match, query=query)
    q = query.strip()[:120]
    return {
        "ok": True,
        "assistantText": (
            f"I couldn't uniquely match **{q}** — I've filtered the board. "
            "Say the full deal title and I'll open it."
        ),
        "toolProposals": [
            {
                "id": "ws-search",
                "name": "set_workspace",
                "label": "Search deals",
                "args": {"mode": "list", "search": q, "auto": True},
                "risk": "low",
            }
        ],
    }


def _ask_which_deal() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which deal should we open? Share a title or company name."
        ),
    }


def _ask_which_deal_to_delete() -> dict[str, Any]:
    return {
        "ok": True,
        "assistantText": (
            "Which deal would you like to delete? Share a title or company name."
        ),
    }


def deals_heuristic(
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
    requirement_pdf = _requirement_pdf_name(ctx)

    if is_deals_list_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "Alright — showing the full pipeline again."
                if surface == "list"
                else "Alright — back to the pipeline."
            ),
            "toolProposals": [
                {
                    "id": "ws-list",
                    "name": "set_workspace",
                    "label": "Show pipeline",
                    "args": {"mode": "list", "auto": True, "search": ""},
                    "risk": "low",
                }
            ],
        }

    if _awaiting_delete_confirm(messages) and looks_like_decline(text):
        display = ""
        for d in (catalog or {}).get("deals") or []:
            if isinstance(d, dict) and str(d.get("id")) == str(entity_id):
                display = str(d.get("title") or "")
                break
        who = f"**{display}**" if display else "that deal"
        return {
            "ok": True,
            "assistantText": f"No problem — I won't delete {who}. Anything else you need?",
        }

    if _awaiting_delete_confirm(messages) and (
        _looks_like_simple_yes(text) or _wants_delete(lower)
    ):
        if entity_id:
            display = ""
            for d in (catalog or {}).get("deals") or []:
                if isinstance(d, dict) and str(d.get("id")) == str(entity_id):
                    display = str(d.get("title") or "")
                    break
            return {
                "ok": True,
                "assistantText": f"Removing **{display or 'this deal'}** now.",
                "toolProposals": [
                    propose_delete_deal_proposal(
                        deal_id=str(entity_id),
                        display_name=display,
                        auto=True,
                    )
                ],
            }
        return {
            "ok": True,
            "assistantText": "I still need to know which deal to delete.",
        }

    # Affirmation while proposal create is already promised — do NOT open quotes
    # or start a second create path (common when generation is still running).
    if _awaiting_proposal_create(messages) and _looks_like_simple_yes(text):
        return {
            "ok": True,
            "assistantText": (
                "Already on it — finishing the proposal from your template. "
                "I'll open it as soon as it's ready."
            ),
        }

    # User named a deal after we asked which one for the proposal.
    if _awaiting_proposal_deal_pick(messages) and not _wants_delete(lower):
        q = text.strip()[:160]
        if q and not _looks_like_simple_yes(text):
            hits = _match_deals_for_proposal(catalog, q)
            match = hits[0] if len(hits) == 1 else resolve_deal_match(catalog, q)
            if match and match.get("id"):
                customer = (
                    extract_proposal_customer(_prior_user_text(messages) or "")
                    or str(match.get("contactName") or None)
                    or None
                )
                topic = extract_proposal_topic(text)
                return _build_proposal_flow(
                    text=text,
                    catalog=catalog,
                    deal_id=str(match["id"]),
                    customer=customer,
                    topic=topic,
                    title=_proposal_title(customer, topic),
                )
            if len(hits) > 1:
                names = ", ".join(
                    f"**{d.get('title') or 'Untitled deal'}**" for d in hits[:5]
                )
                return {
                    "ok": True,
                    "assistantText": (
                        f"A few deals match — {names}. Which of those should "
                        "I use?"
                    ),
                }
            return {
                "ok": True,
                "assistantText": (
                    "I couldn't match that to a deal on the board. Which deal "
                    "should I attach this to?"
                ),
            }

    # User answering after we asked for the requirement BRD.
    if _awaiting_requirement_brd(messages):
        prior = _prior_user_text(messages) or text
        customer = extract_proposal_customer(prior)
        topic = extract_proposal_topic(prior)
        title = _proposal_title(customer, topic)
        deal_id = str(entity_id) if surface == "detail" and entity_id else ""
        if not deal_id:
            stm = (ctx.get("sessionMemory") if isinstance(ctx, dict) else None) or {}
            if isinstance(stm, dict):
                slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
                if slots.get("dealId"):
                    deal_id = str(slots["dealId"])
        if deal_id:
            return _build_proposal_flow(
                text=text,
                catalog=catalog,
                deal_id=deal_id,
                customer=customer,
                topic=topic,
                title=title,
                requirement_pdf=requirement_pdf,
            )

    # User answering “which product?” after a proposal create ask.
    if _awaiting_proposal_product(messages):
        prior = _prior_user_text(messages) or text
        customer = extract_proposal_customer(prior)
        if requirement_pdf and _defers_products_to_requirement_pdf(text):
            topic = extract_proposal_topic(prior)
        else:
            topic = extract_proposal_topic(text) or text.strip()[:160]
        title = _proposal_title(customer, topic)
        deal_id = str(entity_id) if surface == "detail" and entity_id else ""
        # Sticky deal from short-term session memory (bare create proposal → products)
        if not deal_id:
            stm = (ctx.get("sessionMemory") if isinstance(ctx, dict) else None) or {}
            if isinstance(stm, dict):
                slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
                if slots.get("dealId"):
                    deal_id = str(slots["dealId"])
                if not customer and slots.get("contactName"):
                    customer = str(slots["contactName"])
        if not deal_id:
            catalog_deals = [
                d
                for d in ((catalog or {}).get("deals") or [])
                if isinstance(d, dict) and d.get("id")
            ]
            if len(catalog_deals) == 1:
                deal_id = str(catalog_deals[0]["id"])
                if not customer:
                    customer = str(
                        catalog_deals[0].get("contactName")
                        or catalog_deals[0].get("title")
                        or ""
                    ) or None
        if not deal_id:
            # "create proposal for Manoj" intentionally yields customer=None
            # (product phrasing). Still resolve the deal from that prior utterance.
            hits = _match_deals_for_proposal(catalog, customer or prior)
            if len(hits) == 1:
                deal_id = str(hits[0]["id"])
                if not customer:
                    customer = str(
                        hits[0].get("contactName")
                        or hits[0].get("title")
                        or ""
                    ) or None
        if not deal_id:
            catalog_deals = [
                d
                for d in ((catalog or {}).get("deals") or [])
                if isinstance(d, dict) and d.get("id")
            ]
            if catalog_deals:
                names = ", ".join(
                    f"**{d.get('title') or 'Untitled deal'}**"
                    for d in catalog_deals[:5]
                )
                return {
                    "ok": True,
                    "assistantText": f"Got it. Which deal is this for — {names}?",
                }
            return {
                "ok": True,
                "assistantText": (
                    "Got it. Which **deal** should this proposal attach to?"
                ),
            }
        return _build_proposal_flow(
            text=text,
            catalog=catalog,
            deal_id=deal_id,
            customer=customer,
            topic=topic,
            title=title,
            requirement_pdf=requirement_pdf,
        )

    if _awaiting_identity(messages) and not _wants_create(lower):
        q = text.strip()[:120]
        if q and not _wants_delete(lower):
            if "delete" in (_last_assistant(messages).lower()):
                match = resolve_deal_match(catalog, q)
                if match:
                    name = str(match.get("title") or q)
                    return {
                        "ok": True,
                        "assistantText": (
                            f"I found **{name}**. Want me to remove it permanently?"
                        ),
                        "toolProposals": [
                            {
                                "id": "ws-detail-delete",
                                "name": "set_workspace",
                                "label": f"Open {name}",
                                "args": {
                                    "mode": "detail",
                                    "entityId": str(match["id"]),
                                    "auto": True,
                                },
                                "risk": "low",
                            }
                        ],
                    }
                return _find_or_search_deal(q, catalog)
            return _find_or_search_deal(q, catalog)

    if has_compound_delete_intent(text):
        return {
            "ok": True,
            "assistantText": (
                "That sounds like more than one request — should I update this "
                "deal, delete it, or create a new one? Let's do one at a time."
            ),
        }

    if _wants_delete(lower):
        q = extract_delete_query(text)
        if open_in_memory and entity_id:
            if q:
                match = resolve_deal_match(catalog, q)
                if match and str(match.get("id")) != str(entity_id):
                    name = str(match.get("title") or q)
                    return {
                        "ok": True,
                        "assistantText": (
                            f"I found **{name}**. Want me to remove it permanently?"
                        ),
                        "toolProposals": [
                            {
                                "id": "ws-detail-delete",
                                "name": "set_workspace",
                                "label": f"Open {name}",
                                "args": {
                                    "mode": "detail",
                                    "entityId": str(match["id"]),
                                    "auto": True,
                                },
                                "risk": "low",
                            }
                        ],
                    }
            display = display_from_catalog(
                catalog,
                entity_id,
                list_key="deals",
                name_keys=("title", "name"),
            )
            return {
                "ok": True,
                "assistantText": f"Removing **{display or 'this deal'}** now.",
                "toolProposals": [
                    propose_delete_deal_proposal(
                        deal_id=str(entity_id),
                        display_name=display,
                        auto=True,
                    )
                ],
            }
        if q:
            match = resolve_deal_match(catalog, q)
            if match:
                name = str(match.get("title") or q)
                return {
                    "ok": True,
                    "assistantText": (
                        f"I found **{name}**. Want me to remove it permanently?"
                    ),
                    "toolProposals": [
                        {
                            "id": "ws-detail-delete",
                            "name": "set_workspace",
                            "label": f"Open {name}",
                            "args": {
                                "mode": "detail",
                                "entityId": str(match["id"]),
                                "auto": True,
                            },
                            "risk": "low",
                        }
                    ],
                }
            return _find_or_search_deal(q, catalog)
        return _ask_which_deal_to_delete()

    if surface == "detail" and entity_id:
        # Proposal *document* before stage heuristics (bare “proposal” ≠ stage).
        # Attached requirement file + "generate" / "use the pdf" also creates.
        if _wants_create_proposal(lower) or (
            requirement_pdf and _defers_products_to_requirement_pdf(text)
        ):
            customer = extract_proposal_customer(text)
            topic = extract_proposal_topic(text)
            title = _proposal_title(customer, topic)
            return _build_proposal_flow(
                text=text,
                catalog=catalog,
                deal_id=str(entity_id),
                customer=customer,
                topic=topic,
                title=title,
                requirement_pdf=requirement_pdf,
            )

        field_patch = parse_deal_field_update(text)
        if field_patch:
            if "stage" in field_patch and len(field_patch) == 1:
                return {
                    "ok": True,
                    "assistantText": (
                        f"Moving the deal to **{field_patch['stage'].replace('_', ' ')}**."
                    ),
                    "toolProposals": [
                        _stage_change_tool(str(entity_id), field_patch["stage"])
                    ],
                }
            bits = []
            if "title" in field_patch:
                bits.append(f"title to **{field_patch['title']}**")
            if "amount" in field_patch:
                bits.append(f"amount to **{field_patch['amount']}**")
            if "notes" in field_patch:
                bits.append("notes")
            if "stage" in field_patch:
                bits.append(f"stage to **{field_patch['stage']}**")
            what = ", ".join(bits) if bits else "those details"
            tools: list[dict[str, Any]] = [
                propose_update_deal_proposal(
                    deal_id=str(entity_id),
                    patch={k: v for k, v in field_patch.items() if k != "stage"},
                    auto=True,
                )
            ]
            if "stage" in field_patch:
                tools.append(
                    _stage_change_tool(str(entity_id), field_patch["stage"])
                )
            # Drop empty update if only stage
            tools = [
                t
                for t in tools
                if t.get("name") != "propose_update_deal"
                or any(k not in ("dealId", "auto") for k in (t.get("args") or {}))
            ]
            return {
                "ok": True,
                "assistantText": f"Sure — I'll update the {what} now.",
                "toolProposals": tools,
            }
        if _wants_edit(lower) and not extract_edit_query(text):
            return {
                "ok": True,
                "assistantText": (
                    "What should we change — title, amount, stage, or notes?"
                ),
            }

    if _wants_edit(lower):
        if entity_id and surface == "detail" and not extract_edit_query(text):
            return {
                "ok": True,
                "assistantText": (
                    "What should we change — title, amount, stage, or notes?"
                ),
            }
        q = extract_edit_query(text)
        if q:
            return _find_or_search_deal(q, catalog)
        return _ask_which_deal()

    if _wants_create_proposal(lower) or (
        requirement_pdf and _defers_products_to_requirement_pdf(text)
    ):
        customer = extract_proposal_customer(text)
        topic = extract_proposal_topic(text)
        title = _proposal_title(customer, topic)

        # Already on a deal → create the proposal document there
        if surface == "detail" and entity_id:
            return _build_proposal_flow(
                text=text,
                catalog=catalog,
                deal_id=str(entity_id),
                customer=customer,
                topic=topic,
                title=title,
                requirement_pdf=requirement_pdf,
            )

        hits: list[dict[str, Any]] = []
        if customer:
            hits = _match_deals_for_proposal(catalog, customer)
        if not hits and topic:
            hits = _match_deals_for_proposal(catalog, topic)

        if len(hits) == 1:
            deal = hits[0]
            return _build_proposal_flow(
                text=text,
                catalog=catalog,
                deal_id=str(deal["id"]),
                customer=customer or str(deal.get("contactName") or None),
                topic=topic,
                title=title,
                requirement_pdf=requirement_pdf,
            )

        if len(hits) > 1:
            names = ", ".join(
                f"**{d.get('title') or 'Untitled deal'}**" for d in hits[:5]
            )
            return {
                "ok": True,
                "assistantText": (
                    f"A few deals could fit — {names}. Which should I attach "
                    "this proposal to?"
                ),
            }

        # Bare "create proposal" (no customer) — use the only deal, or ask which.
        catalog_deals = [
            d
            for d in ((catalog or {}).get("deals") or [])
            if isinstance(d, dict) and d.get("id")
        ]
        if not hits and catalog_deals:
            if len(catalog_deals) == 1:
                deal = catalog_deals[0]
                return _build_proposal_flow(
                    text=text,
                    catalog=catalog,
                    deal_id=str(deal["id"]),
                    customer=customer
                    or str(deal.get("contactName") or None)
                    or None,
                    topic=topic,
                    title=title,
                    requirement_pdf=requirement_pdf,
                )
            names = ", ".join(
                f"**{d.get('title') or 'Untitled deal'}**"
                for d in catalog_deals[:5]
            )
            more = (
                f" (+{len(catalog_deals) - 5} more)"
                if len(catalog_deals) > 5
                else ""
            )
            return {
                "ok": True,
                "assistantText": (
                    f"Sure — which deal is this for? {names}{more}."
                ),
            }

        # Already on deal create (seed / continue) — keep filling the deal;
        # after save the UI continues into the proposal automatically.
        if surface == "create":
            return {
                "ok": True,
                "assistantText": (
                    "I'll finish this deal with you first, then create the "
                    "proposal right after. What's the company or contact?"
                ),
            }

        # No deal in catalog — open deal create and continue into proposal.
        create_args: dict[str, Any] = {
            "mode": "create",
            "auto": True,
            "afterCreate": "proposal",
        }
        rich_seed = bool(
            customer
            or (
                topic
                and not re.match(
                    r"^(this|that)(\s+\w+)?$", topic or "", re.I
                )
            )
        )
        if rich_seed:
            create_args["seedPrompt"] = text.strip()[:2000]
        who = customer or topic
        if who and re.match(
            r"^(this|that)(\s+(customer|client|contact|opportunity|deal))?$",
            who,
            re.I,
        ):
            who = None
        lead = (
            f"I don't have a deal for **{who}** yet — "
            if who
            else "There's no deal on the board yet — "
        )
        return {
            "ok": True,
            "assistantText": (
                f"{lead}I'll create one with you, then write the proposal "
                "from your template. Who's the customer or company?"
            ),
            "toolProposals": [
                {
                    "id": "ws-create-for-prop",
                    "name": "set_workspace",
                    "label": "Create deal",
                    "args": create_args,
                    "risk": "low",
                }
            ],
        }

    deal_create = (
        _wants_create(lower)
        and not _wants_create_proposal(lower)
        and (
            bool(re.search(r"\b(deal|opportunit|pipeline)\b", lower))
            or not bool(
                re.search(
                    r"\b(contact|compan|product|invoice|quot(?:e|ation)|activit|"
                    r"propos|schedul|meeting|appointment|calendar|demo|"
                    r"call|task|note)\b",
                    lower,
                )
            )
        )
    )
    if deal_create:
        if surface == "create":
            return None
        return open_in_shell_create(
            text,
            label="Create deal",
            first_question="Happy to. What should we call this deal?",
        )

    open_q = extract_open_query(text)
    if open_q:
        return _find_or_search_deal(open_q, catalog)

    if _is_help_question(lower) or re.search(r"^\s*help\b", lower):
        return {
            "ok": True,
            "assistantText": (
                "I can create a deal, create a **proposal** or send you to "
                "**quotes** / **schedule** a meeting, open a deal from the board, "
                "move stages, or update title and amount — just tell me what you need."
            ),
        }

    return None


def _deal_by_id(catalog: dict[str, Any] | None, deal_id: str) -> dict[str, Any] | None:
    deals = (catalog or {}).get("deals") if isinstance((catalog or {}).get("deals"), list) else []
    for raw in deals or []:
        if isinstance(raw, dict) and str(raw.get("id") or "") == deal_id:
            return raw
    return None


def _result_from_llm_intent(
    classified: dict[str, Any] | None,
    *,
    text: str,
    ctx: dict[str, Any],
    catalog: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Map structured LLM intent → deterministic tool proposals (no free-form tools)."""
    if not classified or float(classified.get("confidence") or 0) < 0.55:
        return None
    intent = str(classified.get("intent") or "other")
    deal_id = classified.get("dealId")
    deal = _deal_by_id(catalog, str(deal_id)) if deal_id else None
    customer = classified.get("customerHint")
    topic = classified.get("topic")
    surface = str(ctx.get("surface") or "")
    entity_id = open_entity_id(ctx) or ctx.get("entityId")

    if intent == "create_proposal":
        title = _proposal_title(
            str(customer) if customer else None,
            str(topic) if topic else None,
        )
        target_id = (
            str(deal["id"])
            if deal
            else (str(entity_id) if surface == "detail" and entity_id else "")
        )
        if target_id:
            return _build_proposal_flow(
                text=text,
                catalog=catalog,
                deal_id=target_id,
                customer=str(customer) if customer else None,
                topic=str(topic) if topic else None,
                title=title,
                requirement_pdf=_requirement_pdf_name(ctx),
            )
        if customer:
            hits = _match_deals_for_proposal(catalog, str(customer))
            if len(hits) == 1:
                d = hits[0]
                return _build_proposal_flow(
                    text=text,
                    catalog=catalog,
                    deal_id=str(d["id"]),
                    customer=str(customer),
                    topic=str(topic) if topic else None,
                    title=title,
                    requirement_pdf=_requirement_pdf_name(ctx),
                )
        label = customer or topic
        if label and re.match(
            r"^(this|that)(\s+(customer|client|contact|opportunity|deal))?$",
            str(label),
            re.I,
        ):
            label = None
        lead = (
            f"I don't have a deal for **{label}** yet — "
            if label
            else "There's no deal on the board yet — "
        )
        return {
            "ok": True,
            "assistantText": (
                f"{lead}I'll create one with you, then write the proposal. "
                "Who's the customer or company?"
            ),
            "toolProposals": [
                {
                    "id": "ws-create-for-prop-llm",
                    "name": "set_workspace",
                    "label": "Create deal",
                    "args": {
                        "mode": "create",
                        "seedPrompt": text.strip()[:2000],
                        "auto": True,
                        "afterCreate": "proposal",
                    },
                    "risk": "low",
                }
            ],
        }

    if intent == "create_deal":
        if surface == "create":
            return None
        return {
            "ok": True,
            "assistantText": "Sure — I'll open deal create.",
            "toolProposals": [
                {
                    "id": "ws-create-llm",
                    "name": "set_workspace",
                    "label": "Create deal",
                    "args": {
                        "mode": "create",
                        "seedPrompt": text.strip()[:2000],
                        "auto": True,
                    },
                    "risk": "low",
                }
            ],
        }

    if intent == "create_quote":
        return {
            "ok": True,
            "assistantText": "I'll take you to **create quote**.",
            "toolProposals": [
                {
                    "id": "nav-quote-llm",
                    "name": "navigate",
                    "label": "Create quote",
                    "args": {"href": "/sales/quotes/new", "auto": True},
                    "risk": "low",
                }
            ],
        }

    if intent == "schedule":
        return {
            "ok": True,
            "assistantText": "I'll open the activity log so we can schedule that.",
            "toolProposals": [
                {
                    "id": "nav-act-llm",
                    "name": "navigate",
                    "label": "Log activity",
                    "args": {"href": "/activities/log", "auto": True},
                    "risk": "low",
                }
            ],
        }

    if intent == "open_deal":
        if deal:
            return _open_deal_result(deal, query=str(customer or deal.get("title") or ""))
        if customer:
            return _find_or_search_deal(str(customer), catalog)
        return None

    return None


async def handle(state: DealCoworkerState) -> DealCoworkerState:
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

    native = await run_native_agent_turn(
        mod="sales",
        surface=str(ctx.get("surface") or "list"),
        messages=messages,
        context=ctx,
        catalog=catalog,
        user_text=text,
    )
    if should_commit_native_turn(native, user_text=text):
        return {**state, "result": {**native, "source": "ai"}}

    if is_ai_configured():
        # The native agent owns list/detail/create actions.
        return {
            **state,
            "result": {"ok": True, "assistantText": "", "_unhandled": True},
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
    out = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
            "organization_id": organization_id or "",
        }
    )
    return out.get("result") or {"ok": False, "error": "No result."}
