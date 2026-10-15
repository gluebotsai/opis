"""Knowledge-base client.

POST /retrieve {domain_id, query, filter?, limit, semantic_ratio} or
legacy POST /search {organization_id, module, query, product_ids}.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Literal
from urllib.parse import urlparse, urlunparse

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_CUID_RE = re.compile(r"^c[a-z0-9]{24,}$", re.I)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)
_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
# Context Layer indexes Worktual modules, not inventory.products CUIDs.
_KNOWN_SLUGS = {
    "crm": "crm",
    "cdp": "cdp",
    "ccaas": "contact-center",
    "ccaa": "contact-center",
    "contact-center": "contact-center",
    "contactcenter": "contact-center",
    "campaign": "campaign",
    "campaigns": "campaign",
    "cvm": "value-management",
    "value-management": "value-management",
    "ticketing": "ticketing",
    "ticket": "ticketing",
    "tickets": "ticketing",
    "web-tracking": "web-tracking",
    "webtracking": "web-tracking",
    "lola": "contact-center",
}
_NAME_SLUGS = (
    ("contact center", "contact-center"),
    ("value management", "value-management"),
    ("web tracking", "web-tracking"),
    ("ccaas", "contact-center"),
    ("ticketing", "ticketing"),
    ("campaign", "campaign"),
    ("lola", "contact-center"),
    ("cdp", "cdp"),
    ("cvm", "value-management"),
    ("crm", "crm"),
)


def looks_like_inventory_id(value: str) -> bool:
    raw = (value or "").strip()
    if not raw:
        return False
    if _CUID_RE.match(raw) or _UUID_RE.match(raw):
        return True
    return raw.isdigit()


def kb_product_slug(value: str | None) -> str | None:
    """Map a catalog id/sku/name onto a Context Layer product slug, or None."""
    raw = (value or "").strip()
    if not raw or looks_like_inventory_id(raw):
        return None
    compact = raw.lower().replace("_", "-")
    if " " not in compact and compact in _KNOWN_SLUGS:
        return _KNOWN_SLUGS[compact]
    padded = f" {re.sub(r'[^a-z0-9]+', ' ', raw.lower()).strip()} "
    for token, slug in _NAME_SLUGS:
        if f" {token} " in padded:
            return slug
    # SKU that is already a module slug (crm, contact-center) — not a display name.
    if " " not in raw and _SLUG_RE.match(compact):
        return compact
    return None


def resolve_kb_product_ids(
    *candidates: str | None,
    default: str | None = None,
) -> list[str]:
    """KB search requires product_ids. Drop inventory CUIDs; keep module slugs."""
    out: list[str] = []
    for raw in candidates:
        slug = kb_product_slug(str(raw) if raw is not None else "")
        if slug and slug not in out:
            out.append(slug)
    if out:
        return out[:20]
    fallback = (default or "").strip() or "crm"
    slug = kb_product_slug(fallback) or fallback
    return [slug] if slug else ["crm"]


KbModule = Literal["product", "support", "business"]

KB_UNAVAILABLE_REASON = "kb_unavailable"
KB_UNAVAILABLE_MESSAGE = (
    "Product catalog lookup is temporarily unavailable, try again shortly"
)
_KB_TRANSPORT_TYPES = {
    "ConnectTimeout",
    "ConnectError",
    "ReadTimeout",
    "WriteTimeout",
    "TimeoutException",
    "NetworkError",
    "RemoteProtocolError",
    "ProxyError",
    "PoolTimeout",
}
_RETRY_TRANSPORT_TYPES = {"ReadTimeout", "TimeoutException"}


def format_kb_error(exc: BaseException) -> tuple[str, str]:
    """Return (type_name, message). str(exc) is often empty on connect timeouts."""
    name = type(exc).__name__
    msg = str(exc).strip() or repr(exc)
    cause = exc.__cause__ or getattr(exc, "__context__", None)
    if cause and cause is not exc:
        extra = str(cause).strip() or repr(cause)
        if extra and extra not in msg:
            msg = f"{msg} ({type(cause).__name__}: {extra})"
    return name, msg[:400]


def is_kb_transport_failure(result: dict[str, Any] | None) -> bool:
    """True when search never reached a usable KB response (timeout, connect, 5xx)."""
    if not isinstance(result, dict) or result.get("status") == "success":
        return False
    err_type = str(result.get("errorType") or "")
    if err_type in _KB_TRANSPORT_TYPES:
        return True
    blob = " ".join(
        str(x) for x in (result.get("error"), err_type, result.get("data")) if x
    ).lower()
    return any(
        tok in blob
        for tok in (
            "timeout",
            "timed out",
            "connect",
            "unreachable",
            "connection refused",
            "name or service not known",
            "nodename nor servname",
            "503",
            "502",
            "504",
            "network",
        )
    )


def resolve_kb_module(mode_or_module: str | None) -> KbModule:
    """Map legacy sales/service labels onto Context Layer modules."""
    m = (mode_or_module or "product").strip().lower()
    if m in {"service", "support", "cs", "helpdesk"}:
        return "support"
    if m in {"business", "hr", "policy", "company"}:
        return "business"
    # sales / product / demo / default → product KB
    return "product"


def _hit_text(hit: Any) -> str:
    if isinstance(hit, str):
        return hit.strip()
    if not isinstance(hit, dict):
        return ""
    for key in (
        "text",
        "content",
        "chunk",
        "body",
        "snippet",
        "passage",
        "page_content",
        "document",
    ):
        val = hit.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, dict):
            nested = _hit_text(val)
            if nested:
                return nested
    formatted = hit.get("_formatted")
    if isinstance(formatted, dict):
        nested = _hit_text(formatted)
        if nested:
            return nested
    return ""


def _extract_results(body: Any) -> list[Any]:
    if not isinstance(body, dict):
        return []
    for key in ("results", "hits", "data", "documents"):
        raw = body.get(key)
        if isinstance(raw, list):
            return raw
    return []


def normalize_knowledge_base_url(url: str) -> str:
    """Bare origin becomes /retrieve. /search and /retrieve paths are kept."""
    raw = (url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    path = (parsed.path or "").rstrip("/")
    if path.endswith("/search") or path.endswith("/retrieve"):
        return raw.rstrip("/")
    if path in {"", "/"}:
        return urlunparse(parsed._replace(path="/retrieve"))
    return raw.rstrip("/")


def kb_uses_retrieve(url: str) -> bool:
    path = urlparse(normalize_knowledge_base_url(url)).path.rstrip("/").lower()
    return path.endswith("/retrieve")


def retrieve_payload(
    *,
    domain_id: str,
    query: str,
    limit: int,
    semantic_ratio: float,
    filters: list[str] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "domain_id": domain_id,
        "query": query,
        "limit": max(1, min(int(limit or 5), 100)),
        "semantic_ratio": max(0.0, min(float(semantic_ratio), 1.0)),
    }
    cleaned = [str(item).strip() for item in (filters or []) if str(item).strip()]
    if cleaned:
        body["filter"] = cleaned
    return body


def search_payload(
    *,
    organization_id: str,
    module: str,
    query: str,
    limit: int,
    product_ids: list[str],
    ccaas_audience: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "organization_id": organization_id,
        "module": module,
        "query": query,
        "max_no_result": max(1, min(int(limit or 5), 20)),
        "product_ids": product_ids,
    }
    if ccaas_audience:
        body["ccaas_audience"] = str(ccaas_audience).strip()
    return body


async def search_knowledge(
    query: str,
    *,
    module: str = "product",
    limit: int = 5,
    organization_id: str | None = None,
    product_id: str | None = None,
    product_ids: list[str] | None = None,
    ccaas_audience: str | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    """Search one KB module. Returns {status, query, context, hitCount, module}."""
    q = (query or "").strip()
    if not q:
        return {"status": "failure", "data": {"query": query, "result": "Empty query."}}

    settings = get_settings()
    mod = resolve_kb_module(module)
    org = (
        (organization_id or settings.kb_organization_id or "0000").strip() or "0000"
    )
    default_pid = (settings.kb_product_id or "crm").strip() or "crm"
    candidates: list[str | None] = []
    if product_ids:
        candidates.extend(
            str(raw).strip() if raw is not None else None for raw in product_ids
        )
    if product_id is not None:
        candidates.append(str(product_id).strip() or None)
    ids = resolve_kb_product_ids(*candidates, default=default_pid)
    max_n = max(1, min(int(limit or 5), 20))
    url = normalize_knowledge_base_url(settings.knowledge_base_url or "")
    timeout_s = float(
        timeout if timeout is not None else (settings.knowledge_base_timeout_s or 12)
    )

    if not url:
        return {
            "status": "failure",
            "data": {"query": q, "result": "Some technical issue."},
            "error": "KNOWLEDGE_BASE_URL is empty",
            "errorType": "ConfigError",
            "module": mod,
        }

    domain_id = (
        (getattr(settings, "kb_domain_id", None) or "").strip()
        or org
    )
    ratio = float(getattr(settings, "knowledge_base_semantic_ratio", 0.9) or 0.9)
    if kb_uses_retrieve(url):
        payload = retrieve_payload(
            domain_id=domain_id,
            query=q,
            limit=max_n,
            semantic_ratio=ratio,
            filters=ids,
        )
    else:
        payload = search_payload(
            organization_id=org,
            module=mod,
            query=q,
            limit=max_n,
            product_ids=ids,
            ccaas_audience=ccaas_audience,
        )

    http_timeout = httpx.Timeout(
        timeout_s,
        connect=min(5.0, timeout_s),
        write=min(10.0, timeout_s),
    )
    last_failure: dict[str, Any] | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(
                timeout=http_timeout,
                headers={
                    "User-Agent": "worktual-ai-service/1.0",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            ) as client:
                res = await client.post(url, json=payload)
                res.raise_for_status()
                body = res.json()
            hits = _extract_results(body)
            texts = [t for h in hits if (t := _hit_text(h))]
            context = "\n\n".join(texts)
            return {
                "status": "success",
                "query": q,
                "module": mod,
                "context": context,
                "hitCount": len(hits),
                "organizationId": org,
            }
        except Exception as exc:  # noqa: BLE001
            err_type, err_msg = format_kb_error(exc)
            last_failure = {
                "status": "failure",
                "data": {"query": q, "result": "Some technical issue."},
                "error": f"{err_type}: {err_msg}"[:400],
                "errorType": err_type,
                "module": mod,
            }
            if err_type in _RETRY_TRANSPORT_TYPES and attempt == 0:
                logger.warning(
                    "Knowledge base search timeout retry module=%s org=%s type=%s",
                    mod,
                    org,
                    err_type,
                )
                continue
            logger.warning(
                "Knowledge base search failed module=%s org=%s type=%s: %s",
                mod,
                org,
                err_type,
                err_msg,
            )
            return last_failure
    return last_failure or {
        "status": "failure",
        "data": {"query": q, "result": "Some technical issue."},
        "error": "Knowledge base search failed",
        "errorType": "ReadTimeout",
        "module": mod,
    }


async def probe_product_knowledge(
    *,
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Cheap reachability check. HTTP 200 with zero hits still counts as available."""
    settings = get_settings()
    probe_timeout = float(settings.knowledge_base_probe_timeout_s or 3)
    result = await search_knowledge(
        "product capabilities",
        module="product",
        limit=1,
        organization_id=organization_id,
        timeout=probe_timeout,
    )
    if result.get("status") == "success":
        return {
            "available": True,
            "module": "product",
            "organizationId": result.get("organizationId"),
            "hitCount": result.get("hitCount") or 0,
        }
    if is_kb_transport_failure(result):
        return {
            "available": False,
            "reason": KB_UNAVAILABLE_REASON,
            "error": result.get("error") or KB_UNAVAILABLE_MESSAGE,
            "errorType": result.get("errorType"),
            "module": result.get("module") or "product",
            "message": KB_UNAVAILABLE_MESSAGE,
        }
    return {
        "available": True,
        "degraded": True,
        "module": result.get("module") or "product",
        "error": result.get("error"),
        "errorType": result.get("errorType"),
    }


