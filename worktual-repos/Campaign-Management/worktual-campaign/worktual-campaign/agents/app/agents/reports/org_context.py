"""Resolve Campaign organization + caller context for reports / analytics APIs."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.auth import decode_token, user_id_from_token
from app.config import get_settings
from app.session_store import save_session

logger = logging.getLogger(__name__)


def _payload_org_id(payload: dict[str, Any]) -> str:
    for key in (
        "organizationId",
        "organization_id",
        "tenantId",
        "tenant_id",
        "orgId",
        "org_id",
    ):
        raw = payload.get(key)
        if raw is None:
            continue
        s = str(raw).strip()
        if s:
            return s
    return ""


def _from_jwt(token: str) -> dict[str, Any]:
    try:
        payload = decode_token(token)
    except Exception:  # noqa: BLE001
        return {}
    if not isinstance(payload, dict):
        return {}
    return payload


async def _auth_me_user(token: str) -> dict[str, Any]:
    base = get_settings().campaign_api_base.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                f"{base}/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code >= 400:
                return {}
            body = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("auth/me failed: %s", exc)
        return {}
    user = body.get("user") if isinstance(body, dict) else None
    if not isinstance(user, dict):
        data = body.get("data") if isinstance(body, dict) else None
        if isinstance(data, dict):
            user = data.get("user") if isinstance(data.get("user"), dict) else data
    return user if isinstance(user, dict) else {}


async def resolve_organization_id(
    session: dict[str, Any],
    token: str,
    *,
    persist: bool = True,
) -> str:
    """Return Campaign organization_id for semantic / ontology APIs. Cache on session."""
    cached = session.get("organization_id") or session.get("tenant_id")
    if cached is not None and str(cached).strip():
        return str(cached).strip()

    payload = _from_jwt(token)
    oid = _payload_org_id(payload)
    if not oid:
        me = await _auth_me_user(token)
        oid = str(me.get("organizationId") or me.get("organization_id") or "").strip()

    if oid and persist:
        session["organization_id"] = oid
        session["tenant_id"] = oid
        try:
            await save_session(session, token=token)
        except Exception:  # noqa: BLE001
            pass
    return oid


def _caller_context_from_fields(
    *,
    user_id: str,
    email: str,
    name: str,
    role: str,
    org_id: str,
    branch_id: str,
) -> dict[str, Any]:
    role_norm = str(role or "user").strip().lower() or "user"
    is_admin = role_norm == "admin"
    data_scope = "org" if is_admin else "mine"
    return {
        "user_id": user_id,
        "email": email,
        "name": name,
        "role": role_norm,
        "is_admin": is_admin,
        "organization_id": org_id,
        "branch_id": branch_id,
        "data_scope": data_scope,
        "scope_label": "All branch campaigns" if is_admin else "Your campaigns",
    }


def _caller_context_matches(cached: dict[str, Any], fresh: dict[str, Any]) -> bool:
    for key in ("user_id", "role", "data_scope", "email", "scope_label"):
        if str(cached.get(key) or "").strip() != str(fresh.get(key) or "").strip():
            return False
    return bool(str(fresh.get("user_id") or "").strip())


async def resolve_session_context(
    session: dict[str, Any],
    token: str,
    *,
    persist: bool = True,
) -> dict[str, Any]:
    """Caller identity + data scope for reports/monitoring agents."""
    payload = _from_jwt(token)
    user_id = str(user_id_from_token(token) or payload.get("sub") or "").strip()
    role = str(payload.get("role") or "").strip().lower()
    email = str(payload.get("email") or "").strip()
    name = str(payload.get("name") or "").strip()
    branch_id = str(payload.get("branchId") or payload.get("branch_id") or "").strip()
    org_id = _payload_org_id(payload)

    if not role or not email or not name:
        me = await _auth_me_user(token)
        if me:
            role = str(me.get("role") or role).strip().lower()
            email = str(me.get("email") or email).strip()
            display = str(me.get("name") or "").strip()
            if not display:
                first = str(me.get("firstName") or me.get("first_name") or "").strip()
                last = str(me.get("lastName") or me.get("last_name") or "").strip()
                display = f"{first} {last}".strip()
            name = display or name
            branch_id = str(me.get("branchId") or me.get("branch_id") or branch_id).strip()
            org_id = org_id or str(me.get("organizationId") or me.get("organization_id") or "").strip()
            user_id = user_id or str(me.get("id") or "").strip()

    ctx = _caller_context_from_fields(
        user_id=user_id,
        email=email,
        name=name,
        role=role,
        org_id=org_id,
        branch_id=branch_id,
    )

    cached = session.get("caller_context")
    if isinstance(cached, dict) and _caller_context_matches(cached, ctx):
        return cached

    if org_id:
        session["organization_id"] = org_id
        session["tenant_id"] = org_id
    if user_id:
        session["user_id"] = user_id
    if persist:
        session["caller_context"] = ctx
        try:
            await save_session(session, token=token)
        except Exception:  # noqa: BLE001
            pass
    return ctx


def scope_note(ctx: dict[str, Any] | None) -> str:
    if not isinstance(ctx, dict):
        return ""
    return (
        f"scope_applied={ctx.get('data_scope')}; "
        f"scope_label={ctx.get('scope_label')!r}."
    )


def scope_result_fields(ctx: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(ctx, dict):
        return {}
    return {
        "scope_applied": ctx.get("data_scope"),
        "scope_label": ctx.get("scope_label"),
    }


def caller_context_prompt_block(ctx: dict[str, Any] | None) -> str:
    if not isinstance(ctx, dict) or not ctx.get("user_id"):
        return ""
    name = str(ctx.get("name") or ctx.get("email") or "User").strip()
    role = str(ctx.get("role") or "user").strip()
    scope = str(ctx.get("scope_label") or "").strip()
    data_scope = str(ctx.get("data_scope") or "mine").strip()
    lines = [
        "### Caller (signed-in user)",
        f"- Name: {name}",
        f"- Role: {role}",
        f"- Data scope: {data_scope} ({scope})",
    ]
    if data_scope == "mine":
        lines.extend(
            [
                "- All campaign tools return metrics/lists for **this user's campaigns only**. "
                "Say \"your campaigns\" — never claim branch-wide totals.",
                "- \"By me\" / \"my campaigns\" → answer with the tool totals directly (already filtered).",
                "- Another employee's name → per-employee breakdown is not available; say so briefly.",
            ]
        )
    else:
        lines.extend(
            [
                "- Tools return **branch-wide** campaign data for this organization. "
                "Totals include all creators in the branch.",
                "- \"By me\" / \"my campaigns\" → do **not** present branch KPIs as personal counts. "
                "Say totals are branch-wide and you cannot filter to only this user from aggregates.",
                "- Named employee (e.g. \"campaigns by X\") → per-creator breakdown is not supported. "
                "Offer to list campaign names for the period if useful.",
            ]
        )
    return "\n".join(lines)
