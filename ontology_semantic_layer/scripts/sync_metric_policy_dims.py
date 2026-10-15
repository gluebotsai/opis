#!/usr/bin/env python3
"""Sync ontology/metric_policies.yml dims from MetricFlow semantic models.

For every certified metric, set policy dims to the full categorical dimension
set on its home semantic model(s) (minus time dims and SKIP_DIMS). Updates
existing entries; creates missing ones. Product overlays (e.g. products.ccaas)
are updated from that product's MF YAML when the metric is shared.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError:
    print("FAIL  PyYAML required")
    sys.exit(1)

from semantic.lookup import clear_policies_cache
from semantic.ownership import list_certified_for_source

SEMANTIC_PATHS: dict[str, Path] = {
    "aiccaas": ROOT
    / "semantic/dbt/ccaas/default/dbt/models/semantic_layer/semantic_layer.yml",
    "ticketing": ROOT
    / "semantic/dbt/ticketing/default/dbt/models/semantic_layer/semantic_layer.yml",
    "crm": ROOT / "semantic/dbt/crm/default/dbt/models/semantic_layer/semantic_layer.yml",
    "campaign": ROOT / "semantic/dbt/campaign/default/dbt/models/semantic_layer/metrics.yml",
    "webtracking": ROOT
    / "semantic/dbt/webtracking/default/dbt/models/semantic_layer/semantic_layer.yml",
}

CAMPAIGN_MODELS_PATH = (
    ROOT / "semantic/dbt/campaign/default/dbt/models/semantic_layer/semantic_models.yml"
)

# When a metric is certified in multiple sources, prefer this order for *base* dims.
BASE_SOURCE_PRIORITY = ("ticketing", "crm", "campaign", "webtracking", "aiccaas")

SKIP_DIMS = frozenset(
    {
        "organization_id",
        "created_at",
        "resolved_at",
        "closed_at",
        "started_at",
        "offered_at",
        "ended_at",
        "updated_at",
        "event_at",
        "sent_at",
        "delivered_at",
    }
)

ENTITY_BY_MODEL: dict[str, str] = {
    "conversations": "Conversation",
    "conversation_assignments": "Conversation",
    "agents": "WorkforceAgent",
    "agent_tasks": "Task",
    "agent_presence_history": "WorkforceAgent",
    "queues": "Queue",
    "ticket": "Ticket",
    "tickets": "Ticket",
    "mart_tickets": "Ticket",
    "deals": "Deal",
    "contacts": "Contact",
    "campaign_deliveries": "MessageDelivery",
    "web_sessions": "PerformanceReport",
}

SCOPE_BY_ENTITY: dict[str, str] = {
    "Conversation": "assignee_or_team",
    "Ticket": "assignee_or_team",
    "Task": "assignee_or_team",
    "WorkforceAgent": "org",
    "Queue": "org",
    "Deal": "owner_or_team",
    "Contact": "org",
    "MessageDelivery": "org",
    "PerformanceReport": "org",
}

SCOPE_ENTITY_BY_ENTITY: dict[str, str] = {
    "Conversation": "conversation__agent",
    "Ticket": "ticket__assignee",
    "Task": "task__assigned_user",
    "Deal": "deal__owner",
}

POLICIES_PATH = ROOT / "ontology" / "metric_policies.yml"

HEADER = """# Agent-facing metric policy — compact prompt lines + semantic query validation.
# Formulas live in MetricFlow YAML under semantic/dbt/.

