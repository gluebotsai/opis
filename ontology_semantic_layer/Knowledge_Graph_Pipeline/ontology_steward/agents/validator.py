"""Validator — overlay laws, PHI blocklist, fan-in, connectivity."""

from __future__ import annotations

from pathlib import Path

import yaml

from ontology_steward.models import ApplyGate, Proposal, ProposalDecision

_HEALTHCARE_BLOCKLIST = {
    "diagnosis", "condition", "icd_code", "hiv_status", "blood_group", "vitals",
    "medications", "prescription", "allergy", "lab_result", "genetic",
}


class Validator:
    def validate(self, proposal: Proposal, pipeline_root: Path) -> Proposal:
        errors: list[str] = []

        if proposal.decision == ProposalDecision.NEW_CLASS:
            if proposal.gate == ApplyGate.AUTO:
                errors.append("new_class cannot auto-apply")
                proposal.gate = ApplyGate.HUMAN

        if proposal.field.lower() in _HEALTHCARE_BLOCKLIST or proposal.field.lower() in (
            "hiv_status", "blood_pressure", "diagnosis", "diabetes"
        ):
            # Clinical keys on engagement graph: require human + check healthcare pack
            hc = pipeline_root / "config/mappings/domains/healthcare.yaml"
            if hc.exists():
                doc = yaml.safe_load(hc.read_text(encoding="utf-8")) or {}
                for _tbl, ext in (doc.get("extends") or {}).items():
                    cf = (ext or {}).get("custom_fields") or {}
                    bl = {str(x).lower() for x in (cf.get("blocklist") or [])}
                    if proposal.field.lower() in bl and proposal.decision != ProposalDecision.REJECT:
                        if proposal.class_id in ("wt:ClinicalObservation", "wt:MedicalCondition"):
                            errors.append("clinical class on blocklisted key requires explicit human override")
                            proposal.gate = ApplyGate.HUMAN

        if "Details" in (proposal.graph_label or ""):
            errors.append("forbidden Details bag label")
            proposal.decision = ProposalDecision.REJECT

        if proposal.decision == ProposalDecision.REUSE and proposal.class_id == "wt:ClinicalObservation":
            if "diabetes" in proposal.field.lower() or "hypertension" in proposal.field.lower():
                errors.append("condition field must not map to Observation")
                proposal.decision = ProposalDecision.REJECT

        if proposal.decision == ProposalDecision.REUSE and proposal.class_id == "wt:MedicalCondition":
            if "blood" in proposal.field.lower() or "glucose" in proposal.field.lower() or "bp" in proposal.field.lower():
                errors.append("measurement field must not map to Condition")
                proposal.decision = ProposalDecision.REJECT

        if proposal.relation and not proposal.relation.get("from"):
            errors.append("relation must attach to existing spine")

        proposal.errors.extend(errors)
        return proposal
