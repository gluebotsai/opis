#!/usr/bin/env python3
"""Append missing ontology/metric_policies.yml entries for certified metrics."""

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

from semantic.lookup import clear_policies_cache, _load_policies
from semantic.ownership import list_certified_for_source

SEMANTIC_PATHS = {
    "aiccaas": ROOT
    / "semantic/dbt/ccaas/default/dbt/models/semantic_layer/semantic_layer.yml",
    "ticketing": ROOT
    / "semantic/dbt/ticketing/default/dbt/models/semantic_layer/semantic_layer.yml",
    "crm": ROOT / "semantic/dbt/crm/default/dbt/models/semantic_layer/semantic_layer.yml",
    "campaign": ROOT / "semantic/dbt/campaign/default/dbt/models/semantic_layer/metrics.yml",
    "webtracking": ROOT
    / "semantic/dbt/webtracking/default/dbt/models/semantic_layer/semantic_layer.yml",
}

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
    "conversations": "wt:Interaction",
    "conversation_assignments": "wt:Interaction",
    "agents": "wt:WorkforceAgent",
    "agent_tasks": "wt:Task",
    "agent_presence_history": "wt:WorkforceAgent",
    "queues": "wt:Queue",
    "tickets": "wt:Ticket",
    "mart_tickets": "wt:Ticket",
    "deals": "wt:Deal",
    "contacts": "wt:Customer",
    "campaign_deliveries": "wt:MessageDelivery",
    "web_sessions": "wt:PerformanceReport",
}

SCOPE_BY_ENTITY: dict[str, str] = {
    "wt:Interaction": "assignee_or_team",
    "wt:Ticket": "assignee_or_team",
    "wt:Task": "assignee_or_team",
    "wt:WorkforceAgent": "org",
    "wt:Queue": "org",
    "wt:Deal": "owner_or_team",
    "wt:Customer": "org",
    "wt:MessageDelivery": "org",
    "wt:PerformanceReport": "org",
}

SCOPE_ENTITY_BY_ENTITY: dict[str, str] = {
    "wt:Interaction": "conversation__agent",
    "wt:Ticket": "ticket__assignee",
    "wt:Task": "task__assigned_user",
    "wt:Deal": "deal__owner",
}


def _build_index(data: dict[str, Any]) -> tuple[dict[str, dict], dict[str, str], dict[str, list[str]]]:
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

    metric_measures: dict[str, list[str]] = {}
    for metric in data.get("metrics") or []:
        if not isinstance(metric, dict) or not metric.get("name"):
            continue
        mid = str(metric["name"])
        tp = metric.get("type_params") or {}
        mtype = metric.get("type")
        measures: list[str] = []
        if mtype == "simple" and tp.get("measure"):
            measures.append(str(tp["measure"]))
        elif mtype == "ratio":
            if tp.get("numerator"):
                measures.append(str(tp["numerator"]))
            if tp.get("denominator"):
                measures.append(str(tp["denominator"]))
        metric_measures[mid] = measures
    return models, measure_to_model, metric_measures


def _agent_dims(model: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for dim in model.get("dimensions") or []:
        if not isinstance(dim, dict):
            continue
        name = str(dim.get("name") or "")
        if not name or name in SKIP_DIMS or dim.get("type") == "time":
            continue
        out.append(name)
    return out


def _title(metric_id: str) -> str:
    return re.sub(r"\s+", " ", metric_id.replace("_", " ").title())


def _render_policy(metric_id: str, entity: str, dims: list[str], scope: str) -> str:
    dim_s = ", ".join(dims) if dims else ""
    lines = [
        f"  {metric_id}:",
        f'    label: {_title(metric_id)}',
        f'    "on": {entity}',
        f"    dims: [{dim_s}]",
        f"    when: Period aggregate for {metric_id.replace('_', ' ')}.",
        "    not_for: Row-level lookup — use spoke_query.",
        "    via: ask_semantic",
        f"    scope: {scope}",
    ]
    if scope_entity := SCOPE_ENTITY_BY_ENTITY.get(entity):
        lines.append(f"    scope_entity: {scope_entity}")
    return "\n".join(lines) + "\n"


def main() -> int:
    policies_path = ROOT / "ontology" / "metric_policies.yml"
    existing = set(_load_policies().keys())
    blocks: list[str] = []

    for source_id, path in SEMANTIC_PATHS.items():
        if not path.is_file():
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        models, measure_to_model, metric_measures = _build_index(data)
        for mid in list_certified_for_source(source_id):
            if mid in existing:
                continue
            measures = metric_measures.get(mid) or []
            model_name = None
            for measure in measures:
                if measure in measure_to_model:
                    model_name = measure_to_model[measure]
                    break
                if measure in metric_measures:
                    for sub in metric_measures[measure]:
                        if sub in measure_to_model:
                            model_name = measure_to_model[sub]
                            break
            model = models.get(model_name or "") or {}
            entity = ENTITY_BY_MODEL.get(model_name or "", "wt:PerformanceReport")
            dims = _agent_dims(model)
            scope = SCOPE_BY_ENTITY.get(entity, "org")
            blocks.append(_render_policy(mid, entity, dims, scope))
            existing.add(mid)

    if blocks:
        text = policies_path.read_text(encoding="utf-8").rstrip() + "\n\n" + "".join(blocks)
        policies_path.write_text(text, encoding="utf-8")
        clear_policies_cache()
    print(f"  added {len(blocks)} metric policies")
    return 0


if __name__ == "__main__":
    sys.exit(main())
