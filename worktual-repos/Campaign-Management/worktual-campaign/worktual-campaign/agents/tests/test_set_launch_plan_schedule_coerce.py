"""SET_LAUNCH_PLAN must keep explicit clocks even when LLM passes schedule_mode=now."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from app.agents.create_campaign.tool_functions import handle_set_launch_plan


class SetLaunchPlanScheduleCoerceTests(unittest.IsolatedAsyncioTestCase):
    async def test_now_mode_with_local_time_becomes_at(self):
        tz = ZoneInfo("Asia/Kolkata")
        future = datetime.now(tz) + timedelta(hours=2)
        local_date = future.strftime("%Y-%m-%d")
        local_time = future.strftime("%H:%M")
        session = {
            "channels": ["email"],
            "templates": [{"channel": "email", "template_id": "1"}],
            "audience": {"matched_count": 1, "filters": {"emails": ["a@b.com"]}},
            "campaign_profile": {"mode": "b2c"},
            "messages": [],
        }

        with patch(
            "app.agents.create_campaign.tool_functions.launch_readiness_message",
            return_value=None,
        ), patch(
            "app.agents.create_campaign.tool_functions.get_or_create_session",
            new=AsyncMock(return_value=session),
        ), patch(
            "app.agents.create_campaign.tool_functions.save_session",
            new=AsyncMock(side_effect=lambda s: s),
        ), patch(
            "app.agents.create_campaign.tool_functions.load_audience_ids",
            new=AsyncMock(return_value=["1830917733048487"]),
        ), patch(
            "app.agents.create_campaign.tool_functions._call_audience_insights",
            new=AsyncMock(return_value={}),
        ), patch(
            "app.agents.create_campaign.tool_functions._call_design_check",
            new=AsyncMock(return_value={"design": {}}),
        ), patch(
            "app.agents.create_campaign.tool_functions._call_orchestration_check",
            new=AsyncMock(return_value={"orchestration": {}}),
        ):
            result = await handle_set_launch_plan(
                "sess-sched",
                "tok",
                {
                    "launch_channels": ["email"],
                    "schedule_mode": "now",
                    "launch_local_date": local_date,
                    "launch_local_time": local_time,
                    "timezone": "Asia/Kolkata",
                    "change_summary": "test coerce",
                    "primary_channel": "email",
                    "orchestration_mode": "prefer_primary",
                },
            )

        self.assertTrue(result.get("ok", True), result)
        plan = session.get("launch_plan") or result.get("launch_plan") or {}
        self.assertEqual(plan.get("schedule_mode"), "at")
        self.assertEqual(plan.get("launch_local_date"), local_date)
        self.assertEqual(plan.get("launch_local_time"), local_time)
        self.assertNotIn("launching now", str(plan.get("schedule_reason") or ""))


if __name__ == "__main__":
    unittest.main()
