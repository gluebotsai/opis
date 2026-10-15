#!/usr/bin/env python3
"""Regenerate ontology/graph_nodes.yml from KG core.yaml + definitions/entities.yml."""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    raise SystemExit("PyYAML required") from None

ROOT = Path(__file__).resolve().parent.parent
KG_CORE = ROOT / "Knowledge_Graph_Pipeline" / "config" / "mappings" / "core.yaml"
ENTITIES = ROOT / "ontology" / "definitions" / "entities.yml"
OUT = ROOT / "ontology" / "graph_nodes.yml"

# Legacy label cleanup when reading old edges embedded in comments — canonical = itself
CANONICAL = {
    "SupportCase": "Ticket",
    "CaseNote": "Note",
    "SupportAccount": "ContactAccount",
    "SupportQueue": "Queue",
    "SupportProfile": "Contact",
    "StaffRole": "Agent",
    "ServiceLevelPolicy": "SLA",
    "CannedReply": "Macro",
    "EmailThreadRef": "InboundEmail",
    "EmailDispatchRecord": "OutboundEmail",
    "WorkflowRule": "AutomationRule",
    "AuditRecord": "AuditLog",
    "ProactiveSuggestion": "Suggestion",
    "ActionApproval": "Approval",
    "Opportunity": "Deal",
    "WebVisitor": "Visitor",
    "BehaviourEvent": "Event",
    "MessageDelivery": "Message",
    "WorkTask": "Task",
    "AudienceSegment": "Segment",
    "TrackedSite": "Website",
    "ServiceQueue": "Queue",
    "AssistantSession": "ChatSession",
    "AssistantWorkflowEvent": "ChatWorkflowEvent",
}


def _canon(label: str) -> str:
    return CANONICAL.get(label, label)


def _rel_target(rel: dict) -> tuple[str, str]:
    if "to" in rel:
        return _canon(str(rel["to"])), rel.get("type", "")
    if "from" in rel:
        return _canon(str(rel["from"])), rel.get("type", "")
    return "", rel.get("type", "")


def _rel_direction(rel: dict, from_label: str) -> tuple[str, str, str]:
    rtype = str(rel.get("type") or "")
    if "to" in rel:
        return from_label, rtype, _canon(str(rel["to"]))
    if "from" in rel:
        return _canon(str(rel["from"])), rtype, from_label
    return from_label, rtype, ""


def main() -> int:
    core = yaml.safe_load(KG_CORE.read_text(encoding="utf-8")) or {}
    tables = core.get("tables") or {}
    entities_doc = yaml.safe_load(ENTITIES.read_text(encoding="utf-8")) or {} if ENTITIES.exists() else {}

    nodes: dict[str, dict] = {}
    edges: list[dict[str, str]] = []
    seen_edges: set[tuple[str, str, str]] = set()

    for table, spec in tables.items():
        if not isinstance(spec, dict):
            continue
        mode = spec.get("mode", "node")
        if mode not in ("node",):
            continue
        label = spec.get("label") or spec.get("merges_into")
        if not label:
            continue
        label = _canon(str(label))
        key = label
        agent_id = spec.get("agent_id")
        if agent_id:
            key = str(agent_id).removeprefix("wt:")
        product = spec.get("product") or ""
        key_field = spec.get("key", "id")
        identifier = f"{table}.{key_field}"
        entry = {
            "label": label,
            "identifier": identifier,
            "table": table,
            "product": product,
        }
        if agent_id:
            entry["agent_id"] = str(agent_id).removeprefix("wt:")
        readable = spec.get("readable_by")
        if readable:
            entry["readable_by"] = readable
        nodes[key] = entry

        for rel in spec.get("relationships") or []:
            if not isinstance(rel, dict):
                continue
            fr, rtype, to = _rel_direction(rel, label)
            if not fr or not to or not rtype:
                continue
            sig = (fr, rtype, to)
            if sig in seen_edges:
                continue
            seen_edges.add(sig)
            edges.append({"from": fr, "type": rtype, "to": to})

    # class alias: ontology id -> graph label (identity when aligned)
    class_aliases: dict[str, str] = {}
    for key, node in nodes.items():
        class_aliases[key] = str(node["label"])
        aid = node.get("agent_id")
        if aid:
            class_aliases[str(aid)] = str(node["label"])

    # definitions from entities.yml + graph label keys
    definitions: dict[str, str] = {}
    for eid, spec in (entities_doc.get("entities") or {}).items():
        if not isinstance(spec, dict):
            continue
        gl = spec.get("graph_label") or eid
        if spec.get("definition"):
            definitions[str(gl)] = str(spec["definition"])
    for label in {n["label"] for n in nodes.values()}:
        if label not in definitions:
            definitions[label] = f"{label} entity in the knowledge graph."

    doc = {
        "version": "2026.09.2",
        "source": "Knowledge_Graph_Pipeline/config/mappings/core.yaml tables:",
        "nodes": nodes,
        "edges": edges,
        "class_aliases": class_aliases,
        "definitions": definitions,
    }
    OUT.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
    print(f"wrote {OUT} ({len(nodes)} nodes, {len(edges)} edges)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
