"""Persistent A2A Hub traffic log (outgoing request + incoming response).

Human-readable blocks under the agents repo:
  agents/logs/a2a_hub_traffic.log

Also appends one compact JSON line per event to:
  agents/logs/a2a_hub_traffic.jsonl
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)
_LOCK = threading.Lock()

# agents/app/a2a/traffic_log.py → parents[2] = agents/
_AGENTS_ROOT = Path(__file__).resolve().parents[2]
_LOG_DIR = _AGENTS_ROOT / "logs"
_TRAFFIC_LOG = _LOG_DIR / "a2a_hub_traffic.log"
_TRAFFIC_JSONL = _LOG_DIR / "a2a_hub_traffic.jsonl"
_SPOKE_LOG = _LOG_DIR / "a2a_spoke.log"

_SEP = "=" * 88
_THIN = "-" * 88


def traffic_log_path() -> Path:
    return _TRAFFIC_LOG


def spoke_log_path() -> Path:
    return _SPOKE_LOG


def _ensure_dir() -> None:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _pretty(obj: Any) -> str:
    try:
        return json.dumps(obj, indent=2, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        return repr(obj)


def _hub_artifact_data(hub_response: Any) -> dict[str, Any]:
    if not isinstance(hub_response, dict):
        return {}
    result = hub_response.get("result")
    if not isinstance(result, dict):
        return {}
    arts = result.get("artifacts") or []
    if not arts or not isinstance(arts[0], dict):
        return {}
    parts = arts[0].get("parts") or []
    if not parts or not isinstance(parts[0], dict):
        return {}
    data = parts[0].get("data")
    return data if isinstance(data, dict) else {}


def _write_block(text: str, record: dict[str, Any]) -> None:
    _ensure_dir()
    try:
        with _LOCK:
            with _TRAFFIC_LOG.open("a", encoding="utf-8") as fh:
                fh.write(text)
                if not text.endswith("\n"):
                    fh.write("\n")
                fh.flush()
            with _TRAFFIC_JSONL.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, default=str, ensure_ascii=False) + "\n")
                fh.flush()
    except OSError as exc:
        _log.warning("a2a traffic log write failed: %s", exc)


def log_outgoing_hub_request(
    *,
    url: str,
    rpc: dict[str, Any],
    remainder: dict[str, Any],
    auth: str = "Bearer <redacted>",
) -> None:
    rem = remainder if isinstance(remainder, dict) else {}
    recent = rem.get("recent_event") if isinstance(rem.get("recent_event"), dict) else {}
    query = str(recent.get("query") or "")
    rpc_id = str((rpc or {}).get("id") or "")
    method = str((rpc or {}).get("method") or "")
    msg = ((rpc or {}).get("params") or {}).get("message") or {}
    message_id = str(msg.get("messageId") or "") if isinstance(msg, dict) else ""

    ts = _now_iso()
    block = "\n".join(
        [
            _SEP,
            f"OUTGOING  →  HUB   |  {ts}",
            _THIN,
            f"  URL            : {url}",
            f"  Method         : {method}",
            f"  Auth           : {auth}",
            f"  Organization   : {rem.get('organization_id')}",
            f"  CDP id         : {rem.get('cdp_id')}",
            f"  Spoke          : {rem.get('spoke')}",
            f"  Channel        : {recent.get('channel')}",
            f"  Query          : {query}",
            f"  RPC id         : {rpc_id}",
            f"  Message id     : {message_id}",
            _THIN,
            "  Remainder JSON :",
            _pretty(rem),
            _SEP,
            "",
        ]
    )
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "epoch": time.time(),
        "direction": "outgoing",
        "event": "hub_message_send",
        "url": url,
        "organization_id": rem.get("organization_id"),
        "cdp_id": rem.get("cdp_id"),
        "query": query,
        "rpc_id": rpc_id,
        "method": method,
        "remainder": rem,
        "rpc": rpc,
    }
    _write_block(block, record)


def log_incoming_hub_response(
    *,
    ok: bool,
    http_status: int | None = None,
    hub_response: Any = None,
    error: str | None = None,
    remainder: dict[str, Any] | None = None,
) -> None:
    rem = remainder if isinstance(remainder, dict) else {}
    recent = rem.get("recent_event") if isinstance(rem.get("recent_event"), dict) else {}
    data = _hub_artifact_data(hub_response)
    result = (
        hub_response.get("result")
        if isinstance(hub_response, dict)
        else None
    )
    state = None
    task_id = None
    if isinstance(result, dict):
        task_id = result.get("id")
        status = result.get("status") if isinstance(result.get("status"), dict) else {}
        state = status.get("state")

    dispatch = data.get("dispatch") if isinstance(data.get("dispatch"), list) else []
    ok_label = "SUCCESS" if ok else "FAILED"
    ts = _now_iso()

    lines = [
        _SEP,
        f"INCOMING  ←  HUB   |  {ts}  |  {ok_label}",
        _THIN,
        f"  OK             : {ok}",
        f"  HTTP status    : {http_status}",
        f"  Error          : {error or '(none)'}",
        f"  Organization   : {rem.get('organization_id')}",
        f"  CDP id         : {rem.get('cdp_id')}",
        f"  Query          : {recent.get('query')}",
        f"  Task id        : {task_id}",
        f"  Task state     : {state}",
        f"  Skill id       : {data.get('skillId')}",
        f"  Objective      : {data.get('primaryObjective')}",
        f"  Summary        : {data.get('summary')}",
        f"  Agent reply    : {data.get('suggestedAgentReply')}",
        f"  Dispatch count : {len(dispatch)}",
    ]
    if dispatch:
        lines.append(_THIN)
        lines.append("  Dispatch actions:")
        for i, item in enumerate(dispatch, 1):
            if not isinstance(item, dict):
                lines.append(f"    {i}. {item}")
                continue
            lines.append(
                f"    {i}. type={item.get('action_type')} spoke={item.get('spoke_target')} "
                f"channel={item.get('channel')} status={item.get('status')}"
            )
            lines.append(f"       {item.get('description')}")
    lines.extend(
        [
            _THIN,
            "  Full hub_response JSON:",
            _pretty(hub_response) if hub_response is not None else "  null",
            _SEP,
            "",
        ]
    )
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "epoch": time.time(),
        "direction": "incoming",
        "event": "hub_message_send_result",
        "ok": ok,
        "http_status": http_status,
        "error": error,
        "organization_id": rem.get("organization_id"),
        "cdp_id": rem.get("cdp_id"),
        "query": recent.get("query"),
        "skill_id": data.get("skillId"),
        "task_state": state,
        "summary": data.get("summary"),
        "remainder": rem,
        "hub_response": hub_response,
    }
    _write_block("\n".join(lines) + "\n", record)
