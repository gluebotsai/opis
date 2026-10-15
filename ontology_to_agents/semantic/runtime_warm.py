"""Startup preload for SQL agent catalogs and pool."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_WARM_PRODUCTS = (
    "ticketing",
    "ccaas",
    "crm",
    "campaign",
    "webtracking",
    "cdp",
)


def warm_runtime(org_id: int | None = None) -> dict[str, Any]:
    """Load YAML catalogs and open the Postgres pool once at API start."""
    from semantic.agent_grants import load_grants
    from semantic.lookup import warm_lookup_caches
    from semantic.metrics.catalog import warm_metrics_catalog
    from semantic.thresholds import warm_thresholds_cache

    warm_lookup_caches()
    load_grants()
    warm_thresholds_cache()
    warm_metrics_catalog()

    from sql_agent.compiled_catalog import warm_compiled_catalogs
    from sql_agent.kpi_template_registry import clear_template_cache, get_template
    from sql_agent.presets.loader import warm_presets

    compiled = warm_compiled_catalogs()
    presets = warm_presets()

    clear_template_cache()
    for product in ("ticketing", "ccaas"):
        for mid in ("open_tickets_metric", "ticket_volume", "total_conversations"):
            get_template(product, mid)

    catalogs: list[str] = []
    for product in _WARM_PRODUCTS:
        try:
            from sql_agent.catalog_loader import load_product_catalog

            load_product_catalog(product)
            catalogs.append(product)
        except Exception:
            pass

    pool_ok = False
    entitlements_ok = False
    warm_org = org_id or int(os.environ.get("MF_WARM_ORG", "1000"))
    try:
        from semantic.pg_pool import checkout_connection, release_connection

        conn = checkout_connection()
        release_connection(conn)
        pool_ok = True
        from semantic.entitlements import load_tenant_entitlements

        load_tenant_entitlements(warm_org)
        entitlements_ok = True
    except Exception as exc:
        logger.warning("runtime warm: pool/entitlements skipped: %s", exc)

    return {
        "catalogs": catalogs,
        "compiled": compiled,
        "presets": presets,
        "pool": pool_ok,
        "entitlements": entitlements_ok,
        "org": warm_org,
    }
