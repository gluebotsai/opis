"""Loader for CCaaS ontology registry, rules, Cypher templates, and few-shot examples."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
ONTOLOGY_DIR = REPO_ROOT / "ontology"


def _read_yaml(file_path: Path) -> dict[str, Any]:
    if not file_path.exists():
        return {}
    with open(file_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@lru_cache(maxsize=1)
def load_agent_prompt() -> str:
    """Load system prompt from agent.md."""
    path = REPO_ROOT / "agent.md"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


@lru_cache(maxsize=1)
def load_schema_registry() -> dict[str, Any]:
    """Load CCaaS ontology schema registry."""
    path = ONTOLOGY_DIR / "schema_registry.json"
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def load_templates() -> dict[str, Any]:
    """Load certified Cypher templates."""
    return _read_yaml(ONTOLOGY_DIR / "templates.yml")


@lru_cache(maxsize=1)
def load_rules() -> dict[str, Any]:
    """Load ontological rules."""
    return _read_yaml(ONTOLOGY_DIR / "rules.yml")


@lru_cache(maxsize=1)
def load_few_shots() -> str:
    """Load worked Cypher few-shot examples."""
    path = ONTOLOGY_DIR / "examples" / "cypher.yml"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


@lru_cache(maxsize=1)
def get_templates_summary() -> str:
    """Format certified Cypher templates for LLM prompt."""
    data = load_templates().get("templates", {})
    lines = ["## Certified Cypher Templates:"]
    for t_id, meta in data.items():
        desc = meta.get("description", "")
        params = ", ".join(meta.get("parameters", []))
        lines.append(f"- `{t_id}`: {desc} (Parameters: {params or 'none'})")
    return "\n".join(lines)


@lru_cache(maxsize=1)
def get_schema_summary() -> str:
    """Format node labels, properties, and relationships for LLM prompt."""
    reg = load_schema_registry()
    lines = ["## Ontological Knowledge Graph Schema (CCaaS):"]

    labels = reg.get("labels", []) or reg.get("allowed_node_labels", [])
    lines.append(f"- Allowed Node Labels: {', '.join(labels)}")

    props = reg.get("properties", {}) or reg.get("node_properties", {})
    for node, p_list in props.items():
        lines.append(f"  * {node}: {', '.join(p_list)}")

    rels = reg.get("relationships", []) or reg.get("allowed_relationships", [])
    lines.append(f"- Allowed Relationships: {', '.join(rels)}")
    return "\n".join(lines)
