"""Resolve visible metrics and taxonomy for slice + query (single control plane)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ontology.slice import fetch_ontology_slice, normalize_product_id
from semantic.capabilities import get_metric_capabilities, role_rank
from semantic.entitlements import TenantEntitlements, load_tenant_entitlements
from semantic.lookup import get_metric_policy, is_certified
from semantic.agent_grants import grant_candidates, headline_metrics_for_agent
from semantic.ownership import reporting_catalog_for_agent
from semantic.scope import lookup_user_scope


@dataclass
class ResolvedContext:
    organization_id: int
    user_id: int | None
    product: str
    agent: str | None
    role: str
    role_name: str | None
    entitlements: TenantEntitlements
    visible_metric_ids: list[str] = field(default_factory=list)
    headline_metric_ids: list[str] = field(default_factory=list)
    metrics: list[dict[str, Any]] = field(default_factory=list)
    taxonomy: dict[str, Any] = field(default_factory=dict)

    def visible_set(self) -> set[str]:
        return set(self.visible_metric_ids)


def _metric_entitled(
    metric_id: str,
    *,
    product: str,
    entitlements: TenantEntitlements,
    role: str,
) -> bool:
    if not is_certified(metric_id):
        return False
    product_norm = (product or "").strip().lower()
    if product_norm == "cdp" and not entitlements.has_sku("cdp"):
        return False
    cap = get_metric_capabilities(metric_id, product=product)
    for sku in cap.get("requires_skus") or []:
        if not entitlements.has_sku(str(sku)):
            return False
    req_ch = [str(c) for c in cap.get("requires_channels") or []]
    if req_ch:
        entitled_ch = set(entitlements.channels_for_product(product))
        if not all(ch in entitled_ch for ch in req_ch):
            return False
    req_feat = [str(f) for f in cap.get("requires_features") or []]
    if req_feat:
        entitled_feat = set(entitlements.features_for_product(product))
        if not all(f in entitled_feat for f in req_feat):
            return False
    min_role = str(cap.get("min_role") or "agent")
    if role_rank(role) < role_rank(min_role):
        return False
    return True


def _clip_taxonomy_channel(
    taxonomy: dict[str, Any],
    entitled_channels: list[str],
) -> dict[str, Any]:
    if not taxonomy:
        return {}
    out = dict(taxonomy)
    channel_spec = out.get("channel")
    if channel_spec is None:
        return out
    if not entitled_channels:
        out["channel"] = {"terms": []} if isinstance(channel_spec, dict) else []
        return out
    if isinstance(channel_spec, dict):
        terms = channel_spec.get("terms") or []
        allowed = {str(c).lower() for c in entitled_channels}
        clipped = [t for t in terms if str(t).lower() in allowed]
        out["channel"] = {**channel_spec, "terms": clipped}
    elif isinstance(channel_spec, list):
        allowed = {str(c).lower() for c in entitled_channels}
        out["channel"] = [t for t in channel_spec if str(t).lower() in allowed]
    return out


def _metric_card(metric_id: str, *, product: str) -> dict[str, Any]:
    policy = get_metric_policy(metric_id, product=product)
    cap = get_metric_capabilities(metric_id, product=product)
    dims = policy.get("dims") or policy.get("group_by") or []
    return {
        "id": metric_id,
        "label": policy.get("label") or metric_id,
        "dims": [str(d) for d in dims],
        "when": policy.get("when") or "",
        "engine": cap.get("engine") or "postgres",
        "grain": cap.get("grain") or "operational",
        "channel_scoped": bool(cap.get("channel_scoped")),
    }


def filter_metrics(
    candidate_ids: list[str],
    *,
    organization_id: int,
    user_id: int | None,
    product: str,
    role: str | None = None,
    entitlements: TenantEntitlements | None = None,
) -> list[str]:
    ent = entitlements or load_tenant_entitlements(organization_id)
    if user_id is not None and role is None:
        scope = lookup_user_scope(organization_id, user_id, product=product)
        role = scope.role_name or scope.role
    role = role or "agent"
    visible: list[str] = []
    for mid in candidate_ids:
        if _metric_entitled(mid, product=product, entitlements=ent, role=role):
            visible.append(mid)
    return visible


def resolve_context(
    *,
    organization_id: int,
    user_id: int | None,
    agent: str | None,
    product: str,
    candidate_metric_ids: list[str] | None = None,
    taxonomy: dict[str, Any] | None = None,
) -> ResolvedContext:
    """Intersect preset metrics with entitlements and role."""
    product_norm = normalize_product_id(product)
    tenant = f"org{organization_id}"
    ent = load_tenant_entitlements(organization_id)

    role = "agent"
    role_name: str | None = None
    if user_id is not None:
        scope = lookup_user_scope(organization_id, user_id, product=product_norm)
        role = scope.role_name or scope.role or "agent"
        role_name = scope.role_name

    candidates = list(candidate_metric_ids or [])
    if not candidates and agent:
        granted = grant_candidates(agent, product_norm)
        if granted is not None:
            candidates = list(granted)
        else:
            catalog = reporting_catalog_for_agent(agent, product_norm)
            if catalog is not None:
                candidates = catalog
            else:
                pack = fetch_ontology_slice(
                    agent=agent, tenant=tenant, product=product_norm
                )
                _, _, _, candidates, _, _ = pack._view("compact")

    if agent:
        from semantic.tenant_overlay import grant_overrides as tenant_grant_overrides

        grant_spec = tenant_grant_overrides(tenant).get(agent) or {}
        extra_ids = grant_spec.get("metric_ids") or grant_spec.get("metrics") or []
        if extra_ids:
            seen = set(candidates)
            for mid in extra_ids:
                mid_s = str(mid)
                if mid_s not in seen:
                    candidates.append(mid_s)
                    seen.add(mid_s)

    visible = filter_metrics(
        candidates,
        organization_id=organization_id,
        user_id=user_id,
        product=product_norm,
        role=role,
        entitlements=ent,
    )
    entitled_ch = ent.channels_for_product(product_norm)
    clipped_tax = _clip_taxonomy_channel(taxonomy or {}, entitled_ch)
    visible_set = set(visible)
    headlines = [
        m
        for m in headline_metrics_for_agent(agent, product_norm)
        if m in visible_set
    ]
    if not headlines and visible:
        headlines = visible[:15]

    return ResolvedContext(
        organization_id=organization_id,
        user_id=user_id,
        product=product_norm,
        agent=agent,
        role=role,
        role_name=role_name,
        entitlements=ent,
        visible_metric_ids=visible,
        headline_metric_ids=headlines,
        metrics=[_metric_card(m, product=product_norm) for m in visible],
        taxonomy=clipped_tax,
    )

