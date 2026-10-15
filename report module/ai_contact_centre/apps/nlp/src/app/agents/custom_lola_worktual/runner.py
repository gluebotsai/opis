"""Worktual Lola multi-agent runner."""

from __future__ import annotations

import copy
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.agents.custom_lola_worktual.email_prompts import (
    EMAIL_AGENT_TOOLS,
    EMAIL_BOOKING_PROMPT,
    EMAIL_SALES_PROMPT,
    EMAIL_SERVICE_PROMPT,
)
from app.agents.custom_lola_worktual.llm import get_worktual_llm
from app.agents.custom_lola_worktual.memory import Memory, SessionManager
from app.agents.custom_lola_worktual.multi_agent import Agent, AgentRouter, customer_visible_text
from app.agents.custom_lola_worktual.prompt_overlay import apply_social_overlay
from app.agents.custom_lola_worktual.prompts import (
    BOOKING_SYSTEM_PROMPT,
    SALES_SYSTEM_PROMPT,
    SERVICE_SYSTEM_PROMPT,
)
from app.agents.custom_lola_worktual.session import set_turn_context
from app.agents.custom_lola_worktual.tools import (
    BOOK_APPOINTMENT,
    CALENDAR_TOOL,
    CALL_BACK,
    CONTACT_ENRICH,
    CREATE_TICKET,
    GET_SALES_KNOWLEDGE,
    GET_TICKET_STATUS,
    LIVE_AGENT,
    RESCHEDULE_APPOINTMENT,
    SEND_OTP,
    VALIDATE_EMAIL,
    VALIDATE_PHONE_NUMBER,
    VERIFY_CONTACT_FOR_TICKET,
    VERIFY_OTP,
    WEB_SEARCH_TOOL,
    Tool,
    account_verification,
    book_appointment,
    calendar_tool,
    call_back,
    contact_enrich,
    create_ticket,
    get_conversation_summary,
    get_sales_knowledge,
    get_ticket_status,
    live_agent,
    reschedule_meeting,
    validate_email,
    validate_phone_number,
    verify_contact_for_ticket,
    verify_otp,
    websearch_tool,
)
from app.services.contact_enrich_policy import (
    ContactProfileSnapshot,
    format_contact_profile_block,
)

session_manager = SessionManager()
longterm_cache: dict[str, dict[str, int]] = {}

CONTACT_ENRICH_GUIDANCE = """

CONTACT PROFILE ENRICHMENT:
- The authoritative profile below is read-only context. Never invent missing values.
- Whenever the customer explicitly provides an email, phone, first name, last name,
  display name, company, city, or country, call contact_enrich before claiming it
  was saved. Send only values explicitly stated by the customer.
- If the authoritative profile already contains the same normalized value, do not
  call contact_enrich again.
- Read the structured tool response. Claim only appliedFields were saved.
- If a skipped field says this contact's email or phone was not changed because it belongs to another contact, say that. Do not say that when the customer is only telling you who they are.
- If the tool reports an error, respond naturally without claiming any field was saved.
- Never expose tool JSON, internal field names, IDs, or implementation details.
- You must write the customer-facing response yourself from the tool result. Do not
  use a fixed success or conflict message.
- Respond in plain text only. Never emit HTML tags such as <p>, <b>, <ul>, or <li>.
"""

COUNTRY_TIMEZONE_MAP = {
    "India": "Asia/Kolkata",
    "United States": "America/New_York",
    "Australia": "Australia/Sydney",
    "United Kingdom": "Europe/London",
    "Japan": "Asia/Tokyo",
    "Russia": "Europe/Moscow",
    "United Arab Emirates": "Asia/Dubai",
    "Germany": "Europe/Berlin",
    "South Africa": "Africa/Johannesburg",
}


def _build_contact_system_suffix(profile: ContactProfileSnapshot) -> str:
    return CONTACT_ENRICH_GUIDANCE + "\n" + format_contact_profile_block(profile)


