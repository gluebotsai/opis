"""Lightweight cleanup for agent chat / template text (no Markdown rendering)."""

from __future__ import annotations

import html
import re


_EMPHASIS_RE = re.compile(r"(\*{1,2}|_{1,2})(.+?)\1")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def strip_markdown_emphasis(text: str) -> str:
    """Remove **bold** / __bold__ / *italic* markers while keeping the inner words."""
    if not text:
        return text
    prev = None
    out = text
    # Nested / repeated markers: iterate a few times
    for _ in range(4):
        if out == prev:
            break
        prev = out
        out = _EMPHASIS_RE.sub(r"\2", out)
    # Leftover lone stars used for emphasis
    out = out.replace("**", "").replace("__", "")
    return out


def strip_html_tags(text: str) -> str:
    """Plain text for LLM history — UI/DB keep full HTML."""
    if not text:
        return text
    out = _HTML_TAG_RE.sub(" ", str(text))
    out = html.unescape(out)
    out = _WS_RE.sub(" ", out).strip()
    return out
