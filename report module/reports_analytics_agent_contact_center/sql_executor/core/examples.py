"""Similarity-based few-shot example picker for SQL and Cypher executors.

V2 Design §6.1 and §7:
  'The LLM receives 6–10 worked question -> SQL examples, picked by similarity to the task.'

Strategy (Decision 3 = Option C — LLM-based selection):
  Send the task goal to the same LLM used for execution, asking it to choose
  the most relevant example IDs from the full example set. Falls back to
  returning all examples if the LLM call fails.

The picker is lightweight: it sends a small, cheap request (temperature=0)
  and returns example IDs. Callers then format the chosen examples.
"""

from __future__ import annotations

import json
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
    # One of sql or cypher
    sql: str | None = None
    cypher: str | None = None
    # Optional metadata
    answer_type: str = ""
    kpi: str | None = None
    views: list[str] | None = None


def load_examples(path: str | Path) -> list[Example]:
    """Load examples from a YAML file.

    Supports both sql.yml and cypher.yml formats.
    """
    data = yaml.safe_load(Path(path).read_text()) or {}
    raw = data.get("examples") or []
    result: list[Example] = []
    for item in raw:
        result.append(Example(
            id=str(item.get("id", "")),
            goal=str(item.get("goal", "")),
            tags=list(item.get("tags") or []),
            sql=item.get("sql"),
            cypher=item.get("cypher"),
            answer_type=str(item.get("answer_type") or ""),
            kpi=item.get("kpi"),
            views=item.get("views"),
        ))
    return result


def format_examples_for_prompt(examples: list[Example], *, kind: str = "sql") -> str:
    """Format a list of examples into the prompt text injected into the executor."""
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


def _build_selection_prompt(task_goal: str, examples: list[Example], top_k: int, kind: str) -> str:
    """Build the LLM prompt for example selection."""
    items = []
    for ex in examples:
        items.append(f'  - id: "{ex.id}" | goal: "{ex.goal}" | type: {ex.answer_type or "general"}')
    catalog = "\n".join(items)
    return (
        f"You are selecting the {top_k} most relevant {kind.upper()} examples to show an executor agent.\n"
        f"Task goal: {task_goal}\n\n"
        f"Available examples:\n{catalog}\n\n"
        f"Return ONLY a JSON array of the {top_k} most relevant example IDs, e.g.:\n"
        f'["id1", "id2", "id3"]\n\n'
        f"Choose the examples whose goals and types best match the task. Return {top_k} IDs."
    )


def _parse_ids(response: str) -> list[str]:
    """Extract example IDs from an LLM JSON array response."""
    # Try to find a JSON array in the response
    match = re.search(r"\[.*?\]", response, re.DOTALL)
    if match:
        try:
            ids = json.loads(match.group(0))
            if isinstance(ids, list):
                return [str(i) for i in ids]
        except json.JSONDecodeError:
            pass
    return []


def pick_examples_llm(
    task_goal: str,
    examples: list[Example],
    call_llm: Any,  # callable(messages) -> str
    *,
    top_k: int = 8,
    kind: str = "sql",
) -> list[Example]:
    """Use the LLM to pick the top_k most relevant examples for the task goal.

    Args:
        task_goal:  the plain-language goal of the task
        examples:   all available examples
        call_llm:   callable(messages: list[dict]) -> str  (your existing LLM wrapper)
        top_k:      how many examples to return
        kind:       'sql' or 'cypher'

    Returns:
        List of at most top_k examples, in relevance order.
        Falls back to the first top_k examples if the LLM call fails.
    """
    if not examples:
        return []
    if len(examples) <= top_k:
        return examples  # No need to filter if we have fewer than top_k

    prompt = _build_selection_prompt(task_goal, examples, top_k, kind)
    messages = [
        {
            "role": "system",
            "content": (
                "You are a precise selector. Return only a JSON array of example IDs. "
                "No explanation, no markdown, just the JSON array."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    try:
        response = call_llm(messages)
        chosen_ids = _parse_ids(response)
        if not chosen_ids:
            return examples[:top_k]

        # Build a lookup and return in the order chosen by the LLM
        id_to_example = {ex.id: ex for ex in examples}
        picked = [id_to_example[eid] for eid in chosen_ids if eid in id_to_example]

        # Fill up to top_k with remaining examples if the LLM returned fewer
        if len(picked) < top_k:
            picked_ids = {ex.id for ex in picked}
            for ex in examples:
                if ex.id not in picked_ids and len(picked) < top_k:
                    picked.append(ex)

        return picked[:top_k]

    except Exception:
        # Fallback: return first top_k examples
        return examples[:top_k]


def pick_examples(
    task_goal: str,
    examples: list[Example],
    *,
    top_k: int = 8,
    kind: str = "sql",
    call_llm: Any | None = None,
) -> list[Example]:
    """Pick the most relevant examples for the task goal.

    If call_llm is provided, uses LLM-based selection (Option C).
    Otherwise falls back to returning the first top_k examples.
    """
    if call_llm is not None:
        return pick_examples_llm(task_goal, examples, call_llm, top_k=top_k, kind=kind)
    # Simple fallback: return first top_k
    return examples[:top_k]
