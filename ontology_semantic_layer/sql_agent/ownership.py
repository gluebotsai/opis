"""Agent preset lookup from ontology (SQL agent)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

AGENTS_PATH = Path(__file__).resolve().parents[1] / "ontology" / "agents.yml"


@lru_cache(maxsize=1)
def load_agents_index() -> dict[str, dict[str, Any]]:
    if not AGENTS_PATH.is_file():
        return {}
    with AGENTS_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    agents = data.get("agents") or {}
    return {str(k): v for k, v in agents.items() if isinstance(v, dict)}


def agent_preset(agent_id: str | None) -> str | None:
    if not agent_id:
        return None
    cfg = load_agents_index().get(agent_id) or {}
    preset = cfg.get("preset")
    return str(preset) if preset else None
