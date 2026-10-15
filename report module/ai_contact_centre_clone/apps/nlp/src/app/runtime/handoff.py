"""Schema repair for agent handoffs. Does not infer intent."""

from typing import Any


def latest_user_query(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, str) and part.strip():
                    parts.append(part.strip())
                elif isinstance(part, dict):
                    text = part.get("text") or part.get("content")
                    if isinstance(text, str) and text.strip():
                        parts.append(text.strip())
            if parts:
                return " ".join(parts)
    return ""


def fill_handoff_query(
    handoff: dict[str, Any],
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    query = handoff.get("query")
    if isinstance(query, str) and query.strip():
        return handoff
    filled = latest_user_query(messages)
    if not filled:
        return handoff
    return {**handoff, "query": filled}
