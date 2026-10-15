"""Custom Booxoo support bot agent."""

from __future__ import annotations

import asyncio

from app.agents.custom_booxoo_bot.runner import (
    apply_automatic_contact_enrichment,
    run_booxoo_turn,
)
from app.agents.custom_lola_worktual.adapters.contact_context import (
    contact_profile_from_tenant,
)
from app.agents.support_bot import format_channel_reply
from app.agents.support_handoff import HandoffFields, resolve_handoff_fields
from app.config import get_settings
from app.llm.client import get_llm_client
from app.logging import get_logger
from app.schemas.bot import BotTurnResponse, ContactEntities
from app.services.contact_enrich_policy import (
    ContactProfileSnapshot,
    decide_contact_enrichment,
    format_contact_profile_block,
)
from app.services.contact_entity_extraction import extract_contact_entities_llm
from app.services.omnichannel_memory import (
    fetch_contact_omnichannel_memory,
    format_omnichannel_memory_lines,
)

logger = get_logger("nlp.custom_booxoo_bot")

TURN_FAILED_REPLY = "We're having a little trouble right now. Please try again shortly."


async def automatic_contact_enrichment_payload(
    *,
    message: str,
    transcript: list[dict] | None,
    channel: str,
    profile: ContactProfileSnapshot,
) -> dict[str, str] | None:
    """Use the default support bot's LLM extraction and safe enrichment policy."""
    entities = await extract_contact_entities_llm(
        get_llm_client(),
        message,
        transcript=transcript,
        channel=channel,
    )
    decision = decide_contact_enrichment(entities, profile)
    return dict(decision.payload) if decision.action == "call" and decision.payload else None


async def build_booxoo_trusted_context(
    *,
    organization_id: str,
    profile: ContactProfileSnapshot,
    tenant_context: dict,
) -> str:
    lines = [format_contact_profile_block(profile)]
    if profile.contact_id:
        omni_memory = await fetch_contact_omnichannel_memory(
            organization_id,
            profile.contact_id,
        )
        lines.extend(format_omnichannel_memory_lines(omni_memory))
    rolling_summary = tenant_context.get("rolling_summary")
    if isinstance(rolling_summary, str) and rolling_summary.strip():
        lines.append(f"Long-term conversation summary: {rolling_summary.strip()}")
    raw_facts = tenant_context.get("extracted_facts") or []
    if isinstance(raw_facts, str):
        raw_facts = [raw_facts]
    if isinstance(raw_facts, list):
        facts = [
            str(fact).strip()
            for fact in raw_facts
            if isinstance(fact, str) and str(fact).strip()
        ]
        if facts:
            lines.append("Known facts: " + "; ".join(facts[:20]))
    return "\n".join(lines)


def profile_from_enrichment_result(
    result: dict | None,
    fallback: ContactProfileSnapshot,
) -> ContactProfileSnapshot:
    if not isinstance(result, dict) or not isinstance(result.get("contact"), dict):
        return fallback
    contact = dict(result["contact"])
    contact.setdefault(
        "contactId",
        result.get("canonicalContactId") or result.get("canonical_contact_id"),
    )
    return ContactProfileSnapshot.from_mapping(contact)


def _entities_from_profile(profile: ContactProfileSnapshot) -> ContactEntities:
    return ContactEntities(
        email=profile.primary_email,
        phone=profile.primary_phone,
        first_name=profile.first_name,
        last_name=profile.last_name,
        company=profile.company,
        city=profile.city,
        country=profile.country,
    )


def _entities_from_contact(contact: dict, profile: ContactProfileSnapshot) -> ContactEntities:
    display_name = str(contact.get("name") or "").strip() or None
    return ContactEntities(
        email=str(contact.get("email") or "").strip() or profile.primary_email,
        phone=str(contact.get("phone") or "").strip() or profile.primary_phone,
        display_name=display_name,
        first_name=profile.first_name,
        last_name=profile.last_name,
        company=profile.company,
        city=profile.city,
        country=profile.country,
    )


class CustomBooxooBotAgent:
    async def run_turn(
        self,
        organization_id: str,
        conversation_id: str,
        message: str,
        channel: str = "webchat",
        tenant_context: dict | None = None,
        transcript: list[dict] | None = None,
    ) -> BotTurnResponse:
        tenant_context = dict(tenant_context or {})
        profile = ContactProfileSnapshot.from_mapping(
            contact_profile_from_tenant(tenant_context)
        )
        auto_contact_payload: dict[str, str] | None = None
        auto_contact_result: dict | None = None

        try:
            if tenant_context.get("session_opening"):
                auto_contact_payload = None
            else:
                auto_contact_payload = await automatic_contact_enrichment_payload(
                    message=message,
                    transcript=transcript,
                    channel=channel,
                    profile=profile,
                )
        except Exception:
            logger.warning("custom_booxoo_bot contact extraction failed", exc_info=True)

        if auto_contact_payload:
            try:
                auto_contact_result = await asyncio.to_thread(
                    apply_automatic_contact_enrichment,
                    organization_id=organization_id,
                    conversation_id=conversation_id,
                    channel=channel,
                    tenant_context=tenant_context,
                    profile=profile,
                    payload=auto_contact_payload,
                )
                profile = profile_from_enrichment_result(auto_contact_result, profile)
            except Exception:
                logger.warning("custom_booxoo_bot contact enrichment failed", exc_info=True)

        trusted_context = await build_booxoo_trusted_context(
            organization_id=organization_id,
            profile=profile,
            tenant_context=tenant_context,
        )

        try:
            result = await asyncio.to_thread(
                run_booxoo_turn,
                organization_id=organization_id,
                conversation_id=conversation_id,
                message=message,
                channel=channel,
                tenant_context=tenant_context,
                profile=profile,
                auto_contact_result=auto_contact_result,
                trusted_context=trusted_context,
                transcript=transcript,
            )
        except Exception:
            logger.exception("custom_booxoo_bot turn failed")
            return BotTurnResponse(
                reply=TURN_FAILED_REPLY,
                confidence=0.3,
                trace_id=f"booxoo:{conversation_id}",
                model_name=get_settings().custom_booxoo_bot_llm_model,
                contact_entities=_entities_from_profile(profile),
            )

        messages = result.get("messages") or []
        handoff = await resolve_handoff_fields(
            messages=messages,
            tenant_context=tenant_context,
            transcript=transcript,
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

        reply = format_channel_reply(str(result.get("reply") or ""), channel)
        if not reply.strip():
            logger.warning("custom_booxoo_bot produced an empty reply")
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
            trace_id=f"booxoo:{conversation_id}",
            model_name=get_settings().custom_booxoo_bot_llm_model,
        )
