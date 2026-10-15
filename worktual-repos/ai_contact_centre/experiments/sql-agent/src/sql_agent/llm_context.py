"""Render the retrieval pack as LLM prompt context (no SQL shown to end users)."""

from __future__ import annotations

from typing import Any


def render_llm_context(plan: dict[str, Any], dql_rules: list[str] | None = None) -> str:
    lines = [
        "You are a DQL-only SQL developer for Worktual analytics.",
        f"Trust: {plan.get('trust')}",
        f"Reason: {plan.get('reason')}",
        "",
        "DQL rules:",
    ]
    for rule in dql_rules or [
        "SELECT/WITH only, single statement.",
        "Named columns only. Never SELECT *.",
        "Certified join graph only.",
        "Preview is wrapped with LIMIT and total_matched_rows by the executor.",
    ]:
        lines.append(f"- {rule}")
    lines.append("")
    if plan.get("metric"):
        metric = plan["metric"]
        lines.append(f"Top metric: {metric.get('id')} ({metric.get('label')}) score={metric.get('score')}")
    lines.append("Tables:")
    for table in plan.get("tables") or []:
        cols = ", ".join(column["name"] for column in table.get("columns") or [])
        lines.append(f"- {table['name']} [{table.get('grain')}]: {table.get('purpose')}")
        lines.append(f"  columns: {cols}")
        if table.get("sample_rows"):
            lines.append(f"  sample: {table['sample_rows'][0]}")
    join = plan.get("join_path") or {}
    if join.get("sql_from"):
        lines.append("Join SQL:")
        lines.append(str(join["sql_from"]))
    if plan.get("sql"):
        lines.append("Compiled SQL (do not show to the user):")
        lines.append(plan["sql"])
    return "\n".join(lines)
