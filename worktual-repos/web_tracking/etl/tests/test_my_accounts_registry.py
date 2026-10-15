"""Tests for My Accounts ingest registry lookup."""

from unittest.mock import patch

import pytest

from ingest.my_accounts_registry import lookup_organization_id, lookup_website


@patch("ingest.my_accounts_registry.get_pg_connection")
def test_lookup_website_success(mock_conn_ctx):
    mock_conn = mock_conn_ctx.return_value.__enter__.return_value
    mock_conn.execute.return_value.fetchone.return_value = {
        "organization_id": 1003,
        "website_id": "1001",
        "website_url": "https://beta.worktual.co.uk",
    }

    result = lookup_website(1001, "https://beta.worktual.co.uk/")

    assert result["organization_id"] == 1003
    assert result["website_url"] == "https://beta.worktual.co.uk"
    assert result["is_active"] is True


@patch("ingest.my_accounts_registry.get_pg_connection")
def test_lookup_website_url_mismatch(mock_conn_ctx):
    mock_conn = mock_conn_ctx.return_value.__enter__.return_value
    mock_conn.execute.return_value.fetchone.return_value = {
        "organization_id": 1003,
        "website_id": "1001",
        "website_url": "https://beta.worktual.co.uk",
    }

    with pytest.raises(ValueError, match="website_url mismatch"):
        lookup_website(1001, "https://other.example.com")


@patch("ingest.my_accounts_registry.get_pg_connection")
def test_lookup_website_not_registered(mock_conn_ctx):
    mock_conn = mock_conn_ctx.return_value.__enter__.return_value
    mock_conn.execute.return_value.fetchone.return_value = None

    with pytest.raises(ValueError, match="not registered"):
        lookup_website(9999, "https://beta.worktual.co.uk")


@patch("ingest.my_accounts_registry.get_pg_connection")
def test_lookup_organization_id(mock_conn_ctx):
    mock_conn = mock_conn_ctx.return_value.__enter__.return_value
    mock_conn.execute.return_value.fetchone.return_value = {
        "organization_id": 1003,
        "website_id": "1001",
        "website_url": "https://beta.worktual.co.uk",
    }

    assert lookup_organization_id(1001) == 1003
