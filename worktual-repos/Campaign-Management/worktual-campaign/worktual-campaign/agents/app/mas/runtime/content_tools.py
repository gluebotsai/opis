"""Bounded tool schemas for Content MAS executors."""

from __future__ import annotations


def tools_for_mas_content_executor(executor_id: str) -> list:
    """OpenAI tool schemas for one Content MAS executor (bounded subset)."""
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    eid = str(executor_id or "").strip().lower()
    names = EXECUTOR_TOOL_ALLOWLIST.get(eid, frozenset())
    if eid == "whatsapp_approved_send":
        from app.agents.whatsapp_approved.tools.schemas import ALL_TOOLS

        catalog = {str(t["function"]["name"]): t for t in ALL_TOOLS}
    elif eid == "content_verification":
        from app.agents.whatsapp_rejected.tools.schemas import ALL_TOOLS

        catalog = {str(t["function"]["name"]): t for t in ALL_TOOLS}
    else:
        return []
    return [catalog[n] for n in names if n in catalog]
