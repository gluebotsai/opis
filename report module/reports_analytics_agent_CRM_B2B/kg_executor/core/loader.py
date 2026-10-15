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


import sys

_parent_root = str(REPO_ROOT.parent)
if _parent_root not in sys.path:
    sys.path.insert(0, _parent_root)


@lru_cache(maxsize=1)
def load_agent_prompt() -> str:
    """Planner: kg_executor/agent.md plus skills listed there (not briefing)."""
    try:
        from core.prompt_load import load_agent_prompt as compose
    except ImportError:
        try:
            from reports_analytics_agent_CRM_B2B.core.prompt_load import load_agent_prompt as compose
        except ImportError:
            compose = None

    path = REPO_ROOT / "agent.md"
    if path.exists():
        if compose is not None:
            try:
                return compose(path)
            except Exception:
                pass
        return path.read_text(encoding="utf-8").strip()
    return "You are the Autonomous Knowledge Graph Reporting & Analytics Agent for B2B CRM."


@lru_cache(maxsize=1)
def load_synthesis_prompt() -> str:
    """Graph notes for Domain: skills/crm-kg-briefing (not dumped into the planner)."""
    try:
        from core.prompt_load import skill_body
    except ImportError:
        try:
            from reports_analytics_agent_CRM_B2B.core.prompt_load import skill_body
        except ImportError:
            skill_body = None

    if skill_body is not None:
        try:
            return skill_body("crm-kg-briefing")
        except FileNotFoundError:
            pass

    path = REPO_ROOT / "agent.md"
    if path.exists():
        text = path.read_text(encoding="utf-8")
        if "# SECTION 2:" in text:
            return text.split("# SECTION 2:")[1].strip()
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

    # Clarify supported graph queries and strictly non-CRM exclusions
    unsupported = rules.get("unsupported_metrics_catalog", {})
    if unsupported:
        lines.append("\n## Excluded Non-CRM Metrics (Return unsupported_request ONLY if asked for these non-CRM items):")
        for m_name, m_info in unsupported.items():
            lines.append(f"- `{m_name}`: {m_info.get('reason')} (Missing: {', '.join(m_info.get('missing_inputs', []))})")

    lines.append(
        "\n## Core Graph Traversal Guidance:\n"
        "- All CRM entities in this schema (Deal, Contract, Invoice, Quote, Account, Contact, Activities, LineItems, Products, etc.) "
        "are fully queryable via dynamic Cypher when analyzing why outcomes occurred or exploring relationships.\n"
        "- If data is sparse or unlinked in the database (e.g. contracts without generated invoices), query the graph anyway "
        "so the system can report empirical facts and identify data gaps.\n"
        "- Do not return unsupported_request for unassigned contacts, activity mix, owner compare, quote status, or invoice status."
    )

    return "\n".join(lines)

