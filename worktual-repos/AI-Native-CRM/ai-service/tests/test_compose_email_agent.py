"""Tests for compose-email agent heuristic + JSON helpers."""

from __future__ import annotations

import pytest

from app.agents.compose_email_agent import (
    extract_json,
    heuristic_compose,
    normalize_body_spacing,
    sanitize_email_closing,
    run,
)


def test_extract_json_plain():
    data = extract_json('{"subject":"Hello","body":"World"}')
    assert data == {"subject": "Hello", "body": "World"}


def test_extract_json_fenced():
    raw = """```json
{"subject": "Hi", "body": "There"}
```"""
    data = extract_json(raw)
    assert data == {"subject": "Hi", "body": "There"}


def test_extract_json_invalid():
    assert extract_json("not json") is None


def test_extract_json_literal_newlines_in_body():
    raw = '{\n  "subject": "Proposal follow-up",\n  "body": "Hi,\\n\\nThanks."\n}'
    assert extract_json(raw) == {
        "subject": "Proposal follow-up",
        "body": "Hi,\n\nThanks.",
    }
    broken = '{"subject":"Proposal follow-up","body":"Hi,\n\nThanks for the update."}'
    data = extract_json(broken)
    assert data is not None
    assert data["subject"] == "Proposal follow-up"
    assert "Thanks for the update" in data["body"]


def test_heuristic_proposal_followup_skips_broken_kb():
    subject, body = heuristic_compose(
        "CRM sends a follow-up email re-engaging the contact on the pending proposal.",
        contact_name="Saravanan",
        kb_context=(
            "are flagged as high-priority and routed to senior sales reps with a "
            "priority queue for same-day outreach."
        ),
        product_catalog="",
    )
    assert subject == "Proposal follow-up"
    assert "are flagged as high-priority" not in body
    assert "Here is a concise look at what we offer" not in body
    assert "status update" in body.lower() or "brief call" in body.lower()
    assert body.startswith("Hi Saravanan,")


def test_normalize_body_spacing_collapses_blanks():
    raw = "Hi,\n\n\n\nThanks for reaching out.\n\n\nBest regards,"
    out = normalize_body_spacing(raw)
    assert out == "Hi,\n\nThanks for reaching out.\n\nBest regards,"
    assert "\n\n\n" not in out


def test_sanitize_closing_strips_customer_support_team():
    body = (
        "Hi yaswanth,\n\n"
        "Thanks for your interest.\n\n"
        "Best regards,\n"
        "Zoho Support Team"
    )
    out = sanitize_email_closing(
        body,
        customer_company="Zoho",
        sender_organization="Worktual",
    )
    assert out.endswith("Best regards,")
    assert "Zoho" not in out
    assert "Support Team" not in out


def test_sanitize_closing_keeps_sender_org():
    body = "Hi,\n\nHello.\n\nBest regards,\nWorktual"
    out = sanitize_email_closing(
        body,
        customer_company="Zoho",
        sender_organization="Worktual",
    )
    assert out.endswith("Best regards,\nWorktual")


def test_heuristic_new_email_does_not_echo_prompt():
    prompt = "write a email askig his product interest"
    subject, body = heuristic_compose(
        prompt,
        contact_name="Manoj Sharma",
        company_name="Acme",
        is_reply=False,
    )
    assert "product" in subject.lower() or "asking" in subject.lower()
    assert "askig" not in subject.lower()
    assert prompt.lower() not in body.lower()
    assert "write a email" not in body.lower()
    assert body.startswith("Hi Manoj,")
    assert "\n\n\n" not in body
    assert "Best regards," in body


def test_heuristic_uses_kb_snippet():
    _, body = heuristic_compose(
        "explain about our products",
        contact_name=None,
        kb_context="Worktual Contact Center unifies voice, chat, and email for support teams.",
        product_catalog="",
    )
    assert "Worktual Contact Center" in body
    assert body.startswith("Hi,")
    assert "passage:" not in body.lower()


def test_heuristic_prefers_kb_over_catalog_pricing():
    subject, body = heuristic_compose(
        "write a mail to attract him about our products",
        contact_name="Manoj murugan",
        product_catalog=(
            "AI Native CRM: User license includes access for up to 10,000 contacts. ₹15,000 / user / month\n"
            "AI Native Ticketing System: ₹15,000 / user / month includes 2,000 tickets."
        ),
        kb_context=(
            "Worktual Contact Centre unifies voice, chat, and email across channels "
            "so teams can resolve customer issues faster."
        ),
    )
    assert "Contact Centre" in body or "contact centre" in body.lower()
    assert "₹" not in body
    assert "15,000" not in body
    assert "Attract him" not in subject
    assert body.startswith("Hi Manoj,")


