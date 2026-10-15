"""CRM A2A spoke: Hub task adapter over existing agents."""

from app.a2a.catalog import list_spoke_skills, spoke_card_version
from app.a2a.errors import InputRequiredError, SpokeRejectError

__all__ = [
    "InputRequiredError",
    "SpokeRejectError",
    "list_spoke_skills",
    "spoke_card_version",
]
