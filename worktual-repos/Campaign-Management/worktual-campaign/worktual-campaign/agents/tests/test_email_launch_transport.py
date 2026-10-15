"""Accounts-only campaign email launch — no Worktual ESP fallback."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from app.integrations.email_launch_transport import (
    EMAIL_MAILBOX_NOT_READY,
    accounts_launch_fail_reason,
    is_accounts_launch_ready,
)

BACKEND_SRC = Path(__file__).resolve().parents[2] / "backend" / "src"
WORKER = BACKEND_SRC / "services" / "email-send-worker.ts"
HELPER = BACKEND_SRC / "helpers" / "email-launch-transport.ts"


def test_ready_when_send_ready_true() -> None:
    assert is_accounts_launch_ready({"public": {"send_ready": True}})
    assert is_accounts_launch_ready({"send_ready": True})
    assert (
        is_accounts_launch_ready(
            {
                "public": {
                    "send_ready": True,
                    "display_from": "noreply@worktual.tech",
                }
            }
        )
        is False
    )
    assert (
        is_accounts_launch_ready(
            {
                "send_ready": True,
                "display_from": "shop@example.com",
                "oauth_account_email": "noreply@worktual.tech",
            }
        )
        is False
    )


def test_not_ready_without_mailbox() -> None:
    assert is_accounts_launch_ready(None) is False
    assert is_accounts_launch_ready({}) is False
    assert is_accounts_launch_ready({"public": {"send_ready": False}}) is False
    reason = accounts_launch_fail_reason(None)
    assert "setup_channel_configs" in reason
    assert "setup_email_configs" in reason


def test_fail_reason_uses_block_reason() -> None:
    assert (
        accounts_launch_fail_reason(
            {"public": {"send_ready": False, "block_reason": "reconnect Google"}}
        )
        == "reconnect Google"
    )


def test_worker_never_imports_esp() -> None:
    text = WORKER.read_text()
    assert "sendWorktualCampaignEmail" not in text
    assert "getEspProvider" not in text
    assert "isWorktualEsp" not in text
    assert "isEspLive" not in text
    assert "loadVerifiedFrom" not in text
    assert "services/esp" not in text
    assert "sendAccountsMailboxCampaignEmail" in text
    assert "EMAIL_MAILBOX_NOT_READY" in text
    assert "evaluateEmailSendPipelineForMailbox" in text
    assert "[email-launch]" in text
    assert "email_launch_mailbox" in text or "mailbox ready" in text
    assert EMAIL_MAILBOX_NOT_READY in HELPER.read_text()


def test_esp_module_removed() -> None:
    esp_dir = BACKEND_SRC / "services" / "esp"
    assert not esp_dir.exists()


def test_daily_report_uses_accounts_mailbox() -> None:
    text = (BACKEND_SRC / "services" / "daily-report" / "send-report.ts").read_text()
    assert "sendAccountsMailboxCampaignEmail" in text
    assert "getEspProvider" not in text
    assert "isEspLive" not in text


def test_env_has_no_esp_or_worktual_send_url() -> None:
    text = (BACKEND_SRC / "config" / "env.ts").read_text()
    assert "emailcampaign.worktual.pl" not in text
    assert "ESP_PROVIDER" not in text
    assert "RESEND_API_KEY" not in text
    assert "ESP_VERIFY_FROM" not in text
    assert "esp:" not in text


def test_email_config_purges_worktual_tech_senders() -> None:
    text = (BACKEND_SRC / "dao" / "email-config.ts").read_text()
    assert "purgeWorktualTechEmailRows" in text
    assert "resolveWorktualSendIdentity" not in text
    assert "Worktual sender" not in text
    assert "getEspProvider" not in text
    assert "sendAccountsMailboxCampaignEmail" in text
    assert "services/esp" not in text


def test_backend_has_no_static_worktual_tech_from() -> None:
    blocked_from = (BACKEND_SRC / "helpers" / "worktual-tech-from.ts").read_text()
    dkim = (BACKEND_SRC / "helpers" / "dkim-crypto.ts").read_text()
    transport_py = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "integrations"
        / "email_launch_transport.py"
    ).read_text()
    assert "WORKTUAL_STATIC_FROM" not in dkim
    assert "cannot be used for campaign send" in blocked_from
    assert "email_channel_mailbox_block" in transport_py
    assert "services/esp" not in dkim


@pytest.mark.asyncio
async def test_email_channel_mailbox_block_skips_non_email() -> None:
    from app.integrations.email_launch_transport import email_channel_mailbox_block

    out = await email_channel_mailbox_block(channels=["whatsapp"], token="t")
    assert out is None


@pytest.mark.asyncio
async def test_email_channel_mailbox_block_when_not_ready() -> None:
    from app.integrations.email_launch_transport import email_channel_mailbox_block

    async def _readiness(*, token=""):
        return {
            "ready": False,
            "message": "This mailbox cannot be used for campaign send.",
            "code": EMAIL_MAILBOX_NOT_READY,
        }

    with patch(
        "app.integrations.email_launch_transport.fetch_email_send_readiness",
        new=_readiness,
    ):
        out = await email_channel_mailbox_block(channels=["email"], token="t")
    assert out is not None
    assert out["ok"] is False
    assert out["error"] == EMAIL_MAILBOX_NOT_READY


@pytest.mark.asyncio
async def test_email_channel_mailbox_block_when_readiness_unknown() -> None:
    from app.integrations.email_launch_transport import (
        EMAIL_SEND_READINESS_UNAVAILABLE,
        email_channel_mailbox_block,
    )

    async def _readiness(*, token=""):
        return None

    with patch(
        "app.integrations.email_launch_transport.fetch_email_send_readiness",
        new=_readiness,
    ):
        out = await email_channel_mailbox_block(channels=["email"], token="t")
    assert out is not None
    assert out["ok"] is False
    assert out["error"] == EMAIL_SEND_READINESS_UNAVAILABLE
