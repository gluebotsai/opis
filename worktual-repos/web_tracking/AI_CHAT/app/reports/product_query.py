"""Named product visit queries — deterministic semantic plan (no bad LLM filters)."""

from __future__ import annotations

import re

from app.mas.models import SemanticPlan
from app.reports.time_resolve import resolve_task_time

_PRODUCT_VISIT_WORDS = (
    "visit",
    "visits",
    "viewed",
    "views",
    "interaction",
    "interactions",
    "pdp",
    "traffic",
)


def extract_product_name(*texts: str | None) -> str | None:
    blob = " ".join(t for t in texts if t).strip()
    if not blob:
        return None
    patterns = (
        r'product\s+named\s+"([^"]+)"',
        r'product\s+"([^"]+)"',
        r'for the product\s+(.+?)\s+in the\b',
        r'for the product\s+(.+?)\?',
        r'visits?\s+for\s+(.+?)(?:\?|$)',
        r'visit\s+for\s+(.+?)(?:\?|$)',
        r'total\s+(?:number\s+of\s+)?visits?\s+for\s+(.+?)(?:\?|$)',
        r'interactions?\s+for\s+(.+?)(?:\?|$)',
        r'["\']([^"\']+)["\']',
    )
    for pat in patterns:
        m = re.search(pat, blob, re.IGNORECASE)
        if m:
            name = m.group(1).strip().rstrip(".")
            if len(name) >= 2:
                return name
    return None


def is_named_product_visit_query(*texts: str | None) -> bool:
    name = extract_product_name(*texts)
    if not name:
        return False
    blob = " ".join(t for t in texts if t).lower()
    if "product" in blob or any(w in blob for w in _PRODUCT_VISIT_WORDS):
        return True
    return False


def build_named_product_visit_plan(
    product_name: str,
    *,
    dashboard_period: str | None,
    task_time: str | None = None,
) -> SemanticPlan:
    time = resolve_task_time(task_time or dashboard_period, dashboard_period=dashboard_period)
    return SemanticPlan(
        metrics=["product_interaction_count"],
        filters=[
            {
                "dimension": "product_name",
                "op": "eq",
                "values": [product_name.strip()],
            }
        ],
        time=time,
        group_by=[],
        order_by=[],
        limit=None,
    )


def try_named_product_visit_plan(
    *texts: str | None,
    dashboard_period: str | None,
    task_time: str | None = None,
) -> SemanticPlan | None:
    if not is_named_product_visit_query(*texts):
        return None
    name = extract_product_name(*texts)
    if not name:
        return None
    return build_named_product_visit_plan(
        name,
        dashboard_period=dashboard_period,
        task_time=task_time,
    )
