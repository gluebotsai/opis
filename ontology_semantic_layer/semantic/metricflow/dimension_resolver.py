"""Resolve metric entities and group-by dimensions from semantic manifests."""

from __future__ import annotations

import json
import os
from typing import Dict, Optional

_resolver_cache: Dict[str, Dict[str, str]] = {}
_catalog_cache: Dict[str, set[str]] = {}


def clear_dimension_resolver_cache() -> None:
    """Drop manifest-derived entity and group-by caches."""
    _resolver_cache.clear()
    _catalog_cache.clear()


class DimensionResolveError(ValueError):
    """Short dimension name could not be mapped uniquely to MetricFlow."""

    def __init__(self, short_name: str, suggestions: list[str]):
        self.short_name = short_name
        self.suggestions = suggestions
        msg = (
            f"Dimension '{short_name}' does not match any MetricFlow group-by item."
        )
        if suggestions:
            msg += f" Try: {', '.join(suggestions[:8])}"
        super().__init__(msg)


# Ontology headline type (metric_policies.on) → primary MetricFlow entity name.
_ON_TYPE_TO_ENTITY: dict[str, str] = {
    "Deal": "deal",
    "Ticket": "ticket",
    "Conversation": "conversation",
    "Interaction": "conversation",
    "Message": "campaign",
    "MessageDelivery": "campaign",
    "Account": "account",
    "Contact": "contact",
    "Agent": "agent",
    "WorkforceAgent": "agent",
    "Task": "task",
}

# Policy short names → MetricFlow dimension suffix candidates (first match wins).
_DIM_SUFFIX_ALIASES: dict[str, tuple[str, ...]] = {
    "channel": ("channel", "source_channel", "channel_name"),
    "direction": ("direction",),
    "campaign_name": ("campaign_name",),
    "queue_name": ("queue_name",),
    "priority": ("priority",),
    "stage": ("stage",),
    "status": ("status",),
    "owner_name": ("owner_name",),
    "owner_team_id": ("owner_team_id",),
    "agent_name": ("agent_name", "assigned_agent_name", "assignee_name"),
    "assigned_agent_name": ("assigned_agent_name", "agent_name", "assignee_name"),
    "assignee_name": ("assignee_name", "agent_name", "assigned_agent_name"),
    "lifecycle_stage": ("lifecycle_stage",),
}


def build_metric_entity_map(manifest_dir: str) -> Dict[str, str]:
    manifest_path = os.path.join(manifest_dir, "target", "semantic_manifest.json")
    if not os.path.isfile(manifest_path):
        return {}

    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)

    measure_to_model: Dict[str, str] = {}
    model_to_entity: Dict[str, str] = {}
    for sm in manifest.get("semantic_models", []):
        model_name = sm["name"]
        primary_entity = sm.get("primary_entity")
        if primary_entity is None:
            for entity in sm.get("entities", []):
                if entity.get("type") == "primary":
                    primary_entity = entity["name"]
                    break
        if primary_entity:
            model_to_entity[model_name] = primary_entity
        for measure in sm.get("measures", []):
            measure_to_model[measure["name"]] = model_name

    metrics = manifest.get("metrics", [])

    def _resolve_one(metric: dict, metric_to_entity: Dict[str, str]) -> Optional[str]:
        type_params = metric.get("type_params", {})
        is_ratio = bool(type_params.get("denominator") or type_params.get("numerator"))
        if is_ratio:
            denom_ref = type_params.get("denominator")
            if denom_ref:
                denom_name = (
                    denom_ref.get("name") if isinstance(denom_ref, dict) else denom_ref
                )
                if denom_name in metric_to_entity:
                    return metric_to_entity[denom_name]
                return None
            num_ref = type_params.get("numerator")
            if num_ref:
                num_name = num_ref.get("name") if isinstance(num_ref, dict) else num_ref
                if num_name in metric_to_entity:
                    return metric_to_entity[num_name]
            return None

        measure = type_params.get("measure")
        if measure:
            meas_name = measure.get("name") if isinstance(measure, dict) else measure
            model_used = measure_to_model.get(meas_name)
            if model_used and model_used in model_to_entity:
                return model_to_entity[model_used]

        for im in type_params.get("input_measures", []):
            meas_name = im.get("name") if isinstance(im, dict) else im
            model_used = measure_to_model.get(meas_name)
            if model_used and model_used in model_to_entity:
                return model_to_entity[model_used]

        for sm in type_params.get("metrics", []):
            sm_name = sm.get("name") if isinstance(sm, dict) else sm
            if sm_name in metric_to_entity:
                return metric_to_entity[sm_name]
        return None

    metric_to_entity: Dict[str, str] = {}
    unresolved = list(metrics)
    for _ in range(len(metrics) + 1):
        if not unresolved:
            break
        still_unresolved = []
        progress = False
        for metric in unresolved:
            entity = _resolve_one(metric, metric_to_entity)
            if entity:
                metric_to_entity[metric["name"]] = entity
                progress = True
            else:
                still_unresolved.append(metric)
        unresolved = still_unresolved
        if not progress:
            break
    return metric_to_entity


