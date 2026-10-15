"""Session memory for custom_booxoo_bot."""

from __future__ import annotations

from typing import Any


class Memory:
    def __init__(self) -> None:
        self.memory: list[dict[str, Any]] = []

    def add_session_messages(self, message: dict | list[dict]) -> None:
        if isinstance(message, dict):
            self.memory.append(message)
        elif isinstance(message, list):
            self.memory.extend(message)
        else:
            raise ValueError("message must be a dict or list of dicts")

    def get_session_messages(self, num_convo: int | None = None) -> list[dict]:
        if not num_convo or len(self.memory) <= num_convo + 1:
            return list(self.memory)
        return self.memory[:1] + self.memory[-num_convo:]

    def clear_session(self, summary: dict) -> None:
        self.memory = [summary] + self.memory[-5:]

    def replace_history(self, messages: list[dict[str, Any]]) -> None:
        self.memory = list(messages)


class Session:
    def __init__(self) -> None:
        self.memory = Memory()
        self.authenticated = False
        self.registered_customer = False
        self.profile_created_here = False
        self.ticketing_verified = False
        self.contact: dict[str, str] = {}
        self.otp_code: str | None = None
        self.otp_channel: str | None = None
        self.otp_destination: str | None = None
        self.customer_profile: dict[str, Any] | None = None
        self.cdp_id: str | None = None
        self.contact_type: str = ""
        self.pending_contact_fields: dict[str, str] = {}
        self.profile_lookup_key: str | None = None
        self.customer_found = False
        self.selected_order_id: str | None = None
        self.selected_order: dict[str, Any] | None = None
        self.selected_product_id: str | None = None
        self.last_ticket: dict[str, Any] | None = None
        self.router = None
        self.channel = ""
        self.context_block: str | None = None
        self.context_block_key: str | None = None
        self.stored_emails: tuple[str, ...] = ()
        self.stored_phones: tuple[str, ...] = ()
        self.customer_lines: list[str] = []
        self.chat_card_loaded: bool = False
        self.active_agent: str = ""
        self.assistant_replied: bool = False


class SessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session | None:
        return self.sessions.get(session_id)

    def get_or_create(self, session_id: str) -> Session:
        session = self.sessions.get(session_id)
        if session is None:
            session = Session()
            self.sessions[session_id] = session
        return session

    def drop(self, session_id: str) -> None:
        self.sessions.pop(session_id, None)
