"""
Prepare node — trim conversation messages and fold older turns into a summary.

Runs before the router so specialists see a bounded context window.
"""

from __future__ import annotations

from app.messages_compat import AIMessage, HumanMessage, RemoveMessage, SystemMessage

from app.llm import get_llm
from app.llm_log import log_llm
from app.state import AgentState

# Keep this many recent messages in state after trim.
KEEP_RECENT = 20
# Only summarize (and pay an LLM call) when the transcript exceeds this.
SUMMARIZE_THRESHOLD = 24


def _msg_text(msg) -> str:
    content = msg.content if isinstance(getattr(msg, "content", None), str) else str(
        getattr(msg, "content", "") or ""
    )
    return (content or "").strip()


def _role_label(msg) -> str:
    role = getattr(msg, "type", None) or getattr(msg, "role", None)
    if role in ("human", "user"):
        return "User"
    if role in ("ai", "assistant"):
        return "Assistant"
    return "Other"


def _transcript(msgs: list, limit: int | None = None) -> str:
    lines: list[str] = []
    for msg in msgs if limit is None else msgs[-limit:]:
        text = _msg_text(msg)
        if not text:
            continue
        lines.append(f"{_role_label(msg)}: {text}")
    return "\n".join(lines)


def _summarize_older(older: list, prior_summary: str | None) -> str:
    """Fold older turns into a short rolling summary (one LLM call)."""
    block = _transcript(older)
    if not block.strip():
        return (prior_summary or "").strip()

    prompt_parts = [
        "Summarize the following conversation turns for a ticketing co-worker.",
        "Keep facts the user shared (names, emails, phones, issues, decisions).",
        "Be concise (max ~120 words). No preamble.",
    ]
    if prior_summary and prior_summary.strip():
        prompt_parts.append(f"Existing summary to extend:\n{prior_summary.strip()}")
    prompt_parts.append(f"New turns to fold in:\n{block}")

    llm = get_llm()
    result = llm.invoke(
        [
            SystemMessage(content="You write compact conversation summaries."),
            HumanMessage(content="\n\n".join(prompt_parts)),
        ]
    )
    text = result.content if isinstance(result.content, str) else str(result.content)
    summary = (text or "").strip() or (prior_summary or "").strip()
    log_llm(
        kind="prepare_summary",
        user_text=f"older_turns={len(older)}",
        response=summary[:500],
        agent="prepare",
    )
    return summary


def prepare_state(state: AgentState) -> dict:
    """
    Bound message list and optionally refresh the rolling summary.

    - If the client sent session_history, that transcript is authoritative —
      do not summarize/drop LangGraph messages (avoids fighting UI memory).
    - If len(messages) <= SUMMARIZE_THRESHOLD: no-op (short chats stay cheap).
    - Otherwise: summarize everything except the last KEEP_RECENT messages,
      then RemoveMessage the dropped turns so the checkpointer stays small.
    """
    session = state.get("session_history") or []
    if isinstance(session, list) and len(session) > 1:
        # >1 means prior turns exist in the UI transcript; leave messages alone.
        return {}

    messages = list(state.get("messages") or [])
    if len(messages) <= SUMMARIZE_THRESHOLD:
        return {}

    # Prefer id-based removal; fall back to count trim via trim_messages for orphans.
    keep = messages[-KEEP_RECENT:]
    older = messages[:-KEEP_RECENT]
    if not older:
        return {}

    prior = state.get("summary") or ""
    summary = _summarize_older(older, prior)

    removals: list = []
    for msg in older:
        mid = getattr(msg, "id", None)
        if mid:
            removals.append(RemoveMessage(id=mid))

    # If some older messages lack ids, rebuild by removing all then re-adding keep.
    if len(removals) < len(older):
        REMOVE_ALL_MESSAGES = "__REMOVE_ALL__"

        rebuilt: list = [RemoveMessage(id=REMOVE_ALL_MESSAGES)]
        for msg in keep:
            content = _msg_text(msg)
            role = getattr(msg, "type", None) or getattr(msg, "role", None)
            mid = getattr(msg, "id", None)
            if role in ("human", "user"):
                rebuilt.append(HumanMessage(content=content, **({"id": mid} if mid else {})))
            elif role in ("ai", "assistant"):
                rebuilt.append(AIMessage(content=content, **({"id": mid} if mid else {})))
        return {"messages": rebuilt, "summary": summary}

    return {"messages": removals, "summary": summary}
