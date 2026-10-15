"""Booxoo email bot. Separate from the webchat bot: no OTP, one email, thread history."""

from __future__ import annotations

import asyncio

from app.agents.custom_booxoo_bot.agent import (
    TURN_FAILED_REPLY,
    _entities_from_contact,
    _entities_from_profile,
    automatic_contact_enrichment_payload,
    build_booxoo_trusted_context,
    profile_from_enrichment_result,
)
from app.agents.custom_booxoo_bot.runner import (
    apply_automatic_contact_enrichment,
    run_booxoo_email_turn,
)
from app.agents.custom_lola_worktual.adapters.contact_context import (
    contact_profile_from_tenant,
)
from app.agents.support_bot import format_channel_reply
from app.agents.support_handoff import HandoffFields, resolve_handoff_fields
from app.config import get_settings
from app.logging import get_logger
from app.schemas.bot import BotTurnResponse
from app.services.contact_enrich_policy import ContactProfileSnapshot

logger = get_logger("nlp.custom_booxoo_email_bot")


class CustomBooxooEmailAgent:
    async def run_turn(
        self,
        organization_id: str,
        conversation_id: str,
        message: str,
        channel: str = "email",
        tenant_context: dict | None = None,
        transcript: list[dict] | None = None,
    ) -> BotTurnResponse:
        tenant_context = dict(tenant_context or {})
        profile = ContactProfileSnapshot.from_mapping(
            contact_profile_from_tenant(tenant_context)
        )
        history = list(transcript or [])[-10:]
        auto_contact_payload: dict[str, str] | None = None
        auto_contact_result: dict | None = None

        try:
            auto_contact_payload = await automatic_contact_enrichment_payload(
                message=message,
                transcript=history,
                channel="email",
                profile=profile,
            )
        except Exception:
            logger.warning("custom_booxoo_email_bot contact extraction failed", exc_info=True)

        if auto_contact_payload:
            try:
                auto_contact_result = await asyncio.to_thread(
                    apply_automatic_contact_enrichment,
                    organization_id=organization_id,
                    conversation_id=conversation_id,
                    channel="email",
                    tenant_context=tenant_context,
                    profile=profile,
                    payload=auto_contact_payload,
                )
                profile = profile_from_enrichment_result(auto_contact_result, profile)
            except Exception:
                logger.warning("custom_booxoo_email_bot contact enrichment failed", exc_info=True)

        trusted_context = await build_booxoo_trusted_context(
            organization_id=organization_id,
            profile=profile,
            tenant_context=tenant_context,
        )

        try:
            result = await asyncio.to_thread(
                run_booxoo_email_turn,
                organization_id=organization_id,
                conversation_id=conversation_id,
                message=message,
                tenant_context=tenant_context,
                profile=profile,
                transcript=history,
                auto_contact_result=auto_contact_result,
                trusted_context=trusted_context,
            )
        except Exception:
            logger.exception("custom_booxoo_email_bot turn failed")
            return BotTurnResponse(
                reply=TURN_FAILED_REPLY,
                confidence=0.3,
                trace_id=f"booxoo-email:{conversation_id}",
                model_name=get_settings().custom_booxoo_bot_llm_model,
                contact_entities=_entities_from_profile(profile),
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
            logger.warning("custom_booxoo_email_bot produced an empty reply")
            reply = TURN_FAILED_REPLY

        return BotTurnResponse(
            reply=reply,
            confidence=0.9,
            intent=handoff.intent,
            handoff_recommended=handoff.handoff_recommended,
            handoff_reason=handoff.handoff_reason,
            selected_queue_key=handoff.selected_queue_key,
            candidate_skills=handoff.candidate_skills or [],
            contact_entities=_entities_from_contact(result.get("contact") or {}, profile),
            trace_id=f"booxoo-email:{conversation_id}",
            model_name=get_settings().custom_booxoo_bot_llm_model,
        )
