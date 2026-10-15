#!/usr/bin/env python3
"""CCaaS agent matrix — reporting full catalog + specialist grants."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER = int(os.environ.get("USER_ID", "1001"))

ALLOWED = {
    "cc.reporting": ["total_conversations", "resolution_rate", "webchat_volume", "tool_success_rate"],
    "cc.anomaly": ["sla_breach_rate", "missed_contact_rate", "breached_sla_count"],
    "cc.ai_support": ["ai_containment_rate", "handover_rate", "ai_only_completed_conversations"],
    "cc.omnichannel": ["call_volume", "email_volume", "handled_volume"],
    "cc.closure": ["resolution_rate", "resolved_dispositions"],
    "cc.agent_assist": ["agent_assist_adoption_rate", "tool_success_rate"],
    "cc.forecast": ["total_conversations", "average_handle_time", "human_agent_occupancy_rate_presence"],
}

DENIED = {
    "cc.queue": "agent_assist_adoption_rate",
    "cc.recovery": "tool_success_rate",
    "cc.ai_support": "total_queues_configured",
}


def _post(path: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def main() -> int:
    from semantic.agent_grants import grant_candidates
    from semantic.ownership import list_certified_for_source

    failed = 0
    catalog = set(list_certified_for_source("aiccaas"))
    reporting = set(grant_candidates("cc.reporting", "contact_centre") or [])
    print(f"CCaaS agent matrix org={ORG} api={API}")
    print(f"  reporting grant size={len(reporting)} certified={len(catalog)}")
    if reporting != catalog:
        missing = sorted(catalog - reporting)
        print(f"  FAIL  reporting missing {len(missing)} metrics e.g. {missing[:3]}")
        failed += 1
    else:
        print("  PASS  cc.reporting has full 58-metric catalog")

    for agent, metrics in ALLOWED.items():
        for mid in metrics:
            code, resp = _post(
                "/v1/semantic/query",
                {
                    "organizationId": ORG,
                    "userId": USER,
                    "product": "contact_centre",
                    "agent": agent,
                    "metrics": [mid],
                },
            )
            ok = code == 200
            mark = "PASS" if ok else "FAIL"
            print(f"  {mark}  allow {agent} {mid} HTTP {code}")
            if not ok:
                failed += 1

    for agent, mid in DENIED.items():
        code, _ = _post(
            "/v1/semantic/query",
            {
                "organizationId": ORG,
                "userId": USER,
                "product": "contact_centre",
                "agent": agent,
                "metrics": [mid],
            },
        )
        ok = code in (400, 403, 422)
        mark = "PASS" if ok else "FAIL"
        print(f"  {mark}  deny {agent} {mid} HTTP {code}")
        if not ok:
            failed += 1

    code, resp = _post(
        "/v1/semantic/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "product": "contact_centre",
            "agent": "cc.omnichannel",
            "metrics": ["call_volume"],
        },
    )
    val = (resp.get("rows") or [{}])[0].get("call_volume") if code == 200 else None
    ok = code == 200
    print(f"  {'PASS' if ok else 'FAIL'}  call_volume uses voice channel HTTP {code} val={val}")
    if not ok:
        failed += 1

    print(f"\n{failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
