"""Live Hub-facing skill catalog projected from CRM registries."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, FrozenSet, Iterable

from app.agents.named_native import MEETING_AGENTS, MUTATION_AGENTS
from app.skills.catalog import B2B_BUSINESS, SPECS

NamedRegistry = dict[str, Any]

# Corpus, chained mail, and chat stubs — never a Hub skill.
EXCLUDE_NAMED_AGENTS = frozenset(
    {
        "hello",
        "chat",
        "crm-agent",
        "send-outbound-email",
        "hygiene",
        "daily-briefing",
        "assist-meeting",
        "document-template",
        "document-template-edit",
        "document-template-chat",
        "prospect-search",
        "prospect-qualify",
        "prospect-personnel",
        "proposal-corpus-ingest",
        "proposal-corpus-extract",
        "proposal-corpus-structure",
        "proposal-corpus-pair",
        "proposal-corpus-case-study",
        "proposal-corpus-design-geometry",
        "proposal-corpus-design-critique",
        "proposal-corpus-section-deep",
        "proposal-corpus-features",
        "proposal-playbook-freeze",
        "proposal-playbook-synthesize",
        "proposal-playbook-cluster",
        "proposal-playbook-qa",
        "proposal-requirement-profile",
        "proposal-playbook-match",
        "proposal-outline",
        "proposal-kb-retrieve",
        "proposal-plan",
        "proposal-brief",
        "proposal-generate",
        "proposal-fill-template",
        "proposal-generate-section",
        "proposal-title",
        "proposal-content-qa",
    }
)
EXCLUDE_COWORKER_SKILLS = frozenset({"reports", "nurture", "scoring", "lifecycle"})

# New REGISTRY agents stay off the public card until added here.
HUB_PUBLISHED_NAMED_AGENTS = frozenset(
    {
        "enrich-lead",
        "score-lead",
        "summarize-lead",
        "nurture-lead",
        "lifecycle-lead",
        "assign-sales",
        "welcome-lead",
        "owner-change-notify",
        "audit-forecast",
        "compliance-privacy",
        "invoice-escalation",
        "expansion-matcher",
        "analyze-transcript",
        "auto-reply-email",
        "meeting-brief-email",
        "meeting-mom",
        "meeting-miss-escalation",
        "post-meeting-process",
        "sales-coach",
        "compose-email",
        "document-clone-personalize",
        "proposal-content",
    }
)

COWORKER_MODULE = {
    "contact-crud": "contact",
    "company-crud": "company",
    "proposals": "proposal",
    "quotes": "quotes",
    "invoices": "finance",
    "activities": "activities",
    "meetings": "activities",
    "deals": "sales",
}

# Person-oriented Hub skills: advertise cdpId even when dispatch maps it to contactId.
_HUB_CDP_SKILLS = frozenset(
    {
        "contact-crud",
        "activities",
        "meetings",
        "deals",
        "proposals",
        "quotes",
        "invoices",
        "enrich-lead",
        "score-lead",
        "summarize-lead",
        "nurture-lead",
        "lifecycle-lead",
        "assign-sales",
        "welcome-lead",
        "owner-change-notify",
        "compose-email",
    }
)

COWORKER_BLURBS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "contact-crud": (
        "Contact overlay",
        "Create or update the CRM overlay for a known person. Hub must send "
        "organizationId, cdpId, and instruction with the fields to write. CRM "
        "persists the overlay; it does not search, list, or return contacts.",
        ("Update this person's phone and title in CRM",),
    ),
    "company-crud": (
        "Company",
        "Create or update a CRM company. Hub must send organizationId and "
        "instruction, plus companyId when updating an existing company. CRM "
        "does not search or list companies.",
        ("Update this company's industry in CRM",),
    ),
    "proposals": (
        "Proposals",
        "Create or update a deal-linked proposal. Hub must send organizationId, "
        "dealId, cdpId, and instruction. CRM persists the document; it does not "
        "list proposals.",
        ("Create a proposal on this deal",),
    ),
    "quotes": (
        "Quotes",
        "Create or update a deal-linked quote. Hub must send organizationId, "
        "dealId, cdpId, and instruction. CRM persists the quote; it does not "
        "list quotes.",
        ("Create a quote on this deal",),
    ),
    "invoices": (
        "Invoices",
        "Create or update a deal-linked invoice (B2B only). Hub must send "
        "organizationId, dealId or invoiceId, cdpId, and instruction. CRM "
        "persists the invoice; it does not list invoices.",
        ("Create an invoice on this deal",),
    ),
    "activities": (
        "Activities",
        "Log a CRM activity on a known person. Hub must send organizationId, "
        "cdpId, and instruction (type plus description). CRM persists the "
        "activity; it does not list history.",
        ("Log a follow-up task after this person's score increased",),
    ),
    "meetings": (
        "Meetings",
        "Schedule or log a CRM meeting for a known person. Hub must send "
        "organizationId, cdpId, and instruction (time and attendees if known). "
        "CRM persists the meeting activity; it does not run a live assistant.",
        ("Schedule a follow-up meeting with this person",),
    ),
    "deals": (
        "Deals",
        "Create or update a CRM deal for a known person (B2B). Hub must send "
        "organizationId, cdpId, and instruction (name, stage, amount). CRM "
        "persists the deal; it does not list pipelines.",
        ("Create a deal for this person in Negotiate",),
    ),
}

NAMED_BLURBS: dict[str, tuple[str, str, tuple[str, ...], tuple[str, ...]]] = {
    "enrich-lead": (
        "Enrich Lead",
        "Enrich the CRM contact overlay from authorized firmographic context. "
        "Hub must send organizationId and cdpId. CRM writes overlay fields; it "
        "does not search or return a dossier.",
        ("crm", "lead", "enrich", "proactive"),
        ("Enrich this person's CRM overlay",),
    ),
    "score-lead": (
        "Score Lead",
        "Score this person (fit + intent) and persist hot/warm/cold on the CRM "
        "overlay. Hub must send organizationId and cdpId. CRM does not return "
        "a contact read model.",
        ("crm", "lead", "score", "proactive"),
        ("Score this person and persist the band",),
    ),
    "summarize-lead": (
        "Summarize Lead",
        "Write and persist the CRM lead summary from authorized context. Hub "
        "must send organizationId and cdpId.",
        ("crm", "lead", "summary", "proactive"),
        ("Write this person's CRM lead summary",),
    ),
    "nurture-lead": (
        "Nurture Lead",
        "Decide and run LLM-led nurture for a below-gate lead, then persist the "
        "outcome. Hub must send organizationId and cdpId.",
        ("crm", "lead", "nurture", "proactive"),
        ("Nurture this person under existing gate rules",),
    ),
    "lifecycle-lead": (
        "Lead Lifecycle",
        "Recommend and apply a valid lead lifecycle transition, then persist it. "
        "Hub must send organizationId and cdpId.",
        ("crm", "lead", "lifecycle", "proactive"),
        ("Advance this person's lead lifecycle",),
    ),
    "assign-sales": (
        "Assign Sales",
        "Assign a sales-ready lead to a rep under existing gate rules and persist "
        "ownership. Hub must send organizationId and cdpId.",
        ("crm", "assign", "sales", "proactive"),
        ("Assign this person to a sales rep",),
    ),
    "welcome-lead": (
        "Welcome Lead",
        "Compose the first-touch welcome email after assignment. Hub must send "
        "organizationId and cdpId. CRM drafts (and may send) via CRM mail.",
        ("crm", "welcome", "email"),
        ("Compose the welcome email for this person",),
    ),
    "owner-change-notify": (
        "Owner Change Notify",
        "Notify stakeholders after a contact owner change. Hub must send "
        "organizationId and cdpId.",
        ("crm", "owner", "notify"),
        ("Notify stakeholders of this person's new owner",),
    ),
    "audit-forecast": (
        "Forecast Audit",
        "Audit a deal forecast using authorized CRM facts and persist the "
        "assessment. Hub must send organizationId and dealId.",
        ("crm", "forecast", "deal"),
        ("Audit this deal's forecast",),
    ),
    "compliance-privacy": (
        "Compliance Privacy",
        "Assess inbound content for privacy/compliance handling. Hub must send "
        "organizationId and body.",
        ("crm", "compliance", "privacy"),
        ("Assess this inbound message for privacy handling",),
    ),
    "invoice-escalation": (
        "Invoice Escalation",
        "Escalate an overdue or blocked invoice under finance rules (B2B). Hub "
        "must send organizationId and invoiceId.",
        ("crm", "invoice", "finance", "b2b"),
        ("Escalate this overdue invoice",),
    ),
    "expansion-matcher": (
        "Expansion Matcher",
        "Match expansion signals for a known company and persist the match. Hub "
        "must send organizationId and companyId.",
        ("crm", "expansion", "company"),
        ("Match expansion signals for this company",),
    ),
    "analyze-transcript": (
        "Analyze Transcript",
        "Analyze a supplied meeting transcript for CRM follow-up. Hub must send "
        "organizationId and transcript. CRM does not fetch recordings.",
        ("crm", "meeting", "transcript"),
        ("Analyze this transcript and persist follow-ups",),
    ),
    "auto-reply-email": (
        "Auto Reply Email",
        "Decide and draft an inbound email auto-reply, then persist the draft. "
        "Hub must send organizationId and activityId of the inbound mail.",
        ("crm", "email", "inbox"),
        ("Draft an auto-reply to this inbound email",),
    ),
    "meeting-brief-email": (
        "Meeting Brief Email",
        "Compose owner/participant meeting brief emails for an existing meeting "
        "activity. Hub must send organizationId and activityId.",
        ("crm", "meeting", "email"),
        ("Compose the meeting brief emails for this activity",),
    ),
    "meeting-mom": (
        "Meeting Minutes",
        "Generate minutes of meeting from a supplied transcript and persist them. "
        "Hub must send organizationId and transcript.",
        ("crm", "meeting", "mom"),
        ("Write minutes from this transcript",),
    ),
    "meeting-miss-escalation": (
        "Meeting Miss Escalation",
        "Escalate a missed meeting under existing rules. Hub must send "
        "organizationId and instruction (and activityId when known).",
        ("crm", "meeting", "miss"),
        ("Escalate this missed meeting",),
    ),
    "post-meeting-process": (
        "Post Meeting Process",
        "Run post-meeting follow-up decisions and artifacts from a supplied "
        "transcript. Hub must send organizationId and transcript.",
        ("crm", "meeting", "follow-up"),
        ("Process follow-ups from this meeting transcript",),
    ),
    "sales-coach": (
        "Sales Coach",
        "Produce coaching feedback from a supplied call/meeting transcript. Hub "
        "must send organizationId and transcript.",
        ("crm", "coaching", "sales"),
        ("Coach this call from the transcript",),
    ),
    "compose-email": (
        "Compose Email",
        "Compose a CRM email for a known person. Hub must send organizationId, "
        "cdpId, and instruction. When actionType is send_email, the spoke "
        "composes then sends via CRM bot and logs the activity.",
        ("crm", "email", "compose"),
        ("Compose a follow-up email to this person",),
    ),
    "document-clone-personalize": (
        "Clone Personalize Document",
        "Personalize a cloned proposal, quote, or invoice from supplied document "
        "ids. Hub must send organizationId, instruction, and the source document "
        "id. CRM does not browse templates.",
        ("crm", "document", "personalize"),
        ("Personalize this cloned proposal for the deal",),
    ),
    "proposal-content": (
        "Proposal Content",
        "Generate or rewrite proposal sections from an existing deal (B2B). Hub "
        "must send organizationId, dealId, and instruction.",
        ("crm", "proposal", "content", "b2b"),
        ("Rewrite the introduction on this proposal",),
    ),
}


@dataclass(frozen=True)
class SpokeSkill:
    id: str
    name: str
    description: str
    kind: str
    agent_name: str
    mutation_capable: bool
    tags: tuple[str, ...]
    examples: tuple[str, ...]
    required_fields: tuple[str, ...]
    coworker_module: str | None = None
    eligible_business_types: FrozenSet[str] = frozenset({"b2b", "b2c", "b2b2c"})
    version: str = "1.0"


def hub_required_argument_keys(skill: SpokeSkill) -> tuple[str, ...]:
    """Hub-facing required keys for the public card and JSON Schema.

    Dispatch still uses ``skill.required_fields`` (CRM-internal names such as
    ``contactId``, filled from Hub ``cdpId`` after normalize).
    """
    keys: list[str] = ["organizationId"]
    for field in skill.required_fields:
        mapped = "cdpId" if field == "contactId" else field
        if mapped not in keys:
            keys.append(mapped)
    if skill.id in _HUB_CDP_SKILLS and "cdpId" not in keys:
        keys.append("cdpId")
    if skill.kind == "coworker" and "instruction" not in keys:
        keys.append("instruction")
    if skill.id in {"proposal-content", "document-clone-personalize", "meeting-miss-escalation"}:
        if "instruction" not in keys:
            keys.append("instruction")
    return tuple(keys)


def _named_registry() -> dict[str, Any]:
    from app.agents import REGISTRY

    return dict(REGISTRY)


def _coworker_skills() -> list[SpokeSkill]:
    skills: list[SpokeSkill] = []
    for spec in SPECS:
        if spec.name in EXCLUDE_COWORKER_SKILLS:
            continue
        module = COWORKER_MODULE.get(spec.name)
        if not module:
            continue
        required = tuple(spec.input_schema.get("required") or ())
        required = tuple(field for field in required if field != "intent")
        title, description, examples = COWORKER_BLURBS.get(
            spec.name,
            (
                spec.name.replace("-", " ").title(),
                spec.description,
                ("Complete this CRM action with supplied ids",),
            ),
        )
        skills.append(
            SpokeSkill(
                id=spec.name,
                name=title,
                description=description,
                kind="coworker",
                agent_name="crm-agent",
                mutation_capable=True,
                tags=("crm", "coworker", spec.name, module),
                examples=examples,
                required_fields=required,
                coworker_module=module,
                eligible_business_types=frozenset(spec.eligible_business_types),
                version=spec.version,
            )
        )
    title, description, examples = COWORKER_BLURBS["deals"]
    skills.append(
        SpokeSkill(
            id="deals",
            name=title,
            description=description,
            kind="coworker",
            agent_name="crm-agent",
            mutation_capable=True,
            tags=("crm", "coworker", "deal", "sales"),
            examples=examples,
            required_fields=(),
            coworker_module="sales",
            eligible_business_types=frozenset(B2B_BUSINESS),
        )
    )
    return skills


def _named_skills(registry: NamedRegistry | None = None) -> list[SpokeSkill]:
    entries = registry if registry is not None else _named_registry()
    skills: list[SpokeSkill] = []
    for name in entries:
        if name in EXCLUDE_NAMED_AGENTS:
            continue
        if name not in HUB_PUBLISHED_NAMED_AGENTS:
            continue
        title, description, tags, examples = NAMED_BLURBS.get(
            name,
            (
                name.replace("-", " ").title(),
                f"CRM named agent {name}.",
                ("crm", name),
                (f"Run {name}",),
            ),
        )
        if name in MEETING_AGENTS:
            kind = "meeting"
        else:
            kind = "proactive"
        b2b_only = name in {"invoice-escalation", "proposal-content"} or "b2b" in tags
        required: tuple[str, ...]
        if name in {
            "enrich-lead",
            "score-lead",
            "summarize-lead",
            "nurture-lead",
            "lifecycle-lead",
            "welcome-lead",
            "owner-change-notify",
        }:
            required = ("contactId",)
        elif name == "assign-sales":
            required = ("contactId",)
        elif name == "audit-forecast":
            required = ("dealId",)
        elif name == "invoice-escalation":
            required = ("invoiceId",)
        elif name == "expansion-matcher":
            required = ("companyId",)
        elif name in {"analyze-transcript", "meeting-mom", "sales-coach", "post-meeting-process"}:
            required = ("transcript",)
        elif name == "auto-reply-email":
            required = ("activityId",)
        elif name == "compose-email":
            required = ("instruction",)
        elif name == "compliance-privacy":
            required = ("body",)
        elif name == "meeting-brief-email":
            required = ("activityId",)
        elif name == "proposal-content":
            required = ("dealId",)
        else:
            required = ()
        skills.append(
            SpokeSkill(
                id=name,
                name=title,
                description=description,
                kind=kind,
                agent_name=name,
                mutation_capable=name in MUTATION_AGENTS or name == "crm-agent",
                tags=tags,
                examples=examples,
                required_fields=required,
                eligible_business_types=frozenset(B2B_BUSINESS)
                if b2b_only
                else frozenset({"b2b", "b2c", "b2b2c"}),
            )
        )
    return skills


def list_spoke_skills(*, named_registry: NamedRegistry | None = None) -> tuple[SpokeSkill, ...]:
    skills = _coworker_skills() + _named_skills(named_registry)
    seen: set[str] = set()
    unique: list[SpokeSkill] = []
    for skill in skills:
        if skill.id in seen:
            continue
        seen.add(skill.id)
        unique.append(skill)
    return tuple(unique)


def get_spoke_skill(skill_id: str, *, named_registry: NamedRegistry | None = None) -> SpokeSkill | None:
    for skill in list_spoke_skills(named_registry=named_registry):
        if skill.id == skill_id:
            return skill
    return None


def spoke_card_version(skills: Iterable[SpokeSkill] | None = None) -> str:
    items = skills if skills is not None else list_spoke_skills()
    material = "|".join(f"{item.id}:{item.version}" for item in items)
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return digest[:16]


TYPED_SKILLS_URI = "urn:worktual:a2a:typed-skills:v1"

HIGH_IMPACT_SKILLS = frozenset(
    {
        "assign-sales",
        "invoice-escalation",
        "compliance-privacy",
        "post-meeting-process",
    }
)

EXCLUDED_CAPABILITIES = (
    "navigate",
    "open_workspace",
    "stage_contact_draft",
    "stage_deal_draft",
    "ui_confirm_chip",
    "get_list_analytics_as_hub_api",
    "seo_live_mcp_fetch",
    "ask_clarifying_question",
)


def skill_oauth_scope(skill: SpokeSkill) -> str:
    verb = "write" if skill.mutation_capable else "read"
    return f"crm.{skill.id}.{verb}"


def skill_risk(skill: SpokeSkill) -> str:
    if skill.id in HIGH_IMPACT_SKILLS:
        return "high_impact"
    if skill.mutation_capable:
        return "reversible_write"
    return "read"


def skill_specialist(skill: SpokeSkill) -> str:
    if skill.coworker_module:
        return skill.coworker_module
    if skill.kind == "meeting":
        return "meeting"
    tags = {t.lower() for t in skill.tags}
    for key in ("lead", "email", "inbox", "document", "forecast", "compliance", "finance"):
        if key in tags:
            return key
    return "general"


def skill_surface(skill: SpokeSkill) -> str:
    if skill.coworker_module:
        return skill.coworker_module
    return skill_specialist(skill)


def skill_mcp_server(skill: SpokeSkill) -> str | None:
    if skill.kind == "coworker":
        return "worktual-crm-coworker"
    return None


def skill_contract_path(skill_id: str) -> str:
    return f"/a2a/contracts/skills/{skill_id}.v1.json"
