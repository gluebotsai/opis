#!/usr/bin/env python3
"""Generate ontology/agent_metrics.yml from agents.yml + metric_ownership.yml."""

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

from semantic.ownership import (
    agent_preset,
    clear_ownership_cache,
    compute_agent_entitlements_from_ownership,
    load_ownership,
    mas_catalog_for_agent,
    reporting_agent_for_product,
    reporting_executor_presets,
)

GRANTS_PATH = ROOT / "ontology" / "agent_metrics.yml"
AGENTS_PATH = ROOT / "ontology" / "agents.yml"

_PRODUCT_NORM = {
    "contact_centre": "contact_centre",
    "ccaas": "contact_centre",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "cdp": "cdp",
    "hub": "hub",
    "webtracking": "webtracking",
}


def _load_agents() -> dict[str, dict]:
    data = yaml.safe_load(AGENTS_PATH.read_text(encoding="utf-8")) or {}
    return data.get("agents") or {}


def _product_for_preset(preset_id: str) -> str | None:
    if preset_id.startswith("cc."):
        return "contact_centre"
    if preset_id.startswith("tk.") or preset_id.endswith("_domain"):
        return "ticketing"
    if preset_id.startswith("crm.") or preset_id in {
        "crm-agent",
        "audit-forecast",
        "enrich-lead",
        "score-lead",
        "assign-sales",
        "meeting-brief-email",
        "analyze-transcript",
    }:
        return "crm"
    if preset_id.startswith("camp."):
        return "campaign"
    if preset_id == "cdp.profile" or preset_id == "cdp.reporting_mas":
        return "cdp"
    if preset_id.startswith("webtracking."):
        return "webtracking"
    return None


def _grant_for_agent(
    agent_id: str,
    owned: str,
    ownership: dict,
    computed: dict[str, list[str]],
) -> str | list[str]:
    never = set(ownership.get("never_assign") or [])
    preset = agent_preset(agent_id) or agent_id
    if preset in never or agent_id in never:
        return []
    if str(preset).endswith(".reporting_mas") or str(agent_id).endswith(
        ".reporting_mas"
    ):
        return mas_catalog_for_agent(agent_id, owned)
    rep = reporting_agent_for_product(owned)
    preset_str = str(preset or "")
    if preset_str in reporting_executor_presets(owned) or (
        rep and (preset_str == rep or agent_id == rep)
    ):
        return list(computed.get(agent_id) or computed.get(preset) or [])
    explicit = computed.get(agent_id) or computed.get(preset) or []
    if explicit:
        return explicit
    return []


def main() -> int:
    clear_ownership_cache()
    ownership = load_ownership()
    agents = _load_agents()
    computed = compute_agent_entitlements_from_ownership()

    products: dict[str, dict[str, dict]] = {}
    for agent_id, cfg in sorted(agents.items()):
        owned = str(cfg.get("owned_product") or "")
        if not owned or owned == "hub":
            continue
        product = _PRODUCT_NORM.get(owned, owned)
        grant = _grant_for_agent(agent_id, owned, ownership, computed)
        entry: dict = {"metrics": grant}
        preset = agent_preset(agent_id)
        hl_key = preset or agent_id
        headlines = (ownership.get("headline_metrics") or {}).get(hl_key)
        if headlines and not str(preset or agent_id).endswith(".reporting_mas"):
            entry["headlines"] = headlines
        products.setdefault(product, {})[agent_id] = entry

    written = {aid for bucket in products.values() for aid in bucket}
    for preset_id, mids in sorted(computed.items()):
        if preset_id in written or not mids:
            continue
        if preset_id not in agents and preset_id in reporting_executor_presets(None):
            continue
        product = _product_for_preset(preset_id)
        if not product:
            continue
        never = set(ownership.get("never_assign") or [])
        if preset_id in never:
            grant: str | list[str] = []
        else:
            rep = reporting_agent_for_product(product)
            grant = list(mids) if rep and preset_id == rep else list(mids)
        entry = {"metrics": grant}
        headlines = (ownership.get("headline_metrics") or {}).get(preset_id)
        if headlines:
            entry["headlines"] = headlines
        products.setdefault(product, {})[preset_id] = entry
        written.add(preset_id)

    out = {
        "version": ownership.get("version") or "2026.09.1",
        "headline_metrics": ownership.get("headline_metrics") or {},
        "reporting_only": ownership.get("reporting_only") or {},
        "products": products,
    }
    GRANTS_PATH.write_text(
        yaml.dump(out, default_flow_style=False, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    print(f"Wrote {GRANTS_PATH} ({sum(len(v) for v in products.values())} agents)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
