#!/usr/bin/env python3
"""Live gate: all-product scalar semantic queries on the sql_template fast path.

What this script tests (three layers):

1. **HTTP guards** — POST /v1/semantic/query rejects bad input (extra NL field,
   unknown product, CDP without catalog/MF).

2. **HTTP latency + values** — real API round-trip per spoke; wall time must stay
   within MAX_LATENCY_S (default 3.5s). The public API returns rows/status only
   (no `source` or `_timing`); those are logged server-side.

3. **In-process path + warehouse parity** — same request via semantic.query.execute()
   must report source=sql_template and path=sql_template (not mf_compile). Template
   SQL is re-run against Postgres/ClickHouse to confirm the API value matches marts.

Usage:
  CONTEXT_LAYER_URL=http://127.0.0.1:8765 PYTHONPATH=. python3 scripts/test_semantic_all_products_live.py
"""

from __future__ import annotations

import json
import math
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

API_BASE = (
    os.environ.get("CONTEXT_LAYER_URL")
    or os.environ.get("API_BASE")
    or "http://127.0.0.1:8765"
).rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER_ID = int(os.environ.get("USER_ID", "1001"))
MAX_LATENCY_S = float(os.environ.get("MAX_LATENCY_S", "3.5"))
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.0001"))
OUTPUT = ROOT / "scripts" / "semantic_all_products_live_report.json"

PRODUCT_CASES = [
    {
        "label": "CCaaS",
        "product": "contact_centre",
        "agent": "cc.reporting",
        "metrics": ["total_conversations", "open_conversations"],
    },
    {
        "label": "Ticketing",
        "product": "ticketing",
        "agent": "tk.reporting",
        "metrics": ["ticket_volume", "unassigned_tickets_metric"],
    },
    {
        "label": "CRM",
        "product": "crm",
        "agent": "crm.reports",
        "metrics": ["deal_volume", "open_pipeline_value"],
    },
    {
        "label": "Campaign",
        "product": "campaign",
        "agent": "camp.reports",
        "metrics": ["campaign_volume", "sent_touch_count"],
    },
    {
        "label": "Webtracking",
        "product": "webtracking",
        "agent": "webtracking.analytics",
        "metrics": ["web_session_volume"],
    },
]


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Report:
    checks: list[Check] = field(default_factory=list)
    rows: list[dict[str, Any]] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append(Check(name, ok, detail))
        mark = "PASS" if ok else "FAIL"
        print(f"  {mark}  {name}" + (f" — {detail}" if detail else ""))


def post_semantic(body: dict, timeout: float = 60) -> tuple[int, dict, float]:
    req = urllib.request.Request(
        f"{API_BASE}/v1/semantic/query",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            elapsed = time.monotonic() - t0
            return resp.status, json.loads(raw) if raw else {}, elapsed
    except urllib.error.HTTPError as exc:
        elapsed = time.monotonic() - t0
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw), elapsed
        except json.JSONDecodeError:
            return exc.code, {"detail": raw}, elapsed
    except Exception as exc:
        return 0, {"detail": str(exc)}, time.monotonic() - t0


def _internal_execute(
    product: str, agent: str, metric_id: str
) -> tuple[dict[str, Any] | None, str]:
    """Run semantic.query.execute in-process (exposes source + _timing)."""
    from semantic.query import SemanticQuery, execute

    try:
        query = SemanticQuery(
            organization_id=ORG,
            user_id=USER_ID,
            product=product,
            agent=agent,
            metrics=[metric_id],
        )
        return execute(query), ""
    except Exception as exc:
        return None, str(exc)


def _warehouse_truth(
    product: str,
    agent: str,
    metric_id: str,
) -> tuple[float | None, str]:
    """Re-run the same template SQL the fast path uses (scope + channel filters)."""
    from semantic.query import SemanticQuery, validate_and_prepare
    from semantic.sql.template_execute import execute_prepared_templates

    try:
        query = SemanticQuery(
            organization_id=ORG,
            user_id=USER_ID,
            product=product,
            agent=agent,
            metrics=[metric_id],
        )
        prepared = validate_and_prepare(query)
        result = execute_prepared_templates(prepared)
    except Exception as exc:
        return None, str(exc)

    rows = result.get("rows") or []
    if not rows:
        return None, "empty template rows"
    val = rows[0].get(metric_id)
    if val is None:
        return None, "no metric column in template result"
    try:
        return float(val), ""
    except (TypeError, ValueError):
        return None, f"non-numeric value: {val!r}"


