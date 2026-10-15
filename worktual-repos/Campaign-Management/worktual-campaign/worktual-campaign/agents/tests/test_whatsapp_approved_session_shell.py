"""Approved WA runs need a DB agent-session shell for audience + template APIs."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.session_store import load_audience_ids, save_audience_ids


@pytest.mark.asyncio
async def test_load_audience_ids_returns_empty_on_404_after_shell():
    with patch(
        "app.session_store._ensure_agent_session_shell",
        new_callable=AsyncMock,
        return_value=True,
    ):
        mock_res = MagicMock()
        mock_res.status_code = 404
        mock_res.is_success = False
        mock_res.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_res)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("app.session_store.httpx.AsyncClient", return_value=mock_client):
            ids = await load_audience_ids("wa-approved-1060", token="tok")

    assert ids == []


@pytest.mark.asyncio
async def test_save_audience_ids_ensures_shell_first():
    with patch(
        "app.session_store._ensure_agent_session_shell",
        new_callable=AsyncMock,
    ) as ensure:
        with patch("app.session_store.httpx.AsyncClient") as client_cls:
            mock_res = MagicMock()
            mock_res.is_error = False
            mock_client = MagicMock()
            mock_client.put = AsyncMock(return_value=mock_res)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            client_cls.return_value = mock_client

            await save_audience_ids("wa-approved-99", ["cid-1"], token="tok")

    ensure.assert_awaited_once_with("wa-approved-99", token="tok")
