"""Hard number gate: user-visible HTML must come from warehouse preview."""

from __future__ import annotations

import html
import re
from typing import Any

from sql_agent.context import QueryContext

_EMPTY_MARKERS = (
    "no matching",
    "n/a",
    "none",
    "zero",
    "no rows",
    "not available",
)


def preview_is_empty(preview: list[dict[str, Any]] | None) -> bool:
    if not preview:
        return True
    values = [value for row in preview for value in row.values()]
    return all(value in {None, "n/a", ""} for value in values)


def _row_label(row: dict[str, Any]) -> str:
    parts = [f"{html.escape(str(key))} {html.escape(str(value))}" for key, value in row.items()]
    return ", ".join(parts)


def render_grounded_html(
    preview: list[dict[str, Any]] | None,
    *,
    ctx: QueryContext,
    headline: str = "",
) -> str:
    period = html.escape(ctx.period_label)
    if preview_is_empty(preview):
        detail = html.escape(headline) if headline else "No matching rows in the warehouse."
        return (
            f"<p>{detail}</p>"
            f"<p>Period {period}. No other totals are available.</p>"
        )
    assert preview is not None
    if len(preview) == 1 and len(preview[0]) <= 2:
        body = html.escape(headline or _row_label(preview[0]))
        return f"<p><strong>{body}</strong> for {period}.</p>"
    items = "".join(f"<li>{_row_label(row)}</li>" for row in preview[:12])
    more = ""
    if len(preview) > 12:
        more = f"<p>Showing 12 of {len(preview)} groups.</p>"
    return f"<p>Results for {period}:</p><ul>{items}</ul>{more}"


def reply_matches_preview(reply: str, preview: list[dict[str, Any]] | None) -> bool:
    text = reply or ""
    if preview_is_empty(preview):
        lowered = text.casefold()
        return any(marker in lowered for marker in _EMPTY_MARKERS)
    assert preview is not None
    haystack = text.casefold()
    for row in preview:
        for value in row.values():
            if value in {None, "n/a", ""}:
                continue
            token = str(value).strip()
            if not token:
                continue
            if re.fullmatch(r"-?\d+", token):
                if re.search(rf"\b{re.escape(token)}\b", text) is None:
                    return False
                continue
            if token.casefold() not in haystack:
                duration = re.fullmatch(r"(\d+)m (\d+)s", token)
                if duration:
                    alt = f"{duration.group(1)} minutes {duration.group(2)} seconds"
                    if alt.casefold() in haystack:
                        continue
                return False
    return True


def ground_reply(
    reply: str,
    warehouse: dict[str, Any] | None,
    ctx: QueryContext,
) -> str:
    if not warehouse or warehouse.get("dry_run") or not warehouse.get("ok"):
        if warehouse is None:
            return reply
        if warehouse.get("ok") is False:
            error = html.escape(str(warehouse.get("error") or "Warehouse query failed."))
            return f"<p>{error}</p>"
        return reply
    preview = warehouse.get("preview") or []
    headline = str(warehouse.get("headline") or "")
    if reply_matches_preview(reply, preview):
        return reply
    return render_grounded_html(preview, ctx=ctx, headline=headline)
