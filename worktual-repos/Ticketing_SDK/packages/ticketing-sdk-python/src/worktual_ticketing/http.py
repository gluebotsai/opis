"""JSON HTTP for the partner routes. A transport hook keeps tests off the network."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

from .errors import TicketingApiError, TicketingAuthError

LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]


def resolve_locale(explicit: str | None, fallback: str | None) -> str:
    raw = str(explicit or fallback or "en").strip()
    if not LOCALE_RE.fullmatch(raw):
        raise TicketingAuthError("locale must be a BCP 47 tag such as en or es-MX")
    return raw


def normalize_base_url(base_url: str) -> str:
    trimmed = str(base_url or "").strip().rstrip("/")
    if not trimmed:
        raise TicketingAuthError("baseUrl is required")
    return trimmed


def compact(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


COMPONENT_RE = re.compile(r"^[a-z0-9-]{1,64}$")


@dataclass
class TicketingConfig:
    base_url: str
    api_key: str = ""
    partner_api_key: str = ""
    access_token: str = ""
    locale: str = "en"
    surface: str = ""
    component: str = ""

    def partner_key(self) -> str:
        return (self.partner_api_key or self.api_key).strip()


def message_from_body(body: Any, status: int) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, str) and error.strip():
            return error
        message = body.get("message")
        if isinstance(message, str) and message.strip():
            return message
    if isinstance(body, str) and body.strip():
        return body
    return f"Ticketing API request failed ({status})"


class HttpClient:
    def __init__(self, config: TicketingConfig, transport: Transport | None = None) -> None:
        self.config = config
        self.transport = transport

    def auth_headers(self, mode: str, access_token: str | None) -> dict[str, str]:
        if mode == "none":
            return {}
        if mode in ("apiKey", "partnerKey"):
            key = self.config.partner_key() if mode == "partnerKey" else self.config.api_key.strip()
            if not key:
                if mode == "partnerKey":
                    raise TicketingAuthError(
                        "partnerApiKey or apiKey is required (org key wt_live_…). Do not use this key in a browser."
                    )
                raise TicketingAuthError(
                    "apiKey is required for this call (org key wt_live_…). Do not use this key in a browser."
                )
            return {"X-Api-Key": key}
        token = str(access_token or self.config.access_token or "").strip()
        if not token:
            raise TicketingAuthError(
                "accessToken is required for this call (staff or CRM JWT as Authorization Bearer)."
            )
        return {"Authorization": f"Bearer {token}"}

    def metering_headers(self) -> dict[str, str]:
        if self.config.surface != "ui":
            return {}
        headers = {"X-Worktual-Sdk-Surface": "ui"}
        component = str(self.config.component or "").strip().lower()
        if COMPONENT_RE.fullmatch(component):
            headers["X-Worktual-Sdk-Component"] = component
        return headers

    def request(
        self,
        *,
        method: str,
        path: str,
        auth: str,
        query: dict[str, Any] | None = None,
        body: Any = None,
        headers: dict[str, str] | None = None,
        access_token: str | None = None,
    ) -> Any:
        status, text = self._exchange(
            method=method,
            path=path,
            auth=auth,
            query=query,
            body=body,
            headers=headers,
            access_token=access_token,
        )
        parsed: Any = None
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = text
        if status < 200 or status >= 300:
            code = None
            if isinstance(parsed, dict) and isinstance(parsed.get("code"), str):
                code = parsed["code"]
            raise TicketingApiError(message_from_body(parsed, status), status, parsed, code)
        if status == 204:
            return None
        return parsed

    def request_text(
        self,
        *,
        method: str,
        path: str,
        auth: str,
        query: dict[str, Any] | None = None,
        body: Any = None,
        headers: dict[str, str] | None = None,
        access_token: str | None = None,
    ) -> str:
        status, text = self._exchange(
            method=method,
            path=path,
            auth=auth,
            query=query,
            body=body,
            headers=headers,
            access_token=access_token,
        )
        if status < 200 or status >= 300:
            parsed: Any = text
            try:
                parsed = json.loads(text) if text else None
            except json.JSONDecodeError:
                parsed = text
            code = parsed.get("code") if isinstance(parsed, dict) and isinstance(parsed.get("code"), str) else None
            raise TicketingApiError(message_from_body(parsed, status), status, parsed, code)
        return text

    def _exchange(
        self,
        *,
        method: str,
        path: str,
        auth: str,
        query: dict[str, Any] | None,
        body: Any,
        headers: dict[str, str] | None,
        access_token: str | None,
    ) -> tuple[int, str]:
        url = self.config.base_url + path
        if query:
            pairs = [
                (key, str(value))
                for key, value in query.items()
                if value is not None and value != ""
            ]
            if pairs:
                url += "?" + urllib.parse.urlencode(pairs, quote_via=urllib.parse.quote_plus)
        hdrs = {"Accept": "application/json"}
        hdrs.update(self.auth_headers(auth, access_token))
        hdrs.update(self.metering_headers())
        if headers:
            hdrs.update(headers)
        payload: bytes | None = None
        if body is not None:
            hdrs["Content-Type"] = "application/json"
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        status, raw = self._send(method, url, hdrs, payload)
        return status, raw.decode("utf-8") if raw else ""

    def _send(self, method: str, url: str, headers: dict[str, str], payload: bytes | None) -> tuple[int, bytes]:
        if self.transport is not None:
            return self.transport(method, url, headers, payload)
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()