def _refresh_router_contact_profile(
    router: AgentRouter,
    profile: ContactProfileSnapshot,
    conversation_id: str,
) -> None:
    from app.agents.custom_lola_worktual.session_card import lola_session_note

    suffix = _build_contact_system_suffix(profile)
    note = lola_session_note(
        conversation_id,
        " ".join(part for part in [profile.first_name, profile.last_name] if part),
    )
    routing = router.routing_instruction
    for agent in router.agents.values():
        base = getattr(agent, "_profile_free_system", "")
        if not base:
            continue
        agent.update_system(
            [
                {
                    "role": "system",
                    "content": f"{base}{suffix}\n\n{note}{routing}",
                }
            ]
        )


def get_time_by_country(country_name: str) -> tuple[str, str]:
    try:
        tz_name = COUNTRY_TIMEZONE_MAP.get(country_name, "Asia/Kolkata")
        country_time = datetime.now(ZoneInfo(tz_name))
        formatted_time = country_time.strftime("%A, %d %B %Y, %I:%M %p")
        return (
            f"Current time in {country_name} ({tz_name}): {formatted_time}",
            formatted_time,
        )
    except Exception:
        return "", ""


def setup_router(
    *,
    conversation_id: str,
    organization_id: str,
    tenant_context: dict[str, Any],
    channel: str,
    country_name: str = "India",
) -> tuple[AgentRouter, str]:
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

    from app.agents.custom_lola_worktual.session_card import ensure_lola_card_loaded

    state = ensure_lola_card_loaded(organization_id, conversation_id)
    profile = ContactProfileSnapshot.from_mapping(
        tenant_context.get("contact_profile") or {}
    )

    if session_manager.is_session_present(conversation_id):
        router = session_manager.get_router(conversation_id)
        _refresh_router_contact_profile(router, profile, conversation_id)
        if state.active_agent in router.agents:
            router.current_agent = router.agents[state.active_agent]
        _, formatted_time = get_time_by_country(country_name)
        return router, formatted_time

    current_date, formatted_time = get_time_by_country(country_name)
    longterm_memory = tenant_context.get("_lola_long_term_summary") or get_conversation_summary(
        organization_id, conversation_id, formatted_time
    )
    contact_context = _build_contact_system_suffix(profile)

    if conversation_id not in longterm_cache:
        longterm_cache[conversation_id] = {
            "islongterm": 0 if longterm_memory == "No information provided" else 1,
        }

    sales_prompt = apply_social_overlay(
        SALES_SYSTEM_PROMPT.format(current_date=current_date, long_term_summary=longterm_memory)
        + contact_context,
        channel,
    )
    service_prompt = apply_social_overlay(
        SERVICE_SYSTEM_PROMPT.format(current_date=current_date, long_term_summary=longterm_memory)
        + contact_context,
        channel,
    )
    booking_prompt = apply_social_overlay(
        BOOKING_SYSTEM_PROMPT.format(current_date=current_date, long_term_summary=longterm_memory)
        + contact_context,
        channel,
    )

    llm = get_worktual_llm()
    live_agent_tool = Tool(LIVE_AGENT, live_agent)
    call_back_tool = Tool(CALL_BACK, call_back)
    contact_enrich_tool = Tool(CONTACT_ENRICH, contact_enrich)

    sales_agent = Agent(
        name="SalesAgent",
        system=sales_prompt,
        tools=[
            Tool(GET_SALES_KNOWLEDGE, get_sales_knowledge),
            Tool(WEB_SEARCH_TOOL, websearch_tool),
            contact_enrich_tool,
            live_agent_tool,
            call_back_tool,
        ],
        llm=llm,
        handoff_instruction=(
            "Discovers what the customer needs, then recommends a Worktual product. "
            "Does not book or open tickets."
        ),
    )
    sales_agent._profile_free_system = apply_social_overlay(
        SALES_SYSTEM_PROMPT.format(current_date=current_date, long_term_summary=longterm_memory),
        channel,
    )
    booking_agent = Agent(
        name="BookingAgent",
        system=booking_prompt,
        tools=[
            Tool(VALIDATE_PHONE_NUMBER, validate_phone_number),
            Tool(VALIDATE_EMAIL, validate_email),
            Tool(CALENDAR_TOOL, calendar_tool),
            Tool(BOOK_APPOINTMENT, book_appointment),
            Tool(RESCHEDULE_APPOINTMENT, reschedule_meeting),
            contact_enrich_tool,
            live_agent_tool,
            call_back_tool,
        ],
        llm=llm,
        handoff_instruction="Collects and validates booking details, then books or reschedules. Does not sell or troubleshoot.",
    )
    booking_agent._profile_free_system = apply_social_overlay(
        BOOKING_SYSTEM_PROMPT.format(current_date=current_date, long_term_summary=longterm_memory),
        channel,
    )
    service_agent = Agent(
        name="ServiceAgent",
        system=service_prompt,
        tools=[
            Tool(VALIDATE_EMAIL, validate_email),
            Tool(VERIFY_CONTACT_FOR_TICKET, verify_contact_for_ticket),
            Tool(SEND_OTP, account_verification),
            Tool(VERIFY_OTP, verify_otp),
            Tool(CREATE_TICKET, create_ticket),
            Tool(GET_TICKET_STATUS, get_ticket_status),
            contact_enrich_tool,
            live_agent_tool,
            call_back_tool,
        ],
        llm=llm,
        handoff_instruction="Handles support issues by offering a ticket after one verification.",
    )
    service_agent._profile_free_system = apply_social_overlay(
        SERVICE_SYSTEM_PROMPT.format(current_date=current_date, long_term_summary=longterm_memory),
        channel,
    )

    agent_router = AgentRouter(
        agents=[sales_agent, service_agent, booking_agent],
        memory=Memory(),
    )
    router = session_manager.create_router(conversation_id, agent_router)
    _refresh_router_contact_profile(router, profile, conversation_id)
    if state.active_agent in router.agents:
        router.current_agent = router.agents[state.active_agent]
    return router, formatted_time


