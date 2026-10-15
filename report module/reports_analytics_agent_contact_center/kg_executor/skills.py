"""KG skill pack. Attach when Domain set executor kg. Never keyword-match the question."""

from __future__ import annotations

from pathlib import Path
from typing import Any

LOCAL_SKILLS_DIR = Path(__file__).resolve().parent / "skills"
PACK_DIR = Path(__file__).resolve().parent.parent
FALLBACK_SKILLS_DIR = PACK_DIR / "skills" / "kg"

SKILL_NAME = "analytics-graph-path"

SKILL_FILE_MAP = {
    "root-cause-4step-traversal": "root_cause_4step_traversal.md",
    "telemetry-ground-truth-protocol": "telemetry_ground_truth_protocol.md",
    "hierarchical-duration-engine": "hierarchical_duration_engine.md",
    "error-recovery-and-guardrails": "error_recovery_and_guardrails.md",
    "analytics-graph-path": "analytics_graph_path.md",
    "analytics-predictive-risk-modeling": "analytics_predictive_risk_modeling.md",
    "analytics-prescriptive-action-targeting": "analytics_prescriptive_action_targeting.md",
}


def load_skill(name: str = SKILL_NAME) -> str:
    # 1. Check local skills directory
    if LOCAL_SKILLS_DIR.is_dir():
        filename = SKILL_FILE_MAP.get(name, f"{name.replace('-', '_')}.md")
        local_file = LOCAL_SKILLS_DIR / filename
        if local_file.is_file():
            return local_file.read_text(encoding="utf-8")
        
        # Check subfolder SKILL.md
        subfolder_file = LOCAL_SKILLS_DIR / name / "SKILL.md"
        if subfolder_file.is_file():
            return subfolder_file.read_text(encoding="utf-8")

    # 2. Check fallback root skills
    if FALLBACK_SKILLS_DIR.is_dir():
        fallback_file = FALLBACK_SKILLS_DIR / name / "SKILL.md"
        if fallback_file.is_file():
            return fallback_file.read_text(encoding="utf-8")

    return ""


def catalog() -> list[dict[str, str]]:
    results = []
    for skill_k in SKILL_FILE_MAP:
        content = load_skill(skill_k)
        desc = skill_k
        if content:
            for line in content.splitlines():
                if line.startswith("# Skill:"):
                    desc = line.replace("# Skill:", "").strip(" `")
                    break
                elif line.startswith("## Role & Description") or line.startswith("## Purpose"):
                    continue
                elif line.strip() and not line.startswith("#"):
                    desc = line.strip()
                    break
        results.append({"name": skill_k, "description": desc})
    return results if results else [{"name": SKILL_NAME, "description": "Graph traversal"}]


def catalog_block() -> str:
    rows = catalog()
    lines = ["## KG skills (use only when executor is kg)"]
    for row in rows:
        lines.append(f"- `{row['name']}`: {row['description']}")
    return "\n".join(lines)


def skill_for_task(task: dict[str, Any] | None = None) -> str:
    task = task or {}
    explicit = str(task.get("skill") or "").strip()
    if explicit in SKILL_FILE_MAP:
        return explicit
    return SKILL_NAME


def compose_with_skill(base_prompt: str, skill_name: str = SKILL_NAME) -> str:
    body = load_skill(skill_name)
    if not body:
        return base_prompt
    return base_prompt.rstrip() + "\n\n---\n## attached skill\n\n" + body
