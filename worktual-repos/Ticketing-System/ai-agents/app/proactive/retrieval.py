"""One retrieval/embedding service for KB + tickets (DSSA / RKAA / STDA)."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any, Literal

TokenVec = Counter[str]

_STEM_SUFFIXES = (
    "tion",
    "ness",
    "ment",
    "ings",
    "ing",
    "ers",
    "ies",
    "ied",
    "ed",
    "es",
    "s",
)


def _stem(tok: str) -> str:
    """Light stem so 'connecting' ~ 'connect' for local scoring."""
    t = (tok or "").lower()
    for suf in _STEM_SUFFIXES:
        if len(t) > len(suf) + 2 and t.endswith(suf):
            return t[: -len(suf)]
    return t


def _tokens(text: str) -> TokenVec:
    raw = re.findall(r"[a-z0-9]{3,}", (text or "").lower())
    return Counter(_stem(t) for t in raw)


def _cosine(a: TokenVec, b: TokenVec) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in a.keys() & b.keys())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _payload_rows(result: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    payload = result.get("payload") if isinstance(result, dict) else None
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in keys:
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
        # Common Express wrappers: { data: [...] } or { data: { articles: [...] } }
        data = payload.get("data")
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
        if isinstance(data, dict):
            for key in keys:
                rows = data.get(key)
                if isinstance(rows, list):
                    return [r for r in rows if isinstance(r, dict)]
        if all(isinstance(v, dict) for v in payload.values()) and payload:
            return list(payload.values())  # type: ignore[arg-type]
    return []


def ticket_from_tool(result: Any, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    """Use a live ticket payload, or the event fallback when the tool 404s/errors."""
    fb = fallback if isinstance(fallback, dict) else {}
    if not isinstance(result, dict):
        return fb
    inner = result.get("payload")
    if result.get("success") is False:
        return fb
    if not isinstance(inner, dict) or not inner:
        return fb
    if inner.get("error") and not (inner.get("subject") or inner.get("ticketNumber") or inner.get("id")):
        return fb
    return inner


def retrieve(
    query_text: str,
    *,
    source: Literal["kb", "tickets", "both"] = "both",
    limit: int = 5,
) -> list[dict[str, Any]]:
    """
    Rank live KB/tickets by token overlap with the query.

    Do **not** pass the full issue sentence as Express ``q`` — ``/api/kb`` uses
    contiguous ILIKE, so \"VPN not connecting after password reset\" misses an
    article titled \"What to Do When Your VPN Won't Connect\". Load published
    catalog (same pattern as DSSA) and score locally.
    """
    q = _tokens(query_text)
    scored: list[tuple[float, dict[str, Any]]] = []

    if source in {"kb", "both"}:
        try:
            from app.tools.catalog_tools import list_kb

            # No phrase ``query=`` — local cosine owns relevance (DSSA-style).
            rows = _payload_rows(
                list_kb(status="Published"),
                ("articles", "items", "kb"),
            )
        except Exception:
            rows = []
        for row in rows:
            blob = " ".join(
                str(row.get(k) or "")
                for k in ("title", "content", "body", "category", "summary")
            )
            scored.append(
                (
                    _cosine(q, _tokens(blob)),
                    {
                        "source": "kb",
                        "id": str(row.get("id") or row.get("externalId") or ""),
                        "title": str(row.get("title") or ""),
                        "snippet": str(row.get("content") or row.get("body") or "")[:400],
                    },
                )
            )

    if source in {"tickets", "both"}:
        try:
            from app.tools.ticket_read import list_tickets

            rows = _payload_rows(list_tickets(), ("tickets", "items"))
        except Exception:
            rows = []
        for row in rows:
            blob = " ".join(
                str(row.get(k) or "")
                for k in ("subject", "description", "id", "status", "priority")
            )
            scored.append(
                (
                    _cosine(q, _tokens(blob)),
                    {
                        "source": "ticket",
                        "id": str(
                            row.get("ticketNumber")
                            or row.get("ticket_number")
                            or row.get("id")
                            or ""
                        ),
                        "title": str(row.get("subject") or ""),
                        "snippet": str(row.get("description") or "")[:400],
                    },
                )
            )

    scored.sort(key=lambda t: t[0], reverse=True)
    out: list[dict[str, Any]] = []
    for score, item in scored:
        if score <= 0:
            continue
        item = dict(item)
        item["score"] = round(score, 4)
        out.append(item)
        if len(out) >= limit:
            break
    return out
