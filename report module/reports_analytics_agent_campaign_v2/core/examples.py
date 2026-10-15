"""Pick a few similar SQL examples for the executor prompt.

Selection is token overlap against the task goal. Not an intent router.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Example:
    id: str
    goal: str
    tags: list[str]
    sql: str | None = None
    answer_type: str = ""
    kpi: str | None = None
    note: str | None = None


def load_examples(path: str | Path) -> list[Example]:
    data = yaml.safe_load(Path(path).read_text()) or {}
    raw = data.get("examples") or []
    result: list[Example] = []
    for item in raw:
        result.append(
            Example(
                id=str(item.get("id") or item.get("question") or ""),
                goal=str(item.get("goal") or item.get("question") or ""),
                tags=list(item.get("tags") or []),
                sql=item.get("sql"),
                answer_type=str(item.get("answer_type") or ""),
                kpi=item.get("kpi"),
                note=item.get("note"),
            )
        )
    return result


def format_examples_for_prompt(examples: list[Example]) -> str:
    lines: list[str] = []
    for ex in examples:
        lines.append(f"# Goal: {ex.goal}")
        if ex.answer_type:
            lines.append(f"# answer_type: {ex.answer_type}")
        if ex.kpi:
            lines.append(f"# kpi: {ex.kpi}")
        if ex.note:
            lines.append(f"# note: {ex.note}")
        if ex.sql:
            lines.append(ex.sql.strip())
        lines.append("")
    return "\n".join(lines).strip()


_TOKEN = re.compile(r"[a-z0-9_]+")


def pick_examples(task_goal: str, examples: list[Example], *, top_k: int = 8) -> list[Example]:
    if not examples:
        return []
    if len(examples) <= top_k:
        return examples
    want = set(_TOKEN.findall((task_goal or "").lower()))
    scored: list[tuple[int, int, Example]] = []
    for i, ex in enumerate(examples):
        hay = " ".join([ex.goal, " ".join(ex.tags), ex.answer_type, ex.kpi or "", ex.sql or ""])
        have = set(_TOKEN.findall(hay.lower()))
        scored.append((len(want & have), -i, ex))
    scored.sort(reverse=True)
    return [ex for _, _, ex in scored[:top_k]]


def dimension_alias_brief(doc: dict[str, Any]) -> str:
    aliases = doc.get("aliases") or {}
    dims = doc.get("dimensions") or {}
    lines = ["dimension aliases (user word -> id):"]
    for raw, dim_id in aliases.items():
        meaning = ((dims.get(dim_id) or {}).get("meaning") or "").strip()
        lines.append(f"  {raw} -> {dim_id}" + (f" ({meaning})" if meaning else ""))
    return "\n".join(lines)
