#!/usr/bin/env python3
"""Split ontology/catalog.yml presets into ontology/presets/<product>.yml."""

from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError:
    print("FAIL  PyYAML required")
    sys.exit(1)

CATALOG_PATH = ROOT / "ontology" / "catalog.yml"
PRESETS_DIR = ROOT / "ontology" / "presets"

DOMAIN_PRESETS = {
    "tk.intake_deflection_domain",
    "tk.triage_routing_domain",
    "tk.resolution_lifecycle_domain",
    "tk.knowledge_domain",
    "tk.catalog_administration_domain",
}

PRODUCT_FILES = {
    "contact_centre": "contact_centre.yml",
    "ticketing": "ticketing.yml",
    "crm": "crm.yml",
    "campaign": "campaign.yml",
    "hub": "hub.yml",
    "cdp": "cdp.yml",
    "webtracking": "webtracking.yml",
}


def _preset_product(preset_id: str) -> str:
    if preset_id.startswith("cc.") or preset_id == "cc.super":
        return "contact_centre"
    if preset_id.startswith("tk.") or preset_id in DOMAIN_PRESETS:
        return "ticketing"
    if preset_id.startswith("crm.") or preset_id == "crm-agent" or preset_id == "audit-forecast":
        return "crm"
    if preset_id.startswith("camp."):
        return "campaign"
    if preset_id == "hub.orchestrator":
        return "hub"
    if preset_id == "cdp.profile" or preset_id == "cdp.reporting_mas":
        return "cdp"
    if preset_id.startswith("webtracking."):
        return "webtracking"
    if preset_id in ("enrich-lead", "score-lead", "assign-sales", "meeting-brief-email", "analyze-transcript"):
        return "crm"
    return "contact_centre"


def _strip_prompt_metrics(node: dict) -> None:
    prompt = node.get("prompt")
    if isinstance(prompt, dict) and "metrics" in prompt:
        prompt["metrics"] = []


def _strip_hub_metrics(catalog: dict) -> None:
    hub = catalog.get("hub_entitlements") or {}
    base = hub.get("base_prompt") or {}
    if isinstance(base, dict) and "metrics" in base:
        base["metrics"] = []
    for spec in (hub.get("products") or {}).values():
        if not isinstance(spec, dict):
            continue
        prompt = spec.get("prompt") or {}
        if isinstance(prompt, dict) and "metrics" in prompt:
            prompt["metrics"] = []


def main() -> int:
    catalog = yaml.safe_load(CATALOG_PATH.read_text(encoding="utf-8")) or {}
    presets = catalog.pop("presets", {}) or {}
    _strip_hub_metrics(catalog)

    buckets: dict[str, dict] = {k: {} for k in PRODUCT_FILES}
    for pid, spec in presets.items():
        if not isinstance(spec, dict):
            continue
        spec = copy.deepcopy(spec)
        _strip_prompt_metrics(spec)
        product = _preset_product(str(pid))
        buckets[product][pid] = spec

    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    for product, fname in PRODUCT_FILES.items():
        path = PRESETS_DIR / fname
        body = {"presets": buckets.get(product) or {}}
        path.write_text(
            yaml.dump(body, default_flow_style=False, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        print(f"  {path.name}: {len(body['presets'])} presets")

    CATALOG_PATH.write_text(
        yaml.dump(catalog, default_flow_style=False, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    print(f"Updated {CATALOG_PATH} (presets removed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
