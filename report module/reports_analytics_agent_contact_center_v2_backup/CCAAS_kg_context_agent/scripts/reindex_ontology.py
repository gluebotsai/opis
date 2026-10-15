#!/usr/bin/env python3
"""Index CCaaS ontology and concept cards into Meilisearch index 'kg_ccaas'."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

MEILI_URL = "http://82.113.92.44:7700"
MEILI_KEY = "Worktual-123"
INDEX_NAME = "kg_ccaas"


def load_documents() -> list[dict]:
    docs_path = ROOT / "ontology" / "meilisearch_documents.json"
    if not docs_path.exists():
        raise FileNotFoundError(f"Missing {docs_path}")
    return json.loads(docs_path.read_text(encoding="utf-8"))


def index_meilisearch(docs: list[dict]) -> None:
    try:
        import meilisearch
    except ImportError:
        print("meilisearch package required: pip install meilisearch", file=sys.stderr)
        sys.exit(1)

    client = meilisearch.Client(MEILI_URL, MEILI_KEY)
    index = client.index(INDEX_NAME)

    # Clean existing documents
    try:
        delete_task = index.delete_all_documents()
        print(f"Deleted old documents in {INDEX_NAME} — task_uid={delete_task.task_uid}")
        client.wait_for_task(delete_task.task_uid, timeout_in_ms=120_000)
    except Exception as exc:
        print(f"Note on deletion: {exc}")

    # Add new CCaaS documents
    task = index.add_documents(docs, primary_key="id")
    print(f"Indexed {len(docs)} documents into '{INDEX_NAME}' — task_uid={task.task_uid}")
    client.wait_for_task(task.task_uid, timeout_in_ms=120_000)

    # Configure searchable attributes
    settings_task = index.update_settings({
        "searchableAttributes": [
            "name",
            "synonyms",
            "description",
            "category",
            "business_rules",
            "pattern",
            "type"
        ],
        "filterableAttributes": ["type", "category"],
        "embedders": {
            "default": {
                "source": "huggingFace",
                "model": "sentence-transformers/all-MiniLM-L6-v2"
            }
        }
    })
    print(f"Updated index settings for '{INDEX_NAME}' — task_uid={settings_task.task_uid}")
    client.wait_for_task(settings_task.task_uid, timeout_in_ms=120_000)


def main():
    docs = load_documents()
    print(f"Loaded {len(docs)} CCaaS documents for indexing into Meilisearch ({INDEX_NAME})")
    index_meilisearch(docs)
    print("Reindexing complete!")


if __name__ == "__main__":
    main()
