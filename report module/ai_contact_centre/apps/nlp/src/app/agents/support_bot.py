"""Single SupportBotAgent implementation handling all customer channels."""

import json
import re
from html import unescape
from typing import Any

from app.agents.definitions import SUPPORT_BOT_DEFINITION
from app.agents.support_handoff import resolve_handoff_fields
from app.llm.client import get_llm_client
from app.logging import get_logger
from app.runtime.agent import Agent
from app.runtime.context import RunContext
from app.runtime.guardrails import redact_customer_pii
from app.runtime.memory import SessionMemory
from app.schemas.bot import BotTurnResponse, ContactEntities
from app.services.contact_enrich_policy import (
    ContactProfileSnapshot,
    contact_enrich_already_called,
    decide_contact_enrichment,
    format_contact_profile_block,
    refresh_profile_from_tool_result,
)
from app.services.contact_entity_extraction import extract_contact_entities_llm
from app.services.omnichannel_memory import (
    fetch_contact_omnichannel_memory,
    format_omnichannel_memory_lines,
)

logger = get_logger("nlp.support_bot")

HTML_TAG = re.compile(r"<[^>]+>")
CONTACT_METADATA_LEAK = re.compile(
    r"(?:\s*,?\s*contact\.(?:email|phone|first_name|last_name|display_name|city|country|company)=[^\s,]*)+",
    re.IGNORECASE,
)


def _log_support_bot(event: str, **fields: Any) -> None:
    logger.info(
        event,
        extra={
            "event": event,
            **{key: value for key, value in fields.items() if value is not None},
        },
    )


def _merge_contact_entities(
    primary: ContactEntities,
    secondary: ContactEntities | None,
) -> ContactEntities:
    if not secondary:
        return primary
    return ContactEntities(
        email=primary.email or secondary.email,
        phone=primary.phone or secondary.phone,
        first_name=primary.first_name or secondary.first_name,
        last_name=primary.last_name or secondary.last_name,
        display_name=primary.display_name or secondary.display_name,
        company=primary.company or secondary.company,
        city=primary.city or secondary.city,
        country=primary.country or secondary.country,
    )


