"""Rewrite ontology/slices/*.yml from catalog presets (legal slice, not the prompt)."""

from __future__ import annotations

from pathlib import Path

import yaml

from ontology.slice import get_catalog, fetch_ontology_slice

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "slices"


def dump_preset(preset: str) -> dict:
    pack = fetch_ontology_slice(preset=preset)
    return {
        "slice_id": preset,
        "agent": pack.agent,
        "modules": pack.resolved_modules,
        "classes": pack.class_ids(),
        "relations": [
            f"{r.get('from')} {r.get('type')} {r.get('to')}"
            for r in pack.relations
            if isinstance(r, dict)
        ],
        "actions": pack.action_ids(),
        "metric_ids": pack.metric_ids,
        "note": "Legal slice (tools/policy). Inject pack.as_prompt() compact, not this file.",
    }


def main() -> None:
    OUT.mkdir(exist_ok=True)
    catalog = get_catalog()
    for preset in catalog.list_presets():
        data = dump_preset(preset)
        path = OUT / f"{preset}.yml"
        path.write_text(
            yaml.safe_dump(data, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        print(f"wrote {path.name}")


if __name__ == "__main__":
    main()
