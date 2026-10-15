import pytest

from app.services.omnichannel_memory import (
    fetch_contact_omnichannel_memory,
    format_omnichannel_memory_lines,
)


def test_format_omnichannel_memory_lines_includes_omni_and_one_summary_per_channel():
    lines = format_omnichannel_memory_lines(
        {
            "omni_channel_summary": "Refund in progress; prefers WhatsApp.",
            "channel_items": [
                {"channel": "whatsapp", "summary": "Asked about order 4412"},
                {"channel": "whatsapp", "summary": "Older WhatsApp thread"},
                {"channel": "webchat", "summary": "Shared mobile number"},
            ],
        }
    )
    assert lines[0] == "Omni-channel summary: Refund in progress; prefers WhatsApp."
    assert "[whatsapp] Asked about order 4412" in lines
    assert "[webchat] Shared mobile number" in lines
    assert not any("Older WhatsApp thread" in line for line in lines)


@pytest.mark.asyncio
async def test_fetch_contact_omnichannel_memory_parses_core_payload(monkeypatch):
    async def fake_request(self, method, path, context, **_kwargs):
        assert method == "GET"
        assert path == "/internal/v1/contacts/cdp-1/channel-summaries"
        assert context.tenant_id == "1003"
        return {
            "channelSummaries": [{"channel": "whatsapp", "summary": "Asked about order 4412"}],
            "omniChannelSummary": "Refund in progress; prefers WhatsApp.",
        }

    monkeypatch.setattr(
        "app.services.omnichannel_memory.CcCoreHTTPAdapter.request",
        fake_request,
    )
    memory = await fetch_contact_omnichannel_memory("1003", "cdp-1")
    assert memory["omni_channel_summary"] == "Refund in progress; prefers WhatsApp."
    assert memory["channel_items"][0]["summary"] == "Asked about order 4412"
