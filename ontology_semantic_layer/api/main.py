"""FastAPI context layer — ontology slices (spokes + Hub) and semantic execute."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from enum import Enum
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Path, Query
from pydantic import BaseModel, Field, model_validator

from ontology.slice import (
    fetch_ontology_slice,
    get_catalog,
    list_agents,
    list_modules,
    list_presets,
)
from semantic.entitlements import intersect_hub_products, load_tenant_entitlements
from semantic.lookup import get_metric_schema
from semantic.thresholds import merge_threshold
from semantic.query import (
    MetricFlowUnavailableError,
    QueryValidationError,
    SemanticQuery,
    SemanticQueryExecutionError,
    WarehouseQueryError,
    execute,
    execute_multi,
    validate_and_prepare,
)
from sql_agent import SqlAgentError, WarehouseUnavailableError, execute_sql_query
from sql_agent.job import SqlQueryRequest
from sql_agent.mas.gemma_client import GemmaTimeoutError, GemmaUnavailableError
from sql_agent.mas.cross_product import CrossProductError
from sql_agent.validator import SqlValidationError
from semantic.response import shape_client_response
from semantic.runtime_reload import reload_runtime
from api.request_logging import RequestStartLoggingMiddleware, access_logger

HUB_SELECTOR = "hub.orchestrator"
logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    from api.logging_setup import configure_logging
    from semantic.metricflow.engine import engine_status, is_warm_enabled, warmup_engines

    configure_logging()
    if is_warm_enabled():
        logger.info("MetricFlow warmup starting (always-on for API start)...")
        result = warmup_engines()
        logger.info(
            "MetricFlow warmup done: warm=%s failed=%s elapsed=%ss",
            result.get("warm"),
            list(result.get("failed") or {}),
            result.get("elapsed_s"),
        )
    else:
        logger.info("MetricFlow warmup skipped (MF_WARM=0 — tests only)")
    from semantic.runtime_warm import warm_runtime

    runtime = warm_runtime()
    logger.info(
        "Runtime preload: catalogs=%s pool=%s entitlements=%s",
        runtime.get("catalogs"),
        runtime.get("pool"),
        runtime.get("entitlements"),
    )
    _app.state.metricflow = engine_status()
    yield


app = FastAPI(
    title="Worktual Context Layer",
    description=(
        "Spokes: **POST /v1/ontology/slice** with `product`. "
        "Hub: **POST /v1/ontology/hub** with `products[]`. "
        "Metrics: **POST /v1/semantic/query** (structured MetricFlow). "
        "Rows / SQL fallback: **POST /v1/sql/query** (Super agent). "
        "Admin: discovery (`/v1/agents`, `/v1/presets`, `/v1/modules`), "
        "`GET /v1/metrics/{id}`, **POST /v1/admin/reload** (requires `CONTEXT_RELOAD_SECRET`)."
    ),
    version="1.2.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=_lifespan,
)

app.add_middleware(RequestStartLoggingMiddleware)


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    return {
        "service": "worktual-context-layer",
        "spoke_endpoint": "POST /v1/ontology/slice",
        "hub_endpoint": "POST /v1/ontology/hub",
        "semantic_endpoint": "POST /v1/semantic/query",
        "sql_endpoint": "POST /v1/sql/query",
        "health": "GET /health",
        "docs": "/docs",
    }


class SliceFormat(str, Enum):
    prompt = "prompt"
    debug = "debug"
    verbose = "verbose"
    json = "json"


class SpokeSliceRequest(BaseModel):
    organization_id: int = Field(..., alias="organizationId", ge=1)
    user_id: int | None = Field(
        None,
        alias="userId",
        ge=1,
        description="Caller user id — packs metrics by entitlements and role.",
    )
    agent: str | None = None
    preset: str | None = None
    modules: list[str] | None = None
    product: str = Field(
        ...,
        description="Spoke origin SKU (e.g. ccaas, crm, ticketing).",
    )
    format: SliceFormat = SliceFormat.prompt

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @model_validator(mode="after")
    def validate_request(self) -> SpokeSliceRequest:
        provided = sum(
            1 for x in (self.agent, self.preset, self.modules) if x is not None
        )
        if provided != 1:
            raise ValueError(
                "Provide exactly one of: agent, preset, modules (not zero, not more than one)."
            )
        if self.modules is not None and len(self.modules) == 0:
            raise ValueError("modules must be a non-empty list when used as the selector.")
        if self.agent == HUB_SELECTOR or self.preset == HUB_SELECTOR:
            raise ValueError(
                "Hub must use POST /v1/ontology/hub with products[], not /v1/ontology/slice."
            )
        if not self.product or not str(self.product).strip():
            raise ValueError(
                "Spoke requires product: origin SKU (e.g. ccaas, crm, ticketing)."
            )
        return self


class HubRequest(BaseModel):
    organization_id: int = Field(..., alias="organizationId", ge=1)
    user_id: int | None = Field(None, alias="userId", ge=1)
    products: list[str] = Field(
        ...,
        min_length=1,
        description="Exact list of active purchased SKUs.",
    )
    format: SliceFormat = SliceFormat.prompt

    model_config = {"populate_by_name": True}


class FilterSpec(BaseModel):
    dimension: str
    op: str = "eq"
    operator: str | None = None
    value: Any | None = None
    values: list[Any] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_filter_shape(self) -> FilterSpec:
        if self.operator:
            op = self.operator.strip().lower()
            if op in ("equals", "equal"):
                op = "eq"
            object.__setattr__(self, "op", op)
        if self.value is not None and not self.values:
            vals = [self.value] if not isinstance(self.value, list) else list(self.value)
            object.__setattr__(self, "values", vals)
        return self


class TimeSpec(BaseModel):
    start: str | None = None
    end: str | None = None
    grain: str | None = None
    period: str | None = None


class MetricRequestSpec(BaseModel):
    organization_id: int = Field(..., alias="organizationId", ge=1)
    user_id: int = Field(..., alias="userId", ge=1)
    product: str
    agent: str
    metrics: list[str] = Field(..., min_length=1)
    group_by: list[str] | None = None
    filters: list[FilterSpec] | None = None
    time: TimeSpec | None = None
    order_by: list[str] | None = None
    limit: int | None = Field(default=50, ge=1, le=500)

    model_config = {"populate_by_name": True}


class SqlQueryRequestModel(BaseModel):
    organization_id: int = Field(..., alias="organizationId", ge=1)
    user_id: int = Field(..., alias="userId", ge=1)
    origin_product: str = Field(..., alias="originProduct")
    origin_agent: str = Field(..., alias="originAgent")
    instruction: str
    entity_hint: str | None = Field(None, alias="entityHint")
    filters: list[FilterSpec] | None = None
    limit: int = Field(default=20, ge=1, le=200)
    metric_request: MetricRequestSpec | None = Field(None, alias="metricRequest")

    model_config = {"populate_by_name": True}


class ExecutorJobRequest(BaseModel):
    """Internal: run a single executor job (tests)."""
    job: dict[str, Any]

    model_config = {"populate_by_name": True, "extra": "forbid"}


class SemanticQueryRequest(BaseModel):
    organization_id: int = Field(..., alias="organizationId", ge=1)
    user_id: int = Field(..., alias="userId", ge=1)
    product: str
    agent: str
    metrics: list[str] = Field(..., min_length=1)
    group_by: list[str] | None = None
    filters: list[FilterSpec] | None = None
    time: TimeSpec | None = None
    order_by: list[str] | None = None
    limit: int | None = Field(default=50, ge=1, le=500)
    data_scope: str | None = Field(
        None,
        alias="dataScope",
        description="Ticketing only: org (default for admin) or mine for personal KPIs",
    )
    website_id: int | None = Field(
        None,
        alias="websiteId",
        ge=1,
        description="Webtracking site tenant key (filters ClickHouse website_id)",
    )

    model_config = {"populate_by_name": True, "extra": "forbid"}


def tenant_from_org(organization_id: int) -> str:
    return f"org{organization_id}"


def _selector_payload(req: SpokeSliceRequest) -> dict[str, Any]:
    if req.agent is not None:
        return {"kind": "agent", "value": req.agent}
    if req.preset is not None:
        return {"kind": "preset", "value": req.preset}
    return {"kind": "modules", "value": req.modules}


def _fetch_spoke_slice(req: SpokeSliceRequest):
    from semantic.entitlements import spoke_product_entitled

    if not spoke_product_entitled(req.organization_id, req.product):
        raise HTTPException(
            status_code=403,
            detail=(
                f"Organization {req.organization_id} is not entitled to product "
                f"'{req.product}'."
            ),
        )
    tenant = tenant_from_org(req.organization_id)
    kwargs: dict[str, Any] = {
        "tenant": tenant,
        "product": req.product,
        "user_id": req.user_id,
    }
    if req.agent is not None:
        kwargs["agent"] = req.agent
    elif req.preset is not None:
        kwargs["preset"] = req.preset
    else:
        kwargs["modules"] = req.modules
    try:
        pack = fetch_ontology_slice(**kwargs)
        logger.info(
            "ontology.slice org=%s tenant=%s product=%s agent=%s preset=%s industry=%s modules=%s",
            req.organization_id,
            tenant,
            req.product,
            req.agent,
            req.preset,
            pack.industry_pack,
            ",".join(pack.resolved_modules[:8]),
        )
        return pack
    except ValueError as exc:
        logger.error(
            "ontology.slice failed org=%s product=%s agent=%s: %s",
            req.organization_id,
            req.product,
            req.agent,
            exc,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _slice_response(
    *,
    organization_id: int,
    pack,
    req_format: SliceFormat,
    selector: dict[str, Any] | None = None,
    product: str | None = None,
    products: list[str] | None = None,
) -> dict[str, Any]:
    tenant = tenant_from_org(organization_id)
    mode: Literal["compact", "verbose"] = (
        "verbose" if req_format == SliceFormat.verbose else "compact"
    )
    prompt_text = pack.as_prompt(mode=mode)

    body: dict[str, Any] = {
        "organizationId": organization_id,
        "tenant": tenant,
        "version": pack.version,
        "industryPack": pack.industry_pack,
        "prompt": prompt_text,
    }

    ctx = getattr(pack, "context", None)
    if ctx is not None:
        body["role"] = ctx.role
        body["entitlements"] = {
            "skus": list(ctx.entitlements.skus),
            "channels": dict(ctx.entitlements.channels),
            "features": dict(ctx.entitlements.features),
            "version": ctx.entitlements.version,
        }
        body["metrics"] = list(ctx.metrics)
    else:
        ent = load_tenant_entitlements(organization_id)
        body["entitlements"] = {
            "skus": list(ent.skus),
            "channels": dict(ent.channels),
            "features": dict(ent.features),
            "version": ent.version,
        }

    if req_format == SliceFormat.json:
        from ontology.slice import public_ontology_id

        body.update(
            {
                "selector": selector,
                "ontology": public_ontology_id(pack.ontology_id),
                "agent": pack.agent,
                "preset": pack.preset,
                "resolved_modules": pack.resolved_modules,
                "slice": pack.to_public_dict(),
            }
        )
        if products is not None:
            body["products"] = products
        elif product is not None:
            body["product"] = product
        return body

    if req_format in (SliceFormat.debug, SliceFormat.verbose):
        from ontology.slice import public_ontology_id

        body.update(
            {
                "selector": selector,
                "ontology": public_ontology_id(pack.ontology_id),
                "agent": pack.agent,
                "preset": pack.preset,
                "resolved_modules": pack.resolved_modules,
            }
        )
        if products is not None:
            body["products"] = products
        elif product is not None:
            body["product"] = product

    return body


_REQUIRED_WARM = frozenset({"ccaas", "ticketing"})


@app.get("/health")
def health() -> dict[str, Any]:
    from semantic.metricflow.engine import engine_status, is_warm_enabled

    mf = engine_status()
    routes = {getattr(r, "path", "") for r in app.routes}
    sql_ready = "/v1/sql/query" in routes
    warm_set = set(mf.get("warm") or []) | set(mf.get("cached") or [])
    missing_warm = sorted(_REQUIRED_WARM - warm_set) if is_warm_enabled() else []
    body: dict[str, Any] = {
        "status": "ok",
        "metricflow": mf,
        "sqlAgent": {"endpoint": "/v1/sql/query", "registered": sql_ready},
        "requiredWarm": sorted(_REQUIRED_WARM),
        "missingWarm": missing_warm,
    }
    if not sql_ready or missing_warm:
        body["status"] = "degraded"
    if is_warm_enabled() and mf.get("failed"):
        body["status"] = "degraded"
    return body


@app.get("/v1/version")
def version() -> dict[str, str]:
    meta = get_catalog().catalog.get("ontology") or {}
    return {
        "service": app.version,
        "ontology_id": "worktual-ontology",
        "ontology_version": str(meta.get("version") or "unknown"),
    }


@app.get("/v1/agents", tags=["admin"])
def agents() -> dict[str, list[str]]:
    """List registered agent ids from ontology/agents.yml."""
    return {"agents": list_agents()}


@app.get("/v1/presets", tags=["admin"])
def presets() -> dict[str, list[str]]:
    """List catalog preset ids from ontology/catalog.yml."""
    return {"presets": list_presets()}


@app.get("/v1/modules", tags=["admin"])
def modules() -> dict[str, list[str]]:
    """List ontology module ids from ontology/catalog.yml."""
    return {"modules": list_modules()}


def _reload_secret() -> str | None:
    val = os.environ.get("CONTEXT_RELOAD_SECRET", "").strip()
    return val or None


@app.post("/v1/admin/reload", tags=["admin"])
def admin_reload(
    x_reload_secret: str | None = Header(
        None,
        alias="X-Reload-Secret",
        description="Must match server env CONTEXT_RELOAD_SECRET (404 if env unset).",
    ),
) -> dict[str, Any]:
    """Clear in-memory caches and re-warm MetricFlow after YAML or dbt parse changes."""
    secret = _reload_secret()
    if secret is None:
        raise HTTPException(status_code=404, detail="Reload endpoint not configured")
    if not x_reload_secret or x_reload_secret != secret:
        raise HTTPException(status_code=403, detail="Invalid reload secret")
    result = reload_runtime()
    app.state.metricflow = result.get("metricflow") or {}
    logger.info("admin.reload layers=%s", result.get("reloaded"))
    return result


@app.get("/v1/metrics/{metric_id}", tags=["admin"])
def metric_schema(
    metric_id: str = Path(..., min_length=1, description="Certified metric id"),
    organization_id: int | None = Query(
        None,
        alias="organizationId",
        ge=1,
        description="Optional org id for threshold overlay",
    ),
) -> dict[str, Any]:
    """Return registry row + merged thresholds for a certified metric."""
    try:
        row = get_metric_schema(metric_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        threshold_meta = merge_threshold(metric_id, organization_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    row = {**row, **threshold_meta}
    if organization_id is not None:
        row["organizationId"] = organization_id
    return row


@app.post("/v1/ontology/slice", tags=["spoke"])
def ontology_slice(req: SpokeSliceRequest) -> dict[str, Any]:
    pack = _fetch_spoke_slice(req)
    return _slice_response(
        organization_id=req.organization_id,
        pack=pack,
        req_format=req.format,
        selector=_selector_payload(req),
        product=req.product,
    )


@app.post("/v1/ontology/hub", tags=["hub"])
def ontology_hub(req: HubRequest) -> dict[str, Any]:
    tenant = tenant_from_org(req.organization_id)
    entitled_products = intersect_hub_products(req.organization_id, req.products)
    if not entitled_products:
        raise HTTPException(
            status_code=403,
            detail="No entitled products for this organization.",
        )
    try:
        pack = fetch_ontology_slice(
            agent=HUB_SELECTOR,
            tenant=tenant,
            products=entitled_products,
            user_id=req.user_id,
        )
        logger.info(
            "ontology.hub org=%s tenant=%s products=%s entitled=%s industry=%s",
            req.organization_id,
            tenant,
            req.products,
            entitled_products,
            pack.industry_pack,
        )
    except ValueError as exc:
        logger.error(
            "ontology.hub failed org=%s products=%s: %s",
            req.organization_id,
            req.products,
            exc,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _slice_response(
        organization_id=req.organization_id,
        pack=pack,
        req_format=req.format,
        selector={"kind": "hub", "value": entitled_products},
        products=entitled_products,
    )


@app.post("/v1/semantic/query", tags=["semantic"])
async def semantic_query(req: SemanticQueryRequest) -> dict[str, Any]:
    from semantic.entitlements import spoke_product_entitled

    if not spoke_product_entitled(req.organization_id, req.product):
        raise HTTPException(
            status_code=403,
            detail=(
                f"Organization {req.organization_id} is not entitled to product "
                f"'{req.product}'."
            ),
        )
    query = SemanticQuery(
        organization_id=req.organization_id,
        user_id=req.user_id,
        product=req.product,
        agent=req.agent,
        metrics=req.metrics,
        group_by=req.group_by,
        filters=[f.model_dump() for f in (req.filters or [])],
        time=req.time.model_dump() if req.time else None,
        order_by=req.order_by,
        limit=req.limit,
        data_scope=req.data_scope,
        website_id=req.website_id,
    )
    access_logger.info(
        "semantic.query.start org=%s user=%s product=%s agent=%s metrics=%s",
        req.organization_id,
        req.user_id,
        req.product,
        req.agent,
        req.metrics,
    )
    try:
        runner = execute_multi if len(req.metrics) > 1 else execute
        result = await asyncio.to_thread(runner, query)
        timing = result.get("_timing") or {}
        logger.info(
            "semantic.query org=%s user=%s product=%s agent=%s metrics=%s rows=%s "
            "path=%s prepare_ms=%s compile_ms=%s warehouse_ms=%s source=%s",
            req.organization_id,
            req.user_id,
            req.product,
            req.agent,
            req.metrics,
            len(result.get("rows") or []),
            timing.get("path"),
            timing.get("prepare_ms"),
            timing.get("compile_ms"),
            timing.get("warehouse_ms"),
            result.get("source"),
        )
        return shape_client_response(
            result.get("rows") or [],
            metric_ids=req.metrics,
            organization_id=req.organization_id,
        )
    except QueryValidationError as exc:
        logger.error(
            "semantic.query validation org=%s metrics=%s: %s",
            req.organization_id,
            req.metrics,
            exc,
        )
        detail: dict[str, Any] = {"message": str(exc)}
        if exc.code:
            detail["code"] = exc.code
        if exc.website_id is not None:
            detail["websiteId"] = exc.website_id
        if exc.suggestions:
            detail["suggestions"] = exc.suggestions
        status = 403 if exc.code == "website_not_entitled" else 400
        raise HTTPException(status_code=status, detail=detail) from exc
    except WarehouseQueryError as exc:
        logger.error(
            "semantic.query warehouse org=%s metrics=%s: %s",
            req.organization_id,
            req.metrics,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail={"message": str(exc)},
        ) from exc
    except MetricFlowUnavailableError as exc:
        logger.error(
            "semantic.query unavailable org=%s metrics=%s: %s",
            req.organization_id,
            req.metrics,
            exc,
        )
        try:
            prepared = validate_and_prepare(query)
        except Exception:
            prepared = None
        raise HTTPException(
            status_code=503,
            detail={
                "message": str(exc),
                "validated": prepared,
            },
        ) from exc
    except SemanticQueryExecutionError as exc:
        logger.error(
            "semantic.query execution org=%s metrics=%s: %s",
            req.organization_id,
            req.metrics,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail={"error": type(exc).__name__, "message": str(exc)},
        ) from exc
    except ImportError as exc:
        logger.error("semantic.query import org=%s: %s", req.organization_id, exc)
        try:
            prepared = validate_and_prepare(query)
        except Exception:
            prepared = None
        raise HTTPException(
            status_code=503,
            detail={
                "message": "MetricFlow is not installed or manifests are missing.",
                "validated": prepared,
            },
        ) from exc
    except Exception as exc:
        logger.exception(
            "semantic.query unexpected org=%s metrics=%s",
            req.organization_id,
            req.metrics,
        )
        raise HTTPException(
            status_code=500,
            detail={"error": type(exc).__name__, "message": str(exc)},
        ) from exc


@app.post("/v1/sql/query", tags=["sql"])
async def sql_query(req: SqlQueryRequestModel) -> dict[str, Any]:
    """SQL Super Agent — instruction-first list/count/KPI. `metricRequest` is soft/deprecated (hint only when INSTRUCTION_FIRST=1)."""
    mr = None
    if req.metric_request:
        mr = {
            "organizationId": req.metric_request.organization_id,
            "userId": req.metric_request.user_id,
            "product": req.metric_request.product,
            "agent": req.metric_request.agent,
            "metrics": req.metric_request.metrics,
            "groupBy": req.metric_request.group_by,
            "filters": [f.model_dump() for f in (req.metric_request.filters or [])],
            "time": req.metric_request.time.model_dump() if req.metric_request.time else None,
            "orderBy": req.metric_request.order_by,
            "limit": req.metric_request.limit,
        }
    request = SqlQueryRequest(
        organization_id=req.organization_id,
        user_id=req.user_id,
        origin_product=req.origin_product,
        origin_agent=req.origin_agent,
        instruction=req.instruction,
        entity_hint=req.entity_hint,
        filters=[f.model_dump() for f in (req.filters or [])],
        limit=req.limit,
        metric_request=mr,
    )
    access_logger.info(
        "sql.query.start org=%s user=%s origin=%s/%s metric=%s",
        req.organization_id,
        req.user_id,
        req.origin_product,
        req.origin_agent,
        (req.metric_request.metrics if req.metric_request else None),
    )
    try:
        result = await asyncio.to_thread(execute_sql_query, request)
        timing_source = result.get("source")
        logger.info(
            "sql.query org=%s user=%s origin=%s/%s source=%s rows=%s preset=%s latency=%s",
            req.organization_id,
            req.user_id,
            req.origin_product,
            req.origin_agent,
            timing_source,
            len(result.get("rows") or []),
            result.get("presetId"),
            result.get("latencyMs"),
        )
        shaped = shape_client_response(
            result.get("rows") or [],
            metric_ids=list(result.get("metrics") or []),
            organization_id=int(result.get("organizationId") or req.organization_id),
        )
        meta = {
            k: result[k]
            for k in (
                "source",
                "presetId",
                "planner",
                "planId",
                "latencyMs",
                "table",
                "scope",
            )
            if result.get(k) is not None
        }
        result_meta = result.get("_meta") or {}
        if isinstance(result_meta, dict):
            warnings = result_meta.get("warnings")
            if warnings:
                meta["warnings"] = warnings
        if meta:
            shaped["_meta"] = meta
        return shaped
    except SqlAgentError as exc:
        raise HTTPException(status_code=400, detail=exc.to_detail()) from exc
    except SqlValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "validation_error", "message": str(exc)},
        ) from exc
    except CrossProductError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "cross_product_denied", "message": str(exc)},
        ) from exc
    except GemmaTimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "unavailable", "message": str(exc), "retry": True},
        ) from exc
    except GemmaUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "unavailable", "message": str(exc), "retry": True},
        ) from exc
    except WarehouseUnavailableError as exc:
        raise HTTPException(status_code=503, detail=exc.to_detail()) from exc
    except Exception as exc:
        logger.exception("sql.query org=%s", req.organization_id)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "internal",
                "message": "SQL agent failed. Check server logs.",
            },
        ) from exc


@app.exception_handler(ValueError)
def value_error_handler(_request, exc: ValueError):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=400, content={"detail": str(exc)})
