"""MetricFlow query execution (optional — requires dbt-metricflow + compiled manifests)."""

from __future__ import annotations

import logging
import os
import pathlib
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

from semantic.metricflow.dimension_resolver import (
    build_group_by_catalog,
    build_metric_entity_map,
    get_tenant_dimension,
)
from semantic.metricflow.manifest_resolver import ManifestNotFoundError, resolve_manifest_dir

logger = logging.getLogger(__name__)

_engine_cache: Dict[str, Any] = {}
_manifest_dir_to_product: Dict[str, str] = {}
_cache_lock = threading.Lock()
_warmup_result: dict[str, Any] | None = None

WARM_PRODUCTS: tuple[str, ...] = ("crm", "ccaas", "ticketing", "campaign")
DEFAULT_WARM_ORG = os.environ.get("MF_WARM_ORG", "1000")

# One compile per product so the first user group-by is not a cold compile.
_WARM_DUMMY: dict[str, dict[str, Any]] = {
    "ticketing": {
        "metrics": ["open_tickets_metric"],
        "group_by": ["ticket__priority"],
    },
    "ccaas": {
        "metrics": ["total_conversations"],
        "group_by": ["conversation__channel"],
    },
    "crm": {
        "metrics": ["deal_volume"],
        "group_by": ["deal__stage"],
    },
    "campaign": {
        "metrics": ["campaign_volume"],
        "group_by": [],
    },
}

PROFILES_DIR = os.environ.get(
    "DBT_PROFILES_DIR",
    str(pathlib.Path(__file__).resolve().parents[2] / "profiles"),
)


class TenantIsolationError(RuntimeError):
    """Organization filter could not be applied — query must not run."""


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    val_str = str(value).strip().rstrip("Z")
    for fmt in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(val_str[:19], fmt)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(val_str)
    except Exception:
        return None


def _build_engine(project_dir: str):
    from dbt_metricflow.cli.cli_configuration import CLIConfiguration

    cli_config = CLIConfiguration()
    cli_config.setup(
        dbt_profiles_path=pathlib.Path(PROFILES_DIR),
        dbt_project_path=pathlib.Path(project_dir),
        configure_file_logging=False,
    )
    return cli_config.mf


def _preload_resolver_caches(manifest_dir: str) -> None:
    build_metric_entity_map(manifest_dir)
    build_group_by_catalog(manifest_dir)


def _build_mf_request(prepared: dict[str, Any], manifest_dir: str):
    from metricflow.engine.metricflow_engine import MetricFlowQueryRequest

    where = build_execution_where(prepared, manifest_dir)
    combined_where = " AND ".join(where) if where else None
    time_spec = prepared.get("time") or {}
    return MetricFlowQueryRequest.create(
        metric_names=prepared["metrics"],
        group_by_names=prepared.get("group_by") or None,
        where_constraints=[combined_where] if combined_where else None,
        time_constraint_start=_parse_iso(time_spec.get("start")),
        time_constraint_end=_parse_iso(time_spec.get("end")),
        order_by_names=prepared.get("order_by"),
        limit=prepared.get("limit"),
    )


def _compile_metricflow_sql(engine, prepared: dict[str, Any], manifest_dir: str) -> str:
    """Compile MetricFlow SQL without executing against the warehouse."""
    req = _build_mf_request(prepared, manifest_dir)
    explain = engine.explain(req)
    return str(explain.sql_statement.sql)


def _dummy_compile(product: str, organization_id: str) -> None:
    """Compile one query so the first user group-by is not a cold MF compile."""
    from semantic.metricflow.sql_cache import cache_key_for_prepared, set_cached_sql

    spec = _WARM_DUMMY.get(product)
    if not spec:
        return
    prepared = {
        "organizationId": int(organization_id) if str(organization_id).isdigit() else 1000,
        "product": product,
        "execution_product": product,
        "metrics": list(spec["metrics"]),
        "group_by": list(spec.get("group_by") or []),
        "where": [],
        "time": None,
        "order_by": None,
        "limit": 1,
    }
    engine, manifest_dir = _get_engine(product, organization_id)
    sql = _compile_metricflow_sql(engine, prepared, manifest_dir)
    if sql:
        set_cached_sql(cache_key_for_prepared(prepared), sql)


def _get_engine(product: str, organization_id: str):
    manifest_dir = resolve_manifest_dir(product, str(organization_id))
    if manifest_dir in _engine_cache:
        return _engine_cache[manifest_dir], manifest_dir

    with _cache_lock:
        if manifest_dir not in _engine_cache:
            try:
                _engine_cache[manifest_dir] = _build_engine(manifest_dir)
                _manifest_dir_to_product[manifest_dir] = product
            except Exception:
                raise
        return _engine_cache[manifest_dir], manifest_dir