async def get_product_knowledge(
    query: str,
    limit: int = 5,
    *,
    organization_id: str | None = None,
    product_id: str | None = None,
    product_ids: list[str] | None = None,
    timeout: float | None = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Product KB — capabilities, features, product docs."""
    return await search_knowledge(
        query,
        module="product",
        limit=limit,
        organization_id=organization_id,
        product_id=product_id,
        product_ids=product_ids,
        timeout=timeout,
    )


async def get_support_knowledge(
    query: str,
    limit: int = 5,
    *,
    organization_id: str | None = None,
    product_id: str | None = None,
    timeout: float | None = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Support KB — customer support / how-to docs."""
    return await search_knowledge(
        query,
        module="support",
        limit=limit,
        organization_id=organization_id,
        product_id=product_id,
        timeout=timeout,
    )


async def get_business_knowledge(
    query: str,
    limit: int = 5,
    *,
    organization_id: str | None = None,
    product_id: str | None = None,
    timeout: float | None = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Business KB — company policies and internal business context."""
    return await search_knowledge(
        query,
        module="business",
        limit=limit,
        organization_id=organization_id,
        product_id=product_id,
        timeout=timeout,
    )


# Backward-compatible aliases (old sales/service domain retrieve)
async def get_sales_knowledge(
    query: str,
    limit: int = 5,
    **kwargs: Any,
) -> dict[str, Any]:
    return await get_product_knowledge(query, limit=limit, **kwargs)


async def get_service_knowledge(
    query: str,
    limit: int = 5,
    **kwargs: Any,
) -> dict[str, Any]:
    return await get_support_knowledge(query, limit=limit, **kwargs)


async def get_meeting_knowledge(
    query: str,
    *,
    mode: str = "sales",
    limit: int = 5,
    organization_id: str | None = None,
    product_id: str | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    """Pick product / support / business KB from assist mode.

    `timeout` lets the live-assist fast path bound this call well below the
    default 12s KB timeout so a slow/unreachable KB doesn't itself blow the
    ~1-2s recommendation budget — falls through to no-KB-context instead.
    """
    return await search_knowledge(
        query,
        module=resolve_kb_module(mode),
        limit=limit,
        organization_id=organization_id,
        product_id=product_id,
        timeout=timeout,
    )
