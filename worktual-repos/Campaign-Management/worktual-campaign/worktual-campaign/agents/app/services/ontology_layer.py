"""Ontology knowledge-graph chat client (SSE /chat/stream).

POST {ONTOLOGY_CHAT_STREAM_URL} with
{ sessionID, query, organization_id }.

Used for analytics / graph questions (past campaigns, relationships),
not for dashboard KPI metrics (those use the semantic layer).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_TEXT_DELTA_RE = re.compile(
    r"event:\s*text_delta\s*\ndata:\s*(\{.*?\})\s*(?:\n|$)",
    re.MULTILINE | re.DOTALL,
)
_DONE_RE = re.compile(
    r"event:\s*done\s*\ndata:\s*(\{.*?\})\s*(?:\n|$)",
    re.MULTILINE | re.DOTALL,
)


def ontology_configured() -> bool:
    url = (get_settings().ontology_chat_stream_url or "").strip()
    return bool(url)


def _parse_sse_answer(raw: str) -> dict[str, Any]:
    """Extract final streamed answer + optional done metadata from SSE body.

    Ontology streams send text_delta where both `delta` and `content` are the
    chunk only (not a cumulative snapshot) — we concatenate deltas.
    """
    pieces: list[str] = []
    for m in _TEXT_DELTA_RE.finditer(raw or ""):
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        chunk = data.get("delta")
        if not isinstance(chunk, str) or not chunk:
            chunk = data.get("content")
        if isinstance(chunk, str) and chunk:
            pieces.append(chunk)

    answer = "".join(pieces).strip()
    # Strip accidental HTML wrapper if the stream returned a full document.
    if "<html" in answer.lower() or answer.lstrip().startswith("<!DOCTYPE"):
        plain = re.sub(r"<[^>]+>", " ", answer)
        plain = re.sub(r"\s+", " ", plain).strip()
        if plain:
            answer = plain

    done_meta: dict[str, Any] = {}
    dm = _DONE_RE.search(raw or "")
    if dm:
        try:
            parsed = json.loads(dm.group(1))
            if isinstance(parsed, dict):
                done_meta = parsed
        except json.JSONDecodeError:
            pass

    return {
        "answer": answer,
        "done": done_meta,
        "chunk_count": len(pieces),
    }


async def ask_ontology(
    query: str,
    *,
    organization_id: str,
    session_id: str = "",
) -> dict[str, Any]:
    """Call ontology chat/stream. Returns { ok, answer, raw, error? }."""
    settings = get_settings()
    url = (settings.ontology_chat_stream_url or "").strip()
    q = str(query or "").strip()
    oid = str(organization_id or "").strip()
    sid = str(session_id or "").strip()

    if not url:
        return {
            "ok": False,
            "answer": "",
            "raw": None,
            "error": "ONTOLOGY_CHAT_STREAM_URL is not configured",
        }
    if not q:
        return {
            "ok": False,
            "answer": "",
            "raw": None,
            "error": "query is required",
        }
    if not oid:
        return {
            "ok": False,
            "answer": "",
            "raw": None,
            "error": "organization_id is required",
        }

    payload = {
        "sessionID": sid,
        "query": q,
        "organization_id": oid,
    }
    timeout = float(settings.ontology_chat_timeout_s or 90.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream, application/json, */*",
                },
            )
            resp.raise_for_status()
            raw_text = resp.text or ""
    except httpx.HTTPError as exc:
        logger.warning("ontology chat/stream failed: %s", exc)
        return {
            "ok": False,
            "answer": "",
            "raw": None,
            "error": f"ontology_transport: {exc}",
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("ontology chat/stream unexpected: %s", exc)
        return {
            "ok": False,
            "answer": "",
            "raw": None,
            "error": f"ontology_error: {exc}",
        }

    parsed = _parse_sse_answer(raw_text)
    answer = str(parsed.get("answer") or "").strip()
    # Non-SSE JSON fallback
    if not answer and raw_text.strip().startswith("{"):
        try:
            as_json = json.loads(raw_text)
            if isinstance(as_json, dict):
                answer = str(
                    as_json.get("answer")
                    or as_json.get("content")
                    or as_json.get("message")
                    or ""
                ).strip()
        except json.JSONDecodeError:
            pass

    return {
        "ok": bool(answer),
        "answer": answer,
        "raw": raw_text[:4000] if raw_text else None,
        "done": parsed.get("done") or {},
        "error": None if answer else "ontology returned empty answer",
        "query": q,
        "organization_id": oid,
        "source": "ontology",
    }
