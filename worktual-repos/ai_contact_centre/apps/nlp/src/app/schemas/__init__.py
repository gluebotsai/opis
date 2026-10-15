"""Consolidated HTTP and event contracts."""

from app.schemas.bot import (
    BotTurnRequest,
    BotTurnResponse,
    ContactEntities,
    ContactEntityExtractionRequest,
    ContactEntityExtractionResponse,
    EmailPriorityRequest,
    EmailPriorityResponse,
    EmailTurnRequest,
    EmailTurnResponse,
    WebchatBotRequest,
    WebchatBotResponse,
    WhatsAppBotRequest,
    WhatsAppBotResponse,
)
from app.schemas.copilot import CopilotRequest, CopilotSyncResponse, ToolContext
from app.schemas.omnichannel import (
    OmniChannelSummaryRefreshRequest,
    OmniChannelSummaryRefreshResponse,
)

__all__ = [
    "BotTurnRequest",
    "BotTurnResponse",
    "ContactEntities",
    "ContactEntityExtractionRequest",
    "ContactEntityExtractionResponse",
    "CopilotRequest",
    "CopilotSyncResponse",
    "EmailPriorityRequest",
    "EmailPriorityResponse",
    "EmailTurnRequest",
    "EmailTurnResponse",
    "OmniChannelSummaryRefreshRequest",
    "OmniChannelSummaryRefreshResponse",
    "ToolContext",
    "WebchatBotRequest",
    "WebchatBotResponse",
    "WhatsAppBotRequest",
    "WhatsAppBotResponse",
]
