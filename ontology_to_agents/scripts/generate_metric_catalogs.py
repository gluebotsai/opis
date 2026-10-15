#!/usr/bin/env python3
"""Generate semantic/metrics/<product>.yml from templates + policies + capabilities."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.capabilities import get_metric_capabilities
from semantic.lookup import get_metric_policy

TEMPLATES_DIR = ROOT / "semantic/sql/metric_templates"
OUT_DIR = ROOT / "semantic/metrics"
REGISTRY = ROOT / "semantic/metric_registry.yml"

PRODUCT_MAP = {
    "ticketing": "ticketing",
    "ccaas": "ccaas",
    "aiccaas": "ccaas",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
}


def _registry_metrics_for_source(source: str) -> list[str]:
    data = yaml.safe_load(REGISTRY.read_text(encoding="utf-8")) or {}
    out: list[str] = []
    for mid, row in (data.get("metrics") or {}).items():
        if not isinstance(row, dict) or not row.get("certified"):
            continue
        if row.get("prompt") is False:
            continue
        src = row.get("source")
        sources = row.get("sources") or {}
        if src == source or source in sources:
            out.append(str(mid))
    return sorted(out)


def _build_entry(metric_id: str, product: str, template: dict[str, Any] | None) -> dict[str, Any]:
    policy = get_metric_policy(metric_id, product=product)
    cap = get_metric_capabilities(metric_id, product=product)
    entry: dict[str, Any] = {
        "label": policy.get("label") or metric_id,
        "kind": policy.get("kind") or cap.get("kind") or "count",
        "scope": policy.get("scope") or "org",
        "dims": list(policy.get("dims") or policy.get("group_by") or []),
    }
    if policy.get("when"):
        entry["when"] = policy["when"]
    if cap.get("requires_skus"):
        entry["requires_skus"] = list(cap["requires_skus"])
    if cap.get("requires_channels"):
        entry["requires_channels"] = list(cap["requires_channels"])
    if cap.get("requires_features"):
        entry["requires_features"] = list(cap["requires_features"])
    if cap.get("min_role"):
        entry["min_role"] = cap["min_role"]
    if cap.get("channel_scoped"):
        entry["channel_scoped"] = True
    if template:
        for k in (
            "sql",
            "table",
            "time_column",
            "result_column",
            "default_zero",
            "product",
        ):
            if template.get(k) is not None:
                entry[k] = template[k]
    return entry


def generate_product(product: str, source: str) -> dict[str, Any]:
    tpl_path = TEMPLATES_DIR / f"{product}.yml"
    templates: dict[str, Any] = {}
    if tpl_path.is_file():
        templates = (yaml.safe_load(tpl_path.read_text(encoding="utf-8")) or {}).get(
            "metrics"
        ) or {}
    metrics: dict[str, Any] = {}
    for mid in _registry_metrics_for_source(source):
        metrics[mid] = _build_entry(mid, product, templates.get(mid))
    return {"version": 1, "product": product, "metrics": metrics}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pairs = [
        ("ticketing", "ticketing"),
        ("ccaas", "aiccaas"),
        ("crm", "crm"),
        ("campaign", "campaign"),
        ("webtracking", "webtracking"),
    ]
    for product, source in pairs:
        doc = generate_product(product, source)
        out = OUT_DIR / f"{product}.yml"
        out.write_text(
            yaml.dump(doc, sort_keys=False, default_flow_style=False),
            encoding="utf-8",
        )
        print(f"wrote {out} ({len(doc['metrics'])} metrics)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
