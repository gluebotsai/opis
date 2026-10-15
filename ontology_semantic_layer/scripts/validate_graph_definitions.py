#!/usr/bin/env python3
"""Validate graph entity definitions and no wt:* on API-facing ontology prompts."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import yaml

from ontology.graph_nodes import GraphIndex, clear_graph_nodes_cache
from ontology.slice import clear_ontology_cache, fetch_ontology_slice, public_ontology_id

FORBIDDEN_IN_DEF = ("wt:", "schema.", " uid", "L1", "L2", "ASGA", "Hub plan")
SAMPLE_AGENTS = [
    ("ticketing_super_agent", "ticketing"),
    ("ticket_lifecycle_executor", "ticketing"),
    ("cc.super", "contact_centre"),
    ("crm.deals", "crm"),
]


def _labels_from_nodes() -> set[str]:
    gi = GraphIndex.get()
    return {str(n.get("label")) for n in gi._nodes.values()}


def validate_definition_quality(definitions: dict[str, str]) -> list[str]:
    errors: list[str] = []
    for label, text in sorted(definitions.items()):
        t = (text or "").strip()
        if len(t) < 10 or len(t) > 120:
            errors.append(f"definition length for {label}: {len(t)} chars")
        for bad in FORBIDDEN_IN_DEF:
            if bad in t:
                errors.append(f"definition for {label} contains forbidden '{bad}'")
        if label == "WorkflowRule" and "Hub" in t:
            errors.append(f"WorkflowRule definition looks like Hub text: {t}")
    return errors


def validate_prompt_definitions(prompt: str, expected_labels: set[str]) -> list[str]:
    errors: list[str] = []
    if "wt:" in prompt:
        errors.append("prompt contains wt:")
    entity_blocks = re.split(r"\n    (?=[A-Z])", prompt.split("entities:", 1)[-1].split("\n  relations:", 1)[0])
    defined_labels: set[str] = set()
    for block in entity_blocks:
        name = block.split(":", 1)[0].strip()
        if not name or name.startswith("-") or name == "entities":
            continue
        if "definition:" not in block:
            errors.append(f"missing definition for entity {name}")
        else:
            defined_labels.add(name)
    missing = expected_labels - defined_labels
    if missing:
        errors.append(f"prompt missing entities: {sorted(missing)[:5]} ({len(missing)} total)")
    return errors


def main() -> int:
    clear_graph_nodes_cache()
    clear_ontology_cache()
    failed = 0

    path = ROOT / "ontology/graph_nodes.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    definitions = dict(data.get("definitions") or {})
    labels = _labels_from_nodes()

    if len(definitions) < len(labels):
        print(f"  FAIL  definitions count {len(definitions)} < labels {len(labels)}")
        failed += 1
    else:
        print(f"  OK    {len(definitions)} definitions for {len(labels)} graph labels")

    qual = validate_definition_quality(definitions)
    if qual:
        for err in qual[:10]:
            print(f"  FAIL  {err}")
        failed += len(qual)
    else:
        print("  OK    definition quality gates passed")

    gi = GraphIndex.get()
    from ontology.ticketing_product import entity_names

    tk_product_labels = entity_names()
    super_prompt = fetch_ontology_slice(
        agent="ticketing_super_agent", tenant="org1000", product="ticketing", user_id=1001
    ).as_prompt()
    super_errs = validate_prompt_definitions(super_prompt, tk_product_labels)
    if super_errs:
        for err in super_errs:
            print(f"  FAIL  super {err}")
        failed += len(super_errs)
    else:
        print(
            f"  OK    ticketing super prompt has {len(tk_product_labels)} "
            "product entities with definitions"
        )

    for agent, product in SAMPLE_AGENTS:
        prompt = fetch_ontology_slice(
            agent=agent, tenant="org1000", product=product, user_id=1001
        ).as_prompt()
        if "wt:" in prompt:
            print(f"  FAIL  {agent} prompt contains wt:")
            failed += 1

    pack = fetch_ontology_slice(
        agent="ticketing_super_agent", tenant="org1000", product="ticketing", user_id=1001
    )
    pub = yaml.dump(pack.to_public_dict())
    if "wt:" in pub:
        print("  FAIL  to_public_dict contains wt:")
        failed += 1
    else:
        print("  OK    to_public_dict has no wt:")

    if public_ontology_id("wt:cc") != "worktual-ontology":
        print("  FAIL  public_ontology_id mapping")
        failed += 1
    else:
        print("  OK    public_ontology_id friendly")

    hub_prompt = fetch_ontology_slice(
        preset="hub.orchestrator", tenant="org1000", products=["ticketing", "crm"]
    ).as_prompt()
    if "wt:" in hub_prompt:
        print("  FAIL  hub prompt contains wt:")
        failed += 1
    elif ("Ticket" not in hub_prompt and "SupportCase" not in hub_prompt) or (
        "Opportunity" not in hub_prompt and "Deal" not in hub_prompt
    ):
        print("  FAIL  hub prompt missing union labels")
        failed += 1
    else:
        print("  OK    hub prompt clean")

    print(f"\n{failed} graph-definition validation failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
