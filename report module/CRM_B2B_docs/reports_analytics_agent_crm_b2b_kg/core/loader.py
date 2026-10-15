"""Loader for CRM B2B ontology registry, rules, Cypher templates, and few-shot examples."""

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
    """Load query planner prompt from agent.md (Section 1)."""
    path = REPO_ROOT / "agent.md"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if content:
                if "# SECTION 2:" in content:
                    return content.split("# SECTION 2:")[0].strip()
                return content
    return "You are the Autonomous Knowledge Graph Reporting & Analytics Agent for B2B CRM."


@lru_cache(maxsize=1)
def load_synthesis_prompt() -> str:
    """Load executive synthesis prompt from agent.md (Section 2)."""
    path = REPO_ROOT / "agent.md"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if "# SECTION 2:" in content:
                return content.split("# SECTION 2:")[1].strip()
    return "You are a Senior Commercial Intelligence & Revenue Operations Specialist for B2B CRM."


@lru_cache(maxsize=1)
def load_schema_registry() -> dict[str, Any]:
    """Load CRM B2B ontology schema registry."""
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
    """Load ontological rules and unsupported metrics catalog."""
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
        lines.append(f"- `{t_id}`: {desc}")
    return "\n".join(lines)


@lru_cache(maxsize=1)
def get_schema_summary() -> str:
    """Format node labels, properties, relationships, and unsupported metrics for LLM prompt."""
    reg = load_schema_registry()
    rules = load_rules()
    lines = ["## Ontological Knowledge Graph Schema (CRM B2B):"]

    labels = reg.get("labels", []) or reg.get("allowed_node_labels", [])
    if labels:
        lines.append(f"- Allowed Node Labels: {', '.join(labels)}")

    props = reg.get("properties", {}) or reg.get("node_properties", {})
    for node, p_list in props.items():
        if isinstance(p_list, list):
            lines.append(f"  * {node}: {', '.join(p_list)}")
        elif isinstance(p_list, dict):
            lines.append(f"  * {node}: {', '.join(p_list.keys())}")

    rels = reg.get("relationships", []) or reg.get("allowed_relationships", [])
    if rels:
        if isinstance(rels[0], str):
            lines.append(f"- Allowed Relationships: {', '.join(rels)}")
        elif isinstance(rels[0], dict):
            rel_strs = [f"({r['source']})-[:{r['type']}]->({r['target']})" for r in rels]
            lines.append(f"- Allowed Relationships: {', '.join(rel_strs)}")

    # Add Unsupported metrics to summary so LLM refuses without guessing
    unsupported = rules.get("unsupported_metrics_catalog", {})
    if unsupported:
        lines.append("\n## Strictly Unsupported Metrics (Must return unsupported_request):")
        for m_name, m_info in unsupported.items():
            lines.append(f"- `{m_name}`: {m_info.get('reason')} (Missing: {', '.join(m_info.get('missing_inputs', []))})")

    return "\n".join(lines)
