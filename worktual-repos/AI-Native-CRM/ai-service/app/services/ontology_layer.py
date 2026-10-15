"""HTTP SSE client for the CRM ontology knowledge-graph chat gateway.

Reports/analytics uses this as the `ask_ontology_layer` tool for why/how
reasoning. Data-only metric questions should use `ask_semantic_layer` instead.

Gateway contract (POST ``{ONTOLOGY_GATEWAY_URL}/chat/stream``)::

    {"sessionID": "...", "query": "...", "organization_id": "1000"}

SSE events observed: ``status``, ``activity``, ``tool_call``, ``block``,
``text_delta``, ``done``.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Union

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[dict[str, Any]], Union[Awaitable[None], None]]

ASK_ONTOLOGY_LAYER_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "ask_ontology_layer",
        "description": (
            "Ask a CRM why/how reasoning question against the ontology knowledge "
            "graph (relationships, causes, drivers). Do NOT use this for plain "
            "metric lookups like win rate or how many deals — use ask_semantic_layer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "The user's why/how question, for example: "
                        "why did we lose deals last quarter?"
                    ),
                }
            },
            "required": ["query"],
        },
    },
}


@dataclass
class OntologyProgressStep:
    """Normalized progress row for coworker UI / audit."""

    kind: str
    label: str
    status: str = "running"
    detail: str | None = None
    phase: str | None = None
    step_id: str | None = None
    tool: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "kind": self.kind,
            "label": self.label,
            "status": self.status,
        }
        if self.detail:
            out["detail"] = self.detail
        if self.phase:
            out["phase"] = self.phase
        if self.step_id:
            out["stepId"] = self.step_id
        if self.tool:
            out["tool"] = self.tool
        return out


@dataclass
class OntologyAskResult:
    ok: bool
    answer: str = ""
    progress: list[OntologyProgressStep] = field(default_factory=list)
    session_id: str = ""
    elapsed_seconds: float | None = None
    error: dict[str, Any] | None = None
    raw_events: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "answer": self.answer,
            "progress": [step.to_dict() for step in self.progress],
            "sessionId": self.session_id,
            "elapsedSeconds": self.elapsed_seconds,
            "error": self.error,
        }


def _log_tool_io(kind: str, payload: Any) -> None:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    line = f"ask_ontology_layer {kind}: {text}"
    print(line, flush=True)
    logger.info(line)
    try:
        from app.agent_log import trace

        trace(
            agent="reports-analytics-agent",
            step="ask_ontology_layer",
            kind=kind,
            payload=text,
        )
    except Exception:  # noqa: BLE001
        pass


def ontology_layer_configured() -> bool:
    url = (get_settings().ontology_gateway_url or "").strip()
    return bool(url)


def _stream_url() -> str:
    base = get_settings().ontology_gateway_url.strip().rstrip("/")
    if base.endswith("/chat/stream"):
        return base
    return f"{base}/chat/stream"


def _parse_sse_block(block: str) -> tuple[str | None, Any]:
    event_name: str | None = None
    data_lines: list[str] = []
    for raw_line in block.splitlines():
        line = raw_line.strip("\r")
        if not line or line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip() or None
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    if not data_lines:
        return event_name, None
    payload_text = "\n".join(data_lines)
    try:
        return event_name, json.loads(payload_text)
    except json.JSONDecodeError:
        return event_name, payload_text


def _upsert_activity(
    progress: list[OntologyProgressStep],
    *,
    step_id: str | None,
    title: str,
    status: str,
    description: str | None,
) -> None:
    if step_id:
        for step in progress:
            if step.kind == "activity" and step.step_id == step_id:
                step.label = title or step.label
                step.status = status or step.status
                if description:
                    step.detail = description
                return
    progress.append(
        OntologyProgressStep(
            kind="activity",
            label=title or "Working…",
            status=status or "running",
            detail=description,
            step_id=step_id,
        )
    )


def _apply_event(
    event_name: str | None,
    data: Any,
    *,
    progress: list[OntologyProgressStep],
    answer_parts: list[str],
    raw_events: list[dict[str, Any]],
) -> float | None:
    """Update progress/answer from one SSE event. Returns elapsed_seconds if done."""
    name = (event_name or "").strip() or "message"
    raw_events.append({"event": name, "data": data})
    if not isinstance(data, dict):
        if name == "text_delta" and isinstance(data, str) and data:
            answer_parts.append(data)
        return None

    if name == "status":
        label = str(data.get("label") or "").strip()
        phase = str(data.get("phase") or "").strip() or None
        if label:
            progress.append(
                OntologyProgressStep(
                    kind="status",
                    label=label,
                    status="running",
                    phase=phase,
                )
            )
        return None

    if name == "activity":
        _upsert_activity(
            progress,
            step_id=str(data.get("step_id") or "").strip() or None,
            title=str(data.get("title") or "").strip() or "Working…",
            status=str(data.get("status") or "running").strip() or "running",
            description=str(data.get("description") or "").strip() or None,
        )
        return None

    if name == "block":
        label = str(data.get("label") or data.get("tool") or "Tool").strip()
        status = str(data.get("status") or "running").strip() or "running"
        summary = str(data.get("summary") or "").strip() or None
        tool = str(data.get("tool") or "").strip() or None
        progress.append(
            OntologyProgressStep(
                kind="block",
                label=label,
                status=status,
                detail=summary,
                tool=tool,
            )
        )
        return None

    if name == "tool_call":
        tool = str(data.get("name") or "tool").strip() or "tool"
        progress.append(
            OntologyProgressStep(
                kind="tool_call",
                label=f"Calling {tool}",
                status="running",
                tool=tool,
            )
        )
        return None

    if name == "text_delta":
        delta = data.get("delta")
        if isinstance(delta, str) and delta:
            answer_parts.append(delta)
        elif isinstance(data.get("content"), str) and data["content"] and not answer_parts:
            # First chunk sometimes only has content.
            answer_parts.append(str(data["content"]))
        return None

    if name == "done":
        elapsed = data.get("elapsed_seconds")
        try:
            return float(elapsed) if elapsed is not None else None
        except (TypeError, ValueError):
            return None

    return None


async def ask_ontology_layer(
    query: str,
    organization_id: str,
    *,
    session_id: str | None = None,
    on_progress: ProgressCallback | None = None,
    timeout_s: float | None = None,
) -> OntologyAskResult:
    """Stream ``/chat/stream`` and return the assembled answer + progress steps."""
    q = (query or "").strip()
    org = str(organization_id or "").strip()
    sid = (session_id or "").strip() or f"crm-{uuid.uuid4().hex[:16]}"
    settings = get_settings()
    timeout = float(
        timeout_s
        if timeout_s is not None
        else (settings.ontology_gateway_timeout_s or 90.0)
    )
    payload = {
        "sessionID": sid,
        "query": q,
        "organization_id": org,
    }
    _log_tool_io("input", payload)
    started = time.perf_counter()

    if not q or not org:
        result = OntologyAskResult(
            ok=False,
            session_id=sid,
            error={
                "code": "INVALID_REQUEST",
                "message": "query and organization_id are required",
            },
        )
        _log_tool_io("output", result.to_dict())
        return result

    if not ontology_layer_configured():
        result = OntologyAskResult(
            ok=False,
            session_id=sid,
            error={
                "code": "NOT_CONFIGURED",
                "message": "Ontology gateway is not configured",
            },
        )
        _log_tool_io("output", result.to_dict())
        return result

    progress: list[OntologyProgressStep] = []
    answer_parts: list[str] = []
    raw_events: list[dict[str, Any]] = []
    elapsed_seconds: float | None = None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
            async with client.stream(
                "POST",
                _stream_url(),
                json=payload,
                headers={
                    "Accept": "text/event-stream",
                    "Content-Type": "application/json",
                },
            ) as response:
                response.raise_for_status()
                buffer = ""
                async for chunk in response.aiter_text():
                    if not chunk:
                        continue
                    buffer += chunk
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        event_name, data = _parse_sse_block(block)
                        if event_name is None and data is None:
                            continue
                        done_elapsed = _apply_event(
                            event_name,
                            data,
                            progress=progress,
                            answer_parts=answer_parts,
                            raw_events=raw_events,
                        )
                        if on_progress and progress:
                            maybe = on_progress(progress[-1].to_dict())
                            if maybe is not None:
                                await maybe
                        if done_elapsed is not None:
                            elapsed_seconds = done_elapsed
                if buffer.strip():
                    event_name, data = _parse_sse_block(buffer)
                    if event_name is not None or data is not None:
                        done_elapsed = _apply_event(
                            event_name,
                            data,
                            progress=progress,
                            answer_parts=answer_parts,
                            raw_events=raw_events,
                        )
                        if done_elapsed is not None:
                            elapsed_seconds = done_elapsed
    except Exception as exc:  # noqa: BLE001
        logger.warning("ontology layer ask failed org=%s: %s", org, exc)
        result = OntologyAskResult(
            ok=False,
            session_id=sid,
            progress=progress,
            answer="".join(answer_parts).strip(),
            elapsed_seconds=round(time.perf_counter() - started, 3),
            error={"code": "UPSTREAM_ERROR", "message": str(exc)},
            raw_events=raw_events,
        )
        _log_tool_io("output", result.to_dict())
        return result

    answer = "".join(answer_parts).strip()
    ok = bool(answer)
    result = OntologyAskResult(
        ok=ok,
        answer=answer,
        progress=progress,
        session_id=sid,
        elapsed_seconds=elapsed_seconds
        if elapsed_seconds is not None
        else round(time.perf_counter() - started, 3),
        error=None
        if ok
        else {
            "code": "EMPTY_ANSWER",
            "message": "Ontology gateway returned no answer text",
        },
        raw_events=raw_events,
    )
    _log_tool_io(
        "output",
        {
            "ms": round((time.perf_counter() - started) * 1000),
            "ok": result.ok,
            "answerChars": len(result.answer),
            "progressSteps": len(result.progress),
            "elapsedSeconds": result.elapsed_seconds,
            "error": result.error,
        },
    )
    return result
