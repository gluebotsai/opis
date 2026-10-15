"""Day-wise agent trace logs under ``ai-service/logs/``.

- Staff coworker turns (human-readable): ``agent-turn-YYYY-MM-DD.log`` — see
  ``docs/observability-log-format.md`` and ``app/observability/turn_log.py``
- LLM traffic (all agents): ``llm-YYYY-MM-DD.log`` — ``app/observability/llm_log.py``
- Coworker JSON trace (legacy/debug): ``coworker-YYYY-MM-DD.log``
- Proactive jobs (lifecycle, nurture, score, …): ``proactive-YYYY-MM-DD.log``
- A2A Hub spoke: ``a2a-YYYY-MM-DD.log`` + ``a2a-YYYY-MM-DD.json`` (JSONL)

Keeps **3 days** each.  On day 4 the oldest file for that prefix is deleted.

Each log line is a JSON object with at minimum ``agent``, ``step``, and ``ts``.
The full trace from query-enter to response-send covers these steps:

**Coworker flow**::

    receive   → incoming request (user text, module, surface, pathname)
    route     → deterministic router decision (pending_route / module dispatch)
    intent    → LLM intent classification result (create-mode disambiguation)
    context   → catalog / memory hydration summary
    llm_req   → LLM request sent (model, prompt len, tool count, timeout)
    llm_res   → LLM response received (finish reason, content len, tool_calls)
    tools     → tool proposal / MCP execution summary
    tool_call → tool invoked (name, args summary)
    tool_res  → tool result (name, ok, response summary)
    handoff   → specialist transfer (fromAgent, toAgent, reason)
    api       → external dependency (service, operation, ok — LLM, Postgres, Neo4j, MCP HTTP)
    draft     → draft enrichment (module, patched keys, next question)
    speech    → final speech generation / sanitisation
    finish    → response assembled and returned (ok, source, speech, tools, ms)

**A2A Hub flow**::

    ready            → spoke started (card url, log path)
    card             → Hub fetched the Agent Card
    token            → Hub mint/refresh; CRM replaced tokens on accounts.a2a_spoke_clients
    auth_denied      → JSON-RPC missing/invalid Bearer
    http_in          → Hub → CRM HTTP request + CRM HTTP response (same line)
    http_out         → CRM → Hub HTTP request + Hub HTTP response (same line)
    hub_instruct     → Hub given instruction (skillId, org, cdpId, text + instruction)
    crm_respond      → JSON-RPC task CRM returned to Hub (state + receipt)
    dispatch         → CRM bound skill → agent
    auto_confirm     → Hub high-risk tool auto-confirmed
    input_required   → CRM asked Hub AI for missing fields
    reject / fail / complete → task outcome (complete/fail include agent activity/result)
    skill_stale      → Hub must re-issue access token
    escalate         → CRM sent leftover work to Hub
    task_get / cancel → inspect / cancel

Local runs also print the coworker chat turn to the process stdout
(query, route, LLM text, tool call, tool response, final reply). Nothing
extra is stored for that view. Set ``COWORKER_CONSOLE_LOG=0`` to hide it.

Use the stdlib logger::

    from app.agent_log import logger, fmt, current_logger, trace

    logger.info(fmt(agent="crm-agent", step="start", module=mod, user=text))
    trace(agent="crm-agent", step="route", decision="navigate", target="/activities")

Watch today::

    tail -f ai-service/logs/coworker-$(date +%F).log
    tail -f ai-service/logs/proactive-$(date +%F).log
    tail -f ai-service/logs/a2a-$(date +%F).log
    grep -E 'http_in|http_out' ai-service/logs/a2a-$(date +%F).log
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid as _uuid
from contextvars import ContextVar
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable, TypeVar

_LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
_COWORKER_LOGGER_NAME = "ai-service.agents.coworker"
_PROACTIVE_LOGGER_NAME = "ai-service.agents.proactive"
_A2A_LOGGER_NAME = "ai-service.a2a.flow"
_KEEP_DAYS = 3
_TEXT_CAP = 600
_PATCH_VAL_CAP = 160
_COWORKER_AGENTS = frozenset({"crm-agent", "hello", "chat"})
_CHANNEL: ContextVar[str] = ContextVar("agent_log_channel", default="proactive")
_TRACE_ID: ContextVar[str] = ContextVar("agent_trace_id", default="")

T = TypeVar("T")

logger = logging.getLogger(_COWORKER_LOGGER_NAME)
proactive_logger = logging.getLogger(_PROACTIVE_LOGGER_NAME)
a2a_logger = logging.getLogger(_A2A_LOGGER_NAME)


class DayWiseFileHandler(logging.Handler):
    """Write ``{prefix}-YYYY-MM-DD.log`` and drop files older than ``keep_days``."""

    def __init__(self, log_dir: Path, *, prefix: str = "agents", keep_days: int = 5):
        super().__init__()
        self.log_dir = log_dir
        self.prefix = prefix
        self.keep_days = keep_days
        self._day: str | None = None
        self._stream: Any = None

    def path_for(self, day: date | None = None) -> Path:
        stamp = (day or date.today()).isoformat()
        return self.log_dir / f"{self.prefix}-{stamp}.log"

    def _parse_day(self, path: Path) -> date | None:
        prefix = f"{self.prefix}-"
        if not path.name.startswith(prefix) or not path.name.endswith(".log"):
            return None
        try:
            return date.fromisoformat(path.name[len(prefix) : -len(".log")])
        except ValueError:
            return None

    def prune(self, today: date | None = None) -> list[Path]:
        today = today or date.today()
        removed: list[Path] = []
        if not self.log_dir.exists():
            return removed
        for path in self.log_dir.glob(f"{self.prefix}-*.log"):
            day = self._parse_day(path)
            if day is None:
                continue
            if (today - day).days >= self.keep_days:
                try:
                    path.unlink()
                    removed.append(path)
                except OSError:
                    pass
        return removed

    def _ensure_stream(self) -> None:
        today = date.today().isoformat()
        if self._day == today and self._stream is not None:
            return
        if self._stream is not None:
            self._stream.close()
            self._stream = None
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._day = today
        self._stream = self.path_for().open("a", encoding="utf-8")
        self.prune()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self._ensure_stream()
            assert self._stream is not None
            self._stream.write(self.format(record) + "\n")
            self._stream.flush()
        except Exception:  # noqa: BLE001
            self.handleError(record)

    def close(self) -> None:
        if self._stream is not None:
            self._stream.close()
            self._stream = None
        super().close()


def is_coworker_agent(name: str | None) -> bool:
    return (name or "").strip().lower() in _COWORKER_AGENTS


def current_logger() -> logging.Logger:
    """Logger for the active invoke (coworker chat vs proactive job)."""
    _ensure_loggers()
    return logger if _CHANNEL.get() == "coworker" else proactive_logger


def coworker_log_path() -> Path:
    _ensure_loggers()
    for handler in logger.handlers:
        if isinstance(handler, DayWiseFileHandler):
            return handler.path_for()
    return _LOG_DIR / f"coworker-{date.today().isoformat()}.log"


def proactive_log_path() -> Path:
    _ensure_loggers()
    for handler in proactive_logger.handlers:
        if isinstance(handler, DayWiseFileHandler):
            return handler.path_for()
    return _LOG_DIR / f"proactive-{date.today().isoformat()}.log"


def a2a_log_path() -> Path:
    _ensure_loggers()
    for handler in a2a_logger.handlers:
        if isinstance(handler, DayWiseFileHandler):
            return handler.path_for()
    return _LOG_DIR / f"a2a-{date.today().isoformat()}.log"


def log_file_path() -> Path:
    """Coworker log path (compat)."""
    return coworker_log_path()


def reset_for_tests(log_dir: Path, *, keep_days: int = _KEEP_DAYS) -> Path:
    """Point both flow loggers at a temp directory (tests only)."""
    global _LOG_DIR
    _LOG_DIR = log_dir
    for name in (_COWORKER_LOGGER_NAME, _PROACTIVE_LOGGER_NAME, _A2A_LOGGER_NAME):
        log = logging.getLogger(name)
        for handler in list(log.handlers):
            log.removeHandler(handler)
            handler.close()
    _ensure_loggers(keep_days=keep_days)
    return coworker_log_path()


def _attach(log: logging.Logger, *, prefix: str, keep_days: int) -> None:
    if log.handlers:
        return
    handler = DayWiseFileHandler(_LOG_DIR, prefix=prefix, keep_days=keep_days)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.setLevel(logging.INFO)
    log.addHandler(handler)
    log.propagate = False


def _ensure_loggers(*, keep_days: int = _KEEP_DAYS) -> logging.Logger:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    _attach(logger, prefix="coworker", keep_days=keep_days)
    _attach(proactive_logger, prefix="proactive", keep_days=keep_days)
    _attach(a2a_logger, prefix="a2a", keep_days=keep_days)
    return logger


def _dest_for_agent(name: str | None) -> logging.Logger:
    _ensure_loggers()
    return logger if is_coworker_agent(name) else proactive_logger


def _clip(val: Any, cap: int = _TEXT_CAP) -> Any:
    if val is None:
        return None
    if isinstance(val, str):
        text = val.strip()
        return text if len(text) <= cap else text[: cap - 1] + "…"
    return val


def _clip_patch(patch: Any) -> dict[str, Any] | None:
    if not isinstance(patch, dict) or not patch:
        return None
    out: dict[str, Any] = {}
    for key, val in list(patch.items())[:24]:
        if isinstance(val, str):
            out[str(key)] = _clip(val, _PATCH_VAL_CAP)
        elif isinstance(val, (int, float, bool)) or val is None:
            out[str(key)] = val
        else:
            out[str(key)] = _clip(str(val), _PATCH_VAL_CAP)
    return out


def _summarize_result(result: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {}
    patch = result.get("patch") or result.get("contactDraftPatch")
    return {
        "ok": result.get("ok"),
        "source": result.get("source"),
        "reason": result.get("reason"),
        "speech": _clip(result.get("assistantText")),
        "patch": _clip_patch(patch),
        "tools": tool_names(result),
        "error": _clip(result.get("error"), 400),
    }


def log_agent_turn(
    *,
    agent: str,
    ok: bool,
    intent: str | None = None,
    module: str | None = None,
    surface: str | None = None,
    user_text: str | None = None,
    contact_id: str | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    ms: float | None = None,
) -> None:
    payload: dict[str, Any] = {
        "agent": agent,
        "ok": ok,
        "intent": intent or None,
        "module": module or None,
        "surface": surface or None,
        "user": _clip(user_text),
        "contactId": contact_id or None,
        "ms": round(ms, 1) if isinstance(ms, (int, float)) else None,
        "error": _clip(error, 800) if error else None,
        **_summarize_result(result),
    }
    compact = {k: v for k, v in payload.items() if v not in (None, "", [], {})}
    line = json.dumps(compact, ensure_ascii=False, default=str)
    dest = _dest_for_agent(agent)
    if ok and not error:
        dest.info(line)
    else:
        dest.error(line)


def log_llm_error(exc: BaseException) -> None:
    current_logger().error(fmt(agent="llm", step="error", ok=False, error=str(exc)))


def begin_trace(trace_id: str | None = None) -> str:
    """Start a new trace span — call at the top of every agent invocation."""
    tid = (trace_id or "").strip() or _uuid.uuid4().hex[:16]
    _TRACE_ID.set(tid)
    return tid


def current_trace_id() -> str:
    return _TRACE_ID.get("")


def trace_tool_call(*, agent: str, tool: str, args: Any = None, **fields: Any) -> None:
    """Log an internal or MCP tool invocation."""
    trace(agent=agent, step="tool_call", tool=tool, args=_clip_field(args), **fields)


def trace_tool_response(
    *,
    agent: str,
    tool: str,
    ok: bool,
    response: Any = None,
    **fields: Any,
) -> None:
    """Log tool output (clipped) for coworker log review."""
    trace(agent=agent, step="tool_res", tool=tool, ok=ok, response=_clip_field(response), **fields)


def trace_api(
    *,
    agent: str,
    service: str,
    operation: str,
    ok: bool | None = None,
    **fields: Any,
) -> None:
    """Log LLM, warehouse Postgres, Neo4j, or other HTTP/API usage."""
    trace(
        agent=agent,
        step="api",
        service=service,
        operation=operation,
        ok=ok,
        **fields,
    )


def trace_handoff(
    *,
    from_agent: str,
    to_agent: str,
    reason: str | None = None,
    agent: str = "native-coworker",
) -> None:
    trace(
        agent=agent,
        step="handoff",
        fromAgent=from_agent,
        toAgent=to_agent,
        reason=_clip(reason) if reason else None,
    )


def trace(
    *,
    agent: str,
    step: str,
    ok: bool | None = None,
    **fields: Any,
) -> None:
    """Structured trace log line — always includes traceId and timestamp."""
    _ensure_loggers()
    payload: dict[str, Any] = {
        "traceId": current_trace_id() or None,
        "agent": agent,
        "step": step,
    }
    if ok is not None:
        payload["ok"] = ok
    for key, val in fields.items():
        if val in (None, "", [], {}):
            continue
        payload[key] = _clip_field(val)
    line = json.dumps(
        {k: v for k, v in payload.items() if v not in (None, "", [], {})},
        ensure_ascii=False,
        default=str,
    )
    dest = current_logger()
    if ok is False:
        dest.error(line)
    else:
        dest.info(line)


def _clip_a2a_tree(val: Any, *, depth: int = 0) -> Any:
    """Preserve nested Hub instruction / agent activity (scalars + shallow trees)."""
    if isinstance(val, bool) or val is None:
        return val
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return round(val, 1)
    if isinstance(val, str):
        return _clip(val, 600 if depth <= 1 else 200)
    if isinstance(val, list):
        return [_clip_a2a_tree(item, depth=depth + 1) for item in val[:24]]
    if isinstance(val, dict):
        if depth >= 4:
            return _clip(str(val), 160)
        out: dict[str, Any] = {}
        for index, (key, item) in enumerate(val.items()):
            if index >= 32:
                break
            out[str(key)] = _clip_a2a_tree(item, depth=depth + 1)
        return out
    return _clip(str(val), 160)


def a2a_trace(
    *,
    step: str,
    ok: bool | None = None,
    hub: dict[str, Any] | None = None,
    crm: dict[str, Any] | None = None,
    **fields: Any,
) -> None:
    """Hub instruction vs CRM action for the A2A spoke file."""
    _ensure_loggers()
    payload: dict[str, Any] = {
        "traceId": current_trace_id() or None,
        "agent": "a2a-spoke",
        "step": step,
        "channel": "a2a",
    }
    if ok is not None:
        payload["ok"] = ok
    if hub:
        payload["hub"] = _clip_a2a_tree(hub)
    if crm:
        payload["crm"] = _clip_a2a_tree(crm)
    for key, val in fields.items():
        if val in (None, "", [], {}):
            continue
        payload[key] = _clip_a2a_tree(val)
    compact = {k: v for k, v in payload.items() if v not in (None, "", [], {})}
    line = json.dumps(compact, ensure_ascii=False, default=str)
    if ok is False:
        a2a_logger.error(line)
    else:
        a2a_logger.info(line)
    try:
        from app.observability.file_sink import append_jsonl

        append_jsonl(prefix="a2a", payload=compact)
    except Exception:  # noqa: BLE001
        pass


_CONSOLE_CAP = 4000
_SECRET_KEYS = frozenset(
    {
        "token",
        "secret",
        "password",
        "authorization",
        "api_key",
        "apikey",
        "apiKey",
        "mcpExecutionToken",
        "mcp_execution_token",
        "refresh_token",
        "access_token",
        "client_secret",
    }
)


def coworker_console_enabled() -> bool:
    """Stdout coworker trace. On for a normal local process, off under pytest."""
    raw = os.environ.get("COWORKER_CONSOLE_LOG")
    if raw is None:
        return "PYTEST_CURRENT_TEST" not in os.environ
    return raw.strip().lower() not in {"0", "false", "off", "no", ""}


def _redact_console(val: Any, *, depth: int = 0) -> Any:
    if depth > 4:
        return "…"
    if isinstance(val, dict):
        out: dict[str, Any] = {}
        for key, item in list(val.items())[:40]:
            if str(key) in _SECRET_KEYS:
                out[str(key)] = "***"
            else:
                out[str(key)] = _redact_console(item, depth=depth + 1)
        return out
    if isinstance(val, list):
        return [_redact_console(item, depth=depth + 1) for item in val[:40]]
    return val


def _console_body(val: Any) -> str:
    if isinstance(val, (dict, list)):
        text = json.dumps(_redact_console(val), ensure_ascii=False, default=str, indent=2)
    else:
        text = str(val).strip()
    if len(text) > _CONSOLE_CAP:
        return text[: _CONSOLE_CAP - 1] + "…"
    return text


def console_coworker(event: str, *, text: Any = None, **fields: Any) -> None:
    """Print one coworker chat event to stdout. Does not write a file."""
    if _CHANNEL.get() != "coworker" or not coworker_console_enabled():
        return
    meta: list[str] = []
    for key, val in fields.items():
        if val in (None, "", [], {}):
            continue
        if isinstance(val, (dict, list)):
            shown = _console_body(val).replace("\n", " ")
        else:
            shown = str(val).replace("\n", " ").strip()
        if len(shown) > 180:
            shown = shown[:179] + "…"
        meta.append(f"{key}={shown}")
    line = f"[coworker] {event}"
    if meta:
        line = f"{line}  {'  '.join(meta)}"
    try:
        if event == "query":
            print("", flush=True)
        print(line, flush=True)
        if text not in (None, "", [], {}):
            for row in _console_body(text).splitlines() or [""]:
                print(f"  {row}", flush=True)
    except Exception:  # noqa: BLE001
        return


_HTTP_LINE_CAP = 200_000


def a2a_http_trace(**payload: Any) -> None:
    """Full Hub↔CRM HTTP request/response in the same a2a day log (secrets already redacted)."""
    _ensure_loggers()
    body: dict[str, Any] = {
        "traceId": current_trace_id() or None,
        "agent": "a2a-spoke",
        "channel": "a2a",
        "kind": "http",
    }
    body.update(payload)
    line = json.dumps(
        {k: v for k, v in body.items() if v not in (None, "", [], {})},
        ensure_ascii=False,
        default=str,
    )
    if len(line) > _HTTP_LINE_CAP:
        line = line[: _HTTP_LINE_CAP - 1] + "…"
    if payload.get("ok") is False:
        a2a_logger.error(line)
    else:
        a2a_logger.info(line)


def _clip_field(val: Any) -> Any:
    if isinstance(val, bool):
        return val
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return round(val, 1)
    if isinstance(val, str):
        return _clip(val)
    if isinstance(val, list):
        return [
            _clip(x, 160) if isinstance(x, str) else x for x in val[:16]
        ]
    if isinstance(val, dict):
        return _clip_patch(val) or {
            str(k): _clip(str(v), 120) for k, v in list(val.items())[:12]
        }
    return _clip(str(val))


def fmt(
    *,
    agent: str,
    step: str | None = None,
    ok: bool | None = None,
    error: str | None = None,
    **fields: Any,
) -> str:
    """JSON message for ``logger.info`` / ``logger.error``."""
    _ensure_loggers()
    payload: dict[str, Any] = {"agent": agent}
    if step:
        payload["step"] = step
    if ok is not None:
        payload["ok"] = ok
    if error:
        payload["error"] = _clip(error, 800)
        if ok is None:
            payload["ok"] = False
    for key, val in fields.items():
        if val in (None, "", [], {}):
            continue
        payload[key] = _clip_field(val)
    return json.dumps(payload, ensure_ascii=False, default=str)


def tool_names(result: dict[str, Any] | None) -> list[str]:
    tools = (result or {}).get("toolProposals") or []
    names: list[str] = []
    if isinstance(tools, list):
        for item in tools[:16]:
            if isinstance(item, dict) and item.get("name"):
                names.append(str(item["name"]))
    return names


def patch_keys(result: dict[str, Any] | None) -> list[str]:
    patch = (result or {}).get("patch") or (result or {}).get("contactDraftPatch")
    if isinstance(patch, dict):
        return [str(k) for k in list(patch.keys())[:16]]
    return []


async def invoke_logged(
    name: str,
    runner: Callable[[], Awaitable[T]],
    *,
    intent: str | None = None,
    module: str | None = None,
    surface: str | None = None,
    user_text: str | None = None,
    contact_id: str | None = None,
    trace_id: str | None = None,
    turn_session_id: str | None = None,
    turn_org_id: str | None = None,
    turn_user_id: str | None = None,
    turn_request_id: str | None = None,
) -> T:
    token = _CHANNEL.set("coworker" if is_coworker_agent(name) else "proactive")
    tid = begin_trace(trace_id)
    agent_turn = False
    if name == "crm-agent" and (user_text or "").strip():
        try:
            from app.observability.llm_log import set_llm_log_context
            from app.observability.turn_log import begin_turn

            begin_turn(
                user_query=user_text or "",
                session_id=turn_session_id,
                request_id=turn_request_id or tid,
                organization_id=turn_org_id,
                user_id=turn_user_id,
            )
            set_llm_log_context(
                session_id=turn_session_id,
                organization_id=turn_org_id,
                user_id=turn_user_id,
                page=module,
            )
            agent_turn = True
        except Exception:  # noqa: BLE001
            agent_turn = False
    trace(
        agent=name,
        step="receive",
        intent=intent,
        module=module,
        surface=surface,
        user=_clip(user_text),
        contactId=contact_id,
    )
    console_coworker(
        "query",
        agent=name,
        module=module,
        surface=surface,
        intent=intent,
        text=user_text or "",
    )
    started = time.perf_counter()
    try:
        result = await runner()
        elapsed = (time.perf_counter() - started) * 1000
        log_agent_turn(
            agent=name,
            ok=not (
                isinstance(result, dict) and result.get("ok") is False
            ),
            intent=intent,
            module=module,
            surface=surface,
            user_text=user_text,
            contact_id=contact_id,
            result=result if isinstance(result, dict) else None,
            error=(
                str(result.get("error"))
                if isinstance(result, dict) and result.get("error")
                else None
            ),
            ms=elapsed,
        )
        trace(
            agent=name,
            step="finish",
            ok=not (isinstance(result, dict) and result.get("ok") is False),
            ms=round(elapsed, 1),
            source=result.get("source") if isinstance(result, dict) else None,
            speech=_clip(result.get("assistantText")) if isinstance(result, dict) else None,
            tools=tool_names(result if isinstance(result, dict) else None),
        )
        console_coworker(
            "final",
            agent=name,
            ok=not (isinstance(result, dict) and result.get("ok") is False),
            ms=round(elapsed, 1),
            source=result.get("source") if isinstance(result, dict) else None,
            tools=",".join(tool_names(result if isinstance(result, dict) else None)) or None,
            text=(result.get("assistantText") if isinstance(result, dict) else None) or "",
        )
        if agent_turn:
            try:
                from app.observability.llm_log import clear_llm_log_context
                from app.observability.turn_log import finish_turn

                final_agent = None
                speech = ""
                if isinstance(result, dict):
                    speech = str(result.get("assistantText") or "")
                    final_agent = str(result.get("agent") or "")
                    patch = result.get("sessionMemoryPatch") or result.get("sessionMemory")
                    if isinstance(patch, dict) and not final_agent:
                        final_agent = str(patch.get("activeAgent") or "")
                turn_error = None
                if isinstance(result, dict) and result.get("ok") is False:
                    turn_error = str(result.get("error") or result.get("reason") or "")
                finish_turn(
                    speech,
                    final_agent=final_agent or None,
                    error=turn_error or None,
                )
                clear_llm_log_context()
            except Exception:  # noqa: BLE001
                pass
        return result
    except Exception as exc:  # noqa: BLE001
        elapsed = (time.perf_counter() - started) * 1000
        log_agent_turn(
            agent=name,
            ok=False,
            intent=intent,
            module=module,
            surface=surface,
            user_text=user_text,
            contact_id=contact_id,
            error=str(exc),
            ms=elapsed,
        )
        trace(agent=name, step="finish", ok=False, ms=round(elapsed, 1), error=str(exc)[:400])
        console_coworker(
            "final",
            agent=name,
            ok=False,
            ms=round(elapsed, 1),
            text=str(exc),
        )
        if agent_turn:
            try:
                from app.observability.llm_log import clear_llm_log_context
                from app.observability.turn_log import finish_turn

                finish_turn("", error=str(exc))
                clear_llm_log_context()
            except Exception:  # noqa: BLE001
                pass
        raise
    finally:
        _CHANNEL.reset(token)
