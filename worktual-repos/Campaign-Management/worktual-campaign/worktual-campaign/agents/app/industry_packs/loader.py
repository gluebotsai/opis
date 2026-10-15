"""Industry pack helpers for agent prompts (overlay from join_session)."""

from __future__ import annotations

from typing import Any

from app.industry_packs.b2b import prompts as b2b_prompts
from app.industry_packs.b2c import prompts as b2c_prompts
from app.industry_packs.fields import contact_fields_addendum


_DEFAULT = {
    "mode": "b2b",
    "industry": "generic-b2b",
    "industry_type": "",
}

_PACK_IDS = frozenset(
    {
        "generic-b2b",
        "generic-b2c",
        "b2b",
        "b2c",
        "consumer",
        "finance",
        "fintech",
        "banking",
    }
)


def normalize_campaign_profile(raw: Any) -> dict[str, str]:
    """Normalize join_session campaign_profile.

    Keys:
      mode: b2b | b2c
      industry: generic-b2b | generic-b2c (pack id)
      industry_type: vertical from accounts.organizations.industry_type
    """
    if not isinstance(raw, dict):
        return dict(_DEFAULT)

    industry_type = str(
        raw.get("industry_type")
        or raw.get("industryType")
        or raw.get("vertical")
        or ""
    ).strip()

    raw_industry = str(raw.get("industry") or raw.get("domain") or "").strip()
    industry = raw_industry.lower()
    mode = str(raw.get("mode") or "").strip().lower()
    # If FE/session put the vertical on industry (e.g. "clothing"), keep it.
    if raw_industry and industry not in _PACK_IDS and not industry_type:
        industry_type = raw_industry

    # Legacy finance aliases → generic B2C pack.
    if industry in ("finance", "fintech", "banking", "generic-b2c", "b2c", "consumer"):
        industry = "generic-b2c"
        mode = mode or "b2c"
    elif mode == "b2c":
        industry = "generic-b2c"
    else:
        industry = "generic-b2b"
        mode = mode or "b2b"

    if mode not in ("b2b", "b2c"):
        mode = "b2c" if industry == "generic-b2c" else "b2b"

    return {
        "mode": mode,
        "industry": industry,
        "industry_type": industry_type,
    }


def merge_campaign_profile(
    existing: Any,
    incoming: Any = None,
    *,
    seed_industry_type: str = "",
) -> dict[str, str]:
    """Login profile: join wins mode/pack; vertical never drops once known."""
    base = normalize_campaign_profile(existing)
    seed = str(seed_industry_type or "").strip()
    if isinstance(incoming, dict):
        nxt = normalize_campaign_profile(incoming)
        vertical = nxt["industry_type"] or base["industry_type"] or seed
        return {
            "mode": nxt["mode"],
            "industry": nxt["industry"],
            "industry_type": vertical,
        }
    return {
        "mode": base["mode"],
        "industry": base["industry"],
        "industry_type": base["industry_type"] or seed,
    }


def stamp_campaign_industry(
    campaign: dict[str, Any] | None, profile: Any
) -> dict[str, Any]:
    """Copy login vertical onto the campaign dict used by template writers."""
    p = normalize_campaign_profile(profile)
    out = dict(campaign) if isinstance(campaign, dict) else {}
    out["mode"] = p["mode"]
    vertical = p["industry_type"]
    if vertical:
        out["industry_type"] = vertical
        # Writers historically read campaign.industry — use the org vertical
        # (e.g. clothing), never the pack id generic-b2c.
        out["industry"] = vertical
    elif not str(out.get("industry") or "").strip():
        out["industry"] = p["industry"]
    return out


def apply_login_profile_to_session(
    session: dict[str, Any],
    incoming: Any = None,
) -> dict[str, Any]:
    """Persist login industry into campaign_profile + chat_memory_note."""
    pack = (
        session.get("company_pack")
        if isinstance(session.get("company_pack"), dict)
        else {}
    )
    seed = str(pack.get("seed_industry_type") or "").strip()
    profile = merge_campaign_profile(
        session.get("campaign_profile"),
        incoming,
        seed_industry_type=seed,
    )
    session["campaign_profile"] = profile
    try:
        from app.agents.create_campaign.memory_note import upsert_industry_memory_note

        upsert_industry_memory_note(session, profile)
    except Exception:  # noqa: BLE001
        pass
    return session


def is_b2c_profile(profile: Any) -> bool:
    return normalize_campaign_profile(profile)["mode"] == "b2c"


def is_finance_profile(profile: Any) -> bool:
    """Deprecated: Finance sandbox removed. Always False."""
    return False


