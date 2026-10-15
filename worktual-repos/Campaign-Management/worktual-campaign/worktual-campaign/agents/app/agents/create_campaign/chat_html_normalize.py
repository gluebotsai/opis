"""Normalize create-campaign chat replies into safe, complete HTML for the FE.

Product rules:
- Prefer <p>, <ol>/<ul>/<li>, <b>, <table> — never raw markdown tables.
- Repair truncated tags (e.g. trailing ``<p``) so the bubble never shows broken markup.
- Plain numbered lists become real <ol> so they are not one collapsed paragraph.
"""

from __future__ import annotations

import html
import re

_TAG_OPEN_RE = re.compile(
    r"<\s*(/?)\s*(p|b|strong|ul|ol|li|table|thead|tbody|tr|td|th|br|em|i|a)\b"
    r"([^>]*)>",
    re.I,
)
_INCOMPLETE_TAG_TAIL_RE = re.compile(
    r"<\s*/?\s*(?:p|b|strong|ul|ol|li|table|thead|tbody|tr|td|th|br|em|i|a)\b[^>]*$",
    re.I,
)
_HAS_BLOCK_HTML_RE = re.compile(
    r"<\s*(p|ul|ol|li|table|br|b|strong)\b",
    re.I,
)
_MD_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")
_MD_TABLE_ROW_RE = re.compile(r"^\s*\|(.+)\|\s*$")
_NUMBERED_LINE_RE = re.compile(r"^\s*(\d+)[.)]\s+(.+)$")
_BULLET_LINE_RE = re.compile(r"^\s*[-*•]\s+(.+)$")


def looks_like_complete_user_reply(text: str) -> bool:
    """True when the model already wrote a user-facing answer (do not force tools)."""
    t = (text or "").strip()
    if len(t) < 40:
        return False
    lower = t.lower()
    # Tool/LLM self-instructions are not a finished user reply.
    if any(
        m in lower
        for m in (
            "you must call",
            "before replying",
            "do not paste",
            "call update_campaign_setup",
            "call build_campaign",
            "call launch_campaign",
            "[internal_nudge]",
            "[system]",
        )
    ):
        return False
    # Ideas / options / questions for the user.
    if _HAS_BLOCK_HTML_RE.search(t):
        return True
    if _NUMBERED_LINE_RE.search(t) or "|" in t:
        return True
    if "?" in t and len(t) >= 60:
        return True
    return len(t) >= 120


def _strip_incomplete_trailing_tag(text: str) -> str:
    t = (text or "").rstrip()
    if not t:
        return t
    m = _INCOMPLETE_TAG_TAIL_RE.search(t)
    if m:
        return t[: m.start()].rstrip()
    if t.endswith("<"):
        return t[:-1].rstrip()
    return t


def _balance_simple_tags(text: str) -> str:
    """Close unclosed allowlisted block tags; drop orphan incomplete tails."""
    t = _strip_incomplete_trailing_tag(text)
    stack: list[str] = []
    void = {"br"}
    for m in _TAG_OPEN_RE.finditer(t):
        closing = bool(m.group(1))
        name = m.group(2).lower()
        if name in void:
            continue
        if closing:
            if stack and stack[-1] == name:
                stack.pop()
            continue
        stack.append(name)
    if not stack:
        return t
    suffix = "".join(f"</{name}>" for name in reversed(stack))
    return t + suffix


def _escape_plain(text: str) -> str:
    return html.escape(text, quote=False)


def _cells_from_md_row(line: str) -> list[str]:
    m = _MD_TABLE_ROW_RE.match(line)
    if not m:
        return []
    return [c.strip() for c in m.group(1).split("|")]


