"""Format a stored KB article into one Meilisearch document. Never invent fields."""

from __future__ import annotations

import re
from typing import Any

MODULE = "ticketing"

_NUMBERED_STEP = re.compile(
    r"^\s*(?:step\s*)?(\d+)\s*[\.\)\:\-]\s+(.+?)\s*$",
    re.IGNORECASE,
)
_SYMPTOM_HEADING = re.compile(r"^\s*symptoms?\s*:?\s*$", re.IGNORECASE)
_SYMPTOM_INLINE = re.compile(r"^\s*symptoms?\s*:\s+(.+?)\s*$", re.IGNORECASE)
_BULLET = re.compile(r"^\s*[-*•]\s+(.+?)\s*$")


def _split_phrases(raw: str) -> list[str]:
    parts = re.split(r"\s*(?:,|;|/)\s*", raw)
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        text = part.strip().strip(".")
        if len(text) < 2:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def extract_steps(content: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for line in _lines(content):
        match = _NUMBERED_STEP.match(line)
        if not match:
            continue
        action = match.group(2).strip().strip(".")
        if action:
            found.append((int(match.group(1)), action))
    if len(found) < 2:
        return []
    found.sort(key=lambda item: item[0])
    return [action for _, action in found]


def extract_symptoms(content: str) -> list[str]:
    """Copy only an explicit Symptoms heading or 'Symptoms: a, b' line."""
    lines = _lines(content)
    collected: list[str] = []
    under_heading = False
    for line in lines:
        inline = _SYMPTOM_INLINE.match(line)
        if inline:
            collected.extend(_split_phrases(inline.group(1)))
            under_heading = False
            continue
        if _SYMPTOM_HEADING.match(line):
            under_heading = True
            continue
        if under_heading:
            bullet = _BULLET.match(line)
            if bullet:
                collected.extend(_split_phrases(bullet.group(1)))
                continue
            numbered = _NUMBERED_STEP.match(line)
            if numbered or not line.strip():
                under_heading = False
                continue
            if line.strip():
                collected.extend(_split_phrases(line))
                under_heading = False
    return collected


def flatten_text(title: str, content: str, symptoms: list[str], steps: list[str]) -> str:
    parts: list[str] = []
    title_s = title.strip()
    if title_s:
        parts.append(title_s.rstrip("."))
    parts.extend(item.rstrip(".") for item in symptoms if item.strip())
    if steps:
        parts.extend(item.rstrip(".") for item in steps if item.strip())
    else:
        body = content.strip()
        if body:
            parts.append(body)
    return ". ".join(parts)


def document_id(organization_id: str, article_id: str) -> str:
    org = re.sub(r"[^a-zA-Z0-9\-_]", "_", str(organization_id or "").strip())
    art = re.sub(r"[^a-zA-Z0-9\-_]", "_", str(article_id or "").strip())
    return f"{org}_{art}"[:511]


def format_article(
    *,
    organization_id: str,
    article_id: str,
    title: str,
    content: str,
    symptoms: list[str] | None = None,
    steps: list[str] | None = None,
) -> dict[str, Any]:
    title_s = str(title or "").strip()
    body = str(content or "").strip()
    symptom_list = list(symptoms) if symptoms is not None else extract_symptoms(body)
    step_list = list(steps) if steps is not None else extract_steps(body)
    return {
        "id": document_id(organization_id, article_id),
        "article_id": str(article_id or "").strip(),
        "organization_id": str(organization_id or "").strip(),
        "module": MODULE,
        "title": title_s,
        "symptoms": symptom_list,
        "steps": step_list,
        "text": flatten_text(title_s, body, symptom_list, step_list),
    }


def _lines(content: str) -> list[str]:
    return str(content or "").replace("\r\n", "\n").split("\n")