def _parse_tool_arguments(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _contact_entities_from_tool_calls(messages: list[dict[str, Any]]) -> ContactEntities:
    merged = ContactEntities()
    for item in messages:
        for call in item.get("tool_calls") or []:
            function = call.get("function") or {}
            if str(function.get("name") or "") != "contact_enrich":
                continue
            args = _parse_tool_arguments(function.get("arguments"))
            merged = _merge_contact_entities(
                merged,
                ContactEntities(
                    email=args.get("email"),
                    phone=args.get("phone"),
                    first_name=args.get("firstName") or args.get("first_name"),
                    last_name=args.get("lastName") or args.get("last_name"),
                    display_name=args.get("displayName") or args.get("display_name"),
                    company=args.get("company"),
                    city=args.get("city"),
                    country=args.get("country"),
                ),
            )
    return merged


def _profile_from_tenant_context(tenant_context: dict[str, Any]) -> ContactProfileSnapshot:
    raw = tenant_context.get("contact_profile")
    if isinstance(raw, dict):
        return ContactProfileSnapshot.from_mapping(raw)
    raw_customer = tenant_context.get("customer")
    if isinstance(raw_customer, dict):
        contact = raw_customer.get("contact")
        if isinstance(contact, dict):
            return ContactProfileSnapshot.from_mapping(contact)
    return ContactProfileSnapshot()


def _important_facts_from_entities(entities: ContactEntities) -> list[str]:
    facts: list[str] = []
    if entities.email:
        facts.append(f"contact.email={entities.email}")
    if entities.phone:
        facts.append(f"contact.phone={entities.phone}")
    if entities.first_name:
        facts.append(f"contact.first_name={entities.first_name}")
    if entities.last_name:
        facts.append(f"contact.last_name={entities.last_name}")
    if entities.display_name:
        facts.append(f"contact.display_name={entities.display_name}")
    if entities.company:
        facts.append(f"contact.company={entities.company}")
    if entities.city:
        facts.append(f"contact.city={entities.city}")
    if entities.country:
        facts.append(f"contact.country={entities.country}")
    return facts


async def _apply_gated_contact_enrichment(
    agent: Agent,
    context: RunContext,
    channel: str,
    entities: ContactEntities,
    profile: ContactProfileSnapshot,
    *,
    messages: list[dict[str, Any]],
) -> tuple[ContactProfileSnapshot, Any | None, list[str]]:
    if contact_enrich_already_called(messages):
        _log_support_bot(
            "support_bot.contact_enrich_decision",
            tenant_id=context.tenant_id,
            conversation_id=context.conversation_id,
            channel=channel,
            decision="skip_tool_already_called",
        )
        return profile, None, []

    decision = decide_contact_enrichment(entities, profile)
    _log_support_bot(
        "support_bot.contact_enrich_decision",
        tenant_id=context.tenant_id,
        conversation_id=context.conversation_id,
        channel=channel,
        decision=decision.action,
        reason=decision.reason,
        fields=decision.fields,
        confirmation_fields=decision.confirmation_fields,
        contact_id=profile.contact_id,
    )
    if decision.action != "call" or not decision.payload:
        return profile, decision, []

    _log_support_bot(
        "support_bot.contact_enrich_called",
        tenant_id=context.tenant_id,
        conversation_id=context.conversation_id,
        channel=channel,
        fields=list(decision.payload.keys()),
        contact_id_before=profile.contact_id,
    )
    try:
        result = await agent.mcp_client.call_tool(
            "contact",
            "contact_enrich",
            agent.build_tool_context(context),
            decision.payload,
            agent_name=SUPPORT_BOT_DEFINITION.name,
            surface=channel,
        )
    except Exception:
        _log_support_bot(
            "support_bot.contact_enrich_failed",
            tenant_id=context.tenant_id,
            conversation_id=context.conversation_id,
            channel=channel,
        )
        logger.warning("contact enrichment apply failed", exc_info=True)
        return profile, decision, []

    nested = result.get("result") if isinstance(result, dict) else None
    outcome = nested.get("outcome") if isinstance(nested, dict) else None
    applied_fields = (
        nested.get("appliedFields") if isinstance(nested, dict) else []
    ) or []
    _log_support_bot(
        "support_bot.contact_enrich_result",
        tenant_id=context.tenant_id,
        conversation_id=context.conversation_id,
        channel=channel,
        outcome=outcome,
        canonical_contact_id=(
            nested.get("canonicalContactId") if isinstance(nested, dict) else None
        ),
        previous_contact_id=(
            nested.get("previousContactId") if isinstance(nested, dict) else None
        ),
        applied_fields=applied_fields,
        requires_confirmation=(
            nested.get("requiresConfirmation") if isinstance(nested, dict) else []
        ),
    )
    refreshed, contact_id = refresh_profile_from_tool_result(
        result if isinstance(result, dict) else None,
    )
    if contact_id:
        context.contact_id = contact_id
    if refreshed:
        _log_support_bot(
            "support_bot.contact_profile_refreshed",
            tenant_id=context.tenant_id,
            conversation_id=context.conversation_id,
            channel=channel,
            contact_id=refreshed.contact_id,
        )
        return refreshed, decision, applied_fields
    return profile, decision, applied_fields


def strip_contact_metadata_leaks(reply: str) -> str:
    cleaned = CONTACT_METADATA_LEAK.sub("", reply).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.rstrip(" ,.")


def format_channel_reply(reply: str, channel: str) -> str:
    cleaned = strip_contact_metadata_leaks(reply.strip())
    if channel in {"whatsapp", "instagram", "facebook", "social"}:
        cleaned = unescape(HTML_TAG.sub("", cleaned))
        cleaned = "\n".join(line.strip() for line in cleaned.splitlines() if line.strip())
        return cleaned[:1000]
    return cleaned


class SupportBotAgent:
    def __init__(self) -> None:
        self.definition = SUPPORT_BOT_DEFINITION
        self.agent = Agent(SUPPORT_BOT_DEFINITION)

    async def run_turn(
        self,
        organization_id: str,
        conversation_id: str,
        message: str,
        channel: str = "webchat",
        tenant_context: dict[str, Any] | None = None,
        transcript: list[dict[str, Any]] | None = None,
    ) -> BotTurnResponse:
        """Single run_turn loop for Webchat, WhatsApp, Instagram, Facebook, and Email."""
        pii = redact_customer_pii(message)
        norm_message = pii.text.strip()
        tenant_context = tenant_context or {}
        profile = _profile_from_tenant_context(tenant_context)

        _log_support_bot(
            "support_bot.turn_started",
            tenant_id=organization_id,
            conversation_id=conversation_id,
            channel=channel,
        )
        flags = profile.flags()
        _log_support_bot(
            "support_bot.contact_profile_loaded",
            tenant_id=organization_id,
            conversation_id=conversation_id,
            channel=channel,
            contact_id=profile.contact_id,
            has_email=flags["has_email"],
            has_phone=flags["has_phone"],
            has_name=flags["has_name"],
        )

        context = RunContext(
            tenant_id=organization_id,
            conversation_id=conversation_id,
            channel=channel,
            surface=channel,
            contact_id=profile.contact_id,
            extra={"tenant_context": tenant_context, "contact_profile": profile.__dict__},
        )

        contact_entities = ContactEntities()
        try:
            llm = get_llm_client()
            extracted = await extract_contact_entities_llm(
                llm,
                message,
                transcript=transcript,
                channel=channel,
            )
            contact_entities = _merge_contact_entities(contact_entities, extracted)
            detected = [
                name
                for name, value in contact_entities.model_dump().items()
                if isinstance(value, str) and value.strip()
            ]
            if detected:
                _log_support_bot(
                    "support_bot.entities_extracted",
                    tenant_id=organization_id,
                    conversation_id=conversation_id,
                    channel=channel,
                    fields_detected=detected,
                )
        except Exception:
            logger.warning("contact entity LLM extraction failed", exc_info=True)

        pre_enriched = False
        pre_enrich_decision = None
        pre_applied_fields: list[str] = []
        if contact_entities.phone or contact_entities.email:
            profile, pre_enrich_decision, pre_applied_fields = await _apply_gated_contact_enrichment(
                self.agent,
                context,
                channel,
                contact_entities,
                profile,
                messages=[],
            )
            pre_enriched = True
            context.contact_id = profile.contact_id
            context.extra["contact_profile"] = profile.__dict__

        memory = SessionMemory(conversation_id)
        context_lines: list[str] = [format_contact_profile_block(profile)]
        if profile.contact_id:
            omni_memory = await fetch_contact_omnichannel_memory(
                organization_id,
                profile.contact_id,
            )
            context_lines.extend(format_omnichannel_memory_lines(omni_memory))
        rolling_summary = tenant_context.get("rolling_summary")
        extracted_facts = tenant_context.get("extracted_facts") or []
        if isinstance(extracted_facts, str):
            extracted_facts = [extracted_facts]
        if isinstance(rolling_summary, str) and rolling_summary.strip():
            context_lines.append(f"Long-term conversation summary: {rolling_summary.strip()}")
        if extracted_facts:
            fact_lines = [
                str(fact).strip()
                for fact in extracted_facts
                if isinstance(fact, str) and str(fact).strip()
            ]
            if fact_lines:
                context_lines.append("Known facts: " + "; ".join(fact_lines[:20]))
        memory.add_message({"role": "system", "content": "\n".join(context_lines)})

        if transcript:
            for item in transcript[-10:]:
                role = str(item.get("role", "user")).strip().lower()
                if role in {"bot", "agent"}:
                    role = "assistant"
                elif role in {"customer", "visitor"}:
                    role = "user"
                memory.add_message({"role": role, "content": item.get("content", "")})
        result = await self.agent.run(
            [{"role": "user", "content": norm_message}],
            context,
            memory,
        )
        messages = result.get("messages", [])
        contact_entities = _merge_contact_entities(
            contact_entities,
            _contact_entities_from_tool_calls(messages),
        )
        profile, post_run_enrich_decision, post_run_applied_fields = (
            profile,
            pre_enrich_decision,
            pre_applied_fields,
        )
        if not pre_enriched:
            profile, post_run_enrich_decision, post_run_applied_fields = (
                await _apply_gated_contact_enrichment(
                    self.agent,
                    context,
                    channel,
                    contact_entities,
                    profile,
                    messages=messages,
                )
            )

        failed_run = result.get("response_type") in {
            "handoff_limit",
            "max_rounds",
            "routing_error",
        }
        reply = format_channel_reply(
            str(result.get("reply") or "How can I help you today?"),
            channel,
        )
        if (
            post_run_enrich_decision
            and post_run_enrich_decision.confirmation_fields
        ):
            updated_prefix = ""
            if post_run_applied_fields:
                updated_prefix = (
                    "I've updated your "
                    + ", ".join(post_run_applied_fields)
                    + ". "
                )
            confirmation_fields = post_run_enrich_decision.confirmation_fields
            conflict_fields = " and ".join(confirmation_fields)
            differs = "differs" if len(confirmation_fields) == 1 else "differ"
            replacement = "it" if len(confirmation_fields) == 1 else "them"
            reply = format_channel_reply(
                updated_prefix
                + f"The {conflict_fields} you provided {differs} from the value on file. "
                + f"Would you like me to replace {replacement}?",
                channel,
            )
        if failed_run and not reply.strip():
            reply = "I'm having a little trouble right now. Could you rephrase your question?"

        knowledge_used = []
        for item in messages:
            if item.get("role") != "tool":
                continue
            name = str(item.get("name") or "")
            if name in {"get_organization_details", "get_organization_knowledge"}:
                knowledge_used.append(name)
        important_facts = _important_facts_from_entities(contact_entities)

        handoff = await resolve_handoff_fields(
            messages=messages,
            tenant_context=tenant_context,
            transcript=transcript,
            message=norm_message,
        )
        intent = handoff.intent
        selected_queue_key = handoff.selected_queue_key
        candidate_skills = handoff.candidate_skills or []
        handoff_recommended = handoff.handoff_recommended
        handoff_reason = handoff.handoff_reason

        _log_support_bot(
            "support_bot.turn_completed",
            tenant_id=organization_id,
            conversation_id=conversation_id,
            channel=channel,
            contact_id_final=profile.contact_id,
            handoff_recommended=handoff_recommended,
        )

        return BotTurnResponse(
            reply=reply,
            confidence=0.5 if failed_run else 0.9,
            intent=intent,
            important_facts=important_facts,
            knowledge_used=knowledge_used,
            handoff_recommended=handoff_recommended,
            handoff_reason=handoff_reason,
            candidate_skills=candidate_skills,
            selected_queue_key=selected_queue_key,
            contact_entities=contact_entities,
            trace_id=f"bot-turn:{conversation_id}",
            model_name="worktual-minimax",
        )
