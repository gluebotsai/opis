#!/usr/bin/env python3
"""CLI for Ontology Steward MAS."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
SEMANTIC_ROOT = PIPELINE_ROOT.parent
sys.path.insert(0, str(PIPELINE_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Ontology Steward MAS")
    parser.add_argument("command", choices=["scan", "eval", "approve", "inbox"])
    parser.add_argument("--org", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--proposal", help="Path to pending proposal for approve")
    parser.add_argument("--pg-detect", action="store_true", help="eval: use Detector.from_pg after seeding")
    args = parser.parse_args()

    from src.config_loader import ConfigLoader
    from ontology_steward.orchestrator import Orchestrator
    from ontology_steward.agents.applicator import Applicator
    from ontology_steward.models import Proposal, ProposalDecision, ApplyGate, StewardContext
    from ontology_steward.tools.pg_conn import steward_pg_conn_factory
    import yaml

    conn_factory = steward_pg_conn_factory()
    loader = ConfigLoader(PIPELINE_ROOT / "config")
    orch = Orchestrator(loader, PIPELINE_ROOT, SEMANTIC_ROOT, conn_factory=conn_factory)

    if args.command == "scan":
        result = orch.scan(args.org, apply=args.apply and not args.dry_run)
        print(json.dumps(result, indent=2, default=str))
        return 0

    if args.command == "inbox":
        result = orch.process_inbox(args.org, apply=args.apply and not args.dry_run)
        print(json.dumps(result, indent=2, default=str))
        return 0

    if args.command == "eval":
        from ontology_steward.eval.run_eval import main as eval_main

        extra = ["--org", args.org]
        if args.pg_detect:
            extra.append("--pg-detect")
        return eval_main(extra)

    if args.command == "approve":
        if not args.proposal:
            print("--proposal required", file=sys.stderr)
            return 1
        doc = yaml.safe_load(Path(args.proposal).read_text(encoding="utf-8"))
        p = Proposal(
            field=doc["field"],
            table=doc["table"],
            org=doc["org"],
            industry=doc.get("industry", ""),
            decision=ProposalDecision(doc["decision"]),
            class_id=doc.get("class_id"),
            graph_label=doc.get("graph_label"),
            term_id=doc.get("term_id"),
            shopify_category_gid=doc.get("shopify_category_gid"),
            google_product_category=doc.get("google_product_category"),
            shopify_attributes=doc.get("shopify_attributes") or [],
            cdc=doc.get("cdc") or {},
            confidence=doc.get("confidence", 0),
            gate=ApplyGate(doc.get("gate", "human")),
            rationale=doc.get("rationale", ""),
        )
        ctx = StewardContext(
            repo_root=str(SEMANTIC_ROOT),
            pipeline_root=str(PIPELINE_ROOT),
            semantic_root=str(SEMANTIC_ROOT),
            org=args.org,
        )
        app = Applicator(PIPELINE_ROOT, SEMANTIC_ROOT, push_meili=args.apply)
        result = app.apply(ctx, p, force=True)
        print(json.dumps(result, indent=2, default=str))
        return 0 if result.get("ok") else 1

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
