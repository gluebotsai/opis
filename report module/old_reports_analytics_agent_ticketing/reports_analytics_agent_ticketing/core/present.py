"""Turn executed rows into the user answer. Executors must not invent or emit tools."""

from __future__ import annotations

from typing import Any

from .query_frame import QueryFrame

_TOOL_MARKERS = (
    "call:ticketing",
    "execute_frame(",
    "execute_graph(",
    "tool_call",
    "invoke tool",
)


def looks_like_tool_call(text: str) -> bool:
    low = (text or "").lower().replace(" ", "")
    return any(marker.replace(" ", "") in low for marker in _TOOL_MARKERS)


def _cell(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _table(rows: list[dict[str, Any]], *, cap: int = 40) -> str:
    if not rows:
        return "No rows."
    keys = list(rows[0].keys())
    lines = [" | ".join(keys), " | ".join("---" for _ in keys)]
    for row in rows[:cap]:
        lines.append(" | ".join(_cell(row.get(k)) for k in keys))
    extra = len(rows) - cap
    if extra > 0:
        lines.append(f"… {extra} more rows not shown.")
    return "\n".join(lines)


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _kg_facts(frame: QueryFrame, rows: list[dict[str, Any]], clipped: str) -> str:
    measure = frame.measure or "graph"
    group = ", ".join(frame.group_by) if frame.group_by else ""
    n = len(rows)
    lines = [
        f"Graph facts ({measure}" + (f", grouped by {group}" if group else "") + f").",
        f"Rows returned: {n}.{clipped}",
    ]
    if not rows:
        lines.append("None matched in this tenant graph. That is a fact, not a suggestion.")
        return " ".join(lines)

    count_key = next((k for k in rows[0] if k.endswith("_count") or k == "ticket_count"), None)
    if count_key:
        total = 0.0
        ranked: list[tuple[str, float]] = []
        for row in rows:
            num = _as_number(row.get(count_key))
            if num is None:
                continue
            total += num
            label_parts = [_cell(v) for k, v in row.items() if k != count_key]
            ranked.append((" / ".join(p for p in label_parts if p) or "(blank)", num))
        lines.append(f"Sum of {count_key} on these rows: {int(total) if total.is_integer() else total}.")
        if ranked:
            top = ranked[:5]
            top_txt = "; ".join(f"{label} = {int(c) if float(c).is_integer() else c}" for label, c in top)
            lines.append(f"Highest on this result set: {top_txt}.")
            if len(ranked) > 5:
                lines.append(f"{len(ranked) - 5} further group(s) are in the table.")
    else:
        keys = list(rows[0].keys())
        lines.append("Path/neighborhood properties returned: " + ", ".join(keys) + ".")

    lines.append("")
    lines.append(_table(rows))
    lines.append("")
    lines.append("These figures are this Cypher result only. They are not certified SQL KPI rates.")
    return "\n".join(lines)


def _filter_echo(frame: QueryFrame) -> str:
    bits: list[str] = []
    for flt in frame.filters:
        op = flt.reading or "="
        bits.append(f"{flt.field} {op} {flt.mention}")
    return "; ".join(bits)


def present_job(
    job: dict[str, Any],
    frame: QueryFrame,
    *,
    brief: str = "",
) -> str:
    if job.get("error"):
        return str(job["error"])
    rows = list(job.get("rows") or [])
    store = str(job.get("store") or job.get("executor") or "")
    shape = frame.shape
    measure = frame.measure or ""
    group = ", ".join(frame.group_by) if frame.group_by else ""
    n = len(rows)
    limit = frame.limit
    clipped = " This is the row cap; more values may exist in the store." if limit and n >= int(limit) else ""
    if n >= 200 and not clipped:
        clipped = " This is the pack row cap; more values may exist in the store."
    pred = _filter_echo(frame)
    pred_txt = f" where {pred}" if pred else ""

    if store == "kg" or job.get("executor") == "kg":
        return _kg_facts(frame, rows, clipped)

    roster = measure in {"agents", "queues", "customers", "agent", "queue", "customer", "staff", "users"}
    if shape in {"list", "find"} and roster:
        head = f"{n} {measure} in the {measure} roster (not ticket volume).{clipped}"
        return f"{head}\n\n{_table(rows)}"

    if shape in {"list", "find"}:
        head = f"{n} ticket row(s){pred_txt}."
        return f"{head}{clipped}\n\n{_table(rows)}"

    if shape in {"breakdown", "ranking"} or frame.group_by:
        head = f"{measure} by {group or 'group'}{pred_txt}: {n} group(s)."
        if shape == "ranking" and group == "agent":
            head += " This is ticket volume by assignee, not the full agent roster."
        return f"{head}{clipped}\n\n{_table(rows)}"

    if n == 1 and len(rows[0]) == 1:
        key, val = next(iter(rows[0].items()))
        extra = ""
        if measure == "accounts_served" and _as_number(val) == 0:
            extra = " Contacts in this org have no account_id, so distinct accounts are 0."
        if measure == "unread_notifications" and frame.scope.level == "org":
            extra = " Org-wide unread (every user). Use scope own for one person's inbox."
        return f"{measure}: {val} ({key}){pred_txt}.{extra}"

    if not rows:
        return f"{measure}: no rows{pred_txt}."
    return f"{measure}: {n} row(s){pred_txt}.{clipped}\n\n{_table(rows)}"


def kg_llm_user_payload(
    *,
    brief: str,
    frame: QueryFrame,
    facts: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "brief": brief,
        "frame": {
            "shape": frame.shape,
            "measure": frame.measure,
            "group_by": frame.group_by,
            "scope": {"level": frame.scope.level, "target_mention": frame.scope.target_mention},
        },
        "facts": facts,
        "rows": rows[:80],
        "instruction": (
            "Brief the CEO in ordinary prose. Do not use headings like Narrative or Analysis. "
            "State the facts, explain what they show, then the next action only if the rows support a cause. "
            "Do not output tools, JSON, Cypher, or execute_graph."
        ),
    }


def choose_answer(llm_text: str | None, job: dict[str, Any], frame: QueryFrame, *, brief: str = "") -> str:
    facts = present_job(job, frame, brief=brief)
    text = (llm_text or "").strip()
    if not text or looks_like_tool_call(text) or len(text) < 60:
        return facts
    store = str(job.get("store") or job.get("executor") or "")
    if store == "kg":
        return text
    return facts
