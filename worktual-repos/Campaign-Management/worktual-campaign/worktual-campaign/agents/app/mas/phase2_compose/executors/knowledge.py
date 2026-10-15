"""Knowledge executor — company/campaign facts from ctx; no canned brand stubs."""

from __future__ import annotations

import os
from typing import Any

from app.mas.phase2_compose.schemas import envelope
from app.mas.phase2_compose.skills import Skill
from app.mas.phase2_compose.workspace import Workspace

SKILL: Skill = {
    "id": "knowledge",
    "does": "Retrieve company/brand facts for the request",
    "needs": ["query"],
    "provides": ["company_profile", "brand_voice", "knowledge"],
    "failure": "soft",
}

# No canned brand stubs — knowledge comes from campaign, pack, or KB only.


def _clip(text: Any, limit: int = 240) -> str:
    t = str(text or "").strip()
    if len(t) <= limit:
        return t
    return t[: max(0, limit - 1)].rstrip() + "…"


def _facts_from_pack(pack: dict[str, Any]) -> dict[str, Any]:
    """Soft facts from tenant company_pack — no invention of URLs or claims."""
    out: dict[str, Any] = {"do_not_invent": True}
    industry = _clip(
        pack.get("seed_industry_type") or pack.get("seedIndustryType"), 80
    )
    mode = _clip(pack.get("mode"), 24)
    if industry:
        out["industry"] = industry
    if mode:
        out["mode"] = mode
    brand = pack.get("brand") if isinstance(pack.get("brand"), dict) else {}
    payload = pack.get("payload") if isinstance(pack.get("payload"), dict) else {}
    if not brand and isinstance(payload.get("brand"), dict):
        brand = payload["brand"]
    name = _clip(
        brand.get("name")
        or brand.get("company_name")
        or pack.get("company_name")
        or pack.get("name"),
        120,
    )
    if name:
        out["company"] = name
    voice = _clip(brand.get("voice") or brand.get("tone"), 120)
    if voice:
        out["voice"] = voice
    # Active pack field labels (values only when non-empty) — soft context.
    fields = pack.get("fields") if isinstance(pack.get("fields"), list) else []
    if not fields and isinstance(payload.get("fields"), list):
        fields = payload["fields"]
    soft: dict[str, str] = {}
    for row in fields[:24]:
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "active").lower() == "suggested":
            continue
        label = _clip(row.get("label") or row.get("key") or row.get("id"), 60)
        val = _clip(row.get("value") or row.get("text") or "", 160)
        if label and val:
            soft[label] = val
    if soft:
        out["pack_fields"] = soft
    return {k: v for k, v in out.items() if v is not True or k == "do_not_invent"}


def _facts_from_campaign(campaign: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"do_not_invent": True}
    name = _clip(campaign.get("name") or campaign.get("company_name"), 120)
    if name:
        out["campaign_name"] = name
    company = _clip(campaign.get("company_name") or campaign.get("brand_name"), 120)
    if company:
        out["company"] = company
    goal = _clip(campaign.get("goal"), 200)
    objective = _clip(campaign.get("objective"), 200)
    if goal:
        out["goal"] = goal
    if objective:
        out["objective"] = objective
    industry = _clip(campaign.get("industry") or campaign.get("vertical"), 80)
    if industry:
        out["industry"] = industry
    return out


def _facts_from_ctx(ctx: dict[str, Any]) -> dict[str, Any]:
    """Tenant/session labels only — never invent a brand or industry."""
    out: dict[str, Any] = {}
    company = _ctx_text(ctx, "organization_name", "company_name", "org_name")
    industry = _ctx_text(ctx, "industry", "industry_type", "seed_industry_type")
    if company:
        out["company"] = company
    if industry:
        out["industry"] = industry
    return out


