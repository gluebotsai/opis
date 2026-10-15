"""Omnichannel summary refresh API using MCP and the shared LLM."""

import json
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, Header

from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.mcp.context import CcCoreHTTPAdapter
from app.prompts.omnichannel import OMNICHANNEL_SUMMARY_PROMPT
from app.schemas.copilot import ToolContext
from app.schemas.omnichannel import (
    OmniChannelSummaryRefreshRequest,
    OmniChannelSummaryRefreshResponse,
)

MAX_OMNICHANNEL_SUMMARY_CHARS = 2000
TARGET_OMNICHANNEL_SUMMARY_CHARS = 1900


@lru_cache
def get_cc_core_adapter() -> CcCoreHTTPAdapter:
    return CcCoreHTTPAdapter()


def _contact_payload(payload: dict[str, Any]) -> dict[str, Any]:
    contact = payload.get("contact", payload)
    return contact if isinstance(contact, dict) else {}


def _channel_summaries(payload: dict[str, Any]) -> list[Any]:
    contact = _contact_payload(payload)
    for key in ("channel_summaries", "channelSummaries", "conversation_summaries"):
        value = contact.get(key)
        if isinstance(value, list):
            return value
    return []


def _previous_summary(payload: dict[str, Any]) -> str:
    contact = _contact_payload(payload)
    for key in ("omniChannelSummary", "omni_channel_summary"):
        value = contact.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def create_omnichannel_router(api_v1_base: str) -> APIRouter:
    router = APIRouter(prefix=f"{api_v1_base}/omnichannel", tags=["Omnichannel"])

    @router.post("/summary/refresh", response_model=OmniChannelSummaryRefreshResponse)
    async def refresh_summary(
        request: OmniChannelSummaryRefreshRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
        http: CcCoreHTTPAdapter = Depends(get_cc_core_adapter),
    ) -> OmniChannelSummaryRefreshResponse:
        auth = authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "omnichannel",
        )
        tool_context = ToolContext(
            tenant_id=auth.tenant_id,
            role="admin",
            contact_id=request.contact_id,
        )
        payload = await http.request(
            "GET",
            f"/internal/v1/contacts/{request.contact_id}/channel-summaries",
            tool_context,
            internal=True,
        )
        summaries = _channel_summaries(payload)
        previous = _previous_summary(payload)
        summary: str | None = None
        if summaries:
            try:
                source_message = {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "previous_omni_channel_summary": previous,
                            "conversations": summaries,
                        },
                        ensure_ascii=False,
                    ),
                }
                system_message = (
                    OMNICHANNEL_SUMMARY_PROMPT
                    + "\nReturn one JSON object with the key omni_channel_summary."
                )
                result = await llm.json(
                    [{"role": "system", "content": system_message}, source_message]
                )
                value = result.get("omni_channel_summary")
                if isinstance(value, str) and value.strip():
                    candidate = value.strip()
                    if len(candidate) > MAX_OMNICHANNEL_SUMMARY_CHARS:
                        compact_result = await llm.json(
                            [
                                {
                                    "role": "system",
                                    "content": (
                                        system_message
                                        + "\nThe prior draft exceeded the storage limit. "
                                        + "Rewrite it completely and keep the complete result "
                                        + f"at or below {TARGET_OMNICHANNEL_SUMMARY_CHARS} "
                                        + "characters. Preserve exact references and the required "
                                        + "headings; do not cut text."
                                    ),
                                },
                                source_message,
                            ]
                        )
                        compact_value = compact_result.get("omni_channel_summary")
                        if isinstance(compact_value, str):
                            candidate = compact_value.strip()
                    if 0 < len(candidate) <= MAX_OMNICHANNEL_SUMMARY_CHARS:
                        summary = candidate
            except Exception:
                summary = None
        if summary:
            await http.request(
                "PUT",
                f"/internal/v1/contacts/{request.contact_id}/omni-channel-summary",
                tool_context,
                json_body={"omniChannelSummary": summary},
                internal=True,
            )
        return OmniChannelSummaryRefreshResponse(
            contact_id=request.contact_id,
            omni_channel_summary=summary,
            channel_count=len(summaries),
        )

    return router
