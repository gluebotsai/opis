"""Schemas for omnichannel contact summary refresh."""

from pydantic import BaseModel, Field


class OmniChannelSummaryRefreshRequest(BaseModel):
    organization_id: str = Field(min_length=1)
    contact_id: str = Field(min_length=1)


class OmniChannelSummaryRefreshResponse(BaseModel):
    contact_id: str
    omni_channel_summary: str | None
    channel_count: int
