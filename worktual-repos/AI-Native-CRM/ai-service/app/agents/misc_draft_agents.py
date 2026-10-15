"""Product / invoice / activity / quote draft agents."""

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
    rank_deals_by_name,
    rank_products_by_name,
    result_leaves_current_page,
    run_chat_json,
    str_fields,
)
from app.agents.draft_conversation import (
    TONE_RULES,
    activity_draft_ready,
    invoice_draft_ready,
    looks_like_create_confirm,
    merge_draft,
    next_product_prompt,
    product_draft_ready,
    propose_create_activity_proposal,
    propose_create_invoice_proposal,
    propose_create_product_proposal,
    propose_create_quote_proposal,
    quote_draft_ready,
    utterance_is_one_shot_create,
)

PRODUCT_SYSTEM = f"""Fill a CRM product draft conversationally. JSON only: {{"assistantText":"…","patch":{{…}},"navigate":{{"href":"/contact/new","seedPrompt":"optional"}}}}
Keys always: name, sku, description, price, currency, status, category, subcategory, productUrl.
Quote-motion (B2B / B2B2C) also: productType (fixed|customizable), billingType (one_time|recurring),
billingFrequency (monthly|quarterly|annual — only when billingType=recurring), maxDiscountPercent,
offers/addons when customizable.
Commerce-motion (B2C / B2B2C) also: brand, stockOnHand.
On B2B never ask or patch brand or stockOnHand.
On B2C never ask or patch productType, billing, maxDiscount, offers, or addons.
Ask one next field at a time. Follow the productWalk in the turn context for this org.
Never ask "per seat / per usage" — those are not product fields. Billing is only one_time or recurring.
When the user says recurring/subscription or monthly/quarterly/annual, set billingType and billingFrequency together.
If they pause this product to create a contact, company, or deal instead, empty patch and navigate to that create href with seedPrompt.
CRITICAL: Do NOT ask "ready to save?" / "shall I save?" while any guided field is still open.
Keep asking the next missing field (or accept skip). Name+SKU is enough for the user to *request*
save themselves — only then confirm. Never solicit save after price alone or mid-walk.

{TONE_RULES}"""

INVOICE_SYSTEM = f"""Fill a CRM invoice draft header conversationally. JSON only: {{"assistantText":"…","patch":{{…}}}}
Keys: dealId (from catalog), currency, notes, paymentTerms.
Ask for the deal first if missing. When dealId is set, briefly recap then ask to save — do NOT ask for currency, notes, or payment terms unless the user volunteered them.
Do not create/save. Never invent deal ids.

{TONE_RULES}"""

ACTIVITY_SYSTEM = f"""Fill a CRM activity log draft conversationally. JSON only: {{"assistantText":"…","patch":{{…}}}}
Keys: contactId (from catalog), type (call|meeting|email|task|sms|note), subject, body, dueAt (ISO date optional).
Walk order (one question at a time): contact → type → subject → due date → notes.
When currentDraft already has contactId (and contactName), or Context lists openContact / openDeal.contactId, that person is chosen — never say they are not in CRM and never ask to create them. Continue the walk or save.
Never default type to note. Never patch type until the user names one (or skips).
"Schedule a demo/meeting/call for <name>" or for this deal: use openDeal.contactId or match knownContacts / lookup_contacts. Set type to meeting for a demo or meeting, and call for a call. Only when no contact is chosen yet and lookup returns nobody, say you could not find them and ask whether to create a contact — do not invent a contactId.
Never invent contact ids. Do not create/save until contact + subject are filled.

{TONE_RULES}"""

QUOTE_SYSTEM = f"""Fill a CRM quote draft conversationally. JSON only: {{"assistantText":"…","patch":{{…}}}}
Keys: dealId, discountPct, productId, quantity.
Ids must come from catalog for the patch only — never put IDs in assistantText. Refer to deals/products by title/name.
Ask one next question. When ready, briefly recap then ask to save. Do not create/save.

{TONE_RULES}"""

ACTIVITY_TYPES = ("note", "call", "email", "sms", "task", "meeting")


def _llm_speech(ai: dict[str, Any] | None) -> str:
    from app.agents.coworker_shared import is_generic_coworker_speech

    if not ai:
        return ""
    speech = str(ai.get("assistantText") or "").strip()
    if not speech or is_generic_coworker_speech(speech):
        return ""
    return speech


class MiscDraftState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    kind: str
    result: dict[str, Any]


