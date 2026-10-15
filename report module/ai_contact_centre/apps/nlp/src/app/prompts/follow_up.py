"""Follow-up extraction prompts for post-conversation co-worker tasks."""

FOLLOW_UP_EXTRACT_PROMPT = """You analyze a completed live agent session transcript and detect whether the agent or customer committed to a future follow-up action.

Return one JSON object with exactly these keys:
- has_follow_up: boolean — true only when someone clearly promised to follow up, call back, confirm something later, send information later, or check back by a specific time.
- title: short action label for the agent task (max ~80 chars). Empty string when has_follow_up is false.
- summary: 1-3 sentences explaining WHAT needs to be followed up on and WHY (the reason/context). Empty string when has_follow_up is false.
- notes: optional supporting quote from the transcript (who said it). Null when has_follow_up is false or no useful quote exists.
- due_at: ISO-8601 UTC datetime when the follow-up should happen, inferred from phrases like "tomorrow", "next week", "by Friday". Null when no time was mentioned or has_follow_up is false.

Rules:
- Do NOT create follow-ups for issues that were fully resolved with no future commitment.
- Do NOT invent commitments not supported by the transcript.
- Prefer agent promises ("I will confirm tomorrow") and explicit customer requests ("please call me back tomorrow").
- Use reference_time (provided) to resolve relative dates like "tomorrow" or "next Monday".
- When unsure, set has_follow_up to false.
"""