def get_tenant_dimension(
    manifest_dir: str,
    metric_name: str,
    tenant_column: str = "organization_id",
) -> str:
    if manifest_dir not in _resolver_cache:
        _resolver_cache[manifest_dir] = build_metric_entity_map(manifest_dir)
    entity = _resolver_cache[manifest_dir].get(metric_name)
    if entity is None:
        _resolver_cache[manifest_dir] = build_metric_entity_map(manifest_dir)
        entity = _resolver_cache[manifest_dir].get(metric_name)
    if entity is None:
        raise ValueError(
            f"Could not resolve tenant filter entity for metric '{metric_name}'."
        )
    return f"{entity}__{tenant_column}"


def _primary_entity(sm: dict) -> str | None:
    primary = sm.get("primary_entity")
    if primary:
        return str(primary)
    for entity in sm.get("entities", []):
        if entity.get("type") == "primary":
            return str(entity["name"])
    return None


def build_group_by_catalog(manifest_dir: str) -> set[str]:
    """All entity__dimension group-by names from semantic_manifest.json."""
    if manifest_dir in _catalog_cache:
        return _catalog_cache[manifest_dir]

    manifest_path = os.path.join(manifest_dir, "target", "semantic_manifest.json")
    catalog: set[str] = set()
    if not os.path.isfile(manifest_path):
        _catalog_cache[manifest_dir] = catalog
        return catalog

    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)

    for sm in manifest.get("semantic_models", []):
        entities = [e["name"] for e in sm.get("entities", []) if e.get("name")]
        primary = _primary_entity(sm)
        if primary and primary not in entities:
            entities.append(primary)
        for entity_name in entities:
            catalog.add(entity_name)
        for dim in sm.get("dimensions", []):
            dim_name = dim.get("name")
            if not dim_name:
                continue
            for entity_name in entities:
                catalog.add(f"{entity_name}__{dim_name}")

    _catalog_cache[manifest_dir] = catalog
    return catalog


def _suffix_candidates(short_name: str) -> list[str]:
    if "__" in short_name:
        return [short_name]
    aliases = _DIM_SUFFIX_ALIASES.get(short_name, (short_name,))
    return list(dict.fromkeys(aliases))


def entity_from_ontology_type(on_type: str | None) -> str | None:
    if not on_type:
        return None
    key = str(on_type).strip().removeprefix("wt:")
    return _ON_TYPE_TO_ENTITY.get(key) or _ON_TYPE_TO_ENTITY.get(str(on_type).strip())


def resolve_group_by_name(
    catalog: set[str],
    *,
    short_name: str,
    primary_entity: str | None,
    hint_entity: str | None = None,
) -> str | None:
    """Map policy short name to MetricFlow group-by id, or None if ambiguous."""
    if short_name in catalog:
        return short_name

    # Metric primary entity first — group_by must anchor on the metric's fact grain.
    entity_hints = [e for e in (primary_entity, hint_entity) if e]

    matches: list[str] = []
    for suffix in _suffix_candidates(short_name):
        for entity in entity_hints:
            preferred = f"{entity}__{suffix}"
            if preferred in catalog:
                return preferred
        matches.extend(sorted(g for g in catalog if g.endswith(f"__{suffix}")))

    unique = list(dict.fromkeys(matches))
    if len(unique) == 1:
        return unique[0]
    for entity in entity_hints:
        preferred = f"{entity}__{_suffix_candidates(short_name)[0]}"
        if preferred in unique:
            return preferred
    return None


def _unify_cross_model_dim(
    candidates: list[str],
    *,
    short_name: str,
    hint_entity: str | None,
) -> str:
    """Pick one MF dimension when metrics resolve to different entities."""
    unique = list(dict.fromkeys(candidates))
    if len(unique) == 1:
        return unique[0]
    suffix = _suffix_candidates(short_name)[0]
    if hint_entity:
        preferred = f"{hint_entity}__{suffix}"
        if preferred in unique:
            return preferred
    conv = f"conversation__{suffix}"
    if conv in unique:
        return conv
    return unique[0]


def resolve_group_by_for_metrics(
    manifest_dir: str,
    metric_names: list[str],
    names: list[str],
    *,
    hint_entity: str | None = None,
) -> list[str]:
    """Resolve group_by using manifest catalog + metric entity hints."""
    if not names:
        return []
    catalog = build_group_by_catalog(manifest_dir)
    entity_map = build_metric_entity_map(manifest_dir)
    resolved: list[str] = []
    for name in names:
        if name == "metric_time" or name.startswith("metric_time__"):
            resolved.append(name)
            continue
        if len(metric_names) == 1:
            primary_entity = entity_map.get(metric_names[0])
            hit = resolve_group_by_name(
                catalog,
                short_name=name,
                primary_entity=primary_entity,
                hint_entity=hint_entity,
            )
            if hit:
                resolved.append(hit)
                continue
        else:
            per_metric: list[str] = []
            for mid in metric_names:
                entity = entity_map.get(mid)
                hit = resolve_group_by_name(
                    catalog,
                    short_name=name,
                    primary_entity=entity,
                    hint_entity=hint_entity,
                )
                if hit:
                    per_metric.append(hit)
            if per_metric:
                resolved.append(
                    _unify_cross_model_dim(
                        per_metric, short_name=name, hint_entity=hint_entity
                    )
                )
                continue
        suffixes = _suffix_candidates(name)
        suggestions: list[str] = []
        for suffix in suffixes:
            suggestions.extend(sorted(g for g in catalog if g.endswith(f"__{suffix}")))
        suggestions = list(dict.fromkeys(suggestions))[:12]
        raise DimensionResolveError(name, suggestions)
    return resolved
