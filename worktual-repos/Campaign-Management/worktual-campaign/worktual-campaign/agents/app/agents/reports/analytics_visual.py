"""Map semantic / tool metric rows → CRM-style analytics.visual v1.0 envelope."""

from __future__ import annotations

from typing import Any

# Metric ids (and key suffixes) that arrive as 0–1 fractions from the gateway.
_RATE_METRIC_IDS = frozenset(
    {
        "open_rate",
        "click_rate",
        "delivery_rate",
        "ctor",
        "ctor_pct",
        "unsubscribe_rate",
        "bounce_rate",
        "failure_rate",
    }
)


def _is_rate_key(key: str) -> bool:
    k = str(key or "").strip().lower()
    if k in _RATE_METRIC_IDS:
        return True
    if k.endswith("_rate") or k.endswith("_rate_pct"):
        return True
    return False


def _format_value(key: str, value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float)):
        if _is_rate_key(key) and abs(float(value)) <= 1.5:
            return f"{round(float(value) * 100, 1)}%"
        if isinstance(value, float) and not value.is_integer():
            return f"{value:,.2f}".rstrip("0").rstrip(".")
        return f"{int(value):,}" if float(value) == int(value) else f"{value:,.1f}"
    return str(value)


def _human_label(key: str) -> str:
    k = str(key or "").strip()
    if not k:
        return "Value"
    # Drop dimension prefixes like campaign__campaign_status
    if "__" in k:
        k = k.split("__")[-1]
    friendly = {
        "past_all_time": "Past (all time, monitoring tab)",
        "campaigns_ran": "Campaigns ran (Overview period)",
        "campaigns_ran_in_period": "Campaigns ran (period)",
    }
    if k in friendly:
        return friendly[k]
    return k.replace("_", " ").strip().title()


def _row_numeric_entries(row: dict[str, Any]) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    for key, value in row.items():
        if key.startswith("_"):
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out.append((key, value))
        elif value is None and _is_rate_key(key):
            out.append((key, None))
    return out


def _dimension_keys(row: dict[str, Any]) -> list[str]:
    return [
        k
        for k, v in row.items()
        if not isinstance(v, (int, float, bool))
        and v is not None
        and str(v).strip()
        and not k.startswith("_")
    ]


