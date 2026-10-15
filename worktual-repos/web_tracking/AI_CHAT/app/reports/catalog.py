"""Load certified KPI catalog from reports/product/kpis.json."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_REPORTS_ROOT = Path(__file__).resolve().parents[2] / "reports"
_KPIS_PATH = _REPORTS_ROOT / "product" / "kpis.json"


@lru_cache(maxsize=1)
def load_kpi_catalog() -> dict[str, Any]:
    raw = json.loads(_KPIS_PATH.read_text(encoding="utf-8"))
    return raw.get("kpis") or {}


def kpi_index_lines(*, allowed: set[str] | None = None) -> str:
    lines: list[str] = []
    for kpi_id, card in load_kpi_catalog().items():
        if allowed is not None and kpi_id not in allowed:
            continue
        label = card.get("label") or kpi_id
        store = card.get("store") or "semantic"
        syns = ", ".join(card.get("synonyms") or [])
        dims = ",".join(card.get("allowed_dimensions") or []) or "-"
        types = ",".join(card.get("allowed_answer_types") or []) or "kpi"
        syn_str = f" | syns: [{syns}]" if syns else ""
        lines.append(f"{kpi_id} ({label}) | store: {store} | answer_types: {types} | dims: {dims}{syn_str}")
    return "\n".join(lines)


def kpi_store(kpi_id: str) -> str:
    card = load_kpi_catalog().get(kpi_id) or {}
    return str(card.get("store") or "semantic")


def is_realtime_kpi(kpi_id: str) -> bool:
    card = load_kpi_catalog().get(kpi_id) or {}
    return bool(card.get("realtime"))
