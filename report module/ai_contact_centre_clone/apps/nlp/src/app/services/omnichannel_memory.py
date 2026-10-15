"""Load persisted omni-channel and per-channel customer memory for bots."""

from __future__ import annotations

from typing import Any

from app.mcp.context import CcCoreHTTPAdapter
from app.schemas.copilot import ToolContext


def _tenant_context(organization_id: str) -> ToolContext:
    return ToolContext(tenant_id=organization_id, role="agent")


async def fetch_contact_omnichannel_memory(
    organization_id: str,
    contact_id: str,
) -> dict[str, Any]:
    empty: dict[str, Any] = {"omni_channel_summary": None, "channel_items": []}
    if not organization_id or not contact_id:
        return empty
    try:
        payload = await CcCoreHTTPAdapter().request(
            "GET",
            f"/internal/v1/contacts/{contact_id}/channel-summaries",
            _tenant_context(organization_id),
            internal=True,
        )
    except Exception:
        return empty
    if not isinstance(payload, dict):
        return empty
    summaries = payload.get("channelSummaries") or payload.get("channel_summaries") or []
    channel_items = (
        [item for item in summaries if isinstance(item, dict)] if isinstance(summaries, list) else []
    )
    omni = payload.get("omniChannelSummary") or payload.get("omni_channel_summary")
    omni_text = omni.strip() if isinstance(omni, str) and omni.strip() else None
    return {"omni_channel_summary": omni_text, "channel_items": channel_items}


def format_omnichannel_memory_lines(memory: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    omni = memory.get("omni_channel_summary")
    if isinstance(omni, str) and omni.strip():
        lines.append(f"Omni-channel summary: {omni.strip()}")
    items = memory.get("channel_items") or []
    if not isinstance(items, list):
        return lines
    seen_channels: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        channel = str(item.get("channel") or item.get("channelType") or "channel").strip()
        summary = str(item.get("summary") or item.get("body") or "").strip()
        if not summary:
            continue
        key = channel.lower()
        if key in seen_channels:
            continue
        seen_channels.add(key)
        lines.append(f"[{channel}] {summary}")
        if len(seen_channels) >= 8:
            break
    return lines
