"""Update identity immutability — existing email/phone locked; missing may be filled."""

from __future__ import annotations

from app.agents.contacts.validation import (
    identity_snapshot,
    validate_update_identity_change,
)


def test_existing_email_cannot_change():
    base = {"email": "john@example.com", "phone": ""}
    out = validate_update_identity_change(base, email="other@example.com")
    assert out.get("ok") is False
    assert out.get("identity_locked") is True


def test_missing_email_can_be_filled():
    base = {"email": "", "phone": "+919876543210"}
    out = validate_update_identity_change(base, email="new@example.com")
    assert out.get("ok") is True


def test_existing_phone_cannot_change():
    base = {"email": "a@b.com", "phone": "+919876543210"}
    out = validate_update_identity_change(base, phone="+919999999999")
    assert out.get("ok") is False
    assert out.get("identity_locked") is True


def test_missing_phone_can_be_filled():
    base = {"email": "a@b.com", "phone": ""}
    out = validate_update_identity_change(base, phone="+919876543210")
    assert out.get("ok") is True


def test_same_email_allowed():
    base = identity_snapshot({"email": "A@B.com", "phone": ""})
    out = validate_update_identity_change(base, email="a@b.com")
    assert out.get("ok") is True
