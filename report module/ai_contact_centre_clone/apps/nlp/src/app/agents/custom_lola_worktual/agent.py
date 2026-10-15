"""Custom Lola Worktual support bot agent."""

from __future__ import annotations

from typing import Any

from app.agents.custom_lola_worktual.adapters.contact_context import (
    contact_profile_from_tenant,
    ensure_session_long_term_summary,
    merge_contact_profile_from_tenant,
    profile_mapping_from_snapshot,
)
from app.agents.custom_lola_worktual.llm import compose_contact_enrichment_reply
from app.agents.custom_lola_worktual.runner import run_worktual_turn
from app.agents.custom_lola_worktual.session import (
    get_session_contact_profile,
    get_turn_context,
    set_session_contact_profile,
    set_turn_context,
    set_verified_contact,
)
from app.agents.support_bot import format_channel_reply
from app.agents.support_handoff import HandoffFields, resolve_handoff_fields
from app.config import get_settings
from app.llm.client import get_llm_client
from app.logging import get_logger
from app.mcp.client import get_mcp_client
from app.schemas.bot import BotTurnResponse, ContactEntities
from app.schemas.copilot import ToolContext
from app.services.contact_enrich_policy import (
    ContactProfileSnapshot,
    decide_contact_enrichment,
    refresh_profile_from_tool_result,
)
from app.services.contact_entity_extraction import extract_contact_entities_llm

logger = get_logger("nlp.custom_lola_worktual")

_AFFIRMATIVE_REPLIES = {
    "yes",
    "yes please",
    "please do",
    "go ahead",
    "confirm",
    "confirmed",
    "correct",
    "replace it",
    "replace them",
}


def _entities_from_enrichment_payload(payload: dict[str, str]) -> ContactEntities:
    return ContactEntities(
        email=payload.get("email"),
        phone=payload.get("phone"),
        first_name=payload.get("firstName"),
        last_name=payload.get("lastName"),
        display_name=payload.get("displayName"),
        company=payload.get("company"),
        city=payload.get("city"),
        country=payload.get("country"),
    )


