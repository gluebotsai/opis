"""Load specialist agent.md into a prompt + tool allowlist."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import load_agent_md, agent_md_to_system_prompt

_ROOT = Path(__file__).resolve().parent

SPECIALISTS = {
    "email": "email",
    "whatsapp": "whatsapp",
    "web": "web",
    "web_push": "web",
    "webpush": "web",
    "push": "push",
    "app_push": "push",
    "apppush": "push",
}

SHARED_TOOLS = (
    "show_current_template",
    "list_session_images",
    "generate_image",
    "enhance_image",
    "request_template_change",
    "search_knowledge",
    "undo_template",
    "redo_template",
    "save_template",
    "handoff_campaign_launch",
    "get_edit_preferences",
    "update_edit_preference",
    "verify_hard_preferences",
)

CHANNEL_TOOLS: dict[str, tuple[str, ...]] = {
    "email": SHARED_TOOLS,
    "whatsapp": SHARED_TOOLS,
    "web": SHARED_TOOLS,
    "push": SHARED_TOOLS,
}

CANVAS_SHARED = (
    "attach_uploaded_image",
    "remove_image",
    "set_footer_social_links",
    "redesign_template",
)

CANVAS_TOOLS: dict[str, tuple[str, ...]] = {
    "email": CANVAS_SHARED
    + (
        "edit_email_html",
        "add_cta",
        "update_cta",
        "remove_cta",
        "set_email_theme",
    ),
    "whatsapp": CANVAS_SHARED + ("apply_template_changes", "add_cta"),
    "web": CANVAS_SHARED + ("apply_template_changes",),
    "push": CANVAS_SHARED + ("apply_template_changes",),
}


@dataclass
class AgentDefinition:
    name: str
    channel: str
    sections: dict[str, str]
    mcp_servers: tuple[str, ...]
    handoff_targets: tuple[str, ...]
    tool_names: tuple[str, ...]

    def system_prompt(self, runtime_context: str = "") -> str:
        return agent_md_to_system_prompt(self.sections, runtime_context=runtime_context)


def specialist_channel(channel: str) -> str:
    key = str(channel or "").strip().lower()
    return SPECIALISTS.get(key, "email" if key == "email" else (key or "email"))


def load_specialist(channel: str) -> AgentDefinition:
    spec = specialist_channel(channel)
    if spec not in CHANNEL_TOOLS:
        spec = "email"
    path = _ROOT / spec / "agent.md"
    sections = load_agent_md(path) if path.is_file() else {"role": spec}
    return AgentDefinition(
        name=f"{spec}_edit",
        channel=spec,
        sections=sections,
        mcp_servers=("campaign_template_edit",),
        handoff_targets=("create_campaign",),
        tool_names=CHANNEL_TOOLS[spec],
    )


def load_canvas_specialist(channel: str) -> AgentDefinition:
    spec = specialist_channel(channel)
    if spec not in CANVAS_TOOLS:
        spec = "email"
    path = _ROOT / "canvas" / "agent.md"
    sections = load_agent_md(path) if path.is_file() else {"role": "template_canvas"}
    return AgentDefinition(
        name="template_canvas",
        channel=spec,
        sections=sections,
        mcp_servers=("campaign_template_edit",),
        handoff_targets=(),
        tool_names=CANVAS_TOOLS[spec],
    )


def industry_runtime_block(session: dict[str, Any] | None) -> str:
    from app.industry_packs.loader import normalize_campaign_profile, prompt_addendum

    sess = session if isinstance(session, dict) else {}
    profile = sess.get("campaign_profile")
    pack = sess.get("company_pack") if isinstance(sess.get("company_pack"), dict) else {}
    p = normalize_campaign_profile(profile)
    brand = pack.get("brand") if isinstance(pack.get("brand"), dict) else {}
    lines = [
        f"industry_type={p.get('industry_type') or p.get('industry') or ''}",
        f"mode={p.get('mode') or ''}",
    ]
    logo = str(brand.get("logo_url") or brand.get("logo") or "").strip()
    if logo:
        lines.append(f"brand_logo={logo[:160]}")
    addendum = prompt_addendum(profile, module="create_campaign", company_pack=pack)
    if addendum:
        lines.append(addendum[:800])
    return "\n".join(lines)
