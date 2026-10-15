"""Compose recipe — add a step id here only if it must always run."""

from __future__ import annotations

# Default order. Off-recipe providers can still run via need_input.
COMPOSE_STEPS: list[str] = [
    "knowledge",
    "brand_guidelines",
    "plan",
    "compliance_plan",
    "image",
    "compose",
    "compliance_html",
]

MAX_DISPATCHER_ITERATIONS = 12
MAX_NEED_RETRIES = 3
MAX_HARD_RETRIES = 1
