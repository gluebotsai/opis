#!/usr/bin/env python3
"""End-to-end validation for compact ontology architecture."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError:
    print("FAIL  PyYAML required")
    sys.exit(1)

from ontology.slice import (
    METRICS_MODULE_PREFIX,
    fetch_ontology_slice,
    get_catalog,
    list_presets,
)
from semantic.agent_grants import GRANTS_PATH, grant_candidates, load_grants
from semantic.ownership import (
    agent_preset,
    clear_ownership_cache,
    compute_agent_entitlements,
    compute_agent_entitlements_from_ownership,
    load_agents_index,
    load_ownership,
    mas_catalog_for_agent,
    reporting_agent_for_product,
)


def _load_preset_metrics() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    presets_dir = ROOT / "ontology" / "presets"
    for path in sorted(presets_dir.glob("*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for pid, spec in (data.get("presets") or {}).items():
            if isinstance(spec, dict):
                out[pid] = list((spec.get("prompt") or {}).get("metrics") or [])
    return out


def main() -> int:
    clear_ownership_cache()
    failed = 0
    catalog = get_catalog()
    agents = load_agents_index()
    ownership = load_ownership()
    preset_metrics = _load_preset_metrics()
    catalog_yaml = yaml.safe_load((ROOT / "ontology/catalog.yml").read_text()) or {}

    # 1. catalog has no presets block
    if "presets" in catalog_yaml:
        print("  FAIL  catalog.yml still contains presets: block")
        failed += 1
    else:
        print("  OK    catalog.yml has no presets block")

    # 2. presets loaded
    presets = list_presets()
    if len(presets) < 55:
        print(f"  FAIL  expected ~60+ presets, got {len(presets)}")
        failed += 1
    else:
        print(f"  OK    {len(presets)} presets loaded from ontology/presets/")

    # 3. no embedded metrics in presets
    bad = {k: v for k, v in preset_metrics.items() if v}
    if bad:
        print(f"  FAIL  presets with prompt.metrics: {list(bad)[:5]}")
        failed += 1
    else:
        print("  OK    all presets have empty prompt.metrics")

    # 4. every agent preset exists
    missing_presets = []
    for aid, cfg in agents.items():
        preset = cfg.get("preset")
        if preset and preset not in presets:
            missing_presets.append(f"{aid}->{preset}")
    if missing_presets:
        print(f"  FAIL  agents with unknown preset: {missing_presets[:5]}")
        failed += 1
    else:
        print(f"  OK    all {len(agents)} agents resolve to known presets")

    # 5. no metrics_* on agents
    metrics_on_agents = [
        aid
        for aid, cfg in agents.items()
        if any(str(m).startswith(METRICS_MODULE_PREFIX) for m in (cfg.get("modules") or []))
    ]
    if metrics_on_agents:
        print(f"  FAIL  agents still attach metrics modules: {metrics_on_agents}")
        failed += 1
    else:
        print("  OK    no metrics_* modules on agents.yml entries")

    # 6. grants file exists and matches ownership
    if not GRANTS_PATH.is_file():
        print("  FAIL  ontology/agent_metrics.yml missing")
        failed += 1
    else:
        grants = load_grants()
        grant_agents = sum(len(v) for v in (grants.get("products") or {}).values())
        ent = compute_agent_entitlements()
        own = compute_agent_entitlements_from_ownership()
        mism = [
            aid
            for aid in own
            if sorted(ent.get(aid, [])) != sorted(own[aid])
        ]
        extra_grants = sorted(set(ent) - set(own))
        if mism:
            print(f"  FAIL  grants/ownership metric drift: {mism[:5]}")
            failed += 1
        else:
            print(
                f"  OK    agent_metrics.yml ({grant_agents} entries) matches ownership "
                f"({len(extra_grants)} explicit empty grants)"
            )

    # 7. reporting agents have full explicit grants
    for product in ("contact_centre", "ticketing", "crm", "campaign", "cdp"):
        rep = reporting_agent_for_product(product)
        if not rep:
            continue
        entry = None
        for bucket in (grants.get("products") or {}).values():
            if rep in bucket:
                entry = bucket[rep]
                break
        metrics = entry.get("metrics") if entry else None
        if not isinstance(metrics, list) or not metrics:
            print(f"  FAIL  reporting {rep} missing explicit metrics grant")
            failed += 1
    print("  OK    reporting agents have explicit metric grants")

    # 7b. ticketing harness agents (31) map to tk.* presets with non-empty slices
    harness_agents = [
        "ticketing_super_agent",
        "intake_deflection_domain",
        "triage_routing_domain",
        "resolution_lifecycle_domain",
        "knowledge_domain",
        "catalog_administration_domain",
        "ai_resolution_executor",
        "ticket_creation_executor",
        "classification_priority_executor",
        "intelligent_assignment_executor",
        "workload_optimization_executor",
        "root_cause_learning_executor",
        "ticket_lifecycle_executor",
        "sla_escalation_executor",
        "investigation_summary_executor",
        "customer_reply_drafting_executor",
        "autonomous_resolution_executor",
        "resolution_quality_executor",
        "personalized_notification_executor",
        "insights_analytics_executor",
        "resolution_knowledge_executor",
        "similar_ticket_detection_executor",
        "team_queue_crud_executor",
        "kb_quality_crud_executor",
        "macro_crud_executor",
        "customer_directory_crud_executor",
        "priority_status_crud_executor",
        "org_settings_integrations_executor",
        "notification_inbox_executor",
        "analytics_audit_query_executor",
        "automation_rule_crud_executor",
    ]
    reporting_executors = {
        "analytics_audit_query_executor",
        "insights_analytics_executor",
    }
    harness_bad = []
    for aid in harness_agents:
        cfg = agents.get(aid) or {}
        preset = str(cfg.get("preset") or "")
        if not preset.startswith("tk."):
            harness_bad.append(f"{aid}->{preset}")
            continue
        try:
            pack = fetch_ontology_slice(
                agent=aid, tenant="org1000", product="ticketing", user_id=1001
            )
            prompt = pack.as_prompt()
            ont = yaml.safe_load(prompt).get("ontology") or {}
            ents = ont.get("entities") or {}
            _, _, _actions, metrics, _, _ = pack._view("compact")
            if not ents:
                harness_bad.append(f"{aid} empty slice")
            elif "wt:" in prompt:
                harness_bad.append(f"{aid} wt: in prompt")
            elif aid == "ticketing_super_agent" and len(ents) < 21:
                harness_bad.append(f"{aid} incomplete super ontology")
            elif aid != "ticketing_super_agent" and len(ents) >= 21:
                harness_bad.append(f"{aid} should be subset of product ontology")
            elif aid in reporting_executors and not metrics:
                harness_bad.append(f"{aid} missing compact metrics")
            elif aid not in reporting_executors and metrics:
                harness_bad.append(f"{aid} unexpected metrics")
        except Exception as exc:
            harness_bad.append(f"{aid}: {exc}")
    if harness_bad:
        print(f"  FAIL  ticketing harness slice issues: {harness_bad[:5]}")
        failed += 1
    else:
        print(f"  OK    {len(harness_agents)} ticketing harness agents resolve to tk.* presets")

    for proactive_id in ("tiaa", "dssa"):
        try:
            fetch_ontology_slice(
                agent=proactive_id, tenant="org1000", product="ticketing", user_id=1001
            )
            print(f"  FAIL  proactive id {proactive_id} should fail closed")
            failed += 1
        except ValueError:
            pass
    else:
        print("  OK    proactive ids tiaa/dssa fail closed")

    # 8. slice fetch smoke tests
    smoke = [
        ("ticketing_super_agent", "ticketing", True),
        ("ticket_lifecycle_executor", "ticketing", False),
        ("analytics_audit_query_executor", "ticketing", False),
        ("cc.reporting", "contact_centre", False),
        ("cc.super", "contact_centre", True),
    ]
    for agent, product, expect_empty in smoke:
        try:
            pack = fetch_ontology_slice(
                agent=agent, tenant="org1000", product=product, user_id=1001
            )
            _, _, _, metrics, _, _ = pack._view("compact")
            if expect_empty and metrics:
                print(f"  FAIL  {agent} compact metrics should be empty: {metrics[:3]}")
                failed += 1
            elif not expect_empty and agent.endswith("_executor"):
                granted = grant_candidates(agent, product)
                if granted is None:
                    print(f"  FAIL  {agent} has no grant candidates")
                    failed += 1
        except Exception as exc:
            print(f"  FAIL  slice fetch {agent}: {exc}")
            failed += 1
    print("  OK    slice fetch smoke tests passed")

    # 8b. ticketing product ontology (ontoYMLs/ticketing.yml)
    super_pack = fetch_ontology_slice(
        agent="ticketing_super_agent", tenant="org1000", product="ticketing", user_id=1001
    )
    super_prompt = super_pack.as_prompt()
    if (
        "ticketing_complete_ontology" not in super_prompt
        or "entities:" not in super_prompt
        or "Ticket:" not in super_prompt
        or "identifier: ticketing.tickets.id" not in super_prompt
        or "wt:" in super_prompt
        or "SupportCase" in super_prompt
    ):
        print("  FAIL  super prompt missing ticketing product ontology")
        failed += 1
    elif super_prompt.count("definition:") < 21:
        print(
            f"  FAIL  super prompt too few entity definitions "
            f"({super_prompt.count('definition:')} < 21)"
        )
        failed += 1
    else:
        print("  OK    super prompt is full ticketing product ontology")

    hub_prompt = fetch_ontology_slice(
        preset="hub.orchestrator",
        tenant="org1000",
        products=["ticketing", "crm"],
    ).as_prompt()
    # Hub still unions graph for non-ticketing; accept Ticket (product) or legacy SupportCase
    if ("Ticket" not in hub_prompt and "SupportCase" not in hub_prompt) or (
        "Opportunity" not in hub_prompt and "Deal" not in hub_prompt
    ):
        print("  FAIL  hub prompt missing union of product graph labels")
        failed += 1
    else:
        print("  OK    hub prompt unions entitled product graphs")

    try:
        fetch_ontology_slice(agent="tk.super", tenant="org1010", product="ticketing")
        print("  OK    missing tenant yaml falls back to base ontology")
    except ValueError as exc:
        if "Tenant semantic not found" in str(exc):
            print(f"  FAIL  missing tenant yaml should not raise: {exc}")
            failed += 1
        else:
            raise

    mas_agents = [
        ("cc.reporting_mas", "contact_centre"),
        ("tk.reporting_mas", "ticketing"),
        ("crm.reporting_mas", "crm"),
        ("camp.reporting_mas", "campaign"),
        ("cdp.reporting_mas", "cdp"),
    ]
    for aid, prod in mas_agents:
        if aid not in agents:
            print(f"  FAIL  {aid} not in agents.yml")
            failed += 1
            continue
        if prod == "webtracking":
            mcount = len(mas_catalog_for_agent(aid, prod))
        else:
            mp = fetch_ontology_slice(
                agent=aid, tenant="org1000", product=prod, user_id=1001
            )
            _, _, _, mmet, _, _ = mp._view("compact")
            mcount = len(mmet)
        if mcount < 5:
            print(f"  FAIL  {aid} metrics too few ({mcount})")
            failed += 1
    print("  OK    five reporting_mas agents registered with full metric packs")

    # 9. unknown agent fails closed
    try:
        fetch_ontology_slice(agent="not_a_real_agent", tenant="org1000", product="ticketing")
        print("  FAIL  unknown agent should raise")
        failed += 1
    except ValueError:
        print("  OK    unknown agent raises ValueError")

    # 10. module gates on catalog
    workforce = (catalog_yaml.get("modules") or {}).get("workforce") or {}
    booking = (catalog_yaml.get("modules") or {}).get("booking") or {}
    if not workforce.get("requires_feature") or not booking.get("requires_feature"):
        print("  FAIL  workforce/booking missing requires_feature")
        failed += 1
    else:
        print("  OK    workforce + booking have feature gates")

    # 11. product module lists exclude metrics_*
    for prod, spec in (catalog_yaml.get("products") or {}).items():
        mods = spec.get("modules") or []
        bad_mods = [m for m in mods if str(m).startswith(METRICS_MODULE_PREFIX)]
        if bad_mods:
            print(f"  FAIL  products.{prod} lists metrics modules: {bad_mods}")
            failed += 1
    print("  OK    product module lists exclude metrics_*")

    # 12. semantic metric catalogs
    for prod in ("ticketing", "ccaas"):
        path = ROOT / "semantic/metrics" / f"{prod}.yml"
        if not path.is_file():
            print(f"  FAIL  missing {path}")
            failed += 1
        else:
            data = yaml.safe_load(path.read_text()) or {}
            n = len(data.get("metrics") or {})
            if n < 1:
                print(f"  FAIL  empty catalog {path}")
                failed += 1
    print("  OK    semantic/metrics catalogs present")

    # 13. tenant overlay
    overlay = ROOT / "tenants/org1000/overlay.yml"
    if not overlay.is_file():
        print("  FAIL  tenants/org1000/overlay.yml missing")
        failed += 1
    else:
        print("  OK    tenant overlay present")

    # 14. graph definitions + no wt: on prompts
    from scripts.validate_graph_definitions import main as validate_graph_defs

    if validate_graph_defs() != 0:
        print("  FAIL  graph definitions validation")
        failed += 1
    else:
        print("  OK    graph definitions + prompt hygiene")

    # 15. ticketing product ontology traceback
    from scripts.validate_ticketing_product_ontology import main as validate_tk_product

    if validate_tk_product() != 0:
        print("  FAIL  ticketing product ontology validation")
        failed += 1
    else:
        print("  OK    ticketing product ontology + metrics traceback")

    # 16. webtracking product ontology traceback
    from scripts.validate_webtracking_product_ontology import main as validate_wt_product

    if validate_wt_product() != 0:
        print("  FAIL  webtracking product ontology validation")
        failed += 1
    else:
        print("  OK    webtracking product ontology + metrics traceback")

    print(f"\n{failed} validation failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
