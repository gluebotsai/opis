"""Parse campaign id from Campaign API on-demand launch response shapes."""

import unittest


def _parse_campaign_id(data: dict) -> str:
    """Mirror on_demand_agent.run_on_demand_agent result extraction."""
    result = data.get("data") if isinstance(data.get("data"), dict) else data
    campaign = result.get("campaign") if isinstance(result.get("campaign"), dict) else {}
    run = result.get("run") if isinstance(result.get("run"), dict) else {}
    launch = result.get("launch") if isinstance(result.get("launch"), dict) else {}
    launch_run = launch.get("run") if isinstance(launch.get("run"), dict) else {}
    return str(
        result.get("campaign_id")
        or run.get("id")
        or launch_run.get("id")
        or launch.get("campaign_id")
        or result.get("id")
        or campaign.get("id")
        or ""
    ).strip()


class OnDemandCampaignIdParseTests(unittest.TestCase):
    def test_run_at_top_level(self):
        body = {
            "statusCode": 200,
            "message": "On-demand send launched",
            "run": {"id": "1465", "title": "Idle Cart Recovery"},
            "email_send_plan": {"scheduled": True},
        }
        self.assertEqual(_parse_campaign_id(body), "1465")

    def test_run_nested_under_launch(self):
        body = {
            "launch": {
                "run": {"id": "999"},
            },
        }
        self.assertEqual(_parse_campaign_id(body), "999")


if __name__ == "__main__":
    unittest.main()
