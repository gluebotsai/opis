"""Taxonomist — bind SKUs to Shopify terms; clinical to LOINC; never class per SKU."""

from __future__ import annotations

from ontology_steward.models import (
    ApplyGate,
    FieldSignal,
    Proposal,
    ProposalDecision,
    Understanding,
)
from ontology_steward.tools import shopify_taxonomy as shopify
from ontology_steward.tools.registry_io import load_types


class Taxonomist:
    def enrich(self, proposal: Proposal, signal: FieldSignal, understanding: Understanding) -> Proposal:
        route = understanding.taxonomy_route

        if understanding.value_shape in ("sku", "category_path") and route in (
            "ecommerce",
            "healthcare_goods",
            "automotive_parts_retail",
        ):
            text = " ".join(str(v) for v in signal.sample_values) or signal.field
            if understanding.value_shape == "category_path":
                text = signal.field.replace("_", " ") + " " + text
            cat = shopify.match_category(text)
            if cat:
                gid = cat.get("id", "")
                proposal.shopify_category_gid = gid
                proposal.google_product_category = shopify.google_id_for_shopify_category(gid)
                proposal.term_id = f"shopify:{gid}"
                proposal.class_id = "Offering"
                proposal.graph_label = "Offering"
                proposal.decision = ProposalDecision.NEW_TERM
                proposal.cdc = {
                    "stop_dynamic_key": signal.field,
                    "mode": "taxonomy_term",
                }
                proposal.confidence = max(proposal.confidence, 0.82)
                proposal.gate = ApplyGate.AUTO
                proposal.rationale = f"Shopify category {cat.get('full_name')}"

        # Product attributes (color/size) — TaxonomyAttribute, not category
        if signal.field.lower() in ("color", "size", "material"):
            gid = proposal.shopify_category_gid or "gid://shopify/TaxonomyCategory/aa"
            attr = shopify.resolve_product_attribute(signal.field, gid)
            if attr:
                proposal.class_id = proposal.class_id or "Offering"
                proposal.graph_label = proposal.graph_label or "Offering"
                proposal.shopify_attributes = [
                    {
                        "id": attr["id"],
                        "name": attr["name"],
                        "value": str(signal.sample_values[0]) if signal.sample_values else "",
                    }
                ]
                proposal.decision = ProposalDecision.REUSE
                proposal.cdc = proposal.cdc or {"stop_dynamic_key": signal.field, "mode": "shopify_attribute"}
                proposal.cdc["mode"] = "shopify_attribute"
                proposal.gate = ApplyGate.AUTO
                proposal.rationale = (proposal.rationale or "") + "; Shopify attribute not new class"

        if understanding.value_shape == "measurement" and route == "healthcare_clinical":
            proposal.term_id = proposal.term_id or (
                "loinc:85354-9" if "blood" in signal.field.lower() or "bp" in signal.field.lower() else "loinc:generic"
            )
            proposal.class_id = "ClinicalObservation"
            proposal.graph_label = "ClinicalObservation"

        if understanding.value_shape == "coded_condition":
            proposal.class_id = "MedicalCondition"
            proposal.graph_label = "MedicalCondition"
            proposal.term_id = proposal.term_id or "icd:unspecified"

        return proposal