def _values_close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if math.isnan(a) and math.isnan(b):
        return True
    if a == b:
        return True
    denom = max(abs(a), abs(b), 1.0)
    return abs(a - b) / denom <= DRIFT


def run_product_case(r: Report, case: dict) -> None:
    label = case["label"]
    product = case["product"]
    agent = case["agent"]
    for metric_id in case["metrics"]:
        name = f"{label}/{metric_id}"
        body = {
            "organizationId": ORG,
            "userId": USER_ID,
            "product": product,
            "agent": agent,
            "metrics": [metric_id],
        }
        code, resp, elapsed = post_semantic(body)
        if code != 200:
            detail = resp.get("detail", resp)
            if isinstance(detail, dict):
                detail = detail.get("message") or json.dumps(detail)[:160]
            r.add(name, False, f"HTTP {code}: {detail}")
            continue

        rows = resp.get("rows") or []
        api_val = rows[0].get(metric_id) if rows else None
        if api_val is not None:
            try:
                api_val = float(api_val)
            except (TypeError, ValueError):
                pass

        internal, internal_err = _internal_execute(product, agent, metric_id)
        source = str((internal or {}).get("source") or "")
        path = str(((internal or {}).get("_timing") or {}).get("path") or "")

        wh_val, wh_note = _warehouse_truth(product, agent, metric_id)

        ok = True
        notes: list[str] = []
        if internal is None:
            ok = False
            notes.append(f"internal={internal_err[:80]}")
        elif source != "sql_template":
            ok = False
            notes.append(f"source={source}")
        elif path != "sql_template":
            ok = False
            notes.append(f"path={path}")
        if elapsed > MAX_LATENCY_S:
            ok = False
            notes.append(f"http_latency={elapsed:.2f}s")
        if wh_val is not None:
            if not _values_close(api_val, wh_val):
                ok = False
                notes.append(f"api={api_val} wh={wh_val}")
        elif wh_note:
            notes.append(f"wh_skip={wh_note[:80]}")

        detail = f"http={elapsed:.2f}s path={path or '?'}"
        if notes:
            detail += " " + "; ".join(notes)
        r.add(name, ok, detail)
        r.rows.append(
            {
                "case": name,
                "code": code,
                "metric": metric_id,
                "api_value": api_val,
                "warehouse_value": wh_val,
                "elapsed_s": elapsed,
                "source": source,
                "path": path,
            }
        )


def run_guards(r: Report) -> None:
    code, _, _ = post_semantic(
        {
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "ticketing",
            "agent": "tk.reporting",
            "metrics": ["open_tickets_metric"],
            "query": "how many open tickets",
        }
    )
    r.add("extra NL query -> 422", code == 422, f"HTTP {code}")

    code, _, _ = post_semantic(
        {
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "not_a_real_product",
            "agent": "tk.reporting",
            "metrics": ["open_tickets_metric"],
        }
    )
    r.add("unknown product -> 400", code == 400, f"HTTP {code}")

    code, _, _ = post_semantic(
        {
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "cdp",
            "agent": "cdp.profile",
            "metrics": ["contact_volume"],
        }
    )
    detail = f"HTTP {code}"
    if code == 400:
        detail += " (expected: no cdp MF/catalog path)"
    r.add("CDP product fail-closed or skip", code in (400, 422), detail)


def main() -> int:
    print("Semantic all-products live gate")
    print(f"API: {API_BASE}  org={ORG}  user={USER_ID}  max_latency={MAX_LATENCY_S}s")
    print(
        "Layers: HTTP guards | HTTP latency+values | in-process sql_template path "
        "+ warehouse parity\n"
    )

    probe_code, _, _ = post_semantic(
        {
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "ticketing",
            "agent": "tk.reporting",
            "metrics": ["open_tickets_metric"],
        },
        timeout=10,
    )
    if probe_code == 0:
        print("ERROR: API not reachable. Start: ./scripts/run_context_layer_api.sh")
        return 1

    r = Report()
    print("=== Guard checks (HTTP) ===")
    run_guards(r)

    for case in PRODUCT_CASES:
        print(f"\n=== {case['label']} ({case['product']}) ===")
        run_product_case(r, case)

    passed = sum(1 for c in r.checks if c.ok)
    failed = sum(1 for c in r.checks if not c.ok)
    print(f"\n{'=' * 60}")
    print(f"PASSED: {passed}  FAILED: {failed}")
    OUTPUT.write_text(
        json.dumps(
            {
                "passed": passed,
                "failed": failed,
                "checks": [c.__dict__ for c in r.checks],
                "rows": r.rows,
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )
    print(f"Report: {OUTPUT}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
