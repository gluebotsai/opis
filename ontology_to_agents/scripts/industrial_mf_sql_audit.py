#!/usr/bin/env python3
"""Industrial audit: MetricFlow + SQL agent (time / no-time). Facts-only output."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


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


_load_dotenv()

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER_ID = int(os.environ.get("USER_ID", "1001"))
MARTS = os.environ.get("CCAAS_MARTS_SCHEMA", "ccass_marts_aiccaas")
DRIFT = int(os.environ.get("DRIFT_TOLERANCE", "10"))
RATE_TOL = 0.0001
AHT_TOL = 2.0


@dataclass
class Case:
    id: str
    layer: str  # mf | sql
    category: str
    ok: bool
    latency_ms: float
    detail: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class Audit:
    cases: list[Case] = field(default_factory=list)

    def add(
        self,
        case_id: str,
        layer: str,
        category: str,
        ok: bool,
        latency_ms: float,
        detail: str,
        **evidence: Any,
    ) -> None:
        self.cases.append(
            Case(case_id, layer, category, ok, latency_ms, detail, dict(evidence))
        )


def _post(path: str, body: dict) -> tuple[int, dict, float]:
    t0 = time.perf_counter()
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode()
            ms = (time.perf_counter() - t0) * 1000
            return resp.status, json.loads(raw) if raw else {}, ms
    except urllib.error.HTTPError as exc:
        ms = (time.perf_counter() - t0) * 1000
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw), ms
        except json.JSONDecodeError:
            return exc.code, {"detail": raw}, ms
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000
        return 0, {"detail": str(exc)}, ms


def mf_query(**kwargs: Any) -> tuple[int, dict, float]:
    body = {
        "organizationId": ORG,
        "userId": USER_ID,
        "product": "contact_centre",
        "agent": "cc.reporting",
        **kwargs,
    }
    return _post("/v1/semantic/query", body)


def sql_query(**kwargs: Any) -> tuple[int, dict, float]:
    body = {
        "organizationId": ORG,
        "userId": USER_ID,
        "originProduct": "contact_centre",
        "originAgent": "cc.reporting",
        **kwargs,
    }
    return _post("/v1/sql/query", body)


def _scalar(resp: dict, metric: str) -> Any:
    rows = resp.get("rows") or []
    if not rows:
        return None
    return rows[0].get(metric)


def _pg() -> Any:
    import psycopg2

    return psycopg2.connect(
        host=os.environ["pg_host"],
        port=int(os.environ.get("pg_port", "5432")),
        user=os.environ.get("pg_user", "postgres"),
        password=os.environ.get("pg_pass", ""),
        dbname=os.environ.get("pg_db", "postgres"),
        connect_timeout=15,
    )


def ground_truth_org() -> dict[str, Any]:
    conn = _pg()
    cur = conn.cursor()
    out: dict[str, Any] = {}
    cur.execute(
        f"SELECT COUNT(*) FROM {MARTS}.mart_conversations WHERE organization_id=%s",
        (ORG,),
    )
    out["total_conversations_unscoped"] = cur.fetchone()[0]
    cur.execute(
        f"""
        SELECT COUNT(*) FROM {MARTS}.mart_conversations
        WHERE organization_id=%s AND is_open=true
        """,
        (ORG,),
    )
    out["open_conversations_unscoped"] = cur.fetchone()[0]
    cur.execute(
        f"""
        SELECT COUNT(*) FILTER (WHERE is_ai_only_completed=true)::float
             / NULLIF(COUNT(*),0)
        FROM {MARTS}.mart_conversations WHERE organization_id=%s
        """,
        (ORG,),
    )
    out["ai_containment_rate_unscoped"] = cur.fetchone()[0]
    cur.execute(
        f"""
        SELECT SUM(human_handle_seconds)
             / NULLIF(COUNT(*) FILTER (WHERE is_completed_leg=true),0)
        FROM {MARTS}.mart_conversation_assignments WHERE organization_id=%s
        """,
        (ORG,),
    )
    out["average_handle_time_unscoped"] = cur.fetchone()[0]
    cur.execute(
        f"""
        SELECT SUM(breached_count)::float / NULLIF(SUM(sla_state_count),0)
        FROM {MARTS}.mart_conversation_sla_state WHERE organization_id=%s
        """,
        (ORG,),
    )
    out["sla_breach_rate_unscoped"] = cur.fetchone()[0]
    conn.close()
    return out


def ground_truth_scoped_total() -> int | None:
    from semantic.scope import lookup_user_scope

    scope = lookup_user_scope(ORG, USER_ID, product="contact_centre")
    if not scope.visible_user_ids:
        return None
    conn = _pg()
    cur = conn.cursor()
    ids = tuple(scope.visible_user_ids)
    cur.execute(
        f"""
        SELECT COUNT(*) FROM {MARTS}.mart_conversations
        WHERE organization_id=%s AND assigned_agent_id IN %s
        """,
        (ORG, ids),
    )
    n = cur.fetchone()[0]
    conn.close()
    return int(n)


def ground_truth_time_range(metric: str, start: str, end: str) -> Any:
    conn = _pg()
    cur = conn.cursor()
    if metric == "total_conversations":
        cur.execute(
            f"""
            SELECT COUNT(*) FROM {MARTS}.mart_conversations
            WHERE organization_id=%s
              AND created_at::date >= %s::date
              AND created_at::date <= %s::date
            """,
            (ORG, start, end),
        )
        v = cur.fetchone()[0]
    elif metric == "open_conversations":
        cur.execute(
            f"""
            SELECT COUNT(*) FROM {MARTS}.mart_conversations
            WHERE organization_id=%s AND is_open=true
              AND created_at::date >= %s::date
              AND created_at::date <= %s::date
            """,
            (ORG, start, end),
        )
        v = cur.fetchone()[0]
    else:
        v = None
    conn.close()
    return v


def _close_int(a: Any, b: Any, drift: int = DRIFT) -> bool:
    if a is None or b is None:
        return False
    return abs(int(a) - int(b)) <= drift


def _close_rate(a: Any, b: Any, tol: float = RATE_TOL) -> bool:
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= tol


def run_audit() -> Audit:
    audit = Audit()

    # --- MF no-time scalar ---
    scalar_metrics = [
        "total_conversations",
        "open_conversations",
        "ai_containment_rate",
        "average_handle_time",
        "sla_breach_rate",
    ]
    mf_vals: dict[str, Any] = {}
    for mid in scalar_metrics:
        code, resp, ms = mf_query(metrics=[mid])
        val = _scalar(resp, mid) if code == 200 else None
        mf_vals[mid] = val
        audit.add(
            f"mf_scalar_{mid}",
            "mf",
            "no_time",
            code == 200 and (val is not None or mid == "open_conversations"),
            ms,
            f"HTTP {code} value={val}",
            response=resp if code != 200 else {"value": val},
        )

    # --- MF multi-metric cross-model ---
    code, resp, ms = mf_query(metrics=["open_conversations", "sla_breach_rate"])
    row = (resp.get("rows") or [{}])[0] if code == 200 else {}
    audit.add(
        "mf_bundle_open_sla",
        "mf",
        "no_time",
        code == 200
        and row.get("open_conversations") is not None
        and row.get("sla_breach_rate") is not None,
        ms,
        f"HTTP {code} execution={resp.get('execution')} open={row.get('open_conversations')} sla={row.get('sla_breach_rate')}",
    )

    code, resp, ms = mf_query(
        metrics=["open_conversations", "sla_breach_rate"],
        groupBy=["queue_name"],
    )
    rows = resp.get("rows") or []
    audit.add(
        "mf_bundle_group_by_queue",
        "mf",
        "no_time",
        code == 200 and len(rows) >= 1,
        ms,
        f"HTTP {code} rows={len(rows)} execution={resp.get('execution')}",
    )

    # --- MF with time: custom range ---
    time_window = {"start": "2025-08-18", "end": "2025-09-12"}
    for mid in ["total_conversations", "average_handle_time"]:
        code, resp, ms = mf_query(metrics=[mid], time=time_window)
        val = _scalar(resp, mid) if code == 200 else None
        audit.add(
            f"mf_time_range_{mid}",
            "mf",
            "time_range",
            code == 200 and val is not None,
            ms,
            f"HTTP {code} value={val}",
        )

    # --- MF time grains ---
    for grain in ["day", "week", "month", "quarter", "year"]:
        code, resp, ms = mf_query(
            metrics=["total_conversations"],
            time={**time_window, "grain": grain},
        )
        rows = resp.get("rows") or []
        audit.add(
            f"mf_grain_{grain}",
            "mf",
            "time_grain",
            code == 200 and len(rows) >= 1,
            ms,
            f"HTTP {code} rows={len(rows)}",
        )

    # --- MF relative periods ---
    for period in ["this_quarter", "this_year", "last_30_days"]:
        code, resp, ms = mf_query(
            metrics=["total_conversations"],
            time={"period": period},
        )
        val = _scalar(resp, "total_conversations") if code == 200 else None
        audit.add(
            f"mf_period_{period}",
            "mf",
            "time_period",
            code == 200 and val is not None,
            ms,
            f"HTTP {code} value={val}",
        )

    # --- MF filter + time ---
    code, resp, ms = mf_query(
        metrics=["total_conversations"],
        filters=[{"dimension": "channel", "op": "eq", "values": ["whatsapp"]}],
        time={**time_window, "grain": "day"},
    )
    rows = resp.get("rows") or []
    audit.add(
        "mf_filter_channel_time_day",
        "mf",
        "time_filter",
        code == 200 and len(rows) >= 1,
        ms,
        f"HTTP {code} rows={len(rows)}",
    )

    # --- SQL agent list (no time) ---
    code, resp, ms = sql_query(
        instruction="list open conversations",
        entityHint="wt:Interaction",
        limit=20,
    )
    audit.add(
        "sql_list_open",
        "sql",
        "no_time",
        code == 200 and resp.get("source") == "sql_list" and "rows" in resp,
        ms,
        f"HTTP {code} source={resp.get('source')} rowCount={resp.get('rowCount')}",
    )

    code, resp, ms = sql_query(
        instruction="conversations in queue Support",
        entityHint="wt:Interaction",
        limit=10,
    )
    audit.add(
        "sql_list_queue_filter",
        "sql",
        "no_time",
        code == 200 and resp.get("rowCount", 0) >= 0,
        ms,
        f"HTTP {code} rowCount={resp.get('rowCount')}",
    )

    # --- SQL agent with metricRequest (MF path) ---
    code, resp, ms = sql_query(
        instruction="total conversations metric",
        entityHint="wt:Interaction",
        metricRequest={
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "contact_centre",
            "agent": "cc.reporting",
            "metrics": ["total_conversations"],
        },
    )
    audit.add(
        "sql_metric_mf_path",
        "sql",
        "no_time",
        code == 200 and resp.get("source") == "metricflow",
        ms,
        f"HTTP {code} source={resp.get('source')}",
    )

    # --- SQL metric with time via metricRequest ---
    code, resp, ms = sql_query(
        instruction="total conversations last month by day",
        entityHint="wt:Interaction",
        metricRequest={
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "contact_centre",
            "agent": "cc.reporting",
            "metrics": ["total_conversations"],
            "time": {"start": "2025-08-18", "end": "2025-09-12", "grain": "day"},
        },
    )
    rows = resp.get("rows") or []
    audit.add(
        "sql_metric_time_day",
        "sql",
        "time_grain",
        code == 200 and len(rows) >= 1,
        ms,
        f"HTTP {code} source={resp.get('source')} rows={len(rows)}",
    )

    # --- Ground truth accuracy ---
    try:
        gt = ground_truth_org()
        scoped = ground_truth_scoped_total()
        audit.add(
            "gt_postgres",
            "accuracy",
            "ground_truth",
            True,
            0,
            "postgres connected",
            gt=gt,
            scoped_total=scoped,
        )

        # open/ai/sla org-scoped metrics vs unscoped mart (known assignee gap on total)
        audit.add(
            "accuracy_open_vs_mart",
            "accuracy",
            "no_time",
            _close_int(mf_vals.get("open_conversations"), gt["open_conversations_unscoped"]),
            0,
            f"mf={mf_vals.get('open_conversations')} mart={gt['open_conversations_unscoped']}",
        )
        audit.add(
            "accuracy_ai_vs_mart",
            "accuracy",
            "no_time",
            _close_rate(mf_vals.get("ai_containment_rate"), gt["ai_containment_rate_unscoped"]),
            0,
            f"mf={mf_vals.get('ai_containment_rate')} mart={gt['ai_containment_rate_unscoped']}",
        )
        audit.add(
            "accuracy_sla_vs_mart",
            "accuracy",
            "no_time",
            _close_rate(mf_vals.get("sla_breach_rate"), gt["sla_breach_rate_unscoped"]),
            0,
            f"mf={mf_vals.get('sla_breach_rate')} mart={gt['sla_breach_rate_unscoped']}",
        )
        if scoped is not None:
            audit.add(
                "accuracy_total_scoped",
                "accuracy",
                "no_time",
                _close_int(mf_vals.get("total_conversations"), scoped),
                0,
                f"mf={mf_vals.get('total_conversations')} scoped_sql={scoped}",
            )
        audit.add(
            "accuracy_total_unscoped_mismatch_expected",
            "accuracy",
            "no_time",
            mf_vals.get("total_conversations") != gt["total_conversations_unscoped"],
            0,
            f"mf={mf_vals.get('total_conversations')} unscoped_mart={gt['total_conversations_unscoped']} (assignee scope applied)",
        )

        gt_range = ground_truth_time_range(
            "total_conversations", time_window["start"], time_window["end"]
        )
        code, resp, ms = mf_query(metrics=["total_conversations"], time=time_window)
        mf_range = _scalar(resp, "total_conversations")
        audit.add(
            "accuracy_time_range_total",
            "accuracy",
            "time_range",
            _close_int(mf_range, gt_range),
            0,
            f"mf={mf_range} sql_range={gt_range}",
        )
    except Exception as exc:
        audit.add("gt_postgres", "accuracy", "ground_truth", False, 0, str(exc))

    # --- MF vs SQL fallback parity (direct, not API) ---
    try:
        from semantic.sql.job import ExecutorJob
        from semantic.sql.metric_fallback import execute_metric_fallback
        from semantic.scope import lookup_user_scope

        scope = lookup_user_scope(ORG, USER_ID, product="contact_centre")
        for mid in ["open_conversations", "ai_containment_rate"]:
            fb = execute_metric_fallback(
                ExecutorJob(
                    job_id="audit",
                    mode="metric_fallback",
                    product="ccaas",
                    engine="postgres",
                    organization_id=ORG,
                    user_id=USER_ID,
                    table="mart_conversations",
                    schema=MARTS,
                    select=[],
                    metric_id=mid,
                    scope="org",
                    visible_user_ids=list(scope.visible_user_ids),
                )
            )
            fb_val = (fb.get("rows") or [{}])[0].get(mid)
            mf_val = mf_vals.get(mid)
            if mid.endswith("_rate"):
                ok = _close_rate(mf_val, fb_val)
            else:
                ok = _close_int(mf_val, fb_val)
            audit.add(
                f"parity_mf_fallback_{mid}",
                "parity",
                "no_time",
                ok,
                0,
                f"mf={mf_val} fallback={fb_val}",
            )
    except Exception as exc:
        audit.add("parity_mf_fallback", "parity", "no_time", False, 0, str(exc))

    return audit


def score(audit: Audit) -> dict[str, Any]:
    total = len(audit.cases)
    passed = sum(1 for c in audit.cases if c.ok)
    by_layer: dict[str, list[Case]] = {}
    for c in audit.cases:
        by_layer.setdefault(c.layer, []).append(c)

    latencies = [c.latency_ms for c in audit.cases if c.latency_ms > 0]
    p50 = sorted(latencies)[len(latencies) // 2] if latencies else 0
    p95 = sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0

    layer_scores = {}
    for layer, cases in by_layer.items():
        n = len(cases)
        p = sum(1 for c in cases if c.ok)
        layer_scores[layer] = {
            "passed": p,
            "total": n,
            "pass_rate_pct": round(100 * p / n, 1) if n else 0,
        }

    overall = round(100 * passed / total, 1) if total else 0
    return {
        "org": ORG,
        "user": USER_ID,
        "api": API_BASE,
        "total_cases": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate_pct": overall,
        "latency_ms_p50": round(p50, 1),
        "latency_ms_p95": round(p95, 1),
        "by_layer": layer_scores,
    }


def main() -> int:
    audit = run_audit()
    summary = score(audit)
    out = {
        "summary": summary,
        "cases": [
            {
                "id": c.id,
                "layer": c.layer,
                "category": c.category,
                "ok": c.ok,
                "latency_ms": round(c.latency_ms, 1),
                "detail": c.detail,
            }
            for c in audit.cases
        ],
    }
    report_path = ROOT / "reports" / "industrial_mf_sql_audit.json"
    report_path.parent.mkdir(exist_ok=True)
    report_path.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    print("\n--- FAILURES ---")
    for c in audit.cases:
        if not c.ok:
            print(f"  {c.id}: {c.detail}")
    print(f"\nFull report: {report_path}")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
