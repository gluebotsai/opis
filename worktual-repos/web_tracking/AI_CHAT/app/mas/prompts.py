"""Load editable prompt files — no logic."""

from __future__ import annotations

import json
from pathlib import Path

from app.services.context_layer import OntologySlice

_LAYERS = Path(__file__).resolve().parents[2] / "prompts" / "layers"
_ROOT_PROMPTS = Path(__file__).resolve().parents[2] / "prompts"


def read_layer(name: str) -> str:
    path = _LAYERS / name
    return path.read_text(encoding="utf-8").strip()


def read_prompt(name: str) -> str:
    return (_ROOT_PROMPTS / name).read_text(encoding="utf-8").strip()


def metrics_catalog_json(slice_data: OntologySlice, *, max_metrics: int = 120) -> str:
    rows = []
    for m in slice_data.metrics[:max_metrics]:
        rows.append(
            {
                "id": m.id,
                "label": m.label,
                "when": m.when,
                "dims": list(m.dims),
            }
        )
    return json.dumps(rows, ensure_ascii=False)


def super_domain_system(
    *,
    dashboard_period: str | None,
    ontology_prompt: str,
) -> str:
    pill = dashboard_period or "none"
    return (
        f"{read_layer('super.md')}\n\n{read_layer('domain.md')}\n\n"
        f"Dashboard period pill from UI (if any): {pill}\n"
        f"Ontology context (entities and language):\n{ontology_prompt[:12000]}"
    )


def executor_system(*, slice_data: OntologySlice, domain: str, objective: str) -> str:
    return (
        f"{read_layer('executor.md')}\n\n"
        f"Domain: {domain}\n"
        f"Domain objective: {objective}\n\n"
        f"Certified metric catalog:\n{metrics_catalog_json(slice_data)}"
    )
