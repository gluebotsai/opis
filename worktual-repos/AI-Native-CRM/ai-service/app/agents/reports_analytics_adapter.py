"""Map B2B warehouse turn results to coworker StructuredAnalytics."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

_CARD_LINE = re.compile(
    r"(?:<p>\s*)?"
    r"(?:<(?:strong|em|b)>\s*)?"
    r"(?:`{1,3}|\*{1,2})?\s*"
    r"(?<![A-Za-z])card\s*:\s*"
    r"(?:<[^>]+>\s*)?"
    r"[\"']?"
    r"(none|kpi|bar|table)\b"
    r"[\"']?"
    r"(?:\s+(r\d+))?"
    r"\s*"
    r"(?:</[^>]+>)?"
    r"\s*"
    r"(?:`{1,3}|\*{1,2})?"
    r"\s*"
    r"(?:</(?:strong|em|b)>\s*)?"
    r"(?:</p>)?",
    re.I,
)
_CARD_ONLY_LINE = re.compile(r"card\s*:.*", re.I)

_MONEY_KPI_SUFFIXES = ("_revenue", "_pipeline", "_amount", "_value", "_arr")


def _format_money(value: Any) -> str:
    from app.services.display_currency import format_money_amount

    return format_money_amount(float(value or 0))


def _visual_description(kind: str, title: str, x_key: str = "") -> str:
    lowered = title.lower()
    if kind == "kpi":
        return f"{title} for the selected dashboard period."
    if kind == "pie":
        return "Share breakdown from approved CRM data."
    if kind == "bar" and "pipeline" in lowered:
        if x_key in {"owner", "owner_name"}:
            return "Open pipeline grouped by salesperson."
        if x_key in {"company", "company_name"}:
            return "Open pipeline grouped by company."
        return "Open pipeline grouped by stage."
    if kind == "line":
        return "Trend from approved CRM data."
    return "Performance breakdown from approved CRM data."


def build_analytics_visual(
    chart: dict[str, Any] | None,
    rows: list[dict[str, Any]],
    *,
    title_fallback: str = "Analytics",
) -> dict[str, Any]:
    """Normalized KPI/chart/table payload consumed by React analytics components."""
    chart = dict(chart or {})
    title = str(chart.get("title") or title_fallback)
    kind = str(chart.get("type") or "table")

    if kind == "kpi":
        x_key = str(chart.get("x") or "label")
        y_raw = chart.get("y") or "value"
        y_key = y_raw[0] if isinstance(y_raw, list) and y_raw else str(y_raw)
        kpis: list[dict[str, str]] = []
        if rows and all("label" in row and "value" in row for row in rows[:6]):
            kpis = [
                {
                    "label": str(row.get("label") or title),
                    "value": str(row.get("value") or "—"),
                }
                for row in rows[:6]
            ]
        elif "win rate" in title.lower():
            won = lost = 0
            for row in rows:
                stage = str(row.get("stage") or "").lower()
                count = int(row.get("count") or 0)
                if stage == "closed_won":
                    won = count
                elif stage == "closed_lost":
                    lost = count
            decided = won + lost
            if decided:
                kpis = [
                    {
                        "label": "Win rate",
                        "value": f"{(won / decided) * 100:.1f}%",
                    }
                ]
        elif len(rows) == 1:
            row = rows[0]
            if row.get("count") is not None:
                kpis = [{"label": title, "value": str(row["count"])}]
            elif row.get("pipeline_value") is not None:
                kpis = [
                    {
                        "label": title,
                        "value": _format_money(row["pipeline_value"]),
                    }
                ]
            elif row.get("won_revenue") is not None:
                kpis = [
                    {"label": title, "value": _format_money(row["won_revenue"])}
                ]
            else:
                value = row.get(y_key)
                kpis = [
                    {
                        "label": str(row.get(x_key) or title),
                        "value": str(value if value is not None else "—"),
                    }
                ]
        else:
            kpis = [
                {
                    "label": str(row.get(x_key) or title),
                    "value": str(
                        row.get(y_key)
                        if row.get(y_key) is not None
                        else row.get("count") or "—"
                    ),
                }
                for row in rows[:6]
            ]
        return {
            "version": "1.0",
            "kind": "kpi",
            "title": title,
            "description": _visual_description("kpi", title),
            "kpis": kpis,
        }

    if kind in {"bar", "line", "pie"}:
        x_key = str(chart.get("x") or "label")
        y_raw = chart.get("y") or "count"
        y_keys = (
            [str(key) for key in y_raw]
            if isinstance(y_raw, list)
            else [str(y_raw)]
        )
        data = []
        for row in rows[:50]:
            if y_keys and not _is_number(row.get(y_keys[0])):
                continue
            item = dict(row)
            if x_key in item and isinstance(item[x_key], str):
                item[x_key] = item[x_key].replace("_", " ")
            data.append(item)
        return {
            "version": "1.0",
            "kind": kind,
            "title": title,
            "description": _visual_description(kind, title, x_key),
            "chart": {
                "xKey": x_key,
                "data": data,
                "series": [
                    {"key": key, "label": key.replace("_", " ").title()}
                    for key in y_keys
                ],
            },
        }

    columns = (
        [
            {"key": str(key), "label": str(key).replace("_", " ").title()}
            for key in rows[0].keys()
        ]
        if rows
        else []
    )
    return {
        "version": "1.0",
        "kind": "table",
        "title": title,
        "description": _visual_description("table", title),
        "table": {"columns": columns, "rows": rows[:50]},
    }


def peel_card_choice(text: str) -> tuple[str, dict[str, str] | None]:
    """Read the card choice, then drop every card line and plan blob from the answer."""
    stripped = (text or "").replace("&nbsp;", " ").replace("\u00a0", " ").strip()
    matches = list(_CARD_LINE.finditer(stripped))
    choice: dict[str, str] | None = None
    if matches:
        last = matches[-1]
        kind = last.group(1).lower()
        result = (last.group(2) or "").lower()
        choice = {"kind": kind}
        if kind != "none" and result:
            choice["result"] = result
        stripped = _CARD_LINE.sub("", stripped)
    stripped = _drop_leftover_card_lines(stripped)
    stripped = _strip_plan_blobs(stripped)
    stripped = re.sub(r"<p>\s*</p>", "", stripped)
    stripped = re.sub(r"\n{3,}", "\n\n", stripped).strip()
    return stripped, choice


def _drop_leftover_card_lines(text: str) -> str:
    """Drop a line that is only a card instruction the matcher did not catch."""
    kept: list[str] = []
    for line in text.split("\n"):
        plain = re.sub(r"<[^>]+>", " ", line)
        plain = re.sub(r"\s+", " ", plain).strip(" `\"'*")
        if plain and _CARD_ONLY_LINE.fullmatch(plain) and not re.search(r"[.?!]", plain):
            continue
        kept.append(line)
    return "\n".join(kept)


def _strip_plan_blobs(text: str) -> str:
    """Remove plan or tool JSON the brief sometimes echoes."""
    without_fences = re.sub(r"```(?:json)?\s*.*?```", "", text, flags=re.I | re.S)
    out: list[str] = []
    index = 0
    while index < len(without_fences):
        if without_fences[index] != "{":
            out.append(without_fences[index])
            index += 1
            continue
        end = _matching_brace(without_fences, index)
        if end is None:
            out.append(without_fences[index])
            index += 1
            continue
        blob = without_fences[index : end + 1]
        if _is_plan_blob(blob):
            index = end + 1
            continue
        out.append(blob)
        index = end + 1
    return "".join(out)


def _matching_brace(text: str, start: int) -> int | None:
    depth = 0
    for index in range(start, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return None


def _is_plan_blob(blob: str) -> bool:
    lowered = blob.lower()
    if '"tasks"' in lowered:
        return True
    if '"kind"' in lowered and "plan" in lowered:
        return True
    return bool(re.search(r'"kpi"\s*:', lowered))


def _first_string_key(row: dict[str, Any]) -> str:
    for key, val in row.items():
        if isinstance(val, str):
            return str(key)
    return next(iter(row.keys()), "label")


def _is_number(val: Any) -> bool:
    return isinstance(val, (int, float, Decimal)) and not isinstance(val, bool)


def _first_numeric_key(row: dict[str, Any]) -> str | None:
    for key, val in row.items():
        if _is_number(val):
            return str(key)
    return None


def _kpi_display_label(kpi_id: str) -> str:
    return str(kpi_id or "metric").replace("_", " ").strip().title()


def _is_money_kpi(kpi_id: str) -> bool:
    kid = (kpi_id or "").lower()
    if any(kid.endswith(suffix) for suffix in _MONEY_KPI_SUFFIXES):
        return True
    return any(token in kid for token in ("revenue", "pipeline", "invoice", "overdue", "quote"))


def _scalar_from_kpi_row(kpi_id: str, row: dict[str, Any]) -> Any:
    if not row:
        return None
    if kpi_id and kpi_id in row:
        return row[kpi_id]
    for key in (kpi_id, "value", "amount", "count"):
        if key and row.get(key) is not None:
            return row[key]
    if len(row) == 1:
        return next(iter(row.values()))
    numeric = _first_numeric_key(row)
    return row.get(numeric) if numeric else None


def _format_kpi_value(kpi_id: str, raw: Any) -> str:
    if raw is None:
        return "—"
    if _is_money_kpi(kpi_id):
        return _format_money(raw)
    if isinstance(raw, float):
        return f"{raw:.2f}" if not raw.is_integer() else str(int(raw))
    return str(raw)


def _kpi_slices_to_rows(kpi_slices: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in kpi_slices:
        kpi_id = str(item.get("kpi_id") or "")
        rows = item.get("rows") if isinstance(item.get("rows"), list) else []
        if not kpi_id or not rows or not isinstance(rows[0], dict):
            continue
        raw = _scalar_from_kpi_row(kpi_id, rows[0])
        out.append(
            {
                "label": _kpi_display_label(kpi_id),
                "value": _format_kpi_value(kpi_id, raw),
            }
        )
    return out


def _visual_time_description(plan: dict[str, Any], slices: list[dict[str, Any]]) -> str | None:
    for item in slices:
        phrase = str(item.get("time") or "").strip()
        if phrase and phrase.lower() not in {"all time", "none", ""}:
            return phrase
    tasks = plan.get("tasks") if isinstance(plan.get("tasks"), list) else []
    task = tasks[0] if tasks and isinstance(tasks[0], dict) else {}
    phrase = str(task.get("time") or "").strip()
    if phrase and phrase.lower() not in {"all time", "none", ""}:
        return phrase
    return None


def _dict_rows(entry: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(entry, dict):
        return []
    raw = entry.get("rows")
    if not isinstance(raw, list):
        return []
    return [row for row in raw if isinstance(row, dict)]


def _entry_by_id(
    result_id: str,
    breakdowns: list[dict[str, Any]] | None,
    kpi_slices: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    wanted = result_id.strip().lower()
    if not wanted:
        return None
    for entry in list(breakdowns or []) + list(kpi_slices or []):
        if isinstance(entry, dict) and str(entry.get("id") or "").strip().lower() == wanted:
            return entry
    return None


def _entry_title(entry: dict[str, Any], plan: dict[str, Any]) -> str:
    kpi_id = str(entry.get("kpi_id") or "").strip()
    if kpi_id:
        return _kpi_display_label(kpi_id)
    goal = str(entry.get("goal") or "").strip()
    if goal:
        return goal[:80]
    return _plan_title(plan)


def _numeric_key(rows: list[dict[str, Any]]) -> str | None:
    for row in rows:
        key = _first_numeric_key(row)
        if key:
            return key
    return None


def _choice_can_fill(kind: str, rows: list[dict[str, Any]]) -> bool:
    if not rows:
        return False
    if kind == "table":
        return True
    if kind == "bar":
        return _numeric_key(rows) is not None
    if kind == "kpi":
        return _numeric_key(rows) is not None or all(
            "label" in row and "value" in row for row in rows[:6]
        )
    return False


def _chart_for_choice(kind: str, rows: list[dict[str, Any]], title: str) -> dict[str, Any]:
    if kind == "kpi":
        y_key = _numeric_key(rows) or "value"
        return {"type": "kpi", "title": title, "x": "label", "y": y_key}
    if kind == "bar":
        return {
            "type": "bar",
            "title": title,
            "x": _first_string_key(rows[0]),
            "y": _numeric_key(rows) or "count",
        }
    return {"type": "table", "title": title, "x": "label", "y": "count"}


def _visual_has_data(kind: str, visual: dict[str, Any]) -> bool:
    if kind == "kpi":
        kpis = visual.get("kpis") if isinstance(visual.get("kpis"), list) else []
        return any(str(item.get("value") or "").strip() not in {"", "—"} for item in kpis if isinstance(item, dict))
    if kind == "bar":
        chart = visual.get("chart") if isinstance(visual.get("chart"), dict) else {}
        data = chart.get("data") if isinstance(chart.get("data"), list) else []
        return len(data) > 0
    table = visual.get("table") if isinstance(visual.get("table"), dict) else {}
    table_rows = table.get("rows") if isinstance(table.get("rows"), list) else []
    return len(table_rows) > 0


def _is_scalar_slice(entry: dict[str, Any], rows: list[dict[str, Any]]) -> bool:
    return bool(str(entry.get("kpi_id") or "").strip()) and len(rows) == 1 and len(rows[0]) <= 2


def build_structured_analytics(
    *,
    plan: dict[str, Any],
    rows: list[dict[str, Any]],
    assistant_text: str,
    organization_id: str,
    business_type: str,
    had_kg: bool,
    progress: list[dict[str, Any]] | None = None,
    kpi_slices: list[dict[str, Any]] | None = None,
    breakdowns: list[dict[str, Any]] | None = None,
    visual_row_limit: int | None = None,
    card_choice: dict[str, Any] | None = None,
) -> dict[str, Any]:
    choice = card_choice if isinstance(card_choice, dict) else {}
    kind = str(choice.get("kind") or "").strip().lower()
    result_id = str(choice.get("result") or "").strip().lower()
    slices = kpi_slices if isinstance(kpi_slices, list) else []
    visual: dict[str, Any] | None = None
    chart: dict[str, Any] | None = None
    findings_rows: list[dict[str, Any]] = []
    time_slices: list[dict[str, Any]] = []

    if kind in {"kpi", "bar", "table"} and result_id:
        entry = _entry_by_id(result_id, breakdowns, slices)
        display_rows = _dict_rows(entry)
        if visual_row_limit and visual_row_limit > 0:
            display_rows = display_rows[:visual_row_limit]
        if entry and _choice_can_fill(kind, display_rows):
            title = _entry_title(entry, plan)
            if kind == "kpi" and _is_scalar_slice(entry, display_rows):
                metric_rows = _kpi_slices_to_rows([entry])
                chart = {"type": "kpi", "title": title, "x": "label", "y": "value"}
                built_rows = metric_rows or display_rows
            else:
                chart = _chart_for_choice(kind, display_rows, title)
                built_rows = display_rows
            built = build_analytics_visual(chart, built_rows, title_fallback=title)
            if _visual_has_data(kind, built):
                visual = built
                findings_rows = display_rows
                if kind == "kpi":
                    time_slices = [entry]

    if visual and chart and visual.get("kind") == "kpi":
        time_phrase = _visual_time_description(plan, time_slices)
        if time_phrase:
            title = str(visual.get("title") or "")
            visual = {**visual, "description": f"{title} for {time_phrase}."}

    source = "reports_b2b_kg" if had_kg else "reports_b2b"
    payload: dict[str, Any] = {
        "plan": {**plan, "source": source},
        "findings": {
            "summary": assistant_text,
            "rows": findings_rows if visual else [],
            "comparison": "none",
        },
        "audit": {
            "source": source,
            "organizationId": organization_id,
            "businessType": business_type,
            "rowCount": len(findings_rows) if visual else 0,
            **({"progress": progress} if progress else {}),
        },
    }
    if visual and chart:
        payload["chart"] = chart
        payload["visual"] = visual
    return payload


def _plan_title(plan: dict[str, Any]) -> str:
    tasks = plan.get("tasks") if isinstance(plan.get("tasks"), list) else []
    if not tasks:
        return "CRM analytics"
    task = tasks[0] if isinstance(tasks[0], dict) else {}
    kpi = str(task.get("kpi") or "").replace("_", " ").strip()
    goal = str(task.get("goal") or "").strip()
    if kpi:
        return kpi.title()
    if goal:
        return goal[:80]
    return "CRM analytics"
