"""Coworker MCP client.

Production is HTTP-only. In-process dispatch exists solely for explicitly
enabled tests and never acts as a production availability fallback.
"""

from __future__ import annotations

import logging
import time
import secrets
import re
from typing import Any, Optional

import httpx
import jwt

from app.config import get_settings
from app.operations import mcp_circuit, metrics

log = logging.getLogger("ai-service.mcp_client")


def _merge_refresh(into: dict[str, Any], fragment: dict[str, Any] | None) -> None:
    if not fragment:
        return
    mods = fragment.get("modules")
    if isinstance(mods, list):
        prev = into.get("modules") if isinstance(into.get("modules"), list) else []
        into["modules"] = list({*prev, *mods})
    ids = fragment.get("entityIds")
    if isinstance(ids, list):
        prev = into.get("entityIds") if isinstance(into.get("entityIds"), list) else []
        into["entityIds"] = list({*prev, *[e for e in ids if e]})
    if fragment.get("reason"):
        into["reason"] = fragment["reason"]
    if fragment.get("href"):
        into["href"] = fragment["href"]
    if isinstance(fragment.get("seoProgress"), dict):
        into["seoProgress"] = fragment["seoProgress"]
    if isinstance(fragment.get("seoContent"), dict):
        into["seoContent"] = fragment["seoContent"]
    if isinstance(fragment.get("seoKeywords"), dict):
        into["seoKeywords"] = fragment["seoKeywords"]
    if isinstance(fragment.get("seoSocial"), dict):
        into["seoSocial"] = fragment["seoSocial"]


