#!/usr/bin/env python3
"""Production-readiness gate: structural contracts + unit suites + optional live API/dbt.

Run from repo root:
    PYTHONPATH=. python3 scripts/test_production_readiness.py

Optional (live integration — API must be on :8765):
    CONTEXT_API=http://127.0.0.1:8765 PYTHONPATH=. python3 scripts/test_production_readiness.py --live

Optional (dbt parse — requires dbt-postgres + pg_host in .env):
    PYTHONPATH=. python3 scripts/test_production_readiness.py --dbt
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ontology.slice import fetch_ontology_slice
from semantic.lookup import is_certified, list_certified
from semantic.thresholds import build_interpretation, list_missing_platform_rows, merge_threshold

PASS = 0
FAIL = 0
SKIP = 0
GAPS: list[str] = []


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"PASS  {name}")


def fail(name: str, detail: str) -> None:
    global FAIL
    FAIL += 1
    print(f"FAIL  {name} — {detail}")


def skip(name: str, reason: str) -> None:
    global SKIP
    SKIP += 1
    print(f"SKIP  {name} ({reason})")


def gap(msg: str) -> None:
    GAPS.append(msg)


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


# --- Structural contracts (CI, no warehouse) ---


def test_registry_threshold_parity() -> None:
    reg = load_yaml(ROOT / "semantic/metric_registry.yml")["metrics"]
    missing = list_missing_platform_rows(sorted(reg.keys()))
    if missing:
        fail("registry_threshold_parity", f"{len(missing)} missing: {missing[:5]}")
    else:
        ok("registry_threshold_parity (353/353)")


def test_prompt_excludes_thresholds() -> None:
    for agent, product in [
        ("tk.reporting", "ticketing"),
        ("crm.deals", "crm"),
        ("cc.reporting", "ccaas"),
        ("camp.reports", "campaign"),
    ]:
        prompt = fetch_ontology_slice(agent=agent, tenant="org1000", product=product).as_prompt()
        if "threshold:" in prompt or "warn " in prompt.lower() and "critical" in prompt.lower():
            fail(f"prompt_no_thresholds_{agent}", "threshold text in ontology prompt")
            return
    ok("prompt_excludes_thresholds (4 agents)")


def test_interpretation_on_query_shape() -> None:
    interp = build_interpretation(["open_tickets_metric"], [{"open_tickets_metric": 42}], 1000)
    row = interp["open_tickets_metric"]
    for key in ("value", "status", "threshold", "kind", "source"):
        if key not in row:
            fail("interpretation_shape", f"missing key {key}")
            return
    if row["status"] != "warn":
        fail("interpretation_shape", f"expected warn, got {row['status']}")
        return
    ok("interpretation_shape (value + status + threshold)")


def test_org_overlay_precedence() -> None:
    merged = merge_threshold("open_tickets_metric", 1000)
    if merged.get("threshold") != {"warn": 25, "critical": 60}:
        fail("org_overlay_precedence", str(merged.get("threshold")))
    else:
        ok("org_overlay_precedence (org1000 open_tickets)")


def test_ccaas_semantic_uses_marts_only() -> None:
    sem_path = ROOT / "semantic/dbt/ccaas/default/dbt/models/semantic_layer/semantic_layer.yml"
    text = sem_path.read_text(encoding="utf-8")
    stg = re.findall(r"ref\('stg_[^']+'\)", text)
    if stg:
        fail("ccaas_semantic_marts_only", f"still references staging: {stg[:3]}")
    else:
        ok("ccaas_semantic_marts_only (no stg_* refs)")


def test_ccaas_mart_inventory() -> None:
    marts_dir = ROOT / "semantic/dbt/ccaas/default/dbt/models/marts"
    sql_count = len(list(marts_dir.glob("mart_*.sql")))
    schema = load_yaml(marts_dir / "schema.yml")
    schema_count = len(schema.get("models") or [])
    if sql_count != 16:
        fail("ccaas_mart_count", f"expected 16 SQL marts, got {sql_count}")
    elif schema_count < sql_count:
        fail("ccaas_mart_schema", f"schema.yml covers {schema_count}/{sql_count} marts")
    else:
        ok(f"ccaas_mart_inventory ({sql_count} marts + schema.yml)")


def test_catalog_products() -> None:
    expected = {"ticketing", "crm", "ccaas", "campaign", "webtracking"}
    found = {p.stem for p in (ROOT / "semantic/catalog").glob("*.yaml")}
    missing = expected - found
    if missing:
        fail("catalog_products", f"missing {missing}")
    else:
        ok("catalog_products (5 YAML files)")


def test_catalog_metric_counts() -> None:
    reg = load_yaml(ROOT / "semantic/metric_registry.yml")["metrics"]
    source_counts: dict[str, int] = {}
    for _mid, row in reg.items():
        if isinstance(row, dict):
            src = row.get("source")
            if src:
                source_counts[src] = source_counts.get(src, 0) + 1

    mapping = {
        "ticketing": "ticketing",
        "crm": "crm",
        "ccaas": "aiccaas",
        "campaign": "campaign",
        "webtracking": "webtracking",
    }
    for product, src in mapping.items():
        cat = load_yaml(ROOT / f"semantic/catalog/{product}.yaml")
        n_cat = len(cat.get("certified_metrics") or [])
        n_reg = source_counts.get(src, 0)
        if n_cat != n_reg:
            fail(f"catalog_metrics_{product}", f"catalog={n_cat} registry={n_reg}")
            return
    ok("catalog_metric_counts (match registry per product)")


def test_catalog_tables_have_tenant_column() -> None:
    for path in (ROOT / "semantic/catalog").glob("*.yaml"):
        if path.name == "joins.yml":
            continue
        cat = load_yaml(path)
        bad = [
            t["name"]
            for t in (cat.get("tables") or [])
            if t.get("tenant_column", "organization_id") != "organization_id"
        ]
        if bad:
            fail(f"catalog_tenant_{path.stem}", str(bad[:3]))
            return
    ok("catalog_tables_tenant_column (organization_id)")


def test_joins_reference_catalog_marts() -> None:
    joins = load_yaml(ROOT / "semantic/catalog/joins.yml")
    for product, edges in (joins.get("joins") or {}).items():
        cat_path = ROOT / f"semantic/catalog/{product}.yaml"
        if not cat_path.is_file():
            fail("joins_catalog_refs", f"no catalog for {product}")
            return
        tables = {t["name"] for t in load_yaml(cat_path).get("tables") or []}
        for edge in edges or []:
            for side in ("from", "to"):
                mart = edge.get(side)
                if mart and mart not in tables:
                    fail("joins_catalog_refs", f"{product} {side}={mart} not in catalog")
                    return
    ok("joins_reference_catalog_marts")


def test_ontology_metrics_certified() -> None:
    uncert: list[str] = []
    modules = ROOT / "ontology/modules"
    ids: set[str] = set()
    for path in modules.glob("*.yml"):
        data = load_yaml(path)
        for m in data.get("metric_ids") or data.get("metrics") or []:
            if isinstance(m, str):
                ids.add(m)
            elif isinstance(m, dict) and m.get("id"):
                ids.add(str(m["id"]))
    cat = load_yaml(ROOT / "ontology/catalog.yml")
    for preset in (cat.get("presets") or {}).values():
        for m in (preset.get("prompt") or {}).get("metrics") or []:
            ids.add(str(m))
    for mid in ids:
        if not is_certified(mid):
            uncert.append(mid)
    if uncert:
        fail("ontology_metrics_certified", f"{len(uncert)} uncertified: {uncert[:5]}")
    else:
        ok(f"ontology_metrics_certified ({len(ids)} ids in modules+catalog)")


def test_certified_count() -> None:
    n = len(list_certified())
    if n != 353:
        fail("certified_count", f"expected 353, got {n}")
    else:
        ok("certified_count (353)")


# --- Subprocess: existing unit suites ---


def run_script(rel: str) -> bool:
    path = ROOT / rel
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    proc = subprocess.run(
        [sys.executable, str(path)],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        ok(f"subprocess {path.name}")
        return True
    fail(f"subprocess {path.name}", proc.stderr.strip() or proc.stdout.strip()[-400:])
    return False


# --- Optional live API ---


def http(method: str, path: str, body: dict | None = None) -> tuple[int, Any]:
    base = os.environ.get("CONTEXT_API", "http://127.0.0.1:8765")
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw
    except urllib.error.URLError as e:
        return 0, str(e.reason)


def test_live_api_health() -> None:
    code, body = http("GET", "/health")
    if code == 200:
        ok("live_api_health")
    else:
        fail("live_api_health", f"{code} {body}")


def test_live_interpretation_on_query() -> None:
    body = {
        "organizationId": 1000,
        "userId": 1000,
        "product": "ticketing",
        "agent": "tk.reporting",
        "metrics": ["open_tickets_metric"],
    }
    code, resp = http("POST", "/v1/semantic/query", body)
    if code not in (200, 503):
        fail("live_interpretation_query", f"HTTP {code} {resp}")
        return
    if code == 503:
        skip("live_interpretation_query", "MetricFlow/warehouse unavailable (503)")
        return
    if "status" not in (resp or {}):
        fail("live_interpretation_query", "missing status in response")
    elif "threshold" not in (resp or {}):
        fail("live_interpretation_query", "missing threshold in response")
    elif "rows" not in (resp or {}):
        fail("live_interpretation_query", "missing rows in response")
    else:
        ok("live_interpretation_query (rows + status + threshold)")


def test_live_get_metric_threshold() -> None:
    code, resp = http("GET", "/v1/metrics/open_tickets_metric?organizationId=1000")
    if code != 200:
        fail("live_get_metric_threshold", f"HTTP {code} {resp}")
        return
    if resp.get("threshold") != {"warn": 25, "critical": 60}:
        fail("live_get_metric_threshold", str(resp.get("threshold")))
    else:
        ok("live_get_metric_threshold (org overlay on GET /v1/metrics)")


def test_live_slice_no_thresholds() -> None:
    code, resp = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "tk.reporting", "product": "ticketing"},
    )
    if code != 200:
        fail("live_slice_no_thresholds", f"HTTP {code}")
        return
    prompt = (resp or {}).get("prompt") or ""
    if "threshold:" in prompt:
        fail("live_slice_no_thresholds", "threshold in API prompt")
    else:
        ok("live_slice_no_thresholds")


# --- Optional dbt parse ---


def test_dbt_parse_all() -> None:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts/dbt_parse_all.py")],
        cwd=str(ROOT),
        env={**os.environ, "PYTHONPATH": str(ROOT)},
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    if "dbt not found" in out:
        skip("dbt_parse_all", "dbt-postgres not installed")
        gap("Install dbt-postgres and run scripts/dbt_parse_all.py before deploy")
        return
    if proc.returncode != 0 or "failed" in out.lower() and "0 parsed" not in out:
        fail("dbt_parse_all", out.strip()[-500:])
    elif "0 parsed" in out and "failed" in out:
        fail("dbt_parse_all", "no projects parsed")
    else:
        ok("dbt_parse_all")


def record_industry_gaps() -> None:
    """Document known gaps vs production hardening (not test failures)."""
    gap("Auth: organizationId in request body is honor-system — add gateway/JWT before external exposure")
    gap("dbt CI: run dbt test + parse in pipeline; this environment lacks dbt-postgres")
    gap("Platform thresholds: ~220 metrics use heuristic bands (source says 'review per metric')")
    gap("SQL agent service: catalog + joins exist; executor not built in this repo")
    gap("CCaaS marts: mostly passthrough except mart_conversations denormalization — run dbt run on warehouse")
    gap("Campaign sem_campaign_touch_performance: bare organization_id dim omitted (MF uniqueness) — document in spoke prompts")


def main() -> int:
    parser = argparse.ArgumentParser(description="Production readiness gate")
    parser.add_argument("--live", action="store_true", help="Hit Context Layer API (must be running)")
    parser.add_argument("--dbt", action="store_true", help="Run dbt parse all (needs dbt-postgres)")
    args = parser.parse_args()

    print("=" * 70)
    print("PRODUCTION READINESS — structural + unit suites")
    print("=" * 70)

    structural: list[Callable[[], None]] = [
        test_registry_threshold_parity,
        test_certified_count,
        test_prompt_excludes_thresholds,
        test_interpretation_on_query_shape,
        test_org_overlay_precedence,
        test_ccaas_semantic_uses_marts_only,
        test_ccaas_mart_inventory,
        test_catalog_products,
        test_catalog_metric_counts,
        test_catalog_tables_have_tenant_column,
        test_joins_reference_catalog_marts,
        test_ontology_metrics_certified,
    ]
    for fn in structural:
        fn()

    print("\n--- Existing unit scripts ---")
    for script in [
        "scripts/test_metric_thresholds.py",
        "scripts/test_metric_policies_yaml.py",
        "scripts/test_runtime_reload.py",
        "scripts/test_industry_org_metrics.py",
        "scripts/test_semantic_dim_resolve.py",
        "scripts/test_scope_and_metrics.py",
        "scripts/test_context_resolver.py",
        "scripts/test_query_engine_routing.py",
    ]:
        run_script(script)

    if args.live:
        print("\n--- Live API (integration) ---")
        code, _ = http("GET", "/health")
        if code == 0:
            skip("live_api", "API not reachable — start ./scripts/run_context_layer_api.sh")
        else:
            test_live_api_health()
            test_live_slice_no_thresholds()
            test_live_get_metric_threshold()
            test_live_interpretation_on_query()
            run_script("scripts/test_spoke_context_layer.py")
            run_script("scripts/test_semantic_products.py")

    if args.dbt:
        print("\n--- dbt parse ---")
        test_dbt_parse_all()

    record_industry_gaps()

    print("\n" + "=" * 70)
    print(f"RESULT: {PASS} passed, {FAIL} failed, {SKIP} skipped")
    if GAPS:
        print("\nIndustry-standard gaps (track separately):")
        for g in GAPS:
            print(f"  • {g}")
    print("=" * 70)

    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
