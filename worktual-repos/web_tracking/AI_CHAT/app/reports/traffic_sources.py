"""Traffic sources listing — deterministic semantic plan."""

from __future__ import annotations

import re

from app.mas.models import SemanticPlan
from app.reports.time_resolve import resolve_task_time
from app.services.context_layer import OntologySlice

_TRAFFIC_PHRASES = (
    "traffic source",
    "traffic sources",
    "source of traffic",
    "sources of traffic",
    "where traffic came from",
    "where did traffic come from",
    "referrer",
    "referrers",
    "utm source",
)

_METRIC_CANDIDATES = ("web_session_volume", "unique_visitors", "page_views")
_GROUP_DIM_CANDIDATES = (
    "traffic_source",
    "utm_source",
    "referrer_domain",
    "utm_medium",
    "utm_campaign",
    "source",
)


def is_traffic_sources_query(*texts: str | None) -> bool:
    blob = " ".join(t for t in texts if t).lower()
    if any(p in blob for p in _TRAFFIC_PHRASES):
        return True
    if re.search(r"\b(give|show|list|get)\b.*\b(source|sources)\b", blob):
        return True
    return False


def _pick_metric(slice_data: OntologySlice) -> str | None:
    allow = slice_data.allowlist()
    for mid in _METRIC_CANDIDATES:
        if mid in allow:
            return mid
    return None


def _pick_group_dim(slice_data: OntologySlice, metric_id: str) -> str | None:
    desc = slice_data.descriptor(metric_id)
    allowed = set(desc.dims) if desc else set()
    for dim in _GROUP_DIM_CANDIDATES:
        if dim in allowed:
            return dim
    for dim in allowed:
        low = dim.lower()
        if "source" in low or "referrer" in low or low.startswith("utm_"):
            return dim
    return None


def build_traffic_sources_plan(
    slice_data: OntologySlice,
    *,
    dashboard_period: str | None,
    task_time: str | None = None,
) -> SemanticPlan | None:
    metric = _pick_metric(slice_data)
    if not metric:
        return None
    group_dim = _pick_group_dim(slice_data, metric)
    if not group_dim:
        return None
    time = resolve_task_time(task_time or dashboard_period, dashboard_period=dashboard_period)
    return SemanticPlan(
        metrics=[metric],
        group_by=[group_dim],
        order_by=[metric],
        sort_direction="desc",
        limit=20,
        time=time,
    )


def try_traffic_sources_plan(
    *texts: str | None,
    slice_data: OntologySlice,
    dashboard_period: str | None,
    task_time: str | None = None,
) -> SemanticPlan | None:
    if not is_traffic_sources_query(*texts):
        return None
    return build_traffic_sources_plan(
        slice_data,
        dashboard_period=dashboard_period,
        task_time=task_time,
    )
