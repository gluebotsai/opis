#!/usr/bin/env python3
"""Open the SQL agent sample tester UI.

  ./scripts/ui.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
VENV = ROOT.parents[1] / "apps" / "nlp" / ".venv"
VENV_PYTHON = VENV / "bin" / "python"


def _reexec_with_venv() -> None:
    if not VENV_PYTHON.is_file():
        sys.stderr.write(f"NLP venv not found: {VENV_PYTHON}\n")
        sys.exit(1)
    if Path(sys.prefix).resolve() == VENV.resolve():
        return
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(SRC) if not existing else str(SRC) + os.pathsep + existing
    env["SQL_AGENT_LIVE"] = env.get("SQL_AGENT_LIVE") or "1"
    os.execve(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]], env)


_reexec_with_venv()
os.environ.setdefault("SQL_AGENT_LIVE", "1")
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from sql_agent.server import main

if __name__ == "__main__":
    main()
