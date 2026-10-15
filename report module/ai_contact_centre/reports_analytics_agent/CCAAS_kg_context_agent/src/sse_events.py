"""Server-Sent Event helpers — Copilot-style progress phases."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any


def encode_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def sse_status(phase: str, label: str) -> str:
    return encode_sse("status", {"phase": phase, "label": label})


def sse_activity(step_id: str, status: str, title: str, description: str) -> str:
    return encode_sse(
        "activity",
        {
            "step_id": step_id,
            "status": status,
            "title": title,
            "description": description,
        },
    )


def sse_tool_call(name: str, args: dict[str, Any], call_id: str | None = None) -> str:
    return encode_sse(
        "tool_call",
        {
            "id": call_id or f"call_{uuid.uuid4().hex[:12]}",
            "name": name,
            "arguments": args,
        },
    )


def sse_block(tool: str, status: str, label: str, summary: str | None = None) -> str:
    data: dict[str, Any] = {"tool": tool, "status": status, "label": label}
    if summary:
        data["summary"] = summary
    return encode_sse("block", data)


def sse_text_delta(delta: str) -> str:
    return encode_sse("text_delta", {"delta": delta, "content": delta})


def sse_done(elapsed_seconds: float | None = None, turn_id: str | None = None) -> str:
    data: dict[str, Any] = {}
    if elapsed_seconds is not None:
        data["elapsed_seconds"] = elapsed_seconds
    if turn_id:
        data["turnId"] = turn_id
    return encode_sse("done", data)


def sse_error(message: str) -> str:
    return encode_sse("error", {"message": message})


def _summarize_cypher(cypher: str, max_len: int = 72) -> str:
    one_line = " ".join(cypher.split())
    if len(one_line) <= max_len:
        return one_line
    return one_line[: max_len - 1] + "…"


def parse_tool_args(fn_args: str | dict) -> dict[str, Any]:
    if isinstance(fn_args, dict):
        return fn_args
    try:
        return json.loads(fn_args)
    except Exception:
        return {"raw": fn_args}


def tool_progress_frames(fn_name: str, fn_args: str | dict) -> list[str]:
    """Emit Claude-like phased status before a tool runs."""
    args = parse_tool_args(fn_args)
    frames: list[str] = []

    if fn_name == "knowledge_graph":
        frames.append(sse_status("querying", "Writing the analytics query…"))
        cypher = args.get("cypher_query") or args.get("cypher") or ""
        if cypher:
            frames.append(
                sse_status("fetching", f"Fetching: {_summarize_cypher(cypher)}")
            )
        else:
            frames.append(sse_status("fetching", "Fetching the numbers…"))
    elif fn_name == "search_schema":
        query = args.get("query", "")
        label = f"Looking up: {query[:60]}…" if len(query) > 60 else f"Looking up: {query}"
        frames.append(sse_status("concepts", label if query else "Checking business definitions…"))
    else:
        frames.append(sse_status("tool", fn_name.replace("_", " ")))

    return frames


def tool_block_label(fn_name: str, fn_args: str | dict) -> str:
    args = parse_tool_args(fn_args)
    if fn_name == "knowledge_graph":
        cypher = args.get("cypher_query") or ""
        return f"Query · {_summarize_cypher(cypher, 56)}" if cypher else "Knowledge graph query"
    if fn_name == "search_schema":
        q = args.get("query", "")
        return f"Schema · {q[:48]}" if q else "Schema search"
    return fn_name.replace("_", " ").title()


def tool_result_summary(fn_name: str, tool_response: dict) -> str:
    if tool_response.get("error"):
        err = str(tool_response["error"])
        return err[:120] + ("…" if len(err) > 120 else "")

    if fn_name == "knowledge_graph":
        data = tool_response.get("data")
        if isinstance(data, list):
            n = tool_response.get("total_count", len(data))
            suffix = f" (showing {len(data)})" if tool_response.get("truncated") else ""
            return f"{n} row{'s' if n != 1 else ''} returned{suffix}"
        return "Query completed"

    if fn_name == "search_schema":
        hits = tool_response.get("hits") or []
        names = [h.get("name", "") for h in hits[:3] if h.get("name")]
        if names:
            return "Found: " + ", ".join(names)
        total = tool_response.get("total_hits", 0)
        return f"{total} concept(s) matched"

    return "Done"


SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}
