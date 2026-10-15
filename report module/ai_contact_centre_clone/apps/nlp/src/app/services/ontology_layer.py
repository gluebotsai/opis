"""Ontology / knowledge-graph gateway (SSE stream from external service)."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.config import Settings, get_settings
from app.logging import get_logger

logger = get_logger("nlp.ontology_layer")

OntologyEventKind = Literal["status", "text_delta", "done", "error"]


@dataclass(frozen=True)
class OntologyStreamEvent:
    kind: OntologyEventKind
    phase: str | None = None
    label: str | None = None
    delta: str | None = None
    turn_id: str | None = None
    elapsed_seconds: float | None = None
    message: str | None = None


def ontology_layer_configured(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.ontology_layer_url.strip())


def map_ontology_status(phase: str, label: str | None) -> tuple[str, str]:
    """Map external ontology phases to co-worker status phases/labels."""
    normalized = (phase or "").strip().lower()
    raw_label = (label or "").strip()
    phase_map = {
        "understanding": "understanding",
        "concepts": "concepts",
        "planning": "planning",
        "querying": "querying",
        "fetching": "fetching",
        "writing": "writing",
    }
    mapped_phase = phase_map.get(normalized, "ontology_layer")
    if normalized == "writing":
        return mapped_phase, "Generating response…"
    if raw_label:
        return mapped_phase, raw_label
    return mapped_phase, normalized.replace("_", " ").title() or "Exploring the knowledge graph…"


def map_ontology_activity(title: str | None, description: str | None) -> tuple[str, str] | None:
    """Turn ontology activity steps into progress labels when useful."""
    label = (title or description or "").strip()
    if not label:
        return None
    if description and title and description not in title:
        label = f"{title} — {description}"
    return "ontology_layer", label[:240]


def parse_sse_block(block: str) -> tuple[str | None, dict[str, Any]]:
    event_name: str | None = None
    data_lines: list[str] = []
    for line in block.splitlines():
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].strip())
    if not data_lines:
        return event_name, {}
    try:
        payload = json.loads("\n".join(data_lines))
    except json.JSONDecodeError:
        payload = {"raw": "\n".join(data_lines)}
    return event_name, payload if isinstance(payload, dict) else {"value": payload}


def ontology_event_from_sse(event_name: str | None, data: dict[str, Any]) -> OntologyStreamEvent | None:
    if event_name == "status":
        phase = str(data.get("phase") or "")
        label = data.get("label")
        mapped_phase, mapped_label = map_ontology_status(phase, str(label) if label else None)
        return OntologyStreamEvent(kind="status", phase=mapped_phase, label=mapped_label)

    if event_name == "activity":
        status = str(data.get("status") or "").lower()
        if status != "running":
            return None
        mapped = map_ontology_activity(
            str(data.get("title") or ""),
            str(data.get("description") or ""),
        )
        if mapped is None:
            return None
        phase, label = mapped
        return OntologyStreamEvent(kind="status", phase=phase, label=label)

    if event_name == "text_delta":
        delta = str(data.get("delta") or "")
        if not delta:
            return None
        return OntologyStreamEvent(kind="text_delta", delta=delta)

    if event_name == "done":
        turn_id = data.get("turnId") or data.get("turn_id")
        elapsed = data.get("elapsed_seconds")
        return OntologyStreamEvent(
            kind="done",
            turn_id=str(turn_id) if turn_id else None,
            elapsed_seconds=float(elapsed) if isinstance(elapsed, (int, float)) else None,
        )

    if event_name == "error":
        message = str(data.get("message") or data.get("error") or "Ontology layer error.")
        return OntologyStreamEvent(kind="error", message=message)

    return None


async def stream_ontology_layer(
    query: str,
    *,
    organization_id: str,
    session_id: str = "",
    settings: Settings | None = None,
    client: httpx.AsyncClient | None = None,
    surface: str | None = None,
) -> AsyncIterator[OntologyStreamEvent]:
    """Stream ontology SSE events for a single question."""
    settings = settings or get_settings()
    base_url = settings.ontology_layer_url.strip().rstrip("/")
    if not base_url:
        yield OntologyStreamEvent(
            kind="error",
            message="Ontology layer URL is not configured.",
        )
        return

    payload = {
        "sessionID": session_id or "",
        "query": query,
        "organization_id": organization_id,
    }
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=settings.ontology_layer_timeout_seconds)
    started = time.perf_counter()
    logger.info(
        "ontology layer request",
        extra={
            "ontology_layer": {
                "query": query[:500],
                "organization_id": organization_id,
                "surface": surface,
                "gateway_url": base_url,
            }
        },
    )

    try:
        async with http.stream(
            "POST",
            f"{base_url}/chat/stream",
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        ) as response:
            response.raise_for_status()
            buffer = ""
            async for chunk in response.aiter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    block, buffer = buffer.split("\n\n", 1)
                    block = block.strip()
                    if not block:
                        continue
                    event_name, data = parse_sse_block(block)
                    event = ontology_event_from_sse(event_name, data)
                    if event is not None:
                        yield event
            remainder = buffer.strip()
            if remainder:
                event_name, data = parse_sse_block(remainder)
                event = ontology_event_from_sse(event_name, data)
                if event is not None:
                    yield event
    except httpx.TimeoutException:
        yield OntologyStreamEvent(kind="error", message="Ontology layer request timed out.")
    except httpx.HTTPStatusError as error:
        detail = error.response.text[:500]
        yield OntologyStreamEvent(
            kind="error",
            message=f"Ontology layer returned {error.response.status_code}: {detail}",
        )
    except httpx.HTTPError as error:
        yield OntologyStreamEvent(kind="error", message=f"Ontology layer request failed: {error}")
    finally:
        if owns_client:
            await http.aclose()
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "ontology layer stream finished",
            extra={
                "ontology_layer": {
                    "query": query[:500],
                    "organization_id": organization_id,
                    "surface": surface,
                    "elapsed_ms": elapsed_ms,
                }
            },
        )


async def ask_ontology_layer_gateway(
    query: str,
    *,
    organization_id: str,
    session_id: str = "",
    settings: Settings | None = None,
    client: httpx.AsyncClient | None = None,
    surface: str | None = None,
) -> dict[str, Any]:
    """Collect a full ontology answer (non-streaming consumer)."""
    answer_parts: list[str] = []
    turn_id: str | None = None
    elapsed_seconds: float | None = None

    async for event in stream_ontology_layer(
        query,
        organization_id=organization_id,
        session_id=session_id,
        settings=settings,
        client=client,
        surface=surface,
    ):
        if event.kind == "text_delta" and event.delta:
            answer_parts.append(event.delta)
        elif event.kind == "done":
            turn_id = event.turn_id
            elapsed_seconds = event.elapsed_seconds
        elif event.kind == "error":
            return {
                "ok": False,
                "source": "ontology_layer",
                "reason": event.message or "Ontology layer error.",
            }

    answer = "".join(answer_parts).strip()
    if not answer:
        return {
            "ok": False,
            "source": "ontology_layer",
            "reason": "Ontology layer returned no answer.",
            "turn_id": turn_id,
        }

    return {
        "ok": True,
        "source": "ontology_layer",
        "type": "explanation",
        "answer": answer,
        "turn_id": turn_id,
        "elapsed_seconds": elapsed_seconds,
        "query": query,
    }
