"""Cross-product SKU matrix — Super-only nested queries."""

from __future__ import annotations

from semantic.entitlements import load_tenant_entitlements

# Origin product → optional secondary product Super may query internally.
_CROSS_MATRIX: dict[str, tuple[str, ...]] = {
    "hub": ("ticketing", "ccaas", "crm", "campaign", "webtracking", "cdp"),
    "ccaas": ("ticketing",),
    "crm": ("campaign",),
    "ticketing": (),
    "campaign": (),
    "webtracking": (),
    "cdp": (),
}

_PRODUCT_SKU: dict[str, str] = {
    "ccaas": "contact-center",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
    "cdp": "cdp",
    "hub": "hub",
}


class CrossProductError(ValueError):
    pass


def allowed_secondary_products(origin_product: str) -> tuple[str, ...]:
    key = origin_product.strip().lower().replace("-", "_")
    return _CROSS_MATRIX.get(key, ())


def assert_cross_product_allowed(
    *,
    origin_product: str,
    target_product: str,
    organization_id: int,
) -> None:
    """Raise CrossProductError when Super may not query target from origin."""
    origin = origin_product.strip().lower().replace("-", "_")
    target = target_product.strip().lower().replace("-", "_")
    if origin == target or origin == "hub" and target in allowed_secondary_products("hub"):
        _assert_entitled(organization_id, target)
        return
    allowed = allowed_secondary_products(origin)
    if target not in allowed:
        raise CrossProductError(
            f"Origin '{origin_product}' cannot query product '{target_product}'."
        )
    _assert_entitled(organization_id, target)


def _assert_entitled(organization_id: int, product: str) -> None:
    ent = load_tenant_entitlements(organization_id)
    sku = _PRODUCT_SKU.get(product, product)
    if sku not in ent.skus and product not in ("hub", "cdp"):
        raise CrossProductError(
            f"Organization {organization_id} is not entitled to product '{product}'."
        )
