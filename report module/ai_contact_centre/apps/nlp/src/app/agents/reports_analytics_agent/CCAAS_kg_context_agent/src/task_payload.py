"""Domain-task text helpers. No Neo4j / pydantic imports."""

from __future__ import annotations


def _get(obj, name: str, default: str = ""):
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def compose_requirement(request) -> str:
    """Domain task is the specialist question. Fallback to query for isolated /chat."""
    goal = str(_get(request, "goal") or "").strip() or str(_get(request, "query") or "").strip()
    lines = []
    understanding = str(_get(request, "understanding") or "").strip()
    if understanding:
        lines.append(f"understanding: {understanding}")
    if goal:
        lines.append(f"goal: {goal}")
    time_words = str(_get(request, "time") or "").strip()
    if time_words:
        lines.append(f"time: {time_words}")
    scope = str(_get(request, "scope") or "").strip()
    if scope:
        lines.append(f"scope: {scope}")
    slice_raw = _get(request, "slice") or []
    if slice_raw:
        lines.append("slice: " + ", ".join(str(s) for s in slice_raw if s))
    answer_type = str(_get(request, "answer_type") or "").strip()
    if answer_type:
        lines.append(f"answer_type: {answer_type}")
    path = str(_get(request, "path") or "").strip()
    if path:
        lines.append(f"path: {path}")
    if str(_get(request, "sql_facts") or "").strip():
        lines.append("sql_facts_present: yes. Do not recount official volume.")
    return "\n".join(lines) if lines else goal


def format_domain_packet(
    request,
    rows: list,
    reasoning: dict,
    time_echo: str,
    body: str | None = None,
) -> str:
    lines = [
        "store: kg",
        f"window: {time_echo or _get(request, 'time') or 'unspecified'}",
        f"task_goal: {_get(request, 'goal') or _get(request, 'query') or ''}",
        f"checked: {reasoning.get('checked')}",
        f"not_checked: {reasoning.get('not_checked')}",
        f"row_count: {len(rows)}",
    ]
    if not rows:
        lines.append("RESULT: 0 rows")
    for i, row in enumerate(rows[:8], 1):
        cells = "; ".join(f"{k}={v}" for k, v in row.items())
        lines.append(f"row {i}: kind=observed; {cells}")
    lines.append("reasoning:")
    lines.append(f"- aligned_to_task: {reasoning.get('aligned_to_task')}")
    lines.append(f"- observed: {len(rows)} graph rows")
    lines.append("- derived: none beyond the rows")
    lines.append(f"- hypothesis: {reasoning.get('hypothesis')}")
    lines.append(f"- conflict_with_sql: {reasoning.get('conflict_with_sql')}")
    if body and "store: kg" not in body:
        lines.append("note: specialist also produced a narrative; Domain must use rows only.")
    return "\n".join(lines)
