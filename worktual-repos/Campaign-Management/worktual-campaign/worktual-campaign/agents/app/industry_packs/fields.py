"""Contact pack as an *external resource* for the create agent.

Industry hint drives LLM reasoning. Field lists are soft examples only —
never a forced ask queue. Any user/agent extras still save to custom_fields.
"""

from __future__ import annotations

from typing import Any, TypedDict


class ContactExtraField(TypedDict, total=False):
    key: str
    label: str
    ask: str  # hint only: recommended | optional
    type: str  # string | number


_B2B_EXAMPLES: list[ContactExtraField] = [
    {"key": "job_title", "label": "job title", "ask": "recommended", "type": "string"},
]

_B2C_EXAMPLES: list[ContactExtraField] = [
    {"key": "segment", "label": "customer segment", "ask": "optional", "type": "string"},
    {
        "key": "product_interest",
        "label": "product interest",
        "ask": "optional",
        "type": "string",
    },
]

_VERTICAL_EXAMPLES: list[tuple[tuple[str, ...], list[ContactExtraField]]] = [
    (
        ("financ", "fintech", "bank", "lending", "insur"),
        [
            {"key": "income", "label": "income", "ask": "optional", "type": "number"},
            {"key": "score", "label": "score", "ask": "optional", "type": "number"},
            {"key": "age", "label": "age", "ask": "optional", "type": "number"},
        ],
    ),
    (
        ("health", "hospital", "clinic", "pharma", "medical"),
        [
            {"key": "age", "label": "age", "ask": "optional", "type": "number"},
        ],
    ),
    (
        ("real estate", "realestate", "property", "housing"),
        [
            {"key": "age", "label": "age", "ask": "optional", "type": "number"},
            {"key": "income", "label": "income", "ask": "optional", "type": "number"},
        ],
    ),
    (
        ("retail", "e-commerce", "ecommerce", "commerce", "shop"),
        [
            {
                "key": "product_interest",
                "label": "product interest",
                "ask": "optional",
                "type": "string",
            },
            {
                "key": "loyalty_tier",
                "label": "loyalty tier",
                "ask": "optional",
                "type": "string",
            },
        ],
    ),
    (
        ("technolog", "software", "saas", "it services"),
        [
            {"key": "job_title", "label": "job title", "ask": "optional", "type": "string"},
        ],
    ),
]


def _normalize_vertical(industry_type: str) -> str:
    return " ".join(str(industry_type or "").strip().lower().split())


def _merge_fields(*groups: list[ContactExtraField]) -> list[ContactExtraField]:
    by_key: dict[str, ContactExtraField] = {}
    for group in groups:
        for row in group:
            key = str(row.get("key") or "").strip()
            if not key:
                continue
            prev = by_key.get(key) or {}
            by_key[key] = {
                "key": key,
                "label": str(row.get("label") or prev.get("label") or key.replace("_", " ")),
                "ask": str(row.get("ask") or prev.get("ask") or "optional"),
                "type": str(row.get("type") or prev.get("type") or "string"),
            }
    return list(by_key.values())


def vertical_extra_fields(industry_type: str) -> list[ContactExtraField]:
    blob = _normalize_vertical(industry_type)
    if not blob:
        return []
    matched: list[ContactExtraField] = []
    for needles, fields in _VERTICAL_EXAMPLES:
        if any(n in blob for n in needles):
            matched.extend(fields)
    return _merge_fields(matched)


def contact_extra_fields(*, mode: str, industry_type: str = "") -> list[ContactExtraField]:
    """Soft example catalog (not a mandatory ask list)."""
    base = _B2C_EXAMPLES if str(mode or "").lower() == "b2c" else _B2B_EXAMPLES
    return _merge_fields(base, vertical_extra_fields(industry_type))


def recommended_contact_fields(*, mode: str, industry_type: str = "") -> list[ContactExtraField]:
    """Deprecated alias — all catalog rows are soft hints now."""
    return contact_extra_fields(mode=mode, industry_type=industry_type)


def contact_fields_addendum(*, mode: str, industry_type: str = "") -> str:
    """Industry hint for reasoning — do NOT turn into a forced extras ask list."""
    vertical = (industry_type or "").strip() or "generic"
    examples = contact_extra_fields(mode=mode, industry_type=industry_type)
    example_bits = ", ".join(
        f"{f['key']}" for f in examples[:8]
    ) or "business-specific attributes"
    mode_l = str(mode or "b2b").lower()

    if mode_l == "b2c":
        mode_rules = (
            "- B2C: speak to end customers. Still ask company_name then city once each "
            "after phone (order), but both are optional to save — user may skip.\n"
        )
    else:
        mode_rules = (
            "- B2B: speak to business contacts. Ask company_name then city once each "
            "after phone (optional to save — user may skip).\n"
        )

    return (
        f"\n\nINDUSTRY CONTEXT:\n"
        f"- Mode: {mode_l.upper()}. Industry vertical: {vertical}.\n"
        f"- Save needs: first_name + (email or phone). Always ask last_name right after "
        f"first_name (before email/phone); last name is optional to save. Create order: "
        f"first_name → last_name → email → phone → company_name → city.\n"
        f"{mode_rules}"
        f"- Optional extras (e.g. {example_bits}) only if useful; "
        f"store in custom_fields. Never invent values.\n"
    )


def resolve_contact_fields_from_profile(profile: Any) -> list[ContactExtraField]:
    from app.industry_packs.loader import normalize_campaign_profile

    p = normalize_campaign_profile(profile)
    return contact_extra_fields(mode=p["mode"], industry_type=p["industry_type"])


def resolve_recommended_from_profile(profile: Any) -> list[ContactExtraField]:
    return resolve_contact_fields_from_profile(profile)
