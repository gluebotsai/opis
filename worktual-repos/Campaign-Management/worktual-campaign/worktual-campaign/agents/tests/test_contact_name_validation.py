"""Person name token validation for contact create (format checks only — not chat intent)."""

from __future__ import annotations

from app.agents.contacts.validation import (
    is_valid_person_name_token,
    normalize_name_answer,
)


def test_single_letter_last_name_valid():
    assert is_valid_person_name_token("p", field="last_name") is True
    assert is_valid_person_name_token("P", field="last_name") is True


def test_normal_surname_valid():
    assert is_valid_person_name_token("paleti", field="last_name") is True
    assert is_valid_person_name_token("O'Brien", field="last_name") is True


def test_digits_and_gibberish_rejected():
    assert is_valid_person_name_token("x7k2", field="last_name") is False
    assert is_valid_person_name_token("abc123", field="last_name") is False
    assert is_valid_person_name_token("qwrtyplkj", field="last_name") is False


def test_normalize_trailing_quote():
    assert normalize_name_answer("what'") == "what"
