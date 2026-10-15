"""My Accounts App/Web push credential mapping (no network)."""

from app.integrations.accounts_campaign_channels import (
    INACTIVE,
    NEEDS_REAUTH,
    NOT_CONFIGURED,
    app_push_checklist,
    campaign_status_from_accounts_channel,
    compliance_denied,
    map_app_push_credentials,
    map_web_push_credentials,
    sendable_accounts_status,
    user_message_for_accounts_error,
)


def test_map_app_push_credentials_fcm() -> None:
    creds = {
        "status": "active",
        "platform": "android",
        "name": "Acme App",
        "fcmServiceAccount": {
            "project_id": "p1",
            "client_email": "a@b.com",
            "private_key": "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
        },
        "fcmConfigured": True,
        "apnsConfigured": False,
        "defaultIconUrl": "https://x/icon.png",
        "defaultClickUrl": "https://x/",
    }
    s = map_app_push_credentials(creds)
    assert s["fcm_project_id"] == "p1"
    assert s["fcm_client_email"] == "a@b.com"
    assert "BEGIN PRIVATE KEY" in s["fcm_private_key"]
    assert s["provider"] == "fcm"
    assert s["default_icon_url"] == "https://x/icon.png"
    assert s["app_display_name"] == "Acme App"


def test_map_app_push_credentials_both_platforms() -> None:
    s = map_app_push_credentials(
        {
            "platform": "both",
            "apnsKeyId": "KEY1",
            "apnsTeamId": "TEAM",
            "apnsBundleId": "com.acme.app",
            "apnsKey": "-----BEGIN PRIVATE KEY-----\np8\n-----END PRIVATE KEY-----",
            "apnsEnvironment": "sandbox",
            "fcmServiceAccount": {
                "project_id": "p1",
                "client_email": "a@b.com",
                "private_key": "k",
            },
        }
    )
    assert s["provider"] == "both"
    assert s["apns_key_id"] == "KEY1"
    assert s["apns_environment"] == "sandbox"
    assert s["apns_bundle_id"] == "com.acme.app"


def test_map_web_push_credentials() -> None:
    s = map_web_push_credentials(
        {
            "name": "Site",
            "vapidSubject": "mailto:ops@acme.com",
            "vapidPublicKey": "pub",
            "vapidPrivateKey": "priv",
            "defaultIconUrl": "https://x/i.png",
        }
    )
    assert s["vapid_subject"] == "mailto:ops@acme.com"
    assert s["vapid_public_key"] == "pub"
    assert s["vapid_private_key"] == "priv"


def test_map_web_push_credentials_snake_case() -> None:
    s = map_web_push_credentials(
        {
            "vapid_subject": "mailto:ops@acme.com",
            "vapid_public_key": "pub",
            "vapid_private_key": "priv",
        }
    )
    assert s["vapid_private_key"] == "priv"
    assert s["vapid_public_key"] == "pub"


def test_status_active_android_ready() -> None:
    assert (
        campaign_status_from_accounts_channel(
            {"status": "active", "platform": "android", "fcmConfigured": True},
            kind="app_push",
        )
        == "ready"
    )


def test_status_active_both_needs_both_keys() -> None:
    assert (
        campaign_status_from_accounts_channel(
            {
                "status": "active",
                "platform": "both",
                "fcmConfigured": True,
                "apnsConfigured": False,
            },
            kind="app_push",
        )
        == "in_progress"
    )
    assert (
        campaign_status_from_accounts_channel(
            {
                "status": "active",
                "platform": "both",
                "fcmConfigured": True,
                "apnsConfigured": True,
            },
            kind="app_push",
        )
        == "ready"
    )


def test_status_inactive_blocked() -> None:
    assert (
        campaign_status_from_accounts_channel(
            {"status": "inactive", "fcmConfigured": True},
            kind="app_push",
        )
        == "blocked"
    )


def test_status_missing_not_started() -> None:
    assert campaign_status_from_accounts_channel(None, kind="app_push") == "not_started"


def test_web_push_active_ready() -> None:
    assert (
        campaign_status_from_accounts_channel(
            {"status": "active", "vapidConfigured": True, "vapidPublicKey": "x"},
            kind="web_push",
        )
        == "ready"
    )


def test_sendable_only_ready() -> None:
    assert sendable_accounts_status("ready")
    assert not sendable_accounts_status("blocked")
    assert not sendable_accounts_status("in_progress")


def test_app_push_checklist_ios_skips_fcm() -> None:
    c = app_push_checklist(
        {"name": "iOS", "platform": "ios", "fcmConfigured": False, "apnsConfigured": True}
    )
    assert c["fcm_ready"] is True
    assert c["apns_ready"] is True
    assert c["apns_configured"] is True


def test_user_messages() -> None:
    assert "Channel Setup" in user_message_for_accounts_error(NOT_CONFIGURED, "app_push")
    assert "inactive" in user_message_for_accounts_error(INACTIVE, "web_push").lower()
    assert "decrypt" in user_message_for_accounts_error(NEEDS_REAUTH, "app_push").lower()


def test_normalize_web_push_snippet_subscribe() -> None:
    from app.integrations.accounts_campaign_channels import (
        normalize_web_push_snippet_subscribe,
    )

    out = normalize_web_push_snippet_subscribe(
        {
            "organization_id": 1000,
            "channel_config_id": 1200,
            "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
            "keys": {"p256dh": "p", "auth": "a"},
        }
    )
    assert out["organization_id"] == "1000"
    assert out["channel_config_id"] == "1200"
    assert out["endpoint"].startswith("https://")
    assert out["p256dh"] == "p"
    assert out["auth"] == "a"

    aliased = normalize_web_push_snippet_subscribe(
        {
            "organizationId": "1000",
            "channelId": 1200,
            "subscription": {
                "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
                "keys": {"p256dh": "p", "auth": "a"},
            },
        }
    )
    assert aliased["organization_id"] == "1000"
    assert aliased["channel_config_id"] == "1200"


def test_compliance_denied() -> None:
    assert compliance_denied({"act": "deny"})
    assert compliance_denied({"allowed": False})
    assert not compliance_denied({"act": "allow"})
    assert not compliance_denied(None)
