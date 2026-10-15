"""A2A skill catalog for Hub agent card (Campaign spoke).

Source of truth for published skills. Card builders never invent skills at runtime.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

RiskLevel = Literal["read", "reversible_write", "high_impact"]

RESULT_SCHEMA_PATH = "/a2a/contracts/skill-result.v1.json"
ENVELOPE_SCHEMA_PATH = "/a2a/contracts/worktual-envelope.v1.json"
CATALOG_VERSION = "1.0.0"
CONTRACT_VERSION = "1.0"

EXCLUDED_CAPABILITIES: list[str] = [
    "navigate",
    "chat_clarify",
    "stage_campaign_draft",
    "template_library_browse",
    "ui_preview_only",
    "form_builder_ui",
]


@dataclass(frozen=True)
class SkillSpec:
    id: str
    name: str
    description: str
    tags: list[str]
    examples: list[str]
    scope: str
    risk: RiskLevel
    specialist: str
    surface: str
    required_argument_keys: list[str]
    orchestration: list[str] = field(default_factory=list)
    # Extra scopes when a skill needs more than one (composite).
    extra_scopes: list[str] = field(default_factory=list)

    @property
    def input_schema_path(self) -> str:
        return f"/a2a/contracts/skills/{self.id}.v1.json"

    @property
    def output_schema_path(self) -> str:
        return RESULT_SCHEMA_PATH

    def oauth_scopes(self) -> list[str]:
        scopes = [self.scope]
        for s in self.extra_scopes:
            if s not in scopes:
                scopes.append(s)
        return scopes


# Hub-facing skill ids (kebab-case) → Super Agent intent
SKILL_TO_INTENT: dict[str, str] = {
    "on-demand-send": "on_demand_send",
    "create-contact": "create_contact",
    "campaign-report": "campaign_report",
    "stop-channel": "stop_channel",
    "resume-channel": "resume_channel",
    "stop-campaign": "stop_campaign",
    "create-contact-and-send": "create_contact_and_send",
    "send-approved-whatsapp": "send_approved_whatsapp",
    "generate-image": "generate_image",
    "temp-audience-and-send": "temp_audience_and_send",
}

SKILL_SPECS: list[SkillSpec] = [
    SkillSpec(
        id="on-demand-send",
        name="On-demand send",
        description=(
            "Create a campaign from the Hub request, generate templates, and launch "
            "automatically. No clarification questions."
        ),
        tags=["campaign", "launch", "on-demand", "write"],
        examples=[
            "Email this contact about the CRM product",
            "Send WhatsApp and email promo to these CDP ids",
        ],
        scope="campaign.on_demand.execute",
        risk="high_impact",
        specialist="on_demand",
        surface="campaign-hub",
        required_argument_keys=[],
        orchestration=["on_demand"],
    ),
    SkillSpec(
        id="create-contact",
        name="Create contact",
        description=(
            "Create a CDP/campaign contact from Hub fields "
            "(first_name + email or phone)."
        ),
        tags=["contacts", "create", "write", "reversible"],
        examples=["Create contact Jane Doe with primary email"],
        scope="campaign.contact.write",
        risk="reversible_write",
        specialist="contacts",
        surface="campaign-hub",
        required_argument_keys=["first_name"],
        orchestration=["contacts"],
    ),
    SkillSpec(
        id="campaign-report",
        name="Campaign report",
        description="Load campaign performance / status analysis for a campaign_id.",
        tags=["monitoring", "analysis", "read"],
        examples=["Show report for campaign X"],
        scope="campaign.monitoring.read",
        risk="read",
        specialist="monitoring",
        surface="campaign-hub",
        required_argument_keys=["campaign_id"],
        orchestration=["monitoring"],
    ),
    SkillSpec(
        id="stop-channel",
        name="Stop channel",
        description="Pause one campaign channel. Requires campaign_id, channel, reason.",
        tags=["monitoring", "stop", "write"],
        examples=["Pause email on campaign X because bounce rate spiked"],
        scope="campaign.monitoring.write",
        risk="high_impact",
        specialist="monitoring",
        surface="campaign-hub",
        required_argument_keys=["campaign_id", "channel", "reason"],
        orchestration=["monitoring"],
    ),
    SkillSpec(
        id="resume-channel",
        name="Resume channel",
        description="Resume one paused campaign channel. Requires campaign_id, channel.",
        tags=["monitoring", "resume", "write"],
        examples=["Resume WhatsApp on campaign X"],
        scope="campaign.monitoring.write",
        risk="high_impact",
        specialist="monitoring",
        surface="campaign-hub",
        required_argument_keys=["campaign_id", "channel"],
        orchestration=["monitoring"],
    ),
    SkillSpec(
        id="stop-campaign",
        name="Stop campaign",
        description="Stop an entire campaign. Requires campaign_id and reason.",
        tags=["monitoring", "stop", "write"],
        examples=["Stop campaign X — budget exhausted"],
        scope="campaign.monitoring.write",
        risk="high_impact",
        specialist="monitoring",
        surface="campaign-hub",
        required_argument_keys=["campaign_id", "reason"],
        orchestration=["monitoring"],
    ),
    SkillSpec(
        id="create-contact-and-send",
        name="Create contact and send",
        description=(
            "Multi-skill: create contact then on-demand create+launch for that contact."
        ),
        tags=["contacts", "on-demand", "multi", "write"],
        examples=["Create Jane and email her the launch offer"],
        scope="campaign.contact.write",
        extra_scopes=["campaign.on_demand.execute"],
        risk="high_impact",
        specialist="super",
        surface="campaign-hub",
        required_argument_keys=["first_name"],
        orchestration=["contacts", "on_demand"],
    ),
    SkillSpec(
        id="send-approved-whatsapp",
        name="Send approved WhatsApp",
        description=(
            "Send an already Meta-approved WhatsApp template to Hub-provided "
            "phones or contact_ids. Hub confirmation is implied; no chat loop."
        ),
        tags=["whatsapp", "send", "content", "write"],
        examples=["Send approved promo template to +919876543210"],
        scope="campaign.whatsapp.send",
        risk="high_impact",
        specialist="whatsapp_approved",
        surface="campaign-hub",
        required_argument_keys=[],
        orchestration=["whatsapp_send"],
    ),
    SkillSpec(
        id="generate-image",
        name="Generate image",
        description=(
            "Generate a campaign image from a Hub prompt (enhance → generate). "
            "Optional campaign_id for attach context."
        ),
        tags=["image", "creative", "write"],
        examples=["Generate a hero banner for the spring sale email"],
        scope="campaign.image.generate",
        risk="reversible_write",
        specialist="image",
        surface="campaign-hub",
        required_argument_keys=["prompt"],
        orchestration=["image_gen"],
    ),
    SkillSpec(
        id="temp-audience-and-send",
        name="Temp audience and send",
        description=(
            "Accept inline contact rows (email or phone per row), then "
            "create+launch an on-demand campaign for that audience."
        ),
        tags=["contacts", "on-demand", "temp", "write"],
        examples=["Send this sheet of leads the launch offer via email"],
        scope="campaign.on_demand.execute",
        risk="high_impact",
        specialist="on_demand",
        surface="campaign-hub",
        required_argument_keys=["rows"],
        orchestration=["temp_audience_send"],
    ),
]

# Public card skill entries (id, name, description, tags) — kept for callers expecting A2A_SKILLS
A2A_SKILLS: list[dict[str, Any]] = [
    {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "tags": list(s.tags),
    }
    for s in SKILL_SPECS
]


def list_skills() -> list[SkillSpec]:
    return list(SKILL_SPECS)


def get_skill(skill_id: str) -> SkillSpec | None:
    key = str(skill_id or "").strip()
    for spec in SKILL_SPECS:
        if spec.id == key:
            return spec
    alt = key.replace("_", "-")
    for spec in SKILL_SPECS:
        if spec.id == alt:
            return spec
    return None


def all_oauth_scopes() -> dict[str, str]:
    """Map scope → description for securitySchemes.clientCredentials.scopes."""
    descriptions: dict[str, str] = {
        "campaign.on_demand.execute": "Create and launch on-demand campaigns",
        "campaign.contact.write": "Create contacts",
        "campaign.monitoring.read": "Read campaign reports",
        "campaign.monitoring.write": "Stop/resume channels or campaigns",
        "campaign.whatsapp.send": "Send approved WhatsApp templates",
        "campaign.image.generate": "Generate campaign images",
    }
    # Only publish scopes that appear on at least one skill
    used: set[str] = set()
    for spec in SKILL_SPECS:
        used.update(spec.oauth_scopes())
    return {k: descriptions.get(k, k) for k in sorted(used)}


def skill_ids() -> list[str]:
    return [s.id for s in SKILL_SPECS]


def skill_version() -> str:
    """Stable hash of skill ids — Hub JWT embeds this; stale → -32010."""
    payload = json.dumps(skill_ids(), separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def intent_for_skill(skill_id: str) -> str | None:
    key = str(skill_id or "").strip()
    if key in SKILL_TO_INTENT:
        return SKILL_TO_INTENT[key]
    alt = key.replace("_", "-")
    return SKILL_TO_INTENT.get(alt)
