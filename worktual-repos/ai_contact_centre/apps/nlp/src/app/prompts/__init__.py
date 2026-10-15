"""Prompts package for NLP service."""

from app.prompts.analytics import ANALYTICS_AGENT_PROMPT
from app.prompts.bot import SUPPORT_BOT_SYSTEM_PROMPT
from app.prompts.contact import CONTACT_AGENT_PROMPT
from app.prompts.contact_identity import CONTACT_ENTITY_PROMPT, CONTACT_IDENTITY_PROMPT
from app.prompts.coworker import (
    COWORKER_SYSTEM_PROMPT,
    build_coworker_system_prompt,
    build_routing_instruction,
    build_runtime_context_blocks,
)
from app.prompts.email import EMAIL_BOT_SYSTEM_PROMPT
from app.prompts.inbox import INBOX_AGENT_PROMPT
from app.prompts.omnichannel import OMNICHANNEL_SUMMARY_PROMPT
from app.prompts.monitoring import MONITORING_AGENT_PROMPT
from app.prompts.queue import QUEUE_AGENT_PROMPT
from app.prompts.task import TASK_AGENT_PROMPT

__all__ = [
    "ANALYTICS_AGENT_PROMPT",
    "CONTACT_AGENT_PROMPT",
    "CONTACT_ENTITY_PROMPT",
    "CONTACT_IDENTITY_PROMPT",
    "COWORKER_SYSTEM_PROMPT",
    "EMAIL_BOT_SYSTEM_PROMPT",
    "INBOX_AGENT_PROMPT",
    "MONITORING_AGENT_PROMPT",
    "OMNICHANNEL_SUMMARY_PROMPT",
    "QUEUE_AGENT_PROMPT",
    "SUPPORT_BOT_SYSTEM_PROMPT",
    "TASK_AGENT_PROMPT",
    "build_coworker_system_prompt",
    "build_routing_instruction",
    "build_runtime_context_blocks",
]
