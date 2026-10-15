import pytest

from app.agents.custom_lola_worktual.adapters.contact_context import (
    compose_long_term_summary_text,
    contact_profile_from_api,
    contact_profile_from_tenant,
    ensure_session_long_term_summary,
    fetch_contact_profile_for_turn,
    merge_contact_profile_from_tenant,
)
from app.agents.custom_lola_worktual.session import (
    clear_session_state,
    get_session_long_term_summary,
)
from app.services.contact_enrich_policy import ContactProfileSnapshot


def test_contact_profile_from_api_maps_cc_core_contact():
    profile = contact_profile_from_api(
        {
            "id": "CDP-webchat-org1003-visitor_abc",
            "firstName": "Santhosh",
            "lastName": "Saravanan",
            "primaryEmail": "sansanthosh965@gmail.com",
            "primaryPhone": "917339637136",
            "company": "Ziffo Tech",
        }
    )
    assert profile["contactId"] == "CDP-webchat-org1003-visitor_abc"
    assert profile["firstName"] == "Santhosh"
    assert profile["primaryEmail"] == "sansanthosh965@gmail.com"
    assert profile["company"] == "Ziffo Tech"


@pytest.mark.asyncio
async def test_fetch_contact_profile_for_turn_uses_state_contact(monkeypatch):
    async def fake_state(_organization_id: str, _conversation_id: str):
        return {
            "contact": {
                "id": "CDP-webchat-org1003-visitor_abc",
                "firstName": "Santhosh",
                "lastName": "Saravanan",
                "primaryEmail": "sansanthosh965@gmail.com",
            }
        }

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.adapters.contact_context.get_conversation_state",
        fake_state,
    )

    profile = await fetch_contact_profile_for_turn(
        "1003",
        "84978",
        {"contact_profile": {}},
    )
    assert profile["contactId"] == "CDP-webchat-org1003-visitor_abc"
    assert profile["firstName"] == "Santhosh"


def test_contact_profile_from_tenant_uses_chat_service_payload():
    profile = contact_profile_from_tenant(
        {
            "contact_profile": {
                "contactId": "CDP-webchat-org1003-visitor_abc",
                "firstName": "Santhosh",
            }
        }
    )
    assert profile["contactId"] == "CDP-webchat-org1003-visitor_abc"
    assert profile["firstName"] == "Santhosh"


def test_merge_contact_profile_adopts_linked_contact_id():
    merged = merge_contact_profile_from_tenant(
        {"firstName": "Santhosh"},
        {"contact_profile": {"contactId": "CDP-webchat-org1003-visitor_abc", "firstName": "Santhosh"}},
    )
    assert merged["contactId"] == "CDP-webchat-org1003-visitor_abc"
    assert merged["firstName"] == "Santhosh"


def test_compose_long_term_summary_includes_channel_items():
    profile = ContactProfileSnapshot(
        contact_id="CDP-webchat-org1003-visitor_abc",
        first_name="Santhosh",
        primary_email="ada@example.com",
    )
    summary = compose_long_term_summary_text(
        profile,
        [
            {
                "channel": "webchat",
                "summary": "Asked about pricing and had not selected a demo time.",
                "occurredAt": "2026-10-04T17:30:00Z",
                "sentiment": {
                    "customerLabel": "negative",
                    "customerRationale": "Customer was frustrated about the delay",
                },
            }
        ],
        {"omni_channel_summary": "Refund in progress; prefers WhatsApp."},
    )
    assert "Santhosh" in summary
    assert "Omni-channel summary: Refund in progress; prefers WhatsApp." in summary
    assert "Latest previous interaction [webchat]" in summary
    assert "had not selected a demo time" in summary
    assert "Previous session mood: negative" in summary
    assert "Customer was frustrated about the delay" in summary


@pytest.mark.asyncio
async def test_ensure_session_long_term_summary_fetches_once_per_contact(monkeypatch):
    clear_session_state("conv-cache")
    calls = {"count": 0}

    async def fake_fetch(_organization_id: str, _contact_id: str):
        calls["count"] += 1
        return {
            "omni_channel_summary": "Refund in progress; prefers WhatsApp.",
            "channel_items": [{"channel": "webchat", "summary": "Prior chat"}],
        }

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.adapters.contact_context.fetch_contact_omnichannel_memory",
        fake_fetch,
    )

    profile = ContactProfileSnapshot(contact_id="CDP-webchat-org1003-visitor_abc", first_name="Ada")
    tenant_context: dict = {}

    first = await ensure_session_long_term_summary("1003", "conv-cache", profile, tenant_context)
    second = await ensure_session_long_term_summary("1003", "conv-cache", profile, tenant_context)

    assert calls["count"] == 1
    assert first == second
    assert get_session_long_term_summary("conv-cache") == first
    assert "Latest previous interaction [webchat]: Prior chat" in first
    assert "Omni-channel summary: Refund in progress; prefers WhatsApp." in first
    assert tenant_context["omni_channel_summary"] == "Refund in progress; prefers WhatsApp."


@pytest.mark.asyncio
async def test_ensure_session_long_term_summary_refetches_when_contact_links(monkeypatch):
    clear_session_state("conv-link")
    calls = {"count": 0}

    async def fake_fetch(_organization_id: str, _contact_id: str):
        calls["count"] += 1
        return {
            "omni_channel_summary": None,
            "channel_items": [{"channel": "webchat", "summary": f"History {calls['count']}"}],
        }

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.adapters.contact_context.fetch_contact_omnichannel_memory",
        fake_fetch,
    )

    tenant_context: dict = {}
    anonymous = ContactProfileSnapshot(first_name="Ada")
    linked = ContactProfileSnapshot(contact_id="CDP-webchat-org1003-visitor_abc", first_name="Ada")

    first = await ensure_session_long_term_summary("1003", "conv-link", anonymous, tenant_context)
    second = await ensure_session_long_term_summary("1003", "conv-link", linked, tenant_context)

    assert calls["count"] == 1
    assert "History 1" in second
    assert first != second
    clear_session_state("conv-link")
