"""Auto-reply classify: routine product/help stays safe; finance/legal escalate."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from app.agents.auto_reply_email_agent import (
    PRODUCT_HELP_RE,
    _compose_system,
    _parse_preferred_dt,
    _support_signoff,
    customer_context_block,
    heuristic_classify,
    heuristic_kb_query,
    latest_inbound_text,
    should_retrieve_kb,
)


SIVAJI_QUESTION = (
    "which specific tool you provide to help my company in the sense of "
    "increase company growth"
)

QUOTED_THREAD = (
    f"{SIVAJI_QUESTION}\n\n"
    "On Sat, 8 Aug 2026 at 15:23, Yaswanth wrote:\n"
    "> Happy to share how our tools streamline processes. Could we book a\n"
    "> 15-minute chat? Our list price is on the pricing page.\n"
)


def test_latest_inbound_strips_gmail_quote():
    assert latest_inbound_text(QUOTED_THREAD) == SIVAJI_QUESTION
    assert latest_inbound_text({"body": QUOTED_THREAD}) == SIVAJI_QUESTION


def test_product_help_matches_growth_tools_question():
    assert PRODUCT_HELP_RE.search(SIVAJI_QUESTION)


def test_heuristic_ignores_demo_only_in_quote_or_subject():
    decision = heuristic_classify(
        {
            "subject": "Re: Product demo walkthrough",
            "body": (
                "Thanks for the update.\n\n"
                "On Sat, 8 Aug 2026, Yaswanth wrote:\n"
                "> Could we book a 15-minute demo?\n"
            ),
            "contactEmail": "sivaji@example.com",
        }
    )
    assert decision["decision"] == "safe_auto_reply"
    assert decision.get("category") == "general"


def test_heuristic_keeps_how_can_you_help_safe():
    decision = heuristic_classify(
        {
            "subject": "Re: Quick follow-up - Zendesk",
            "body": QUOTED_THREAD,
            "contactName": "Sivaji R",
            "contactEmail": "sivaji@example.com",
        }
    )
    assert decision["decision"] == "safe_auto_reply"
    assert decision.get("category") == "general"


def test_heuristic_escalates_explicit_quote_request():
    decision = heuristic_classify(
        {
            "subject": "Pricing",
            "body": "Please send me a quote for 50 seats.",
            "contactEmail": "buyer@example.com",
        }
    )
    assert decision["decision"] == "sensitive_escalate"
    assert decision.get("category") == "pricing"


def test_kb_only_when_implied_need_requires_it():
    assert should_retrieve_kb(SIVAJI_QUESTION)
    assert should_retrieve_kb("How can you help us work more efficiently?")
    assert not should_retrieve_kb("Thanks!")
    assert not should_retrieve_kb("Got it")
    assert not should_retrieve_kb("What's your office address?")


def test_kb_query_is_semantic_not_raw_email():
    q = heuristic_kb_query(SIVAJI_QUESTION, "AI Native CRM\nContact Centre")
    assert "which specific tool you provide" not in q.lower()
    assert "growth" in q.lower()
    assert "Worktual" in q
    assert "AI Native CRM" in q


def test_kb_query_includes_industry_and_title():
    q = heuristic_kb_query(
        SIVAJI_QUESTION,
        "AI Native CRM",
        industry="customer support software",
        title="Product Manager",
    )
    assert "customer support software" in q.lower()
    assert "product manager" in q.lower()


def test_customer_context_uses_lead_summary_and_enrichment():
    block = customer_context_block(
        {
            "contactName": "Sivaji R",
            "contactTitle": "Product Manager",
            "companyName": "Zendesk",
            "companyIndustry": "Customer support software",
            "leadHeadline": "Zendesk PM exploring CRM automation",
            "leadIntent": "evaluate Worktual for CX growth",
            "leadSummary": (
                "Sivaji is a Product Manager at Zendesk. Zendesk builds "
                "customer support and CX software. He is exploring how "
                "Worktual can help grow the business."
            ),
            "recommendedAction": "share product value then offer a demo",
            "enrichment": {
                "industry": "Customer support software",
                "companyDescription": (
                    "Zendesk builds customer service and engagement software "
                    "for support teams."
                ),
                "products": "Zendesk Support; Zendesk Chat",
                "companySize": "5000+",
                "geography": "United States",
                "seniorityTier": "manager",
            },
        }
    )
    assert "Sivaji R" in block
    assert "Zendesk" in block
    assert "Customer support software" in block
    assert "Zendesk builds customer support" in block
    assert "Zendesk Support" in block
    assert "What they do:" in block
    assert "do not invent" in block.lower()
    prompt = _compose_system(block)
    assert "lead summary" in prompt.lower()
    assert "Zendesk builds customer support" in prompt


def test_latest_inbound_strips_sync_headers_and_html():
    body = (
        "From: Sample <sample151102@gmail.com>\n"
        "To: yaswanthmg345 <yaswanthmg345@gmail.com>\n"
        "Cc: —\n\n"
        '<div dir="ltr">today 8 pm<div><br></div></div><br>'
        '<div class="gmail_quote gmail_quote_container">'
        '<div dir="ltr" class="gmail_attr">On Fri wrote:</div>'
    )
    assert latest_inbound_text(body) == "today 8 pm"
    decision = heuristic_classify(
        {
            "subject": "Re: Proposal",
            "body": body,
            "demoState": {"phase": "ask_slot", "proposedSlots": []},
            "timezone": "Asia/Kolkata",
        }
    )
    assert decision["decision"] == "safe_auto_reply"
    assert decision.get("category") == "demo_check_slot"
    assert decision.get("requestedStartIso")


def test_heuristic_recovers_demo_slot_after_llm_skip_shape():
    body = (
        "From: Sample <sample151102@gmail.com>\n"
        "To: rep@example.com\n\n"
        '<div dir="ltr">today 8 pm</div>'
    )
    ctx = {
        "subject": "Re: Proposal",
        "body": body,
        "demoState": {"phase": "ask_slot", "proposedSlots": []},
        "timezone": "Asia/Kolkata",
        "thread": [
            {
                "direction": "outbound",
                "body": "Could you share your preferred date and time for a demo?",
            }
        ],
    }
    guard = heuristic_classify(ctx)
    assert guard["decision"] == "safe_auto_reply"
    assert guard.get("category") == "demo_check_slot"
    assert guard.get("requestedStartIso")
    # Simulates LLM skip — guard must still win on open demo threads.
    llm_skip = {
        "decision": "skip",
        "category": "empty_input",
        "reason": "empty",
    }
    assert llm_skip["decision"] == "skip"
    assert guard["decision"] == "safe_auto_reply"


def test_interest_confirmation_is_not_confidential():
    body = (
        "Yes, I am interested.\n\n"
        "On Sat, 08 Aug 2026, 17:11, You wrote:\n"
        "> Worktual automatically captures customer data, scores leads,\n"
        "> and tracks financial metrics.\n"
    )
    assert latest_inbound_text(body) == "Yes, I am interested."
    decision = heuristic_classify(
        {
            "subject": "Re: Quick follow-up - Zendesk",
            "body": body,
            "contactEmail": "sivaji@example.com",
        }
    )
    assert decision["decision"] == "safe_auto_reply"
    assert decision.get("category") == "general"


def test_signoff_uses_sender_org_not_customer_company():
    text = _support_signoff(
        {
            "companyName": "Zendesk",
            "senderOrganizationName": "Worktual",
        }
    )
    assert "Zendesk" not in text
    assert "Support Team" not in text
    assert text == "Best regards,\nWorktual"


def test_parses_indian_dotted_demo_time():
    tz = "Asia/Kolkata"
    parsed = _parse_preferred_dt("tomorrow 6.5", tz)
    assert parsed is not None
    local = parsed.astimezone(ZoneInfo(tz))
    assert local.hour == 18
    assert local.minute == 30


def test_parses_dotted_445_pm_not_45_pm():
    tz = "Asia/Kolkata"
    parsed = _parse_preferred_dt("4.45 pm tomorrow", tz)
    assert parsed is not None
    local = parsed.astimezone(ZoneInfo(tz))
    assert local.hour == 16
    assert local.minute == 45


def test_yes_its_fine_confirms_outbound_demo_offer():
    decision = heuristic_classify(
        {
            "subject": "Re: Quick follow-up - Zendesk",
            "body": "Yes, it's fine.",
            "contactEmail": "sivaji@example.com",
            "companyName": "Zendesk",
            "senderOrganizationName": "Worktual",
            "thread": [
                {
                    "direction": "outbound",
                    "body": "Can I schedule a demo for tomorrow 6.18?",
                }
            ],
        }
    )
    assert decision["decision"] == "safe_auto_reply"
    assert decision.get("category") == "demo_confirm_slot"
    assert decision.get("chosenSlotIso")


def test_heuristic_escalates_legal_review():
    decision = heuristic_classify(
        {
            "subject": "MSA",
            "body": "Can your legal counsel review our MSA before we sign?",
            "contactEmail": "legal@example.com",
        }
    )
    assert decision["decision"] == "sensitive_escalate"
    assert decision.get("category") in {"legal", "contract"}


def test_heuristic_routes_follow_up_time_after_booked_demo():
    decision = heuristic_classify(
        {
            "subject": "Re: Need a meeting",
            "body": "7:15 PM today works for me.",
            "contactEmail": "lead@example.com",
            "timezone": "Asia/Kolkata",
            "demoState": {"phase": "booked", "mailboxUserId": "user-1"},
            "thread": [
                {
                    "direction": "outbound",
                    "body": "I will schedule our meeting for 6:00 PM today.",
                }
            ],
        }
    )
    assert decision["decision"] == "safe_auto_reply"
    assert decision.get("category") == "demo_check_slot"
    assert decision.get("requestedStartIso")


def test_schedule_our_meeting_counts_as_thread_demo_offer():
    decision = heuristic_classify(
        {
            "subject": "Re: Need a meeting",
            "body": "7:15 PM today",
            "contactEmail": "lead@example.com",
            "timezone": "Asia/Kolkata",
            "demoState": {"phase": "booked", "mailboxUserId": "user-1"},
            "thread": [
                {
                    "direction": "outbound",
                    "body": "Great — I will schedule our meeting for 6:00 PM today.",
                }
            ],
        }
    )
    assert decision.get("category") == "demo_check_slot"
