import tiktoken
import json
from src.llm import OpenAILLM
LLM = OpenAILLM()

MAX_CONTEXT_TOKENS = 25000          # trigger threshold
KEEP_RECENT_MESSAGES = 6            # always keep last N messages verbatim after summarizing

_encoder = tiktoken.get_encoding("cl100k_base")


def count_tokens(messages: list) -> int:
    """Rough token count for a list of chat messages (system + history)."""
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            total += len(_encoder.encode(content))
        elif content is None:
            # tool_calls / tool responses without plain content
            total += len(_encoder.encode(json.dumps(m.get("tool_calls", m.get("content", "")))))
        total += 4  # per-message overhead (role, formatting)
    return total


def summarize_session(memory, system_prompt: str) -> None:
    """
    Summarizes older session history into a single system-style message,
    keeping the most recent KEEP_RECENT_MESSAGES intact for continuity.
    Mutates memory in place via memory.replace_session_messages (or equivalent).
    """
    messages = memory.get_session_messages()

    if len(messages) <= KEEP_RECENT_MESSAGES + 1:
        return  # not enough history to bother summarizing

    # Split: everything except system message and the last N
    head = messages[1:-KEEP_RECENT_MESSAGES]   # skip index 0 (system prompt)
    tail = messages[-KEEP_RECENT_MESSAGES:]

    if not head:
        return
    
    pre_post = "-"*25
    print("="*30,"Summarizer block","="*30)
    print(f"{pre_post}The memmory is being summarized.{pre_post}")
    
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

    summary_res = LLM.run(messages=summarization_prompt, tools=None)
    summary_text = summary_res["content"]

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
