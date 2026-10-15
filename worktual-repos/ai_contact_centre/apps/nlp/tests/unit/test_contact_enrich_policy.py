from app.schemas.bot import ContactEntities
from app.services.contact_enrich_policy import (
    ContactProfileSnapshot,
    decide_contact_enrichment,
    format_contact_profile_block,
)


def test_decide_enrich_when_profile_missing_email() -> None:
    profile = ContactProfileSnapshot(
        contact_id="1",
        first_name="Zara",
        primary_email=None,
    )
    decision = decide_contact_enrichment(
        ContactEntities(email="test@example.com"),
        profile,
    )
    assert decision.action == "call"
    assert decision.payload == {"email": "test@example.com"}


def test_decide_skip_when_email_matches_profile() -> None:
    profile = ContactProfileSnapshot(contact_id="1", primary_email="test@example.com")
    decision = decide_contact_enrichment(
        ContactEntities(email="test@example.com"),
        profile,
    )
    assert decision.action == "skip_match"


def test_decide_needs_confirmation_on_mismatch() -> None:
    profile = ContactProfileSnapshot(contact_id="1", primary_email="old@example.com")
    decision = decide_contact_enrichment(
        ContactEntities(email="new@example.com"),
        profile,
    )
    assert decision.action == "call"
    assert decision.payload == {"email": "new@example.com"}
    assert decision.confirmation_fields == ["email"]


def test_decide_applies_empty_phone_while_email_needs_confirmation() -> None:
    profile = ContactProfileSnapshot(
        contact_id="1",
        primary_email="old@example.com",
        primary_phone=None,
    )
    decision = decide_contact_enrichment(
        ContactEntities(email="new@example.com", phone="8467565853"),
        profile,
    )
    assert decision.action == "call"
    assert decision.payload == {
        "phone": "8467565853",
        "email": "new@example.com",
    }
    assert decision.confirmation_fields == ["email"]
    assert decision.confirmation_payload == {"email": "new@example.com"}


def test_decide_call_on_mismatch_when_confirmed() -> None:
    profile = ContactProfileSnapshot(contact_id="1", primary_email="old@example.com")
    decision = decide_contact_enrichment(
        ContactEntities(email="new@example.com"),
        profile,
        confirmed=True,
    )
    assert decision.action == "call"
    assert decision.payload == {"email": "new@example.com"}


def test_format_profile_block_includes_contact_id() -> None:
    block = format_contact_profile_block(
        ContactProfileSnapshot(contact_id="42", first_name="Zara"),
    )
    assert "contactId: 42" in block
    assert "firstName: Zara" in block


def test_format_profile_block_marks_present_email_and_phone() -> None:
    block = format_contact_profile_block(
        ContactProfileSnapshot(
            contact_id="cdp-1",
            primary_email="alice@example.com",
            primary_phone="+91 9000000000",
        ),
    )
    assert "emailStatus: PRESENT" in block
    assert "phoneStatus: PRESENT" in block
    assert "contact_enrich for this email unless" in block
