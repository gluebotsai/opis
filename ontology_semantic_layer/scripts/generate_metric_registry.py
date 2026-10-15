#!/usr/bin/env python3
"""Build semantic/metric_registry.yml from semantic/dbt."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DBT = ROOT / "semantic" / "dbt"
OUT = ROOT / "semantic" / "metric_registry.yml"
MODULES_DIR = ROOT / "ontology" / "modules"

SOURCES = {
    "aiccaas": DBT / "ccaas/default/dbt/models/semantic_layer/semantic_layer.yml",
    "ticketing": DBT / "ticketing/default/dbt/models/semantic_layer/semantic_layer.yml",
    "crm": DBT / "crm/default/dbt/models/semantic_layer/semantic_layer.yml",
    "campaign": DBT / "campaign/default/dbt/models/semantic_layer/metrics.yml",
    "webtracking": DBT / "webtracking/default/dbt/models/semantic_layer/semantic_layer.yml",
}

MODULE_FILES = {
    "aiccaas": MODULES_DIR / "metrics_ccass.yml",
    "ticketing": MODULES_DIR / "metrics_ticketing.yml",
    "crm": MODULES_DIR / "metrics_crm.yml",
    "campaign": MODULES_DIR / "metrics_campaign.yml",
    "webtracking": MODULES_DIR / "metrics_webtracking.yml",
}


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def extract_metrics(data: dict) -> list[str]:
    items = data.get("metrics") or []
    names: list[str] = []
    for item in items:
        if isinstance(item, dict) and item.get("name"):
            names.append(str(item["name"]))
    return names


def main() -> None:
    registry: dict = {
        "version": "2026.09.3",
        "certified_only_in_prompts": True,
        "note": "Auto-generated from semantic/dbt. MetricFlow name = agent id.",
        "sources": {},
        "metrics": {},
    }

    for source_id, path in SOURCES.items():
        if not path.exists():
            print(f"skip missing {path}")
            continue
        data = load(path)
        names = extract_metrics(data)
        registry["sources"][source_id] = {
            "product": source_id,
            "kind": "dbt_metricflow",
            "file": str(path.relative_to(ROOT)),
            "metric_count": len(names),
        }
        for name in names:
            if name in registry["metrics"]:
                existing = registry["metrics"][name]
                if existing.get("source") and "sources" not in existing:
                    existing["sources"] = {
                        str(existing["source"]): {
                            "certified": True,
                            "source_metric": existing.get("source_metric", name),
                        }
                    }
                    existing.pop("source", None)
                    existing.pop("source_metric", None)
                sources = existing.setdefault("sources", {})
                if source_id in sources:
                    raise SystemExit(
                        f"Duplicate metric id '{name}' in {source_id} "
                        f"(already registered for that source)"
                    )
                sources[source_id] = {
                    "certified": True,
                    "source_metric": name,
                }
                existing["certified"] = True
                continue
            registry["metrics"][name] = {
                "certified": True,
                "source": source_id,
                "source_metric": name,
            }
        # metrics-only module yaml
        mod_path = MODULE_FILES[source_id]
        mod_path.parent.mkdir(parents=True, exist_ok=True)
        mod_path.write_text(
            yaml.safe_dump(
                {
                    "module": mod_path.stem,
                    "layer": "domain",
                    "depends_on": ["core"],
                    "usecase": f"Certified MetricFlow ids for {source_id}. Select for reporting agents only.",
                    "metric_ids": names,
                },
                sort_keys=False,
                allow_unicode=True,
            ),
            encoding="utf-8",
        )
        print(f"{source_id}: {len(names)} metrics -> {mod_path.name}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        yaml.safe_dump(registry, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({len(registry['metrics'])} metrics total)")


if __name__ == "__main__":
    main()
