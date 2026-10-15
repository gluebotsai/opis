#!/usr/bin/env python3
"""CI gate: certified metrics are owned by reporting + MAS specialist agents."""

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

from unittest.mock import MagicMock, patch

from semantic.agent_grants import GRANTS_PATH, compute_agent_entitlements_from_grants
from semantic.context import _clip_taxonomy_channel, resolve_context
from semantic.entitlements import spoke_product_entitled
from semantic.lookup import get_metric_policy, is_certified
from ontology.slice import get_catalog
from ontology.slice import fetch_ontology_slice
from semantic.sql.agent_policy import resolve_agent_policy
from semantic.ownership import (
    agent_owned_product,
    clear_ownership_cache,
    compute_agent_entitlements,
    headline_metrics_for_agent,
    is_reporting_agent,
    is_reporting_mas_agent,
    mas_catalog_for_agent,
    list_certified_for_source,
    load_ownership,
    reporting_catalog_for_agent,
    reporting_leftovers_for_source,
    registry_source_for_product,
    specialist_agents_for_metric,
    validate_ticketing_reporting_partition,
)

PRODUCT_FOR_SOURCE = {
    "aiccaas": "contact_centre",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
}


def _load_preset_prompt_metrics() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    presets_dir = ROOT / "ontology" / "presets"
    if presets_dir.is_dir():
        for path in sorted(presets_dir.glob("*.yml")):
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            for aid, val in (data.get("presets") or {}).items():
                if isinstance(val, dict):
                    out[aid] = list((val.get("prompt") or {}).get("metrics") or [])
    return out


def _compact_headlines_for_agent(agent_id: str, product: str) -> list[str]:
    pack = fetch_ontology_slice(
        agent=agent_id,
        tenant="org1000",
        product=product,
        user_id=1001,
    )
    _, _, _, metrics, _, _ = pack._view("compact")
    return list(metrics or [])


