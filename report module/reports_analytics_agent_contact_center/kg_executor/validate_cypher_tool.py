"""Validation tool for Cypher queries against CCaaS Knowledge Graph ontology.

Validates:
1. Read-only safety (no CREATE, MERGE, SET, DELETE, DROP, etc., no APOC/LOAD CSV).
2. Allowed node labels against schema_registry.json.
3. Allowed relationship types against schema_registry.json.
4. Allowed property names against schema_registry.json.
5. Product edge fences and forbidden cross-domain labels (product_edges.yml).
6. Mandatory LIMIT capping.

Can be called programmatically via `validate_cypher()` or as a CLI tool:
    python3 kg_executor/validate_cypher_tool.py "MATCH (c:Conversation) RETURN c.id LIMIT 10"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from .core.cypher_guard import CypherGuardError, guard_cypher
    from .core.cypher_validate import load_product_edges, load_schema
except (ImportError, ValueError):
    # Support running as a direct script
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from kg_executor.core.cypher_guard import CypherGuardError, guard_cypher
    from kg_executor.core.cypher_validate import load_product_edges, load_schema


def inspect_cypher(cypher: str) -> dict[str, Any]:
    """Extract and categorize elements from a Cypher query against the schema registry."""
    labels_allowed, rels_allowed, props_allowed = load_schema()
    edges_spec = load_product_edges()
    forbidden = edges_spec.get("forbidden_labels", set())

    # Extract labels
    query_for_labels = re.sub(r"\[[^\]]*\]", "", cypher)
    found_labels = list(dict.fromkeys(re.findall(r":\s*`?([A-Za-z][A-Za-z0-9_]*)`?", query_for_labels)))
    label_status = [
        {"label": l, "valid": (l in labels_allowed and l not in forbidden), "forbidden": (l in forbidden)}
        for l in found_labels
    ]

    # Extract relationships
    found_rels_tuples = re.findall(r"-\[.*?:" r"`?(\w+)`?" r"\]->|<-\[.*?:" r"`?(\w+)`?" r"\]", cypher)
    found_rels = list(dict.fromkeys([r for tup in found_rels_tuples for r in tup if r]))
    rel_status = [
        {"relationship": r, "valid": (r in rels_allowed)}
        for r in found_rels
    ]

    # Extract properties
    skip_entities = {"duration", "point", "date", "datetime", "localdatetime", "time", "localtime", "math"}
    skip_props = {
        "year", "month", "day", "hour", "minute", "second", "epochMillis",
        "seconds", "minutes", "hours", "days", "months", "years",
        "milliseconds", "microseconds", "nanoseconds", "between", "distance", "truncate",
    }
    found_props = []
    for match in re.finditer(r"\b([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\b", cypher):
        entity = match.group(1)
        prop = match.group(2)
        if entity in skip_entities or prop in skip_props:
            continue
        if prop not in found_props:
            found_props.append(prop)

    prop_status = [
        {"property": p, "valid": (p in props_allowed)}
        for p in found_props
    ]

    # Semantic Quality Suggestions
    suggestions = []
    cypher_lower = cypher.lower()
    if "duration.between" in cypher_lower and "channel" not in cypher_lower:
        suggestions.append("Tip: Segment duration calculations by `c.channel` to prevent email durations from distorting call/chat AHT.")
    if "/" in cypher and "case when" not in cypher_lower and "count(" in cypher_lower:
        suggestions.append("Tip: Guard division and percentage ratios with `CASE WHEN denominator > 0 THEN round(...) ELSE 0.0 END`.")
    if "duration.between" in cypher_lower and "/ 60" not in cypher:
        suggestions.append("Tip: Convert duration seconds to minutes with `/ 60.0` or provide both seconds and minutes for hierarchical formatting.")

    return {
        "labels": label_status,
        "relationships": rel_status,
        "properties": prop_status,
        "suggestions": suggestions,
    }


def validate_cypher(
    cypher: str,
    *,
    role: str = "admin",
    user_id: int = 1,
    queue_ids: list[int] | None = None,
    params: dict[str, Any] | None = None,
    max_rows: int = 500,
) -> dict[str, Any]:
    """Validate a Cypher query and return a detailed diagnostic report."""
    inspection = inspect_cypher(cypher)
    try:
        guarded = guard_cypher(
            cypher,
            role=role,
            user_id=user_id,
            queue_ids=queue_ids or [],
            params=params or {},
            max_rows=max_rows,
        )
        return {
            "is_valid": True,
            "status": "VALID",
            "guarded_cypher": guarded.cypher,
            "bound_params": guarded.params,
            "guard_notes": guarded.notes,
            "inspection": inspection,
            "error": None,
        }
    except CypherGuardError as exc:
        return {
            "is_valid": False,
            "status": "INVALID",
            "guarded_cypher": None,
            "bound_params": None,
            "guard_notes": [],
            "inspection": inspection,
            "error": str(exc),
        }


def main():
    parser = argparse.ArgumentParser(description="Validate Cypher queries against CCaaS Knowledge Graph schema.")
    parser.add_argument("query", nargs="?", help="Cypher query string to validate")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    args = parser.parse_args()

    if not args.query:
        print("Usage: python3 -m kg_executor.validate_cypher_tool '<cypher_query>'")
        sys.exit(1)

    result = validate_cypher(args.query)

    if args.json:
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["is_valid"] else 1)

    print("\n" + "=" * 60)
    print(f" CYPHER VALIDATION RESULT: {result['status']}")
    print("=" * 60)
    print(f"Query: {args.query}\n")

    if result["is_valid"]:
        print(f"✓ Security & Read-Only: PASSED")
        print(f"✓ Schema Allowlist:     PASSED")
        print(f"✓ Product Fence:        PASSED")
        print(f"✓ Guarded Output:       {result['guarded_cypher']}")
        if result["guard_notes"]:
            print(f"  Notes: {', '.join(result['guard_notes'])}")
    else:
        print(f"❌ REASON: {result['error']}\n")

    # Details
    insp = result["inspection"]
    if insp["labels"]:
        print("\nLabels Identified:")
        for l in insp["labels"]:
            mark = "✓" if l["valid"] else "❌"
            status_text = "Allowed" if l["valid"] else ("FORBIDDEN (Other Product Domain)" if l.get("forbidden") else "NOT in schema")
            print(f"  {mark} :{l['label']} -> {status_text}")

    if insp["relationships"]:
        print("\nRelationships Identified:")
        for r in insp["relationships"]:
            mark = "✓" if r["valid"] else "❌"
            status_text = "Allowed" if r["valid"] else "NOT in schema"
            print(f"  {mark} [:{r['relationship']}] -> {status_text}")

    if insp["properties"]:
        print("\nProperties Identified:")
        for p in insp["properties"]:
            mark = "✓" if p["valid"] else "❌"
            status_text = "Allowed" if p["valid"] else "NOT in schema"
            print(f"  {mark} .{p['property']} -> {status_text}")

    if insp.get("suggestions"):
        print("\nOptimization Tips:")
        for s in insp["suggestions"]:
            print(f"  💡 {s}")

    print("=" * 60 + "\n")
    sys.exit(0 if result["is_valid"] else 1)


if __name__ == "__main__":
    main()
