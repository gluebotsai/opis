"""CI guard: no LangGraph / LangChain in the agent service."""

from __future__ import annotations

import re
from pathlib import Path

IMPORT_RE = re.compile(
    r"^\s*(?:from|import)\s+(langgraph|langchain)(?:[.\s]|$)",
    re.MULTILINE | re.IGNORECASE,
)
APP_ROOT = Path(__file__).resolve().parents[1] / "app"


def test_no_forbidden_imports_in_app() -> None:
    hits: list[str] = []
    for path in APP_ROOT.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for match in IMPORT_RE.finditer(text):
            hits.append(f"{path.relative_to(APP_ROOT.parent)}:{match.group(1)}")
    assert not hits, "Forbidden framework imports:\n" + "\n".join(hits)


def test_requirements_have_no_langchain() -> None:
    req = Path(__file__).resolve().parents[1] / "requirements.txt"
    text = req.read_text(encoding="utf-8").lower()
    for token in ("langgraph", "langchain"):
        assert token not in text, f"{token} found in requirements.txt"
