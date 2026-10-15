"""Metric ownership: reporting catalog entitlement + MAS specialist rules."""

from __future__ import annotations

import fnmatch
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

from ontology.slice import normalize_product_id
from semantic.lookup import _load as _load_registry

ROOT = Path(__file__).resolve().parents[1]
OWNERSHIP_PATH = ROOT / "ontology" / "metric_ownership.yml"
AGENTS_PATH = ROOT / "ontology" / "agents.yml"

_PRODUCT_TO_SOURCE: dict[str, str] = {
    "contact_centre": "aiccaas",
    "ccaas": "aiccaas",
    "aiccaas": "aiccaas",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
    "cdp": "cdp",
}


@lru_cache(maxsize=1)
def load_ownership() -> dict[str, Any]:
    with OWNERSHIP_PATH.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


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


def agent_owned_product(agent_id: str | None) -> str | None:
    if not agent_id:
        return None
    cfg = load_agents_index().get(agent_id) or {}
    owned = cfg.get("owned_product")
    return str(owned) if owned else None


def clear_ownership_cache() -> None:
    load_ownership.cache_clear()
    load_agents_index.cache_clear()


def registry_source_for_product(product: str | None) -> str | None:
    if not product:
        return None
    norm = normalize_product_id(product)
    return _PRODUCT_TO_SOURCE.get(norm)


def reporting_agent_for_product(product: str | None) -> str | None:
    if not product:
        return None
    cfg = load_ownership()
    agents = cfg.get("reporting_agents") or {}
    norm = normalize_product_id(product)
    return agents.get(norm)


def reporting_executor_presets(product: str | None = None) -> set[str]:
    cfg = load_ownership()
    presets = set(cfg.get("reporting_executor_presets") or [])
    rep = reporting_agent_for_product(product)
    if rep:
        presets.add(rep)
    return presets


def _reporting_preset_for_agent(agent: str, product: str | None) -> bool:
    preset = agent_preset(agent) or agent
    if preset in reporting_executor_presets(product):
        return True
    rep = reporting_agent_for_product(product)
    if not rep:
        return False
    if agent == rep:
        return True
    return preset == rep


def is_reporting_mas_agent(agent: str | None, product: str | None = None) -> bool:
    if not agent:
        return False
    preset = agent_preset(agent) or agent
    return str(preset).endswith(".reporting_mas")


def mas_catalog_for_agent(agent: str | None, product: str | None) -> list[str]:
    """Full certified metric catalog for reporting_mas setup agents."""
    preset = agent_preset(agent) or agent or ""
    if not str(preset).endswith(".reporting_mas"):
        return []
    product_norm = normalize_product_id(product) if product else None
    rep = reporting_agent_for_product(product_norm)
    if rep:
        catalog = reporting_catalog_for_agent(rep, product_norm)
        if catalog:
            return list(catalog)
    if product_norm:
        return list_certified_for_product(product_norm)
    return []


def is_reporting_agent(agent: str | None, product: str | None) -> bool:
    if not agent:
        return False
    if agent not in load_agents_index():
        return False
    if _reporting_preset_for_agent(agent, product):
        return True
    cfg = load_ownership()
    reg = cfg.get("registry_reporting") or {}
    for _source, mapping in reg.items():
        if isinstance(mapping, str) and mapping == agent:
            src = registry_source_for_product(product)
            if src == _source:
                return True
        elif isinstance(mapping, dict) and agent in mapping:
            if registry_source_for_product(product) == _source:
                return True
    return False


