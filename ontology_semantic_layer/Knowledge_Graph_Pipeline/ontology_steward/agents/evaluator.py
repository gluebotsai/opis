"""Evaluator — score against gold cases; separate from Creator (no self-grade)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from ontology_steward.models import Proposal, ProposalDecision


class Evaluator:
    def __init__(self, cases_path: Path | None = None):
        self.cases_path = cases_path or Path(__file__).resolve().parent.parent / "eval" / "cases.yml"

    def load_cases(self) -> list[dict[str, Any]]:
        if not self.cases_path.exists():
            return []
        doc = yaml.safe_load(self.cases_path.read_text(encoding="utf-8")) or {}
        return list(doc.get("cases") or [])

    def match_case(self, proposal: Proposal, case: dict) -> bool:
        if case.get("field") and case["field"] != proposal.field:
            return False
        if case.get("table") and case["table"] != proposal.table:
            return False
        if case.get("fixture") and case.get("fixture") != proposal.field:
            pass
        return True

    def evaluate(self, proposal: Proposal, case_id: str | None = None) -> dict[str, Any]:
        cases = self.load_cases()
        target = None
        for c in cases:
            if case_id and c.get("id") == case_id:
                target = c
                break
            if c.get("field") == proposal.field:
                target = c
                break
        if not target:
            return {"ok": True, "skipped": True, "reason": "no gold case"}

        ok = True
        reasons: list[str] = []

        exp_decision = target.get("expected_decision")
        if exp_decision and proposal.decision.value != exp_decision:
            ok = False
            reasons.append(f"decision {proposal.decision.value} != {exp_decision}")

        exp_class = target.get("expected_class_id")
        if exp_class:
            norm = str(proposal.class_id or "").removeprefix("wt:")
            exp_norm = str(exp_class).removeprefix("wt:")
            if norm != exp_norm:
                ok = False
                reasons.append(f"class_id {proposal.class_id} != {exp_class}")

        forbidden = target.get("forbidden_class_ids") or []
        if proposal.class_id in forbidden:
            ok = False
            reasons.append(f"class_id {proposal.class_id} is forbidden")

        exp_gate = target.get("expected_gate")
        if exp_gate and proposal.gate.value != exp_gate:
            ok = False
            reasons.append(f"gate {proposal.gate.value} != {exp_gate}")

        # FHIR family swap checks
        if target.get("fhir_family") == "observation" and proposal.class_id in (
            "MedicalCondition",
            "wt:MedicalCondition",
        ):
            ok = False
            reasons.append("FHIR swap: measurement classified as Condition")
        if target.get("fhir_family") == "condition" and proposal.class_id in (
            "ClinicalObservation",
            "wt:ClinicalObservation",
        ):
            ok = False
            reasons.append("FHIR swap: condition classified as Observation")

        return {"ok": ok, "case_id": target.get("id"), "reasons": reasons}

    def evaluate_all(self, proposals: list[Proposal]) -> dict[str, Any]:
        results = [self.evaluate(p) for p in proposals]
        failed = [r for r in results if not r.get("ok") and not r.get("skipped")]
        return {
            "total": len(results),
            "failed": len(failed),
            "passed": len(results) - len(failed),
            "results": results,
        }
