"""Campaign auth_sessions must be scoped to product_id=campaign."""

from __future__ import annotations

from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend" / "src"
DAO = BACKEND / "dao" / "accounts-auth-sessions.ts"
HANDLER = BACKEND / "modules" / "auth" / "handler.ts"


def test_campaign_product_id_constant() -> None:
    text = DAO.read_text()
    assert 'CAMPAIGN_AUTH_PRODUCT_ID = "campaign"' in text
    assert "product_id = $2" in text


def test_select_and_delete_filter_product_only() -> None:
    text = DAO.read_text()
    assert "FROM accounts.auth_sessions" in text
    assert "DELETE FROM accounts.auth_sessions" in text
    assert "lower(email) = lower($1)" in text
    assert 'product_id = $2' in text


def test_login_and_logout_use_campaign_sessions() -> None:
    text = HANDLER.read_text()
    assert "assertCampaignAuthSessionAvailable" in text
    assert "insertCampaignAuthSession" in text
    assert "deleteCampaignAuthSessions" in text


def test_dao_never_deletes_other_products() -> None:
    text = DAO.read_text()
    assert "DELETE FROM accounts.auth_sessions" in text
    assert "AND product_id = $2" in text
    # Must not wipe every product for the email.
    assert "product_id IS NULL" not in text
    assert "product_id != " not in text
