"""Creator — mint one class only when Aligner found no fit."""

from __future__ import annotations

from ontology_steward.models import (
    ApplyGate,
    FieldSignal,
    Proposal,
    ProposalDecision,
    StewardContext,
    Understanding,
)
from ontology_steward.tools.registry_io import load_types, search_types


class Creator:
    FORBIDDEN_LABELS = {"VehicleDetails", "ClinicalBag", "Automobile", "BloodGroup", "BPEntity"}

    def create(
        self,
        ctx: StewardContext,
        signal: FieldSignal,
        understanding: Understanding,
    ) -> Proposal:
        # Negative proof: registry must not already have a fit
        if search_types(signal.field, limit=3):
            existing = search_types(signal.field, limit=1)[0]
            return Proposal(
                field=signal.field,
                table=signal.table,
                org=signal.org,
                industry=understanding.industry,
                decision=ProposalDecision.REUSE,
                class_id=existing.get("class_id"),
                graph_label=existing.get("graph_label"),
                cdc={"stop_dynamic_key": signal.field, "mode": "node"},
                confidence=0.7,
                gate=ApplyGate.HUMAN,
                rationale="Creator blocked: registry hit exists",
            )

        if understanding.value_shape == "vehicle_asset":
            label = "Vehicle"
            class_id = "Vehicle"
        elif understanding.value_shape == "measurement":
            label = "ClinicalObservation"
            class_id = "ClinicalObservation"
        elif understanding.value_shape == "coded_condition":
            label = "MedicalCondition"
            class_id = "MedicalCondition"
        else:
            return Proposal(
                field=signal.field,
                table=signal.table,
                org=signal.org,
                industry=understanding.industry,
                decision=ProposalDecision.REJECT,
                gate=ApplyGate.HUMAN,
                rationale=f"No creator template for shape {understanding.value_shape}",
            )

        if label in self.FORBIDDEN_LABELS:
            return Proposal(
                field=signal.field,
                table=signal.table,
                org=signal.org,
                industry=understanding.industry,
                decision=ProposalDecision.REJECT,
                rationale="Forbidden bag label",
            )

        # Second org reuse: if class already in registry, reuse not create
        for t in load_types():
            if t.get("class_id") == class_id:
                return Proposal(
                    field=signal.field,
                    table=signal.table,
                    org=signal.org,
                    industry=understanding.industry,
                    decision=ProposalDecision.REUSE,
                    class_id=class_id,
                    graph_label=label,
                    cdc={"stop_dynamic_key": signal.field, "mode": "node"},
                    confidence=0.88,
                    gate=ApplyGate.AUTO,
                    rationale="Reuse existing pack class",
                )

        ctx.log("creator", "new_class", class_id=class_id)
        return Proposal(
            field=signal.field,
            table=signal.table,
            org=signal.org,
            industry=understanding.industry,
            decision=ProposalDecision.NEW_CLASS,
            class_id=class_id,
            graph_label=label,
            relation={"from": "wt:Customer", "type": "OWNS" if class_id == "wt:Vehicle" else "HAS_OBSERVATION", "to": class_id},
            cdc={"stop_dynamic_key": signal.field, "mode": "node"},
            confidence=0.65,
            gate=ApplyGate.HUMAN,
            rationale=f"New class {class_id} for {understanding.value_shape}",
        )