def build_visual_from_semantic_results(
    *,
    query: str,
    usable: list[dict[str, Any]],
    organization_id: str,
    source: str = "semantic_layer",
) -> dict[str, Any] | None:
    """Build StructuredAnalytics from gateway usable metric results."""
    if not usable:
        return None

    metric_ids: list[str] = []
    seen_metric_ids: set[str] = set()
    findings_rows: list[dict[str, Any]] = []
    kpis: list[dict[str, str]] = []
    kpi_labels_seen: set[str] = set()
    chart_data: list[dict[str, Any]] = []
    table_columns: list[dict[str, str]] = []
    table_rows: list[dict[str, Any]] = []
    kind = "kpi"
    title = "Campaign metrics"
    summary_bits: list[str] = []

    for item in usable:
        mid = str(item.get("metric_id") or "").strip()
        if mid:
            if mid in seen_metric_ids:
                continue
            seen_metric_ids.add(mid)
            metric_ids.append(mid)
        rows = item.get("rows") if isinstance(item.get("rows"), list) else []
        if not rows:
            continue

        # Prefer first non-empty title from metric id
        if mid and title == "Campaign metrics":
            if mid == "campaigns_ran":
                title = "Campaigns ran"
            elif mid == "campaign_sent_count":
                title = "Messages sent"
            else:
                title = _human_label(mid)

        # Multi-row with dimensions → bar/table
        if len(rows) > 1 or (
            len(rows) == 1 and _dimension_keys(rows[0] if isinstance(rows[0], dict) else {})
        ):
            dim_keys: list[str] = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                dim_keys = _dimension_keys(row) or dim_keys
                nums = _row_numeric_entries(row)
                if not nums:
                    continue
                label_parts = [
                    str(row.get(d) or "").strip() for d in dim_keys if row.get(d) is not None
                ]
                label = " / ".join(p for p in label_parts if p) or mid or "Row"
                primary_key, primary_val = nums[0]
                chart_data.append(
                    {
                        "label": label,
                        "value": (
                            round(float(primary_val) * 100, 1)
                            if primary_val is not None
                            and _is_rate_key(primary_key)
                            and abs(float(primary_val)) <= 1.5
                            else primary_val
                        ),
                    }
                )
                findings_rows.append(
                    {"label": label, "value": _format_value(primary_key, primary_val)}
                )
                summary_bits.append(f"{label}: {_format_value(primary_key, primary_val)}")
                # Table
                if not table_columns:
                    cols = [{"key": "label", "label": "Segment"}]
                    for nk, _ in nums:
                        cols.append({"key": nk, "label": _human_label(nk)})
                    table_columns = cols
                trow: dict[str, Any] = {"label": label}
                for nk, nv in nums:
                    trow[nk] = _format_value(nk, nv)
                table_rows.append(trow)

            if len(chart_data) > 1:
                # Status/share style → pie; date-like labels → line; else bar
                labels_lower = [str(c.get("label") or "").lower() for c in chart_data]
                if all(
                    any(tok in lab for tok in ("live", "scheduled", "draft", "past", "completed"))
                    for lab in labels_lower
                ) or mid.endswith("_share"):
                    kind = "pie"
                elif all(
                    len(lab) >= 8 and lab[4:5] == "-"
                    for lab in labels_lower
                    if lab
                ):
                    kind = "line"
                else:
                    kind = "bar"
            elif table_rows:
                kind = "table"
            continue

        # Single scalar row → KPI
        row0 = rows[0] if isinstance(rows[0], dict) else {}
        nums = _row_numeric_entries(row0) or [
            (mid or "value", row0.get(mid) if mid else None)
        ]
        for key, value in nums:
            label = _human_label(key if key != "value" else mid or "Value")
            display = _format_value(key, value)
            if label in kpi_labels_seen:
                continue
            kpi_labels_seen.add(label)
            kpis.append({"label": label, "value": display})
            findings_rows.append({"label": label, "value": display})
            summary_bits.append(f"{label} is {display}")

    if not findings_rows and not kpis and not chart_data:
        return None

    if kind == "bar" and chart_data:
        visual: dict[str, Any] = {
            "version": "1.0",
            "kind": "bar",
            "title": title,
            "description": str(query or "").strip() or None,
            "chart": {
                "xKey": "label",
                "data": chart_data,
                "series": [{"key": "value", "label": title}],
            },
        }
    elif kind == "pie" and chart_data:
        visual = {
            "version": "1.0",
            "kind": "pie",
            "title": title,
            "description": str(query or "").strip() or None,
            "chart": {
                "xKey": "label",
                "data": chart_data,
                "series": [{"key": "value", "label": title}],
            },
        }
    elif kind == "line" and chart_data:
        visual = {
            "version": "1.0",
            "kind": "line",
            "title": title,
            "description": str(query or "").strip() or None,
            "chart": {
                "xKey": "label",
                "data": chart_data,
                "series": [{"key": "value", "label": title}],
            },
        }
    elif kind == "table" and table_rows:
        visual = {
            "version": "1.0",
            "kind": "table",
            "title": title,
            "description": str(query or "").strip() or None,
            "table": {"columns": table_columns, "rows": table_rows},
        }
    else:
        if not kpis and findings_rows:
            kpis = [
                {"label": str(r["label"]), "value": str(r["value"])}
                for r in findings_rows[:6]
            ]
        visual = {
            "version": "1.0",
            "kind": "kpi",
            "title": title if len(kpis) <= 1 else "Campaign metrics",
            "description": str(query or "").strip() or None,
            "kpis": kpis[:8],
        }

    summary = "; ".join(summary_bits[:4]) if summary_bits else title
    return {
        "plan": {"source": source},
        "findings": {
            "summary": summary,
            "rows": findings_rows[:20],
        },
        "visual": visual,
        "audit": {
            "source": source,
            "organizationId": str(organization_id or ""),
            "businessType": "campaign",
            "metricIds": metric_ids,
            "rowCount": len(findings_rows) or len(kpis),
        },
    }


