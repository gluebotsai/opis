import json
import gzip
import logging
import os

import httpx
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from config import get_settings
from ingest.schemas import (
    CollectRequest,
    DomainRejectedResponse,
    DuplicateResponse,
    ReplayChunkRequest,
    TrackingResponse,
    ValidationErrorResponse,
)
from ingest.service import (
    DomainNotRegisteredError,
    IngestService,
    KafkaPublishError,
    PayloadRejectedError,
)
from ingest.validation import MAX_BODY_BYTES, MAX_REPLAY_BODY_BYTES, PayloadValidationError
from shared.clickhouse import get_client

app = FastAPI(title="Worktual Web Tracking Ingest API", version="2.0.0")
settings = get_settings()


def _cors_allow_origins(env_key: str, *, default: str = "*") -> list[str]:
    """Parse comma-separated CORS origins for ingest (default * — any tracked site may POST)."""
    raw = os.environ.get(env_key, "").strip() or default
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or ["*"]


_ingest_cors_origins = _cors_allow_origins("INGEST_CORS_ORIGINS")

_CORS_MIDDLEWARE_KW = dict(
    allow_origins=_ingest_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,
)

app.add_middleware(CORSMiddleware, **_CORS_MIDDLEWARE_KW)

_INGEST_COLLECT_PATHS = (
    "/v1/tracking/collect",
    "/v1/tracking/nfs-ingestions",
    "/webtracking/v1/tracking/collect",
    "/webtracking/v1/tracking/nfs-ingestions",
)


async def _ingest_cors_preflight() -> Response:
    return Response(status_code=204)


def _register_cors_preflight(fastapi_app: FastAPI) -> None:
    """Explicit OPTIONS so preflight succeeds even if proxy only forwards OPTIONS oddly."""
    for path in _INGEST_COLLECT_PATHS:
        fastapi_app.add_api_route(
            path,
            _ingest_cors_preflight,
            methods=["OPTIONS"],
            include_in_schema=False,
        )


_register_cors_preflight(app)


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_request: Request, exc: RequestValidationError):
    detail = exc.errors()[0]["msg"] if exc.errors() else "invalid payload"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=ValidationErrorResponse(detail=detail).model_dump(),
    )


@app.exception_handler(ValidationError)
async def pydantic_validation_handler(_request: Request, exc: ValidationError):
    detail = exc.errors()[0]["msg"] if exc.errors() else "invalid payload"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=ValidationErrorResponse(detail=detail).model_dump(),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "2.0.0"}


async def _ingest_collect(request: Request, response: Response):
    raw_bytes = await request.body()
    if (request.headers.get("content-encoding") or "").lower() == "gzip":
        try:
            raw_bytes = gzip.decompress(raw_bytes)
        except (gzip.BadGzipFile, OSError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid gzip payload") from exc

    max_bytes = MAX_BODY_BYTES
    peek = None
    try:
        peek = json.loads(raw_bytes)
        if isinstance(peek, dict) and peek.get("type") in {"events_v2", "events_v3"}:
            pass
    except json.JSONDecodeError:
        peek = None

    if len(raw_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"payload exceeds maximum size ({max_bytes} bytes)",
        )

    try:
        body = peek if peek is not None else json.loads(raw_bytes)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid JSON") from exc

    payload_type = body.get("type", "events_v2") if isinstance(body, dict) else "events_v2"
    if payload_type == "replay_chunk_v1":
        if len(raw_bytes) > MAX_REPLAY_BODY_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"payload exceeds maximum size ({MAX_REPLAY_BODY_BYTES} bytes)",
            )
        try:
            payload = ReplayChunkRequest.from_validated_body(body)
        except PayloadValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content=ValidationErrorResponse(detail=str(exc)).model_dump(),
            )
        ingest_fn = "replay"
    else:
        try:
            payload = CollectRequest.from_validated_body(body)
        except PayloadValidationError as exc:
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content=ValidationErrorResponse(detail=str(exc)).model_dump(),
            )
        ingest_fn = "events"

    user_agent = request.headers.get("user-agent")

    client = get_client()
    try:
        service = IngestService(client, settings)
        if ingest_fn == "replay":
            payload_id, ingest_status = service.ingest_replay_chunk(payload, user_agent)
        else:
            payload_id, ingest_status = service.ingest(payload, user_agent)
    except DomainNotRegisteredError as exc:
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content=DomainRejectedResponse(detail=str(exc)).model_dump(),
        )
    except PayloadRejectedError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ValidationErrorResponse(detail=str(exc)).model_dump(),
        )
    except KafkaPublishError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": f"Kafka publish failed: {exc}"},
        )
    finally:
        client.close()

    if ingest_status == "duplicate":
        response.status_code = status.HTTP_409_CONFLICT
        return DuplicateResponse(payloadId=payload_id)

    return TrackingResponse(payloadId=payload_id, status=ingest_status)


