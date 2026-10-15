"""MCP JWT authorization helpers."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from typing import Any

from app.contracts.errors import ToolNotAllowed
from app.tools.registry import authorize_tool, tools_for_agent, tools_for_module


def _b64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_json(obj: dict[str, Any]) -> str:
    return _b64url(json.dumps(obj, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def mcp_jwt_secret() -> str:
    """Same secret Express uses to mint MCP JWTs (must match COWORKER_TASKS_SECRET).

    Prefer Settings (loads ai-agents/.env then repo-root .env) over raw os.environ —
    uvicorn does not export dotenv into the process env, so os.environ alone often
    falls through to the hardcoded default and reject every Express-minted token.
    """
    dedicated = (os.environ.get("MCP_EXECUTION_JWT_SECRET") or "").strip()
    if dedicated:
        return dedicated
    try:
        from app.config import get_settings

        from_settings = (get_settings().coworker_tasks_secret or "").strip()
        if from_settings:
            return from_settings
    except Exception:
        pass
    return (
        (os.environ.get("COWORKER_TASKS_SECRET") or "").strip()
        or "worktual-tasks-dev-secret"
    )


def issue_mcp_token(
    *,
    organization_id: str,
    actor_id: str,
    role: str,
    module: str | None = None,
    surface: str | None = None,
    run_id: str | None = None,
    allowed_tools: list[str] | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
    skill_name: str | None = None,
    skill_version: str | None = None,
    route_mode: str | None = None,
    ttl_seconds: int = 300,
) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "iss": "ticketing-express",
        "aud": "ticketing-mcp",
        "iat": now,
        "exp": now + max(30, ttl_seconds),
        "organization_id": organization_id,
        "actor_id": actor_id,
        "role": role,
        "module": module,
        "surface": surface,
        "run_id": run_id,
        "allowed_tools": allowed_tools or [],
        "agent_id": agent_id,
        "task_id": task_id,
        "skill_name": skill_name,
        "skill_version": skill_version,
        "route_mode": route_mode,
    }
    body = f"{_b64url_json(header)}.{_b64url_json(payload)}"
    sig = hmac.new(
        mcp_jwt_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{body}.{_b64url(sig)}"


def verify_mcp_token(token: str) -> dict[str, Any]:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError as exc:
        raise ToolNotAllowed("Malformed MCP token") from exc
    body = f"{header_b64}.{payload_b64}"
    expected = hmac.new(
        mcp_jwt_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256
    ).digest()
    got = urlsafe_b64decode(sig_b64 + "=" * (-len(sig_b64) % 4))
    if not hmac.compare_digest(expected, got):
        raise ToolNotAllowed("Invalid MCP token signature")
    payload_raw = urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4))
    payload = json.loads(payload_raw.decode("utf-8"))
    if int(payload.get("exp") or 0) < int(time.time()):
        raise ToolNotAllowed("MCP token expired")
    if payload.get("aud") not in (None, "ticketing-mcp"):
        raise ToolNotAllowed("MCP token audience mismatch")
    return payload


def assert_tool_authorized(
    *,
    tool_name: str,
    agent: str,
    role: str | None,
    module: str | None = None,
    surface: str | None = None,
    token_claims: dict[str, Any] | None = None,
    operation: str | None = None,
) -> None:
    if tool_name == "route_to_agent":
        return
    allowed = authorized_tool_names(
        agent=agent,
        module=module,
        surface=surface,
        token_claims=token_claims,
    )
    if tool_name not in allowed:
        raise ToolNotAllowed(
            f"Tool {tool_name} not allowed for agent={agent} module={module}"
        )
    if token_claims:
        token_role = str(token_claims.get("role") or "").strip().lower()
        if role and token_role and token_role != str(role).strip().lower():
            raise ToolNotAllowed("MCP token role mismatch")
    if operation:
        authorize_tool(
            agent=agent,
            tool_name=tool_name,
            operation=operation,
            role=role,
        )


def authorized_tool_names(
    *,
    agent: str,
    module: str | None = None,
    surface: str | None = None,
    token_claims: dict[str, Any] | None = None,
) -> set[str]:
    """Compute the fail-closed registry × Skill × route × token intersection."""
    from app.tools.registry import module_matches_agent

    agent_id = str(agent or "").strip()
    allowed = set(tools_for_agent(agent_id))
    if module and module_matches_agent(module, agent_id):
        allowed &= set(tools_for_module(module, surface))
    if token_claims is not None:
        pinned_agent = str(token_claims.get("agent_id") or "").strip()
        if pinned_agent and pinned_agent != agent_id:
            raise ToolNotAllowed("MCP token agent mismatch")
        for key, supplied in (("module", module), ("surface", surface)):
            pinned = str(token_claims.get(key) or "").strip().lower()
            current = str(supplied or "").strip().lower()
            if pinned and current and pinned != current:
                raise ToolNotAllowed(f"MCP token {key} mismatch")
        token_tools = token_claims.get("allowed_tools")
        if not isinstance(token_tools, list) or not token_tools:
            return set()
        allowed &= {str(name) for name in token_tools if str(name).strip()}
        skill_name = str(token_claims.get("skill_name") or "").strip()
        if skill_name:
            from app.skills.catalog import tools_for_skill

            allowed &= set(tools_for_skill(skill_name, agent_id))
            task_id = str(token_claims.get("task_id") or "").strip()
            if task_id:
                from app.workflow_schemas import task_definition_for

                task = task_definition_for(task_id)
                if (
                    not task
                    or task.executor != agent_id
                    or task.skill_name != skill_name
                ):
                    raise ToolNotAllowed("MCP token task/Skill binding mismatch")
    return allowed
