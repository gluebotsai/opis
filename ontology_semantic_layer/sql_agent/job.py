"""Structured jobs passed from SQL Super to product executors."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


JobMode = Literal["list", "metric_fallback", "group_count", "count_scalar"]
JobIntent = Literal["list", "detail", "search", "metric"]


@dataclass
class SqlFilter:
    column: str
    op: str = "eq"
    values: list[Any] = field(default_factory=list)


@dataclass
class ExecutorJob:
    job_id: str
    mode: JobMode
    product: str
    engine: str
    organization_id: int
    user_id: int
    table: str
    schema: str
    select: list[str]
    filters: list[SqlFilter] = field(default_factory=list)
    order_by: list[str] = field(default_factory=list)
    limit: int = 20
    scope: Literal["org", "assignee", "team", "created_by"] = "org"
    visible_user_ids: list[str] = field(default_factory=list)
    my_queue_ids: list[str] = field(default_factory=list)
    row_scope_column: str | None = None
    caller_role: str | None = None
    scope_dual_assignee_resolver: bool = False
    group_by: list[str] = field(default_factory=list)
    cdp_live: bool = False
    cdp_email: str | None = None
    time_start: str | None = None
    time_end: str | None = None
    time_grain: str | None = None
    entitled_channels: list[str] = field(default_factory=list)
    channel_column: str | None = None
    # metric_fallback only
    metric_id: str | None = None
    template_id: str | None = None
    prepared: dict[str, Any] | None = None
    time_column: str | None = None
    instruction: str | None = None


@dataclass
class SqlQueryRequest:
    organization_id: int
    user_id: int
    origin_product: str
    origin_agent: str
    instruction: str
    entity_hint: str | None = None
    filters: list[dict[str, Any]] | None = None
    limit: int = 20
    metric_request: dict[str, Any] | None = None
