#!/usr/bin/env python3
"""E2E dry-run: automotive + healthcare fixtures; slice scope check."""

from __future__ import annotations

import json
import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
SEMANTIC_ROOT = PIPELINE_ROOT.parent
sys.path.insert(0, str(PIPELINE_ROOT))


def _norm(class_id: str | None) -> str:
    return str(class_id or "").removeprefix("wt:")


def main() -> int:
    from src.config_loader import ConfigLoader
    from ontology_steward.harness import Harness
    from ontology_steward.tools.slice_writer import check_slice_scope

    loader = ConfigLoader(PIPELINE_ROOT / "config")
    harness = Harness(loader, PIPELINE_ROOT, SEMANTIC_ROOT, dry_run=True)

    auto = harness.run_from_payload(
        {
            "org": "1000",
            "industry": "automotive",
            "signals": [
                {"field": "vin", "table": "cdp.customer_profile", "org": "1000", "sample_values": ["1HGCM82633A004352"]},
            ],
        }
    )
    health = harness.run_from_payload(
        {
            "org": "1000",
            "industry": "healthcare",
            "signals": [
                {"field": "blood_pressure", "table": "cdp.customer_profile", "org": "1000", "sample_values": ["120/80"]},
                {"field": "diabetes", "table": "cdp.customer_profile", "org": "1000", "sample_values": ["type2"]},
            ],
        }
    )

    scope = check_slice_scope(
        SEMANTIC_ROOT,
        "1000",
        "Vehicle",
        "automotive",
        compare_tenant="1000",
        compare_industry_pack="ecommerce",
    )

    report = {
        "auto_vin_class": _norm(auto[0].class_id) if auto else None,
        "bp_class": _norm(health[0].class_id) if health else None,
        "diabetes_class": _norm(health[1].class_id) if len(health) > 1 else None,
        "slice_scope": scope,
        "ok": (
            auto
            and _norm(auto[0].class_id) == "Vehicle"
            and health
            and _norm(health[0].class_id) == "ClinicalObservation"
            and len(health) > 1
            and _norm(health[1].class_id) == "MedicalCondition"
            and scope.get("excluded_other")
            and not scope.get("included")
        ),
    }
    print(json.dumps(report, indent=2, default=str))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
