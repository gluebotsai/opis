from typing import Any, Optional
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from ingest.validation import (
    validate_collect_body,
    validate_client_ip,
    validate_event_id,
    validate_event_name,
    validate_id,
    validate_replay_chunk_body,
    validate_timestamp,
    validate_uuid,
)


class EventContext(BaseModel):
    model_config = ConfigDict(extra="allow")

    page: Optional[dict[str, Any]] = None
    campaign: Optional[dict[str, Any]] = None
    device: Optional[dict[str, Any]] = None
    pageViewId: Optional[str] = None


class AnalyticsEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    eventId: str
    name: str
    timestamp: int
    properties: dict[str, Any] = Field(default_factory=dict)
    context: Optional[EventContext] = None

    @field_validator("eventId")
    @classmethod
    def check_event_id(cls, value: str) -> str:
        return validate_event_id(value)

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str) -> str:
        return validate_event_name(value)

    @field_validator("timestamp")
    @classmethod
    def check_timestamp(cls, value: int) -> int:
        return validate_timestamp(value)


class CollectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    website_id: int = Field(alias="websiteId", gt=0)
    website_url: str = Field(alias="websiteUrl", min_length=1, max_length=512)
    visitor_id: str = Field(alias="visitorId")
    session_id: str = Field(alias="sessionId")
    user_id: Optional[str] = Field(default=None, alias="userId")
    anonymous_id: Optional[str] = Field(default=None, alias="anonymousId")
    organization_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("organization_id", "organizationId"),
        serialization_alias="organization_id",
        gt=0,
    )
    sdk_version: Optional[str] = Field(default=None, alias="sdkVersion", max_length=32)
    sent_at: Optional[int] = Field(default=None, alias="sentAt", gt=0)
    channel: Optional[str] = Field(default=None, max_length=16)
    os: Optional[str] = Field(default=None, max_length=32)
    type: str = "events_v2"
    events: list[Any] = Field(min_length=1, max_length=100)
    profiles: Optional[dict[str, Any]] = None
    payload_id: Optional[UUID] = Field(default=None, alias="payloadId")
    client_ip: Optional[str] = Field(default=None, alias="clientIp")

    @field_validator("type")
    @classmethod
    def check_type(cls, value: str) -> str:
        if value not in {"events_v2", "events_v3"}:
            raise ValueError("type must be 'events_v2' or 'events_v3'")
        return value

    @field_validator("visitor_id", "session_id")
    @classmethod
    def check_ids(cls, value: str, info) -> str:
        return validate_id(value, info.field_name)

    @field_validator("user_id", "anonymous_id")
    @classmethod
    def check_optional_ids(cls, value: Optional[str], info) -> Optional[str]:
        if value is None:
            return None
        return validate_id(value, info.field_name)

    @field_validator("client_ip")
    @classmethod
    def check_client_ip(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_client_ip(value)

    @classmethod
    def from_validated_body(cls, body: dict[str, Any]) -> "CollectRequest":
        sanitized = validate_collect_body(body)
        return cls.model_validate(sanitized)


class ReplayChunkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    website_id: int = Field(alias="websiteId", gt=0)
    website_url: str = Field(alias="websiteUrl", min_length=1, max_length=512)
    visitor_id: str = Field(alias="visitorId")
    session_id: str = Field(alias="sessionId")
    page_view_id: str = Field(alias="pageViewId")
    chunk_index: int = Field(alias="chunkIndex", ge=0)
    chunk_id: str = Field(alias="chunkId")
    encoding: str
    events_data: str = Field(alias="eventsData", min_length=1)
    event_count: int = Field(alias="eventCount", gt=0)
    organization_id: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("organization_id", "organizationId"),
        serialization_alias="organization_id",
        gt=0,
    )
    source: str = "rrweb"
    type: str = "replay_chunk_v1"
    payload_id: Optional[UUID] = Field(default=None, alias="payloadId")
    client_ip: Optional[str] = Field(default=None, alias="clientIp")

    @field_validator("type")
    @classmethod
    def check_type(cls, value: str) -> str:
        if value != "replay_chunk_v1":
            raise ValueError("type must be 'replay_chunk_v1'")
        return value

    @field_validator("encoding")
    @classmethod
    def check_encoding(cls, value: str) -> str:
        if value != "gzip_b64":
            raise ValueError("encoding must be 'gzip_b64'")
        return value

    @field_validator("visitor_id", "session_id", "page_view_id")
    @classmethod
    def check_ids(cls, value: str, info) -> str:
        return validate_id(value, info.field_name)

    @field_validator("chunk_id")
    @classmethod
    def check_chunk_id(cls, value: str) -> str:
        return validate_uuid(value, "chunkId")

    @field_validator("client_ip")
    @classmethod
    def check_client_ip(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_client_ip(value)

    @classmethod
    def from_validated_body(cls, body: dict[str, Any]) -> "ReplayChunkRequest":
        sanitized = validate_replay_chunk_body(body)
        return cls.model_validate(sanitized)


class TrackingResponse(BaseModel):
    payloadId: str
    status: str


class DuplicateResponse(BaseModel):
    payloadId: str
    status: str = "duplicate"


class ValidationErrorResponse(BaseModel):
    status: str = "rejected"
    detail: str


class DomainRejectedResponse(BaseModel):
    status: str = "rejected"
    detail: str = "website_id is not registered or inactive"
