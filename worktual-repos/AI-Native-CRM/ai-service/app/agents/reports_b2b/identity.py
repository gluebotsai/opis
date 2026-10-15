"""Map coworker envelope strings to warehouse integer ids."""

from __future__ import annotations


def parse_org_id(organization_id: str) -> int:
    raw = str(organization_id or "").strip()
    if not raw.isdigit():
        raise ValueError("organization_id must be numeric for reports warehouse")
    return int(raw)


def parse_user_id(actor_id: str) -> int:
    raw = str(actor_id or "").strip()
    if not raw.isdigit():
        raise ValueError("actor_id must be numeric for reports warehouse")
    return int(raw)


def normalize_role(role: str) -> str:
    r = str(role or "viewer").strip().lower()
    if r == "sales_manager":
        return "sales_manager"
    if r in {"admin", "finance", "marketing", "viewer", "sales_rep", "presales"}:
        return r
    if r == "sales_manager":
        return "sales_manager"
    return r