def product_heuristic(
    text: str, draft: dict[str, Any] | None = None
) -> dict[str, Any]:
    current = draft if isinstance(draft, dict) else {}
    if looks_like_create_confirm(text) and product_draft_ready(current):
        return {
            "ok": True,
            "toolProposals": [
                propose_create_product_proposal(
                    proposal_id="create-product-confirm",
                    auto=True,
                )
            ],
        }
    if looks_like_create_confirm(text):
        return {"ok": True}
    patch: dict[str, Any] = {}
    named = re.search(
        r"(?:add|create|new)\s+product\s+([A-Za-z0-9&.' -]{2,80})",
        text,
        re.I,
    )
    if named:
        patch["name"] = named.group(1).strip()
    elif not current.get("name") and re.match(
        r"^[A-Za-z0-9&.' -]{2,80}$", text.strip()
    ):
        patch["name"] = text.strip()
    price = re.search(r"\$\s*([\d,]+(?:\.\d+)?)|\bprice\s*[:=]?\s*([\d.]+)", text, re.I)
    if price:
        patch["price"] = (price.group(1) or price.group(2) or "").replace(",", "")
    sku = re.search(
        r"\bsku\s*(?:is|:|=)\s*([A-Za-z0-9][A-Za-z0-9_-]*)", text, re.I
    )
    if sku:
        patch["sku"] = sku.group(1)
    bare = text.strip()
    if (
        current.get("name")
        and not current.get("price")
        and not patch.get("price")
        and re.match(r"^\$?\s*[\d,]+(?:\.\d{1,2})?\s*$", bare)
    ):
        patch["price"] = bare.replace("$", "").replace(",", "").strip()
    if (
        current.get("name")
        and not current.get("sku")
        and not patch.get("sku")
        and re.match(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$", bare)
        and re.search(r"[\d_-]", bare)
        and not patch.get("price")
    ):
        patch["sku"] = bare
    brand = re.search(
        r"\bbrand\s*(?:is|:|=)?\s*([A-Za-z0-9&.' -]{2,60})", text, re.I
    )
    if brand:
        patch["brand"] = brand.group(1).strip()
    cat = re.search(
        r"\bcategor(?:y|ies)\s*(?:is|:|=)?\s*([A-Za-z0-9&./ -]{2,60})",
        text,
        re.I,
    )
    if cat:
        patch["category"] = cat.group(1).strip()
    if re.search(r"\bcustomizable\b", text, re.I):
        patch["productType"] = "customizable"
    elif re.search(r"\b(fixed(?:\s+price)?|standard)\b", text, re.I):
        patch["productType"] = "fixed"
    if re.search(r"\b(recurring|subscription)\b", text, re.I):
        patch["billingType"] = "recurring"
    elif re.search(r"\b(one[-\s]?time|once)\b", text, re.I):
        patch["billingType"] = "one_time"
    # "per seat / per usage" is not a CRM billingType — ignore as a billing answer.
    if re.search(r"\b(monthly|per\s+month|/mo)\b", text, re.I) and not re.search(
        r"\bper\s+seat\b", text, re.I
    ):
        patch["billingType"] = "recurring"
        patch["billingFrequency"] = "monthly"
    elif re.search(r"\b(quarterly|per\s+quarter)\b", text, re.I):
        patch["billingType"] = "recurring"
        patch["billingFrequency"] = "quarterly"
    elif re.search(r"\b(annual|annually|yearly|per\s+year|/yr)\b", text, re.I):
        patch["billingType"] = "recurring"
        patch["billingFrequency"] = "annual"
    cur = re.search(
        r"\b(USD|EUR|GBP|INR|AED)\b",
        text,
        re.I,
    )
    if cur:
        patch["currency"] = cur.group(1).upper()
    else:
        from app.agents.draft_conversation import parse_product_currency

        mapped = parse_product_currency(text)
        if mapped:
            patch["currency"] = mapped
    clean = {k: v for k, v in patch.items() if v}
    merged = merge_draft(current, clean or None)
    if (
        clean
        and product_draft_ready(merged)
        and not product_draft_ready(current)
        and utterance_is_one_shot_create(text)
    ):
        return {
            "ok": True,
            "patch": clean,
            "toolProposals": [
                propose_create_product_proposal(
                    proposal_id="create-product-oneshot",
                    auto=True,
                )
            ],
        }
    return {
        "ok": True,
        **({"patch": clean} if clean else {}),
    }


def _maybe_oneshot_create(
    *,
    text: str,
    draft: dict[str, Any],
    merged: dict[str, Any],
    ready_fn,
    proposal_fn,
    proposal_id: str,
    patch: dict[str, Any] | None,
    entity_label: str,
) -> dict[str, Any] | None:
    if (
        patch
        and ready_fn(merged)
        and not ready_fn(draft)
        and utterance_is_one_shot_create(text)
    ):
        return {
            "ok": True,
            "patch": patch,
            "toolProposals": [
                proposal_fn(proposal_id=f"{proposal_id}-oneshot", auto=True)
            ],
        }
    return None


def invoice_heuristic(
    text: str,
    deals: list[dict[str, Any]],
    draft: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current = draft if isinstance(draft, dict) else {}
    if looks_like_create_confirm(text) and invoice_draft_ready(current):
        return {
            "ok": True,
            "toolProposals": [
                propose_create_invoice_proposal(
                    proposal_id="create-invoice-confirm",
                    auto=True,
                )
            ],
        }
    if looks_like_create_confirm(text):
        return {"ok": True}
    patch: dict[str, Any] = {}
    lower = text.lower()
    # Prefer exact title substring, then fuzzy title/company/contact match.
    deal = next((d for d in deals if d.get("title") and d["title"].lower() in lower), None)
    if not deal:
        ranked = rank_deals_by_name({"deals": deals}, text, min_score=0.78, limit=2)
        if len(ranked) == 1 or (
            len(ranked) >= 2 and ranked[0][0] >= ranked[1][0] + 0.08
        ):
            deal = ranked[0][1]
    if deal:
        patch["dealId"] = deal["id"]
    if re.search(r"\beur\b", text, re.I):
        patch["currency"] = "EUR"
    elif re.search(r"\bgbp\b", text, re.I):
        patch["currency"] = "GBP"
    elif re.search(r"\busd\b", text, re.I):
        patch["currency"] = "USD"
    terms = re.search(r"\bnet\s*[- ]?\s*(\d+)\b", text, re.I)
    if terms:
        patch["paymentTerms"] = f"Net {terms.group(1)}"
    elif re.search(r"\bdue\s+on\s+receipt\b|\bimmediate\b", text, re.I):
        patch["paymentTerms"] = "Due on receipt"
    clean = patch or None
    merged = merge_draft(current, clean)
    oneshot = _maybe_oneshot_create(
        text=text,
        draft=current,
        merged=merged,
        ready_fn=invoice_draft_ready,
        proposal_fn=propose_create_invoice_proposal,
        proposal_id="create-invoice",
        patch=clean,
        entity_label="invoice",
    )
    if oneshot:
        return oneshot
    return {
        "ok": True,
        **({"patch": clean} if clean else {}),
    }


def activity_heuristic(
    text: str,
    contacts: list[dict[str, Any]],
    draft: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.agents.draft_conversation import (
        is_product_skip_intent,
        parse_activity_type,
    )

    current = draft if isinstance(draft, dict) else {}
    if looks_like_create_confirm(text) and activity_draft_ready(current):
        return {
            "ok": True,
            "toolProposals": [
                propose_create_activity_proposal(
                    proposal_id="create-activity-confirm",
                    auto=True,
                )
            ],
        }
    if looks_like_create_confirm(text):
        return {"ok": True}
    patch: dict[str, Any] = {}
    mapped_type = parse_activity_type(text)
    if mapped_type:
        patch["type"] = mapped_type
    lower = text.lower()
    ranked = sorted(
        (
            {
                "c": c,
                "i": lower.find(str(c.get("displayName") or "").lower()),
                "len": len(str(c.get("displayName") or "")),
            }
            for c in contacts
            if c.get("displayName")
        ),
        key=lambda x: -x["len"],
    )
    contact = next((r["c"] for r in ranked if r["i"] >= 0 and r["len"] >= 2), None)
    if contact:
        patch["contactId"] = contact["id"]
    due = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    if due:
        patch["dueAt"] = due.group(1)
    subj = re.search(r"(?:about|subject|re:?)\s+(.+)$", text, re.I)
    if subj:
        patch["subject"] = subj.group(1).strip()[:200]
    elif (
        current.get("contactId")
        and not current.get("subject")
        and len(text.strip()) <= 120
        and not contact
        and not looks_like_create_confirm(text)
        and not is_product_skip_intent(text)
        and not mapped_type
    ):
        patch["subject"] = text[:120]
    clean = patch or None
    merged = merge_draft(current, clean)
    oneshot = _maybe_oneshot_create(
        text=text,
        draft=current,
        merged=merged,
        ready_fn=activity_draft_ready,
        proposal_fn=propose_create_activity_proposal,
        proposal_id="create-activity",
        patch=clean,
        entity_label="activity",
    )
    if oneshot:
        return oneshot
    return {
        "ok": True,
        **({"patch": clean} if clean else {}),
    }


def quote_heuristic(
    text: str,
    deals: list[dict[str, Any]],
    draft: dict[str, Any] | None = None,
    products: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    current = draft if isinstance(draft, dict) else {}
    if looks_like_create_confirm(text) and quote_draft_ready(current):
        return {
            "ok": True,
            "toolProposals": [
                propose_create_quote_proposal(
                    proposal_id="create-quote-confirm",
                    auto=True,
                )
            ],
        }
    if looks_like_create_confirm(text):
        return {"ok": True}
    patch: dict[str, Any] = {}
    lower = text.lower()
    # Only try to (re-)resolve a field from free text while it's still unset.
    # Once a deal/product is set, later turns are almost always about *other*
    # fields (product, quantity, discount) — re-running fuzzy match on every
    # message risks a short, noisy token (e.g. "crm,ticketing") coincidentally
    # scoring high against an unrelated deal/company name and clobbering an
    # already-correct choice.
    if not str(current.get("dealId") or "").strip():
        # Prefer exact title substring, then fuzzy title/company/contact match
        # — same pattern as invoice_heuristic. A plain substring check alone
        # misses deals whose title carries a company prefix (e.g.
        # "Zoho — Yaswanth M G" won't substring-match a user typing just
        # "yaswanth m g").
        deal = next(
            (d for d in deals if d.get("title") and d["title"].lower() in lower),
            None,
        )
        if not deal:
            ranked = rank_deals_by_name({"deals": deals}, text, min_score=0.78, limit=2)
            if len(ranked) == 1 or (
                len(ranked) >= 2 and ranked[0][0] >= ranked[1][0] + 0.08
            ):
                deal = ranked[0][1]
        if deal:
            patch["dealId"] = deal["id"]
    products = products or []
    if not str(current.get("productId") or "").strip():
        product = next(
            (p for p in products if p.get("name") and p["name"].lower() in lower),
            None,
        )
        if not product:
            ranked_products = rank_products_by_name(
                {"products": products}, text, min_score=0.78, limit=2
            )
            if len(ranked_products) == 1 or (
                len(ranked_products) >= 2
                and ranked_products[0][0] >= ranked_products[1][0] + 0.08
            ):
                product = ranked_products[0][1]
        if product:
            patch["productId"] = product["id"]
    qty = re.search(r"\b(\d+)\s*(?:x|units?|qty)\b", text, re.I)
    if qty:
        patch["quantity"] = qty.group(1)
    disc = re.search(r"(\d+)\s*%\s*discount", text, re.I)
    if disc:
        patch["discountPct"] = disc.group(1)
    clean = patch or None
    merged = merge_draft(current, clean)
    oneshot = _maybe_oneshot_create(
        text=text,
        draft=current,
        merged=merged,
        ready_fn=quote_draft_ready,
        proposal_fn=propose_create_quote_proposal,
        proposal_id="create-quote",
        patch=clean,
        entity_label="quote",
    )
    if oneshot:
        return oneshot
    return {
        "ok": True,
        **({"patch": clean} if clean else {}),
    }


_PRODUCT_PATCH_KEYS = (
    "name",
    "sku",
    "description",
    "price",
    "currency",
    "status",
    "productType",
    "brand",
    "category",
    "subcategory",
    "stockOnHand",
    "productUrl",
    "billingType",
    "billingFrequency",
    "maxDiscountPercent",
    "tags",
    "imageUrl",
    "galleryUrls",
    "skippedOptional",
)


def sanitize_product(patch: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(patch, dict):
        return None
    out = str_fields(patch, list(_PRODUCT_PATCH_KEYS)) or {}
    pt = str(out.get("productType") or "").strip().lower().replace(" ", "_")
    if pt in ("fixed", "fixed_price", "standard", "simple"):
        out["productType"] = "fixed"
    elif pt in ("customizable", "custom", "configurable"):
        out["productType"] = "customizable"
    elif "productType" in out:
        del out["productType"]
    bt = (
        str(out.get("billingType") or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )
    if bt in ("one_time", "onetime", "once"):
        out["billingType"] = "one_time"
    elif bt in ("recurring", "subscription", "subscribe"):
        out["billingType"] = "recurring"
    elif "billingType" in out:
        del out["billingType"]
    freq = str(out.get("billingFrequency") or "").strip().lower()
    if freq in ("annual", "annually", "yearly"):
        out["billingFrequency"] = "annual"
        out["billingType"] = "recurring"
    elif freq in ("monthly", "quarterly"):
        out["billingFrequency"] = freq
        out["billingType"] = "recurring"
    elif "billingFrequency" in out:
        del out["billingFrequency"]
    if isinstance(patch.get("offers"), list):
        out["offers"] = patch["offers"]
    if isinstance(patch.get("addons"), list):
        out["addons"] = patch["addons"]
    return out or None


# Map ask-slot id → draft keys that count as that slot (or earlier).
_ASK_TO_KEYS: dict[str, tuple[str, ...]] = {
    "name": ("name",),
    "sku": ("sku",),
    "price": ("price",),
    "currency": ("currency",),
    "productType": ("productType",),
    "billingType": ("billingType",),
    "billingFrequency": ("billingFrequency",),
    "maxDiscount": ("maxDiscountPercent",),
    "brand": ("brand",),
    "stockOnHand": ("stockOnHand",),
    "productUrl": ("productUrl",),
    "category": ("category",),
    "description": ("description",),
    "tags": ("tags",),
    "image": ("imageUrl", "galleryUrls"),
    "offers": ("offers",),
    "addons": ("addons",),
    "save": (),
}


def _product_walk_index(ask: str, business_type: str | None = None) -> int:
    from app.agents.draft_conversation import product_walk_slots

    order = product_walk_slots(business_type)
    try:
        return order.index(ask)
    except ValueError:
        return len(order)


def _clamp_product_patch_to_walk(
    patch: dict[str, Any],
    *,
    ask: str,
    business_type: str | None = None,
) -> dict[str, Any]:
    """Drop LLM fields that jump ahead of the guided Up-next slot."""
    if ask == "save":
        return patch
    limit = _product_walk_index(ask, business_type)
    allowed: set[str] = {"skippedOptional"}
    for slot, keys in _ASK_TO_KEYS.items():
        if _product_walk_index(slot, business_type) <= limit:
            allowed.update(keys)
    return {k: v for k, v in patch.items() if k in allowed}


def enrich_product_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any],
    business_type: str | None = None,
) -> dict[str, Any]:
    from app.agents.draft_conversation import (
        parse_product_currency,
        product_forbidden_patch_keys,
        product_next_ask_key,
    )

    del user_text
    out = enrich_draft_result(result)
    patch = out.get("patch") if isinstance(out.get("patch"), dict) else None
    clean = dict(sanitize_product(patch) or {})
    for key in product_forbidden_patch_keys(business_type):
        clean.pop(key, None)
    current = draft if isinstance(draft, dict) else {}
    ask_before = product_next_ask_key(current, business_type=business_type)
    if "currency" in clean:
        mapped = parse_product_currency(str(clean["currency"]))
        if mapped:
            clean["currency"] = mapped
    clean = _clamp_product_patch_to_walk(
        clean, ask=ask_before, business_type=business_type
    )
    for key in product_forbidden_patch_keys(business_type):
        clean.pop(key, None)
    clean = {
        k: v
        for k, v in clean.items()
        if v is not None and v != "" and v != []
    }
    if clean:
        out["patch"] = clean
    else:
        out.pop("patch", None)
    return out


def sanitize_invoice(
    patch: dict[str, Any] | None,
    deals: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not isinstance(patch, dict):
        return None
    out = str_fields(
        patch,
        [
            "currency",
            "notes",
            "paymentTerms",
            "productId",
            "quantity",
            "issueDate",
            "dueDate",
        ],
    )
    if isinstance(patch.get("dealId"), str) and any(
        d.get("id") == patch["dealId"] for d in deals
    ):
        out["dealId"] = patch["dealId"]
    return out or None


def _activity_trusted_contact_ids(
    draft: dict[str, Any] | None,
    catalog: dict[str, Any] | None = None,
) -> set[str]:
    trusted: set[str] = set()
    d = draft if isinstance(draft, dict) else {}
    cid = str(d.get("contactId") or "").strip()
    if cid:
        trusted.add(cid)
    cat = catalog if isinstance(catalog, dict) else {}
    for key in ("openContact",):
        row = cat.get(key)
        if isinstance(row, dict):
            rid = str(row.get("id") or "").strip()
            if rid:
                trusted.add(rid)
    open_deal = cat.get("openDeal")
    if isinstance(open_deal, dict):
        rid = str(open_deal.get("contactId") or "").strip()
        if rid:
            trusted.add(rid)
    return trusted


def sanitize_activity(
    patch: dict[str, Any] | None,
    contacts: list[dict[str, Any]],
    *,
    trusted_contact_ids: set[str] | None = None,
) -> dict[str, Any] | None:
    if not isinstance(patch, dict):
        return None
    out = str_fields(patch, ["subject", "body", "dueAt"])
    if isinstance(patch.get("type"), str):
        t = patch["type"].strip().lower()
        if t in ACTIVITY_TYPES:
            out["type"] = t
    if isinstance(patch.get("contactId"), str):
        cid = patch["contactId"].strip()
        if cid and (
            any(c.get("id") == cid for c in contacts)
            or (trusted_contact_ids and cid in trusted_contact_ids)
        ):
            out["contactId"] = cid
    return out or None


def enrich_invoice_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any],
    deals: list[dict[str, Any]],
    products: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from app.agents.coworker_shared import resolve_catalog_id

    del user_text
    products = products or []
    out = enrich_draft_result(result)
    patch = out.get("patch") if isinstance(out.get("patch"), dict) else None
    clean = dict(sanitize_invoice(patch, deals) or {})
    if isinstance(patch, dict):
        if isinstance(patch.get("productId"), str):
            resolved = resolve_catalog_id(
                patch["productId"], items=products, kind="product"
            )
            if resolved:
                clean["productId"] = resolved
        for key in ("issueDate", "dueDate", "quantity"):
            if patch.get(key) and key not in clean:
                clean[key] = patch[key]
    if clean:
        out["patch"] = clean
    else:
        out.pop("patch", None)
    return out


def _s_invoice_deal(draft: dict[str, Any]) -> bool:
    return bool(str(draft.get("dealId") or "").strip())


_ACTIVITY_ASK_TO_KEYS = {
    "contact": ("contactId",),
    "type": ("type",),
    "subject": ("subject",),
    "dueAt": ("dueAt",),
    "body": ("body",),
    "save": ("contactId", "type", "subject", "dueAt", "body"),
}


def _activity_walk_index(ask: str) -> int:
    order = ("contact", "type", "subject", "dueAt", "body", "save")
    try:
        return order.index(ask)
    except ValueError:
        return len(order)


def _clamp_activity_patch_to_walk(
    patch: dict[str, Any],
    *,
    ask: str,
) -> dict[str, Any]:
    """Drop LLM fields that jump ahead of the guided Up-next slot."""
    if ask == "save":
        return patch
    limit = _activity_walk_index(ask)
    allowed: set[str] = {"skippedOptional"}
    for slot, keys in _ACTIVITY_ASK_TO_KEYS.items():
        if _activity_walk_index(slot) <= limit:
            allowed.update(keys)
    return {k: v for k, v in patch.items() if k in allowed}


_ACTIVITY_SLOT_KEYS = frozenset(
    {"contactId", "type", "subject", "dueAt", "body", "skippedOptional"}
)


def _activity_multi_slot_patch(patch: dict[str, Any]) -> bool:
    """True when a tool turn already filled more than one guided slot."""
    slots = [key for key in patch if key in _ACTIVITY_SLOT_KEYS]
    return len(slots) >= 2


def enrich_activity_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any],
    contacts: list[dict[str, Any]],
    messages: list[dict[str, Any]] | None = None,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.agents.draft_conversation import activity_next_ask_key

    del user_text, messages
    trusted = _activity_trusted_contact_ids(draft, catalog)
    out = enrich_draft_result(result)
    patch = out.get("patch") if isinstance(out.get("patch"), dict) else None
    clean = dict(
        sanitize_activity(
            patch, contacts, trusted_contact_ids=trusted
        )
        or {}
    )
    current = draft if isinstance(draft, dict) else {}
    ask_before = activity_next_ask_key(current)
    # Single-slot answers stay on the guided walk. Multi-field patch_activity_draft
    # (schedule handoffs, seeds) must not be stripped to contactId-only.
    if not _activity_multi_slot_patch(clean):
        clean = _clamp_activity_patch_to_walk(clean, ask=ask_before)
    if clean:
        out["patch"] = clean
    else:
        out.pop("patch", None)
    return out



def enrich_quote_draft_result(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any],
    catalog: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
    sanitize_fn=None,
) -> dict[str, Any]:
    from app.agents.coworker_shared import enrich_quote_result_from_catalog

    deals = list(catalog.get("deals") or [])
    products = list(catalog.get("products") or [])
    out = enrich_draft_result(result)
    out = enrich_quote_result_from_catalog(
        out,
        user_text=user_text,
        draft=draft,
        catalog=catalog,
        messages=messages,
        fill_missing=False,
    )
    patch = out.get("patch") if isinstance(out.get("patch"), dict) else None
    if sanitize_fn:
        clean = sanitize_fn(patch)
    else:
        clean = str_fields(patch or {}, ["discountPct", "quantity"]) or None
        if isinstance((patch or {}).get("dealId"), str):
            from app.agents.coworker_shared import resolve_catalog_id

            resolved = resolve_catalog_id(patch["dealId"], items=deals, kind="deal")
            if resolved:
                clean = dict(clean or {})
                clean["dealId"] = resolved
        if isinstance((patch or {}).get("productId"), str):
            from app.agents.coworker_shared import resolve_catalog_id

            resolved = resolve_catalog_id(
                patch["productId"], items=products, kind="product"
            )
            if resolved:
                clean = dict(clean or {})
                clean["productId"] = resolved
        if isinstance((patch or {}).get("offerId"), str) and str(
            patch.get("offerId")
        ).strip():
            clean = dict(clean or {})
            clean["offerId"] = str(patch["offerId"]).strip()
    current = draft if isinstance(draft, dict) else {}
    if not str(current.get("dealId") or "").strip() and not (clean or {}).get("dealId"):
        from app.agents.coworker_shared import resolve_catalog_id

        matched = resolve_catalog_id(
            user_text, items=deals, kind="deal", min_score=0.72
        )
        if matched:
            clean = dict(clean or {})
            clean["dealId"] = matched
    elif (
        str(current.get("dealId") or (clean or {}).get("dealId") or "").strip()
        and not str(current.get("productId") or "").strip()
        and not (clean or {}).get("productId")
    ):
        from app.agents.coworker_shared import resolve_catalog_id

        matched = resolve_catalog_id(
            user_text, items=products, kind="product", min_score=0.72
        )
        if matched:
            clean = dict(clean or {})
            clean["productId"] = matched
    if clean:
        out["patch"] = clean
    elif "patch" in out:
        out["patch"] = None
    from app.agents.draft_conversation import (
        looks_like_create_confirm,
        merge_draft,
        next_quote_prompt,
        quote_draft_ready,
    )

    from app.agents.draft_conversation import (
        _QUOTE_OPTIONAL_ASK,
        apply_guided_create_skip,
        quote_mandatory_field_message,
        quote_next_ask_key,
        rewrite_early_save_speech,
    )

    merged = merge_draft(current, clean if isinstance(clean, dict) else None)
    skip_slot = apply_guided_create_skip(
        user_text,
        current,
        next_ask_fn=quote_next_ask_key,
        optional_asks=_QUOTE_OPTIONAL_ASK,
        mandatory_message_fn=quote_mandatory_field_message,
    )
    if skip_slot and skip_slot.get("_blockSpeech"):
        out["assistantText"] = str(skip_slot["_blockSpeech"])
        out.pop("patch", None)
        merged = current
    elif skip_slot and skip_slot.get("skippedOptional"):
        out["patch"] = {
            **(clean or {}),
            "skippedOptional": skip_slot["skippedOptional"],
        }
        merged = merge_draft(current, out["patch"])
    user_saving = looks_like_create_confirm(user_text) and quote_draft_ready(merged)
    if user_saving and not quote_draft_ready(merged):
        out["assistantText"] = quote_mandatory_field_message(
            quote_next_ask_key(merged), merged
        )
    elif not user_saving:
        out["assistantText"] = next_quote_prompt(
            merged, just_patched=bool(clean or skip_slot)
        )
    speech = str(out.get("assistantText") or "")
    out["assistantText"] = rewrite_early_save_speech(
        speech,
        merged,
        next_ask_fn=quote_next_ask_key,
        next_prompt_fn=next_quote_prompt,
    )[:800]
    return out


async def handle(state: MiscDraftState) -> MiscDraftState:
    messages = state.get("messages") or []
    catalog = state.get("catalog") or {}
    context = state.get("context") or {}
    kind = state.get("kind") or "product"
    user_text = last_user_text(messages)
    if not user_text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to update the draft."},
        }

    draft = catalog.get("currentDraft") or context.get("draft") or {}
    if not isinstance(draft, dict):
        draft = {}
    business_type = str(
        catalog.get("businessType") or context.get("businessType") or ""
    )

    if kind == "quote":
        from app.agents.deal_coworker_agent import resolve_proposal_not_quote_turn

        pathname = str(context.get("pathname") or "")
        mod = str(context.get("module") or "quotes")
        handoff = resolve_proposal_not_quote_turn(
            user_text=user_text,
            mod=mod,
            pathname=pathname,
            catalog=catalog,
        )
        if handoff:
            return {**state, "result": handoff}

    from app.agents.coworker_shared import llm_unavailable_result
    from app.llm import is_ai_configured

    # Offline-only confirm. When the LLM is up, "yes" stays in conversation.
    ready_fns: dict[str, Any] = {
        "product": product_draft_ready,
        "invoice": invoice_draft_ready,
        "activity": activity_draft_ready,
        "quote": quote_draft_ready,
    }
    ready_now = (ready_fns.get(kind) or (lambda _d: False))(draft)
    if (
        not is_ai_configured()
        and looks_like_create_confirm(user_text)
        and ready_now
    ):
        return {
            **state,
            "result": llm_unavailable_result("llm_not_configured"),
        }

    if kind == "product":
        from app.agents.crm_tools import run_native_agent_turn

        native = await run_native_agent_turn(
            mod="product",
            surface="create",
            messages=messages,
            context={
                **context,
                "draft": draft,
                "module": "product",
                "surface": "create",
                "pathname": str(context.get("pathname") or "/product/new"),
            },
            catalog={**catalog, "currentDraft": draft},
            user_text=user_text,
        )
        if native and native.get("ok"):
            pathname = str(context.get("pathname") or "/product/new")
            native = apply_leave_create(
                {**native, "source": "ai"},
                pathname=pathname,
                module="product",
            )
            if result_leaves_current_page(
                native, pathname=pathname, module="product"
            ):
                return {**state, "result": native}
            result = enrich_product_draft_result(
                {**native, "source": "ai"},
                user_text=user_text,
                draft=draft,
                business_type=business_type,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and product_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_product_proposal(
                        proposal_id="create-product-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}
        ai = await run_chat_json(
            system=PRODUCT_SYSTEM,
            user=build_conversation_prompt(
                {"currentDraft": draft},
                messages,
            ),
        )
        speech = _llm_speech(ai)
        if speech:
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
            result = enrich_product_draft_result(
                {
                    "ok": True,
                    "assistantText": speech,
                    "patch": sanitize_product(ai.get("patch") if ai else None),
                    "source": "ai",
                },
                user_text=user_text,
                draft=draft,
                business_type=business_type,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and product_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_product_proposal(
                        proposal_id="create-product-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}
        return {
            **state,
            "result": llm_unavailable_result("llm_fallback"),
        }

    if kind == "invoice":
        from app.agents.coworker_shared import should_commit_native_turn
        from app.agents.crm_tools import run_native_agent_turn

        deals = list(catalog.get("deals") or [])[:50]
        products = list(catalog.get("products") or [])[:80]
        native = await run_native_agent_turn(
            mod="finance",
            surface="create",
            messages=messages,
            context={**context, "draft": draft, "module": "finance", "surface": "create"},
            catalog={**catalog, "currentDraft": draft, "deals": deals, "products": products},
            user_text=user_text,
        )
        if should_commit_native_turn(native, user_text=user_text):
            result = enrich_invoice_draft_result(
                {**native, "source": "ai"},
                user_text=user_text,
                draft=draft,
                deals=deals,
                products=products,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and invoice_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_invoice_proposal(
                        proposal_id="create-invoice-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}
        ai = await run_chat_json(
            system=INVOICE_SYSTEM,
            user=build_conversation_prompt(
                {
                    "deals": deals,
                    "currentDraft": draft,
                },
                messages,
            ),
        )

        speech = _llm_speech(ai)
        if speech:
            products = list(catalog.get("products") or [])[:80]
            result = enrich_invoice_draft_result(
                {
                    "ok": True,
                    "assistantText": speech,
                    "patch": sanitize_invoice(ai.get("patch") if ai else None, deals),
                    "source": "ai",
                },
                user_text=user_text,
                draft=draft,
                deals=deals,
                products=products,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and invoice_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_invoice_proposal(
                        proposal_id="create-invoice-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}
        return {
            **state,
            "result": llm_unavailable_result("llm_fallback"),
        }

    if kind == "activity":
        from app.agents.crm_tools import run_native_agent_turn

        contacts = list(catalog.get("contacts") or [])[:200]
        act_catalog = {**catalog, "currentDraft": draft, "contacts": contacts}
        native = await run_native_agent_turn(
            mod="activities",
            surface="create",
            messages=messages,
            context={
                **context,
                "draft": draft,
                "module": "activities",
                "surface": "create",
            },
            catalog=act_catalog,
            user_text=user_text,
        )
        if native and native.get("ok"):
            result = enrich_activity_draft_result(
                {**native, "source": "ai"},
                user_text=user_text,
                draft=draft,
                contacts=contacts,
                catalog=act_catalog,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and activity_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_activity_proposal(
                        proposal_id="create-activity-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}
        ai = await run_chat_json(
            system=ACTIVITY_SYSTEM,
            user=build_conversation_prompt(
                {
                    "contacts": contacts,
                    "types": list(ACTIVITY_TYPES),
                    "currentDraft": draft,
                },
                messages,
            ),
        )

        speech = _llm_speech(ai)
        if speech:
            trusted = _activity_trusted_contact_ids(draft, act_catalog)
            result = enrich_activity_draft_result(
                {
                    "ok": True,
                    "assistantText": speech,
                    "patch": sanitize_activity(
                        ai.get("patch") if ai else None,
                        contacts,
                        trusted_contact_ids=trusted,
                    ),
                    "source": "ai",
                },
                user_text=user_text,
                draft=draft,
                contacts=contacts,
                catalog=act_catalog,
            )
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and activity_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_activity_proposal(
                        proposal_id="create-activity-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}
        return {
            **state,
            "result": llm_unavailable_result("llm_fallback"),
        }

    # quote
    from app.agents.coworker_shared import (
        enrich_quote_result_from_catalog,
        should_commit_native_turn,
    )
    from app.agents.crm_tools import run_native_agent_turn

    deals = list(catalog.get("deals") or [])[:50]
    products = list(catalog.get("products") or [])[:50]
    quote_catalog = {
        **catalog,
        "currentDraft": draft,
        "deals": deals,
        "products": products,
    }
    native = await run_native_agent_turn(
        mod="quotes",
        surface="create",
        messages=messages,
        context={**context, "draft": draft, "module": "quotes", "surface": "create"},
        catalog=quote_catalog,
        user_text=user_text,
    )
    if should_commit_native_turn(native, user_text=user_text):
        result = enrich_quote_draft_result(
            {**native, "source": "ai"},
            user_text=user_text,
            draft=draft,
            catalog=quote_catalog,
            messages=messages,
        )
        merged = merge_draft(
            draft,
            result.get("patch") if isinstance(result.get("patch"), dict) else None,
        )
        if looks_like_create_confirm(user_text) and quote_draft_ready(merged):
            result["toolProposals"] = [
                propose_create_quote_proposal(
                    proposal_id="create-quote-confirm",
                    auto=True,
                )
            ]
        return {**state, "result": result}
    ai = await run_chat_json(
        system=QUOTE_SYSTEM,
        user=build_conversation_prompt(
            {
                "deals": deals,
                "products": products,
                "note": "dealId/productId must be copied exactly from the deals/products "
                "lists above — never invent one. Omit productId rather than guess.",
                "currentDraft": draft,
            },
            messages,
        ),
    )

    def sanitize_quote(p: dict[str, Any] | None) -> dict[str, Any] | None:
        if not p:
            return None
        out = str_fields(p, ["discountPct", "quantity"])
        if isinstance(p.get("dealId"), str):
            from app.agents.coworker_shared import resolve_catalog_id

            resolved = resolve_catalog_id(p["dealId"], items=deals, kind="deal")
            if resolved:
                out["dealId"] = resolved
        if isinstance(p.get("productId"), str):
            from app.agents.coworker_shared import resolve_catalog_id

            resolved = resolve_catalog_id(p["productId"], items=products, kind="product")
            if resolved:
                out["productId"] = resolved
        return out or None

    speech = _llm_speech(ai)
    if speech or (ai and isinstance(ai.get("patch"), dict)):
        result = enrich_quote_draft_result(
            {
                "ok": True,
                "assistantText": speech,
                "patch": sanitize_quote(ai.get("patch") if ai else None),
                "source": "ai",
            },
            user_text=user_text,
            draft=draft,
            catalog=quote_catalog,
            messages=messages,
            sanitize_fn=sanitize_quote,
        )
        speech = str(result.get("assistantText") or "").strip()
        if speech:
            merged = merge_draft(
                draft,
                result.get("patch") if isinstance(result.get("patch"), dict) else None,
            )
            if looks_like_create_confirm(user_text) and quote_draft_ready(merged):
                result["toolProposals"] = [
                    propose_create_quote_proposal(
                        proposal_id="create-quote-confirm",
                        auto=True,
                    )
                ]
            return {**state, "result": result}
    return {
        **state,
        "result": llm_unavailable_result("llm_fallback"),
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
    kind: str = "product",
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
    return result.get("result") or {"ok": False, "error": "Draft assist failed."}
