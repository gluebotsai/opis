"""Harness — run MAS pipeline with transcripts and budgets."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from ontology_steward.agents.aligner import Aligner
from ontology_steward.agents.applicator import Applicator
from ontology_steward.agents.creator import Creator
from ontology_steward.agents.detector import Detector
from ontology_steward.agents.evaluator import Evaluator
from ontology_steward.agents.taxonomist import Taxonomist
from ontology_steward.agents.understander import Understander
from ontology_steward.agents.validator import Validator
from ontology_steward.models import Proposal, StewardContext


class Harness:
    def __init__(
        self,
        loader,
        pipeline_root: Path,
        semantic_root: Path,
        conn_factory: Callable | None = None,
        dry_run: bool = False,
    ):
        self.loader = loader
        self.pipeline_root = pipeline_root
        self.semantic_root = semantic_root
        self.conn_factory = conn_factory
        self.dry_run = dry_run

        self.detector = Detector(loader)
        self.understander = Understander(conn_factory)
        self.aligner = Aligner()
        self.taxonomist = Taxonomist()
        self.creator = Creator()
        self.validator = Validator()
        self.evaluator = Evaluator()
        self.applicator = Applicator(pipeline_root, semantic_root)

    def run_signal(self, ctx: StewardContext, signal, apply: bool = False) -> Proposal:
        understanding = self.understander.understand(ctx, signal)
        proposal = self.aligner.align(ctx, signal, understanding)
        if proposal is None:
            proposal = self.creator.create(ctx, signal, understanding)
        proposal = self.taxonomist.enrich(proposal, signal, understanding)
        proposal = self.validator.validate(proposal, self.pipeline_root)
        eval_result = self.evaluator.evaluate(proposal)
        if not eval_result.get("ok") and not eval_result.get("skipped"):
            proposal.errors.extend(eval_result.get("reasons") or [])
        if apply and not self.dry_run:
            self.applicator.apply(ctx, proposal)
        return proposal

    def run_org(self, org: str, database: str = "", apply: bool = False) -> list[Proposal]:
        ctx = StewardContext(
            repo_root=str(self.semantic_root.parent),
            pipeline_root=str(self.pipeline_root),
            semantic_root=str(self.semantic_root),
            org=org,
            database=database or f"org{org}",
            dry_run=self.dry_run,
        )
        signals = self.detector.from_pg(ctx, self.conn_factory)
        if signals:
            self.detector.write_inbox(signals, org)
        return [self.run_signal(ctx, s, apply=apply) for s in signals]

    def run_from_payload(self, payload: dict[str, Any], apply: bool = False) -> list[Proposal]:
        org = payload.get("org", "1000")
        ctx = StewardContext(
            repo_root=str(self.semantic_root.parent),
            pipeline_root=str(self.pipeline_root),
            semantic_root=str(self.semantic_root),
            org=org,
            database=payload.get("database", f"org{org}"),
            industry=payload.get("industry", ""),
            dry_run=self.dry_run,
        )
        signals = self.detector.from_inbox_payload(payload)
        return [self.run_signal(ctx, s, apply=apply) for s in signals]

    def write_transcript(self, ctx: StewardContext) -> Path:
        tdir = self.pipeline_root / "ontology_steward" / "transcripts"
        tdir.mkdir(parents=True, exist_ok=True)
        path = tdir / f"{ctx.org}.jsonl"
        with path.open("w", encoding="utf-8") as fh:
            for row in ctx.transcripts:
                fh.write(json.dumps(row, default=str) + "\n")
        return path
