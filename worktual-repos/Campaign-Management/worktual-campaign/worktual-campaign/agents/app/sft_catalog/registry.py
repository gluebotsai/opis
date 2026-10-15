"""MAS agent ids for SFT catalog export."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from app.mas.catalog import DOMAIN_EXECUTORS, DOMAIN_IDS, EXECUTOR_META, MODULE_TO_DOMAIN

Layer = Literal["super", "domain", "executor"]

_MAS_ROOT = Path(__file__).resolve().parents[1] / "mas"
_AGENTS_APP_ROOT = Path(__file__).resolve().parents[1]
_REPO_AGENTS_PREFIX = "agents/app"


@dataclass(frozen=True)
class CatalogAgentRef:
    id: str
    name: str
    layer: Layer
    package_dir: Path
    handoff_targets: tuple[str, ...] = ()
    surfaces: tuple[str, ...] = ()
    description: str = ""
    mcp_servers: tuple[str, ...] = ("campaign",)
    max_tool_rounds: int = 12


def _repo_relative(path: Path) -> str:
    try:
        rel = path.relative_to(_AGENTS_APP_ROOT)
        return f"{_REPO_AGENTS_PREFIX}/{rel.as_posix()}"
    except ValueError:
        return path.as_posix()


def _surfaces_for_domain(domain_id: str) -> tuple[str, ...]:
    mods = sorted(
        m for m, d in MODULE_TO_DOMAIN.items() if d == domain_id and not m.endswith("_run")
    )
    # Keep run modules when they map to the same domain.
    run_mods = sorted(m for m, d in MODULE_TO_DOMAIN.items() if d == domain_id and m.endswith("_run"))
    surfaces = list(dict.fromkeys([*mods, *run_mods]))
    if domain_id in ("audience", "creation", "optimization", "content", "image"):
        surfaces.append("campaign-hub")
    return tuple(surfaces)


def _surfaces_for_executor(executor_id: str, domain_id: str) -> tuple[str, ...]:
    base = list(_surfaces_for_domain(domain_id))
    if executor_id in ("contact", "audience_selection", "audience_pull"):
        base = ["contacts", *base]
    if executor_id in (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
        "recommendation",
    ):
        base = ["create_campaign", *base]
    if executor_id in ("monitoring", "recovery"):
        base = ["monitoring", *base]
    if executor_id == "analytics":
        base = ["reports", "events_report", *base]
    # Dedupe preserve order
    return tuple(dict.fromkeys(base))


def list_catalog_refs() -> list[CatalogAgentRef]:
    refs: list[CatalogAgentRef] = []
    refs.append(
        CatalogAgentRef(
            id="campaign_super",
            name="Campaign Super Agent",
            layer="super",
            package_dir=_MAS_ROOT / "super_agent",
            handoff_targets=tuple(DOMAIN_IDS),
            surfaces=("mas", "create_campaign", "contacts", "campaign-hub"),
            description="Route to one Campaign domain. No business tools.",
            max_tool_rounds=4,
        )
    )
    for did in DOMAIN_IDS:
        refs.append(
            CatalogAgentRef(
                id=did,
                name=f"{did.replace('_', ' ').title()} Domain",
                layer="domain",
                package_dir=_MAS_ROOT / "domains" / did,
                handoff_targets=DOMAIN_EXECUTORS.get(did, ()),
                surfaces=_surfaces_for_domain(did),
                description=f"Domain router for {did} executors.",
                max_tool_rounds=6,
            )
        )
    for eid, meta in EXECUTOR_META.items():
        domain_id = str(meta.get("domain") or "")
        refs.append(
            CatalogAgentRef(
                id=eid,
                name=str(meta.get("name") or eid),
                layer="executor",
                package_dir=_MAS_ROOT / "executors" / eid,
                handoff_targets=(),
                surfaces=_surfaces_for_executor(eid, domain_id),
                description=str(meta.get("description") or ""),
                max_tool_rounds=12,
            )
        )
    return refs


def get_catalog_ref(agent_id: str) -> CatalogAgentRef | None:
    key = str(agent_id or "").strip().lower().replace("-", "_")
    for ref in list_catalog_refs():
        if ref.id == key:
            return ref
    return None


def agent_document_path(ref: CatalogAgentRef) -> str | None:
    path = ref.package_dir / "agent.md"
    if not path.is_file():
        return None
    return _repo_relative(path)


__all__ = [
    "CatalogAgentRef",
    "agent_document_path",
    "get_catalog_ref",
    "list_catalog_refs",
]
