"""Skill MCP server with lexical discovery and turn-local activation."""

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from app.config import get_settings
from app.mcp.context import get_tool_context
from app.skills.registry import get_skill_registry


class SkillMCPServer:
    tool_names = (
        "list_skills",
        "get_skill",
        "update_skill_in_system",
        "remove_skill_from_system",
        "list_active_skills",
    )

    def __init__(self) -> None:
        self.registry = get_skill_registry()
        self.mcp = FastMCP("skill")
        descriptions = {
            "list_skills": "Rank available skills using vectorless lexical matching.",
            "get_skill": "Get one skill pack and its progressive instructions.",
            "update_skill_in_system": "Activate a skill in the current trusted turn.",
            "remove_skill_from_system": "Deactivate one skill in the current turn.",
            "list_active_skills": "List skills active in the current turn.",
        }
        for tool_name in self.tool_names:
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(
                getattr(self, tool_name)
            )

    async def list_skills(
        self,
        query: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        context = get_tool_context()
        allowed = set(context.allowed_skills)
        # In dynamic mode the LLM chooses from governed metadata. Query-keyword
        # ranking must not become an implicit intent router.
        effective_query = None if get_settings().dynamic_procedural_skills_enabled else query
        skills = self.registry.list_skills(effective_query, 50)
        if allowed:
            skills = [skill for skill in skills if str(skill.get("id")) in allowed]
        return skills[: max(1, min(limit, 50))]

    def _authorized_skill(self, skill_id: str) -> dict[str, Any] | None:
        context = get_tool_context()
        if context.allowed_skills and skill_id not in context.allowed_skills:
            return None
        return self.registry.get_skill(skill_id)

    async def get_skill(self, skill_id: str) -> dict[str, Any]:
        skill = self._authorized_skill(skill_id)
        if skill is None:
            return {"error": f"Skill {skill_id} is not available to this agent"}
        return skill

    async def update_skill_in_system(
        self,
        skill_id: str,
        mode: Literal["append", "replace"] = "append",
    ) -> dict[str, Any]:
        skill = self._authorized_skill(skill_id)
        if skill is None:
            return {"error": f"Skill {skill_id} is not available to this agent"}
        active_skills = get_tool_context().active_skills
        if mode == "replace":
            active_skills.clear()
        active_skills[skill_id] = {
            "id": skill_id,
            "name": skill.get("name", skill_id),
            "body": skill.get("body", skill.get("description", "")),
            "version": skill.get("version", 1),
            "workflow": skill.get("workflow", []),
            "rules": skill.get("rules", []),
        }
        return {
            "status": "updated",
            "active_skills": sorted(active_skills),
            "injected_block": (
                f"ACTIVE SKILL [{skill_id}]: {skill.get('name')}\n{skill.get('body', '')}"
            ),
        }

    async def remove_skill_from_system(self, skill_id: str) -> dict[str, Any]:
        active_skills = get_tool_context().active_skills
        if skill_id in active_skills:
            del active_skills[skill_id]
            return {"status": "removed", "active_skills": sorted(active_skills)}
        return {"status": "not_present", "active_skills": sorted(active_skills)}

    async def list_active_skills(self) -> list[str]:
        return sorted(get_tool_context().active_skills)
