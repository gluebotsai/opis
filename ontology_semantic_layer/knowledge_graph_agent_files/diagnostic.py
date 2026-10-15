# ==============================================================================
# diagnostic.py — Root-Cause & Diagnostic Reasoning for Knowledge Graph Agent
# ==============================================================================

import os
import json
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import List, Dict, Any, Optional

from .tools import KGClient, CONFIG, org_db_name

logger = logging.getLogger(__name__)

_thread_pool = ThreadPoolExecutor(max_workers=2)

_DIAGNOSTIC_SYSTEM_PROMPT = """You are an expert Contact Center Intelligence and Diagnostic Specialist.
Your role is to diagnose WHY and HOW metric changes occurred by combining exact database metrics with operational events from the Knowledge Graph.

CRITICAL RULES:
1. Provide a direct, professional, and clear explanation in plain English (2 to 4 sentences or a concise breakdown).
2. Cite the exact numerical changes, deltas, or percentages provided in the SQL metrics (e.g. "Volume dropped by 76%, driven by a 91.8% decline in WhatsApp...").
3. Connect these metric movements to any relevant operational events from the Knowledge Graph (such as system anomaly alerts, holiday closures, or routing timeouts).
4. If the Knowledge Graph shows NO system anomalies, outages, or holidays, explicitly note that operations were otherwise nominal and explain the trend based on the metric distributions.
5. STRICT FACTUALITY: NEVER invent or hallucinate external causes (like marketing pauses or staff shortages) unless explicitly documented in the provided context.
6. DO NOT mention SQL, database tables, Cypher, Neo4j, or technical system names. Speak to the business leader about contact center operations.
7. If the database analysis shows 0 records for the period, clearly inform the user that no metric spike or breach occurred for that specific date because no records were logged, and cite the operational events from the Knowledge Graph (such as agent availability or system anomaly alerts) to explain the operational status.
"""


def _query_graph_events(db_name: str) -> Dict[str, Any]:
    """Queries live operational nodes in Neo4j via KGClient."""
    kg_client = KGClient.get_instance(CONFIG)
    if not kg_client:
        return {}

    events = {
        "anomaly_alerts": [],
        "holidays": [],
        "routing_incidents": []
    }

    # 1. Fetch recent Anomaly Alerts
    try:
        alerts = kg_client.execute_cypher(
            """
            MATCH (a:AnomalyAlert)
            RETURN a.severity AS severity, a.message AS message, a.metric_key AS metric
            ORDER BY a.created_at DESC
            LIMIT 4
            """,
            db_name=db_name
        )
        events["anomaly_alerts"] = alerts or []
    except Exception as e:
        logger.debug(f"[KGDiagnostic] Failed to query AnomalyAlerts: {e}")

    # 2. Fetch Holiday Calendars
    try:
        holidays = kg_client.execute_cypher(
            """
            MATCH (h:HolidayCalendar)
            RETURN h.holiday_dates AS holiday_dates, h.holiday_names AS holiday_names, h.name AS calendar_name
            LIMIT 2
            """,
            db_name=db_name
        )
        events["holidays"] = holidays or []
    except Exception as e:
        logger.debug(f"[KGDiagnostic] Failed to query HolidayCalendars: {e}")

    # 3. Fetch Conversation Summaries with operational flags
    try:
        incidents = kg_client.execute_cypher(
            """
            MATCH (s:ConversationSummary)
            WHERE s.extracted_facts IS NOT NULL
            RETURN s.extracted_facts AS facts, s.summary AS summary
            LIMIT 3
            """,
            db_name=db_name
        )
        events["routing_incidents"] = incidents or []
    except Exception as e:
        logger.debug(f"[KGDiagnostic] Failed to query ConversationSummaries: {e}")

    return events


