"""Agents package — product modules: create_campaign, contacts, template_library, monitoring."""

from app.agents.contacts import run_contacts_turn
from app.agents.contacts import welcome_text as contacts_welcome_text
from app.agents.create_campaign import run_create_campaign_turn, welcome_text
from app.agents.monitoring import run_monitoring_turn
from app.agents.monitoring import welcome_text as monitoring_welcome_text
from app.agents.template_library import edit_with_channel_agent, run_creation_agent

__all__ = [
    "edit_with_channel_agent",
    "run_create_campaign_turn",
    "run_contacts_turn",
    "run_monitoring_turn",
    "run_creation_agent",
    "welcome_text",
    "contacts_welcome_text",
    "monitoring_welcome_text",
]
