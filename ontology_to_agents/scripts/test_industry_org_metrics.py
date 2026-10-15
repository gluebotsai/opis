#!/usr/bin/env python3
"""Tests: industry packs, org metrics overlays, noun map, logging."""

from __future__ import annotations

import logging
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import yaml

from api.logging_setup import configure_logging
from ontology.slice import fetch_ontology_slice
from ontology.tenant_metrics import load_org_metrics


def _module_class_ids() -> set[str]:
    modules_dir = ROOT / "ontology" / "modules"
    ids: set[str] = set()
    pat = re.compile(r"^\s*-\s*id:\s*(wt:[^\s]+)", re.MULTILINE)
    for path in modules_dir.glob("*.yml"):
        text = path.read_text(encoding="utf-8")
        for m in pat.finditer(text):
            cid = m.group(1)
            if cid.startswith("wt:action."):
                continue
            ids.add(cid)
    return ids


def test_healthcare_vs_ecommerce_labels() -> None:
    hc = fetch_ontology_slice(preset="cc.ai_support", industry_pack="healthcare")
    ec = fetch_ontology_slice(preset="cc.ai_support", industry_pack="ecommerce")
    # Industry packs label Contact / Ticket (human keys), not wt:* ids.
    assert (
        hc.labels.get("Contact") in ("Patient", "Patient contact")
        or hc.labels.get("wt:Customer") == "Patient"
    ), hc.labels
    assert (
        ec.labels.get("Contact") in ("Buyer", "Shopper")
        or ec.labels.get("wt:Customer") == "Buyer"
    ), ec.labels
    assert "appointment_change" in str(hc.taxonomy.get("intent", {}))
    assert "order_status" in str(ec.taxonomy.get("intent", {}))


def test_org1000_thresholds_not_in_prompt() -> None:
    pack = fetch_ontology_slice(
        agent="tk.reporting", tenant="org1000", product="ticketing"
    )
    prompt = pack.as_prompt()
    assert "threshold:" not in prompt, prompt
    assert pack.org_metric_overlays.get("open_tickets_metric"), pack.org_metric_overlays


def test_org1008_no_metrics_file() -> None:
    overlays = load_org_metrics("org1008")
    assert overlays == {}
    pack = fetch_ontology_slice(
        agent="crm.deals", tenant="org1008", product="crm"
    )
    assert "threshold:" not in pack.as_prompt() or "warn 25" not in pack.as_prompt()


def test_tenant_synonyms_in_prompt() -> None:
    pack = fetch_ontology_slice(
        agent="ticket_lifecycle_executor", tenant="org1000", product="ticketing"
    )
    prompt = pack.as_prompt()
    assert "synonyms:" in prompt
    # Product ontology synonyms are keyed by entity name (Ticket), not SupportCase.
    assert "Ticket:" in prompt
    assert "case" in prompt.lower()
    assert "wt:Ticket" not in prompt
    assert "SupportCase" not in prompt


def test_noun_map_coverage() -> None:
    noun_path = ROOT / "ontology" / "noun_map.yml"
    data = yaml.safe_load(noun_path.read_text(encoding="utf-8"))
    mapped = set(data.get("onto_core", {}).values())
    mapped |= set(data.get("aiccaas_semantic_models", {}).values())
    mapped |= set(data.get("ticketing_semantic_models", {}).values())
    mapped |= set(data.get("agent_only_types") or [])
    missing = sorted(_module_class_ids() - mapped)
    assert not missing, f"Module classes missing from noun_map: {missing[:20]}"


def test_error_log_written() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        configure_logging(Path(tmp))
        log = logging.getLogger("test.industry_org_metrics")
        log.error("test_error_log_marker_industry_org")
        err_file = Path(tmp) / "error.log"
        assert err_file.is_file()
        assert "test_error_log_marker_industry_org" in err_file.read_text(encoding="utf-8")


def main() -> int:
    tests = [
        test_healthcare_vs_ecommerce_labels,
        test_org1000_thresholds_not_in_prompt,
        test_org1008_no_metrics_file,
        test_tenant_synonyms_in_prompt,
        test_noun_map_coverage,
        test_error_log_written,
    ]
    for fn in tests:
        fn()
        print(f"PASS  {fn.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
