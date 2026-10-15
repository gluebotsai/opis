"""Welcome text — varied friendly openers."""

from __future__ import annotations

from app.agents.contacts.prompts import (
    _WELCOME_CONTACTS_B2B,
    _WELCOME_CONTACTS_B2C,
    welcome_text,
)


def test_welcome_b2b_from_pool():
    msg = welcome_text(campaign_profile={"mode": "b2b"})
    assert msg in _WELCOME_CONTACTS_B2B


def test_welcome_b2c_from_pool():
    msg = welcome_text(campaign_profile={"mode": "b2c"})
    assert msg in _WELCOME_CONTACTS_B2C


def test_welcome_pool_has_multiple_options():
    assert len(_WELCOME_CONTACTS_B2B) >= 4
    assert len(_WELCOME_CONTACTS_B2C) >= 4
