"""User-facing chat messages."""

from __future__ import annotations

STARTER_SUGGESTIONS = [
    "How many visitors came today?",
    "Show top 10 pages by views this week.",
    "What is the bounce rate for the top traffic source?",
]


def service_unavailable() -> str:
    return (
        "I wasn't able to finish that just now. "
        "Please try again in a moment — I'm happy to help with your site analytics."
    )


def query_run_failed() -> str:
    return (
        "I couldn't pull up the data for that question. "
        "Please try again in a moment."
    )


def empty_message() -> str:
    return "Please enter a question about your analytics data."
