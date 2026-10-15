"""B2C industry-pack prompt overlays."""

from __future__ import annotations

B2C_BASE = (
    "\n\nCAMPAIGN PROFILE (critical):\n"
    "- Mode: B2C.\n"
    "- Speak to shoppers / end customers, not company job titles.\n"
    "- Audience: city / segment / product interest — do not require "
    "company + job_title.\n"
    "- Timing: consumer hours are OK unless the user asks otherwise.\n"
    "- Prefer MARKETING campaigns (offers, launches, win-back, referrals).\n"
    "- Do not auto-filter audience from the campaign idea. Ask who, then filter.\n"
    "- Say “customer” not “contact” when it fits naturally.\n"
)


def vertical_addendum(industry_type: str) -> str:
    vertical = (industry_type or "").strip()
    if not vertical:
        return (
            "\n- Industry vertical: generic consumer. "
            "Keep ideas broadly consumer-friendly.\n"
        )
    return (
        f"\n- Industry vertical (from organization): {vertical}.\n"
        f"- You are the marketing specialist for {vertical} (B2C). "
        f"Recommend campaigns, audiences, and copy that fit {vertical} "
        f"customers — e.g. products, offers, and journeys typical of that vertical. "
        f"Do not invent rates/prices/claims; stay factual.\n"
    )


def prompt_addendum(*, industry_type: str = "", module: str | None = None) -> str:
    _ = module
    return B2C_BASE + vertical_addendum(industry_type)


def welcome_create(industry_type: str = "") -> str:
    # Same static opener as B2B (and frontend seed) for both modes.
    _ = industry_type
    return (
        "Hi — I'll help you create a campaign.\n"
        "Share the name, goal, and objective, or say create all details on your own "
        "and I'll propose a full plan (audience + channels) for you to confirm."
    )


def welcome_recommendations(industry_type: str = "") -> str:
    vertical = (industry_type or "").strip()
    focus = f" for {vertical}" if vertical else ""
    return (
        f"Hi — I’ll recommend campaigns{focus} from your past results when you have them, "
        "or from knowledge if you have not sent yet. Cards show on the board when ready."
    )
