"""Worktual Context Layer HTTP client — ontology slice + structured semantic query.

Live host (2026-09-20): 192.168.11.25:8765. 195.168.11.25 timed out.
Never send natural-language query/instruction on /v1/semantic/query.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import requests

from config import get_settings

logger = logging.getLogger(__name__)

PRODUCT = "webtracking"
AGENT_ANALYTICS = "webtracking.analytics"
AGENT_INSIGHTS = "webtracking.insights"


class ContextLayerError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class MetricDescriptor:
    id: str
    label: str = ""
    dims: tuple[str, ...] = ()
    when: str = ""
    engine: str = ""
    grain: str = ""
    channel_scoped: bool = False

    @classmethod
    def from_payload(cls, raw: dict[str, Any]) -> MetricDescriptor:
        dims = raw.get("dims") or []
        return cls(
            id=str(raw.get("id") or ""),
            label=str(raw.get("label") or ""),
            dims=tuple(str(d) for d in dims if d),
            when=str(raw.get("when") or ""),
            engine=str(raw.get("engine") or ""),
            grain=str(raw.get("grain") or ""),
            channel_scoped=bool(raw.get("channel_scoped")),
        )


@dataclass
class OntologySlice:
    prompt: str
    metrics: list[MetricDescriptor] = field(default_factory=list)
    version: str | None = None
    tenant: str | None = None
    entitlements: Any = None
    organization_id: int | None = None
    role: str | None = None

    def allowlist(self) -> set[str]:
        return {m.id for m in self.metrics if m.id}

    def descriptor(self, metric_id: str) -> MetricDescriptor | None:
        for item in self.metrics:
            if item.id == metric_id:
                return item
        return None


@dataclass(frozen=True)
class SemanticResult:
    rows: list[dict[str, Any]]
    status: Any
    threshold: Any
    request_body: dict[str, Any] | None = None
    response_payload: dict[str, Any] | None = None


class ContextLayerClient:   
    def __init__(self) -> None:
        self._cache: dict[tuple[int, int, str], OntologySlice] = {}

    def _base_url(self) -> str:
        return get_settings().context_layer_url.rstrip("/")

    def _timeout(self) -> int:
        return get_settings().context_layer_timeout_seconds

    def invalidate(self, organization_id: int | None = None, user_id: int | None = None) -> None:
        if organization_id is None or user_id is None:
            self._cache.clear()
            return
        for key in list(self._cache):
            if key[0] == organization_id and key[1] == user_id:
                self._cache.pop(key, None)

    def cached_ontology_slice(
        self,
        *,
        organization_id: int,
        user_id: int,
        agent: str,
    ) -> OntologySlice | None:
        return self._cache.get((int(organization_id), int(user_id), agent))

    def fetch_ontology_slice(
        self,
        *,
        organization_id: int,
        user_id: int,
        agent: str,
        use_cache: bool = True,
    ) -> OntologySlice:
        if agent not in (AGENT_ANALYTICS, AGENT_INSIGHTS):
            raise ContextLayerError(f"Unregistered Context Layer agent: {agent}")
        cache_key = (int(organization_id), int(user_id), agent)
        if use_cache and cache_key in self._cache:
            return self._cache[cache_key]

        body = {
            "organizationId": int(organization_id),
            "userId": int(user_id),
            "product": PRODUCT,
            "agent": agent,
            "format": "prompt",
        }
        payload = self._post("/v1/ontology/slice", body)
        raw_metrics = payload.get("metrics") or []
        metrics = [
            MetricDescriptor.from_payload(item)
            for item in raw_metrics
            if isinstance(item, dict) and item.get("id")
        ]
        slice_data = OntologySlice(
            prompt=str(payload.get("prompt") or ""),
            metrics=metrics,
            version=payload.get("version"),
            tenant=payload.get("tenant"),
            entitlements=payload.get("entitlements"),
            organization_id=payload.get("organizationId"),
            role=payload.get("role"),
        )
        self._cache[cache_key] = slice_data
        import json

        logger.info(
            "Ontology slice agent=%s version=%s metrics=%s prompt_len=%s request=%s",
            agent,
            slice_data.version,
            len(slice_data.metrics),
            len(slice_data.prompt),
            json.dumps(body, default=str),
        )
        return slice_data

    def query_semantic(
        self,
        *,
        organization_id: int,
        user_id: int,
        website_id: int,
        metrics: list[str],
        time: dict[str, Any] | None = None,
        group_by: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        order_by: list[str] | None = None,
        limit: int | None = None,
    ) -> SemanticResult:
        if not metrics:
            raise ContextLayerError("Semantic query requires at least one certified metric id")
        body: dict[str, Any] = {
            "organizationId": int(organization_id),
            "userId": int(user_id),
            "product": PRODUCT,
            "agent": AGENT_ANALYTICS,
            "websiteId": int(website_id),
            "metrics": list(metrics),
        }
        if time:
            body["time"] = time
        if group_by:
            body["group_by"] = list(group_by)
        if filters:
            body["filters"] = list(filters)
        if order_by:
            body["order_by"] = list(order_by)
        if limit is not None:
            body["limit"] = int(limit)
        forbidden = {"query", "instruction", "question", "nl"}
        if forbidden.intersection(body):
            raise ContextLayerError("Semantic body must not include natural-language fields")

        import json

        logger.info("Context Layer semantic_query request=%s", json.dumps(body, default=str))
        payload = self._post("/v1/semantic/query", body)
        rows = payload.get("rows")
        if not isinstance(rows, list):
            raise ContextLayerError("Semantic response missing rows")
        logger.info(
            "Context Layer semantic_query response rows=%s status=%s",
            len(rows),
            payload.get("status"),
        )
        return SemanticResult(
            rows=[item if isinstance(item, dict) else {} for item in rows],
            status=payload.get("status"),
            threshold=payload.get("threshold"),
            request_body=body,
            response_payload={
                "rows": rows[:50],
                "status": payload.get("status"),
                "threshold": payload.get("threshold"),
                "row_count": len(rows),
            },
        )

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url()}{path}"
        try:
            response = requests.post(
                url,
                json=body,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                timeout=self._timeout(),
            )
        except requests.RequestException as exc:
            logger.exception("Context Layer request failed: %s", url)
            raise ContextLayerError("Context Layer is unavailable") from exc
        if response.status_code >= 400:
            detail = response.text[:400]
            try:
                parsed = response.json()
                detail = str(parsed.get("detail") or parsed)
            except Exception:
                pass
            logger.warning("Context Layer %s → %s %s", path, response.status_code, detail)
            raise ContextLayerError(
                f"Context Layer error ({response.status_code})",
                status_code=response.status_code,
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ContextLayerError("Context Layer returned non-JSON") from exc
        if not isinstance(payload, dict):
            raise ContextLayerError("Context Layer returned unexpected payload")
        return payload


context_layer = ContextLayerClient()
 