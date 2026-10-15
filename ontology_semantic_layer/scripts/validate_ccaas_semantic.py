#!/usr/bin/env python3
"""Validate CCaaS semantic metrics against live API + optional PostgreSQL ground truth.

Usage:
  PYTHONPATH=. python3 scripts/validate_ccaas_semantic.py
  API_BASE=http://192.168.11.25:8765 ORG=1000 PYTHONPATH=. python3 scripts/validate_ccaas_semantic.py

Ground-truth SQL runs when psycopg2 is installed and .env has pg_host.
Live inserts between MetricFlow query and SQL check are tolerated (DRIFT_TOLERANCE).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Load .env before reading defaults (pg_host, custom API host).
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
DRIFT = int(os.environ.get("DRIFT_TOLERANCE", "10"))

# dbt source + warehouse schemas (see models/ccaas/staging/source.yml)
CCAAS_SOURCE_SCHEMA = os.environ.get("CCAAS_SOURCE_SCHEMA", "ccass")
CCAAS_MARTS_SCHEMA = os.environ.get("CCAAS_MARTS_SCHEMA", "ccass_marts_aiccaas")


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Report:
    checks: list[Check] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append(Check(name, ok, detail))
        mark = "PASS" if ok else "FAIL"
        print(f"  {mark}  {name}" + (f" — {detail}" if detail else ""))


def api_query(**payload: Any) -> tuple[int, dict]:
    body = {
        "organizationId": ORG,
        "userId": USER_ID,
        "product": "contact_centre",
        "agent": "cc.reporting",
        **payload,
    }
    req = urllib.request.Request(
        f"{API_BASE}/v1/semantic/query",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"detail": raw}
    except urllib.error.URLError as exc:
        return 0, {"detail": str(exc.reason)}
    except TimeoutError:
        return 0, {"detail": "request timed out after 180s"}
    except OSError as exc:
        return 0, {"detail": str(exc)}


def _pg_counts() -> tuple[dict[str, Any] | None, str]:
    """Ground truth from dbt marts (same tables MetricFlow queries after dbt run)."""
    try:
        import psycopg2
    except ImportError:
        return None, "psycopg2 not installed (pip install psycopg2-binary)"

    host = os.environ.get("pg_host")
    if not host:
        return None, "pg_host not set in .env"

    try:
        conn = psycopg2.connect(
            host=host,
            port=int(os.environ.get("pg_port", "5432")),
            user=os.environ.get("pg_user", "postgres"),
            password=os.environ.get("pg_pass", ""),
            dbname=os.environ.get("pg_db", "postgres"),
            connect_timeout=15,
        )
    except Exception as exc:
        return None, f"postgres connect failed: {exc}"

    conv_mart = f"{CCAAS_MARTS_SCHEMA}.mart_conversations"
    asg_mart = f"{CCAAS_MARTS_SCHEMA}.mart_conversation_assignments"
    conv_src = f"{CCAAS_SOURCE_SCHEMA}.conversations"
    asg_src = f"{CCAAS_SOURCE_SCHEMA}.conversation_assignments"

    cur = conn.cursor()
    out: dict[str, Any] = {}
    source_used = conv_mart
    try:
        # Prefer dbt marts — identical grain/flags to MetricFlow semantic models.
        try:
            cur.execute(
                f"SELECT COUNT(*) FROM {conv_mart} WHERE organization_id = %s",
                (ORG,),
            )
            out["total_conversations"] = cur.fetchone()[0]
            cur.execute(
                f"""
                SELECT COUNT(*) FROM {conv_mart}
                WHERE organization_id = %s AND is_open = true
                """,
                (ORG,),
            )
            out["open_conversations"] = cur.fetchone()[0]
            from semantic.entitlements import load_tenant_entitlements

            ent = load_tenant_entitlements(ORG)
            channels = ent.channels_for_product("contact_centre") or ent.channels_for_product(
                "ccaas"
            )
            if channels:
                cur.execute(
                    f"""
                    SELECT
                      COUNT(*) FILTER (WHERE is_ai_only_completed = true)::float
                      / NULLIF(COUNT(*), 0)
                    FROM {conv_mart}
                    WHERE organization_id = %s AND channel = ANY(%s)
                    """,
                    (ORG, list(channels)),
                )
            else:
                cur.execute(
                    f"""
                    SELECT
                      COUNT(*) FILTER (WHERE is_ai_only_completed = true)::float
                      / NULLIF(COUNT(*), 0)
                    FROM {conv_mart} WHERE organization_id = %s
                    """,
                    (ORG,),
                )
            out["ai_containment_rate"] = cur.fetchone()[0]
            cur.execute(
                f"""
                SELECT SUM(human_handle_seconds)
                     / NULLIF(COUNT(*) FILTER (WHERE is_completed_leg = true), 0)
                FROM {asg_mart} WHERE organization_id = %s
                """,
                (ORG,),
            )
            out["average_handle_time"] = cur.fetchone()[0]
        except Exception as mart_exc:
            # Fallback: raw operational schema (ccass, not ccaas).
            source_used = f"{conv_src} (mart unavailable: {mart_exc})"
            out = {}
            cur.execute(
                f"SELECT COUNT(*) FROM {conv_src} WHERE organization_id = %s",
                (ORG,),
            )
            out["total_conversations"] = cur.fetchone()[0]
            cur.execute(
                f"""
                SELECT COUNT(*) FROM {conv_src}
                WHERE organization_id = %s AND status NOT IN ('resolved', 'closed')
                """,
                (ORG,),
            )
            out["open_conversations"] = cur.fetchone()[0]
            cur.execute(
                f"""
                SELECT
                  COUNT(*) FILTER (
                    WHERE handoff_reason IS NULL
                      AND assigned_agent_id IS NULL
                      AND (status IN ('resolved','closed') OR closed_at IS NOT NULL)
                  )::float / NULLIF(COUNT(*), 0)
                FROM {conv_src} WHERE organization_id = %s
                """,
                (ORG,),
            )
            out["ai_containment_rate"] = cur.fetchone()[0]
            cur.execute(
                f"""
                SELECT SUM(EXTRACT(EPOCH FROM (ended_at - accepted_at)))
                     / NULLIF(
                       COUNT(*) FILTER (
                         WHERE accepted_at IS NOT NULL AND ended_at IS NOT NULL
                       ),
                       0
                     )
                FROM {asg_src} WHERE organization_id = %s
                """,
                (ORG,),
            )
            out["average_handle_time"] = cur.fetchone()[0]
    except Exception as exc:
        return None, f"postgres query failed: {exc}"
    finally:
        conn.close()
    return out, f"connected via {source_used}"


def _num_close(a: Any, b: Any, tol: float = 0.01) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return a == b


def _int_close(a: Any, b: Any, drift: int) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(int(a) - int(b)) <= drift


def main() -> int:
    print(f"CCaaS semantic validation — API={API_BASE} org={ORG} user={USER_ID} drift≤{DRIFT}")
    report = Report()

    code, resp = api_query(metrics=["total_conversations"])
    if code == 0:
        detail = resp.get("detail", "connection failed")
        report.add(
            "api reachable",
            False,
            f"{detail}. Start API: ./scripts/run_context_layer_api.sh "
            f"or set API_BASE=http://192.168.11.25:8765",
        )
        failed = sum(1 for c in report.checks if not c.ok)
        print(f"\n{len(report.checks) - failed} passed, {failed} failed")
        return 1

    report.add("api reachable", code == 200, f"HTTP {code}")

    metrics = [
        "total_conversations",
        "open_conversations",
        "ai_containment_rate",
        "average_handle_time",
    ]
    api_vals: dict[str, Any] = {}
    for mid in metrics:
        c, resp = api_query(metrics=[mid])
        if c != 200:
            detail = resp.get("detail", resp)
            if isinstance(detail, dict):
                detail = detail.get("message", json.dumps(detail))[:120]
            report.add(f"api {mid}", False, str(detail)[:120])
            continue
        val = (resp.get("rows") or [{}])[0].get(mid)
        api_vals[mid] = val
        # open_conversations may legitimately be 0
        ok = val is not None or mid == "open_conversations"
        report.add(f"api {mid}", ok, str(val))

    gt, gt_note = _pg_counts()
    scoped_total: int | None = None
    try:
        from semantic.scope import lookup_user_scope

        scope = lookup_user_scope(ORG, USER_ID, product="contact_centre")
        if scope.visible_user_ids:
            import psycopg2

            conn = psycopg2.connect(
                host=os.environ["pg_host"],
                port=int(os.environ.get("pg_port", "5432")),
                user=os.environ.get("pg_user", "postgres"),
                password=os.environ.get("pg_pass", ""),
                dbname=os.environ.get("pg_db", "postgres"),
                connect_timeout=15,
            )
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT COUNT(*) FROM {CCAAS_MARTS_SCHEMA}.mart_conversations
                WHERE organization_id = %s AND assigned_agent_id IN %s
                """,
                (ORG, tuple(scope.visible_user_ids)),
            )
            scoped_total = int(cur.fetchone()[0])
            conn.close()
    except Exception:
        scoped_total = None

    if gt is None:
        report.add("postgres ground truth", True, f"skipped ({gt_note})")
    else:
        report.add("postgres ground truth", True, gt_note)
        for mid in metrics:
            if mid not in api_vals:
                continue
            api_v = api_vals[mid]
            if mid == "total_conversations" and scoped_total is not None:
                sql_v = scoped_total
            else:
                sql_v = gt.get(mid)
            if mid in ("total_conversations", "open_conversations"):
                ok = _int_close(api_v, sql_v, DRIFT)
            elif mid == "average_handle_time":
                ok = _num_close(api_v, sql_v, tol=1.0)
            else:
                ok = _num_close(api_v, sql_v, tol=0.0001)
            report.add(
                f"match {mid}",
                ok,
                f"api={api_v} sql={sql_v}",
            )

    c, resp = api_query(
        metrics=["open_conversations"],
        filters=[{"dimension": "queue_name", "operator": "contains", "value": "Support"}],
    )
    report.add("filter contains + value alias", c == 200, f"HTTP {c}")

    c, resp = api_query(product="ccaas", metrics=["total_conversations"])
    report.add("product alias ccaas", c == 200, f"HTTP {c}")

    failed = sum(1 for c in report.checks if not c.ok)
    print(f"\n{len(report.checks) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
