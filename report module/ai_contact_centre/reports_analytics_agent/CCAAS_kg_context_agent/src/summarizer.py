import json
from typing import Callable, Optional

try:
    import tiktoken
    _encoder = tiktoken.get_encoding("cl100k_base")
except Exception:
    _encoder = None

MAX_CONTEXT_TOKENS = 10000          # trigger threshold
KEEP_RECENT_MESSAGES = 6            # always keep last N messages verbatim after summarizing


def count_tokens(messages: list) -> int:
    """Rough token count for a list of chat messages (system + history)."""
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            if _encoder:
                total += len(_encoder.encode(content))
            else:
                total += len(content) // 4
        elif content is None:
            raw = json.dumps(m.get("tool_calls", m.get("content", "")))
            if _encoder:
                total += len(_encoder.encode(raw))
            else:
                total += len(raw) // 4
        total += 4  # per-message overhead
    return total


def summarize_session(memory, system_prompt: str, llm_runner: Optional[Callable] = None) -> None:
    """
    Summarizes older session history into a single system-style message,
    keeping the most recent KEEP_RECENT_MESSAGES intact for continuity.
    """
    if llm_runner is None:
        return

    messages = memory.get_session_messages()
    if len(messages) <= KEEP_RECENT_MESSAGES + 1:
        return

    head = messages[1:-KEEP_RECENT_MESSAGES]
    tail = messages[-KEEP_RECENT_MESSAGES:]
    if not head:
        return

    summarization_prompt = [
        {
            "role": "system",
            "content": (
                "Summarize the following conversation history into a concise but "
                "information-dense paragraph. Preserve: user goals, key facts stated, "
                "decisions made, entity IDs/names referenced, and any unresolved "
                "questions. Do not include tool-call mechanics or raw tool outputs "
                "verbatim — summarize their outcome instead. Do not add commentary."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(head, default=str),
        },
    ]

    summary_res = llm_runner(messages=summarization_prompt, tools=None)
    summary_text = summary_res.get("content", "")

    new_messages = (
        [{"role": "system", "content": system_prompt}]
        + [{"role": "system", "content": f"[Earlier conversation summary]: {summary_text}"}]
        + tail
    )
    memory.replace_session_messages(new_messages)


def maybe_compact_context(memory, system_prompt: str, llm_runner: Optional[Callable] = None) -> None:
    """Call before each LLM step — compacts session if over token threshold."""
    messages = memory.get_session_messages()
    if count_tokens(messages) > MAX_CONTEXT_TOKENS:
        summarize_session(memory, system_prompt, llm_runner=llm_runner)
