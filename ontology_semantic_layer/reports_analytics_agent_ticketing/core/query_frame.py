from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

Shape = Literal["list", "find", "count", "breakdown", "ranking", "trend", "kpi"]
PathHint = Literal["certified", "catalog"]
ScopeLevel = Literal["org", "own", "created_by_me", "queue", "agent", "resolver"]
StatusReading = Literal["generic_pending", "literal", "open", "reopened", "overdue", "resolved"]
SCOPE_LEVELS = frozenset({"org", "own", "created_by_me", "queue", "agent", "resolver"})
SHAPES = frozenset({"list", "find", "count", "breakdown", "ranking", "trend", "kpi"})


@dataclass
class FilterMention:
    field: str
    mention: str
    reading: str | None = None


@dataclass
class TimeSpec:
    expression: str | None = None
    date_column: str | None = None
    start: str | None = None
    end: str | None = None


@dataclass
class ScopeSpec:
    level: ScopeLevel
    target_mention: str | None = None


@dataclass
class QueryFrame:
    shape: Shape
    measure: str
    path: PathHint
    scope: ScopeSpec
    filters: list[FilterMention] = field(default_factory=list)
    time: TimeSpec = field(default_factory=TimeSpec)
    group_by: list[str] = field(default_factory=list)
    sort: str | None = None
    limit: int | None = None
    select: list[str] = field(default_factory=list)
    compare_time: TimeSpec | None = None
    check_thresholds: bool = False
    output: str = "answer"


@dataclass
class PlanStep:
    executor: Literal["sql", "kg"]
    frame: QueryFrame
    brief: str = ""


@dataclass
class DomainPlan:
    steps: list[PlanStep]


@dataclass
class Identity:
    organization_id: int
    user_id: int
    role: Literal["admin", "agent", "resolver"]
    my_queue_ids: list[int] = field(default_factory=list)


def identity_from_dict(data: dict[str, Any]) -> Identity:
    return Identity(
        organization_id=int(data["organization_id"]),
        user_id=int(data["user_id"]),
        role=data["role"],
        my_queue_ids=[int(x) for x in (data.get("my_queue_ids") or [])],
    )


def jsonish(value: Any) -> Any:
    """Decode a JSON string the model nested as text; leave other values as-is."""
    match value:
        case dict() | list() | int() | float() | bool() | None:
            return value
        case str() as raw:
            text = raw.strip()
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return raw
        case _:
            return value


def as_time(value: Any) -> TimeSpec:
    value = jsonish(value)
    match value:
        case TimeSpec() as spec:
            return spec
        case dict() as doc:
            expr = doc.get("expression")
            if expr is None:
                expr = doc.get("words")
            return TimeSpec(
                expression=expr,
                date_column=doc.get("date_column"),
                start=doc.get("start"),
                end=doc.get("end"),
            )
        case str() as words:
            return TimeSpec(expression=words or None)
        case _:
            return TimeSpec()


def as_scope(value: Any) -> ScopeSpec:
    value = jsonish(value)
    match value:
        case ScopeSpec() as spec:
            return spec
        case dict() as doc:
            level = str(doc.get("level") or "org")
            if level not in SCOPE_LEVELS:
                level = "org"
            return ScopeSpec(level=level, target_mention=doc.get("target_mention"))
        case str() as raw:
            level = raw if raw in SCOPE_LEVELS else "org"
            mention = None if raw in SCOPE_LEVELS else raw
            return ScopeSpec(level=level, target_mention=mention)
        case _:
            return ScopeSpec(level="org")


