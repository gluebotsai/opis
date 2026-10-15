"""Lola email bot. Separate from webchat: the From address is verified, and there is no OTP."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.custom_lola_worktual.adapters.contact_context import (
    contact_profile_from_tenant,
    ensure_session_long_term_summary,
)
from app.agents.custom_lola_worktual.runner import (
    merge_email_sender_profile,
    run_worktual_email_turn,
)
from app.agents.custom_lola_worktual.session import (
    set_session_contact_profile,
    set_turn_context,
    set_verified_contact,
)
from app.agents.support_bot import format_channel_reply
from app.agents.support_handoff import HandoffFields, resolve_handoff_fields
from app.config import get_settings
from app.logging import get_logger
from app.schemas.bot import BotTurnResponse, ContactEntities
from app.services.contact_enrich_policy import ContactProfileSnapshot

logger = get_logger("nlp.custom_lola_email_bot")

TURN_FAILED_REPLY = "We're having a little trouble right now. Please try again shortly."


class CustomLolaEmailAgent:
    async def run_turn(
        self,
        organization_id: str,
        conversation_id: str,
        message: str,
        channel: str = "email",
        tenant_context: dict[str, Any] | None = None,
        transcript: list[dict[str, Any]] | None = None,
    ) -> BotTurnResponse:
        tenant_context = dict(tenant_context or {})
        profile_map = merge_email_sender_profile(
            contact_profile_from_tenant(tenant_context),
            tenant_context,
        )
        tenant_context["contact_profile"] = profile_map
        set_session_contact_profile(conversation_id, profile_map)
        profile = ContactProfileSnapshot.from_mapping(profile_map)
        history = list(transcript or [])[-10:]

        try:
            tenant_context["_lola_long_term_summary"] = await ensure_session_long_term_summary(
                organization_id,
                conversation_id,
                profile,
                tenant_context,
            )
        except Exception:
            logger.exception("custom Lola email long-term summary failed")
            tenant_context["_lola_long_term_summary"] = "No information provided"

        set_turn_context(
            conversation_id,
            {
                "conversation_id": conversation_id,
                "organization_id": organization_id,
                "tenant_context": tenant_context,
                "channel": "email",
                "contact_profile": profile_map,
            },
        )
        if profile.contact_id or profile.primary_email or profile.primary_phone:
            set_verified_contact(
                conversation_id,
                {
                    "contact_id": profile.contact_id,
                    "email": profile.primary_email,
                    "mobile": profile.primary_phone,
                    "first_name": profile.first_name,
                },
            )

        try:
            result = await asyncio.to_thread(
                run_worktual_email_turn,
                organization_id=organization_id,
                conversation_id=conversation_id,
                message=message,
                tenant_context=tenant_context,
                transcript=history,
            )
        except Exception:
            logger.exception("custom_lola_email_bot turn failed")
            return BotTurnResponse(
                reply=TURN_FAILED_REPLY,
                confidence=0.3,
                trace_id=f"worktual-lola-email:{conversation_id}",
                model_name=get_settings().custom_lola_worktual_llm_model
                or get_settings().chat_openai_model,
                contact_entities=ContactEntities(
                    email=profile.primary_email,
                    phone=profile.primary_phone,
                    first_name=profile.first_name,
                    last_name=profile.last_name,
                ),
            )

        messages = result.get("messages") or []
        handoff = await resolve_handoff_fields(
            messages=messages,
            tenant_context=tenant_context,
            transcript=history,
            message=message,
        )
        if result.get("handoff_recommended"):
            handoff = HandoffFields(
                handoff_recommended=True,
                handoff_reason=handoff.handoff_reason or "explicit_request",
                intent="explicit_live_agent",
                selected_queue_key=handoff.selected_queue_key,
                candidate_skills=handoff.candidate_skills,
            )

        reply = format_channel_reply(str(result.get("reply") or ""), "email")
        if not reply.strip():
            logger.warning("custom_lola_email_bot produced an empty reply")
            reply = TURN_FAILED_REPLY

        return BotTurnResponse(
            reply=reply,
            confidence=0.9,
            intent=handoff.intent,
            handoff_recommended=handoff.handoff_recommended,
            handoff_reason=handoff.handoff_reason,
            selected_queue_key=handoff.selected_queue_key,
            candidate_skills=handoff.candidate_skills or [],
            contact_entities=ContactEntities(
                email=profile.primary_email,
                phone=profile.primary_phone,
                first_name=profile.first_name,
                last_name=profile.last_name,
                company=profile.company,
                city=profile.city,
                country=profile.country,
            ),
            trace_id=f"worktual-lola-email:{conversation_id}",
            model_name=get_settings().custom_lola_worktual_llm_model
            or get_settings().chat_openai_model,
        )
