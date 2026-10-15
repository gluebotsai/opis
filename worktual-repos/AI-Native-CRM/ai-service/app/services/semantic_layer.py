"""HTTP client for the CRM semantic-layer gateway.

Reports/analytics uses this as the `ask_semantic_layer` tool. Gateway payload
uses CRM `organization_id` (not tenant_id). Product is always `crm` unless
overridden.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from app.config import get_settings
from app.services.display_currency import format_money_amount

logger = logging.getLogger(__name__)


def _log_tool_io(kind: str, payload: Any) -> None:
    """Print + file-log tool input/output so the uvicorn terminal shows the call."""
    text = json.dumps(payload, ensure_ascii=False, default=str)
    line = f"ask_semantic_layer {kind}: {text}"
    print(line, flush=True)
    logger.info(line)
    try:
        from app.agent_log import trace

        trace(
            agent="reports-analytics-agent",
            step="ask_semantic_layer",
            kind=kind,
            payload=text,
        )
    except Exception:  # noqa: BLE001
        pass

ASK_SEMANTIC_LAYER_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "ask_semantic_layer",
        "description": (
            "Ask a CRM metrics question in plain language and get real catalog "
            "data back (pipeline, funnel, quotes, commerce, finance)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "The user's business question, for example: "
                        "what's our win rate?"
                    ),
                }
            },
            "required": ["query"],
        },
    },
}

CATALOG_METRIC_IDS = frozenset(
    {
        "contact_volume",
        "new_lead_volume",
        "mql_rate",
        "mql_contact_count",
        "eligible_lead_contact_count",
        "customer_conversion_rate",
        "customer_contact_count",
        "funnel_eligible_contact_count",
        "deal_volume",
        "open_pipeline_value",
        "won_deal_rate",
        "loss_rate",
        "average_sales_cycle_days",
        "average_deal_value",
        "pipeline_coverage_ratio",
        "sales_agent_win_rate",
        "quote_to_close_rate",
        "proposal_acceptance_rate",
        "order_volume",
        "order_gmv",
        "average_order_value",
        "repurchase_rate",
        "customer_lifetime_value",
        "invoice_outstanding_amount",
        "days_sales_outstanding",
    }
)

CURRENCY_METRICS = frozenset(
    {
        "open_pipeline_value",
        "average_deal_value",
        "order_gmv",
        "average_order_value",
        "customer_lifetime_value",
        "invoice_outstanding_amount",
    }
)
RATIO_METRICS = frozenset(
    {
        "mql_rate",
        "customer_conversion_rate",
        "won_deal_rate",
        "loss_rate",
        "pipeline_coverage_ratio",
        "sales_agent_win_rate",
        "quote_to_close_rate",
        "proposal_acceptance_rate",
        "repurchase_rate",
    }
)
DAYS_METRICS = frozenset({"average_sales_cycle_days", "days_sales_outstanding"})


def semantic_layer_configured() -> bool:
    url = (get_settings().semantic_layer_gateway_url or "").strip()
    return bool(url)


def _ask_url() -> str:
    base = get_settings().semantic_layer_gateway_url.strip().rstrip("/")
    return f"{base}/ask"


def _is_metric_result(item: Any) -> bool:
    return isinstance(item, dict) and ("ok" in item or "metric_id" in item or "error" in item)


def normalize_results(payload: Any) -> list[dict[str, Any]]:
    """Flatten gateway payloads into metric result objects.

    Port 9800 returns ``{query: [result, ...]}``. Older gateways returned a
    bare list of result objects.
    """
    if isinstance(payload, list):
        out: list[dict[str, Any]] = []
        for item in payload:
            if _is_metric_result(item):
                out.append(item)
            elif isinstance(item, dict):
                out.extend(normalize_results(item))
            elif isinstance(item, list):
                out.extend(normalize_results(item))
        return out
    if isinstance(payload, dict):
        if _is_metric_result(payload):
            return [payload]
        out = []
        for value in payload.values():
            out.extend(normalize_results(value))
        return out
    return []


def successful_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in results:
        if not item.get("ok"):
            continue
        rows = item.get("rows")
        if not isinstance(rows, list) or not rows:
            continue
        out.append(item)
    return out


def format_metric_value(metric_id: str, value: Any) -> str:
    if value is None:
        return "—"
    mid = (metric_id or "").strip()
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if mid in RATIO_METRICS:
        if mid == "pipeline_coverage_ratio":
            return f"{number:.1f}x"
        return f"{number * 100:.1f}%"
    if mid in CURRENCY_METRICS:
        return format_money_amount(number)
    if mid in DAYS_METRICS:
        return f"{number:.1f} days"
    if number.is_integer():
        return f"{int(number):,}"
    return f"{number:,.2f}"


def humanize_metric_id(metric_id: str) -> str:
    return (metric_id or "metric").replace("_", " ").strip().title()


async def ask_semantic_layer(query: str, organization_id: str) -> list[dict[str, Any]]:
    """POST /ask with the current organization. Returns gateway result objects."""
    q = (query or "").strip()
    org_id = str(organization_id or "").strip()
    settings = get_settings()
    payload = {
        "query": q,
        "organization_id": org_id,
        "product": (settings.semantic_layer_product or "crm").strip() or "crm",
    }
    _log_tool_io("input", payload)
    started = time.perf_counter()
    if not q or not org_id:
        results = [
            {
                "ok": False,
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": "query and organization_id are required",
                },
            }
        ]
        _log_tool_io("output", results)
        return results
    if not semantic_layer_configured():
        results = [
            {
                "ok": False,
                "error": {
                    "code": "NOT_CONFIGURED",
                    "message": "Semantic layer gateway is not configured",
                },
            }
        ]
        _log_tool_io("output", results)
        return results

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.post(
                _ask_url(),
                json=payload,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            res.raise_for_status()
            results = normalize_results(res.json())
            _log_tool_io(
                "output",
                {"ms": round((time.perf_counter() - started) * 1000), "results": results},
            )
            return results
    except Exception as exc:  # noqa: BLE001
        logger.warning("semantic layer ask failed organization_id=%s: %s", org_id, exc)
        results = [
            {
                "ok": False,
                "error": {"code": "UPSTREAM_ERROR", "message": str(exc)},
            }
        ]
        _log_tool_io("output", results)
        return results