class CustomLolaWorktualAgent:
  def __init__(self) -> None:
      self._pending_enrichment: dict[str, dict[str, str]] = {}

  async def _enrich_contact(
      self,
      *,
      organization_id: str,
      conversation_id: str,
      channel: str,
      message: str,
      entities: ContactEntities,
      profile: ContactProfileSnapshot,
      tenant_context: dict[str, Any],
  ) -> tuple[dict[str, Any] | None, ContactProfileSnapshot]:
      pending = self._pending_enrichment.get(conversation_id)
      confirmed = bool(
          pending
          and message.strip().lower().rstrip(".!") in _AFFIRMATIVE_REPLIES
      )
      if confirmed and pending:
          entities = _entities_from_enrichment_payload(pending)

      decision = decide_contact_enrichment(
          entities,
          profile,
          confirmed=confirmed,
      )
      if decision.action != "call" or not decision.payload:
          return None, profile

      arguments: dict[str, Any] = dict(decision.payload)
      if confirmed:
          arguments["confirmedFields"] = list(decision.payload)
      enrichment_result = await get_mcp_client().call_tool(
          "contact",
          "contact_enrich",
          ToolContext(
              tenant_id=organization_id,
              role="agent",
              conversation_id=conversation_id,
              contact_id=profile.contact_id,
          ),
          arguments,
          agent_name="custom_lola_worktual",
          surface=channel,
      )
      nested = (
          enrichment_result.get("result")
          if isinstance(enrichment_result, dict)
          else None
      )
      requires_confirmation = (
          nested.get("requiresConfirmation")
          if isinstance(nested, dict)
          else []
      ) or []
      if requires_confirmation:
          self._pending_enrichment[conversation_id] = {
              field: decision.payload[field]
              for field in requires_confirmation
              if field in decision.payload
          }
      else:
          self._pending_enrichment.pop(conversation_id, None)

      refreshed, contact_id = refresh_profile_from_tool_result(enrichment_result)
      if refreshed:
          profile = refreshed
          tenant_context["contact_profile"] = profile_mapping_from_snapshot(refreshed)
          updated_context = get_turn_context(conversation_id)
          updated_context["contact_profile"] = tenant_context["contact_profile"]
          set_session_contact_profile(conversation_id, tenant_context["contact_profile"])
      if contact_id or refreshed:
          current = refreshed or profile
          set_verified_contact(
              conversation_id,
              {
                  "contact_id": contact_id or current.contact_id,
                  "email": current.primary_email,
                  "mobile": current.primary_phone,
                  "first_name": current.first_name,
              },
          )
      return enrichment_result, profile

  async def run_turn(
      self,
      organization_id: str,
      conversation_id: str,
      message: str,
      channel: str = "webchat",
      tenant_context: dict[str, Any] | None = None,
      transcript: list[dict[str, Any]] | None = None,
  ) -> BotTurnResponse:
      tenant_context = dict(tenant_context or {})
      cached_profile = get_session_contact_profile(conversation_id)
      if cached_profile:
          contact_profile = merge_contact_profile_from_tenant(cached_profile, tenant_context)
      else:
          contact_profile = contact_profile_from_tenant(tenant_context)
      set_session_contact_profile(conversation_id, contact_profile)
      tenant_context["contact_profile"] = contact_profile
      profile = ContactProfileSnapshot.from_mapping(contact_profile)
      contact_entities = ContactEntities()
      try:
          contact_entities = await extract_contact_entities_llm(
              get_llm_client(),
              message,
              transcript=transcript,
              channel=channel,
          )
      except Exception:
          logger.exception("custom Lola contact entity extraction failed")

      enrichment_result, profile = await self._enrich_contact(
          organization_id=organization_id,
          conversation_id=conversation_id,
          channel=channel,
          message=message,
          entities=contact_entities,
          profile=profile,
          tenant_context=tenant_context,
      )
      contact_profile = tenant_context.get("contact_profile")
      if isinstance(contact_profile, dict):
          set_session_contact_profile(conversation_id, contact_profile)
          profile = ContactProfileSnapshot.from_mapping(contact_profile)

      tenant_context["_lola_long_term_summary"] = await ensure_session_long_term_summary(
          organization_id,
          conversation_id,
          profile,
          tenant_context,
      )

      set_turn_context(
          conversation_id,
          {
              "conversation_id": conversation_id,
              "organization_id": organization_id,
              "tenant_context": tenant_context,
              "channel": channel,
              "contact_profile": tenant_context.get("contact_profile") or {},
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
          result = run_worktual_turn(
              organization_id=organization_id,
              conversation_id=conversation_id,
              message=message,
              tenant_context=tenant_context,
              channel=channel,
          )
      except Exception:
          logger.exception("custom_lola_worktual turn failed")
          return BotTurnResponse(
              reply="We're having a little trouble right now. Please try again shortly.",
              confidence=0.3,
              trace_id=f"worktual-lola:{conversation_id}",
              model_name=get_settings().custom_lola_worktual_llm_model
              or get_settings().chat_openai_model,
          )

      messages = result.get("messages") or []
      updated_context = get_turn_context(conversation_id)
      updated_profile = updated_context.get("contact_profile")
      if isinstance(updated_profile, dict):
          profile = ContactProfileSnapshot.from_mapping(updated_profile)
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
      if enrichment_result:
          reply = compose_contact_enrichment_reply(
              customer_message=message,
              draft_reply=reply,
              tool_result=enrichment_result,
          )
      if not reply.strip():
          reply = "How can I help you today?"

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
          trace_id=f"worktual-lola:{conversation_id}",
          model_name=get_settings().custom_lola_worktual_llm_model
          or get_settings().chat_openai_model,
      )