def run_worktual_turn(
    *,
    organization_id: str,
    conversation_id: str,
    message: str,
    tenant_context: dict[str, Any],
    channel: str,
) -> dict[str, Any]:
    country = str(tenant_context.get("primaryLocation") or tenant_context.get("country") or "India")
    if "," in country:
        country = country.split(",")[-1].strip()

    from app.agents.custom_lola_worktual.session_card import (
        get_chat_state,
        remember_customer_line,
        save_lola_card,
    )

    remember_customer_line(conversation_id, message)
    router, formatted_time = setup_router(
        conversation_id=conversation_id,
        organization_id=organization_id,
        tenant_context=tenant_context,
        channel=channel,
        country_name=country or "India",
    )

    result = router.execute(
        message,
        "",
        "",
        "",
        conversation_id,
        "",
        "",
        conversation_id,
        "",
        organization_id,
        formatted_time,
        longterm_cache,
    )
    response = customer_visible_text(result if isinstance(result, dict) else {})
    state = get_chat_state(conversation_id)
    state.active_agent = router.current_agent.name
    if response.strip():
        state.assistant_replied = True
        profile = ContactProfileSnapshot.from_mapping(
            tenant_context.get("contact_profile") or {}
        )
        if profile.first_name or profile.last_name:
            state.recognized_greeting = True
    save_lola_card(organization_id, conversation_id, state)
    return {
        "reply": response,
        "handoff_recommended": bool(result.get("handoff_recommended")),
        "messages": router.memory.get_session_messages(),
        "from_agent": result.get("from"),
    }


EMAIL_HISTORY_LIMIT = 10
EMAIL_CREATE_TICKET_DESCRIPTION = (
    "Open a ticket for this email. The From address is already verified. "
    "Do not request an OTP or another code. Do not send priority."
)
EMAIL_TICKET_STATUS_DESCRIPTION = (
    "Look up this sender's tickets. The From address is already verified. Do not ask for a code."
)


def email_router_key(conversation_id: str) -> str:
    return f"email:{conversation_id}"


def merge_email_sender_profile(
    profile: dict[str, Any],
    tenant_context: dict[str, Any],
) -> dict[str, Any]:
    """Fill a missing name or email from the verified From header."""
    merged = dict(profile)
    sender_email = str(tenant_context.get("sender_email") or "").strip()
    if sender_email and not any(merged.get(key) for key in ("primaryEmail", "primary_email", "email")):
        merged["primaryEmail"] = sender_email
    sender_name = str(tenant_context.get("sender_name") or "").strip()
    has_name = any(merged.get(key) for key in ("firstName", "first_name", "lastName", "last_name"))
    if sender_name and "@" not in sender_name and not has_name:
        parts = sender_name.split()
        merged["firstName"] = parts[0]
        if len(parts) > 1:
            merged["lastName"] = " ".join(parts[1:])
    return merged


