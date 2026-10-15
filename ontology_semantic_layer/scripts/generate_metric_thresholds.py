#!/usr/bin/env python3
"""Generate semantic/metric_thresholds.yml from metric_registry.yml.

Platform defaults for rates, durations, and scores. Count/amount metrics get
kind/direction but threshold: null (org file overrides).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "semantic" / "metric_registry.yml"
OUT = ROOT / "semantic" / "metric_thresholds.yml"

HIGHER_WORSE_RATE = re.compile(
    r"(breach|missed|loss|error|bounce|frustration|abandon|reject|fail|overdue|"
    r"undeliver|spam|unsub|churn|backlog|pending_approval|occupancy|utilization)",
    re.I,
)
HIGHER_BETTER_RATE = re.compile(
    r"(win|delivery|deliver|conversion|success|adopt|contain|resolution|open_rate|"
    r"click|engagement|accept|renewal|coverage|met|satisfaction|csat|fill|throughput|"
    r"handle_rate|completion|conversion|mql|customer_conversion|repurchase|pipeline)",
    re.I,
)
DURATION = re.compile(
    r"(average_|avg_|_hours|_seconds|_time|handle_time|aht|speed_of_answer|"
    r"first_response|resolution_time|sales_cycle|days_sales|decision_hours|"
    r"overdue_hours|duration|latency|wait_time)",
    re.I,
)
SCORE = re.compile(r"(score|csat|rating|nps)", re.I)
AMOUNT = re.compile(
    r"(gmv|revenue|amount|value|arr|pipeline_value|outstanding|lifetime|price)",
    re.I,
)

# Explicit direction + bands for ticketing (96) + CCaaS (58) headline KPIs.
# Overrides regex misclassification (e.g. reopen_rate, assignment_rate).
EXPLICIT: dict[str, dict] = {
    # Ticketing direction fixes
    "reopen_rate": {
        "kind": "rate",
        "direction": "higher_is_worse",
        "unit": "ratio",
        "threshold": {"warn_percent": 8, "critical_percent": 15},
        "source": "Support reopen ceiling (ITIL)",
    },
    "assignment_rate": {
        "kind": "rate",
        "direction": "higher_is_better",
        "unit": "ratio",
        "threshold": {"warn_lt_percent": 85, "critical_lt_percent": 70},
        "source": "Assignment coverage floor",
    },
    "first_response_sla_compliance_rate": {
        "kind": "rate",
        "direction": "higher_is_better",
        "unit": "ratio",
        "threshold": {"warn_lt_percent": 90, "critical_lt_percent": 80},
        "source": "FRT SLA compliance floor",
    },
    "resolution_sla_compliance_rate": {
        "kind": "rate",
        "direction": "higher_is_better",
        "unit": "ratio",
        "threshold": {"warn_lt_percent": 85, "critical_lt_percent": 75},
        "source": "Resolution SLA compliance floor",
    },
    "approval_rate": {
        "kind": "rate",
        "direction": "higher_is_better",
        "unit": "ratio",
        "threshold": {"warn_lt_percent": 80, "critical_lt_percent": 60},
        "source": "Approval throughput floor",
    },
    "csat_detractor_rate": {
        "kind": "rate",
        "direction": "higher_is_worse",
        "unit": "ratio",
        "threshold": {"warn_percent": 15, "critical_percent": 25},
        "source": "CSAT detractor ceiling",
    },
    "average_csat_score": {
        "kind": "score",
        "direction": "lower_is_worse",
        "unit": "score",
        "threshold": {"warn_lt": 3.5, "critical_lt": 3.0},
        "source": "CSAT 1-5 scale",
    },
    # CCaaS industrial bands
    "ai_containment_rate": {
        "kind": "rate",
        "direction": "higher_is_better",
        "unit": "ratio",
        "threshold": {"warn_lt_percent": 60, "critical_lt_percent": 40},
        "source": "AI containment floor",
    },
    "ai_handover_rate": {
        "kind": "rate",
        "direction": "higher_is_worse",
        "unit": "ratio",
        "threshold": {"warn_percent": 25, "critical_percent": 40},
        "source": "AI handover ceiling",
    },
    "handover_rate": {
        "kind": "rate",
        "direction": "higher_is_worse",
        "unit": "ratio",
        "threshold": {"warn_percent": 25, "critical_percent": 40},
        "source": "Handover ceiling",
    },
    "agent_assist_modification_rate": {
        "kind": "rate",
        "direction": "higher_is_worse",
        "unit": "ratio",
        "threshold": {"warn_percent": 25, "critical_percent": 40},
        "source": "Assist edit-rate ceiling",
    },
    "tool_success_rate": {
        "kind": "rate",
        "direction": "higher_is_better",
        "unit": "ratio",
        "threshold": {"warn_lt_percent": 95, "critical_lt_percent": 90},
        "source": "Tool reliability floor",
    },
    "agent_assist_adoption_rate": {
        "kind": "rate",
        "direction": "higher_is_better",
        "unit": "ratio",
        "threshold": {"warn_lt_percent": 50, "critical_lt_percent": 30},
        "source": "Assist adoption floor",
    },
    "average_handle_time": {
        "kind": "duration",
        "direction": "higher_is_worse",
        "unit": "seconds",
        "threshold": {"warn": 360, "critical": 600},
        "source": "CC AHT seconds (6/10 min)",
    },
    "average_speed_of_answer": {
        "kind": "duration",
        "direction": "higher_is_worse",
        "unit": "seconds",
        "threshold": {"warn": 30, "critical": 60},
        "source": "ASA seconds",
    },
    "average_first_response_time": {
        "kind": "duration",
        "direction": "higher_is_worse",
        "unit": "seconds",
        "threshold": {"warn": 120, "critical": 300},
        "source": "First response seconds",
    },
}

# Headline backlog / queue depth counts (platform defaults; org1000 may override).
COUNT_BACKLOG: dict[str, dict] = {
    "open_tickets_metric": {"warn": 50, "critical": 120, "source": "Ticket backlog band"},
    "unassigned_tickets_metric": {"warn": 20, "critical": 50, "source": "Unassigned backlog"},
    "breached_tickets_metric": {"warn": 10, "critical": 25, "source": "SLA breach backlog"},
    "current_overdue_tickets_metric": {"warn": 15, "critical": 40, "source": "Overdue backlog"},
    "open_conversations": {"warn": 100, "critical": 250, "source": "CC queue depth"},
    "callback_tasks": {"warn": 30, "critical": 75, "source": "Callback backlog"},
    "open_agent_tasks": {"warn": 40, "critical": 100, "source": "Agent task backlog"},
}


def _classify(metric_id: str) -> dict:
    if metric_id in EXPLICIT:
        row = dict(EXPLICIT[metric_id])
        row.setdefault("threshold", None)
        return row
    mid = metric_id.lower()
    if "_rate" in mid or mid.endswith("rate") or "ratio" in mid:
        kind = "rate"
        if HIGHER_WORSE_RATE.search(mid):
            direction = "higher_is_worse"
        elif HIGHER_BETTER_RATE.search(mid):
            direction = "higher_is_better"
        else:
            direction = "higher_is_worse"
        unit = "ratio"
    elif DURATION.search(mid):
        kind = "duration"
        direction = "higher_is_worse"
        if "hours" in mid or "days" in mid:
            unit = "hours"
        elif "seconds" in mid or "aht" in mid or "speed" in mid:
            unit = "seconds"
        else:
            unit = "time"
    elif SCORE.search(mid):
        kind = "score"
        direction = "lower_is_worse"
        unit = "score"
    elif AMOUNT.search(mid):
        kind = "amount"
        direction = "contextual"
        unit = "currency"
    else:
        kind = "count"
        direction = "contextual"
        unit = "count"

    row: dict = {
        "kind": kind,
        "direction": direction,
        "unit": unit,
        "threshold": None,
    }

    # Platform numeric defaults (auditable bands — org overlay wins).
    if metric_id == "sla_breach_rate":
        row["threshold"] = {"warn_percent": 5, "critical_percent": 10}
        row["source"] = "CC/contact-center SLA operating band"
    elif metric_id == "missed_contact_rate":
        row["threshold"] = {"warn_percent": 8, "critical_percent": 15}
        row["source"] = "CC routing SLA band"
    elif metric_id == "human_agent_occupancy_rate_presence":
        row["threshold"] = {"warn_percent": 85, "critical_percent": 92}
        row["source"] = "WFM occupancy ceiling"
    elif metric_id == "human_agent_occupancy_rate_capacity":
        row["threshold"] = {"warn_percent": 85, "critical_percent": 92}
        row["source"] = "WFM occupancy ceiling"
    elif metric_id == "average_csat_score":
        row["threshold"] = {"warn_lt": 3.5, "critical_lt": 3.0}
        row["source"] = "CSAT 1-5 scale"
    elif metric_id == "won_deal_rate":
        row["threshold"] = {"warn_lt_percent": 25, "critical_lt_percent": 15}
        row["source"] = "B2B SaaS win-rate floor"
    elif metric_id == "sales_agent_win_rate":
        row["threshold"] = {"warn_lt_percent": 25, "critical_lt_percent": 15}
        row["source"] = "B2B SaaS win-rate floor"
    elif metric_id == "loss_rate":
        row["threshold"] = {"warn_percent": 40, "critical_percent": 55}
        row["source"] = "Pipeline loss ceiling"
    elif metric_id == "delivery_rate":
        row["threshold"] = {"warn_lt_percent": 90, "critical_lt_percent": 80}
        row["source"] = "Campaign send proxy; no delivered status in source"
    elif metric_id == "open_rate":
        row["threshold"] = {"warn_lt_percent": 15, "critical_lt_percent": 8}
        row["source"] = "Email engagement band"
    elif metric_id == "click_rate":
        row["threshold"] = {"warn_lt_percent": 2, "critical_lt_percent": 0.5}
        row["source"] = "Email CTR band"
    elif metric_id == "average_handle_time":
        row["threshold"] = {"warn": 360, "critical": 600}
        row["unit"] = "seconds"
        row["source"] = "CC AHT seconds (6/10 min)"
    elif metric_id == "average_resolution_time_hours":
        row["threshold"] = {"warn": 48, "critical": 72}
        row["unit"] = "hours"
        row["source"] = "Support resolution SLA band"
    elif metric_id == "average_first_response_time":
        row["threshold"] = {"warn": 120, "critical": 300}
        row["unit"] = "seconds"
        row["source"] = "First response seconds"
    elif metric_id == "average_speed_of_answer":
        row["threshold"] = {"warn": 30, "critical": 60}
        row["unit"] = "seconds"
        row["source"] = "ASA seconds"
    elif metric_id == "resolution_rate":
        row["threshold"] = {"warn_lt_percent": 70, "critical_lt_percent": 50}
        row["source"] = "Resolution rate floor"
    elif metric_id == "mql_rate":
        row["threshold"] = {"warn_lt_percent": 10, "critical_lt_percent": 5}
        row["source"] = "Marketing qualification band"
    elif metric_id == "customer_conversion_rate":
        row["threshold"] = {"warn_lt_percent": 5, "critical_lt_percent": 2}
        row["source"] = "Lead-to-customer band"
    elif metric_id == "tool_success_rate":
        row["threshold"] = {"warn_lt_percent": 95, "critical_lt_percent": 90}
        row["source"] = "Agent assist tool reliability"
    elif metric_id == "agent_assist_adoption_rate":
        row["threshold"] = {"warn_lt_percent": 50, "critical_lt_percent": 30}
        row["source"] = "Assist adoption band"
    elif metric_id == "agent_assist_modification_rate":
        row["threshold"] = {"warn_percent": 25, "critical_percent": 40}
        row["direction"] = "higher_is_worse"
        row["source"] = "Assist edit-rate ceiling"
    elif metric_id == "ai_containment_rate":
        row["threshold"] = {"warn_lt_percent": 60, "critical_lt_percent": 40}
        row["direction"] = "higher_is_better"
        row["source"] = "AI containment floor"
    elif "bounce_rate" in mid:
        row["threshold"] = {"warn_percent": 50, "critical_percent": 70}
        row["source"] = "Web session bounce ceiling"
    elif "error_rate" in mid:
        row["threshold"] = {"warn_percent": 2, "critical_percent": 5}
        row["source"] = "Frontend error rate ceiling"

    # Generic rate defaults for remaining rate metrics without explicit row
    if kind == "rate" and row["threshold"] is None:
        if direction == "higher_is_worse":
            row["threshold"] = {"warn_percent": 10, "critical_percent": 20}
            row["source"] = "Generic rate ceiling (review per metric)"
        elif direction == "higher_is_better":
            row["threshold"] = {"warn_lt_percent": 50, "critical_lt_percent": 25}
            row["source"] = "Generic rate floor (review per metric)"

    # Generic duration defaults
    if kind == "duration" and row["threshold"] is None:
        if unit == "hours":
            row["threshold"] = {"warn": 24, "critical": 48}
        else:
            row["threshold"] = {"warn": 300, "critical": 600}
        row["source"] = "Generic duration band (review per metric)"

    if kind == "count" and metric_id in COUNT_BACKLOG:
        band = COUNT_BACKLOG[metric_id]
        row["threshold"] = {"warn": band["warn"], "critical": band["critical"]}
        row["source"] = band["source"]

    return row


def main() -> None:
    registry = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))
    metric_ids = sorted((registry.get("metrics") or {}).keys())
    if not metric_ids:
        raise SystemExit("No metrics in registry")

    metrics: dict = {}
    for mid in metric_ids:
        metrics[mid] = _classify(mid)

    doc = {
        "version": registry.get("version", "2026.09.3"),
        "note": (
            "Platform threshold defaults. Org tenants/org{id}/org{id}_metrics.yaml "
            "overrides threshold only. Regenerate: python3 scripts/generate_metric_thresholds.py"
        ),
        "metrics": metrics,
    }
    OUT.write_text(
        yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=120),
        encoding="utf-8",
    )
    with_defaults = sum(1 for m in metrics.values() if m.get("threshold") is not None)
    print(f"Wrote {OUT} — {len(metrics)} metrics, {with_defaults} with platform numeric defaults")


if __name__ == "__main__":
    main()
