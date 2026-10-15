"""Serialize ontology slice for turn logs."""

from __future__ import annotations

from typing import Any

from app.services.context_layer import OntologySlice


def ontology_log_payload(slice_data: OntologySlice, *, prompt_max_chars: int = 8000) -> dict[str, Any]:
    prompt = slice_data.prompt or ""
    if len(prompt) > prompt_max_chars:
        prompt = prompt[:prompt_max_chars] + "\n…(truncated)"
    return {
        "version": slice_data.version,
        "tenant": slice_data.tenant,
        "role": slice_data.role,
        "metric_count": len(slice_data.metrics),
        "metrics": [
            {
                "id": m.id,
                "label": m.label,
                "when": m.when,
                "dims": list(m.dims),
            }
            for m in slice_data.metrics
        ],
        "prompt": prompt,
    }