FILTER_FIELD_ALIASES = {
    "csat": "csat_score",
    "csat_score": "csat_score",
    "assignee": "agent",
    "assignee_name": "agent",
    "agent_name": "agent",
    "customer_name": "customer",
    "resolver_name": "resolver",
    "queue_name": "queue",
    "created_by_name": "created_by",
    "resolution_time": "resolution_hours",
    "resolve_time": "resolution_hours",
    "resolution": "resolution_hours",
    "first_response_time": "first_response_hours",
    "response_time": "first_response_hours",
    "age_hours": "open_age_hours",
    "ticket_age": "open_age_hours",
    "overdue": "overdue_hours",
}
COMPARE_OPS = {
    ">": ">",
    ">=": ">=",
    "<": "<",
    "<=": "<=",
    "=": "=",
    "==": "=",
    "eq": "=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "neq": "<>",
    "!=": "<>",
    "less than": "<",
    "fewer than": "<",
    "under": "<",
    "below": "<",
    "more than": ">",
    "greater than": ">",
    "over": ">",
    "above": ">",
    "at least": ">=",
    "at most": "<=",
}
COMPARE_READINGS = frozenset(COMPARE_OPS)


def as_filters(value: Any) -> list[FilterMention]:
    value = jsonish(value)
    match value:
        case list() as items:
            rows = items
        case dict() as doc:
            rows = [doc]
        case _:
            rows = []
    out: list[FilterMention] = []
    for item in rows:
        item = jsonish(item)
        match item:
            case dict() as doc:
                field = doc.get("field") or doc.get("dimension")
                mention = doc.get("mention")
                if mention is None:
                    mention = doc.get("value")
                reading = doc.get("reading")
                if field is None:
                    continue
                if mention is None and not reading:
                    continue
                field = FILTER_FIELD_ALIASES.get(str(field), str(field))
                reading_text = None if reading is None else str(reading).strip()
                if field == "status":
                    pass
                elif reading_text and reading_text.lower() in COMPARE_OPS:
                    reading_text = COMPARE_OPS[reading_text.lower()]
                elif reading_text and reading_text in COMPARE_OPS:
                    reading_text = COMPARE_OPS[reading_text]
                elif field in {"csat_score", "resolution_hours", "first_response_hours", "open_age_hours", "overdue_hours"}:
                    reading_text = reading_text or "="
                else:
                    reading_text = None
                out.append(
                    FilterMention(
                        field=field,
                        mention=str(mention if mention is not None else reading),
                        reading=reading_text,
                    )
                )
            case _:
                continue
    return out


def as_group_by(value: Any) -> list[str]:
    value = jsonish(value)
    match value:
        case list() as items:
            return [str(x) for x in items if x not in (None, "")]
        case str() as name if name:
            return [name]
        case _:
            return []


def as_limit(value: Any) -> int | None:
    value = jsonish(value)
    match value:
        case int() as n:
            return n
        case str() as raw:
            try:
                return int(raw)
            except ValueError:
                return None
        case _:
            return None


def as_shape(value: Any) -> Shape:
    raw = str(jsonish(value) or "kpi")
    if raw not in SHAPES:
        raw = "kpi"
    return raw  # type: ignore[return-value]


def frame_from_dict(data: dict[str, Any] | str | QueryFrame) -> QueryFrame:
    match data:
        case QueryFrame() as frame:
            return frame
        case _:
            payload = jsonish(data)
    if not isinstance(payload, dict):
        raise TypeError("frame must be a JSON object")
    compare = payload.get("compare_time")
    compare_spec = as_time(compare) if compare not in (None, "", {}) else None
    path = str(payload.get("path") or "certified")
    if path not in {"certified", "catalog"}:
        path = "certified"
    return QueryFrame(
        shape=as_shape(payload.get("shape")),
        measure=str(payload.get("measure") or ""),
        path=path,  # type: ignore[arg-type]
        scope=as_scope(payload.get("scope")),
        filters=as_filters(payload.get("filters")),
        time=as_time(payload.get("time")),
        group_by=as_group_by(payload.get("group_by")),
        select=as_group_by(payload.get("select") or payload.get("columns")),
        sort=payload.get("sort"),
        limit=as_limit(payload.get("limit")),
        compare_time=compare_spec,
        check_thresholds=bool(payload.get("check_thresholds")),
        output=str(payload.get("output") or "answer"),
    )
