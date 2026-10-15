"""Dispatch Reports tools — campaign API + events snapshot, with clear errors."""

from __future__ import annotations

from typing import Any

from app.agents.events_report.tools import handlers as events_handlers
from app.agents.monitoring.tools import handlers as campaign_handlers
from app.agents.reports.analytics_visual import build_visual_from_semantic_results
from app.agents.reports.org_context import (
    resolve_organization_id,
    resolve_session_context,
    scope_note,
    scope_result_fields,
)
from app.agents.reports.visual_policy import (
    prepare_analytics_for_tool_result,
    resolve_include_visual,
)
from app.agents.routing import dispatch_route_to_module
from app.services.campaign_analytics import ask_campaign_analytics
from app.services.campaign_live_api import (
    fetch_campaign_live_status,
    fetch_campaign_ops_feed,
    fetch_portfolio_activity_series,
    fetch_recent_send_failures,
)
from app.services.campaign_performance_api import fetch_portfolio_performance
from app.services.portfolio_api import (
    fetch_portfolio_totals,
    merge_portfolio_performance_args,
    resolve_report_period,
)
from app.services.portfolio_metrics import KPI_GLOSSARY
from app.services.ontology_layer import ask_ontology, ontology_configured
from app.services.semantic_layer import ask_semantic_layer, semantic_layer_configured
from app.session_store import get_or_create_session


def _safe_error(prefix: str, exc: BaseException) -> dict[str, Any]:
    msg = str(exc).strip() or exc.__class__.__name__
    return {
        "ok": False,
        "error": f"{prefix}: {msg[:400]}",
        "hint": "Retry the tool, or list campaigns/events again and pick a valid id.",
    }