def _facts_from_profile(profile: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("company", "company_name", "name", "industry", "voice", "tone"):
        val = _clip(profile.get(key), 160)
        if not val:
            continue
        if key in ("company", "company_name", "name"):
            out.setdefault("company", val)
        elif key == "tone":
            out.setdefault("voice", val)
        else:
            out[key] = val
    if out:
        out["do_not_invent"] = True
    return out


def _ctx_text(ctx: dict[str, Any], *keys: str) -> str:
    task = dict(ctx.get("task_spec") or {})
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    for source in (task, ctx, session):
        if not isinstance(source, dict):
            continue
        for key in keys:
            val = _clip(source.get(key), 120)
            if val:
                return val
    return ""


def _has_verified_product_facts(facts: dict[str, Any]) -> bool:
    if str(facts.get("kb_snippets") or facts.get("verified_snippet") or "").strip():
        return True
    hits = facts.get("kb_hits")
    if isinstance(hits, list) and hits:
        return True
    pack_fields = facts.get("pack_fields")
    return isinstance(pack_fields, dict) and bool(pack_fields)


def _organization_id(ctx: dict[str, Any]) -> str:
    task = dict(ctx.get("task_spec") or {})
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    for source in (task, ctx, session):
        if not isinstance(source, dict):
            continue
        for key in ("organization_id", "organizationId", "tenant_id"):
            val = str(source.get(key) or "").strip()
            if val:
                return val
    return ""


def _build_knowledge(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    task = dict(ctx.get("task_spec") or {})
    campaign = task.get("campaign") if isinstance(task.get("campaign"), dict) else {}
    if not campaign and isinstance(ctx.get("campaign"), dict):
        campaign = ctx["campaign"]
    pack = (
        task.get("company_pack")
        if isinstance(task.get("company_pack"), dict)
        else ctx.get("company_pack")
        if isinstance(ctx.get("company_pack"), dict)
        else {}
    )
    profile = (
        task.get("campaign_profile")
        if isinstance(task.get("campaign_profile"), dict)
        else ctx.get("campaign_profile")
        if isinstance(ctx.get("campaign_profile"), dict)
        else {}
    )
    verified = str(
        task.get("knowledge") or ctx.get("knowledge") or ""
    ).strip()

    merged: dict[str, Any] = {"do_not_invent": True}
    for part in (
        _facts_from_pack(pack),
        _facts_from_campaign(campaign),
        _facts_from_profile(profile),
        _facts_from_ctx(ctx),
    ):
        for k, v in part.items():
            if k == "do_not_invent":
                continue
            if k == "pack_fields" and isinstance(v, dict):
                base = dict(merged.get("pack_fields") or {})
                base.update(v)
                merged["pack_fields"] = base
            elif v and k not in merged:
                merged[k] = v
    if verified:
        merged["verified_snippet"] = _clip(verified, 800)

    # Drop empty shell
    useful = {k: v for k, v in merged.items() if k != "do_not_invent" and v}
    if useful:
        useful["do_not_invent"] = True
        return useful
    return {}


async def run(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    if os.environ.get("COMPOSE_FORCE_KB_FAIL", "").strip() in ("1", "true", "yes"):
        workspace.append_warning("kb_unavailable")
        return envelope(
            executor_id="knowledge",
            status="soft_fail",
            payload={"knowledge": {}},
            warnings=["kb_unavailable"],
        )

    facts = _build_knowledge(ctx, workspace)
    org = _organization_id(ctx)
    query = str(workspace.query or "").strip()
    if not query:
        query = str(facts.get("objective") or facts.get("goal") or facts.get("campaign_name") or "").strip()
    if org and query:
        try:
            from app.integrations.context_layer import search_campaign_knowledge

            kb = await search_campaign_knowledge(organization_id=org, query=query)
            hits = kb.get("results") if isinstance(kb.get("results"), list) else []
            snippets = str(kb.get("snippets") or "").strip()
            if hits:
                facts["kb_hits"] = hits[:6]
            if snippets:
                facts["kb_snippets"] = _clip(snippets, 2400)
            elif kb.get("error"):
                workspace.append_warning("kb_unavailable")
        except Exception:  # noqa: BLE001
            workspace.append_warning("kb_unavailable")

    useful = {k: v for k, v in facts.items() if k != "do_not_invent" and v}
    if org and not _has_verified_product_facts(useful):
        workspace.append_warning("kb_unavailable")

    if useful and _has_verified_product_facts(useful):
        useful["do_not_invent"] = True
        useful.setdefault("copy_mode", "verified")
        return envelope(
            executor_id="knowledge",
            status="completed",
            payload={"knowledge": useful},
        )

    if useful:
        useful["do_not_invent"] = True
        useful.setdefault("copy_mode", "campaign")
        useful.setdefault(
            "copy_guidance",
            "Use only campaign, pack, and tenant fields. Do not invent a brand, "
            "product features, prices, or addresses. Never use square-bracket "
            "placeholders or lorem.",
        )
        return envelope(
            executor_id="knowledge",
            status="completed",
            payload={"knowledge": useful},
        )

    return envelope(
        executor_id="knowledge",
        status="completed",
        payload={
            "knowledge": {
                "do_not_invent": True,
                "copy_mode": "none",
                "copy_guidance": (
                    "No company knowledge. Write from the user request and campaign "
                    "name only. Do not invent a brand, product list, or placeholders."
                ),
            }
        },
    )
