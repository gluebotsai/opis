"""Orchestrator — DAG entry for Ontology Steward MAS."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from ontology_steward.harness import Harness


class Orchestrator:
    def __init__(
        self,
        loader,
        pipeline_root: str | Path,
        semantic_root: str | Path,
        conn_factory: Callable | None = None,
    ):
        self.harness = Harness(
            loader=loader,
            pipeline_root=Path(pipeline_root),
            semantic_root=Path(semantic_root),
            conn_factory=conn_factory,
        )

    def scan(self, org: str, apply: bool = False) -> dict[str, Any]:
        proposals = self.harness.run_org(org, apply=apply)
        return {
            "org": org,
            "count": len(proposals),
            "proposals": [p.to_dict() for p in proposals],
        }

    def process_inbox(self, org: str, apply: bool = False) -> dict[str, Any]:
        inbox = Path(self.harness.pipeline_root) / "ontology_steward" / "inbox" / f"{org}.json"
        if not inbox.exists():
            return {"org": org, "count": 0, "proposals": []}
        import json

        payload = json.loads(inbox.read_text(encoding="utf-8"))
        proposals = self.harness.run_from_payload(payload, apply=apply)
        return {
            "org": org,
            "count": len(proposals),
            "proposals": [p.to_dict() for p in proposals],
        }
