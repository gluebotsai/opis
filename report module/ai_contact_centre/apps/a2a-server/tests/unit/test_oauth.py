"""OAuth token issuance tests."""

import pytest

from cc_a2a.auth import HUB_ALL_TENANTS_ID
from cc_a2a.auth.oauth import TokenError, decode_spoke_access_token, issue_token_response
from cc_a2a.config import A2ASettings


def _settings() -> A2ASettings:
    return A2ASettings(
        A2A_ENABLED=True,
        A2A_TOKEN_SIGNING_SECRET="test-signing-secret",
        A2A_HUB_CLIENT_ID="worktual-hub-ccaas",
        A2A_HUB_CLIENT_SECRET="hub-secret",
        A2A_OAUTH_ISSUER="http://a2a.test",
        A2A_OAUTH_AUDIENCE="worktual-a2a",
        A2A_PUBLIC_URL="http://a2a.test",
    )


@pytest.mark.asyncio
async def test_client_credentials_without_organization_id() -> None:
    response = await issue_token_response(
        _settings(),
        form={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ccaas",
            "client_secret": "hub-secret",
        },
        authorization=None,
    )
    assert response["organization_id"] == HUB_ALL_TENANTS_ID
    claims = decode_spoke_access_token(_settings(), response["access_token"])
    assert claims["organization_ids"] == [HUB_ALL_TENANTS_ID]


@pytest.mark.asyncio
async def test_client_credentials_with_specific_organization_id() -> None:
    response = await issue_token_response(
        _settings(),
        form={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ccaas",
            "client_secret": "hub-secret",
            "organization_id": "1003",
        },
        authorization=None,
    )
    assert response["organization_id"] == "1003"
    claims = decode_spoke_access_token(_settings(), response["access_token"])
    assert claims["organization_ids"] == ["1003"]


@pytest.mark.asyncio
async def test_refresh_token_preserves_wildcard_organization() -> None:
    settings = _settings()
    initial = await issue_token_response(
        settings,
        form={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ccaas",
            "client_secret": "hub-secret",
        },
        authorization=None,
    )
    refreshed = await issue_token_response(
        settings,
        form={
            "grant_type": "refresh_token",
            "client_id": "worktual-hub-ccaas",
            "client_secret": "hub-secret",
            "refresh_token": initial["refresh_token"],
        },
        authorization=None,
    )
    assert refreshed["organization_id"] == HUB_ALL_TENANTS_ID
    claims = decode_spoke_access_token(settings, refreshed["access_token"])
    assert claims["organization_ids"] == [HUB_ALL_TENANTS_ID]


@pytest.mark.asyncio
async def test_refresh_token_honors_form_organization_id() -> None:
    settings = _settings()
    initial = await issue_token_response(
        settings,
        form={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ccaas",
            "client_secret": "hub-secret",
            "organization_id": "1000",
        },
        authorization=None,
    )
    refreshed = await issue_token_response(
        settings,
        form={
            "grant_type": "refresh_token",
            "client_id": "worktual-hub-ccaas",
            "client_secret": "hub-secret",
            "refresh_token": initial["refresh_token"],
            "organization_id": "1003",
        },
        authorization=None,
    )
    assert refreshed["organization_id"] == "1003"
    claims = decode_spoke_access_token(settings, refreshed["access_token"])
    assert claims["organization_ids"] == ["1003"]


@pytest.mark.asyncio
async def test_invalid_client_credentials() -> None:
    with pytest.raises(TokenError) as exc:
        await issue_token_response(
            _settings(),
            form={
                "grant_type": "client_credentials",
                "client_id": "worktual-hub-ccaas",
                "client_secret": "wrong",
            },
            authorization=None,
        )
    assert exc.value.error == "invalid_client"
