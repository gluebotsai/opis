"""Pick a few free-SQL examples by token overlap with the task goal. Not an intent router."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from .loader import PRODUCT_DIR

_TOKEN = re.compile(r"[a-z0-9_]+")


def load_sql_examples(product_dir: Path = PRODUCT_DIR) -> list[dict[str, Any]]:
    path = product_dir / "examples" / "sql.yml"
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text()) or {}
    raw = data.get("examples") or []
    return [item for item in raw if isinstance(item, dict) and item.get("sql")]


def pick_sql_examples(goal: str, examples: list[dict[str, Any]], *, top_k: int = 3) -> list[dict[str, Any]]:
    if not examples:
        return []
    if len(examples) <= top_k:
        return examples
    want = set(_TOKEN.findall((goal or "").lower()))
    scored: list[tuple[int, int, dict[str, Any]]] = []
    for i, ex in enumerate(examples):
        hay = " ".join([str(ex.get("goal") or ""), str(ex.get("sql") or "")])
        have = set(_TOKEN.findall(hay.lower()))
        scored.append((len(want & have), -i, ex))
    scored.sort(reverse=True)
    return [ex for _, _, ex in scored[:top_k]]


def format_sql_examples(examples: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for ex in examples:
        goal = str(ex.get("goal") or "").strip()
        sql = str(ex.get("sql") or "").strip()
        blocks.append(f"# Goal: {goal}\n{sql}")
    return "\n\n".join(blocks)
