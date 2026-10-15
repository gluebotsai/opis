"""Lola session rules: one OTP, fact card, and the 10-turn summary window."""

from app.agents.custom_lola_worktual.identity import send_session_otp, verify_session_otp
from app.agents.custom_lola_worktual.multi_agent import (
    AgentRouter,
    customer_visible_text,
    trim_session_history,
)
from app.agents.custom_lola_worktual.session_card import (
    LolaChatState,
    apply_lola_card,
    clear_chat_state,
    get_chat_state,
    lola_session_note,
)
from app.agents.custom_lola_worktual.tools import create_ticket


def test_one_otp_medium_covers_the_chat(monkeypatch) -> None:
    clear_chat_state("conv-otp")
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.identity.lookup_customer",
        lambda *_args, **_kwargs: {
            "found": True,
            "cdp_id": "CDP-1",
            "customer": {
                "name": "Ada",
                "email": "ada@worktual.in",
                "phone": "919876543210",
            },
        },
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.tools.send_otp_email",
        lambda *_args, **_kwargs: "success",
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.identity.save_lola_card",
        lambda *_args, **_kwargs: None,
    )

    sent = send_session_otp("conv-otp", option="email", email="ada@worktual.in")
    assert sent["sent"] is True
    code = get_chat_state("conv-otp").otp_code

    verified = verify_session_otp("conv-otp", code)
    assert verified["authenticated"] is True

    again = send_session_otp("conv-otp", option="mobile", mobile="919876543210")
    assert again["sent"] is False
    assert again["already_authenticated"] is True


def test_authenticated_chat_creates_an_intake_ticket(monkeypatch) -> None:
    clear_chat_state("conv-ticket")
    state = get_chat_state("conv-ticket")
    state.authenticated = True
    state.contact = {"name": "Ada", "email": "ada@worktual.in"}
    seen: dict = {}

    def fake_create_ticket(self, **kwargs):
        seen.update(kwargs)
        return 201, {"ticketNumber": "1701", "status": "Open", "channel": "Webchat"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.ticketing.TicketingClient.create_ticket",
        fake_create_ticket,
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.session_card.save_lola_card",
        lambda *_args, **_kwargs: None,
    )

    result = create_ticket("Login is failing", session_id="conv-ticket")

    assert result["data"]["ticketNumber"] == "1701"
    assert seen["channel"] == "webchat"
    assert seen["email"] == "ada@worktual.in"
    assert "priority" not in seen
    assert seen["idempotency_key"].startswith("conv-ticket:")


def test_card_restores_verification_and_specialist() -> None:
    state = LolaChatState()
    apply_lola_card(
        state,
        {
            "verified": True,
            "customer_found": True,
            "channel": "email",
            "destination": "ada@worktual.in",
            "active_agent": "ServiceAgent",
            "cdp_id": "CDP-1",
            "assistant_replied": True,
        },
    )
    assert state.authenticated is True
    assert state.otp_code == ""
    assert state.active_agent == "ServiceAgent"
    assert state.customer_found is True
    assert state.assistant_replied is True


def test_summary_keeps_the_last_ten_customer_turns(monkeypatch) -> None:
    def fake_summary(messages):
        older = "\n".join(item.get("content", "") for item in messages if item.get("role") == "user")
        assert "turn-0" in older
        assert "turn-10" not in older
        return {"role": "assistant", "content": "Earlier chat about a demo."}

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.multi_agent.summary_of_conversation",
        fake_summary,
    )
    messages = []
    for index in range(12):
        messages.append({"role": "user", "content": f"turn-{index}"})
        messages.append(
            {
                "role": "assistant",
                "tool_calls": [{"function": {"name": "GET_SALES_KNOWLEDGE", "arguments": "{}"}}],
            }
        )
        messages.append({"role": "tool", "name": "GET_SALES_KNOWLEDGE", "content": '{"status": "success"}'})
        messages.append({"role": "assistant", "content": f"reply-{index}"})

    trimmed = trim_session_history(messages)

    assert trimmed is not None
    assert trimmed[0]["content"] == "Earlier chat about a demo."
    kept_users = [item["content"] for item in trimmed if item.get("role") == "user"]
    assert kept_users == [f"turn-{index}" for index in range(2, 12)]
    assert len([item for item in trimmed if item.get("role") == "tool"]) == 10


