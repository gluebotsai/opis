"""Brand guidelines executor — logo / banner / footer from org pack + campaign.

Soft: empty brand is OK (compose invents no URLs). Does not rewrite Phase 2 prompts;
facts land on the workspace for the compose user message.
"""

from __future__ import annotations

from typing import Any

from app.mas.phase2_compose.schemas import envelope
from app.mas.phase2_compose.skills import Skill
from app.mas.phase2_compose.workspace import Workspace

SKILL: Skill = {
    "id": "brand_guidelines",
    "does": "Resolve logo, top banner, footer, and brand colors for the email",
    "needs": ["query"],
    "provides": ["brand_guidelines", "logo_url", "footer"],
    "failure": "soft",
}


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _http(url: Any) -> str:
    u = _clean(url)
    if u.lower().startswith(("http://", "https://")) and "{{" not in u:
        return u[:2048]
    return ""


def _pack_brand(pack: dict[str, Any]) -> dict[str, Any]:
    brand = pack.get("brand") if isinstance(pack.get("brand"), dict) else {}
    if brand:
        return brand
    payload = pack.get("payload") if isinstance(pack.get("payload"), dict) else {}
    nested = payload.get("brand") if isinstance(payload.get("brand"), dict) else {}
    return nested if isinstance(nested, dict) else {}


def _guidelines_from_ctx(ctx: dict[str, Any]) -> dict[str, Any]:
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
    try:
        from app.agents.template_library.email_brand import extract_brand_from_context

        brand = extract_brand_from_context(company_pack=pack, campaign=campaign)
    except Exception:  # noqa: BLE001
        brand = {}

    out: dict[str, Any] = dict(brand) if isinstance(brand, dict) else {}
    pack_brand = _pack_brand(pack)

    logo = _http(
        out.get("logo_url")
        or campaign.get("logo_url")
        or campaign.get("logo")
        or pack_brand.get("logo_url")
        or pack_brand.get("logo")
    )
    banner = _http(
        campaign.get("top_banner_url")
        or campaign.get("banner_url")
        or campaign.get("header_image")
        or pack_brand.get("top_banner_url")
        or pack_brand.get("banner_url")
    )
    footer_text = _clean(
        campaign.get("footer_text") or pack_brand.get("footer_text")
    )

    if logo:
        out["logo_url"] = logo
    if banner:
        out["top_banner_url"] = banner
    if footer_text:
        out["footer_text"] = footer_text[:500]
    if out.get("footer_links") or out.get("social_links") or footer_text:
        out["footer"] = {
            "text": footer_text[:500] if footer_text else "",
            "links": list(out.get("footer_links") or []),
            "social_links": list(out.get("social_links") or []),
        }
    return {k: v for k, v in out.items() if v not in (None, "", [], {})}


async def run(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    guidelines = _guidelines_from_ctx(ctx)
    if not guidelines:
        workspace.append_warning("brand_guidelines_empty")
        return envelope(
            executor_id="brand_guidelines",
            status="soft_fail",
            payload={"brand_guidelines": {}},
            warnings=["brand_guidelines_empty"],
        )
    return envelope(
        executor_id="brand_guidelines",
        status="completed",
        payload={"brand_guidelines": guidelines},
    )
