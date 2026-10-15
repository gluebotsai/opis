"""SQL skill packs. Attach by plan fields, never by keyword on the question."""

from __future__ import annotations

from pathlib import Path
from typing import Any

PACK_DIR = Path(__file__).resolve().parent.parent
SKILLS_DIR = PACK_DIR / "skills" / "sql"

SKILL_NAMES = (
    "analytics-kpi-query",
    "analytics-count-breakdown",
    "analytics-report-list",
    "analytics-status-snapshot",
)


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    body = text
    meta: dict[str, str] = {}
    if not text.startswith("---"):
        return meta, body
    parts = text.split("---", 2)
    if len(parts) < 3:
        return meta, body
    for line in parts[1].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"')
    return meta, parts[2].lstrip("\n")


def load_skill(name: str) -> str:
    path = SKILLS_DIR / name / "SKILL.md"
    if not path.is_file():
        return ""
    return path.read_text()


def catalog() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for name in SKILL_NAMES:
        raw = load_skill(name)
        meta, _ = _parse_frontmatter(raw)
        rows.append({"name": name, "description": meta.get("description") or name})
    return rows


def catalog_block() -> str:
    lines = ["## SQL skills (pick via plan fields; do not keyword-match the question)"]
    for row in catalog():
        lines.append(f"- `{row['name']}`: {row['description']}")
    return "\n".join(lines)


def skill_for_task(task: dict[str, Any] | None) -> str:
    task = task or {}
    explicit = str(task.get("skill") or "").strip()
    if explicit in SKILL_NAMES:
        return explicit
    kpi = task.get("kpi")
    if kpi not in (None, "", "null"):
        return "analytics-kpi-query"
    answer = str(task.get("answer_type") or "").lower()
    if answer in ("snapshot", "live"):
        return "analytics-status-snapshot"
    dim = task.get("dimension")
    if answer in ("breakdown", "ranking") or dim not in (None, "", "null", "none"):
        return "analytics-count-breakdown"
    return "analytics-report-list"


def compose_with_skill(base_prompt: str, skill_name: str) -> str:
    body = load_skill(skill_name)
    if not body:
        return base_prompt
    return base_prompt.rstrip() + "\n\n---\n## attached skill\n\n" + body
