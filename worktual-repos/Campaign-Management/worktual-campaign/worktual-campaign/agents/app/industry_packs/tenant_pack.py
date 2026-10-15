"""Fetch and format per-company (tenant) industry packs for agent prompts."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


def _base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def normalize_company_pack(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    pack = raw.get("pack") if isinstance(raw.get("pack"), dict) else raw
    if not isinstance(pack, dict):
        return None
    payload = pack.get("payload") if isinstance(pack.get("payload"), dict) else {}
    if not isinstance(payload, dict):
        payload = {}
    fields = payload.get("fields") if isinstance(payload.get("fields"), list) else []
    rules = payload.get("rules") if isinstance(payload.get("rules"), list) else []
    return {
        "organization_id": str(pack.get("organizationId") or pack.get("organization_id") or pack.get("tenantId") or pack.get("tenant_id") or ""),
        "pack_id": str(pack.get("packId") or pack.get("pack_id") or ""),
        "seed_industry_type": str(
            pack.get("seedIndustryType")
            or pack.get("seed_industry_type")
            or payload.get("seedIndustryType")
            or ""
        ),
        "mode": str(payload.get("mode") or "").lower() or "b2b",
        "fields": [f for f in fields if isinstance(f, dict)],
        "rules": [r for r in rules if isinstance(r, dict)],
        "updated_at": str(pack.get("updatedAt") or pack.get("updated_at") or ""),
    }


async def fetch_company_pack(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                f"{_base()}/industry-pack",
                headers=_headers(token),
            )
            if res.status_code >= 400:
                return None
            body = res.json() or {}
            return normalize_company_pack(body.get("pack") or body)
    except Exception:  # noqa: BLE001
        return None


def company_pack_addendum(pack: Any) -> str:
    """Prompt overlay from the tenant pack — rules are binding; fields stay soft."""
    if not isinstance(pack, dict):
        return ""
    if isinstance(pack.get("fields"), list):
        p = {
            "pack_id": str(pack.get("pack_id") or pack.get("packId") or ""),
            "seed_industry_type": str(
                pack.get("seed_industry_type")
                or pack.get("seedIndustryType")
                or ""
            ),
            "fields": [f for f in pack["fields"] if isinstance(f, dict)],
            "rules": [
                r
                for r in (pack.get("rules") or [])
                if isinstance(r, dict)
            ],
        }
    else:
        p = normalize_company_pack(pack)
    if not p:
        return ""

    vertical = p.get("seed_industry_type") or "generic"
    active = [
        f
        for f in p["fields"]
        if str(f.get("status") or "active").lower() != "suggested"
    ]
    suggested = [
        f
        for f in p["fields"]
        if str(f.get("status") or "").lower() == "suggested"
    ]
    rules = p["rules"]

    active_bits = ", ".join(
        f"{f.get('key')}" for f in active[:12] if f.get("key")
    ) or "(none yet)"
    lines = [
        "\n\nCOMPANY PACK (this tenant — seeded from industry, grows over time):",
        f"- Industry seed: {vertical}. Pack id: {p.get('pack_id') or 'n/a'}.",
        f"- Known optional field keys (do NOT ask unless user volunteers): {active_bits}.",
    ]
    if suggested:
        sug = ", ".join(str(f.get("key")) for f in suggested[:8] if f.get("key"))
        lines.append(
            f"- Suggested new fields awaiting confirm (ask once, then "
            f"CONFIRM_PACK_FIELD or DELETE_PACK_FIELD): {sug}."
        )
    if rules:
        lines.append("- Company rules (follow these):")
        for i, rule in enumerate(rules[:20], 1):
            text = str(rule.get("text") or "").strip()
            rid = str(rule.get("id") or "").strip()
            if text:
                lines.append(f"  {i}. [{rid}] {text}")
    else:
        lines.append(
            "- No custom company rules yet. User can add/edit/delete via "
            "ADD_COMPANY_RULE / UPDATE_COMPANY_RULE / DELETE_COMPANY_RULE."
        )
    lines.append(
        "- Pack tools: GET_COMPANY_PACK, ADD_COMPANY_RULE, UPDATE_COMPANY_RULE, "
        "DELETE_COMPANY_RULE, UPSERT_PACK_FIELD, CONFIRM_PACK_FIELD, DELETE_PACK_FIELD."
    )
    return "\n".join(lines)


async def refresh_session_company_pack(
    session: dict[str, Any],
    token: str,
) -> dict[str, Any]:
    pack = await fetch_company_pack(token)
    if pack:
        session["company_pack"] = pack
        from app.industry_packs.loader import apply_login_profile_to_session

        apply_login_profile_to_session(session)
    return session
