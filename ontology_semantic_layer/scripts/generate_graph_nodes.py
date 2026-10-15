#!/usr/bin/env python3
"""Regenerate ontology/graph_nodes.yml from docs/existing_ontology_yamls/core.yaml tables:."""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML required: pip install pyyaml") from exc

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "docs/existing_ontology_yamls/core.yaml"
OUT = ROOT / "ontology/graph_nodes.yml"

PRODUCT_MAP = {
    "contact-center": "contact_centre",
    "ccaas": "contact_centre",
    "web-tracking": "webtracking",
}

CLASS_ALIASES = {
    "wt:Employee": "StaffRole",
    "wt:Team": "Team",
    "wt:TicketNote": "CaseNote",
    "wt:SLA": "ServiceLevelPolicy",
    "wt:Macro": "CannedReply",
    "wt:TicketPriorityDef": "ServiceLevelPolicy",
    "wt:TicketStatusDef": "CaseStatus",
    "wt:KnowledgeArticle": "KnowledgeArticle",
    "wt:KbCategory": "KnowledgeArticle",
    "wt:Interaction": "Conversation",
    "wt:Conversation": "Conversation",
    "wt:Queue": "SupportQueue",
    "wt:Contact": "Contact",
    "wt:CustomerProfile": "SupportProfile",
    "wt:Identity": "ContactIdentity",
    "wt:IdentityKey": "ContactIdentity",
    "wt:Account": "Account",
    "wt:Deal": "Opportunity",
    "wt:Quote": "Quote",
    "wt:Proposal": "Proposal",
    "wt:Campaign": "Campaign",
    "wt:AudienceSegment": "AudienceSegment",
    "wt:Anomaly": "AnomalySignal",
    "wt:PerformanceReport": "SupportSnapshot",
    "wt:Appointment": "Meeting",
    "wt:LeadScore": "ContactScorecard",
    "wt:CrmActivity": "EngagementActivity",
    "wt:Meeting": "Meeting",
    "wt:MeetingTranscript": "TranscriptSegment",
    "wt:Task": "WorkTask",
    "wt:Callback": "MissedEngagement",
    "wt:Sentiment": "ContactInsight",
    "wt:QualityScore": "PerformanceMetric",
    "wt:Suppression": "SuppressedAddress",
    "wt:CustomerEvent": "BehaviourEvent",
    "wt:Intent": "IntentRoutingProfile",
    "wt:Disposition": "OutcomeRecord",
    "wt:WrapUp": "OutcomeRecord",
    "wt:RecordingPolicy": "ServiceLevelPolicy",
    "wt:ComplianceViolation": "AuditRecord",
    "wt:Organization": "Tenant",
    "wt:Channel": "ChannelAccount",
    "wt:Customer": "Contact",
    "wt:Ticket": "SupportCase",
    "wt:Consent": "Contact",
    "wt:Preference": "Contact",
    "wt:Location": "AccountSite",
    "wt:Party": "Contact",
    "wt:Person": "Contact",
    "wt:Event": "BehaviourEvent",
    "wt:WorkItem": "SupportCase",
    "wt:Contract": "Contract",
    "wt:QuoteLine": "LineItem",
    "wt:ContactDraft": "Contact",
    "wt:ContactSkill": "Skill",
    "wt:TicketDraft": "SupportCase",
    "wt:Spoke": "PlatformModule",
    "wt:Skill": "Skill",
    "wt:HubRequest": "Contact",
    "wt:OrganizationDirectory": "ExtractedBusinessProfile",
    "wt:ProactiveRecommendation": "ProactiveSuggestion",
    "wt:AsgaDecision": "ProactiveDecision",
}


def main() -> int:
    from ontology.graph_definitions import GRAPH_DEFINITIONS

    existing_defs: dict[str, str] = {}
    if OUT.exists():
        prior = yaml.safe_load(OUT.read_text(encoding="utf-8")) or {}
        existing_defs = dict(prior.get("definitions") or {})

    data = yaml.safe_load(CORE.read_text(encoding="utf-8"))
    tables = data.get("tables") or {}
    nodes: dict[str, dict] = {}
    edges: list[dict[str, str]] = []

    for table_name, spec in tables.items():
        if not isinstance(spec, dict):
            continue
        if spec.get("mode") == "relationship_only":
            fr = spec.get("from") or {}
            to = spec.get("to") or {}
            if spec.get("type") and fr.get("label") and to.get("label"):
                edges.append(
                    {
                        "from": fr["label"],
                        "type": spec["type"],
                        "to": to["label"],
                    }
                )
            continue
        label = spec.get("label")
        if not label:
            continue
        if spec.get("merges_into") and not spec.get("agent_id"):
            continue
        key_col = spec.get("key") or "id"
        product = spec.get("product") or "platform"
        entry = {
            "label": label,
            "identifier": f"{table_name}.{key_col}",
            "table": table_name,
            "product": PRODUCT_MAP.get(product, product),
        }
        if spec.get("readable_by"):
            entry["readable_by"] = [
                PRODUCT_MAP.get(p, p) for p in spec["readable_by"]
            ]
        if spec.get("agent_id"):
            entry["agent_id"] = spec["agent_id"]
        node_key = spec.get("agent_id") or label
        nodes[node_key] = entry
        for rel in spec.get("relationships") or []:
            if not isinstance(rel, dict) or not rel.get("type"):
                continue
            fr = rel.get("from") or label
            to = rel.get("to")
            if fr and to:
                edges.append({"from": fr, "type": rel["type"], "to": to})

    seen: set[tuple[str, str, str]] = set()
    deduped: list[dict[str, str]] = []
    for edge in edges:
        key = (edge["from"], edge["type"], edge["to"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(edge)

    labels = sorted({str(n.get("label")) for n in nodes.values()})
    definitions = dict(GRAPH_DEFINITIONS)
    definitions.update(existing_defs)
    for label in labels:
        definitions.setdefault(label, GRAPH_DEFINITIONS.get(label, ""))

    out = {
        "version": "2026.09.1",
        "source": "docs/existing_ontology_yamls/core.yaml tables:",
        "nodes": nodes,
        "edges": deduped,
        "definitions": {k: definitions[k] for k in sorted(labels) if definitions.get(k)},
        "class_aliases": CLASS_ALIASES,
    }
    OUT.write_text(
        yaml.dump(out, sort_keys=False, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )
    print(f"Wrote {OUT} ({len(nodes)} nodes, {len(deduped)} edges, {len(out['definitions'])} defs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
