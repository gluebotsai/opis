#!/usr/bin/env python3
"""Two semantic queries per product: normal + time-grain (average/period metric)."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

BASE = "http://127.0.0.1:8765"
ORG = 1000
USER = 1000
TIME = {"start": "2026-01-01", "end": "2026-09-09", "grain": "day"}

CASES = [
    {
        "product": "crm",
        "label": "CRM",
        "agent": "crm.deals",
        "normal": {"metrics": ["won_deal_rate"], "group_by": ["stage"]},
        "timed": {
            "metrics": ["won_deal_rate"],
            "time": TIME,
        },
    },
    {
        "product": "ccaas",
        "label": "CCaaS",
        "agent": "cc.reporting",
        "normal": {"metrics": ["sla_breach_rate"], "group_by": ["channel"]},
        "timed": {
            "metrics": ["total_conversations"],
            "filters": [{"dimension": "channel", "op": "eq", "values": ["whatsapp"]}],
            "time": {"start": "2026-09-07", "end": "2026-09-13", "grain": "day"},
        },
    },
    {
        "product": "ticketing",
        "label": "Ticketing",
        "agent": "tk.reporting",
        "normal": {"metrics": ["open_tickets_metric"], "group_by": ["priority"]},
        "timed": {
            "metrics": ["average_resolution_time_hours"],
            "group_by": ["queue_name"],
            "time": TIME,
        },
    },
    {
        "product": "campaign",
        "label": "Campaign",
        "agent": "camp.reports",
        "normal": {"metrics": ["delivery_rate"], "group_by": ["channel"]},
        "timed": {
            "metrics": ["open_rate"],
            "group_by": ["channel"],
            "time": TIME,
        },
    },
]


@dataclass
class Results:
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    rows: list[dict] = field(default_factory=list)


def post(body: dict) -> tuple[int, dict]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + "/v1/semantic/query",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"detail": raw}


def run_case(
    r: Results,
    product: str,
    label: str,
    agent: str,
    kind: str,
    payload: dict,
) -> None:
    body = {
        "organizationId": ORG,
        "userId": USER,
        "product": product,
        "agent": agent,
        "limit": 20,
        **payload,
    }
    code, resp = post(body)
    name = f"{label} {kind}"
    if code == 200:
        rows = resp.get("rows") or []
        r.passed += 1
        preview = rows[:2] if rows else "(empty rows)"
        print(f"  PASS  {name} — {len(rows)} row(s)  sample={preview}")
        r.rows.append({"case": name, "code": code, "row_count": len(rows), "rows": rows[:3]})
    elif code in (400, 502, 503) and isinstance(resp.get("detail"), dict):
        r.failed += 1
        msg = resp["detail"].get("message", json.dumps(resp["detail"]))[:160]
        print(f"  FAIL  {name} — HTTP {code}: {msg}")
    else:
        r.failed += 1
        detail = resp.get("detail", resp)
        if isinstance(detail, dict):
            detail = json.dumps(detail)[:200]
        print(f"  FAIL  {name} — HTTP {code}: {detail}")


def main() -> int:
    print("Semantic layer — 2 queries per product")
    print(f"API: {BASE}  org={ORG}  user={USER}\n")

    code, _ = post({"organizationId": ORG, "userId": USER, "product": "crm", "agent": "crm.deals", "metrics": ["won_deal_rate"]})
    if code == 0:
        print("ERROR: API not reachable. Start: ./scripts/run_context_layer_api.sh")
        return 1

    r = Results()
    for case in CASES:
        print(f"=== {case['label']} ({case['product']}) ===")
        run_case(r, case["product"], case["label"], case["agent"], "normal", case["normal"])
        run_case(r, case["product"], case["label"], case["agent"], "time+avg", case["timed"])

    print(f"\n{'='*60}")
    print(f"PASSED: {r.passed}  FAILED: {r.failed}")
    out = ROOT / "scripts" / "semantic_product_test_results.json"
    out.write_text(json.dumps(r.rows, indent=2, default=str), encoding="utf-8")
    print(f"Results saved: {out}")
    return 1 if r.failed else 0


if __name__ == "__main__":
    sys.exit(main())