async def handle_ask_ontology(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Analytics / knowledge-graph questions → ontology chat/stream."""
    query = str(args.get("query") or args.get("question") or "").strip()
    if not query:
        return {
            "ok": False,
            "error": "query is required",
            "hint": "Pass the analytics / past-campaign question as query.",
        }
    if not ontology_configured():
        return {
            "ok": False,
            "error": "ontology_not_configured",
            "hint": "Set ONTOLOGY_CHAT_STREAM_URL. For KPI rates use query_analytics.",
        }

    session = await get_or_create_session(session_id, token=token, module="reports")
    org_id = await resolve_organization_id(session, token)
    if not org_id:
        return {
            "ok": False,
            "error": "organization_id_unavailable",
            "hint": "Could not resolve organization_id for ontology.",
        }

    result = await ask_ontology(
        query,
        organization_id=org_id,
        session_id=session_id,
    )
    answer = str(result.get("answer") or "").strip()
    if not result.get("ok") or not answer:
        return {
            "ok": False,
            "kind": "miss",
            "source": "ontology",
            "organization_id": org_id,
            "query": query,
            "error": result.get("error") or "ontology miss",
            "hint": (
                "Ontology returned no answer. For KPI rates/volumes use "
                "query_analytics; for named lists use LIST_MONITOR_CAMPAIGNS."
            ),
            "message": (
                "ONTOLOGY_MISS: no usable ontology answer. "
                "Retry ask_ontology or use campaign list tools."
            ),
        }

    return {
        "ok": True,
        "kind": "executed",
        "source": "ontology",
        "organization_id": org_id,
        "query": query,
        "answer": answer,
        "assistantText": answer,
        "done": result.get("done") or {},
        "message": (
            "ONTOLOGY_OK: use this answer for analytics / past-campaign facts. "
            "Do not claim it came from the semantic report gateway."
        ),
    }


async def handle_ask_semantic_layer(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    query = str(args.get("query") or args.get("question") or "").strip()
    if not query:
        return {
            "ok": False,
            "error": "query is required",
            "hint": "Pass the user's report/KPI question as query.",
        }
    if not semantic_layer_configured():
        return {
            "ok": False,
            "error": "semantic_layer_not_configured",
            "hint": "Fall back to query_analytics (campaign_sql) or LIST_MONITOR_CAMPAIGNS.",
        }

    session = await get_or_create_session(session_id, token=token, module="reports")
    org_id = await resolve_organization_id(session, token)
    if not org_id:
        return {
            "ok": False,
            "error": "organization_id_unavailable",
            "hint": (
                "Could not resolve organization_id. "
                "Fall back to campaign tools."
            ),
        }

    result = await ask_semantic_layer(query, organization_id=org_id)
    usable = list(result.get("usable") or [])
    analytics = build_visual_from_semantic_results(
        query=query,
        usable=usable,
        organization_id=org_id,
        source="semantic_layer",
    )

    fact_rows: list[dict[str, Any]] = []
    for item in usable[:6]:
        mid = item.get("metric_id")
        rows = item.get("rows") if isinstance(item.get("rows"), list) else []
        fact_rows.append({"metric_id": mid, "rows": rows[:8]})

    if not result.get("ok") or not analytics:
        miss_bits = []
        for item in result.get("results") or []:
            if isinstance(item, dict) and item.get("ok") is False:
                err = item.get("error") if isinstance(item.get("error"), dict) else {}
                miss_bits.append(
                    str(err.get("message") or item.get("error") or "miss")[:160]
                )
        return {
            "ok": False,
            "source": "semantic_layer",
            "organization_id": org_id,
            "query": query,
            "error": result.get("error")
            or (miss_bits[0] if miss_bits else "no usable rows"),
            "hint": (
                "Semantic layer miss. Call query_analytics again or use "
                "LIST_MONITOR_CAMPAIGNS / GET_CAMPAIGN_REPORT."
            ),
            "message": (
                "SEMANTIC_MISS: no usable metric rows. "
                "Use query_analytics (campaign_sql) or LIST_MONITOR_CAMPAIGNS next."
            ),
        }

    findings = (
        analytics.get("findings")
        if isinstance(analytics.get("findings"), dict)
        else {}
    )
    summary = str(findings.get("summary") or "").strip()
    return {
        "ok": True,
        "source": "semantic_layer",
        "organization_id": org_id,
        "query": query,
        "metric_facts": fact_rows,
        "analytics": analytics,
        "message": (
            "SEMANTIC_OK: use these metric facts for your reply. "
            f"Summary: {summary}. "
            "Rates from the gateway may be fractions (0.067 = 6.7%) — "
            "the analytics visual already formats them with %."
        ),
    }


def _period_from_args_or_session(
    session: dict[str, Any],
    args: dict[str, Any],
) -> dict[str, Any] | None:
    return resolve_report_period(session, args)


async def handle_query_analytics(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Reports/KPI path: semantic-first → campaign_sql → hint campaign tools.

    Ontology analytics must use ask_ontology — not this handler.
    """
    question = str(
        args.get("question") or args.get("query") or ""
    ).strip()
    if not question:
        return {
            "ok": False,
            "error": "question is required",
            "hint": "Pass the user's report/KPI question.",
        }

    session = await get_or_create_session(session_id, token=token, module="reports")
    caller = await resolve_session_context(session, token)
    org_id = await resolve_organization_id(session, token)
    period = _period_from_args_or_session(session, args)
    include_visual = resolve_include_visual("query_analytics", args)
    scope_msg = scope_note(caller)

    raw_metrics = args.get("metrics")
    if isinstance(raw_metrics, list) and raw_metrics:
        metrics = [
            str(m).strip().lower()
            for m in raw_metrics
            if str(m).strip()
        ]
    else:
        metrics = ["portfolio"]

    portfolio_totals = await fetch_portfolio_totals(token, period)

    # Allowlisted Campaign metrics (Dashboard parity — explicit metric ids from LLM)
    camp = await ask_campaign_analytics(
        question,
        token=token,
        period=period,
        metrics=metrics,
    )
    usable = list(camp.get("usable") or [])
    raw_analytics = build_visual_from_semantic_results(
        query=question,
        usable=usable,
        organization_id=org_id or "",
        source="campaign_sql",
    )
    analytics = prepare_analytics_for_tool_result(
        raw_analytics, include_visual=include_visual
    )
    if camp.get("ok") and analytics:
        findings = (
            analytics.get("findings")
            if isinstance(analytics.get("findings"), dict)
            else {}
        )
        summary = str(findings.get("summary") or "").strip()
        if isinstance(camp.get("plan"), dict):
            analytics["plan"] = {**analytics.get("plan", {}), **camp["plan"]}
        return {
            "ok": True,
            "kind": "executed",
            "source": "campaign_sql",
            "organization_id": org_id,
            "query": question,
            "analytics": analytics,
            "include_visual": include_visual,
            "assistantText": summary,
            "data": {"analytics": analytics},
            "message": (
                "CAMPAIGN_SQL_OK: allowlisted campaign metrics (Dashboard parity). "
                f"Summary: {summary}. "
                f"{scope_msg} {KPI_GLOSSARY} "
                "Do not claim this came from the semantic gateway."
            ),
            "kpi_glossary": KPI_GLOSSARY,
            "portfolio_totals": portfolio_totals,
            "dashboard_parity": portfolio_totals,
            **(
                {
                    "scope_applied": camp["plan"].get("scope_applied"),
                    "scope_label": camp["plan"].get("scope_label"),
                }
                if isinstance(camp.get("plan"), dict)
                and camp["plan"].get("scope_applied")
                else scope_result_fields(caller)
            ),
        }

    if portfolio_totals:
        return {
            "ok": True,
            "kind": "executed",
            "source": "portfolio_api",
            "organization_id": org_id,
            "query": question,
            "portfolio_totals": portfolio_totals,
            "dashboard_parity": portfolio_totals,
            "assistantText": (
                f"Dashboard totals for the active period: "
                f"{portfolio_totals.get('campaigns_ran')} campaigns ran, "
                f"{portfolio_totals.get('campaigns_with_send')} sent (campaigns), "
                f"{portfolio_totals.get('campaigns_with_failure')} failed (campaigns)."
            ),
            "message": (
                "PORTFOLIO_OK: use dashboard_parity / portfolio_totals for ALL KPI answers "
                f"(campaigns_ran, campaigns_with_send, campaigns_with_failure, rates). "
                f"{scope_msg} {KPI_GLOSSARY}"
            ),
            "kpi_glossary": KPI_GLOSSARY,
            **scope_result_fields(caller),
        }

    # 2) Semantic layer fallback (non-Dashboard KPI experiments)
    if semantic_layer_configured() and org_id:
        sem = await handle_ask_semantic_layer(
            session_id, token, {"query": question}
        )
        if sem.get("ok") and isinstance(sem.get("analytics"), dict):
            return {
                **sem,
                "kind": "executed",
                "assistantText": (
                    (sem.get("analytics") or {}).get("findings") or {}
                ).get("summary")
                or sem.get("message"),
                "data": {"analytics": sem.get("analytics")},
            }

    return {
        "ok": False,
        "kind": "miss",
        "source": "query_analytics",
        "organization_id": org_id,
        "query": question,
        "error": camp.get("error") or "no report metric rows",
        "hint": (
            "Call LIST_MONITOR_CAMPAIGNS (bucket=all + relative period) "
            "or GET_CAMPAIGN_REPORT next. For ontology analytics use ask_ontology."
        ),
        "message": (
            "REPORTS_MISS: campaign_sql and semantic returned no rows. "
            "Use LIST_MONITOR_CAMPAIGNS or GET_CAMPAIGN_REPORT. "
            "For past-campaign / graph analytics use ask_ontology."
        ),
    }


async def handle_get_campaign_live_status(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    _ = session_id
    campaign_id = str(args.get("campaign_id") or "").strip()
    if not campaign_id:
        return {
            "ok": False,
            "error": "campaign_id is required",
            "hint": "Call LIST_MONITOR_CAMPAIGNS first, then pass a campaign id.",
        }
    data = await fetch_campaign_live_status(token, campaign_id)
    if not data:
        return {
            "ok": False,
            "error": "live_status_unavailable",
            "hint": "Retry or confirm the campaign id and your access.",
        }
    return {
        "ok": True,
        "kind": "executed",
        "source": "campaign_live_status",
        "live_status": data,
        "message": (
            "LIVE_STATUS_OK: cite queued_batches, sending_batches, and per-channel "
            "pending/sent/failed. Always mention as_of from the payload."
        ),
    }


async def handle_get_portfolio_performance(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    from app.session_store import get_or_create_session

    mode = str(args.get("mode") or "launch").strip().lower() or "launch"
    session = await get_or_create_session(session_id, token=token, module="reports")
    merged = merge_portfolio_performance_args(session, args)
    relative = merged.get("relative")
    from_date = merged.get("from_date")
    to_date = merged.get("to_date")
    activity_from = merged.get("activity_from")
    activity_to = merged.get("activity_to")
    channels = merged.get("channels")

    data = await fetch_portfolio_performance(
        token,
        mode=mode,
        relative=relative,
        from_date=from_date,
        to_date=to_date,
        activity_from=activity_from,
        activity_to=activity_to,
        channels=channels,
    )
    if not data:
        return {
            "ok": False,
            "error": "portfolio_performance_unavailable",
            "hint": "Align relative/from_date/to_date with dashboard_period.",
        }
    totals = data.get("portfolio_totals") or {}
    return {
        "ok": True,
        "kind": "executed",
        "source": "portfolio_performance",
        "performance": data,
        "portfolio_totals": totals,
        "dashboard_parity": totals,
        "message": (
            "PORTFOLIO_PERFORMANCE_OK: cite portfolio_totals (Overview parity). "
            "campaigns_ran = ran count; campaigns_with_send = campaigns with ≥1 delivery; "
            "sent/messages_sent = message deliveries; failed = message failures; "
            "open_rate_display/click_rate_display with open_tracked_delivered and "
            "click_tracked_delivered. Do not swap campaign counts with message volume. "
            f"performance_mode={data.get('performance_mode')}."
        ),
    }


async def handle_get_activity_series(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    from app.session_store import get_or_create_session

    session = await get_or_create_session(session_id, token=token, module="reports")
    merged = merge_portfolio_performance_args(session, args)
    relative = merged.get("relative")
    from_date = merged.get("activity_from") or merged.get("from_date")
    to_date = merged.get("activity_to") or merged.get("to_date")
    channels = merged.get("channels")
    data = await fetch_portfolio_activity_series(
        token,
        relative=relative,
        from_date=from_date,
        to_date=to_date,
        channels=channels,
    )
    if not data:
        return {
            "ok": False,
            "error": "activity_series_unavailable",
            "hint": "Retry with relative or from_date/to_date aligned to dashboard_period.",
        }
    return {
        "ok": True,
        "kind": "executed",
        "source": "activity_series",
        "activity_series": data,
        "message": "ACTIVITY_SERIES_OK: cite series[] and as_of; event-time IST buckets.",
    }


async def handle_get_ops_feed(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    from app.session_store import get_or_create_session

    session = await get_or_create_session(session_id, token=token, module="reports")
    merged = merge_portfolio_performance_args(session, args)
    data = await fetch_campaign_ops_feed(
        token,
        relative=merged.get("relative"),
        from_date=merged.get("from_date"),
        to_date=merged.get("to_date"),
        activity_from=merged.get("activity_from"),
        activity_to=merged.get("activity_to"),
        channels=merged.get("channels"),
    )
    if not data:
        return {
            "ok": False,
            "error": "ops_feed_unavailable",
            "hint": "Retry; confirm Campaign API is reachable.",
        }
    return {
        "ok": True,
        "kind": "executed",
        "source": "ops_feed",
        "ops_feed": data,
        "message": (
            "OPS_FEED_OK: active_sends + recent_failures + activity_series — "
            "ground live answers in this payload."
        ),
    }


async def handle_get_recent_send_failures(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    _ = session_id
    campaign_id = str(args.get("campaign_id") or "").strip() or None
    channel = str(args.get("channel") or "").strip() or None
    limit = int(args.get("limit") or 20)
    data = await fetch_recent_send_failures(
        token,
        campaign_id=campaign_id,
        channel=channel,
        limit=limit,
    )
    if not data:
        return {
            "ok": False,
            "error": "recent_failures_unavailable",
            "hint": "Retry or narrow with campaign_id / channel.",
        }
    return {
        "ok": True,
        "kind": "executed",
        "source": "recent_send_failures",
        "failures": data,
        "message": (
            "FAILURES_OK: quote skip_fail_reason and updated_at per row. "
            "Do not invent failure causes."
        ),
    }


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback: Any = None,
) -> dict[str, Any]:
    try:
        if name == "ask_ontology":
            return await handle_ask_ontology(session_id, token, args)

        if name == "query_analytics":
            return await handle_query_analytics(session_id, token, args)

        if name == "ask_semantic_layer":
            return await handle_ask_semantic_layer(session_id, token, args)

        if name == "LIST_MONITOR_CAMPAIGNS":
            result = await campaign_handlers.handle_list(session_id, token, args)
            if result.get("ok") and not result.get("campaigns"):
                result = {
                    **result,
                    "message": result.get("message")
                    or "No campaigns matched these filters.",
                    "hint": "Try bucket=all, drop date filters, or another status.",
                }
            return result

        if name == "GET_CAMPAIGN_LIVE_STATUS":
            return await handle_get_campaign_live_status(
                session_id, token, args
            )

        if name == "GET_RECENT_SEND_FAILURES":
            return await handle_get_recent_send_failures(
                session_id, token, args
            )

        if name == "GET_PORTFOLIO_PERFORMANCE":
            return await handle_get_portfolio_performance(session_id, token, args)

        if name == "GET_ACTIVITY_SERIES":
            return await handle_get_activity_series(session_id, token, args)

        if name == "GET_OPS_FEED":
            return await handle_get_ops_feed(session_id, token, args)

        if name == "GET_CAMPAIGN_REPORT":
            result = await campaign_handlers.handle_report(
                session_id, token, args
            )
            if not result.get("ok"):
                result = {
                    **result,
                    "hint": result.get("hint")
                    or "Call LIST_MONITOR_CAMPAIGNS first and use a returned id.",
                }
            return result

        if name == "GET_CAMPAIGN_AUDIENCE":
            result = await campaign_handlers.handle_audience(
                session_id, token, args
            )
            if not result.get("ok"):
                result = {
                    **result,
                    "hint": result.get("hint")
                    or "Call LIST_MONITOR_CAMPAIGNS first and use a returned id.",
                }
            return result

        if name == "STOP_CAMPAIGN":
            return await campaign_handlers.handle_stop_campaign(
                session_id, token, args
            )

        if name == "STOP_CHANNEL":
            return await campaign_handlers.handle_stop(
                session_id, token, args
            )

        if name == "RESUME_CHANNEL":
            return await campaign_handlers.handle_resume(
                session_id, token, args
            )

        if name == "LIST_EVENTS":
            result = await events_handlers.handle_list(session_id, token, args)
            if result.get("ok") and not result.get("events"):
                result = {
                    **result,
                    "hint": (
                        "Events come from the Reports page snapshot; open Reports "
                        "with events available, or create/launch events first."
                    ),
                }
            return result

        if name == "GET_EVENT_DETAIL":
            result = await events_handlers.handle_detail(
                session_id, token, args
            )
            if not result.get("ok"):
                result = {
                    **result,
                    "hint": "LIST_EVENTS first, then pass event_id or an exact/partial title.",
                }
            return result

        if name == "ROUTE_TO_MODULE":
            _ = session_id, token
            result = await dispatch_route_to_module(args)
            if event_callback and result.get("ui_event"):
                await event_callback(result["ui_event"])
            return result

        return {
            "ok": False,
            "error": f"Unknown tool: {name}",
            "hint": (
                "Use ask_ontology for analytics, query_analytics for KPIs, "
                "LIST_MONITOR_CAMPAIGNS, GET_CAMPAIGN_REPORT, "
                "GET_CAMPAIGN_AUDIENCE, LIST_EVENTS, or GET_EVENT_DETAIL."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        _ = event_callback
        return _safe_error(f"Tool {name} failed", exc)
