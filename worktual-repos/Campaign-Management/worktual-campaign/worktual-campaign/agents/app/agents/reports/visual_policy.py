"""When to attach KPI/visual cards to reports chat — LLM sets include_visual on tools."""

from __future__ import annotations

from typing import Any

_KPI_TOOLS = frozenset(
    {"GET_PORTFOLIO_PERFORMANCE", "query_analytics", "ask_semantic_layer"}
)


def resolve_include_visual(tool_name: str, args: dict[str, Any] | None) -> bool:
    """Default: KPI tools may show a card; list/report/detail tools are text-first."""
    params = dict(args or {})
    if "include_visual" in params:
        return bool(params.get("include_visual"))
    name = str(tool_name or "").strip()
    return name in _KPI_TOOLS


def tool_result_include_visual(tool_name: str, result: dict[str, Any]) -> bool:
    if "include_visual" in result:
        return bool(result.get("include_visual"))
    return resolve_include_visual(tool_name, {})


def strip_visual_from_analytics(analytics: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(analytics, dict):
        return None
    out = dict(analytics)
    out.pop("visual", None)
    out["include_visual"] = False
    return out


def prepare_analytics_for_tool_result(
    analytics: dict[str, Any] | None,
    *,
    include_visual: bool,
) -> dict[str, Any] | None:
    if not isinstance(analytics, dict):
        return None
    if include_visual:
        out = dict(analytics)
        out["include_visual"] = True
        return out
    return strip_visual_from_analytics(analytics)


def analytics_for_chat_payload(analytics: dict[str, Any] | None) -> dict[str, Any] | None:
    """Attach to socket/meta only when a visual card should render."""
    if not isinstance(analytics, dict):
        return None
    if analytics.get("include_visual") is False:
        return None
    if not analytics.get("visual"):
        return None
    out = dict(analytics)
    out["include_visual"] = True
    return out
