#!/usr/bin/env python3
"""Compare webtracking SQL templates vs ClickHouse reference SELECTs.

Org 1003 / website_id 1001. Template path mirrors the API:
  semantic.sql.template_execute.execute_prepared_templates → metric_fallback.

Drift tolerances:
  - rates (*_rate): ≤ 0.5 absolute percent points
  - counts: ± 1
  - floats: ≤ 1% relative OR ± 0.5 absolute

Usage:
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \\
    PYTHONPATH=. python3 scripts/validate_webtracking_ch_refs.py

Exit 0 if all pass, 1 otherwise.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ORG = 1003
WEBSITE_ID = 1001
USER_ID = int(os.environ.get("USER_ID", "1019"))

# Clear proxy env (same effect as `env -u …_proxy`) before CH connects.
_PROXY_KEYS = (
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "all_proxy",
    "no_proxy",
    "NO_PROXY",
)


def _load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


def _clear_proxy_env() -> None:
    for key in _PROXY_KEYS:
        os.environ.pop(key, None)


_load_dotenv()
_clear_proxy_env()

# Tier-1 + engagement/campaign from WEBTRACKING_CH_REFERENCE_SQL.md,
# including the 11 former no_reference_sql metrics.
RATE_METRICS = frozenset(
    {
        "bounce_rate",
        "scroll_engagement_rate",
        "landing_page_conversion_rate",
        "form_submit_rate",
        "form_success_rate",
        "form_abandon_rate",
        "checkout_start_rate",
        "checkout_conversion_rate",
        "cart_add_rate",
        "product_view_rate",
        "poor_vitals_rate",
        "campaign_attributed_session_rate",
    }
)

COUNT_METRICS = frozenset(
    {
        "web_session_volume",
        "unique_visitors",
        "page_views",
        "bounce_count",
        "campaign_attributed_sessions",
    }
)

# Inline reference SQL — single numeric result column named like the metric.
REFERENCE_SQL: dict[str, str] = {
    "web_session_volume": """
        SELECT uniqExact(session_id) AS web_session_volume
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "unique_visitors": """
        SELECT uniqExact(visitor_id) AS unique_visitors
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "page_views": """
        SELECT count(page_view_id) AS page_views
        FROM webtracking_marts.mart_page_views
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "average_session_duration": """
        SELECT avgIf(duration_seconds, page_view_count > 0) AS average_session_duration
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "bounce_rate": """
        SELECT
          sum(is_bounce_flag) * 100.0
          / nullIf(uniqExactIf(session_id, page_view_count > 0), 0) AS bounce_rate
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "bounce_count": """
        SELECT sum(is_bounce_flag) AS bounce_count
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "avg_time_on_page_seconds": """
        SELECT avgIf(time_on_page_sec, time_on_page_sec > 0) AS avg_time_on_page_seconds
        FROM webtracking_marts.mart_page_views
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "avg_scroll_depth": """
        SELECT avgIf(max_scroll_depth, max_scroll_depth > 0) AS avg_scroll_depth
        FROM webtracking_marts.mart_page_views
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "scroll_engagement_rate": """
        SELECT
          sum(has_deep_scroll) * 100.0 / nullIf(uniqExact(session_id), 0)
            AS scroll_engagement_rate
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "events_per_session": """
        SELECT
          (SELECT count(event_id)
           FROM webtracking_marts.mart_interaction_events
           WHERE organization_id = 1003 AND website_id = 1001)
          / nullIf(
              (SELECT uniqExact(session_id)
               FROM webtracking_marts.mart_web_sessions
               WHERE organization_id = 1003 AND website_id = 1001),
              0
            ) AS events_per_session
    """,
    "landing_page_conversion_rate": """
        SELECT
          uniqExactIf(
            s.session_id,
            c.conversion_id IS NOT NULL AND c.conversion_id != ''
          ) * 100.0
          / nullIf(uniqExact(s.session_id), 0) AS landing_page_conversion_rate
        FROM webtracking_marts.mart_web_sessions s
        LEFT JOIN webtracking_marts.mart_conversion_events c
          ON s.session_id = c.session_id
         AND s.organization_id = c.organization_id
         AND s.website_id = c.website_id
        WHERE s.organization_id = 1003
          AND s.website_id = 1001
    """,
    "form_submit_rate": """
        SELECT
          countIf(event_type = 'form_submit') * 100.0
          / nullIf(countIf(event_type = 'form_view'), 0) AS form_submit_rate
        FROM webtracking_marts.mart_form_events
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "form_success_rate": """
        SELECT
          countIf(event_type = 'form_success') * 100.0
          / nullIf(countIf(event_type = 'form_submit'), 0) AS form_success_rate
        FROM webtracking_marts.mart_form_events
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "form_abandon_rate": """
        SELECT
          countIf(event_type = 'form_abandon') * 100.0
          / nullIf(countIf(event_type = 'form_start'), 0) AS form_abandon_rate
        FROM webtracking_marts.mart_form_events
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "checkout_start_rate": """
        SELECT
          sum(has_checkout_start) * 100.0 / nullIf(uniqExact(session_id), 0)
            AS checkout_start_rate
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "checkout_conversion_rate": """
        SELECT
          coalesce(
            countIf(conversion_type = 'purchase') * 100.0
            / nullIf(countIf(conversion_type = 'begin_checkout'), 0),
            0
          ) AS checkout_conversion_rate
        FROM webtracking_marts.mart_conversion_events
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "cart_add_rate": """
        SELECT
          sum(has_cart_add) * 100.0 / nullIf(uniqExact(session_id), 0) AS cart_add_rate
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "product_view_rate": """
        SELECT
          sum(has_product_view) * 100.0 / nullIf(uniqExact(session_id), 0)
            AS product_view_rate
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "poor_vitals_rate": """
        SELECT
          coalesce(
            countIf(rating = 'poor') * 100.0 / nullIf(count(event_id), 0),
            0
          ) AS poor_vitals_rate
        FROM webtracking_marts.mart_performance_events
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "campaign_attributed_sessions": """
        SELECT sum(is_campaign_attributed) AS campaign_attributed_sessions
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
    "campaign_attributed_session_rate": """
        SELECT
          sum(is_campaign_attributed) * 100.0 / nullIf(uniqExact(session_id), 0)
            AS campaign_attributed_session_rate
        FROM webtracking_marts.mart_web_sessions
        WHERE organization_id = 1003 AND website_id = 1001
    """,
}

METRICS = list(REFERENCE_SQL.keys())


def _to_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _within_tolerance(metric: str, tpl: float | None, ref: float | None) -> tuple[bool, str]:
    if tpl is None and ref is None:
        return True, "both null"
    if tpl is None or ref is None:
        return False, f"null mismatch tpl={tpl!r} ref={ref!r}"

    delta = abs(tpl - ref)
    if metric in RATE_METRICS:
        ok = delta <= 0.5
        return ok, f"rate Δ={delta:.6g} (≤0.5 pp)"
    if metric in COUNT_METRICS:
        ok = delta <= 1.0
        return ok, f"count Δ={delta:.6g} (±1)"
    # floats: ≤1% relative OR ±0.5 absolute
    rel = delta / abs(ref) if ref != 0 else (0.0 if tpl == 0 else float("inf"))
    ok = delta <= 0.5 or rel <= 0.01
    return ok, f"float Δ={delta:.6g} rel={rel:.4%} (≤0.5 abs or ≤1% rel)"


def _build_prepared(metric_id: str) -> dict[str, Any]:
    """Prepared dict shaped like semantic.query.validate_and_prepare output."""
    from semantic.scope import UserScope

    return {
        "organizationId": ORG,
        "userId": USER_ID,
        "product": "webtracking",
        "execution_product": "webtracking",
        "agent": "webtracking.analytics",
        "metrics": [metric_id],
        "websiteId": WEBSITE_ID,
        "website_id": WEBSITE_ID,
        "time": {"period": "overall"},
        "user_filters": [],
        "group_by": [],
        "group_by_requested": [],
        "limit": 50,
        # Stub scope so template_execute skips Postgres lookup_user_scope.
        "user_scope": UserScope(
            user_id=str(USER_ID),
            organization_id=str(ORG),
            role="admin",
            product_id="webtracking",
            visible_user_ids=[str(USER_ID)],
        ),
    }


def _template_value(metric_id: str) -> tuple[float | None, str]:
    from semantic.sql.template_execute import execute_prepared_templates

    prepared = _build_prepared(metric_id)
    try:
        result = execute_prepared_templates(prepared)
    except Exception as exc:
        return None, f"template error: {exc}"
    rows = result.get("rows") or []
    if not rows:
        return None, "template empty rows"
    raw = rows[0].get(metric_id)
    return _to_float(raw), ""


def _reference_value(metric_id: str) -> tuple[float | None, str]:
    from semantic.sql.db import run_clickhouse_query

    sql = REFERENCE_SQL[metric_id].strip()
    try:
        rows = run_clickhouse_query(sql, [])
    except Exception as exc:
        return None, f"ref error: {exc}"
    if not rows:
        return None, "ref empty rows"
    raw = rows[0].get(metric_id)
    if raw is None and len(rows[0]) == 1:
        raw = next(iter(rows[0].values()))
    return _to_float(raw), ""


def main() -> int:
    print(f"Webtracking CH refs: org={ORG} website_id={WEBSITE_ID} metrics={len(METRICS)}")
    print(f"Proxy cleared: {', '.join(_PROXY_KEYS)}")
    print()

    passed = 0
    failed = 0
    rows: list[tuple[str, str, str, str, str]] = []

    for mid in METRICS:
        tpl, tpl_err = _template_value(mid)
        ref, ref_err = _reference_value(mid)
        note = tpl_err or ref_err
        ok, tol_note = _within_tolerance(mid, tpl, ref)
        if note:
            ok = False
            detail = note
        else:
            detail = tol_note
        mark = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        tpl_s = "None" if tpl is None else f"{tpl:.6g}"
        ref_s = "None" if ref is None else f"{ref:.6g}"
        print(f"  {mark}  {mid}: tpl={tpl_s} ref={ref_s} — {detail}")
        rows.append((mid, mark, tpl_s, ref_s, detail))

    print()
    print(f"Summary: {passed} passed, {failed} failed / {len(METRICS)}")
    if failed:
        print("FAILED metrics:")
        for mid, mark, tpl_s, ref_s, detail in rows:
            if mark == "FAIL":
                print(f"  - {mid}: tpl={tpl_s} ref={ref_s} ({detail})")
        return 1
    print("All webtracking CH reference checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
