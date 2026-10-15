#!/usr/bin/env python3
"""Generate ontology_base.json from core.yaml + crm yaml schema files."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

try:
    import yaml
except ImportError:
    print("PyYAML required: pip install pyyaml", file=sys.stderr)
    sys.exit(1)


LABEL_META: dict[str, dict] = {
    "Tenant": {"category": "Organization", "description": "Root organization that owns the contact center and CRM platform", "synonyms": ["organization", "company", "enterprise"]},
    "Role": {"category": "Access Control", "description": "Defined function determining user permissions", "synonyms": ["user role", "permission set"]},
    "Team": {"category": "Organization", "description": "Group of agents sharing responsibilities", "synonyms": ["department", "work group"]},
    "User": {"category": "User Management", "description": "Internal employee of a Tenant (distinct from Contact/customer)", "synonyms": ["employee", "staff member"]},
    "HolidayCalendar": {"category": "Scheduling", "description": "Holidays and non-working days", "synonyms": []},
    "BusinessHours": {"category": "Scheduling", "description": "Operating hours for queues and teams", "synonyms": []},
    "Channel": {"category": "Communication", "description": "Communication medium (voice, chat, email, etc.)", "synonyms": []},
    "Agent": {"category": "Service Delivery", "description": "Customer service rep identity linked to User via IS_AGENT_FOR", "synonyms": ["support agent", "CSR"]},
    "Skill": {"category": "Service Delivery", "description": "Agent capability for routing", "synonyms": []},
    "Queue": {"category": "Routing", "description": "Waiting area for interactions before agent assignment", "synonyms": []},
    "RoutingPolicy": {"category": "Routing", "description": "Rules for distributing interactions to agents", "synonyms": []},
    "Disposition": {"category": "Analytics", "description": "Outcome code for completed interactions", "synonyms": []},
    "SLA": {"category": "Compliance", "description": "Service level agreement policy", "synonyms": []},
    "ChannelAutomationPolicy": {"category": "Automation", "description": "Bot/automation rules per channel", "synonyms": []},
    "Conversation": {"category": "Interaction", "description": "Single customer interaction thread; key node key is id", "synonyms": ["interaction", "ticket", "case"]},
    "ConversationSummary": {"category": "Interaction", "description": "AI or manual summary of a conversation", "synonyms": []},
    "SLAInstance": {"category": "Compliance", "description": "Active SLA tracking for a conversation; use breached_at for breaches", "synonyms": []},
    "Attachment": {"category": "Content", "description": "File attached to a conversation", "synonyms": []},
    "WorkNote": {"category": "Content", "description": "Internal agent note on a conversation", "synonyms": []},
    "ConversationParticipant": {"category": "Interaction", "description": "Person involved in a conversation", "synonyms": []},
    "Assignment": {"category": "Routing", "description": "Offer of conversation to agent; tracks offered_at, accepted_at, rejected_at, expired_at", "synonyms": []},
    "Transfer": {"category": "Routing", "description": "Movement of conversation between queues/agents", "synonyms": []},
    "RoutingAttempt": {"category": "Routing", "description": "Single routing attempt; use outcome and created_at for missed-contact metrics", "synonyms": []},
    "WebchatSession": {"category": "Channel", "description": "Web chat session linked to conversation", "synonyms": []},
    "Task": {"category": "Work Management", "description": "Work item assigned to user", "synonyms": []},
    "SharedNote": {"category": "Content", "description": "Collaborative note for workspace", "synonyms": []},
    "Contact": {"category": "Customer", "description": "Customer/prospect person; primary key is cdp_id (NOT id)", "synonyms": ["customer", "prospect", "lead", "client"]},
    "ContactPoint": {"category": "Customer", "description": "Communication endpoint (email, phone) for a contact", "synonyms": ["email address", "phone number"]},
    "CustomerScore": {"category": "Analytics", "description": "Engagement, churn, loyalty scores for a contact", "synonyms": []},
    "Insight": {"category": "Analytics", "description": "AI-derived insight for a contact", "synonyms": []},
    "Recommendation": {"category": "Analytics", "description": "Next-best-action recommendation for contact", "synonyms": []},
    "Segment": {"category": "Marketing", "description": "Customer segment grouping", "synonyms": []},
    "Order": {"category": "Commerce", "description": "CDP commerce order; Contact-[:PLACED]->Order", "synonyms": ["purchase", "transaction"]},
    "Offering": {"category": "Commerce", "description": "Product/service catalog item (same as CRM Product label)", "synonyms": ["product", "SKU"]},
    "Product": {"category": "Commerce", "description": "CRM catalog product; alias for Offering node in inventory", "synonyms": ["offering", "SKU"]},
    "Company": {"category": "Sales", "description": "B2B account organization; maps to Account in CRM speak", "synonyms": ["account", "organization", "firm"]},
    "CompanySite": {"category": "Sales", "description": "Branch or location of a company", "synonyms": ["office", "branch"]},
    "ContactProfile": {"category": "Sales", "description": "CRM overlay on Contact with lead_status, pipeline fields", "synonyms": ["lead profile", "CRM contact"]},
    "Deal": {"category": "Sales", "description": "Sales opportunity with stage and amount", "synonyms": ["opportunity", "pipeline deal"]},
    "DealActivity": {"category": "Sales", "description": "Activity logged against a deal", "synonyms": []},
    "ContactActivity": {"category": "Activity", "description": "Email, call, meeting activity for a contact", "synonyms": ["engagement", "touchpoint"]},
    "Proposal": {"category": "Sales", "description": "Formal proposal document for a deal", "synonyms": []},
    "Quote": {"category": "Sales", "description": "Price quotation for a deal", "synonyms": ["quotation", "estimate"]},
    "SalesOrder": {"category": "Sales", "description": "CRM commercial order; SalesOrder-[:PLACED_BY]->Contact", "synonyms": ["sales order", "SO"]},
    "Invoice": {"category": "Finance", "description": "Billing invoice issued to company", "synonyms": ["bill"]},
    "Contract": {"category": "Finance", "description": "Commercial contract with company", "synonyms": []},
    "LeadSummary": {"category": "Sales", "description": "AI summary for a lead contact", "synonyms": []},
    "LeadEnrichmentSnapshot": {"category": "Sales", "description": "Enrichment data snapshot for a lead", "synonyms": []},
    "OrgProfile": {"category": "Organization", "description": "Tenant vertical configuration profile", "synonyms": []},
}



def _normalize_prop(p) -> str:
    if isinstance(p, str):
        return p
    if isinstance(p, dict):
        return p.get("name", "")
    return ""



def _load_tables(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.name.startswith("crm"):
        # CRM file is a fragment: indented tables without top-level `tables:` key
        lines = text.splitlines()
        body_lines = []
        for line in lines:
            if line.strip().startswith("#") or not line.strip():
                continue
            body_lines.append(line)
        text = "tables:\n" + "\n".join(body_lines)
    data = yaml.safe_load(text)
    return data.get("tables") or {}


def _parse_schema(tables: dict) -> tuple[dict, list]:
    labels: dict[str, dict] = {}
    relationships: list[dict] = []
    seen_rels: set[str] = set()

    for _table_id, spec in tables.items():
        if not isinstance(spec, dict):
            continue
        mode = spec.get("mode", "node")

        if mode == "relationship_only":
            from_label = spec["from_label"]
            to_label = spec["to_label"]
            rel_type = spec["type"]
            rel_id = f"rel_{rel_type.lower()}"
            if rel_id not in seen_rels:
                seen_rels.add(rel_id)
                relationships.append({
                    "type": rel_type,
                    "from_label": from_label,
                    "to_label": to_label,
                    "pattern": f"({from_label})-[:{rel_type}]->({to_label})",
                })
            continue

        label = spec.get("label")
        if not label:
            continue
        key = spec.get("key", "id")
        props = [_normalize_prop(p) for p in spec.get("properties", [])]
        props = [p for p in props if p]

        if label not in labels:
            labels[label] = {"key": key, "properties": props, "relationships_out": [], "relationships_in": []}

        for rel in spec.get("relationships") or []:
            rel_type = rel["type"]
            direction = rel.get("direction", "out")
            target = rel["target_label"]
            if direction == "out":
                labels[label]["relationships_out"].append({"type": rel_type, "to": target})
                pattern = f"({label})-[:{rel_type}]->({target})"
            else:
                labels[label]["relationships_in"].append({"type": rel_type, "from": target})
                pattern = f"({target})-[:{rel_type}]->({label})"
            rel_id = f"rel_{rel_type.lower()}_{label}_{target}"
            if rel_id not in seen_rels:
                seen_rels.add(rel_id)
                relationships.append({
                    "type": rel_type,
                    "from_label": target if direction == "in" else label,
                    "to_label": label if direction == "in" else target,
                    "pattern": pattern,
                })

    return labels, relationships


def _build_label_doc(label: str, info: dict) -> dict:
    meta = LABEL_META.get(label, {})
    rels_out = info.get("relationships_out", [])
    rels_in = info.get("relationships_in", [])
    rel_summary = ", ".join(
        f"[:{r['type']}]->{r['to']}" for r in rels_out[:8]
    )
    desc = meta.get("description", f"Graph node label {label}")
    if info.get("key") and info["key"] != "id":
        desc += f"; primary key property: {info['key']}"
    search_text = f"{label} node. {desc}. Outgoing: {rel_summary}" if rel_summary else f"{label} node. {desc}"
    return {
        "id": f"label_{label.lower()}",
        "type": "node_label",
        "name": label,
        "description": desc,
        "category": meta.get("category", "Graph"),
        "key_property": info.get("key", "id"),
        "properties": info.get("properties", [])[:20],
        "relationships_out": rels_out,
        "relationships_in": rels_in,
        "synonyms": meta.get("synonyms", []),
        "search_text": search_text,
        "domain": "core",
    }


def _build_rel_doc(rel: dict) -> dict:
    rel_type = rel["type"]
    from_l = rel["from_label"]
    to_l = rel["to_label"]
    pattern = rel["pattern"]
    desc = f"{from_l} connected to {to_l} via {rel_type}"
    return {
        "id": f"rel_{rel_type.lower()}_{from_l.lower()}_{to_l.lower()}",
        "type": "relationship",
        "name": rel_type,
        "description": desc,
        "from_label": from_l,
        "to_label": to_l,
        "pattern": pattern,
        "synonyms": [],
        "search_text": f"{rel_type} relationship {pattern}. {desc}",
        "domain": "core",
    }


def generate() -> list[dict]:
    core_tables = _load_tables(ROOT / "core.yaml")
    crm_tables = _load_tables(ROOT / "crm (1).yaml")
    merged = {**core_tables, **crm_tables}
    labels, relationships = _parse_schema(merged)

    docs: list[dict] = []
    for label in sorted(labels.keys()):
        docs.append(_build_label_doc(label, labels[label]))

    # Deduplicate relationships by type+pattern for index (keep unique patterns)
    seen_patterns: set[str] = set()
    for rel in sorted(relationships, key=lambda r: (r["type"], r["pattern"])):
        if rel["pattern"] in seen_patterns:
            continue
        seen_patterns.add(rel["pattern"])
        docs.append(_build_rel_doc(rel))

    return docs


def build_registry(labels: dict, relationships: list[dict]) -> dict:
    label_set = set(labels.keys())
    label_set.add("Product")  # core.yaml stub; CRM references Product alongside Offering
    rel_set = {rel["type"] for rel in relationships}
    prop_set: set[str] = set()
    for info in labels.values():
        prop_set.update(info.get("properties") or [])
    return {
        "labels": sorted(label_set),
        "relationships": sorted(rel_set),
        "properties": sorted(prop_set),
    }


def main():
    out_dir = ROOT / "ontology"
    out_dir.mkdir(exist_ok=True)
    core_tables = _load_tables(ROOT / "core.yaml")
    crm_tables = _load_tables(ROOT / "crm (1).yaml")
    merged = {**core_tables, **crm_tables}
    labels, relationships = _parse_schema(merged)

    docs = []
    for label in sorted(labels.keys()):
        docs.append(_build_label_doc(label, labels[label]))
    seen_patterns: set[str] = set()
    for rel in sorted(relationships, key=lambda r: (r["type"], r["pattern"])):
        if rel["pattern"] in seen_patterns:
            continue
        seen_patterns.add(rel["pattern"])
        docs.append(_build_rel_doc(rel))

    out_path = out_dir / "ontology_base.json"
    out_path.write_text(json.dumps(docs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(docs)} ontology documents to {out_path}")

    registry = build_registry(labels, relationships)
    registry_path = out_dir / "schema_registry.json"
    registry_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")
    print(
        f"Wrote schema registry to {registry_path} "
        f"({len(registry['labels'])} labels, {len(registry['relationships'])} relationships, "
        f"{len(registry['properties'])} properties)"
    )


if __name__ == "__main__":
    main()