class McpClient:
    """List/call coworker tools via HTTP MCP server (or in-process fallback)."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        acting_user_id: Optional[str] = None,
        timeout_s: float = 20.0,
        organization_id: Optional[str] = None,
        role: Optional[str] = None,
        prefer_http: Optional[bool] = None,
        execution_token: Optional[str] = None,
        execution_context: Optional[dict[str, Any]] = None,
    ) -> None:
        settings = get_settings()
        raw = (base_url if base_url is not None else settings.mcp_base_url) or ""
        self.base_url = raw.strip().rstrip("/")
        self.acting_user_id = (acting_user_id or "").strip() or None
        self.organization_id = (organization_id or "").strip() or None
        self.role = (role or "").strip() or None
        self.execution_token = (execution_token or "").strip() or None
        self.execution_context = dict(execution_context or {})
        if self.execution_token:
            try:
                token_claims = jwt.decode(
                    self.execution_token,
                    options={"verify_signature": False, "verify_exp": False},
                    algorithms=["HS256"],
                )
                for key in (
                    "agentName",
                    "executionMode",
                    "businessType",
                    "module",
                    "surface",
                    "policyVersion",
                    "organizationId",
                    "role",
                    "runId",
                    "traceId",
                    "idempotencyKey",
                ):
                    if token_claims.get(key) is not None:
                        self.execution_context.setdefault(key, token_claims[key])
                if token_claims.get("actorId") is not None:
                    self.execution_context.setdefault("actingUserId", token_claims["actorId"])
            except jwt.PyJWTError:
                # The server remains the trust boundary and will reject malformed tokens.
                pass
        self.timeout_s = timeout_s
        requested_http = (
            settings.mcp_prefer_http if prefer_http is None else prefer_http
        )
        self.prefer_http = True if settings.app_env.lower() == "production" else requested_http
        self._ui_refresh: dict[str, Any] = {}

    def drain_ui_refresh(self) -> dict[str, Any]:
        out = dict(self._ui_refresh)
        self._ui_refresh = {}
        return out

    def _headers(self) -> dict[str, str]:
        settings = get_settings()
        h = {"Content-Type": "application/json"}
        if self.execution_token:
            h["Authorization"] = f"Bearer {self.execution_token}"
        trace_id = str(self.execution_context.get("traceId") or "").lower()
        if re.fullmatch(r"[0-9a-f]{32}", trace_id):
            h["traceparent"] = f"00-{trace_id}-{secrets.token_hex(8)}-01"
        secret = settings.internal_secret
        if (
            not self.execution_token
            and settings.mcp_allow_legacy_secret_auth
            and settings.app_env.lower() in {"development", "test"}
            and secret
        ):
            h["x-internal-secret"] = secret
        return h

    def _context_payload(
        self, context: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        ctx = {**self.execution_context, **dict(context or {})}
        if self.acting_user_id and not ctx.get("actingUserId"):
            ctx["actingUserId"] = self.acting_user_id
        if self.organization_id and not ctx.get("organizationId"):
            ctx["organizationId"] = self.organization_id
        if self.role and not ctx.get("role"):
            ctx["role"] = self.role
        return ctx

    def _test_inprocess_enabled(self) -> bool:
        settings = get_settings()
        return (
            settings.app_env.lower() == "test"
            and settings.mcp_allow_test_inprocess
        )

    async def _http_list(
        self,
        *,
        module: str,
        surface: str,
        entity_id: Optional[str],
    ) -> list[dict[str, Any]] | None:
        if not self.base_url:
            return None
        settings = get_settings()
        mcp_circuit.failure_threshold = max(1, settings.dependency_circuit_failures)
        mcp_circuit.recovery_seconds = max(
            1, settings.dependency_circuit_recovery_seconds
        )
        if not mcp_circuit.allow():
            metrics.increment("mcp_circuit_rejected_total", operation="list")
            return None
        url = f"{self.base_url}/tools/list"
        payload = {
            "module": module,
            "surface": surface,
            "entityId": entity_id,
            "context": self._context_payload(
                {"module": module, "surface": surface, "entityId": entity_id}
            ),
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                res = await client.post(url, json=payload, headers=self._headers())
            if res.status_code >= 400:
                mcp_circuit.failure()
                metrics.increment("mcp_requests_total", operation="list", outcome="error")
                log.warning("MCP list HTTP %s", res.status_code)
                try:
                    from app.agent_log import fmt, logger

                    logger.error(
                        fmt(
                            agent="mcp",
                            step="list",
                            ok=False,
                            error=f"HTTP {res.status_code}",
                            module=module,
                            surface=surface,
                        )
                    )
                except Exception:  # noqa: BLE001
                    pass
                return None
            data = res.json()
            mcp_circuit.success()
            metrics.increment("mcp_requests_total", operation="list", outcome="ok")
            metrics.gauge(
                "mcp_latency_ms",
                (time.monotonic() - started) * 1000,
                operation="list",
            )
            tools = data.get("tools") if isinstance(data, dict) else None
            return tools if isinstance(tools, list) else None
        except Exception as exc:  # noqa: BLE001
            mcp_circuit.failure()
            metrics.increment("mcp_requests_total", operation="list", outcome="error")
            log.warning("MCP list HTTP failed: %s", exc)
            try:
                from app.agent_log import fmt, logger

                logger.error(
                    fmt(
                        agent="mcp",
                        step="list",
                        ok=False,
                        error=str(exc),
                        module=module,
                        surface=surface,
                    )
                )
            except Exception:  # noqa: BLE001
                pass
            return None

    async def _http_call(
        self,
        name: str,
        arguments: dict[str, Any] | None,
        context: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if not self.base_url:
            return None
        settings = get_settings()
        mcp_circuit.failure_threshold = max(1, settings.dependency_circuit_failures)
        mcp_circuit.recovery_seconds = max(
            1, settings.dependency_circuit_recovery_seconds
        )
        if not mcp_circuit.allow():
            metrics.increment("mcp_circuit_rejected_total", operation="call")
            return None
        url = f"{self.base_url}/tools/call"
        payload = {
            "name": name,
            "arguments": arguments or {},
            "context": self._context_payload(context),
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                res = await client.post(url, json=payload, headers=self._headers())
            if res.status_code >= 400:
                mcp_circuit.failure()
                metrics.increment("mcp_requests_total", operation="call", outcome="error")
                detail = ""
                try:
                    body = res.json()
                    detail = str(body.get("detail") or "")[:240] if isinstance(body, dict) else ""
                except Exception:  # noqa: BLE001
                    detail = (res.text or "")[:240]
                log.warning("MCP call HTTP %s %s", res.status_code, detail)
                try:
                    from app.agent_log import fmt, logger, trace_api

                    logger.error(
                        fmt(
                            agent="mcp",
                            step="call",
                            ok=False,
                            tool=name,
                            error=f"HTTP {res.status_code}",
                        )
                    )
                    trace_api(
                        agent="native",
                        service="mcp",
                        operation=name,
                        ok=False,
                        status=res.status_code,
                        error=detail or f"HTTP {res.status_code}",
                    )
                except Exception:  # noqa: BLE001
                    pass
                return None
            data = res.json()
            mcp_circuit.success()
            elapsed_ms = (time.monotonic() - started) * 1000
            metrics.increment("mcp_requests_total", operation="call", outcome="ok")
            metrics.gauge(
                "mcp_latency_ms",
                elapsed_ms,
                operation="call",
            )
            try:
                from app.agent_log import trace_api

                trace_api(
                    agent="native",
                    service="mcp",
                    operation=name,
                    ok=True,
                    ms=round(elapsed_ms, 1),
                    url=url,
                )
            except Exception:  # noqa: BLE001
                pass
            if isinstance(data, dict):
                frag = data.get("uiRefresh")
                if isinstance(frag, dict):
                    _merge_refresh(self._ui_refresh, frag)
                return data
            return None
        except Exception as exc:  # noqa: BLE001
            mcp_circuit.failure()
            metrics.increment("mcp_requests_total", operation="call", outcome="error")
            log.warning("MCP call HTTP failed: %s", exc)
            try:
                from app.agent_log import fmt, logger

                logger.error(
                    fmt(
                        agent="mcp",
                        step="call",
                        ok=False,
                        tool=name,
                        error=str(exc),
                    )
                )
            except Exception:  # noqa: BLE001
                pass
            return None

    async def list_tools(
        self,
        *,
        module: str,
        surface: str,
        entity_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        if self.prefer_http:
            tools = await self._http_list(
                module=module, surface=surface, entity_id=entity_id
            )
            if tools is not None:
                return tools
        if not self._test_inprocess_enabled():
            return []
        from app.mcp.server import list_coworker_tools

        return await list_coworker_tools(
            module=module, surface=surface, entity_id=entity_id
        )

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
        *,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        ctx = self._context_payload(context)
        if self.prefer_http:
            result = await self._http_call(name, arguments, ctx)
            if result is not None:
                _log_mcp_call(name, result)
                return result
        if not self._test_inprocess_enabled():
            _log_mcp_call(name, None, error="MCP HTTP unavailable")
            return None
        from app.mcp.server import call_coworker_tool

        try:
            result = await call_coworker_tool(name, arguments, context=ctx)
        except Exception as exc:  # noqa: BLE001
            _log_mcp_call(name, None, error=str(exc))
            return None
        _log_mcp_call(name, result)
        return result


def _log_mcp_call(
    name: str,
    result: dict[str, Any] | None,
    *,
    error: str | None = None,
) -> None:
    try:
        from app.agent_log import fmt, logger

        ok = False if error else (
            bool(result.get("ok", True)) if isinstance(result, dict) else False
        )
        msg = fmt(
            agent="mcp",
            step="call",
            ok=ok,
            tool=name,
            kind=result.get("kind") if isinstance(result, dict) else None,
            error=error or (result.get("error") if isinstance(result, dict) else None),
        )
        if ok:
            logger.info(msg)
        else:
            logger.error(msg)
    except Exception:  # noqa: BLE001
        pass


def mcp_tools_to_openai(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for t in tools:
        if not isinstance(t, dict):
            continue
        name = str(t.get("name") or "").strip()
        if not name:
            continue
        schema = t.get("inputSchema") or t.get("input_schema") or {
            "type": "object",
            "properties": {},
        }
        if not isinstance(schema, dict):
            schema = {"type": "object", "properties": {}}
        out.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": str(t.get("description") or name)[:500],
                    "parameters": schema,
                },
            }
        )
    return out


def mcp_result_to_turn_parts(
    name: str, result: dict[str, Any]
) -> dict[str, Any]:
    kind = str(result.get("kind") or "")
    parts: dict[str, Any] = {"ok": bool(result.get("ok", True))}
    if result.get("assistantText"):
        parts["assistantText"] = str(result["assistantText"])
    if kind == "draft_patch" and isinstance(result.get("patch"), dict):
        parts["patch"] = result["patch"]
        # Draft patches update the workspace silently — do not surface a Confirm.
        return parts
    # Clarify is chat-only — the question is already in assistantText.
    if kind == "clarify":
        return parts

    prop = result.get("proposal")
    if isinstance(prop, dict) and prop.get("name"):
        parts["toolProposal"] = prop
    elif kind in ("needs_confirm", "ui_directive", "form_owned"):
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        args = data.get("args") if isinstance(data.get("args"), dict) else {}
        parts["toolProposal"] = {
            "id": f"mcp-{name}",
            "name": name,
            "label": name.replace("_", " "),
            "args": {**args, "auto": True} if kind != "needs_confirm" else args,
            "risk": "high" if kind == "needs_confirm" else "low",
        }
    if kind == "executed" and isinstance(result.get("data"), dict):
        parts["executedData"] = result["data"]
    frag = result.get("uiRefresh")
    if isinstance(frag, dict):
        parts["uiRefresh"] = frag
    return parts
