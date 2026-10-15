"""MCP access matrix mirrored from ``backend/src/config/modules.ts``."""

from __future__ import annotations

from app.mcp.context import get_ctx


class McpAuthError(PermissionError):
    pass


POLICY_VERSION = "crm-modules-v1"

MODULES_BY_BUSINESS_TYPE = {
    "b2b": frozenset(
        {"dashboard", "agents", "inbox", "contact", "company", "marketing", "sales",
         "activities", "product", "finance", "service", "reports", "configuration"}
    ),
    "b2c": frozenset(
        {"dashboard", "agents", "inbox", "contact", "marketing", "activities",
         "product", "commerce", "service", "reports", "configuration"}
    ),
    "b2b2c": frozenset(
        {"dashboard", "agents", "inbox", "contact", "company", "marketing", "sales",
         "activities", "product", "commerce", "finance", "service", "reports",
         "configuration"}
    ),
}

MODULES_BY_ROLE: dict[str, frozenset[str] | None] = {
    "admin": None,
    "sales_manager": None,
    "sales_rep": frozenset(
        {"dashboard", "inbox", "contact", "company", "sales", "activities", "product",
         "commerce", "service", "configuration"}
    ),
    "marketing": frozenset(
        {"dashboard", "inbox", "contact", "company", "marketing", "activities",
         "product", "commerce", "reports", "configuration"}
    ),
    "finance": frozenset(
        {"dashboard", "inbox", "contact", "company", "finance", "configuration"}
    ),
    "viewer": frozenset(
        {"dashboard", "inbox", "contact", "company", "sales", "activities", "product",
         "commerce"}
    ),
}

MODULE_DEEP_LINKS_BY_ROLE = {
    "finance": frozenset({"sales"}),
    "sales_rep": frozenset({"finance"}),
    "sales_manager": frozenset({"finance"}),
}

ROLE_ALIASES = {
    "administrator": "admin",
    "manager": "sales_manager",
    "sales": "sales_rep",
    "rep": "sales_rep",
    "marketer": "marketing",
    "read_only": "viewer",
}


def normalize_role(raw: str) -> str:
    key = (raw or "").strip().lower().replace(" ", "_")
    return ROLE_ALIASES.get(key, key or "sales_rep")


def normalize_module(raw: str) -> str:
    # Quote pages are a Sales sub-surface in the backend matrix.
    return "sales" if (raw or "").strip().lower() == "quotes" else (raw or "").strip().lower()


def modules_for_access(business_type: str, role: str) -> frozenset[str]:
    by_type = MODULES_BY_BUSINESS_TYPE.get((business_type or "").strip().lower(), frozenset())
    normalized_role = normalize_role(role)
    by_role = MODULES_BY_ROLE.get(normalized_role, frozenset())
    nav = by_type if by_role is None else by_type.intersection(by_role)
    if normalized_role != "marketing":
        nav = frozenset(m for m in nav if m != "reports")
    deep = MODULE_DEEP_LINKS_BY_ROLE.get(normalized_role, frozenset()).intersection(by_type)
    return frozenset(nav.union(deep))


def can_access_module(module: str, business_type: str, role: str) -> bool:
    normalized = normalize_module(module)
    return bool(normalized) and normalized in modules_for_access(business_type, role)


def require_module_access() -> None:
    ctx = get_ctx()
    if not can_access_module(ctx.module, ctx.business_type, ctx.role):
        raise McpAuthError("Your role or business type cannot access this CRM module.")


def require_org() -> str:
    ctx = get_ctx()
    org = (ctx.organization_id or "").strip()
    if not org:
        raise McpAuthError("organization_id required for MCP writes")
    return org


def require_user() -> str:
    ctx = get_ctx()
    uid = (ctx.acting_user_id or "").strip()
    if not uid:
        raise McpAuthError("acting_user_id required for MCP writes")
    return uid


def can_edit() -> bool:
    ctx = get_ctx()
    return can_edit_module(ctx.module, ctx.business_type, ctx.role)


def can_edit_module(module_raw: str, business_type: str, role_raw: str) -> bool:
    role = normalize_role(role_raw)
    module = normalize_module(module_raw)
    if business_type and not can_access_module(module, business_type, role):
        return False
    if role == "viewer":
        return False
    editors = {
        "contact": {"admin", "sales_manager", "sales_rep", "marketing"},
        "company": {"admin", "sales_manager", "sales_rep"},
        "sales": {"admin", "sales_manager", "sales_rep"},
        "product": {"admin", "sales_manager", "sales_rep"},
        "finance": {"admin", "finance"},
        "commerce": {"admin", "sales_manager", "sales_rep", "marketing"},
    }
    allowed = editors.get(module)
    return role != "viewer" if allowed is None else role in allowed


def require_edit() -> None:
    if not can_edit():
        raise McpAuthError("Your role cannot edit CRM records via the agent.")


def assert_matrix_invariants() -> None:
    if "finance" in MODULES_BY_BUSINESS_TYPE["b2c"]:
        raise RuntimeError("Invariant: B2C must not enable Finance")
    for role, modules in MODULES_BY_ROLE.items():
        if modules is not None and role != "viewer" and "inbox" in modules:
            if "configuration" not in modules:
                raise RuntimeError(f"Invariant: {role} has Inbox without Configuration")


assert_matrix_invariants()
