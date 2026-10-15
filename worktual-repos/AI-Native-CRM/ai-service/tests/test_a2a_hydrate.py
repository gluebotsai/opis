"""Hub payload hydration from CRM/CDP."""

from __future__ import annotations

from typing import Any

import pytest

from app.a2a.hydrate import extract_emails_from_text, hydrate_hub_payload


def test_extract_emails_from_instruction():
    text = "Send follow-up to saravanan123@gmail.com about the proposal."
    assert extract_emails_from_text(text) == ["saravanan123@gmail.com"]


@pytest.mark.asyncio
async def test_local_hydrate_instruction_from_description(monkeypatch):
    payload = {
        "organizationId": "1000",
        "description": "Score this lead and summarize.",
    }

    class Client:
        async def resolve_hub_payload(self, _body: dict[str, Any]) -> dict[str, Any]:
            return {"resolved": {}, "sources": {}}

    import app.crm_client as crm_client_mod

    monkeypatch.setattr(crm_client_mod, "CrmClient", lambda **_k: Client())
    monkeypatch.setattr("app.a2a.hydrate.log_a2a", lambda **_k: None)

    out = await hydrate_hub_payload(payload, organization_id="1000")
    assert out["instruction"] == "Score this lead and summarize."


@pytest.mark.asyncio
async def test_hydrate_applies_contact_from_api(monkeypatch):
    payload = {
        "organizationId": "1000",
        "instruction": "Send follow-up to saravanan123@gmail.com about the proposal.",
    }

    async def fake_resolve(body: dict[str, Any]) -> dict[str, Any]:
        assert "saravanan123@gmail.com" in (body.get("emails") or [])
        return {
            "resolved": {"contactId": "42"},
            "sources": {"contactId": "email"},
        }

    class Client:
        def __init__(self, organization_id: str | None = None) -> None:
            self.organization_id = organization_id

        async def resolve_hub_payload(self, body: dict[str, Any]) -> dict[str, Any]:
            return await fake_resolve(body)

    import app.crm_client as crm_client_mod

    monkeypatch.setattr(crm_client_mod, "CrmClient", Client)
    monkeypatch.setattr("app.a2a.hydrate.log_a2a", lambda **_k: None)

    out = await hydrate_hub_payload(payload, organization_id="1000")
    assert out["contactId"] == "42"
    assert out["cdpId"] == "42"


@pytest.mark.asyncio
async def test_hydrate_does_not_overwrite_existing_contact(monkeypatch):
    payload = {
        "organizationId": "1000",
        "cdpId": "99",
        "instruction": "Email saravanan123@gmail.com",
    }

    class Client:
        async def resolve_hub_payload(self, _body: dict[str, Any]) -> dict[str, Any]:
            return {
                "resolved": {"contactId": "42"},
                "sources": {"contactId": "email"},
            }

    import app.crm_client as crm_client_mod

    monkeypatch.setattr(crm_client_mod, "CrmClient", lambda **_k: Client())
    monkeypatch.setattr("app.a2a.hydrate.log_a2a", lambda **_k: None)

    out = await hydrate_hub_payload(payload, organization_id="1000")
    assert out["cdpId"] == "99"
    assert out.get("contact_id") in (None, "99") or out.get("contactId") in (None, "99")
