# ==============================================================================
# summarizer.py — Context Summarization & Compaction for Knowledge Graph Agent
# ==============================================================================

import json
from typing import Optional
import tiktoken

MAX_CONTEXT_TOKENS = 25000          # trigger threshold
KEEP_RECENT_MESSAGES = 6            # always keep last N messages verbatim after summarizing

_encoder = tiktoken.get_encoding("cl100k_base")
_LLM_INSTANCE = None


def _get_llm():
    global _LLM_INSTANCE
    if _LLM_INSTANCE is None:
        from .llm import OpenAILLM
        _LLM_INSTANCE = OpenAILLM()
    return _LLM_INSTANCE


def count_tokens(messages: list) -> int:
    """Rough token count for a list of chat messages (system + history)."""
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            total += len(_encoder.encode(content))
        elif content is None:
            total += len(_encoder.encode(json.dumps(m.get("tool_calls", m.get("content", "")))))
        total += 4
    return total


def summarize_session(memory, system_prompt: str) -> None:
    """
    Summarizes older session history into a single system-style message,
    keeping the most recent KEEP_RECENT_MESSAGES intact for continuity.
    """
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

    llm = _get_llm()
    summary_res = llm.run(messages=summarization_prompt, tools=None)
    summary_text = summary_res.get("content", "")

    new_messages = (
        [{"role": "system", "content": system_prompt}]
        + [{"role": "system", "content": f"[Earlier conversation summary]: {summary_text}"}]
        + tail
    )
    memory.replace_session_messages(new_messages)


def maybe_compact_context(memory, system_prompt: str) -> None:
    """Call before each LLM.run — compacts session if over threshold."""
    messages = memory.get_session_messages()
    if count_tokens(messages) > MAX_CONTEXT_TOKENS:
        summarize_session(memory, system_prompt)
