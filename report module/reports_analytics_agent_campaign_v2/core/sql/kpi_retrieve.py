"""Semantic metric catalog for the SQL executor. No question scoring."""

from __future__ import annotations

from typing import Any


def format_metric_catalog(
    kpis: dict[str, Any],
    *,
    dimensions_doc: dict[str, Any] | None = None,
    role: str = "admin",
) -> str:
    """Every certified metric as name, description, dimensions, when to use / not use."""
    dim_meanings = {}
    for dim_id, spec in ((dimensions_doc or {}).get("dimensions") or {}).items():
        dim_meanings[str(dim_id)] = str((spec or {}).get("meaning") or "").strip()
    blocks: list[str] = []
    for kpi_id, card in kpis.items():
        if role != "admin" and card.get("admin_only"):
            continue
        definition = card.get("definition") or {}
        desc_parts = [
            str(card.get("label") or kpi_id),
            str(card.get("grain") or ""),
            str(definition.get("includes") or ""),
        ]
        description = ". ".join(p for p in desc_parts if p)
        dim_lines: list[str] = []
        for dim in card.get("allowed_dimensions") or []:
            meaning = dim_meanings.get(str(dim), "")
            dim_lines.append(f"    - {dim}: {meaning}" if meaning else f"    - {dim}")
        dims_block = "\n".join(dim_lines) if dim_lines else "    (none)"
        confuse = card.get("not_confused_with") or []
        confuse_s = ", ".join(str(x) for x in confuse) if confuse else "none"
        blocks.append(
            "\n".join(
                [
                    f"METRIC {kpi_id}",
                    f"  name: {card.get('label') or kpi_id}",
                    f"  description: {description}",
                    f"  dimensions:",
                    dims_block,
                    f"  when_to_use: {card.get('when_to_use') or ''}",
                    f"  when_not: {card.get('when_not') or ''} Confused with: {confuse_s}.",
                    f"  admin_only: {bool(card.get('admin_only'))}",
                ]
            )
        )
    return "\n\n".join(blocks)
