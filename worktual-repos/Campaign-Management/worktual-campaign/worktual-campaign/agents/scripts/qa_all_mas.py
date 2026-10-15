#!/usr/bin/env python3
"""
WP5 final gate — run all MAS pytest + offline QA scripts.

Usage:
  cd agents && PYTHONPATH=. python scripts/qa_all_mas.py
  cd agents && PYTHONPATH=. python scripts/qa_all_mas.py --no-pytest
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_PYTHON = sys.executable


def _run(label: str, cmd: list[str]) -> bool:
    print(f"\n=== {label} ===\n")
    proc = subprocess.run(cmd, cwd=_ROOT, check=False)
    ok = proc.returncode == 0
    print(f"\n[{('PASS' if ok else 'FAIL')}] {label} (exit {proc.returncode})\n")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Run full MAS QA gate")
    parser.add_argument(
        "--no-pytest",
        action="store_true",
        help="Skip pytest (QA scripts only)",
    )
    args = parser.parse_args()

    env = {"PYTHONPATH": "."}
    steps: list[tuple[str, list[str]]] = []

    if not args.no_pytest:
        mas_tests = sorted(_ROOT.glob("tests/test_mas_*.py"))
        mas_tests.append(_ROOT / "tests/test_hub_super_agent.py")
        steps.append(
            (
                "pytest MAS suite",
                [_PYTHON, "-m", "pytest", *[str(p) for p in mas_tests], "-q"],
            )
        )

    qa_scripts = [
        "scripts/qa_audience_mas.py",
        "scripts/qa_create_campaign_mas.py",
        "scripts/qa_optimization_mas.py",
        "scripts/qa_content_mas.py",
        "scripts/qa_forms_mas.py",
        "scripts/qa_image_mas.py",
    ]
    for script in qa_scripts:
        cmd = [_PYTHON, script]
        if script.endswith("qa_audience_mas.py"):
            cmd.append("--mock")
        steps.append((script, cmd))

    steps.append(
        (
            "verify_routing_handoff (MAS section)",
            [_PYTHON, "scripts/verify_routing_handoff.py", "--mas-only"],
        )
    )

    failed = 0
    for label, cmd in steps:
        proc = subprocess.run(
            cmd,
            cwd=_ROOT,
            env={**dict(**__import__("os").environ), **env},
            check=False,
        )
        ok = proc.returncode == 0
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        if not ok:
            failed += 1

    print(f"\nFinal gate: {len(steps) - failed}/{len(steps)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
