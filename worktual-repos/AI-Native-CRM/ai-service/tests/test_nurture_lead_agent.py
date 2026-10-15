"""Nurture lead agent — compose context and guardrails."""

from __future__ import annotations

from app.agents.nurture_lead_agent import (
    _compose_user_payload,
    _decide_user_payload,
    _has_reachable_phone,
    _initial_voice_nurture_eligible,
    heuristic_decide,
    keep_phone_low_score_in_nurture,
)


def test_compose_user_payload_includes_summary_and_activities():
    payload = _compose_user_payload(
        {
            "firstName": "Nandhu",
            "displayName": "Nandhu Kumar",
            "email": "nandhu@grtjewellers.com",
            "title": "Operations Manager",
            "companyName": "GRT Jewellers",
            "industry": "Retail / Jewelry",
            "leadSummary": "Evaluating CRM for high-touch retail sales teams.",
            "leadHeadline": "Warm retail lead",
            "activities": [
                {
                    "type": "email",
                    "subject": "Interest in Worktual CRM",
                    "body": "We need better pipeline visibility across stores.",
                    "createdAt": "2026-09-01T10:00:00Z",
                }
            ],
            "deals": [{"title": "GRT rollout", "stage": "discover", "amount": "50000"}],
        }
    )
    assert "Nandhu" in payload
    assert "GRT Jewellers" in payload
    assert "Evaluating CRM" in payload
    assert "Interest in Worktual CRM" in payload
    assert "GRT rollout" in payload


def test_has_reachable_phone_requires_digits():
    assert _has_reachable_phone({"phone": "8883369379"}) is True
    assert _has_reachable_phone({"phone": None, "secondaryPhones": ["+91 88833 69379"]}) is True
    assert _has_reachable_phone({"phone": "123"}) is False


def test_initial_voice_nurture_eligible_for_new_lead_with_phone():
    ctx = {
        "leadStatus": "new",
        "contactType": "lead",
        "phone": "917358510871",
        "nurtureCallEnabled": True,
        "lastSentAt": None,
        "marketingOptOut": False,
        "ownerUserId": None,
    }
    assert _initial_voice_nurture_eligible(ctx) is True
    decided = heuristic_decide(ctx)
    assert decided["decision"] == "nurture_now"


def test_initial_voice_nurture_not_eligible_after_first_send():
    ctx = {
        "leadStatus": "new",
        "contactType": "lead",
        "phone": "917358510871",
        "nurtureCallEnabled": True,
        "lastSentAt": "2026-10-01T10:00:00Z",
        "marketingOptOut": False,
        "ownerUserId": None,
    }
    assert _initial_voice_nurture_eligible(ctx) is False


def test_low_score_with_phone_is_not_skipped():
    ctx = {
        "phone": "916883369379",
        "score": 18,
        "leadStatus": "new",
        "marketingOptOut": False,
        "lastSentAt": None,
        "notes": "",
        "activities": [],
    }
    kept = keep_phone_low_score_in_nurture(
        ctx,
        {
            "decision": "skip_not_interested",
            "score": 12,
            "rationale": "Score is too low to nurture.",
        },
    )
    assert kept["decision"] == "nurture_now"


def test_low_score_with_email_and_no_phone_is_not_skipped():
    ctx = {
        "email": "a@worktual.com",
        "phone": None,
        "score": 12,
        "leadStatus": "new",
        "marketingOptOut": False,
        "lastSentAt": None,
        "notes": "",
        "activities": [],
    }
    kept = keep_phone_low_score_in_nurture(
        ctx,
        {
            "decision": "skip_not_interested",
            "score": 8,
            "rationale": "Lead has no company or industry.",
        },
    )
    assert kept["decision"] == "nurture_now"


def test_opt_out_still_skips_when_phone_and_score_are_low():
    ctx = {
        "phone": "916883369379",
        "score": 18,
        "leadStatus": "new",
        "marketingOptOut": True,
        "notes": "",
        "activities": [],
    }
    kept = keep_phone_low_score_in_nurture(
        ctx,
        {"decision": "skip_not_interested", "score": 5, "rationale": "opt out"},
    )
    assert kept["decision"] == "skip_not_interested"


def test_decide_user_payload_flags_cold_lead_with_phone():
    payload = _decide_user_payload(
        {
            "displayName": "yaswanth M G",
            "title": "developer",
            "companyName": "Amazon",
            "leadStatus": "new",
            "contactType": "lead",
            "phone": "8883369379",
            "email": "yaswanthmg3455@gmail.com",
            "score": 0,
            "band": "cold",
            "nurtureCallEnabled": True,
            "daysSinceLastActivity": None,
            "lastSentAt": None,
        }
    )
    assert "Phone on file: yes" in payload
    assert "Voice nurture enabled for org: yes" in payload
    assert "Lead score: 0 band cold" in payload
    assert "below assign gate" in payload
    assert "nurture call" in payload.lower()
