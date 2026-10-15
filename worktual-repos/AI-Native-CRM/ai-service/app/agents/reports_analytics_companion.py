"""Trim chat text when structured analytics already shows the same data."""

from __future__ import annotations

import re
from typing import Any

def strip_markdown_tables(text: str) -> str:
    """Remove markdown pipe tables; keep narrative paragraphs."""
    if not (text or "").strip():
        return ""
    lines = (text or "").splitlines()
    kept: list[str] = []
    skipping_table = False
    for line in lines:
        stripped = line.strip()
        is_table_line = stripped.startswith("|") or bool(
            re.match(r"^\|?[\s|:-]+\|", stripped)
        )
        if is_table_line:
            skipping_table = True
            continue
        if skipping_table and not stripped:
            continue
        skipping_table = False
        kept.append(line)
    out = "\n".join(kept)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def analytics_shows_data_grid(analytics: dict[str, Any] | None) -> bool:
    if not isinstance(analytics, dict):
        return False
    visual = analytics.get("visual")
    if not isinstance(visual, dict):
        return False
    kind = str(visual.get("kind") or "")
    if kind == "table":
        table = visual.get("table") if isinstance(visual.get("table"), dict) else {}
        rows = table.get("rows") if isinstance(table.get("rows"), list) else []
        return len(rows) > 0
    if kind in {"bar", "line", "pie"}:
        chart = visual.get("chart") if isinstance(visual.get("chart"), dict) else {}
        data = chart.get("data") if isinstance(chart.get("data"), list) else []
        return len(data) > 1
    return False


def companion_assistant_text(assistant_text: str, analytics: dict[str, Any] | None) -> str:
    """Drop duplicate tabular content from speech when the UI already renders a grid/chart."""
    text = (assistant_text or "").strip()
    if not text or not analytics_shows_data_grid(analytics):
        return text
    trimmed = strip_markdown_tables(text)
    if trimmed:
        return trimmed
    return text.split("\n\n", 1)[0].strip() or text[:600]