def test_heuristic_catalog_names_only_when_kb_empty():
    _, body = heuristic_compose(
        "write a mail to attract him about our products",
        contact_name="Manoj murugan",
        product_catalog=(
            "AI Native CRM: ₹15,000 / user / month\n"
            "AI Native Contact Centre (CCaaS): Web, WhatsApp"
        ),
        kb_context="",
    )
    assert "AI Native CRM" in body
    assert "Contact Centre" in body or "CCaaS" in body
    assert "₹" not in body
    assert "15,000" not in body


def test_heuristic_strips_raw_kb_metadata():
    subject, body = heuristic_compose(
        "write a mail to attract him about our products",
        contact_name="Manoj murugan",
        product_catalog="",
        kb_context=(
            "Worktual Contact Centre unifies voice, chat, and email across channels "
            "so teams can resolve customer issues faster."
        ),
    )
    assert "passage:" not in body.lower()
    assert "Contact Centre" in body or "contact centre" in body.lower()
    assert "Attract him" not in subject
    assert "product" in subject.lower()
    assert body.startswith("Hi Manoj,")


def test_heuristic_reply_keeps_re_subject():
    subject, body = heuristic_compose(
        "Write a short professional reply",
        contact_name="Priya",
        subject="Pricing question",
        is_reply=True,
    )
    assert subject.lower().startswith("re:")
    assert "Priya" in body
    assert "Write a short professional reply" not in body


@pytest.mark.asyncio
async def test_run_heuristic_when_llm_off(monkeypatch):
    monkeypatch.setattr(
        "app.agents.compose_email_agent.is_ai_configured",
        lambda: False,
    )

    async def fake_kb(_q: str, limit: int = 4):
        return {
            "status": "success",
            "context": "Worktual CRM helps teams manage deals and inbox.",
        }

    monkeypatch.setattr(
        "app.agents.compose_email_agent.get_sales_knowledge",
        fake_kb,
    )
    # Clear cached graph so patched deps apply
    import app.agents.compose_email_agent as mod

    mod._GRAPH = None

    result = await run(
        instruction="explain about our products",
        contact_name="Ashika A",
        company_name="Worktual",
        is_reply=False,
        product_catalog="AI Native CRM\nAI Native Contact Centre (CCaaS)",
    )
    assert result["ok"] is True
    assert result["source"] == "heuristic"
    assert "₹" not in result["body"]
    # KB benefits preferred when available
    assert "Worktual CRM" in result["body"] or "AI Native" in result["body"]
    assert "\n\n\n" not in result["body"]


@pytest.mark.asyncio
async def test_run_uses_json_retries_before_heuristic(monkeypatch):
    monkeypatch.setattr(
        "app.agents.compose_email_agent.is_ai_configured",
        lambda: True,
    )

    async def fake_kb(*_a, **_k):
        return {"status": "success", "context": ""}

    monkeypatch.setattr(
        "app.agents.compose_email_agent.get_sales_knowledge",
        fake_kb,
    )

    async def fake_json(**_kwargs):
        return (
            {
                "subject": "Checking in on the proposal",
                "body": "Hi Saravanan,\n\nJust following up.\n\nBest regards,",
            },
            None,
        )

    monkeypatch.setattr(
        "app.agents.compose_email_agent.generate_json_with_retries",
        fake_json,
    )
    import app.agents.compose_email_agent as mod

    mod._GRAPH = None
    result = await run(
        instruction=(
            "CRM sends a follow-up email to saravanan123@gmail.com "
            "re-engaging the contact on the pending proposal."
        ),
        contact_name="Saravanan",
        is_reply=False,
    )
    assert result["ok"] is True
    assert result["source"] == "ai"
    assert result["subject"] == "Checking in on the proposal"
    assert "Hi Saravanan" in result["body"]
    assert result.get("kbUsed") is False


@pytest.mark.asyncio
async def test_run_requires_instruction():
    result = await run(instruction="   ")
    assert result["ok"] is False
    assert result["reason"] == "instruction_required"


@pytest.mark.asyncio
async def test_revision_gives_the_open_draft_to_the_model(monkeypatch):
    monkeypatch.setattr(
        "app.agents.compose_email_agent.is_ai_configured",
        lambda: True,
    )
    seen: dict[str, str] = {}

    async def fake_json(**kwargs):
        seen["system"] = kwargs["system"]
        seen["user"] = kwargs["user"]
        return (
            {
                "subject": "Feedback on Worktual",
                "body": "Hi Ashi,\n\nThe original note.\n\nBest regards,",
            },
            None,
        )

    monkeypatch.setattr(
        "app.agents.compose_email_agent.generate_json_with_retries",
        fake_json,
    )
    result = await run(
        instruction="add yaswanth345@gmail.com to the recipients",
        contact_name="Ashi",
        subject="Feedback on Worktual",
        current_body="Hi Ashi,\n\nThe original note.\n\nBest regards,",
    )
    assert "REVISION OF AN EXISTING EMAIL" in seen["system"]
    assert "CURRENT BODY" in seen["user"]
    assert "The original note." in seen["user"]
    assert result["ok"] is True
    assert result["subject"] == "Feedback on Worktual"
    assert result["source"] == "ai"