def main() -> int:
    clear_ownership_cache()
    ownership = load_ownership()
    headline_max = int(ownership.get("headline_max") or 15)
    never = set(ownership.get("never_assign") or [])
    entitlements = compute_agent_entitlements()
    catalog_prompt = _load_preset_prompt_metrics()
    failed = 0

    registry_reporting = ownership.get("registry_reporting") or {}
    for source_id, rep in registry_reporting.items():
        certified = list_certified_for_source(source_id)
        if isinstance(rep, str):
            api = set(entitlements.get(rep, []))
            product = PRODUCT_FOR_SOURCE.get(source_id, source_id)
            catalog = set(reporting_catalog_for_agent(rep, product) or [])
            certified_set = set(certified)
            missing_from_catalog = sorted(certified_set - catalog)
            if missing_from_catalog:
                print(
                    f"  FAIL  {rep} catalog missing certified metrics for {source_id}: "
                    f"{missing_from_catalog[:5]}"
                )
                failed += 1
            orphans = [m for m in certified if m not in api]
            if orphans:
                print(f"  FAIL  {rep} orphans ({len(orphans)}): {orphans[:5]}...")
                failed += 1
            else:
                print(f"  OK    reporting {rep} owns all {len(certified)} {source_id} metrics")

    for source_id in ("aiccaas", "ticketing", "crm", "campaign"):
        for mid in list_certified_for_source(source_id):
            agents = specialist_agents_for_metric(mid, source_id)
            if not agents:
                continue
            for aid in agents:
                if mid not in set(entitlements.get(aid, [])):
                    print(f"  FAIL  specialist {aid} missing rule metric {mid}")
                    failed += 1

    partition_errors = validate_ticketing_reporting_partition()
    if partition_errors:
        for err in partition_errors:
            print(f"  FAIL  ticketing partition: {err}")
        failed += len(partition_errors)
    else:
        certified_n = len(list_certified_for_source("ticketing"))
        headlines_n = len(headline_metrics_for_agent("tk.reporting") or [])
        leftovers_n = len(reporting_leftovers_for_source("ticketing"))
        print(
            f"  OK    ticketing partition: {headlines_n} headlines + "
            f"{leftovers_n} leftovers = {certified_n} certified"
        )

    reporting_prompt = set(catalog_prompt.get("tk.reporting", []))
    reporting_leftovers = set(reporting_leftovers_for_source("ticketing"))
    leaked = reporting_prompt & reporting_leftovers
    if leaked:
        print(f"  FAIL  tk.reporting prompt includes leftovers: {sorted(leaked)[:5]}")
        failed += 1
    else:
        print("  OK    tk.reporting prompt has headlines only (no leftovers)")

    for aid in never:
        prompt_m = catalog_prompt.get(aid, [])
        if prompt_m:
            print(f"  FAIL  never_assign agent {aid} has prompt metrics: {prompt_m}")
            failed += 1

    preset_metric_violations = 0
    for aid, headlines in (ownership.get("headline_metrics") or {}).items():
        prompt_m = catalog_prompt.get(aid, [])
        if prompt_m:
            print(f"  FAIL  preset {aid} must not embed prompt.metrics (got {len(prompt_m)})")
            failed += 1
            preset_metric_violations += 1
        if len(headlines) > headline_max:
            print(f"  FAIL  {aid} headline exceeds max {headline_max}")
            failed += 1
    if preset_metric_violations == 0:
        print("  OK    presets have no embedded metric lists (grants at runtime)")

    for aid, api_m in entitlements.items():
        if not is_reporting_agent(aid, agent_owned_product(aid)):
            continue
        product = agent_owned_product(aid) or ""
        if product in ("hub",):
            continue
        compact = _compact_headlines_for_agent(aid, product)
        api_set = set(api_m)
        extra = [m for m in compact if m not in api_set]
        if extra:
            print(f"  FAIL  {aid} compact headlines not in API pack: {extra[:5]}")
            failed += 1
        elif compact:
            print(
                f"  OK    {aid} compact headlines ({len(compact)}) ⊆ API ({len(api_m)})"
            )

    for aid, api_m in entitlements.items():
        for mid in api_m:
            if not is_certified(mid):
                print(f"  FAIL  {aid} entitled uncertified {mid}")
                failed += 1
            pol = get_metric_policy(mid)
            if not pol.get("dims") and not pol.get("label"):
                print(f"  WARN  {mid} has no policy dims (scalar-only)")

    if not is_reporting_agent("insights_analytics_executor", "ticketing"):
        print("  FAIL  insights_analytics_executor should be reporting via preset")
        failed += 1
    else:
        print("  OK    insights_analytics_executor is reporting (preset alias)")

    for unknown_proactive in ("tiaa", "dssa"):
        try:
            fetch_ontology_slice(
                agent=unknown_proactive, tenant="org1000", product="ticketing", user_id=1001
            )
            print(f"  FAIL  proactive id {unknown_proactive} should fail closed")
            failed += 1
        except ValueError:
            print(f"  OK    proactive id {unknown_proactive} fails closed")

    if is_reporting_agent("rcaa", "ticketing"):
        print("  FAIL  rcaa should not be reporting")
        failed += 1
    else:
        print("  OK    rcaa is not reporting")

    if is_reporting_agent("ticket_lifecycle_executor", "ticketing"):
        print("  FAIL  ticket_lifecycle_executor should not be reporting")
        failed += 1
    else:
        print("  OK    ticket_lifecycle_executor is not reporting")

    from ontology.ticketing_product import entity_names

    super_pack = fetch_ontology_slice(
        agent="ticketing_super_agent", tenant="org1000", product="ticketing", user_id=1001
    )
    _, _, _, super_metrics, _, _ = super_pack._view("compact")
    super_prompt = super_pack.as_prompt()
    tk_ents = entity_names()
    prompt_ents = set(
        (yaml.safe_load(super_prompt).get("ontology") or {}).get("entities") or {}
    )
    if super_metrics:
        print(f"  FAIL  super slice has metrics: {super_metrics}")
        failed += 1
    elif prompt_ents != tk_ents:
        print(
            f"  FAIL  super prompt entities {len(prompt_ents)} != product file {len(tk_ents)}"
        )
        failed += 1
    elif (
        "entities:" not in super_prompt
        or "Ticket:" not in super_prompt
        or "identifier: ticketing.tickets.id" not in super_prompt
        or "wt:" in super_prompt
        or "SupportCase" in super_prompt
        or super_prompt.count("definition:") < len(tk_ents)
    ):
        print("  FAIL  super prompt missing ticketing product ontology scope")
        failed += 1
    else:
        print("  OK    super slice has empty metrics and full product ontology YAML")

    if is_reporting_mas_agent("tk.reporting_mas", "ticketing"):
        mas_pack = fetch_ontology_slice(
            agent="tk.reporting_mas", tenant="org1000", product="ticketing", user_id=1001
        )
        _, _, _, mas_metrics, _, _ = mas_pack._view("compact")
        hl = set(headline_metrics_for_agent("tk.reporting") or [])
        if not mas_metrics or not hl.issubset(set(mas_metrics)):
            print("  FAIL  tk.reporting_mas metrics do not superset tk.reporting headlines")
            failed += 1
        elif is_reporting_agent("tk.reporting_mas", "ticketing"):
            print("  FAIL  tk.reporting_mas should not be a runtime reporting agent")
            failed += 1
        else:
            print(
                f"  OK    tk.reporting_mas full catalog ({len(mas_metrics)}) "
                f"superset of headlines ({len(hl)})"
            )
    else:
        print("  FAIL  tk.reporting_mas not recognized as MAS agent")
        failed += 1

    try:
        fetch_ontology_slice(
            agent="not_registered_executor", tenant="org1000", product="ticketing"
        )
        print("  FAIL  unknown agent should error")
        failed += 1
    except ValueError:
        print("  OK    unknown agent fails closed")

    reporting_ctx = resolve_context(
        organization_id=1000, user_id=1001, agent="analytics_audit_query_executor", product="ticketing"
    )
    lifecycle_ctx = resolve_context(
        organization_id=1000, user_id=1001, agent="ticket_lifecycle_executor", product="ticketing"
    )
    if "open_tickets_metric" not in reporting_ctx.visible_set():
        print("  FAIL  reporting alias missing open_tickets_metric in allowlist")
        failed += 1
    elif "open_tickets_metric" in lifecycle_ctx.visible_set():
        print("  FAIL  lifecycle executor should not have open_tickets_metric")
        failed += 1
    else:
        print("  OK    semantic allowlist: reporting yes, lifecycle no")

    tickets_policy = resolve_agent_policy(
        organization_id=1000,
        user_id=1001,
        origin_product="ticketing",
        origin_agent="ticket_lifecycle_executor",
    )
    reporting_policy = resolve_agent_policy(
        organization_id=1000,
        user_id=1001,
        origin_product="ticketing",
        origin_agent="analytics_audit_query_executor",
    )
    if not tickets_policy.get("list_only"):
        print("  FAIL  ticket_lifecycle_executor should be SQL list_only")
        failed += 1
    elif reporting_policy.get("list_only"):
        print("  FAIL  analytics executor should not be SQL list_only")
        failed += 1
    else:
        print("  OK    SQL list_only: lifecycle yes, reporting no")

    if not GRANTS_PATH.is_file():
        print("  FAIL  ontology/agent_metrics.yml missing")
        failed += 1
    else:
        grants_ent = compute_agent_entitlements_from_grants()
        if grants_ent != entitlements:
            drift = sorted(set(grants_ent) ^ set(entitlements))
            print(f"  WARN  grants vs ownership drift agents: {drift[:5]}")
        print(f"  OK    agent_metrics.yml loaded ({len(grants_ent)} agents)")

    clipped = _clip_taxonomy_channel(
        {"channel": {"terms": ["email", "whatsapp", "instagram"]}},
        [],
    )
    ch = clipped.get("channel")
    terms = ch.get("terms") if isinstance(ch, dict) else ch
    if terms:
        print("  FAIL  channel taxonomy should be empty when no entitled channels")
        failed += 1
    else:
        print("  OK    channel taxonomy fail-closed")

    metrics_dir = ROOT / "semantic/metrics"
    for prod in ("ticketing", "ccaas"):
        path = metrics_dir / f"{prod}.yml"
        if not path.is_file():
            print(f"  FAIL  missing catalog {path}")
            failed += 1
        else:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            n = len(data.get("metrics") or {})
            print(f"  OK    semantic/metrics/{prod}.yml ({n} metrics)")

    overlay = ROOT / "tenants/org1000/overlay.yml"
    if not overlay.is_file():
        print("  FAIL  tenants/org1000/overlay.yml missing")
        failed += 1
    else:
        from semantic.thresholds import merge_threshold

        merged = merge_threshold("open_tickets_metric", 1000)
        if merged.get("threshold") != {"warn": 25, "critical": 60}:
            print(f"  FAIL  overlay threshold merge: {merged.get('threshold')}")
            failed += 1
        else:
            print("  OK    tenant overlay thresholds wired")

    ent_mock = MagicMock()
    ent_mock.skus = ["crm"]
    ent_mock.has_sku = lambda sku: sku == "crm"
    with patch("semantic.entitlements.load_tenant_entitlements", return_value=ent_mock):
        if spoke_product_entitled(9999, "ticketing"):
            print("  FAIL  unsubscribed ticketing spoke should fail closed")
            failed += 1
        elif not spoke_product_entitled(9999, "crm"):
            print("  FAIL  entitled crm spoke should pass SKU gate")
            failed += 1
        else:
            print("  OK    spoke SKU gate fail-closed")

    ent_no_wfm = MagicMock()
    ent_no_wfm.has_sku.return_value = True
    ent_no_wfm.features_for_product.return_value = []
    with patch("semantic.entitlements.load_tenant_entitlements", return_value=ent_no_wfm):
        kept = get_catalog()._clip_modules_for_entitlements(
            ["workforce", "queue"], tenant="org1000", product="ccaas"
        )
        if "workforce" in kept:
            print("  FAIL  workforce module present without WFM feature")
            failed += 1
        elif "queue" not in kept:
            print("  FAIL  queue module wrongly clipped without WFM requirement")
            failed += 1
        else:
            print("  OK    WFM module clipped without feature")

    ent_no_booking = MagicMock()
    ent_no_booking.has_sku.return_value = True
    ent_no_booking.features_for_product.return_value = ["wfm"]
    with patch("semantic.entitlements.load_tenant_entitlements", return_value=ent_no_booking):
        kept = get_catalog()._clip_modules_for_entitlements(
            ["booking", "interaction"], tenant="org1000", product="ccaas"
        )
        if "booking" in kept:
            print("  FAIL  booking module present without booking feature")
            failed += 1
        elif "interaction" not in kept:
            print("  FAIL  interaction module wrongly clipped")
            failed += 1
        else:
            print("  OK    booking module clipped without feature")

    ent_no_ch = MagicMock()
    ent_no_ch.channels_for_product.return_value = []
    ent_no_ch.has_sku.return_value = True
    ent_no_ch.features_for_product.return_value = ["wfm"]
    with patch("semantic.entitlements.load_tenant_entitlements", return_value=ent_no_ch):
        ctx = resolve_context(
            organization_id=1000,
            user_id=1001,
            agent="analytics_audit_query_executor",
            product="ticketing",
        )
        ch_terms = (ctx.taxonomy.get("channel") or {}).get("terms", [])
        if ch_terms:
            print("  FAIL  channel metrics/taxonomy present with no entitled channels")
            failed += 1
        else:
            print("  OK    channel metrics clipped with empty channels")

    print(f"\n{failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
