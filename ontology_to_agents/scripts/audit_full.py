#!/usr/bin/env python3
"""Full audit: ontology duplicates, metric alignment, scenario queries, DB spot-checks."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import yaml

from ontology.slice import fetch_ontology_slice, list_agents, list_presets
from semantic.lookup import get_metric_schema, is_certified, list_certified

BASE = os.environ.get("CONTEXT_API", "http://127.0.0.1:8765")


def http(method: str, path: str, body: dict | None = None) -> tuple[int, any]:
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def load_registry() -> dict:
    with (ROOT / "semantic/metric_registry.yml").open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def collect_ontology_metric_ids() -> set[str]:
    ids: set[str] = set()
    modules = ROOT / "ontology/modules"
    for path in modules.glob("*.yml"):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for m in data.get("metric_ids") or data.get("metrics") or []:
            if isinstance(m, str):
                ids.add(m)
            elif isinstance(m, dict) and m.get("id"):
                ids.add(str(m["id"]))
    with (ROOT / "ontology/catalog.yml").open(encoding="utf-8") as fh:
        cat = yaml.safe_load(fh) or {}
    for preset in (cat.get("presets") or {}).values():
        for m in (preset.get("prompt") or {}).get("metrics") or []:
            ids.add(str(m))
    hub = cat.get("hub_entitlements") or {}
    for m in (hub.get("base_prompt") or {}).get("metrics") or []:
        ids.add(str(m))
    for prod in (hub.get("products") or {}).values():
        for m in (prod.get("prompt") or {}).get("metrics") or []:
            ids.add(str(m))
    return ids


def audit_duplicates() -> dict:
    agents = [
        ("crm.deals", {"product": "crm"}),
        ("cc.ai_support", {"product": "ccaas"}),
        ("cc.reporting", {"product": "ccaas"}),
        ("preset:cc.wfm", {"preset": "cc.wfm", "product": "ccaas"}),
        ("tk.tickets", {"product": "ticketing"}),
        ("camp.reports", {"product": "campaign"}),
    ]
    hub = ("hub.orchestrator", {"products": ["contact_centre", "crm", "ticketing"]})
    results = {}
    for agent, extra in agents + [hub]:
        kwargs = {"tenant": "org1000", **extra}
        if extra.get("preset"):
            kwargs["preset"] = extra.pop("preset")
        else:
            kwargs["agent"] = agent
        pack = fetch_ontology_slice(**kwargs)
        cids = pack.class_ids()
        mids = pack.metric_ids
        aids = pack.action_ids()
        _, _, _, prompt_metrics, _, _ = pack._view("compact")
        results[agent] = {
            "class_dupes": len(cids) - len(set(cids)),
            "metric_dupes": len(mids) - len(set(mids)),
            "action_dupes": len(aids) - len(set(aids)),
            "prompt_metrics": prompt_metrics,
            "uncertified_in_prompt": [m for m in prompt_metrics if not is_certified(m)],
        }
    return results


def scenario_queries() -> list[dict]:
    scenarios = [
        {
            "name": "CRM win rate by stage",
            "body": {
                "organizationId": 1000,
                "userId": 1,
                "product": "crm",
                "agent": "crm.deals",
                "metrics": ["won_deal_rate"],
                "group_by": ["stage"],
            },
            "expect": (200, 503),
        },
        {
            "name": "CRM fake metric",
            "body": {
                "organizationId": 1000,
                "userId": 1,
                "product": "crm",
                "agent": "crm.deals",
                "metrics": ["totally_fake"],
            },
            "expect": (400,),
        },
        {
            "name": "CRM metric wrong agent",
            "body": {
                "organizationId": 1000,
                "userId": 1,
                "product": "crm",
                "agent": "crm.deals",
                "metrics": ["open_tickets_metric"],
            },
            "expect": (400,),
        },
        {
            "name": "TK SLA breach org grain",
            "body": {
                "organizationId": 1000,
                "userId": 1,
                "product": "ticketing",
                "agent": "tk.tickets",
                "metrics": ["sla_breach_rate"],
            },
            "expect": (200, 503),
        },
        {
            "name": "Bad group_by dim",
            "body": {
                "organizationId": 1000,
                "userId": 1,
                "product": "crm",
                "agent": "crm.deals",
                "metrics": ["won_deal_rate"],
                "group_by": ["not_a_dimension"],
            },
            "expect": (400,),
        },
        {
            "name": "Hub on slice rejected",
            "body": {
                "organizationId": 1000,
                "agent": "hub.orchestrator",
                "product": "crm",
            },
            "expect": (400, 422),
        },
    ]
    out = []
    for sc in scenarios:
        path = (
            "/v1/semantic/query"
            if "metrics" in sc["body"]
            else "/v1/ontology/slice"
        )
        code, body = http("POST", path, sc["body"])
        ok = code in sc["expect"]
        out.append({"scenario": sc["name"], "code": code, "ok": ok, "detail": body})
    return out


def db_spot_checks() -> dict:
    try:
        import psycopg2
    except ImportError:
        return {"status": "skip", "reason": "psycopg2 not installed"}

    host = os.environ.get("pg_host")
    if not host and (ROOT / ".env").exists():
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("pg_host="):
                host = line.split("=", 1)[1].strip()
    if not host:
        return {"status": "skip", "reason": "no pg_host in env"}

    conn = psycopg2.connect(
        host=host,
        port=int(os.environ.get("pg_port", 5432)),
        dbname=os.environ.get("pg_db", "postgres"),
        user=os.environ.get("pg_user", "postgres"),
        password=os.environ.get("pg_pass", os.environ.get("pg_password", "")),
    )
    checks = {}
    with conn.cursor() as cur:
        # org 1000 deal counts for won_deal_rate sanity
        cur.execute(
            """
            SELECT count(*) FILTER (WHERE lower(stage) = 'won') AS won,
                   count(*) FILTER (WHERE lower(stage) IN ('won','lost')) AS closed
            FROM crm.deals WHERE organization_id = 1000
            """
        )
        won, closed = cur.fetchone()
        checks["crm_deals_org1000"] = {
            "won": won,
            "closed": closed,
            "won_rate_manual": round(won / closed, 4) if closed else None,
        }

        cur.execute(
            """
            SELECT count(*) FILTER (WHERE status NOT IN ('Resolved','Closed')) AS open_cnt,
                   count(*) AS total
            FROM ticketing.tickets WHERE organization_id = 1000
            """
        )
        open_cnt, total = cur.fetchone()
        checks["ticketing_org1000"] = {"open_tickets": open_cnt, "total": total}

        cur.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='accounts' AND table_name='setup_users'
            ORDER BY ordinal_position
            """
        )
        checks["setup_users_columns"] = [r[0] for r in cur.fetchall()]
    conn.close()
    checks["status"] = "ok"
    return checks


