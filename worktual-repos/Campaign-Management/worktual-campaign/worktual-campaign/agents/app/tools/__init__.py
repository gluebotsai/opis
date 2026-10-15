"""Compatibility shim for create-campaign tools."""

from app.agents.create_campaign.tool_functions import dispatch_tool
from app.agents.create_campaign.tools import ALL_TOOLS

__all__ = ["ALL_TOOLS", "dispatch_tool"]
