"""Finance Offer calendar / marketing opportunities (next slice).

Events nav stays hidden for Finance. This module will hold time-bound marketing
signals (festive windows, eligibility cohorts, product launches) that feed
Recommendations — not B2B webinars/forms tracking.

Stub only: shape for the upcoming build. Do not wire UI yet.
"""

from __future__ import annotations

from typing import Any

# Planned signal kinds for Finance Offer calendar.
OFFER_SIGNAL_KINDS = (
    "festive_window",
    "eligibility_opened",
    "product_launch",
    "lifecycle_reactivation",
    "referral_push",
)


def list_upcoming_signals() -> list[dict[str, Any]]:
    """Placeholder — return empty until Offer calendar ships."""
    return []