def main() -> int:
    print("=" * 70)
    print("FULL AUDIT REPORT")
    print("=" * 70)

    reg = load_registry()
    certified = set(list_certified())
    ontology_ids = collect_ontology_metric_ids()
    in_ont_not_reg = sorted(ontology_ids - certified)
    print(f"\nRegistry certified: {len(certified)}")
    print(f"Ontology metric ids (modules+catalog): {len(ontology_ids)}")
    print(f"In ontology NOT certified: {len(in_ont_not_reg)}")
    if in_ont_not_reg:
        print(" ", ", ".join(in_ont_not_reg))

    print("\n--- Duplicate check (post-fetch) ---")
    dupes = audit_duplicates()
    for agent, d in dupes.items():
        flag = "OK" if all(d[k] == 0 for k in ("class_dupes", "metric_dupes", "action_dupes")) else "DUP"
        unc = d["uncertified_in_prompt"]
        print(
            f"  [{flag}] {agent}: class_dup={d['class_dupes']} "
            f"metric_dup={d['metric_dupes']} action_dup={d['action_dupes']} "
            f"prompt_metrics={len(d['prompt_metrics'])} "
            f"uncertified={unc or '-'}"
        )

    print("\n--- API health ---")
    code, health = http("GET", "/health")
    print(f"  /health -> {code} {health}")

    print("\n--- Scenario queries ---")
    for row in scenario_queries():
        mark = "PASS" if row["ok"] else "FAIL"
        print(f"  [{mark}] {row['scenario']} -> HTTP {row['code']}")

    print("\n--- DB spot checks ---")
    db = db_spot_checks()
    print(f"  {json.dumps(db, indent=2, default=str)}")

    fails = sum(1 for r in scenario_queries() if not r["ok"])
    fails += sum(
        1
        for d in dupes.values()
        if d["class_dupes"] or d["metric_dupes"] or d["action_dupes"] or d["uncertified_in_prompt"]
    )
    print(f"\nAudit issues flagged: {fails + len(in_ont_not_reg)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
