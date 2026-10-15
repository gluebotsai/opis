import unittest

from app.integrations.push_click_dest import resolve_push_click_dest

APP = "https://rebuild-campaign.worktual.com"


class TestPushClickDest(unittest.TestCase):
    def test_never_uses_campaign_management_as_dest(self) -> None:
        self.assertIsNone(
            resolve_push_click_dest(
                cta_url=APP,
                campaign_url=APP,
                default_click_url="",
                app_url=APP,
            )
        )

    def test_accounts_default_when_cta_is_app(self) -> None:
        self.assertEqual(
            resolve_push_click_dest(
                cta_url="{{campaign_url}}",
                campaign_url=APP,
                default_click_url="https://shop.example/sale",
                app_url=APP,
            ),
            "https://shop.example/sale",
        )

    def test_template_cta_wins(self) -> None:
        self.assertEqual(
            resolve_push_click_dest(
                cta_url="https://brand.example/offer",
                campaign_url=APP,
                default_click_url="https://shop.example/sale",
                app_url=APP,
            ),
            "https://brand.example/offer",
        )


if __name__ == "__main__":
    unittest.main()
