"""Hardened tests for Ontology Steward MAS verification plan."""

import json
import sys
import tempfile
from pathlib import Path

import yaml

try:
    import pytest
except ImportError:
    pytest = None

ROOT = Path(__file__).resolve().parent.parent
SEMANTIC = ROOT.parent
sys.path.insert(0, str(ROOT))

from src.coercion import extract_custom
from src.config_loader import ConfigLoader, PropertySpec, resolve_domain_overlay


def _loader():
    return ConfigLoader(ROOT / "config")


if pytest:
    @pytest.fixture
    def loader():
        return _loader()


def test_blocklist_on_explicit_custom_property():
    out = extract_custom(
        {"custom_fields": {"hiv_status": "positive"}},
        "custom_fields",
        [PropertySpec(name="hiv_status", type="string", source="custom")],
        custom_dynamic=False,
        blocklist=["hiv_status"],
        blocklist_action="drop_silently_and_log",
    )
    assert "custom_hiv_status" not in out


def test_whitelist_case_insensitive():
    out = extract_custom(
        {"custom_fields": {"MRN": "1", "extra": "x"}},
        "custom_fields",
        [],
        custom_dynamic=True,
        whitelist=["mrn"],
    )
    assert "custom_MRN" in out
    assert "custom_extra" not in out


def test_resolve_domain_overlay_healthcare():
    path = resolve_domain_overlay(ROOT / "config" / "mappings", "healthcare")
    assert path is not None
    assert path.name == "healthcare.yaml"


def test_merge_custom_fields_promote_to_node(loader):
    loader.domain_overlay = ROOT / "config/mappings/domains/healthcare.yaml"
    loader._cache.clear()
    eff = loader.effective("org1000")
    m = eff.get("cdp.customer_profile")
    assert m is not None
    assert "payer" in m.promote_property_to_node
    bl = [x.lower() for x in m.custom_fields_blocklist]
    assert "hiv_status" in bl


def test_domain_auto_from_semantic_pack(loader):
    loader._cache.clear()
    eff = loader.effective("org1000")
    assert eff.industry is None or eff.get("cdp.customer_profile") is not None


_GOLD_CASE_IDS = [
    "auto_vin_first",
    "auto_vin_reuse",
    "bp_observation",
    "glucose_observation",
    "diabetes_condition",
    "blood_group_enum",
    "shopify_category",
    "product_color",
    "phi_hiv",
    "junk_tmp",
]


def test_gold_case(case_id):
    from ontology_steward.harness import Harness
    from ontology_steward.agents.evaluator import Evaluator
    from ontology_steward.eval.run_eval import _synthetic_payload

    harness = Harness(ConfigLoader(ROOT / "config"), ROOT, SEMANTIC, dry_run=True)
    payload = _synthetic_payload("1000")
    proposals = harness.run_from_payload(payload)
    by_field = {p.field: p for p in proposals}
    cases = yaml.safe_load((ROOT / "ontology_steward/eval/cases.yml").read_text())["cases"]
    case = next(c for c in cases if c["id"] == case_id)
    proposal = by_field[case["field"]]
    result = Evaluator().evaluate(proposal, case_id=case_id)
    assert result["ok"], result.get("reasons")


if pytest:
    test_gold_case = pytest.mark.parametrize("case_id", _GOLD_CASE_IDS)(test_gold_case)


def test_eval_harness_ok():
    from ontology_steward.eval.run_eval import main as eval_main

    assert eval_main([]) == 0


def test_e2e_steward_mas_ok():
    from scripts.e2e_steward_mas import main as e2e_main

    assert e2e_main() == 0


def test_apply_integration_bp_overlay():
    from ontology_steward.harness import Harness
    from ontology_steward.agents.applicator import Applicator
    from ontology_steward.models import StewardContext

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        pipe = tmp_path / "pipe"
        sem = tmp_path / "sem"
        (pipe / "config" / "mappings").mkdir(parents=True)
        (sem / "ontology").mkdir(parents=True)
        (sem / "tenants" / "org9999").mkdir(parents=True)
        (sem / "tenants/org9999/semantic.yaml").write_text("extra_modules: []\n")
        (sem / "ontology/noun_map.yml").write_text("{}\n")
        (pipe / "ontology_steward/registry").mkdir(parents=True)
        for name in ("types.yml", "stop_keys.yml", "promotion.yml"):
            src = ROOT / "ontology_steward/registry" / name
            if src.exists():
                (pipe / "ontology_steward/registry" / name).write_text(src.read_text())

        harness = Harness(ConfigLoader(ROOT / "config"), pipe, sem, dry_run=True)
        proposals = harness.run_from_payload(
            {
                "org": "9999",
                "industry": "healthcare",
                "signals": [
                    {
                        "field": "blood_pressure",
                        "table": "cdp.customer_profile",
                        "org": "9999",
                        "sample_values": ["120/80"],
                    }
                ],
            }
        )
        bp = proposals[0]
        ctx = StewardContext(
            repo_root=str(sem),
            pipeline_root=str(pipe),
            semantic_root=str(sem),
            org="9999",
        )
        app = Applicator(pipe, sem)
        result = app.apply(ctx, bp, force=True)
        overlay = pipe / "config/mappings/org9999.yaml"
        assert overlay.exists()
        doc = yaml.safe_load(overlay.read_text())
        bl = doc["extends"]["cdp.customer_profile"]["custom_fields"]["blocklist"]
        assert "blood_pressure" in bl
        mig_dir = pipe / "ontology_steward/proposals/migrations"
        assert mig_dir.exists() or "migration_cypher" in result.get("steps", [])


if __name__ == "__main__":
    test_blocklist_on_explicit_custom_property()
    test_whitelist_case_insensitive()
    test_resolve_domain_overlay_healthcare()
    test_merge_custom_fields_promote_to_node(ConfigLoader(ROOT / "config"))
    test_domain_auto_from_semantic_pack(ConfigLoader(ROOT / "config"))
    test_eval_harness_ok()
    test_e2e_steward_mas_ok()
    test_apply_integration_bp_overlay()
    from ontology_steward.eval.run_eval import _synthetic_payload
    from ontology_steward.harness import Harness
    from ontology_steward.agents.evaluator import Evaluator

    harness = Harness(ConfigLoader(ROOT / "config"), ROOT, SEMANTIC, dry_run=True)
    payload = _synthetic_payload("1000")
    proposals = harness.run_from_payload(payload)
    by_field = {p.field: p for p in proposals}
    cases = yaml.safe_load((ROOT / "ontology_steward/eval/cases.yml").read_text())["cases"]
    for case in cases:
        if case["id"] == "dealership_vin":
            continue
        if case["field"] not in by_field:
            continue
        r = Evaluator().evaluate(by_field[case["field"]], case_id=case["id"])
        assert r["ok"], f"{case['id']}: {r.get('reasons')}"
        print(f"PASS gold {case['id']}")
    print("ok")