def _route_payload(agent_name: str) -> dict:
    return {
        "content": None,
        "tool_calls": [
            {
                "id": "chatcmpl-tool-1",
                "function": {
                    "arguments": '{"agent_name": "%s", "query": "The customer wants to schedule a meeting for CRM."}'
                    % agent_name,
                    "name": "route_to_agent",
                },
                "type": "function",
            }
        ],
        "reasoning": None,
    }


class _ScriptedAgent:
    def __init__(self, name: str, results: list[dict]) -> None:
        self.name = name
        self.results = list(results)
        self.calls: list[dict] = []
        self.handoff_instruction = name
        self.system = [{"role": "system", "content": "You are Lola."}]

    def update_system(self, system) -> None:
        self.system = system

    def run(self, *_args, **kwargs):
        self.calls.append(kwargs)
        return self.results.pop(0)


def test_handoff_tool_call_is_not_the_customer_reply() -> None:
    from app.agents.custom_lola_worktual.memory import Memory

    leaked = {
        "response_type": "routing_response",
        "from": "SalesAgent",
        "response": _route_payload("SalesAgent"),
    }
    assert customer_visible_text(leaked) == ""
    assert "tool_calls" not in customer_visible_text(leaked)

    sales = _ScriptedAgent(
        "SalesAgent",
        [
            {
                "response_type": "routing_response",
                "from": "SalesAgent",
                "response": _route_payload("BookingAgent"),
            }
        ],
    )
    booking = _ScriptedAgent(
        "BookingAgent",
        [
            {
                "response_type": "general_response",
                "from": "BookingAgent",
                "response": "I can book that. What day and time work for you?",
            }
        ],
    )
    router = AgentRouter([sales, booking], Memory())
    result = router.execute("schedule a meeting", "", "", "", "conv", "", "", "", "", "", "", {})
    assert result["response"] == "I can book that. What day and time work for you?"
    assert "tool_calls" not in result["response"]
    assert router.current_agent.name == "BookingAgent"


def test_self_route_does_not_return_the_tool_payload() -> None:
    from app.agents.custom_lola_worktual.memory import Memory

    sales = _ScriptedAgent(
        "SalesAgent",
        [
            {
                "response_type": "routing_response",
                "from": "SalesAgent",
                "response": _route_payload("SalesAgent"),
            },
            {
                "response_type": "general_response",
                "from": "SalesAgent",
                "response": "I can help you schedule that. What day works?",
            },
        ],
    )
    router = AgentRouter([sales], Memory())
    result = router.execute("schedule a meeting", "", "", "", "conv", "", "", "", "", "", "", {})
    assert result["response"] == "I can help you schedule that. What day works?"
    assert sales.calls[-1]["allow_route"] is False
    assert "{" not in result["response"]


def test_customer_recognized_mid_chat_is_not_greeted_again() -> None:
    clear_chat_state("conv-greet")
    state = get_chat_state("conv-greet")
    state.assistant_replied = True
    note = lola_session_note("conv-greet", "Chandru")
    assert "Do not greet again." in note
    assert "where it stopped" in note
    assert "Chandru" in note

    state.recognized_greeting = True
    later = lola_session_note("conv-greet", "Chandru")
    assert "Do not greet again." in later


def test_known_customer_is_personalized_on_first_reply() -> None:
    clear_chat_state("conv-opening")
    note = lola_session_note("conv-opening", "Chandru")
    assert "first assistant reply" in note
    assert "local time of day" in note
    assert "latest past topic" in note
    assert "Chandru" in note