def _schema_with_description(schema: dict[str, Any], description: str) -> dict[str, Any]:
    updated = copy.deepcopy(schema)
    updated["function"]["description"] = description
    return updated


def _email_tool(name: str, shared: dict[str, Tool]) -> Tool:
    if name in shared:
        return shared[name]
    builders = {
        "GET_SALES_KNOWLEDGE": (GET_SALES_KNOWLEDGE, get_sales_knowledge),
        "VALIDATE_PHONE_NUMBER": (VALIDATE_PHONE_NUMBER, validate_phone_number),
        "VALIDATE_EMAIL": (VALIDATE_EMAIL, validate_email),
        "CALENDAR_TOOL": (CALENDAR_TOOL, calendar_tool),
        "BOOK_APPOINTMENT": (BOOK_APPOINTMENT, book_appointment),
        "RESCHEDULE_APPOINTMENT": (RESCHEDULE_APPOINTMENT, reschedule_meeting),
        "CREATE_TICKET": (
            _schema_with_description(CREATE_TICKET, EMAIL_CREATE_TICKET_DESCRIPTION),
            create_ticket,
        ),
        "GET_TICKET_STATUS": (
            _schema_with_description(GET_TICKET_STATUS, EMAIL_TICKET_STATUS_DESCRIPTION),
            get_ticket_status,
        ),
    }
    schema, function = builders[name]
    return Tool(schema, function)


def _prior_email_history(
    transcript: list[dict[str, Any]] | None,
    current_message: str,
) -> list[dict[str, str]]:
    items = list(transcript or [])[-EMAIL_HISTORY_LIMIT:]
    if items:
        last = items[-1]
        content = str(last.get("content") or "").strip()
        role = str(last.get("role") or "").strip().lower()
        if role in {"customer", "user", "visitor"} and content and content in current_message:
            items = items[:-1]
    history: list[dict[str, str]] = []
    for item in items[-EMAIL_HISTORY_LIMIT:]:
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        role = str(item.get("role") or "user").strip().lower()
        history.append(
            {
                "role": "assistant" if role in {"bot", "agent", "assistant"} else "user",
                "content": content,
            }
        )
    return history


def _transcript_has_assistant_reply(transcript: list[dict[str, Any]] | None) -> bool:
    for item in transcript or []:
        role = str(item.get("role") or "").strip().lower()
        if role in {"assistant", "bot", "agent"} and str(item.get("content") or "").strip():
            return True
    return False