_COLLECT_RESPONSES = {
    400: {"model": ValidationErrorResponse},
    403: {"model": DomainRejectedResponse},
    409: {"model": DuplicateResponse},
    413: {"model": ValidationErrorResponse},
    422: {"model": ValidationErrorResponse},
}


@app.post(
    "/v1/tracking/collect",
    response_model=TrackingResponse,
    responses=_COLLECT_RESPONSES,
)
async def ingest_collect(request: Request, response: Response):
    return await _ingest_collect(request, response)


@app.post(
    "/v1/tracking/nfs-ingestions",
    response_model=TrackingResponse,
    responses=_COLLECT_RESPONSES,
)
async def ingest_nfs(request: Request, response: Response):
    return await _ingest_collect(request, response)


# Public nginx path (tracking.worktual.co.uk/webtracking/...) when prefix is not stripped.
@app.post(
    "/webtracking/v1/tracking/collect",
    response_model=TrackingResponse,
    responses=_COLLECT_RESPONSES,
    include_in_schema=False,
)
async def ingest_collect_prefixed(request: Request, response: Response):
    return await _ingest_collect(request, response)


@app.post(
    "/webtracking/v1/tracking/nfs-ingestions",
    response_model=TrackingResponse,
    responses=_COLLECT_RESPONSES,
    include_in_schema=False,
)
async def ingest_nfs_prefixed(request: Request, response: Response):
    return await _ingest_collect(request, response)


# --- Gateway mode (forwards to INGEST_UPSTREAM_URL when set via run_ingest.py) ---

_gateway_logger = logging.getLogger("ingest.gateway")

gateway_app = FastAPI(
    title="Worktual Web Tracking Ingest Gateway",
    version="2.0.0",
    root_path=os.environ.get("GATEWAY_ROOT_PATH", "/webtracking"),
)

gateway_app.add_middleware(CORSMiddleware, **_CORS_MIDDLEWARE_KW)
_register_cors_preflight(gateway_app)


async def _read_gateway_payload(request: Request) -> dict:
    body = await request.body()
    if (request.headers.get("content-encoding") or "").lower() == "gzip":
        body = gzip.decompress(body)
    return json.loads(body.decode("utf-8"))


async def _forward_collect(request: Request) -> JSONResponse:
    upstream = settings.ingest_upstream_url
    if not upstream:
        return JSONResponse(
            status_code=503,
            content={"success": False, "message": "INGEST_UPSTREAM_URL is not configured"},
        )

    try:
        payload = await _read_gateway_payload(request)
    except (json.JSONDecodeError, gzip.BadGzipFile, OSError) as exc:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": f"invalid payload: {exc}"},
        )

    forward_headers = {"Content-Type": "application/json"}
    user_agent = request.headers.get("user-agent")
    if user_agent:
        forward_headers["User-Agent"] = user_agent

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(upstream, json=payload, headers=forward_headers)
    except httpx.ConnectError:
        _gateway_logger.error("Ingest upstream unreachable at %s", upstream)
        return JSONResponse(
            status_code=502,
            content={"success": False, "message": "Ingest service not reachable", "url": upstream},
        )

    try:
        content = resp.json()
    except ValueError:
        content = {
            "success": False,
            "message": "Upstream non-JSON response",
            "status": resp.status_code,
            "body": resp.text[:500],
        }

    return JSONResponse(status_code=resp.status_code, content=content)


@gateway_app.get("/health")
def gateway_health() -> dict[str, str]:
    return {"status": "ok", "service": "gateway", "version": "2.0.0"}


@gateway_app.post("/v1/tracking/nfs-ingestions")
async def gateway_ingest_nfs(request: Request):
    return await _forward_collect(request)


@gateway_app.post("/v1/tracking/collect")
async def gateway_ingest_collect(request: Request):
    return await _forward_collect(request)


@gateway_app.post("/webtracking/v1/tracking/nfs-ingestions", include_in_schema=False)
async def gateway_ingest_nfs_prefixed(request: Request):
    return await _forward_collect(request)


@gateway_app.post("/webtracking/v1/tracking/collect", include_in_schema=False)
async def gateway_ingest_collect_prefixed(request: Request):
    return await _forward_collect(request)
