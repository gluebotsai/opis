#!/usr/bin/env python3
"""Production readiness gate — run all CI checks for ccaas + ticketing."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

GATES = [
    ("metric ownership", ["scripts/test_metric_ownership.py"]),
    ("slice sync", ["scripts/test_slice_metric_sync.py"]),
    ("sql filters", ["scripts/test_sql_filter_params.py"]),
    ("sql agent ccaas", ["scripts/test_sql_agent_ccaas.py"]),
    ("sql products", ["scripts/test_sql_agent_products.py"]),
    ("mf merge", ["scripts/test_execute_multi_merge.py"]),
    ("dim resolve", ["scripts/test_semantic_dim_resolve.py"]),
    ("validate ccaas", ["scripts/validate_ccaas_semantic.py"]),
    ("ccaas parity", ["scripts/test_mf_sql_parity.py"]),
    ("ticketing parity", ["scripts/test_ticketing_mf_parity.py"]),
    ("sql templates", ["scripts/test_prompt_metric_sql_templates.py"]),
    ("mf manifest isolation", ["scripts/test_mf_manifest_isolation.py"]),
]


def main() -> int:
    env = {**dict(__import__("os").environ), "PYTHONPATH": str(ROOT)}
    failed: list[str] = []
    print("=== Production gate ===\n")
    for name, script in GATES:
        path = ROOT / script[0]
        if not path.is_file():
            print(f"  SKIP  {name} (missing {script[0]})")
            continue
        r = subprocess.run(
            [sys.executable, str(path)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if r.returncode == 0:
            print(f"  PASS  {name}")
        else:
            print(f"  FAIL  {name}")
            tail = (r.stdout + r.stderr).strip().splitlines()[-5:]
            for line in tail:
                print(f"        {line}")
            failed.append(name)
    api_gates = [
        ("ccaas agent matrix", ["scripts/test_ccaas_agent_matrix.py"]),
        ("ticketing agent matrix", ["scripts/test_ticketing_agent_matrix.py"]),
    ]
    import urllib.request

    try:
        urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=3)
        for name, script in api_gates:
            r = subprocess.run(
                [sys.executable, str(ROOT / script[0])],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=600,
            )
            if r.returncode == 0:
                print(f"  PASS  {name}")
            else:
                print(f"  FAIL  {name}")
                failed.append(name)
    except Exception:
        print("  SKIP  API matrix tests (API not running on :8765)")

    print(f"\n=== {len(GATES) + len(api_gates) - len(failed)} passed, {len(failed)} failed ===")
    if failed:
        print("Failed:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
