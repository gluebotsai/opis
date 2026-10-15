"""Ticketing client for custom_booxoo_bot."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings

_INTAKE_CHANNELS = {
    "email": "email",
    "webchat": "webchat",
    "chat": "webchat",
    "whatsapp": "whatsapp",
    "instagram": "instagram",
    "facebook": "facebook",
    "phone": "phone",
    "voice": "phone",
    "call": "phone",
    "sms": "phone",
}


class TicketingClient:
    @property
    def base_url(self) -> str:
        return get_settings().custom_booxoo_bot_ticketing_base_url.strip().rstrip("/")

    @property
    def api_key(self) -> str:
        return get_settings().custom_booxoo_bot_ticketing_api_key.strip()

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, body: dict) -> tuple[int, Any]:
        if not self.configured:
            return 0, {"error": "ticketing_not_configured"}
        try:
            response = httpx.post(
                f"{self.base_url}{path}",
                headers=self._headers(),
                json=body,
                timeout=20.0,
            )
        except httpx.HTTPError as exc:
            return 0, {"error": "ticketing_request_failed", "detail": str(exc)}
        try:
            payload = response.json() if response.content else {}
        except ValueError:
            payload = {"raw": response.text}
        return response.status_code, payload

    def verify_customer(self, email: str = "", mobile: str = "") -> tuple[int, Any]:
        body = {"email": email} if email else {"mobile": mobile}
        return self._post("/api/webchat/customers/verify", body)

    def create_ticket(
        self,
        name: str,
        issue: str,
        email: str = "",
        mobile: str = "",
        external_ref: str = "",
        metadata: dict | None = None,
        subject: str = "",
        references: list[dict] | None = None,
        attachments: list[str] | None = None,
        channel: str = "webchat",
        idempotency_key: str = "",
        category: str = "",
    ) -> tuple[int, Any]:
        channel_type = _INTAKE_CHANNELS.get(str(channel or "").strip().lower(), "webchat")
        body: dict[str, Any] = {
            "channel_type": channel_type,
            "name": name,
            "issue": issue,
            "metadata": metadata or {"source": "ccaas_bot"},
        }
        if subject:
            body["subject"] = subject
        if references:
            body["references"] = references
        if attachments:
            body["attachments"] = attachments
        if email:
            body["email"] = email
        if mobile:
            body["mobile"] = mobile
        if external_ref:
            body["externalRef"] = external_ref
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        if category:
            body["category"] = category
        return self._post("/api/intake/tickets", body)

    def lookup(self, email: str = "", mobile: str = "") -> tuple[int, Any]:
        body = {"email": email} if email else {"mobile": mobile}
        return self._post("/api/webchat/tickets/lookup", body)

    def search_articles(self, query: str) -> tuple[int, Any]:
        return self._post("/api/webchat/articles/search", {"query": query})
