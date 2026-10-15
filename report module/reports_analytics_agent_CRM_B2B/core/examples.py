# origin: ticketing_v2/core/examples.py
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Dict, Optional
import yaml

@dataclass
class Example:
    id: str
    goal: str
    tags: list[str]
    # One of sql or cypher
    sql: str | None = None
    cypher: str | None = None
    # Optional metadata
    answer_type: str = ""
    kpi: str | None = None
    views: list[str] | None = None
    role: str = ""

def load_examples(path: str | Path) -> list[Example]:
    """Load examples from a YAML file."""
    p = Path(path)
    if not p.exists():
        return []
    data = yaml.safe_load(p.read_text()) or {}
    raw = data.get("examples") or []
    result: list[Example] = []
    for item in raw:
        goal_text = str(item.get("goal") or item.get("user_query") or "")
        result.append(Example(
            id=str(item.get("id", "")),
            goal=goal_text,
            tags=[str(t) for t in (item.get("tags") or [])],
            sql=item.get("sql"),
            cypher=item.get("cypher"),
            answer_type=str(item.get("answer_type") or item.get("action") or ""),
            kpi=item.get("kpi") or item.get("kpi_id"),
            views=item.get("views"),
            role=str(item.get("role", "")),
        ))
    return result

def format_examples_for_prompt(examples: list[Example], *, kind: str = "sql") -> str:
    """Format a list of examples into prompt text."""
    lines: list[str] = []
    for ex in examples:
        query = ex.sql if kind == "sql" else ex.cypher
        if not query:
            continue
        lines.append(f"# Goal: {ex.goal}")
        if ex.answer_type:
            lines.append(f"# answer_type: {ex.answer_type}")
        if ex.kpi:
            lines.append(f"# kpi: {ex.kpi}")
        lines.append(query.strip())
        lines.append("")
    return "\n".join(lines).strip()

def pick_examples(
    task_goal: str,
    examples: list[Example],
    *,
    top_k: int = 8,
    kind: str = "sql",
    call_llm: Any | None = None,
) -> list[Example]:
    """Pick the most relevant examples for the task goal."""
    if not examples:
        return []
    if len(examples) <= top_k:
        return examples
        
    # Keyword/token similarity scoring
    query_tokens = set(task_goal.lower().split())
    scored = []
    for ex in examples:
        ex_text = (ex.goal + " " + " ".join(str(t) for t in ex.tags)).lower()
        score = sum(1 for t in query_tokens if t in ex_text)
        scored.append((score, ex))
        
    scored.sort(key=lambda x: x[0], reverse=True)
    picked = [s[1] for s in scored[:top_k]]
    return picked

def select_dynamic_examples(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Legacy helper for simple dictionary output."""
    examples = load_examples(Path(__file__).resolve().parent.parent / "product" / "examples" / "sql.yml")
    picked = pick_examples(query, examples, top_k=limit)
    return [{"id": ex.id, "user_query": ex.goal, "sql": ex.sql, "kpi_id": ex.kpi} for ex in picked]
