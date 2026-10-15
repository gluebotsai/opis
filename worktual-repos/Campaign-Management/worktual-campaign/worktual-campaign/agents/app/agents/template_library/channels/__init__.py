"""Channel agent registry — maps structured channel ids from tool payload to agents.

This is payload routing (session/tool data), not keyword matching on free-text intent.
"""

from __future__ import annotations

from app.agents.template_library.base import ChannelAgent
from app.agents.template_library.channels.email import agent as email_agent
from app.agents.template_library.channels.ppc import agent as ppc_agent
from app.agents.template_library.channels.push import agent as push_agent
from app.agents.template_library.channels.sms import agent as sms_agent
from app.agents.template_library.channels.web import agent as web_agent
from app.agents.template_library.channels.whatsapp import agent as whatsapp_agent

CHANNEL_AGENTS: dict[str, ChannelAgent] = {
    "email": email_agent,
    "sms": sms_agent,
    "whatsapp": whatsapp_agent,
    "push": push_agent,
    "web": web_agent,
    "ppc": ppc_agent,
}


def get_channel_agent(channel: str) -> ChannelAgent | None:
    key = (channel or "").strip().lower()
    return CHANNEL_AGENTS.get(key)
