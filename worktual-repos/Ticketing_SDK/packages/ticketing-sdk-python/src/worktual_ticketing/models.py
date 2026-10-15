"""Result objects. Wire JSON stays camelCase; attributes follow Python."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SdkActor:
    id: str
    name: str
    email: str
    role: str


@dataclass
class SdkSession:
    session_token: str
    session_id: str
    expires_at: str
    organization_id: str
    actor: SdkActor
    locale: str | None = None


@dataclass
class UsageFeature:
    feature: str
    count: int


@dataclass
class UsageSkill:
    skill: str
    count: int


@dataclass
class UsageLogin:
    id: str
    actor_id: str | None = None
    session_id: str | None = None
    locale: str | None = None
    created_at: str = ""


@dataclass
class UsageLoginList:
    organization_id: str
    logins: list[UsageLogin] = field(default_factory=list)


@dataclass
class UsageQuota:
    rate_per_minute: int = 0
    concurrent: int = 0


@dataclass
class UsageEvent:
    id: str
    partner_id: str | None = None
    tenant_id: str = ""
    actor_id: str | None = None
    session_id: str | None = None
    surface: str = "headless"
    component: str | None = None
    feature: str = ""
    skill: str | None = None
    executor: str | None = None
    locale: str | None = None
    agent_turns: int = 0
    confirm_required: bool = False
    ok: bool = True
    created_at: str = ""


@dataclass
class UsageEventList:
    organization_id: str
    events: list[UsageEvent] = field(default_factory=list)


@dataclass
class UsageSummary:
    from_at: str
    to: str
    organization_id: str
    logins: int
    session_ends: int
    turns: int
    streams: int
    confirms: int
    rejects: int
    quota_exceeded: int = 0
    by_feature: list[UsageFeature] = field(default_factory=list)
    by_skill: list[UsageSkill] = field(default_factory=list)
    quota: UsageQuota = field(default_factory=UsageQuota)


@dataclass
class AiToolProposal:
    name: str
    args: dict[str, Any] | None = None
    risk: str | None = None
    auto: bool | None = None


@dataclass
class AiTurnResult:
    reply: str
    status: str
    agent: str
    ui_actions: list[dict[str, Any]]
    tool_proposals: list[AiToolProposal]
    locale: str | None = None
    session_id: str | None = None
    request_id: str | None = None
    data: dict[str, Any] | None = None
    code: str | None = None
    trace: dict[str, Any] | None = None


@dataclass
class AiTaskArticle:
    title: str
    id: str | None = None
    url: str | None = None


@dataclass
class AiTaskTicket:
    ticket_number: str
    subject: str | None = None


@dataclass
class AiTaskResult:
    reply: str
    status: str
    agent: str
    task: str
    ui_actions: list[dict[str, Any]]
    tool_proposals: list[AiToolProposal]
    articles: list[AiTaskArticle]
    tickets: list[AiTaskTicket]
    proposal: AiToolProposal | None
    deflected: bool
    locale: str | None = None
    session_id: str | None = None
    request_id: str | None = None
    data: dict[str, Any] | None = None
    draft: str | None = None
    code: str | None = None


@dataclass
class AiMetricValue:
    value: str | int | float
    id: str | None = None
    label: str | None = None


@dataclass
class AiInsightResult:
    reply: str
    status: str
    agent: str
    task: str
    metrics: list[AiMetricValue]
    rows: list[dict[str, Any]]
    ui_actions: list[dict[str, Any]]
    tool_proposals: list[AiToolProposal]
    locale: str | None = None
    session_id: str | None = None
    request_id: str | None = None
    data: dict[str, Any] | None = None
    code: str | None = None
    why: str | None = None


@dataclass
class SdkProposal:
    id: str
    kind: str
    status: str
    agent_id: str
    summary: str
    ticket_number: str | None = None
    draft: str | None = None
    tool_name: str | None = None
    created_at: str | None = None


@dataclass
class ProposalList:
    items: list[SdkProposal]


@dataclass
class ProposalDecision:
    id: str
    ok: bool
    status: str


@dataclass
class StaffLogin:
    session_token: str
    user: dict[str, Any]


@dataclass
class PortalOtpRequest:
    ok: bool
    channel: str | None = None
    masked: str | None = None


@dataclass
class PortalLogin:
    session_token: str
    customer: dict[str, Any]


@dataclass
class InboxItem:
    id: str
    title: str
    message: str
    read: bool
    ticket_number: str | None = None
    created_at: str | None = None
    kind: str | None = None


@dataclass
class InboxList:
    items: list[InboxItem]


@dataclass
class HelpWidget:
    id: str
    public_id: str
    name: str
    organization_id: str = ""
    button_label: str = "Help"
    enabled: bool = True
    allowed_origins: list[str] = field(default_factory=list)


@dataclass
class HelpWidgetEmbed:
    script: str
    iframe: str


@dataclass
class HelpWidgetCreated:
    widget: HelpWidget
    embed: HelpWidgetEmbed
