"""YAML skill-pack registry with vectorless lexical ranking."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

PACK_IDS = (
    "contact-entity-extraction",
    "contact-identity-resolution",
    "contact-create",
    "queue-create",
    "queue-update",
    "queue-staff",
    "queue-delete",
    "performance-analytics",
    "dashboard-analytics",
)


class SkillRegistry:
    def __init__(self, packs_dir: Path | None = None) -> None:
        self.packs_dir = packs_dir or Path(__file__).parent / "packs"
        self.skills: dict[str, dict[str, Any]] = {}
        self.metrics: dict[str, dict[str, Any]] = {}
        self.schemas: dict[str, dict[str, Any]] = {}
        self.reload()

    def reload(self) -> None:
        self.skills.clear()
        self.metrics.clear()
        self.schemas.clear()
        if not self.packs_dir.exists():
            return
        pack_dirs = sorted(
            path
            for path in self.packs_dir.iterdir()
            if path.is_dir() and (path / "skill.yaml").is_file()
        )
        for pack_dir in pack_dirs:
            pack_id = pack_dir.name
            skill_file = pack_dir / "skill.yaml"
            with skill_file.open(encoding="utf-8") as handle:
                data = yaml.safe_load(handle) or {}
            if not isinstance(data, dict):
                continue
            skill_id = str(data.get("id") or pack_id)
            if skill_id != pack_id:
                raise ValueError(f"Skill pack id mismatch: {pack_id} != {skill_id}")
            self.skills[skill_id] = {**data, "pack_dir": str(pack_dir)}
            self._load_references(skill_id, pack_dir)

    def _load_references(self, skill_id: str, pack_dir: Path) -> None:
        references_dir = pack_dir / "references"
        metrics_file = references_dir / "metrics.yaml"
        schema_file = references_dir / "schema-conversations.yaml"
        if metrics_file.exists():
            with metrics_file.open(encoding="utf-8") as handle:
                payload = yaml.safe_load(handle) or {}
            if isinstance(payload, dict):
                self.metrics[skill_id] = payload
        if schema_file.exists():
            with schema_file.open(encoding="utf-8") as handle:
                payload = yaml.safe_load(handle) or {}
            if isinstance(payload, dict):
                self.schemas[skill_id] = payload

    def _tokens(self, text: str) -> list[str]:
        normalized = re.sub(r"[^a-z0-9]+", " ", text.casefold())
        return [token for token in normalized.split() if len(token) > 1]

    def _score_skill(self, skill: dict[str, Any], query: str) -> float:
        normalized_query = query.casefold().strip()
        skill_id = str(skill.get("id", ""))
        name = str(skill.get("name", ""))
        description = str(skill.get("description", ""))
        triggers = [str(item) for item in skill.get("triggers", [])]
        score = 0.0
        if normalized_query == skill_id.casefold():
            score += 20.0
        if normalized_query == name.casefold():
            score += 15.0
        for token in self._tokens(query):
            if token in skill_id.casefold():
                score += 5.0
            if token in name.casefold():
                score += 4.0
            if token in description.casefold():
                score += 2.0
            for trigger in triggers:
                if token in trigger.casefold():
                    score += 3.0
        return score

    def _summary(self, skill: dict[str, Any], score: float | None = None) -> dict[str, Any]:
        summary: dict[str, Any] = {
            "id": str(skill["id"]),
            "name": str(skill.get("name") or skill["id"]),
            "description": str(skill.get("description") or "").strip(),
        }
        if score is not None:
            summary["score"] = round(score, 3)
        return summary

    def list_skills(
        self,
        query: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        if not query or not query.strip():
            return [self._summary(skill) for skill in self.skills.values()][:limit]
        scored: list[tuple[float, dict[str, Any]]] = []
        for skill in self.skills.values():
            score = self._score_skill(skill, query)
            if score > 0:
                scored.append((score, skill))
        scored.sort(key=lambda item: (-item[0], str(item[1]["id"])))
        return [self._summary(skill, score) for score, skill in scored[:limit]]

    def get_skill(self, skill_id: str) -> dict[str, Any] | None:
        skill = self.skills.get(skill_id)
        if skill is None:
            return None
        payload = dict(skill)
        payload.pop("pack_dir", None)
        payload["metric_ids"] = self.list_metric_ids(skill_id)
        return payload

    def list_metric_ids(self, skill_id: str) -> list[str]:
        payload = self.metrics.get(skill_id, {})
        return [
            str(metric["id"])
            for metric in payload.get("metrics", [])
            if isinstance(metric, dict) and metric.get("id")
        ]

    def get_metrics_pack(self, skill_id: str) -> dict[str, Any]:
        return dict(self.metrics.get(skill_id, {}))

    def get_schema(self, skill_id: str) -> dict[str, Any] | None:
        schema = self.schemas.get(skill_id)
        return dict(schema) if schema is not None else None


_global_registry: SkillRegistry | None = None


def get_skill_registry() -> SkillRegistry:
    global _global_registry
    if _global_registry is None:
        _global_registry = SkillRegistry()
    return _global_registry
