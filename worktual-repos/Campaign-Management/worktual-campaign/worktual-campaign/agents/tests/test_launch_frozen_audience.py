"""Launch must freeze real contact ids, not matched_count alone."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.agents.create_campaign.tool_functions import _ensure_frozen_contact_ids


class EnsureFrozenContactIdsTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_existing_refs(self):
        session = {"audience": {"matched_count": 14, "filters": {}}}
        with patch(
            "app.agents.create_campaign.tool_functions.load_audience_ids",
            new=AsyncMock(return_value=["1", "2"]),
        ), patch(
            "app.agents.create_campaign.tool_functions._call_filter_api",
            new=AsyncMock(),
        ) as filter_api:
            ids = await _ensure_frozen_contact_ids("sess", session, "tok")
        self.assertEqual(ids, ["1", "2"])
        filter_api.assert_not_called()

    async def test_refilters_when_refs_empty_but_count_set(self):
        session = {"audience": {"matched_count": 14, "filters": {}}}
        with patch(
            "app.agents.create_campaign.tool_functions.load_audience_ids",
            new=AsyncMock(return_value=[]),
        ), patch(
            "app.agents.create_campaign.tool_functions._call_filter_api",
            new=AsyncMock(return_value={"contact_ids": ["CDP-shop1", "9"]}),
        ), patch(
            "app.agents.create_campaign.tool_functions.save_audience_ids",
            new=AsyncMock(),
        ) as save_ids:
            ids = await _ensure_frozen_contact_ids("sess", session, "tok")
        self.assertEqual(ids, ["CDP-shop1", "9"])
        save_ids.assert_awaited_once()
        self.assertEqual(session["audience"]["matched_count"], 2)

    async def test_empty_when_no_count_and_no_filters(self):
        session = {"audience": {"matched_count": 0}}
        with patch(
            "app.agents.create_campaign.tool_functions.load_audience_ids",
            new=AsyncMock(return_value=[]),
        ), patch(
            "app.agents.create_campaign.tool_functions._call_filter_api",
            new=AsyncMock(),
        ) as filter_api:
            ids = await _ensure_frozen_contact_ids("sess", session, "tok")
        self.assertEqual(ids, [])
        filter_api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