def prompt_addendum(
    profile: Any,
    module: str | None = None,
    company_pack: Any = None,
) -> str:
    p = normalize_campaign_profile(profile)
    if p["mode"] == "b2c":
        base = b2c_prompts.prompt_addendum(
            industry_type=p["industry_type"],
            module=module,
        )
    else:
        base = b2b_prompts.prompt_addendum(
            industry_type=p["industry_type"],
            module=module,
        )
    mod = (module or "").strip().lower()
    if mod == "contacts":
        base += contact_fields_addendum(
            mode=p["mode"],
            industry_type=p["industry_type"],
        )
    if mod in (
        "contacts",
        "create_campaign",
        "recommendation_run",
        "library_run",
        "recommendations",
    ):
        from app.industry_packs.tenant_pack import company_pack_addendum

        base += company_pack_addendum(company_pack)
    return base


def welcome_create(profile: Any = None) -> str | None:
    p = normalize_campaign_profile(profile)
    if p["mode"] == "b2c":
        return b2c_prompts.welcome_create(p["industry_type"])
    return None


def welcome_recommendations(profile: Any = None) -> str | None:
    p = normalize_campaign_profile(profile)
    if p["mode"] == "b2c":
        return b2c_prompts.welcome_recommendations(p["industry_type"])
    return None


def welcome_override(module: str, profile: Any = None, **kwargs: Any) -> str | None:
    """B2C welcome for task agents. None → keep that agent’s default (B2B)."""
    p = normalize_campaign_profile(profile)
    if p["mode"] != "b2c":
        return None
    mod = (module or "").strip().lower()
    vertical = p["industry_type"]
    vertical_bit = f" ({vertical})" if vertical else ""

    if mod == "create_campaign":
        return welcome_create(profile)
    if mod == "recommendations":
        return welcome_recommendations(profile)

    if mod == "contacts":
        focus = kwargs.get("focus_contact_id")
        draft = kwargs.get("draft_contact") or {}
        cite = ""
        if isinstance(draft, dict):
            cite = str(draft.get("email") or draft.get("phone") or "").strip()
        if focus:
            if cite:
                return (
                    f"Ask — edit this customer ({cite}) or look up another? "
                    "Tell me what to change."
                )
            return (
                "Ask — edit this customer or look up another? "
                "I can confirm using the email or phone already on file."
            )
        return None

    if mod == "monitoring":
        name = str(kwargs.get("campaign_name") or "").strip()
        focus = kwargs.get("focus_campaign_id")
        if focus:
            label = name or "this campaign"
            return (
                f"Hi — I’m the monitoring agent{vertical_bit}. I can report on {label} "
                "(who was selected, sent, or missed; email opens/clicks)."
            )
        return (
            f"Hi — I’m the monitoring agent{vertical_bit}. I can report on live, "
            "scheduled, or past customer campaigns. Ask for sent, opens, or who was reached."
        )

    if mod == "reports":
        return (
            f"Hi — I’m the reports agent{vertical_bit}. Ask about customer-campaign "
            "performance (live, scheduled, past — sent, opens, clicks)."
        )

    if mod == "forms":
        return (
            f"Hi — I’m the forms agent{vertical_bit}. I can design marketing forms "
            "(product interest, offer signup, referral). What do you need "
            "(goal, fields, colors, or layout)?"
        )

    if mod == "whatsapp_approved":
        t = str(kwargs.get("template_name") or "this approved template").strip()
        c = str(kwargs.get("campaign_name") or "").strip()
        if c:
            return (
                f"We'll send approved WhatsApp template “{t}” for “{c}” to customers. "
                "Who should receive it — phone numbers with country code, or a city segment?"
            )
        return (
            f"We'll send approved WhatsApp template “{t}” to customers as-is. "
            "Who should receive it — phone numbers with country code, or a city segment?"
        )

    if mod == "whatsapp_rejected":
        t = str(kwargs.get("template_name") or "this template").strip()
        r = str(kwargs.get("reason") or "").strip()
        if r:
            return (
                f"“{t}” was rejected ({r}). Tell me what to change — "
                "I'll keep the copy suitable for customers, then we can resubmit."
            )
        return (
            f"“{t}” was rejected by Meta. Tell me what to change for this "
            "customer template, then we can submit again."
        )

    if mod == "events_report":
        return (
            f"Hi — I'm your events co-worker{vertical_bit}. "
            "Ask about drafts, launched forms, submissions, and opens — "
            "or tell me to create a form or event."
        )

    return None