def _try_markdown_table_to_html(lines: list[str]) -> str | None:
    rows: list[list[str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if _MD_TABLE_SEP_RE.match(line):
            i += 1
            continue
        cells = _cells_from_md_row(line)
        if cells:
            rows.append(cells)
            i += 1
            continue
        break
    if len(rows) < 2:
        return None
    header, *body = rows
    parts = ["<table><thead><tr>"]
    parts.extend(f"<th>{_escape_plain(c)}</th>" for c in header)
    parts.append("</tr></thead><tbody>")
    for row in body:
        padded = list(row)
        while len(padded) < len(header):
            padded.append("")
        parts.append("<tr>")
        for c in padded[: len(header)]:
            parts.append(f"<td>{_escape_plain(c)}</td>")
        parts.append("</tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def _plain_blocks_to_html(text: str) -> str:
    """Convert plain / markdown-ish prose into HTML blocks."""
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not raw:
        return ""

    lines = raw.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue

        if "|" in stripped and i + 1 < len(lines):
            table_html = _try_markdown_table_to_html(lines[i:])
            if table_html:
                j = i
                while j < len(lines):
                    s = lines[j].strip()
                    if not s:
                        break
                    if _MD_TABLE_ROW_RE.match(s) or _MD_TABLE_SEP_RE.match(s):
                        j += 1
                        continue
                    break
                out.append(table_html)
                i = j
                continue

        if _NUMBERED_LINE_RE.match(stripped):
            items: list[str] = []
            while i < len(lines):
                s = lines[i].strip()
                if not s:
                    if items:
                        break
                    i += 1
                    continue
                nm = _NUMBERED_LINE_RE.match(s)
                if not nm:
                    break
                items.append(nm.group(2).strip())
                i += 1
            out.append(
                "<ol>"
                + "".join(f"<li>{_escape_plain(it)}</li>" for it in items)
                + "</ol>"
            )
            continue

        if _BULLET_LINE_RE.match(stripped):
            items = []
            while i < len(lines):
                s = lines[i].strip()
                if not s:
                    if items:
                        break
                    i += 1
                    continue
                bm = _BULLET_LINE_RE.match(s)
                if not bm:
                    break
                items.append(bm.group(1).strip())
                i += 1
            out.append(
                "<ul>"
                + "".join(f"<li>{_escape_plain(it)}</li>" for it in items)
                + "</ul>"
            )
            continue

        para: list[str] = []
        while i < len(lines):
            s = lines[i].strip()
            if not s:
                break
            if (
                _NUMBERED_LINE_RE.match(s)
                or _BULLET_LINE_RE.match(s)
                or _MD_TABLE_ROW_RE.match(s)
                or _MD_TABLE_SEP_RE.match(s)
            ):
                break
            para.append(s)
            i += 1
        if para:
            out.append(f"<p>{_escape_plain(' '.join(para))}</p>")

    return "".join(out) if out else f"<p>{_escape_plain(raw)}</p>"


def normalize_chat_html(text: str) -> str:
    """Return chat-safe HTML suitable for FE sanitizeChatHtml."""
    t = (text or "").strip()
    if not t:
        return t
    t = _strip_incomplete_trailing_tag(t)
    if _HAS_BLOCK_HTML_RE.search(t):
        return _balance_simple_tags(t)
    return _plain_blocks_to_html(t)


def strip_for_compare(text: str) -> str:
    from app.text_cleanup import strip_html_tags

    return strip_html_tags(text).lower()


def merge_preserved_user_replies(preserved: str, final: str) -> str:
    """Legacy helper — not used on create-campaign turns (caused cross-turn bubble stacking)."""
    a = (preserved or "").strip()
    b = (final or "").strip()
    if not a:
        return normalize_chat_html(b)
    if not b:
        return normalize_chat_html(a)
    if a == b:
        return normalize_chat_html(a)
    if a in b or strip_for_compare(a) in strip_for_compare(b):
        return normalize_chat_html(b)
    if b in a or strip_for_compare(b) in strip_for_compare(a):
        return normalize_chat_html(a)
    if len(a) >= 80 and len(b) < max(80, int(len(a) * 0.55)):
        return normalize_chat_html(a) + normalize_chat_html(b)
    return normalize_chat_html(b)


__all__ = [
    "looks_like_complete_user_reply",
    "merge_preserved_user_replies",
    "normalize_chat_html",
    "strip_for_compare",
]