def fetch_graph_operational_context(org_id: str, timeout_seconds: float = 3.0) -> str:
    """
    Safely queries operational events from Neo4j with a strict timeout.
    Returns a clean markdown block suitable for injecting into the LLM synthesis prompt.
    """
    db_name = org_db_name(org_id)
    raw_events = {}

    future = _thread_pool.submit(_query_graph_events, db_name)
    try:
        raw_events = future.result(timeout=timeout_seconds)
    except TimeoutError:
        logger.warning(f"[KGDiagnostic] Neo4j event query timed out after {timeout_seconds}s for {db_name}")
        return "• Knowledge Graph operational context: Query timed out."
    except Exception as e:
        logger.warning(f"[KGDiagnostic] Error fetching graph context: {e}")
        return "• Knowledge Graph operational context: Not available."

    lines = ["OPERATIONAL EVENTS FROM KNOWLEDGE GRAPH:"]
    has_content = False

    # Format Anomaly Alerts
    alerts = raw_events.get("anomaly_alerts", [])
    if alerts:
        has_content = True
        lines.append("• Recorded Anomaly Alerts:")
        for a in alerts:
            sev = a.get("severity", "INFO")
            metric = a.get("metric", "General")
            msg = a.get("message", "").strip()
            lines.append(f"  - [{sev}] {metric}: {msg}")

    # Format Holidays
    holidays = raw_events.get("holidays", [])
    if holidays:
        has_content = True
        lines.append("• Calendar Context:")
        for h in holidays:
            names = h.get("holiday_names", [])
            dates = h.get("holiday_dates", [])
            cal_name = h.get("calendar_name", "Corporate Calendar")
            if names and dates:
                pairs = [f"{n} ({d})" for n, d in zip(names[:3], dates[:3])]
                lines.append(f"  - {cal_name}: {', '.join(pairs)}")

    # Format Routing Incidents
    incidents = raw_events.get("routing_incidents", [])
    if incidents:
        has_content = True
        lines.append("• Recorded Agent & Routing Incidents:")
        for inc in incidents:
            facts = inc.get("facts", [])
            summary = (inc.get("summary") or "").strip().replace("\n", " ")
            if len(summary) > 140:
                summary = summary[:137] + "..."
            facts_str = f" [Tags: {', '.join(facts)}]" if facts else ""
            lines.append(f"  - {summary}{facts_str}")

    if not has_content:
        lines.append("• No system anomaly alerts, holiday events, or agent availability incidents were recorded for this period.")

    return "\n".join(lines)


async def diagnose_from_metrics(
    query: str,
    sql_rows: List[Dict[str, Any]],
    org_id: str | None = None
) -> str:
    """
    Synthesizes deep root-cause reasoning by combining SQL metrics with Neo4j operational context.
    """
    org_id = org_id or os.getenv("KG_ORGANIZATION_ID", os.getenv("ORGANIZATION_ID", "1012"))
    if not sql_rows:
        metrics_block = "0 matching records were found in the database for the requested period. No active conversation, metric spike, or SLA breach event was recorded in the database for this specific date/timeframe."
    else:
        sample_rows = sql_rows[:25]
        metrics_block = json.dumps(sample_rows, indent=2, default=str)

    graph_context = fetch_graph_operational_context(org_id=org_id)

    user_prompt = f"""User Reporting Question: "{query}"

SQL DATABASE METRIC ANALYSIS:
{metrics_block}

{graph_context}

Provide a comprehensive diagnostic explanation of why this occurred:"""

    try:
        from .llm import OpenAILLM
        llm = OpenAILLM()
    except Exception:
        from app.utils.llm_client import GEMMAAILLM
        llm = GEMMAAILLM()

    messages = [
        {"role": "system", "content": _DIAGNOSTIC_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    try:
        res = llm.run(messages)
        content = res.get("content", "").strip()
        if content:
            return content
    except Exception as e:
        logger.warning(f"[KGDiagnostic] LLM synthesis failed: {e}")

    sample_preview = sample_rows[:3] if sql_rows else []
    return f"Retrieved metrics: {json.dumps(sample_preview, default=str)}"
