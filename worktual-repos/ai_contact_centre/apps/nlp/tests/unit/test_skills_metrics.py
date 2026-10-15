import pytest

from app.mcp.context import bind_trusted_context, build_trusted_context
from app.mcp.servers.metric import MetricMCPServer
from app.mcp.servers.skill import SkillMCPServer
from app.schemas.copilot import ToolContext
from app.skills.registry import get_skill_registry


def test_only_planned_skill_packs_are_loaded() -> None:
    registry = get_skill_registry()
    assert set(registry.skills) == {
        "contact-entity-extraction",
        "contact-identity-resolution",
        "contact-search",
        "contact-create",
        "contact-update",
        "contact-deactivate",
        "queue-create",
        "queue-update",
        "queue-staff",
        "queue-delete",
        "performance-analytics",
        "dashboard-analytics",
    }


@pytest.mark.asyncio
async def test_skill_activation_is_session_scoped() -> None:
    server = SkillMCPServer()
    first = ToolContext(tenant_id="tenant-1", role="agent")
    second = ToolContext(tenant_id="tenant-2", role="agent")

    with bind_trusted_context(build_trusted_context("skill", first)):
        await server.update_skill_in_system("contact-entity-extraction")
    with bind_trusted_context(build_trusted_context("skill", second)):
        active_second = await server.list_active_skills()

    assert "contact-entity-extraction" in first.active_skills
    assert active_second == []


@pytest.mark.asyncio
async def test_vectorless_metric_ranking_is_deterministic() -> None:
    server = MetricMCPServer()
    context = ToolContext(tenant_id="tenant-1", role="agent")
    with bind_trusted_context(build_trusted_context("metric", context)):
        first = await server.get_metrics("average handle time", domain="performance")
        second = await server.get_metrics("average handle time", domain="performance")

    assert first == second
    assert first
    assert first[0]["id"] == "avg_handle_time"


@pytest.mark.asyncio
async def test_channel_ix_ranks_channel_mix() -> None:
    server = MetricMCPServer()
    context = ToolContext(tenant_id="tenant-1", role="admin")
    with bind_trusted_context(build_trusted_context("metric", context)):
        ranked = await server.get_metrics("AI channel ix", domain="performance")

    assert ranked
    assert ranked[0]["id"] == "channel_mix"
    assert ranked[0]["canonicalLabel"] == "Channel mix"
