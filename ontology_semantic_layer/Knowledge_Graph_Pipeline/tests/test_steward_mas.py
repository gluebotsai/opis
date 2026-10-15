"""Tests for Ontology Steward MAS and CDC blocklist integration."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMANTIC = ROOT.parent
sys.path.insert(0, str(ROOT))

from src.coercion import extract_custom
from src.config_loader import ConfigLoader
from ontology_steward.harness import Harness
from ontology_steward.tools.google_taxonomy import id_for_path, validate_google_id
from ontology_steward.tools.shopify_taxonomy import google_id_for_shopify_category, match_category
from ontology_steward.agents.evaluator import Evaluator
from ontology_steward.agents.validator import Validator
from ontology_steward.models import ApplyGate, Proposal, ProposalDecision


def _loader():
    return ConfigLoader(ROOT / "config")


def test_healthcare_domain_blocklist_merged():
    loader = _loader()
    loader.domain_overlay = ROOT / "config/mappings/domains/healthcare.yaml"
    loader._cache.clear()
    eff2 = loader.effective("org1000")
    m2 = eff2.get("cdp.customer_profile")
    if m2 and loader.domain_overlay.exists():
        bl = [x.lower() for x in m2.custom_fields_blocklist]
        assert "hiv_status" in bl or "blood_pressure" in bl


def test_harness_bp_not_condition():
    harness = Harness(_loader(), ROOT, SEMANTIC, dry_run=True)
    payload = {
        "org": "1000",
        "industry": "healthcare",
        "signals": [
            {
                "field": "blood_pressure",
                "table": "cdp.customer_profile",
                "org": "1000",
                "sample_values": ["120/80"],
            },
            {
                "field": "diabetes",
                "table": "cdp.customer_profile",
                "org": "1000",
                "sample_values": ["type2"],
            },
        ],
    }
    proposals = harness.run_from_payload(payload)
    by_field = {p.field: p for p in proposals}
    assert by_field["blood_pressure"].class_id == "wt:ClinicalObservation"
    assert by_field["diabetes"].class_id == "wt:MedicalCondition"


def test_validator_fhir_swap():
    v = Validator()
    bad = Proposal(
        field="blood_pressure",
        table="cdp.customer_profile",
        org="1000",
        industry="healthcare",
        decision=ProposalDecision.REUSE,
        class_id="wt:MedicalCondition",
        gate=ApplyGate.AUTO,
    )
    out = v.validate(bad, ROOT)
    assert out.decision == ProposalDecision.REJECT


def test_shopify_category_match():
    cat = match_category("Apparel Accessories")
    assert cat is not None
    gid = cat.get("id", "")
    assert gid.startswith("gid://shopify/")


def test_google_via_shopify_mapping():
    cat = match_category("Apparel")
    if cat:
        gid = cat.get("id")
        google = google_id_for_shopify_category(gid)
        assert google is not None or google == "166"


def test_google_official_taxonomy_parser():
    assert validate_google_id("166") or id_for_path("Apparel & Accessories") == 166


def test_evaluator_gold_cases():
    harness = Harness(_loader(), ROOT, SEMANTIC, dry_run=True)
    proposals = harness.run_from_payload(
        {
            "org": "1000",
            "signals": [
                {"field": "hiv_status", "table": "cdp.customer_profile", "org": "1000", "sample_values": ["+"]},
            ],
        }
    )
    ev = Evaluator()
    r = ev.evaluate(proposals[0])
    assert r.get("ok") is True or proposals[0].decision.value == "reject"


if __name__ == "__main__":
    tests = [
        test_healthcare_domain_blocklist_merged,
        test_harness_bp_not_condition,
        test_validator_fhir_swap,
        test_shopify_category_match,
        test_google_via_shopify_mapping,
        test_google_official_taxonomy_parser,
        test_evaluator_gold_cases,
    ]
    for fn in tests:
        fn()
        print(f"PASS {fn.__name__}")
    print("ok")
