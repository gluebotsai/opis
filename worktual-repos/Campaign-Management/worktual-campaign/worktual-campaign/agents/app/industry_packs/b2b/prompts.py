"""B2B industry-pack prompt overlays."""

from __future__ import annotations

# Thin B2B base — most B2B behavior lives in each agent's SYSTEM_PROMPT.
# industry_type (e.g. Technology & Software) is appended by loader.

B2B_BASE = (
    "\n\nCAMPAIGN PROFILE (critical):\n"
    "- Mode: B2B.\n"
    "- Speak to company contacts / accounts (job titles, company names).\n"
    "- Audience filters may use city, company, job_title.\n"
    "- Prefer business hours unless the user asks otherwise.\n"
    "- Say “contact” / “account” when it fits.\n"
)


def vertical_addendum(industry_type: str) -> str:
    vertical = (industry_type or "").strip()
    if not vertical:
        return ""
    return (
        f"\n- Industry vertical (from organization): {vertical}.\n"
        f"- Tailor campaign ideas, audience language, and template copy to "
        f"{vertical} B2B buyers — do not invent unrelated verticals.\n"
    )


def prompt_addendum(*, industry_type: str = "", module: str | None = None) -> str:
    _ = module
    return B2B_BASE + vertical_addendum(industry_type)