def warmup_engines(
    *,
    organization_id: str | None = None,
    products: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Pre-load MetricFlow engines and resolver caches for each product."""
    global _warmup_result

    org = str(organization_id or DEFAULT_WARM_ORG)
    targets = products or WARM_PRODUCTS
    warm: list[str] = []
    failed: dict[str, str] = {}
    started = time.monotonic()

    for product in targets:
        t0 = time.monotonic()
        try:
            _get_engine(product, org)
            manifest_dir = resolve_manifest_dir(product, org)
            _preload_resolver_caches(manifest_dir)
            try:
                _dummy_compile(product, org)
            except Exception as exc:
                logger.warning("MetricFlow dummy compile skip %s: %s", product, exc)
            warm.append(product)
            logger.info(
                "MetricFlow warm: %s (%.2fs)", product, time.monotonic() - t0
            )
        except ManifestNotFoundError as exc:
            failed[product] = str(exc)
            logger.warning("MetricFlow warm skip %s: %s", product, exc)
        except ImportError as exc:
            failed[product] = str(exc)
            logger.warning("MetricFlow warm skip %s: %s", product, exc)
        except Exception as exc:
            failed[product] = str(exc)
            logger.warning("MetricFlow warm failed %s: %s", product, exc)

    elapsed = time.monotonic() - started
    _warmup_result = {
        "warm": warm,
        "failed": failed,
        "elapsed_s": round(elapsed, 2),
        "organization_id": org,
    }
    if warm:
        logger.info(
            "MetricFlow warm complete: %s (%.2fs total)",
            ", ".join(warm),
            elapsed,
        )
    return dict(_warmup_result)


def engine_status() -> dict[str, Any]:
    """Return warmup summary and currently cached engines."""
    cached = [
        _manifest_dir_to_product.get(path, path)
        for path in sorted(_engine_cache.keys())
    ]
    if _warmup_result is None:
        return {"warm": cached, "failed": {}, "cached": cached}
    return {
        "warm": list(_warmup_result.get("warm") or []),
        "failed": dict(_warmup_result.get("failed") or {}),
        "cached": cached,
        "elapsed_s": _warmup_result.get("elapsed_s"),
    }


def is_warm_enabled() -> bool:
    return os.environ.get("MF_WARM", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def clear_engine_cache() -> None:
    """Drop MetricFlow engines and warmup state (rebuild on next query or warmup)."""
    global _warmup_result
    with _cache_lock:
        _engine_cache.clear()
        _manifest_dir_to_product.clear()
        _warmup_result = None


def build_execution_where(prepared: dict[str, Any], manifest_dir: str) -> list[str]:
    """Build WHERE clauses in fixed order: org → role/assignee scope → caller filters."""
    org = str(prepared["organizationId"])
    metrics = prepared["metrics"]
    try:
        tenant_dim = get_tenant_dimension(manifest_dir, metrics[0])
    except ValueError as exc:
        raise TenantIsolationError(str(exc)) from exc

    tenant_filter = f"{{{{ Dimension('{tenant_dim}') }}}} = '{org}'"
    scope_and_caller = list(prepared.get("where") or [])
    return [tenant_filter] + scope_and_caller


def _extract_rows(result) -> list[dict]:
    if result is None or result.result_df is None:
        return []
    tbl = result.result_df
    if hasattr(tbl, "to_dict"):
        return tbl.to_dict(orient="records")
    if hasattr(tbl, "to_pandas"):
        return tbl.to_pandas().to_dict(orient="records")
    if hasattr(tbl, "column_names") and hasattr(tbl, "rows"):
        cols = list(tbl.column_names)
        return [dict(zip(cols, row)) for row in tbl.rows]
    return []


def _execute_rendered_sql(sql: str) -> list[dict]:
    from semantic.sql.db import run_postgres_query

    rows = run_postgres_query(sql, [])
    return rows


def run_metricflow_query(prepared: dict[str, Any]) -> dict[str, Any]:
    """Execute a validated semantic query via MetricFlow (with compiled SQL cache)."""
    from semantic.metricflow.sql_cache import (
        cache_key_for_prepared,
        compile_lock_for_product,
        get_cached_sql,
        set_cached_sql,
    )

    product = prepared.get("execution_product") or prepared["product"]
    metrics = prepared["metrics"]
    group_by = prepared.get("group_by") or []
    time_spec = prepared.get("time") or {}

    cache_key = cache_key_for_prepared(prepared)
    cached_sql = get_cached_sql(cache_key)
    if cached_sql:
        t0 = time.monotonic()
        rows = _execute_rendered_sql(cached_sql)
        return {
            "rows": rows,
            "sql": cached_sql,
            "path": "cache_hit",
            "compile_ms": 0,
            "warehouse_ms": int((time.monotonic() - t0) * 1000),
        }

    try:
        from metricflow.engine.metricflow_engine import MetricFlowQueryRequest  # noqa: F401
    except ImportError as exc:
        raise ImportError("dbt-metricflow is not installed") from exc

    engine, manifest_dir = _get_engine(product, str(prepared["organizationId"]))

    lock = compile_lock_for_product(str(product))
    with lock:
        cached_sql = get_cached_sql(cache_key)
        if cached_sql:
            t0 = time.monotonic()
            rows = _execute_rendered_sql(cached_sql)
            return {
                "rows": rows,
                "sql": cached_sql,
                "path": "cache_hit",
                "compile_ms": 0,
                "warehouse_ms": int((time.monotonic() - t0) * 1000),
            }

        compile_start = time.monotonic()
        sql = _compile_metricflow_sql(engine, prepared, manifest_dir)
        compile_ms = int((time.monotonic() - compile_start) * 1000)
        if sql:
            set_cached_sql(cache_key, sql)

        t0 = time.monotonic()
        rows = _execute_rendered_sql(sql) if sql else []
        warehouse_ms = int((time.monotonic() - t0) * 1000)
        return {
            "rows": rows,
            "sql": sql or None,
            "path": "mf_compile",
            "compile_ms": compile_ms,
            "warehouse_ms": warehouse_ms,
        }