def _metric_sources(metric_id: str, row: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    if row.get("source"):
        out.add(str(row["source"]))
    for key in (row.get("sources") or {}):
        out.add(str(key))
    return out


def list_certified_for_source(source_id: str) -> list[str]:
    from semantic.metrics.catalog import list_product_metrics

    _source_to_product = {
        "aiccaas": "ccaas",
        "ticketing": "ticketing",
        "crm": "crm",
        "campaign": "campaign",
        "webtracking": "webtracking",
    }
    product = _source_to_product.get(source_id)
    if product:
        catalog = list_product_metrics(product)
        if catalog:
            return catalog
    registry = _load_registry()
    metrics = registry.get("metrics") or {}
    out: list[str] = []
    for mid, row in metrics.items():
        if not isinstance(row, dict) or not row.get("certified"):
            continue
        if row.get("prompt") is False:
            continue
        if source_id in _metric_sources(mid, row):
            out.append(mid)
    return sorted(out)


def list_certified_for_product(product: str | None) -> list[str]:
    source = registry_source_for_product(product)
    if not source:
        return []
    if source == "cdp":
        mod_path = ROOT / "ontology" / "modules" / "metrics_cdp.yml"
        if mod_path.is_file():
            data = yaml.safe_load(mod_path.read_text(encoding="utf-8")) or {}
            return sorted(data.get("metric_ids") or [])
        return []
    return list_certified_for_source(source)


def _webtracking_agent_for_metric(metric_id: str) -> str | None:
    cfg = load_ownership()
    mapping = (cfg.get("registry_reporting") or {}).get("webtracking")
    if isinstance(mapping, str):
        return mapping
    if not isinstance(mapping, dict):
        return None
    for agent_id, patterns in mapping.items():
        for pat in patterns or []:
            if fnmatch.fnmatch(metric_id, pat):
                return str(agent_id)
    return None


def reporting_catalog_for_agent(agent: str | None, product: str | None) -> list[str] | None:
    """Full API catalog for reporting agents; None if specialist/super path."""
    from semantic.agent_grants import grant_candidates, webtracking_catalog_for_agent

    if not agent:
        return None
    product_norm = normalize_product_id(product) if product else None
    if product_norm == "webtracking":
        web = webtracking_catalog_for_agent(agent)
        if web is not None:
            return web
        rep = reporting_agent_for_product("webtracking")
        if rep and (agent == rep or agent_preset(agent) == rep):
            return list_certified_for_product("webtracking")
    granted = grant_candidates(agent, product_norm or "")
    if granted is not None:
        return list(granted)
    source = registry_source_for_product(product)

    rep = reporting_agent_for_product(product)
    if (
        rep
        and _reporting_preset_for_agent(agent, product_norm)
        and source
        and source != "webtracking"
    ):
        return list_certified_for_source(source)

    if source == "webtracking":
        mapping = (load_ownership().get("registry_reporting") or {}).get("webtracking")
        if isinstance(mapping, str) and (
            agent == mapping or agent_preset(agent) == mapping
        ):
            return list_certified_for_source("webtracking")
        if isinstance(mapping, dict) and agent in mapping:
            all_web = list_certified_for_source("webtracking")
            patterns = mapping.get(agent) or []
            if "*" in patterns:
                return all_web
            return [
                m
                for m in all_web
                if _webtracking_agent_for_metric(m) == agent
            ]

    if product_norm == "cdp" and agent == "cdp.profile":
        return list_certified_for_product("cdp")

    return None


def _match_patterns(metric_id: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(metric_id, pat) for pat in patterns)


def specialist_agents_for_metric(metric_id: str, source_id: str) -> list[str]:
    cfg = load_ownership()
    never = set(cfg.get("never_assign") or [])
    rules = (cfg.get("specialist_rules") or {}).get(source_id) or []
    agents: set[str] = set()
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        patterns = rule.get("patterns") or []
        if not _match_patterns(metric_id, patterns):
            continue
        for aid in rule.get("agents") or []:
            if aid not in never:
                agents.add(str(aid))
    return sorted(agents)


def compute_agent_entitlements_from_ownership() -> dict[str, list[str]]:
    """Build entitlements from metric_ownership.yml (reporting + specialist rules)."""
    cfg = load_ownership()
    preserve = set(cfg.get("preserve_prompt_metrics") or [])
    headlines = cfg.get("headline_metrics") or {}
    registry_reporting = cfg.get("registry_reporting") or {}

    entitlements: dict[str, set[str]] = {}

    for source_id, rep in registry_reporting.items():
        if isinstance(rep, str):
            entitlements.setdefault(rep, set()).update(list_certified_for_source(source_id))
        elif isinstance(rep, dict):
            all_web = list_certified_for_source(source_id)
            for agent_id, patterns in rep.items():
                bucket = entitlements.setdefault(str(agent_id), set())
                for mid in all_web:
                    if any(fnmatch.fnmatch(mid, pat) for pat in (patterns or [])):
                        bucket.add(mid)
                if str(agent_id) == "cdp.profile" and "*" in (patterns or []):
                    bucket.update(all_web)

    for source_id in ("aiccaas", "ticketing", "crm", "campaign"):
        certified = list_certified_for_source(source_id)
        for mid in certified:
            for agent_id in specialist_agents_for_metric(mid, source_id):
                entitlements.setdefault(agent_id, set()).add(mid)

    cdp_metrics = list_certified_for_product("cdp")
    entitlements.setdefault("cdp.profile", set()).update(cdp_metrics)

    agents_index = load_agents_index()
    for agent_id, mids in headlines.items():
        if agent_id in preserve:
            continue
        if agent_id not in agents_index:
            continue
        entitlements.setdefault(agent_id, set()).update(mids)

    for agent_id, cfg in load_agents_index().items():
        preset = cfg.get("preset")
        owned = cfg.get("owned_product")
        if not preset or not owned:
            continue
        owned_str = str(owned)
        preset_str = str(preset)
        if preset_str in reporting_executor_presets(owned_str):
            source = registry_source_for_product(owned_str)
            if source:
                entitlements.setdefault(agent_id, set()).update(
                    list_certified_for_source(source)
                )
            continue
        rep = reporting_agent_for_product(owned_str)
        if rep and preset_str == rep:
            source = registry_source_for_product(owned_str)
            if source:
                entitlements.setdefault(agent_id, set()).update(
                    list_certified_for_source(source)
                )

    return {k: sorted(v) for k, v in entitlements.items()}


def compute_agent_entitlements() -> dict[str, list[str]]:
    """Agent id -> API entitlement metric ids (sorted, unique)."""
    from semantic.agent_grants import (
        GRANTS_PATH,
        compute_agent_entitlements_from_grants,
    )

    if GRANTS_PATH.is_file():
        return compute_agent_entitlements_from_grants()
    return compute_agent_entitlements_from_ownership()


def headline_metrics_for_agent(agent_id: str) -> list[str] | None:
    from semantic.agent_grants import GRANTS_PATH, load_grants

    if GRANTS_PATH.is_file():
        cfg = load_grants()
        for _prod, agents in (cfg.get("products") or {}).items():
            entry = (agents or {}).get(agent_id)
            if entry and entry.get("headlines"):
                return list(entry["headlines"])
        headlines = cfg.get("headline_metrics") or {}
        if agent_id in headlines:
            return list(headlines[agent_id])
    cfg = load_ownership()
    headlines = cfg.get("headline_metrics") or {}
    if agent_id in headlines:
        return list(headlines[agent_id])
    return None


def reporting_leftovers_for_source(source_id: str) -> list[str]:
    """Certified metrics on reporting API catalog but not in headline prompt."""
    cfg = load_ownership()
    reporting_only = cfg.get("reporting_only") or {}
    return list(reporting_only.get(source_id) or [])


def validate_ticketing_reporting_partition() -> list[str]:
    """Return error messages if headlines + leftovers != certified ticketing set."""
    errors: list[str] = []
    certified = set(list_certified_for_source("ticketing"))
    headlines = set(headline_metrics_for_agent("tk.reporting") or [])
    leftovers = set(reporting_leftovers_for_source("ticketing"))
    overlap = headlines & leftovers
    if overlap:
        errors.append(f"headlines overlap leftovers: {sorted(overlap)[:5]}")
    union = headlines | leftovers
    missing = certified - union
    extra = union - certified
    if missing:
        errors.append(f"certified missing from partition ({len(missing)}): {sorted(missing)[:5]}")
    if extra:
        errors.append(f"partition has non-certified ({len(extra)}): {sorted(extra)[:5]}")
    return errors
