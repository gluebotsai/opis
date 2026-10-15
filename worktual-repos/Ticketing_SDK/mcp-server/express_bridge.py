"""Map shared tool catalog → Express HTTP. No SQL; Express owns RBAC/mutations."""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

_ROOT = Path(__file__).resolve().parents[1]
_CATALOG_PATH = _ROOT / "shared" / "ticketing_tool_catalog.json"

_audit_log = logging.getLogger("ticketing.mcp.audit")
if not _audit_log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    _audit_log.addHandler(_handler)
    _audit_log.setLevel(logging.INFO)


def express_base() -> str:
    return (os.environ.get("EXPRESS_BASE_URL") or "http://127.0.0.1:3000").rstrip("/")


def tasks_secret() -> str:
    return (
        os.environ.get("COWORKER_TASKS_SECRET") or "worktual-tasks-dev-secret"
    ).strip()


def load_catalog() -> dict[str, Any]:
    return json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))


def tool_err(code: str, message: str, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = {
        "success": False,
        "error_code": code,
        "message": message,
        "payload": {},
    }
    out.update(extra)
    return out


def tool_ok(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return {"success": True, "error_code": None, "payload": payload}
    return {"success": True, "error_code": None, "payload": {"data": payload}}


_LIST_TICKET_FIELDS = (
    "id",
    "subject",
    "customerName",
    "customerEmail",
    "status",
    "priority",
    "assignee",
    "queue",
    "createdAt",
    "updatedAt",
    "dueAt",
)


def _normalize_list_tickets_result(
    tool_name: str, result: dict[str, Any]
) -> dict[str, Any]:
    if tool_name != "list_tickets" or not isinstance(result, dict):
        return result
    payload = result.get("payload")
    if not isinstance(payload, dict):
        return result
    rows = payload.get("data")
    if not isinstance(rows, list):
        return result
    slim: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            slim.append({key: row.get(key) for key in _LIST_TICKET_FIELDS})
    out = dict(result)
    out_payload = dict(payload)
    out_payload["data"] = slim
    out["payload"] = out_payload
    return out


def resolve_actor_headers(incoming: dict[str, str]) -> dict[str, str] | dict[str, Any]:
    """Build Express coworker actor headers from MCP client auth.

    Auth rules (hardened):
    - Internal: actor + org headers require a matching X-Coworker-Tasks-Key
      (never auto-fill the secret for unauthenticated callers).
    - External: Bearer / X-Api-Key → Express /api/mcp/session.
    """
    lower = {str(k).lower(): str(v) for k, v in (incoming or {}).items()}
    actor_id = (lower.get("x-coworker-actor-id") or "").strip()
    org_id = (lower.get("x-coworker-org-id") or "").strip()
    provided_key = (lower.get("x-coworker-tasks-key") or "").strip()
    expected_key = tasks_secret()

    if actor_id and org_id:
        if not provided_key or not hmac.compare_digest(provided_key, expected_key):
            return tool_err(
                "UNAUTHORIZED",
                "X-Coworker-Tasks-Key is required and must match the service secret.",
                http_status=401,
            )
        out = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Coworker-Tasks-Key": expected_key,
            "X-Coworker-Actor-Id": actor_id,
            "X-Coworker-Org-Id": org_id,
        }
        if lower.get("x-coworker-actor-role"):
            out["X-Coworker-Actor-Role"] = lower["x-coworker-actor-role"]
        if lower.get("x-coworker-actor-name"):
            out["X-Coworker-Actor-Name"] = lower["x-coworker-actor-name"]
        if lower.get("x-request-id"):
            out["X-Request-Id"] = lower["x-request-id"]
        return out

    api_key = ""
    auth = (lower.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        api_key = auth[7:].strip()
    if not api_key:
        api_key = (lower.get("x-api-key") or "").strip()
    if not api_key:
        return tool_err(
            "NO_ACTOR",
            "Provide coworker actor headers (with tasks key) or an org API key "
            "(Bearer / X-Api-Key).",
        )

    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(
                f"{express_base()}/api/mcp/session",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        return tool_err("TRANSPORT", f"Express unreachable: {exc}")

    if resp.status_code >= 400:
        try:
            data = resp.json()
        except Exception:  # noqa: BLE001
            data = {}
        msg = str(
            (data or {}).get("error") or resp.reason_phrase or f"HTTP {resp.status_code}"
        )
        return tool_err("UNAUTHORIZED", msg, http_status=resp.status_code)

    session = resp.json() if resp.content else {}
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Coworker-Tasks-Key": expected_key,
        "X-Coworker-Actor-Id": str(session.get("actorId") or ""),
        "X-Coworker-Org-Id": str(session.get("organizationId") or ""),
        "X-Coworker-Actor-Role": str(session.get("actorRole") or "agent"),
        "X-Coworker-Actor-Name": str(
            session.get("actorName") or session.get("keyName") or ""
        ),
        # Propagated for audit only (not sent as Express header)
        "_mcp_key_id": str(session.get("keyId") or ""),
        "_mcp_key_name": str(session.get("keyName") or ""),
    }


def _format_path(template: str, args: dict[str, Any]) -> str:
    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        val = args.get(key)
        if val is None or str(val).strip() == "":
            raise ValueError(f"missing path param {key}")
        raw = str(val).strip()
        if key == "ticket_number":
            if not raw.startswith("#") and raw.lstrip("#").isdigit():
                raw = f"#{raw.lstrip('#')}"
        return quote(raw, safe="")

    return re.sub(r"\{(\w+)\}", repl, template)


def build_express_call(
    tool: dict[str, Any], args: dict[str, Any]
) -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
    express = tool["express"]
    method = str(express["method"]).upper()
    path = _format_path(str(express["path"]), args)
    name = tool["name"]
    body: dict[str, Any] | None = None
    params: dict[str, Any] | None = None

    if name == "list_tickets":
        params = {}
        mapping = {
            "scope": "scope",
            "limit": "limit",
            "offset": "offset",
            "created_by": "createdBy",
            "assigned_to": "assignedTo",
            "status": "status",
            "priority": "priority",
            "channel": "channel",
            "query": "q",
            "queue": "queue",
            "customer": "customer",
            "due": "due",
            "created_range": "createdRange",
            "updated_range": "updatedRange",
            "sort": "sort",
            "include_total": "includeTotal",
        }
        for src, dest in mapping.items():
            val = args.get(src)
            if val not in (None, ""):
                params[dest] = val
        if params.get("limit") in (None, ""):
            params["limit"] = 12
        if params.get("offset") in (None, ""):
            params["offset"] = 0
        params["includeTotal"] = "1"
        return method, path, None, params or None

    if name in ("list_priorities", "list_statuses"):
        if args.get("include_inactive"):
            params = {"all": "1"}
        return method, path, None, params

    if name == "list_queues":
        query = str(args.get("query") or "").strip()
        if query:
            return method, path, None, {"q": query}
        return method, path, None, None

    if name == "list_kb":
        params = {}
        query = str(args.get("query") or "").strip()
        if query:
            params["q"] = query
        category = str(args.get("category") or "").strip()
        if category:
            params["category"] = category
        status = str(args.get("status") or "").strip()
        if status:
            params["status"] = status
        if args.get("limit") not in (None, ""):
            params["limit"] = args.get("limit")
        if args.get("offset") not in (None, ""):
            params["offset"] = args.get("offset")
        return method, path, None, params or None

    if method in ("GET", "DELETE"):
        return method, path, None, None

    if name == "create_ticket":
        body = {k: v for k, v in args.items() if v is not None and v != ""}
    elif name == "update_ticket":
        body = {
            k: v
            for k, v in args.items()
            if k != "ticket_number" and v is not None and str(v).strip() != ""
        }
    elif name == "escalate_ticket":
        body = {}
        if args.get("assignee_id"):
            body["assigneeId"] = args["assignee_id"]
        if args.get("assignee"):
            body["assignee"] = args["assignee"]
            body["assigneeName"] = args["assignee"]
        if args.get("agent_id"):
            body["agentId"] = args["agent_id"]
        if args.get("agent"):
            body["agentName"] = args["agent"]
        if args.get("rationale"):
            body["rationale"] = args["rationale"]
    elif name == "add_ticket_note":
        vis = (
            "public"
            if str(args.get("visibility") or "").lower() == "public"
            else "internal"
        )
        body = {"text": args.get("text"), "visibility": vis}
        if (
            args.get("send_customer_email") is True
            or args.get("sendCustomerEmail") is True
        ):
            body["sendCustomerEmail"] = True
    elif name == "create_queue":
        body = {
            "queueName": args.get("name"),
            "description": (args.get("description") or "").strip(),
        }
        if args.get("member_ids"):
            body["memberIds"] = args["member_ids"]
        if args.get("members"):
            body["members"] = args["members"]
    elif name == "update_queue":
        body = {}
        if args.get("name") is not None:
            body["queueName"] = args["name"]
        if args.get("description") is not None:
            body["description"] = args["description"]
        if args.get("member_ids") is not None:
            body["memberIds"] = args["member_ids"]
        if args.get("members") is not None:
            body["members"] = args["members"]
        if args.get("add_members"):
            body["addMembers"] = True
    elif name in {"create_kb_article", "draft_kb_article"}:
        body = {
            "title": args.get("title"),
            "content": args.get("content"),
            "category": args.get("category"),
        }
        if args.get("author"):
            body["author"] = args["author"]
        if name == "draft_kb_article":
            body["status"] = "Draft"
    elif name == "create_macro":
        body = {"title": args.get("title"), "body": args.get("body")}
    elif name == "create_priority":
        body = {
            "displayName": args.get("display_name"),
            "resolutionHours": args.get("resolution_hours"),
        }
    elif name == "create_status":
        body = {"displayName": args.get("display_name")}
    elif name == "update_org_preferences":
        body = {}
        if args.get("ticket_prefix") is not None:
            body["ticketPrefix"] = args["ticket_prefix"]
        if args.get("portal_label") is not None:
            body["portalLabel"] = args["portal_label"]
        if args.get("display_timezone") is not None:
            body["displayTimezone"] = args["display_timezone"]
    else:
        body = {k: v for k, v in args.items() if v is not None}

    return method, path, body, None


def _express_headers(actor_headers: dict[str, Any]) -> dict[str, str]:
    """Drop MCP-only audit fields before calling Express."""
    return {
        str(k): str(v)
        for k, v in actor_headers.items()
        if not str(k).startswith("_") and v is not None
    }


def _audit_tool_call(
    *,
    tool_name: str,
    actor_headers: dict[str, Any],
    success: bool,
    error_code: str | None,
    http_status: int | None,
) -> None:
    _audit_log.info(
        "mcp_tool_call tool=%s success=%s error_code=%s http_status=%s "
        "actor_id=%s org_id=%s key_id=%s key_name=%s",
        tool_name,
        success,
        error_code or "",
        http_status if http_status is not None else "",
        actor_headers.get("X-Coworker-Actor-Id") or "",
        actor_headers.get("X-Coworker-Org-Id") or "",
        actor_headers.get("_mcp_key_id") or "",
        actor_headers.get("_mcp_key_name") or "",
    )


def call_express_tool(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    incoming_headers: dict[str, str],
) -> dict[str, Any]:
    catalog = load_catalog()
    tool = next((t for t in catalog["tools"] if t["name"] == tool_name), None)
    if not tool:
        return tool_err("UNKNOWN_TOOL", f"Unknown tool {tool_name}")

    actor_headers = resolve_actor_headers(incoming_headers)
    if actor_headers.get("success") is False:
        _audit_tool_call(
            tool_name=tool_name,
            actor_headers={},
            success=False,
            error_code=str(actor_headers.get("error_code") or "AUTH"),
            http_status=actor_headers.get("http_status"),  # type: ignore[arg-type]
        )
        return actor_headers  # type: ignore[return-value]

    try:
        method, path, body, params = build_express_call(tool, arguments or {})
    except ValueError as exc:
        return tool_err("BAD_INPUT", str(exc))

    if path.startswith("/api/coworker/"):
        return tool_err("FORBIDDEN_PATH", "Tools must not call coworker chat endpoints")

    express_headers = _express_headers(actor_headers)
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.request(
                method,
                f"{express_base()}{path}",
                json=body,
                params=params,
                headers=express_headers,
            )
    except httpx.HTTPError as exc:
        _audit_tool_call(
            tool_name=tool_name,
            actor_headers=actor_headers,
            success=False,
            error_code="TRANSPORT",
            http_status=None,
        )
        return tool_err("TRANSPORT", f"Express unreachable: {exc}")

    try:
        data = resp.json() if resp.content else {}
    except Exception:  # noqa: BLE001
        data = {"raw": (resp.text or "")[:400]}

    if resp.status_code >= 400:
        message = ""
        if isinstance(data, dict):
            message = str(
                data.get("error") or data.get("detail") or data.get("message") or ""
            )
        if not message:
            message = resp.reason_phrase or f"HTTP {resp.status_code}"
        code = "HTTP_ERROR"
        if resp.status_code == 401:
            code = "UNAUTHORIZED"
        elif resp.status_code == 403:
            code = "FORBIDDEN"
        elif resp.status_code == 404:
            code = "NOT_FOUND"
        elif resp.status_code == 422:
            code = "UNPROCESSABLE"
        _audit_tool_call(
            tool_name=tool_name,
            actor_headers=actor_headers,
            success=False,
            error_code=code,
            http_status=resp.status_code,
        )
        return tool_err(
            code,
            message,
            payload=data if isinstance(data, dict) else {},
            http_status=resp.status_code,
        )

    _audit_tool_call(
        tool_name=tool_name,
        actor_headers=actor_headers,
        success=True,
        error_code=None,
        http_status=resp.status_code,
    )
    return _normalize_list_tickets_result(
        tool_name,
        tool_ok(data if isinstance(data, dict) else {"data": data}),
    )
