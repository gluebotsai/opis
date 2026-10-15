"""On-demand reload of in-memory caches — no file watching, no uvicorn --reload."""

from __future__ import annotations

from typing import Any

from ontology.slice import clear_ontology_cache
from semantic.capabilities import clear_capabilities_cache
from semantic.entitlements import clear_entitlements_cache
from semantic.lookup import clear_policies_cache, clear_registry_cache
from semantic.metricflow.dimension_resolver import clear_dimension_resolver_cache
from semantic.metricflow.engine import (
    clear_engine_cache,
    engine_status,
    is_warm_enabled,
    warmup_engines,
)
from semantic.agent_grants import clear_grants_cache
from semantic.context_cache import clear_context_cache
from semantic.metricflow.sql_cache import clear_sql_cache
from semantic.metrics.catalog import clear_metrics_catalog_cache
from semantic.pg_pool import close_pool
from semantic.sql.metric_template_registry import clear_template_cache
from semantic.runtime_warm import warm_runtime
from semantic.tenant_overlay import clear_tenant_overlay_cache
from semantic.thresholds import clear_thresholds_cache

_RELOAD_LAYERS: tuple[str, ...] = (
    "ontology",
    "policies",
    "capabilities",
    "entitlements",
    "thresholds",
    "metricflow",
    "dimension_resolver",
    "sql_cache",
    "context_cache",
    "pg_pool",
    "metrics_catalog",
    "agent_grants",
    "sql_templates",
    "tenant_overlay",
)


def reload_runtime(*, warm_metricflow: bool | None = None) -> dict[str, Any]:
    """Clear all process caches; optionally re-warm MetricFlow engines.

    Call after editing catalog/agents/policies/thresholds YAML or after
    ``dbt parse`` / ``dbt run``. Does not run dbt — only refreshes what
    the API already loaded from disk.
    """
    clear_ontology_cache()
    clear_policies_cache()
    clear_registry_cache()
    clear_capabilities_cache()
    clear_entitlements_cache()
    clear_thresholds_cache()
    clear_engine_cache()
    clear_dimension_resolver_cache()
    clear_sql_cache()
    clear_context_cache()
    clear_metrics_catalog_cache()
    clear_grants_cache()
    clear_template_cache()
    clear_tenant_overlay_cache()
    close_pool()

    should_warm = True if warm_metricflow is None else warm_metricflow
    if warm_metricflow is None and not is_warm_enabled():
        should_warm = False
    mf: dict[str, Any] = {"warm": [], "failed": {}, "cached": []}
    if should_warm:
        mf = warmup_engines()
    else:
        mf = engine_status()

    runtime = warm_runtime()

    return {
        "reloaded": list(_RELOAD_LAYERS),
        "metricflow": mf,
        "runtime": runtime,
    }
