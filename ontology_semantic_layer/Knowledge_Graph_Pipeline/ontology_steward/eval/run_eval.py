#!/usr/bin/env python3
"""Run gold-case harness without Applicator (unless --apply-integration)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent.parent
SEMANTIC_ROOT = PIPELINE_ROOT.parent
sys.path.insert(0, str(PIPELINE_ROOT))


def _pg_conn_factory():
    from ontology_steward.tools.pg_conn import steward_pg_conn_factory

    return steward_pg_conn_factory()


def _seed_pg_fixtures(org: str, conn_factory) -> bool:
    """Insert gold-case keys into existing JSONB columns (eval org only)."""
    fixtures = {
        "vin": "1HGCM82633A004352",
        "chassis_no": "CH123",
        "blood_pressure": "120/80",
        "glucose": 95,
        "diabetes": "type2",
        "blood_group": "A+",
        "hiv_status": "positive",
        "tmp_foo_debug": "x",
    }
    sql = """
        UPDATE cdp.customer_profile
        SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || %s::jsonb
        WHERE organization_id = %s
    """
    try:
        with conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (json.dumps(fixtures), org))
            conn.commit()
        return True
    except Exception:
        return False


def _synthetic_payload(org: str) -> dict:
    """Synthetic signals when Postgres is unavailable."""
    return {
        "org": org,
        "industry": "healthcare",
        "signals": [
            {"field": "vin", "table": "cdp.customer_profile", "org": org, "sample_values": ["1HGCM82633A004352"], "source": "custom_json"},
            {"field": "chassis_no", "table": "cdp.customer_profile", "org": org, "sample_values": ["CH123"], "source": "custom_json"},
            {"field": "blood_pressure", "table": "cdp.customer_profile", "org": org, "sample_values": ["120/80"], "source": "custom_json"},
            {"field": "glucose", "table": "cdp.customer_profile", "org": org, "sample_values": [95], "source": "custom_json"},
            {"field": "diabetes", "table": "cdp.customer_profile", "org": org, "sample_values": ["type2"], "source": "custom_json"},
            {"field": "blood_group", "table": "cdp.customer_profile", "org": org, "sample_values": ["A+"], "source": "custom_json"},
            {"field": "category", "table": "inventory.products", "org": org, "sample_values": ["Apparel Accessories"], "source": "custom_json"},
            {"field": "color", "table": "inventory.products", "org": org, "sample_values": ["Red"], "source": "custom_json"},
            {"field": "product_name", "table": "inventory.products", "org": org, "sample_values": ["brake pad"], "source": "custom_json"},
            {"field": "hiv_status", "table": "cdp.customer_profile", "org": org, "sample_values": ["positive"], "source": "custom_json"},
            {"field": "tmp_foo_debug", "table": "cdp.customer_profile", "org": org, "sample_values": ["x"], "source": "custom_json"},
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", default="1000")
    parser.add_argument("--apply-integration", action="store_true")
    parser.add_argument("--pg-detect", action="store_true", help="Run Detector.from_pg after seeding")
    args = parser.parse_args(argv)

    from src.config_loader import ConfigLoader
    from ontology_steward.harness import Harness
    from ontology_steward.agents.evaluator import Evaluator
    from ontology_steward.models import StewardContext
    from ontology_steward.agents.applicator import Applicator

    loader = ConfigLoader(PIPELINE_ROOT / "config")
    conn_factory = _pg_conn_factory()
    harness = Harness(loader, PIPELINE_ROOT, SEMANTIC_ROOT, conn_factory=conn_factory, dry_run=not args.apply_integration)
    payload = _synthetic_payload(args.org)
    if conn_factory:
        payload["pg_seeded"] = _seed_pg_fixtures(args.org, conn_factory)

    if args.pg_detect and conn_factory and payload.get("pg_seeded"):
        proposals = harness.run_org(args.org, apply=False)
    else:
        proposals = harness.run_from_payload(payload, apply=False)
    evaluator = Evaluator()
    report = evaluator.evaluate_all(proposals)

    # Per-case explicit checks
    by_field = {p.field: p for p in proposals}
    failures: list[str] = []

    bp = by_field.get("blood_pressure")
    if bp and bp.class_id in ("MedicalCondition", "wt:MedicalCondition"):
        failures.append("FHIR swap: BP as Condition")

    diabetes = by_field.get("diabetes")
    if diabetes and diabetes.class_id in ("ClinicalObservation", "wt:ClinicalObservation"):
        failures.append("FHIR swap: diabetes as Observation")

    hiv = by_field.get("hiv_status")
    if hiv and hiv.decision.value != "reject":
        failures.append("PHI should reject")

    chassis = by_field.get("chassis_no")
    if chassis and chassis.class_id not in ("Vehicle", "wt:Vehicle"):
        failures.append("second org should reuse Vehicle")

    if args.apply_integration:
        ctx = StewardContext(
            repo_root=str(SEMANTIC_ROOT),
            pipeline_root=str(PIPELINE_ROOT),
            semantic_root=str(SEMANTIC_ROOT),
            org=args.org,
        )
        app = Applicator(PIPELINE_ROOT, SEMANTIC_ROOT)
        if bp:
            app.apply(ctx, bp, force=True)
        org_overlay = PIPELINE_ROOT / "config" / "mappings" / f"org{args.org}.yaml"
        if not org_overlay.exists():
            failures.append("integration: org overlay not written")

    report["explicit_failures"] = failures
    report["ok"] = report["failed"] == 0 and not failures
    print(json.dumps(report, indent=2, default=str))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
