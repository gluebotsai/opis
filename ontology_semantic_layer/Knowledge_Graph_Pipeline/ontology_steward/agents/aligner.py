"""Aligner — retrieval-first match against registry and core labels."""

from __future__ import annotations

from ontology_steward.models import (
    ApplyGate,
    FieldSignal,
    Proposal,
    ProposalDecision,
    StewardContext,
    Understanding,
)
from ontology_steward.tools.registry_io import load_types, search_entities, search_types

# Field hint → preferred plain entity id (no wt: prefix)
_FIELD_CLASS_HINTS = {
    "measurement": "ClinicalObservation",
    "coded_condition": "MedicalCondition",
    "vehicle_asset": "Vehicle",
    "identity": "Vehicle",
    "sku": "Offering",
    "category_path": "Offering",
    "enum": "Contact",
}


class Aligner:
    REUSE_THRESHOLD = 0.75

    def align(
        self,
        ctx: StewardContext,
        signal: FieldSignal,
        understanding: Understanding,
    ) -> Proposal | None:
        if understanding.value_shape == "junk":
            return Proposal(
                field=signal.field,
                table=signal.table,
                org=signal.org,
                industry=understanding.industry,
                decision=ProposalDecision.REJECT,
                gate=ApplyGate.HUMAN,
                rationale="Junk/debug field",
                confidence=0.99,
            )

        if understanding.value_shape == "phi":
            return Proposal(
                field=signal.field,
                table=signal.table,
                org=signal.org,
                industry=understanding.industry,
                decision=ProposalDecision.REJECT,
                gate=ApplyGate.HUMAN,
                rationale="PHI or junk field",
                confidence=0.95,
            )

        hits = search_entities(signal.field, limit=5) or search_types(signal.field, limit=5)
        hint_id = _FIELD_CLASS_HINTS.get(understanding.value_shape)
        for t in hits:
            if hint_id and t.get("class_id") == hint_id:
                return self._reuse(signal, understanding, t, confidence=0.9)

        if hint_id:
            for t in load_types():
                if t.get("class_id") == hint_id:
                    return self._reuse(signal, understanding, t, confidence=0.85)

        if understanding.value_shape == "enum":
            return Proposal(
                field=signal.field,
                table=signal.table,
                org=signal.org,
                industry=understanding.industry,
                decision=ProposalDecision.REUSE,
                class_id="Contact",
                graph_label="Contact",
                cdc={"stop_dynamic_key": signal.field, "mode": "property"},
                confidence=0.8,
                gate=ApplyGate.AUTO,
                rationale="Stable enum fits as typed property on Contact",
            )

        ctx.log("aligner", "no_fit", field=signal.field)
        return None

    def _reuse(
        self,
        signal: FieldSignal,
        understanding: Understanding,
        type_row: dict,
        confidence: float,
    ) -> Proposal:
        decision = ProposalDecision.REUSE
        term_id = None
        mode = "promote_property_to_node"
        if understanding.value_shape == "measurement":
            term_id = "loinc:85354-9" if "blood" in signal.field.lower() or "bp" in signal.field.lower() else "loinc:generic"
            mode = "node"
        elif understanding.value_shape == "coded_condition":
            mode = "node"

        gate = ApplyGate.AUTO if confidence >= self.REUSE_THRESHOLD and decision == ProposalDecision.REUSE else ApplyGate.HUMAN

        return Proposal(
            field=signal.field,
            table=signal.table,
            org=signal.org,
            industry=understanding.industry,
            decision=decision,
            class_id=type_row.get("class_id"),
            graph_label=type_row.get("graph_label"),
            term_id=term_id,
            relation={"from": "Contact", "type": "HAS_OBSERVATION", "to": type_row.get("class_id")}
            if mode == "node"
            else None,
            cdc={"stop_dynamic_key": signal.field, "mode": mode},
            confidence=confidence,
            gate=gate,
            rationale=f"Reuse {type_row.get('class_id')} for {understanding.value_shape}",
        )
