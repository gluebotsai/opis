#!/usr/bin/env python3
"""Merge ontology + concept cards, write content.json, and index into Meilisearch."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

MEILI_URL = "http://192.168.11.156:7701"
MEILI_KEY = "iamgroot"
INDEX_NAME = "graph_onto"


def _normalize_concept(card: dict) -> dict:
    """Ensure Meilisearch docs have description + search_text for hybrid search."""
    doc = dict(card)
    if not doc.get("description"):
        doc["description"] = doc.get("definition", doc.get("name", ""))
    if not doc.get("search_text"):
        parts = [doc.get("name", ""), doc.get("description", "")]
        parts.extend(doc.get("aliases", []))
        parts.extend(doc.get("keywords", []))
        if doc.get("graph_mapping", {}).get("relationship_paths"):
            parts.extend(doc["graph_mapping"]["relationship_paths"])
        doc["search_text"] = " ".join(p for p in parts if p)
    return doc


def load_documents() -> list[dict]:
    base_path = ROOT / "ontology" / "ontology_base.json"
    cards_path = ROOT / "ontology" / "concept_cards.json"

    if not base_path.exists():
        print("ontology_base.json missing — running generate_ontology.py first")
        import subprocess
        subprocess.check_call([sys.executable, str(ROOT / "scripts" / "generate_ontology.py")])

    base = json.loads(base_path.read_text(encoding="utf-8"))
    cards = json.loads(cards_path.read_text(encoding="utf-8"))
    cards = [_normalize_concept(c) for c in cards]
    return base + cards


def write_content_json(docs: list[dict]) -> Path:
    content_path = ROOT / "content.json"
    backup = ROOT / "content.json.bak"
    if content_path.exists() and not backup.exists():
        shutil.copy(content_path, backup)
        print(f"Backed up existing content.json to {backup}")

    # content.json: simplified view for backward compatibility (labels + concepts)
    simplified = []
    for doc in docs:
        entry = {
            "id": doc["id"],
            "type": doc["type"],
            "name": doc["name"],
            "description": doc.get("description", ""),
        }
        if doc.get("synonyms"):
            entry["synonyms"] = doc["synonyms"]
        if doc.get("aliases"):
            entry["aliases"] = doc["aliases"]
        if doc.get("category"):
            entry["category"] = doc["category"]
        if doc.get("pattern"):
            entry["pattern"] = doc["pattern"]
        if doc.get("from_label"):
            entry["from_label"] = doc["from_label"]
            entry["to_label"] = doc["to_label"]
        if doc.get("cypher_template"):
            entry["cypher_template"] = doc["cypher_template"]
        if doc.get("graph_mapping"):
            entry["graph_mapping"] = doc["graph_mapping"]
        simplified.append(entry)

    content_path.write_text(json.dumps(simplified, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(simplified)} entries to {content_path}")
    return content_path


def index_meilisearch(docs: list[dict]) -> None:
    try:
        import meilisearch
    except ImportError:
        print("meilisearch package required: pip install meilisearch", file=sys.stderr)
        sys.exit(1)

    client = meilisearch.Client(MEILI_URL, MEILI_KEY)
    index = client.index(INDEX_NAME)

    # Remove stale documents from prior index versions
    try:
        delete_task = index.delete_all_documents()
        print(f"Deleted all existing documents — task_uid={delete_task.task_uid}")
        client.wait_for_task(delete_task.task_uid, timeout_in_ms=120_000)
    except Exception as exc:
        print(f"Warning: could not delete existing documents: {exc}")

    # Full index payload (rich fields for agent injection)
    full_path = ROOT / "ontology" / "meilisearch_documents.json"
    full_path.write_text(json.dumps(docs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote full index payload to {full_path}")

    task = index.add_documents(docs, primary_key="id")
    print(f"Indexed {len(docs)} documents — task_uid={task.task_uid}")
    client.wait_for_task(task.task_uid, timeout_in_ms=120_000)

    # Update searchable attributes for hybrid search
    settings_task = index.update_settings({
        "searchableAttributes": [
            "name",
            "aliases",
            "synonyms",
            "keywords",
            "description",
            "search_text",
            "examples",
            "type",
            "domain",
            "pattern",
        ],
        "filterableAttributes": ["type", "domain", "category"],
        "embedders": {
            "default": {
                "source": "huggingFace",
                "model": "sentence-transformers/all-MiniLM-L6-v2",
            }
        },
    })
    print(f"Updated index settings — task_uid={settings_task.task_uid}")
    client.wait_for_task(settings_task.task_uid, timeout_in_ms=120_000)


def main():
    docs = load_documents()
    print(f"Total documents: {len(docs)} "
          f"(labels+rels: {sum(1 for d in docs if d['type'] in ('node_label', 'relationship'))}, "
          f"concepts: {sum(1 for d in docs if d['type'] in ('business_concept', 'analytical_pattern'))})")
    write_content_json(docs)
    index_meilisearch(docs)
    print("Done.")


if __name__ == "__main__":
    main()
