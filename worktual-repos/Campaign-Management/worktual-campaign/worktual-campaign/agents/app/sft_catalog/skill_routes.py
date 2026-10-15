"""Internal HTTP — MAS skill catalog (Product MCP bridge)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.mas.skills.catalog_api import (
    get_skill_catalog,
    list_active_skills_for_session,
    list_skills_catalog,
    remove_skill_from_system,
    update_skill_in_system,
)
from app.session_store import load_session
from app.sft_catalog.auth import require_internal_service_key

router = APIRouter(
    prefix="/internal/v1/skills",
    tags=["mas-skills"],
    dependencies=[Depends(require_internal_service_key)],
)


class SkillUpdateBody(BaseModel):
    description: str | None = None
    body: str | None = None
    triggers: list[Any] | None = None
    workflow: list[Any] | None = None
    rules: list[Any] | None = None
    tool_names: list[str] | None = None
    executor_id: str | None = None
    version: int | None = None
    required: bool | None = None


class ActiveSkillsQuery(BaseModel):
    session_id: str = Field(..., min_length=1)
    token: str = Field(..., min_length=1)
    module: str | None = None


@router.get("")
async def http_list_skills(module: str | None = None):
    return {"skills": list_skills_catalog(module=module)}


@router.get("/{module}/{skill_id}")
async def http_get_skill(module: str, skill_id: str):
    row = get_skill_catalog(module, skill_id)
    if not row:
        raise HTTPException(status_code=404, detail="Skill not found")
    return row


@router.put("/{module}/{skill_id}")
async def http_update_skill(module: str, skill_id: str, body: SkillUpdateBody):
    try:
        return update_skill_in_system(
            module,
            skill_id,
            body.model_dump(exclude_none=True),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{module}/{skill_id}")
async def http_remove_skill(module: str, skill_id: str):
    ok = remove_skill_from_system(module, skill_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"ok": True, "removed": f"{module}/{skill_id}"}


@router.post("/active")
async def http_list_active_skills(payload: ActiveSkillsQuery):
    session = await load_session(payload.session_id, token=payload.token)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"active_skills": list_active_skills_for_session(session)}
