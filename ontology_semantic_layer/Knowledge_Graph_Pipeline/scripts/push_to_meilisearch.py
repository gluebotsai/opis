#!/usr/bin/env python3
"""Push updated ontology document chunks to Meilisearch.

Usage:
  python scripts/push_to_meilisearch.py --url http://<HOST>:<PORT> --key <API_KEY> --index <INDEX_NAME>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_PATH = ROOT / "ontology" / "meilisearch_documents.json"


def push(url: str, key: str, index_name: str, replace_all: bool = True):
    try:
        import meilisearch
    except ImportError:
        print("meilisearch package required: pip install meilisearch", file=sys.stderr)
        sys.exit(1)

    if not DOCS_PATH.exists():
        print(f"Error: {DOCS_PATH} does not exist. Run scripts/build_meilisearch_ontology.py first.", file=sys.stderr)
        sys.exit(1)

    docs = json.loads(DOCS_PATH.read_text(encoding="utf-8"))
    print(f"Loaded {len(docs)} documents from {DOCS_PATH}")

    print(f"Connecting to Meilisearch at {url}...")
    client = meilisearch.Client(url, key)
    index = client.index(index_name)

    if replace_all:
        print(f"Purging existing documents in index '{index_name}'...")
        try:
            del_task = index.delete_all_documents()
            print(f"Purge task submitted: task_uid={del_task.task_uid}")
            client.wait_for_task(del_task.task_uid, timeout_in_ms=60_000)
            print("Existing documents purged successfully.")
        except Exception as e:
            print(f"Notice: delete_all_documents returned: {e}")

    print(f"Indexing {len(docs)} document chunks into '{index_name}'...")
    add_task = index.add_documents(docs, primary_key="id")
    print(f"Add documents task submitted: task_uid={add_task.task_uid}")
    client.wait_for_task(add_task.task_uid, timeout_in_ms=120_000)
    print(f"Successfully indexed {len(docs)} documents.")

    print("Configuring searchable, filterable attributes and embedders...")
    settings_task = index.update_settings({
        "searchableAttributes": [
            "name",
            "agent_id",
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
        "filterableAttributes": ["type", "domain", "category", "agent_id"],
        "embedders": {
            "default": {
                "source": "huggingFace",
                "model": "sentence-transformers/all-MiniLM-L6-v2",
            }
        },
    })
    print(f"Settings update task submitted: task_uid={settings_task.task_uid}")
    client.wait_for_task(settings_task.task_uid, timeout_in_ms=60_000)
    print("Meilisearch index configured successfully with Hybrid Search support.")


def main():
    parser = argparse.ArgumentParser(description="Push ontology documents to Meilisearch")
    parser.add_argument("--url", default="http://192.168.11.156:7701", help="Meilisearch URL")
    parser.add_argument("--key", default="iamgroot", help="Meilisearch API / Master key")
    parser.add_argument("--index", default="graph_onto", help="Target Meilisearch index name")
    parser.add_argument("--no-replace", action="store_true", help="Do not purge index before adding")
    args = parser.parse_args()

    push(args.url, args.key, args.index, replace_all=not args.no_replace)


if __name__ == "__main__":
    main()
