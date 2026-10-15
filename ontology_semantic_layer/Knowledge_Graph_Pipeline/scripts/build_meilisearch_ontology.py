#!/usr/bin/env python3
"""Build Meilisearch ontology documents from core.yaml, noun_map.yml, and concept cards.

Aligns Knowledge Graph canonical labels (Opportunity, SupportCase, Contact, Account, Tenant)
with Agent compact vocabulary (wt:*), ensuring Meilisearch chunks are completely synchronized.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config" / "mappings"
ONTOLOGY_DIR = ROOT / "ontology"
ONTOLOGY_SERVICE_DIR = ROOT / "Ontology_tool_service"


def load_yaml(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def extract_schema_from_core(core_data: dict) -> tuple[dict, list]:
    tables = core_data.get("tables") or {}
    labels: dict[str, dict] = {}
    relationships: list[dict] = []
    seen_rels: set[str] = set()

    for table_name, spec in tables.items():
        if not isinstance(spec, dict):
            continue
        mode = spec.get("mode", "node")
        product = spec.get("product", "platform")
        agent_id = spec.get("agent_id")

        if mode == "relationship_only":
            from_l = spec.get("from_label") or (spec.get("from", {}).get("label") if isinstance(spec.get("from"), dict) else spec.get("from"))
            to_l = spec.get("to_label") or (spec.get("to", {}).get("label") if isinstance(spec.get("to"), dict) else spec.get("to"))
            rel_type = spec.get("type")
            if from_l and to_l and rel_type:
                rel_id = f"rel_{rel_type.lower()}_{from_l.lower()}_{to_l.lower()}"
                if rel_id not in seen_rels:
                    seen_rels.add(rel_id)
                    relationships.append({
                        "type": rel_type,
                        "from_label": from_l,
                        "to_label": to_l,
                        "pattern": f"({from_l})-[:{rel_type}]->({to_l})",
                        "product": product,
                    })
            continue

        label = spec.get("label")
        if not label:
            continue
        key = spec.get("key", "id")
        props = []
        for p in spec.get("properties", []):
            if isinstance(p, str):
                props.append(p)
            elif isinstance(p, dict):
                props.append(p.get("as") or p.get("name") or p.get("from", ""))
        props = [p for p in props if p]

        if label not in labels:
            labels[label] = {
                "key": key,
                "properties": props,
                "relationships_out": [],
                "relationships_in": [],
                "product": product,
                "agent_id": agent_id,
                "table": table_name,
            }
        else:
            # Merge properties for multi-source labels
            for p in props:
                if p not in labels[label]["properties"]:
                    labels[label]["properties"].append(p)
            if agent_id and not labels[label].get("agent_id"):
                labels[label]["agent_id"] = agent_id

        for rel in spec.get("relationships") or []:
            rel_type = rel.get("type")
            target = rel.get("to") or rel.get("target_label")
            source = rel.get("from")
            
            if target and rel_type:
                labels[label]["relationships_out"].append({"type": rel_type, "to": target})
                pattern = f"({label})-[:{rel_type}]->({target})"
                rel_id = f"rel_{rel_type.lower()}_{label.lower()}_{target.lower()}"
                if rel_id not in seen_rels:
                    seen_rels.add(rel_id)
                    relationships.append({
                        "type": rel_type,
                        "from_label": label,
                        "to_label": target,
                        "pattern": pattern,
                        "product": product,
                    })
            elif source and rel_type:
                labels[label]["relationships_in"].append({"type": rel_type, "from": source})
                pattern = f"({source})-[:{rel_type}]->({label})"
                rel_id = f"rel_{rel_type.lower()}_{source.lower()}_{label.lower()}"
                if rel_id not in seen_rels:
                    seen_rels.add(rel_id)
                    relationships.append({
                        "type": rel_type,
                        "from_label": source,
                        "to_label": label,
                        "pattern": pattern,
                        "product": product,
                    })

    return labels, relationships


def build_node_docs(labels: dict, noun_map: dict) -> list[dict]:
    docs = []
    noun_mappings = noun_map.get("mappings", {})

    for label, info in sorted(labels.items()):
        noun_info = noun_mappings.get(label, {})
        agent_id = info.get("agent_id") or noun_info.get("agent_id", f"wt:{label}")
        display_names = noun_info.get("display_names", {})
        synonyms = list(display_names.values()) if isinstance(display_names, dict) else []
        
        rels_out = info.get("relationships_out", [])
        rels_in = info.get("relationships_in", [])
        rel_summary = ", ".join(f"[:{r['type']}]->{r['to']}" for r in rels_out[:8])
        
        desc = noun_info.get("description", f"Canonical Knowledge Graph node label {label}")
        if info.get("key") and info["key"] != "id":
            desc += f"; primary key property: {info['key']}"
        desc += f" (Agent ID: {agent_id})"

        search_parts = [
            f"{label} node.",
            desc,
            f"Agent vocabulary: {agent_id}.",
            f"Display aliases: {', '.join(synonyms)}." if synonyms else "",
            f"Outgoing: {rel_summary}." if rel_summary else ""
        ]
        search_text = " ".join(p for p in search_parts if p)

        docs.append({
            "id": f"label_{label.lower()}",
            "type": "node_label",
            "name": label,
            "agent_id": agent_id,
            "description": desc,
            "category": info.get("product", "platform"),
            "key_property": info.get("key", "id"),
            "properties": info.get("properties", []),
            "relationships_out": rels_out,
            "relationships_in": rels_in,
            "synonyms": synonyms,
            "search_text": search_text,
            "domain": info.get("product", "common"),
        })

    return docs


def build_rel_docs(relationships: list[dict]) -> list[dict]:
    docs = []
    seen = set()
    for rel in sorted(relationships, key=lambda r: (r["type"], r["pattern"])):
        if rel["pattern"] in seen:
            continue
        seen.add(rel["pattern"])
        rel_type = rel["type"]
        from_l = rel["from_label"]
        to_l = rel["to_label"]
        pattern = rel["pattern"]
        desc = f"{from_l} connects to {to_l} via {rel_type}"

        docs.append({
            "id": f"rel_{rel_type.lower()}_{from_l.lower()}_{to_l.lower()}",
            "type": "relationship",
            "name": rel_type,
            "description": desc,
            "from_label": from_l,
            "to_label": to_l,
            "pattern": pattern,
            "synonyms": [],
            "search_text": f"{rel_type} relationship {pattern}. {desc}",
            "domain": rel.get("product", "core"),
        })
    return docs


def update_concept_cards(cards: list[dict]) -> list[dict]:
    """Align concept cards with canonical KG labels and relationship paths."""
    label_replacements = {
        r"\bDeal\b": "Opportunity",
        r"\bCompany\b": "Account",
        r"\bUser\b": "Employee",
        r"\bTicket\b": "SupportCase",
        r"WITH_COMPANY": "WITH_ACCOUNT",
        r"FOR_COMPANY": "FOR_ACCOUNT",
        r"ISSUED_TO": "FOR_ACCOUNT",
        r"FOR_DEAL": "FOR_OPPORTUNITY",
        r"FROM_DEAL": "FROM_OPPORTUNITY",
        r"RENEWED_BY": "RENEWED_BY_OPPORTUNITY",
    }

    updated = []
    for card in cards:
        text = json.dumps(card)
        for pattern, replacement in label_replacements.items():
            text = re.sub(pattern, replacement, text)
        updated_card = json.loads(text)

        # Ensure search_text exists
        if not updated_card.get("search_text"):
            parts = [updated_card.get("name", ""), updated_card.get("description", "")]
            parts.extend(updated_card.get("aliases", []))
            parts.extend(updated_card.get("keywords", []))
            if updated_card.get("graph_mapping", {}).get("relationship_paths"):
                parts.extend(updated_card["graph_mapping"]["relationship_paths"])
            updated_card["search_text"] = " ".join(p for p in parts if p)

        updated.append(updated_card)
    return updated


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Build Meilisearch ontology documents")
    parser.add_argument("--dry-run", action="store_true", help="Validate inputs only; do not write files")
    args = parser.parse_args()

    print("Building canonical Meilisearch ontology documents...")
    core_path = CONFIG_DIR / "core.yaml"
    noun_map_path = ONTOLOGY_DIR / "noun_map.yml"
    if args.dry_run:
        if not core_path.exists():
            print(f"dry-run failed: missing {core_path}", file=sys.stderr)
            sys.exit(1)
        if not noun_map_path.exists():
            print(f"dry-run failed: missing {noun_map_path}", file=sys.stderr)
            sys.exit(1)
        print("dry-run ok: core.yaml and noun_map.yml present")
        return
    core_path = CONFIG_DIR / "core.yaml"
    noun_map_path = ONTOLOGY_DIR / "noun_map.yml"
    concept_cards_path = ONTOLOGY_DIR / "concept_cards.json"

    core_data = load_yaml(core_path)
    noun_map = load_yaml(noun_map_path)
    concept_cards = json.loads(concept_cards_path.read_text(encoding="utf-8")) if concept_cards_path.exists() else []

    labels, relationships = extract_schema_from_core(core_data)
    print(f"Extracted {len(labels)} node labels and {len(relationships)} relationships from core.yaml")

    node_docs = build_node_docs(labels, noun_map)
    rel_docs = build_rel_docs(relationships)
    updated_cards = update_concept_cards(concept_cards)

    # Save updated concept cards
    concept_cards_path.write_text(json.dumps(updated_cards, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Updated {len(updated_cards)} concept cards in {concept_cards_path}")

    # Build ontology_base.json
    ontology_base = node_docs + rel_docs
    base_out = ONTOLOGY_DIR / "ontology_base.json"
    base_out.write_text(json.dumps(ontology_base, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(ontology_base)} base ontology records to {base_out}")

    # Build schema_registry.json
    schema_registry = {
        "labels": sorted(labels.keys()),
        "relationships": sorted({r["type"] for r in relationships}),
        "properties": sorted({p for info in labels.values() for p in info.get("properties", [])}),
    }
    registry_out = ONTOLOGY_DIR / "schema_registry.json"
    registry_out.write_text(json.dumps(schema_registry, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote schema registry to {registry_out}")

    # Build consolidated meilisearch_documents.json
    all_docs = ontology_base + updated_cards
    meili_out = ONTOLOGY_DIR / "meilisearch_documents.json"
    meili_out.write_text(json.dumps(all_docs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(all_docs)} complete Meilisearch documents to {meili_out}")

    # Sync to Ontology_tool_service if directory exists
    if ONTOLOGY_SERVICE_DIR.exists():
        service_onto_dir = ONTOLOGY_SERVICE_DIR / "ontology"
        service_onto_dir.mkdir(parents=True, exist_ok=True)
        (service_onto_dir / "ontology_base.json").write_text(base_out.read_text(encoding="utf-8"), encoding="utf-8")
        (service_onto_dir / "schema_registry.json").write_text(registry_out.read_text(encoding="utf-8"), encoding="utf-8")
        (service_onto_dir / "concept_cards.json").write_text(concept_cards_path.read_text(encoding="utf-8"), encoding="utf-8")
        (service_onto_dir / "meilisearch_documents.json").write_text(meili_out.read_text(encoding="utf-8"), encoding="utf-8")
        
        # Simplified content.json
        simplified = []
        for doc in all_docs:
            entry = {
                "id": doc["id"],
                "type": doc["type"],
                "name": doc["name"],
                "description": doc.get("description", ""),
            }
            for k in ("synonyms", "aliases", "category", "pattern", "from_label", "to_label", "cypher_template", "graph_mapping", "agent_id"):
                if doc.get(k):
                    entry[k] = doc[k]
            simplified.append(entry)
        (ONTOLOGY_SERVICE_DIR / "content.json").write_text(json.dumps(simplified, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Synced {len(simplified)} entries to Ontology_tool_service/content.json")

    print("Meilisearch ontology build complete.")


if __name__ == "__main__":
    main()