def build_visual_from_monitoring_tab_counts(
    *,
    counts: dict[str, Any],
    organization_id: str,
    query: str = "",
) -> dict[str, Any] | None:
    """KPI visual for Campaign monitoring tab badges (all-time)."""
    if not isinstance(counts, dict):
        return None
    past = counts.get("past_all_time", counts.get("past"))
    if past is None:
        return None
    kpis = [
        {
            "label": "Past (all time, monitoring tab)",
            "value": _format_value("past_all_time", past),
        },
    ]
    for key, label in (
        ("live", "Live"),
        ("scheduled", "Scheduled"),
        ("draft", "Draft"),
        ("on_demand", "On-demand"),
    ):
        if key in counts and counts[key] is not None:
            kpis.append(
                {"label": label, "value": _format_value(key, counts[key])}
            )
    summary = (
        f"{kpis[0]['label']} is {kpis[0]['value']} "
        "(completed+cancelled campaigns, no date filter)."
    )
    return {
        "plan": {"source": "monitoring_tab_counts"},
        "findings": {"summary": summary, "rows": kpis},
        "visual": {
            "version": "1.0",
            "kind": "kpi",
            "title": "Campaign monitoring",
            "description": query or None,
            "kpis": kpis[:8],
        },
        "audit": {
            "source": "monitoring_tab_counts",
            "organizationId": str(organization_id or ""),
            "businessType": "campaign",
            "metricIds": ["campaign_status_counts"],
            "rowCount": len(kpis),
        },
    }


def build_visual_from_monitor_totals(
    *,
    totals: dict[str, Any],
    title: str,
    organization_id: str,
    query: str = "",
) -> dict[str, Any] | None:
    """Fallback visual from LIST_MONITOR_CAMPAIGNS totals_all_matched."""
    if not isinstance(totals, dict) or not totals:
        return None

    def pick(*keys: str) -> Any:
        for k in keys:
            if k in totals and totals[k] is not None:
                return totals[k]
        return None

    kpis: list[dict[str, str]] = []
    findings: list[dict[str, Any]] = []

    mapping = [
        ("Campaigns", pick("campaigns", "total_matched"), False),
        ("Sent", pick("sent"), False),
        ("Delivered", pick("delivered"), False),
        ("Failed", pick("failed"), False),
        (
            "Open rate",
            pick("open_rate_display")
            or (
                f"{pick('open_rate_pct')}%"
                if pick("open_rate_pct") is not None
                else None
            ),
            True,
        ),
        (
            "Click rate",
            pick("click_rate_display")
            or (
                f"{pick('click_rate_pct')}%"
                if pick("click_rate_pct") is not None
                else None
            ),
            True,
        ),
        ("Opens", pick("opens"), False),
        ("Clicks", pick("clicks"), False),
    ]
    for label, value, _is_rate in mapping:
        if value is None or value == "":
            continue
        display = str(value) if isinstance(value, str) else _format_value("count", value)
        kpis.append({"label": label, "value": display})
        findings.append({"label": label, "value": display})

    if not kpis:
        return None

    summary = "; ".join(f"{k['label']} {k['value']}" for k in kpis[:4])
    return {
        "plan": {"source": "campaign_tools"},
        "findings": {"summary": summary, "rows": findings},
        "visual": {
            "version": "1.0",
            "kind": "kpi",
            "title": title or "Campaign performance",
            "description": query or None,
            "kpis": kpis[:8],
        },
        "audit": {
            "source": "campaign_tools",
            "organizationId": str(organization_id or ""),
            "businessType": "campaign",
            "metricIds": [],
            "rowCount": len(kpis),
        },
    }


def build_visual_from_campaign_report(
    *,
    report: dict[str, Any],
    organization_id: str,
) -> dict[str, Any] | None:
    """Fallback visual from GET_CAMPAIGN_REPORT body."""
    if not isinstance(report, dict):
        return None
    name = str(report.get("name") or report.get("campaign_name") or "Campaign").strip()
    totals = report.get("totals") if isinstance(report.get("totals"), dict) else report
    channels = report.get("channels") if isinstance(report.get("channels"), list) else []

    chart_data: list[dict[str, Any]] = []
    for ch in channels:
        if not isinstance(ch, dict):
            continue
        ch_name = str(ch.get("channel") or ch.get("name") or "").strip() or "channel"
        sent = ch.get("sent")
        if sent is None:
            continue
        chart_data.append({"label": ch_name, "value": int(sent or 0)})

    base = build_visual_from_monitor_totals(
        totals=totals if isinstance(totals, dict) else {},
        title=name,
        organization_id=organization_id,
    )
    if base and chart_data and len(chart_data) > 1:
        base["visual"] = {
            "version": "1.0",
            "kind": "bar",
            "title": f"{name} — sent by channel",
            "chart": {
                "xKey": "label",
                "data": chart_data,
                "series": [{"key": "value", "label": "Sent"}],
            },
        }
        base["audit"]["source"] = "campaign_tools"
    return base
