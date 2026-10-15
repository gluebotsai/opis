"""Route metric *values* vs narrative *why* to semantic layer vs ontology."""

from __future__ import annotations

import re
from typing import Any, Literal

InsightsKind = Literal["values", "why", "both"]

_WHY_PATTERNS = (
    r"\bwhy\b",
    r"\bwhat caused\b",
    r"\bwhat drove\b",
    r"\bwhat's driving\b",
    r"\bwhats driving\b",
    r"\broot cause\b",
    r"\bdrivers?\b",
    r"\bexplain\b",
    r"\banaly[sz]e\b",
    r"\binterpret\b",
    r"\bhow (?:is|are|did|does)\b",
    r"\breason for\b",
    r"\bcompared to yesterday\b",
    r"\bvs\.? yesterday\b",
    r"\bdrop(ped)? compared\b",
    r"\bdecrease(d)? compared\b",
    r"\bincrease(d)? compared\b",
)

_VALUES_PATTERNS = (
    r"\bhow many\b",
    r"\bcount\b",
    r"\bnumber of\b",
    r"\bwhat is (?:our|the)\b",
    r"\btotal\b",
    r"\baverage\b",
    r"\bavg\b",
    r"\bmedian\b",
    r"\bminimum\b",
    r"\bmaximum\b",
    r"\bsum\b",
    r"\brate\b",
    r"\bmetrics?\b",
    r"\bcsat\b",
    r"\bsla\b",
    r"\bopen tickets?\b",
    r"\boverdue\b",
    r"\brevenue\b",
    r"\bscore\b",
    r"\bpercentage\b",
    r"\boverall\b",
    r"\bcompare\b",
)


def classify_insights_question(text: str) -> InsightsKind:
    """Split NLU: exact KPI values (semantic) vs narrative why (ontology)."""
    t = (text or "").strip().lower()
    if not t:
        return "values"
    why = any(re.search(p, t) for p in _WHY_PATTERNS)
    values = any(re.search(p, t) for p in _VALUES_PATTERNS)
    if why and values:
        return "both"
    if why:
        return "why"
    return "values"


def requires_insights_gateway(text: str, operation: str | None = None) -> bool:
    """Prevent specialist/Express shortcuts for metric and analysis questions."""
    op = str(operation or "").strip().upper()
    if op in {
        "GET_METRICS",
        "COMPARE",
        "RECOMMEND",
        "GET_ANALYTICS",
        "GET_CSAT",
    }:
        return True
    normalized = (text or "").strip().lower()
    if op not in {"", "NONE", "LIST_TICKETS", "SEARCH_TICKETS"} or not normalized:
        return False
    requests_rows = bool(re.search(r"\b(show|list|display|find|search)\b", normalized))
    requests_calculation = bool(
        re.search(
            r"\b(how many|count|number of|total|average|avg|sum|rate|percentage|"
            r"median|minimum|maximum|score|metric|csat|sla)\b",
            normalized,
        )
    )
    if requests_rows and not requests_calculation:
        return False
    requests_analysis = any(
        re.search(pattern, normalized) for pattern in _WHY_PATTERNS
    )
    return requests_calculation or requests_analysis


def semantic_result_usable(result: dict[str, Any] | None) -> bool:
    """True when semantic gateway returned a usable metric payload (not NO_MATCH)."""
    if not result or not result.get("success"):
        return False
    payload = result.get("payload")
    if not isinstance(payload, dict):
        return True
    for value in payload.values():
        if not isinstance(value, list):
            continue
        for item in value:
            if isinstance(item, dict) and item.get("ok") is False:
                err = item.get("error") if isinstance(item.get("error"), dict) else {}
                code = str(err.get("code") or "")
                if code in {"NO_MATCH_OR_INCOMPLETE", "NO_MATCH"}:
                    return False
    return True


def try_semantic_metrics(
    query: str,
    *,
    organization_id: str | None,
    scope_hint: str | None = None,
) -> dict[str, Any]:
    """Call semantic layer for metric values; return tool result dict."""
    from app.tools.catalog_tools import ask_semantic_layer

    q = (query or "").strip()
    if scope_hint in {"team", "unassigned", "self", "assignee", "org"}:
        scope_label = {
            "team": "team inbox",
            "unassigned": "unassigned queue",
            "self": "my assignee scope",
            "assignee": "my assignee scope",
            "org": "organization-wide",
        }.get(scope_hint, scope_hint)
        q = f"{q} (scope: {scope_label})" if q else f"Metrics for {scope_label}"
    if not q:
        q = "Summarize ticketing metrics for this organization"
    return ask_semantic_layer(query=q, organization_id=organization_id)


def try_ontology_narrative(
    query: str,
    *,
    organization_id: str | None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Call ontology SSE for narrative why/drivers (not exact KPI values)."""
    from app.tools.catalog_tools import ask_ontology

    q = (query or "").strip() or "Explain what is driving recent ticket trends."
    return ask_ontology(
        query=q,
        organization_id=organization_id,
        session_id=session_id,
    )


def log_insights_routing(
    *,
    kind: InsightsKind,
    tool: str,
    success: bool,
    fallback: str | None = None,
    user_text: str = "",
    organization_id: str | None = None,
) -> None:
    """Append routing decision to day-wise llm log (never raises)."""
    try:
        from app.llm_log import log_llm

        parts = [f"kind={kind}", f"tool={tool}", f"success={success}"]
        if fallback:
            parts.append(f"fallback={fallback}")
        log_llm(
            kind="insights_routing",
            user_text=user_text,
            response=" | ".join(parts),
            organization_id=organization_id,
        )
    except Exception:  # noqa: BLE001
        pass