"""


def _load_mf(source_id: str, path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        return {"semantic_models": [], "metrics": []}
    if source_id == "campaign":
        models_data = yaml.safe_load(CAMPAIGN_MODELS_PATH.read_text(encoding="utf-8")) or {}
        data = {
            "semantic_models": (models_data or {}).get("semantic_models") or [],
            "metrics": data.get("metrics") or [],
        }
    return data


def build_index(
    data: dict[str, Any],
) -> tuple[dict[str, dict], dict[str, str], dict[str, dict]]:
    """Return models, measure→model, metric_id→metric dict."""
    models: dict[str, dict] = {}
    measure_to_model: dict[str, str] = {}
    for sm in data.get("semantic_models") or []:
        if not isinstance(sm, dict) or not sm.get("name"):
            continue
        name = str(sm["name"])
        models[name] = sm
        for measure in sm.get("measures") or []:
            if isinstance(measure, dict) and measure.get("name"):
                measure_to_model[str(measure["name"])] = name

    metrics: dict[str, dict] = {}
    for metric in data.get("metrics") or []:
        if isinstance(metric, dict) and metric.get("name"):
            metrics[str(metric["name"])] = metric
    return models, measure_to_model, metrics


def agent_dims(model: dict[str, Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for dim in model.get("dimensions") or []:
        if not isinstance(dim, dict):
            continue
        name = str(dim.get("name") or "")
        if not name or name in SKIP_DIMS or dim.get("type") == "time":
            continue
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def _ref_name(ref: Any) -> str | None:
    if isinstance(ref, str) and ref.strip():
        return ref.strip()
    if isinstance(ref, dict):
        name = ref.get("name") or ref.get("measure")
        if name:
            return str(name)
    return None


def leaf_measures(
    metric_id: str,
    metrics: dict[str, dict],
    measure_to_model: dict[str, str],
    *,
    _stack: frozenset[str] | None = None,
) -> list[str]:
    """Resolve a metric to leaf measure names (recurse ratio/derived)."""
    stack = _stack or frozenset()
    if metric_id in stack:
        return []

    metric = metrics.get(metric_id)
    if not metric:
        # Bare measure reference (not also a metric id).
        if metric_id in measure_to_model:
            return [metric_id]
        return []

    tp = metric.get("type_params") or {}
    mtype = metric.get("type")
    next_stack = stack | {metric_id}
    out: list[str] = []

    def _consume_metric_or_measure(ref: Any) -> None:
        name = _ref_name(ref)
        if not name:
            return
        if name in metrics:
            out.extend(
                leaf_measures(name, metrics, measure_to_model, _stack=next_stack)
            )
        elif name in measure_to_model:
            out.append(name)

    if mtype == "simple":
        # Measure name often equals metric name — resolve via measure map, do not recurse.
        measure_name = _ref_name(tp.get("measure"))
        if measure_name and measure_name in measure_to_model:
            out.append(measure_name)
        elif measure_name:
            _consume_metric_or_measure(measure_name)
    elif mtype == "ratio":
        _consume_metric_or_measure(tp.get("numerator"))
        _consume_metric_or_measure(tp.get("denominator"))
    elif mtype == "derived":
        for item in tp.get("metrics") or []:
            _consume_metric_or_measure(item)
    else:
        for key in ("measure", "numerator", "denominator"):
            if tp.get(key):
                _consume_metric_or_measure(tp.get(key))
        for item in tp.get("metrics") or []:
            _consume_metric_or_measure(item)

    seen: set[str] = set()
    uniq: list[str] = []
    for m in out:
        if m not in seen:
            seen.add(m)
            uniq.append(m)
    return uniq


def home_models(
    metric_id: str,
    models: dict[str, dict],
    measure_to_model: dict[str, str],
    metrics: dict[str, dict],
) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for measure in leaf_measures(metric_id, metrics, measure_to_model):
        model_name = measure_to_model.get(measure)
        if model_name and model_name not in seen:
            seen.add(model_name)
            names.append(model_name)
    return names


def dims_for_metric(
    metric_id: str,
    models: dict[str, dict],
    measure_to_model: dict[str, str],
    metrics: dict[str, dict],
) -> list[str]:
    dims: list[str] = []
    seen: set[str] = set()
    for model_name in home_models(metric_id, models, measure_to_model, metrics):
        for d in agent_dims(models.get(model_name) or {}):
            if d not in seen:
                seen.add(d)
                dims.append(d)
    return dims


def _title(metric_id: str) -> str:
    return re.sub(r"\s+", " ", metric_id.replace("_", " ").title())


def _entity_for_models(model_names: list[str]) -> str:
    for name in model_names:
        if name in ENTITY_BY_MODEL:
            return ENTITY_BY_MODEL[name]
    return "PerformanceReport"


def compute_source_metric_dims() -> dict[str, dict[str, list[str]]]:
    """source_id → metric_id → dims."""
    out: dict[str, dict[str, list[str]]] = {}
    for source_id, path in SEMANTIC_PATHS.items():
        if not path.is_file():
            print(f"  WARN  missing MF yaml: {path}")
            continue
        data = _load_mf(source_id, path)
        models, measure_to_model, metrics = build_index(data)
        bucket: dict[str, list[str]] = {}
        for mid in list_certified_for_source(source_id):
            if mid not in metrics:
                print(f"  WARN  {source_id}:{mid} certified but missing from MF YAML")
                continue
            bucket[mid] = dims_for_metric(mid, models, measure_to_model, metrics)
        out[source_id] = bucket
    return out


def _format_dims(dims: list[str]) -> str:
    if not dims:
        return "[]"
    return "[" + ", ".join(dims) + "]"


def _yaml_scalar(val: Any) -> str:
    """Render a plain YAML scalar; quote when needed for safe round-trip."""
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return str(val)
    s = str(val)
    # Quote if empty, or contains YAML-significant characters.
    if (
        not s
        or s.strip() != s
        or any(ch in s for ch in ":#{}[]&*!|>'\"%@`,")
        or s.lower() in {"true", "false", "null", "yes", "no", "on", "off"}
        or s.startswith(("-", "?", "*"))
    ):
        # Prefer double quotes; escape internals.
        esc = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{esc}"'
    return s


def _dump_policy_block(metric_id: str, pol: dict[str, Any], indent: int = 2) -> str:
    sp = " " * indent
    lines: list[str] = [f"{sp}{metric_id}:"]
    preferred = [
        "label",
        "on",
        "dims",
        "when",
        "not_for",
        "via",
        "scope",
        "scope_entity",
        "products",
    ]
    keys = [k for k in preferred if k in pol]
    keys.extend(k for k in pol.keys() if k not in keys and k is not True)

    if "on" not in pol and True in pol:
        pol = dict(pol)
        pol["on"] = pol.pop(True)
        if "on" not in keys:
            keys.insert(1, "on")

    for key in keys:
        val = pol[key]
        if key == "on":
            lines.append(f'{sp}  "on": {_yaml_scalar(val)}')
        elif key == "dims":
            dims = [str(d) for d in (val or [])]
            lines.append(f"{sp}  dims: {_format_dims(dims)}")
        elif key == "products" and isinstance(val, dict):
            lines.append(f"{sp}  products:")
            for prod, overlay in val.items():
                if not isinstance(overlay, dict):
                    continue
                lines.append(f"{sp}    {prod}:")
                o_on = overlay.get("on", overlay.get(True))
                if o_on is not None and not isinstance(o_on, bool):
                    lines.append(f'{sp}      "on": {_yaml_scalar(o_on)}')
                if "dims" in overlay:
                    o_dims = [str(d) for d in (overlay.get("dims") or [])]
                    lines.append(f"{sp}      dims: {_format_dims(o_dims)}")
                for ok in ("when", "not_for", "via", "scope", "scope_entity"):
                    if ok in overlay and overlay[ok] is not None:
                        lines.append(f"{sp}      {ok}: {_yaml_scalar(overlay[ok])}")
        elif isinstance(val, list):
            lines.append(f"{sp}  {key}: {_format_dims([str(x) for x in val])}")
        else:
            lines.append(f"{sp}  {key}: {_yaml_scalar(val)}")
    return "\n".join(lines) + "\n"


def _new_policy(metric_id: str, dims: list[str], model_names: list[str]) -> dict[str, Any]:
    entity = _entity_for_models(model_names)
    scope = SCOPE_BY_ENTITY.get(entity, "org")
    pol: dict[str, Any] = {
        "label": _title(metric_id),
        "on": entity,
        "dims": dims,
        "when": f"Period aggregate for {metric_id.replace('_', ' ')}.",
        "not_for": "Row-level lookup — use spoke_query.",
        "via": "ask_semantic",
        "scope": scope,
    }
    if scope_entity := SCOPE_ENTITY_BY_ENTITY.get(entity):
        pol["scope_entity"] = scope_entity
    return pol


def apply_dims_to_policies(
    policies: dict[str, Any],
    source_dims: dict[str, dict[str, list[str]]],
) -> list[str]:
    """Mutate policies in place. Return human-readable change lines."""
    # metric → {source: dims}
    by_metric: dict[str, dict[str, list[str]]] = {}
    for source_id, bucket in source_dims.items():
        for mid, dims in bucket.items():
            by_metric.setdefault(mid, {})[source_id] = dims

    changes: list[str] = []

    for mid, per_source in sorted(by_metric.items()):
        sources = list(per_source.keys())
        base_source = next(
            (s for s in BASE_SOURCE_PRIORITY if s in per_source), sources[0]
        )
        base_dims = list(per_source[base_source])

        existing = policies.get(mid)
        if not isinstance(existing, dict):
            # Need model names for entity — re-derive lightly from dims only
            policies[mid] = _new_policy(mid, base_dims, [])
            # Fix entity from first available MF index later if needed
            changes.append(f"+ {mid}  dims={len(base_dims)} (new)")
            existing = policies[mid]

        old_dims = [str(d) for d in (existing.get("dims") or existing.get("group_by") or [])]
        if not base_dims and old_dims:
            # Do not wipe a working allowlist when MF resolution fails.
            changes.append(f"! {mid}  keep {len(old_dims)} dims (MF home models unresolved)")
            base_dims = old_dims
        if old_dims != base_dims:
            existing["dims"] = base_dims
            existing.pop("group_by", None)
            added = sorted(set(base_dims) - set(old_dims))
            removed = sorted(set(old_dims) - set(base_dims))
            changes.append(
                f"~ {mid}  {len(old_dims)}→{len(base_dims)}"
                f"  +{added[:8]}{'…' if len(added) > 8 else ''}"
                f"  -{removed[:4]}{'…' if len(removed) > 4 else ''}"
            )
        else:
            existing["dims"] = base_dims
            existing.pop("group_by", None)

        # Product overlays for non-base sources (shared metric ids).
        overlay_source_key = {
            "aiccaas": "ccaas",
            "ticketing": "ticketing",
            "crm": "crm",
            "campaign": "campaign",
            "webtracking": "webtracking",
        }
        for source_id, dims in per_source.items():
            if source_id == base_source:
                continue
            overlay_key = overlay_source_key.get(source_id, source_id)
            products = existing.setdefault("products", {})
            if not isinstance(products, dict):
                products = {}
                existing["products"] = products
            overlay = dict(products.get(overlay_key) or {})
            old_o = [str(d) for d in (overlay.get("dims") or [])]
            if "on" not in overlay and True in overlay:
                overlay["on"] = overlay.pop(True)
            if not dims and old_o:
                dims = old_o
                changes.append(
                    f"! {mid}.products.{overlay_key}  keep {len(old_o)} dims "
                    "(MF home models unresolved)"
                )
            overlay["dims"] = list(dims)
            if overlay_key == "ccaas" and "on" not in overlay:
                overlay["on"] = "Conversation"
            if overlay_key == "ccaas" and "scope" not in overlay:
                overlay["scope"] = "org"
            products[overlay_key] = overlay
            if old_o != dims:
                changes.append(
                    f"~ {mid}.products.{overlay_key}  {len(old_o)}→{len(dims)}"
                )

        if isinstance(existing.get("products"), dict) and not existing["products"]:
            existing.pop("products", None)

    return changes


def write_policies(version: Any, policies: dict[str, Any]) -> None:
    parts = [HEADER, f"version: {version}\n", "\nmetrics:\n"]
    for mid, pol in policies.items():
        if not isinstance(pol, dict):
            continue
        parts.append(_dump_policy_block(mid, pol))
        parts.append("\n")
    POLICIES_PATH.write_text("".join(parts).rstrip() + "\n", encoding="utf-8")
    clear_policies_cache()


def main() -> int:
    raw = yaml.safe_load(POLICIES_PATH.read_text(encoding="utf-8")) or {}
    version = raw.get("version", "2026.09.1")
    policies: dict[str, Any] = dict(raw.get("metrics") or {})

    print("Indexing MetricFlow semantic layers…")
    source_dims = compute_source_metric_dims()
    for src, bucket in source_dims.items():
        print(f"  {src}: {len(bucket)} certified metrics with MF defs")

    # Enrich new-policy entity using MF home models when we can
    for source_id, path in SEMANTIC_PATHS.items():
        if not path.is_file():
            continue
        data = _load_mf(source_id, path)
        models, measure_to_model, metrics = build_index(data)
        for mid, dims in (source_dims.get(source_id) or {}).items():
            if mid in policies:
                continue
            homes = home_models(mid, models, measure_to_model, metrics)
            policies[mid] = _new_policy(mid, dims, homes)

    changes = apply_dims_to_policies(policies, source_dims)
    write_policies(version, policies)

    print(f"Wrote {POLICIES_PATH}  ({len(changes)} dim updates)")
    for line in changes[:80]:
        print(f"  {line}")
    if len(changes) > 80:
        print(f"  … {len(changes) - 80} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
