"""Internal SFT catalog HTTP routes (not the Hub Agent Card)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException

from app.config import get_settings
from app.sft.catalog import (
    CATALOG_SOURCE,
    CATALOG_VERSION,
    get_catalog_agent,
    list_catalog_agents,
    summarize_agent,
)

router = APIRouter()


def _require_internal_key(
    x_internal_service_key: Annotated[str | None, Header()] = None,
    x_coworker_tasks_key: Annotated[str | None, Header()] = None,
) -> None:
    """Accept the SFT header or the existing Express/coworker tasks header."""
    settings = get_settings()
    expected = (
        settings.internal_service_key or settings.coworker_tasks_secret or ""
    ).strip()
    got = (
        (x_internal_service_key or "").strip()
        or (x_coworker_tasks_key or "").strip()
    )
    if not expected or got != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


def _envelope(*, agents: list[dict[str, Any]] | None = None, agent: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "version": CATALOG_VERSION,
        "source": CATALOG_SOURCE,
    }
    if agent is not None:
        body["agent"] = agent
        return body
    rows = agents or []
    body["agentCount"] = len(rows)
    body["agents"] = rows
    return body


@router.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "ticketing-sft-catalog"}


@router.get("/internal/v1/agents")
def list_agents(
    _: Annotated[None, Depends(_require_internal_key)],
) -> dict[str, Any]:
    full = list_catalog_agents()
    return _envelope(agents=[summarize_agent(row) for row in full])


@router.get("/internal/v1/agents/export")
def export_agents(
    _: Annotated[None, Depends(_require_internal_key)],
) -> dict[str, Any]:
    return _envelope(agents=list_catalog_agents())


@router.get("/internal/v1/agents/{agent_id}")
def get_agent(
    agent_id: str,
    _: Annotated[None, Depends(_require_internal_key)],
) -> dict[str, Any]:
    agent = get_catalog_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="unknown agent")
    return _envelope(agent=agent)