def setup_email_router(
    *,
    conversation_id: str,
    organization_id: str,
    tenant_context: dict[str, Any],
    country_name: str = "India",
) -> tuple[AgentRouter, str]:
    """Email specialists only. This does not change the chat router or its tools."""
    set_turn_context(
        conversation_id,
        {
            "conversation_id": conversation_id,
            "organization_id": organization_id,
            "tenant_context": tenant_context,
            "channel": "email",
            "contact_profile": tenant_context.get("contact_profile") or {},
        },
    )

    from app.agents.custom_lola_worktual.session_card import ensure_lola_card_loaded

    state = ensure_lola_card_loaded(organization_id, conversation_id)
    profile = ContactProfileSnapshot.from_mapping(tenant_context.get("contact_profile") or {})
    router_key = email_router_key(conversation_id)

    if session_manager.is_session_present(router_key):
        router = session_manager.get_router(router_key)
        _refresh_router_contact_profile(router, profile, conversation_id)
        if state.active_agent in router.agents:
            router.current_agent = router.agents[state.active_agent]
        _, formatted_time = get_time_by_country(country_name)
        return router, formatted_time

    current_date, formatted_time = get_time_by_country(country_name)
    longterm_memory = str(tenant_context.get("_lola_long_term_summary") or "No information provided")
    longterm_memory = longterm_memory.replace("{", "(").replace("}", ")")
    contact_context = _build_contact_system_suffix(profile)
    prompt_values = {"current_date": current_date, "long_term_summary": longterm_memory}
    prompts = {
        "SalesAgent": EMAIL_SALES_PROMPT.format(**prompt_values),
        "BookingAgent": EMAIL_BOOKING_PROMPT.format(**prompt_values),
        "ServiceAgent": EMAIL_SERVICE_PROMPT.format(**prompt_values),
    }

    llm = get_worktual_llm()
    shared = {
        "contact_enrich": Tool(CONTACT_ENRICH, contact_enrich),
        "LIVE_AGENT": Tool(LIVE_AGENT, live_agent),
    }
    handoffs = {
        "SalesAgent": (
            "Discovers what the customer needs, then recommends a Worktual product. "
            "Does not book, open tickets, or cancel appointments."
        ),
        "BookingAgent": (
            "Collects and validates booking details, then books or reschedules. "
            "Cannot cancel an appointment by email."
        ),
        "ServiceAgent": (
            "Troubleshoots by offering a ticket for the verified sender. "
            "Does not cancel appointments."
        ),
    }
    agents = []
    for name in ("SalesAgent", "BookingAgent", "ServiceAgent"):
        agent = Agent(
            name=name,
            system=prompts[name] + contact_context,
            tools=[_email_tool(tool_name, shared) for tool_name in EMAIL_AGENT_TOOLS[name]],
            llm=llm,
            handoff_instruction=handoffs[name],
        )
        agent._profile_free_system = prompts[name]
        agents.append(agent)

    agent_router = AgentRouter(agents=agents, memory=Memory())
    router = session_manager.create_router(router_key, agent_router)
    _refresh_router_contact_profile(router, profile, conversation_id)
    if state.active_agent in router.agents:
        router.current_agent = router.agents[state.active_agent]
    return router, formatted_time


def run_worktual_email_turn(
    *,
    organization_id: str,
    conversation_id: str,
    message: str,
    tenant_context: dict[str, Any],
    transcript: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from app.agents.custom_lola_worktual.session_card import (
        get_chat_state,
        mark_email_sender_verified,
        remember_customer_line,
        save_lola_card,
    )

    profile = ContactProfileSnapshot.from_mapping(tenant_context.get("contact_profile") or {})
    sender_email = str(tenant_context.get("sender_email") or profile.primary_email or "").strip()
    sender_name = str(tenant_context.get("sender_name") or "").strip()
    if not sender_name:
        sender_name = " ".join(part for part in [profile.first_name, profile.last_name] if part)
    mark_email_sender_verified(organization_id, conversation_id, sender_email, sender_name)

    state = get_chat_state(conversation_id)
    if _transcript_has_assistant_reply(transcript):
        state.assistant_replied = True

    country = profile.country or str(
        tenant_context.get("primaryLocation") or tenant_context.get("country") or "India"
    )
    if "," in country:
        country = country.split(",")[-1].strip()

    remember_customer_line(conversation_id, message)
    router, formatted_time = setup_email_router(
        conversation_id=conversation_id,
        organization_id=organization_id,
        tenant_context=tenant_context,
        country_name=country or "India",
    )
    history = _prior_email_history(transcript, message)
    router.memory.clear_session()
    if history:
        router.memory.add_session_messages(history)
    kind = (
        "This is a reply on an existing email thread."
        if history
        else "This is a new email. There is no earlier message on this thread."
    )
    result = router.execute(
        f"{kind}\n\n{message}",
        "",
        "",
        "",
        conversation_id,
        "",
        "",
        conversation_id,
        "",
        organization_id,
        formatted_time,
        longterm_cache,
    )
    response = customer_visible_text(result if isinstance(result, dict) else {})
    state = get_chat_state(conversation_id)
    state.active_agent = router.current_agent.name
    if response.strip():
        state.assistant_replied = True
        if profile.first_name or profile.last_name or sender_name:
            state.recognized_greeting = True
    save_lola_card(organization_id, conversation_id, state)
    return {
        "reply": response,
        "handoff_recommended": bool(result.get("handoff_recommended")),
        "messages": router.memory.get_session_messages(),
        "from_agent": result.get("from"),
    }
