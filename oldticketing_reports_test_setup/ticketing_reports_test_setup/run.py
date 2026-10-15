#!/usr/bin/env python3
"""Launch Streamlit with the repo .venv when present."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
APP = HERE / "app.py"
VENV_PY = REPO / ".venv" / "bin" / "python"


def _python() -> str:
    if VENV_PY.exists():
        return str(VENV_PY)
    return sys.executable


def main() -> int:
    py = _python()
    probe = subprocess.run(
        [py, "-c", "import streamlit, neo4j"],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        print(
            "Missing Streamlit/neo4j in this interpreter.\n"
            f"Interpreter: {py}\n"
            "Install with:\n"
            f"  {py} -m pip install -r {HERE / 'requirements.txt'}\n"
            f"{probe.stderr}",
            file=sys.stderr,
        )
        return 1
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    cmd = [py, "-m", "streamlit", "run", str(APP), "--server.headless", "true"]
    return subprocess.call(cmd, cwd=str(HERE), env=env)


if __name__ == "__main__":
    raise SystemExit(main())
