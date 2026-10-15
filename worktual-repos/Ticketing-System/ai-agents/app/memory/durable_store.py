"""
Durable conversation memory for co-worker chat threads.

Postgres conversation_contexts is authoritative across restarts.
In-process thread caches are transitional only (no LangGraph).
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any
import time
from functools import lru_cache
from threading import Lock, RLock

from psycopg.types.json import Jsonb

from app.db import db_conn


class _SimpleThreadStore:
    """Process-local placeholder replacing LangGraph InMemorySaver."""

    def __init__(self) -> None:
        self._threads: dict[str, Any] = {}

    def prune(self, thread_ids: list[str], strategy: str = "keep_latest") -> None:
        for tid in thread_ids:
            self._threads.pop(tid, None)

    def delete_thread(self, thread_id: str) -> None:
        self._threads.pop(thread_id, None)

# Match former session_store TTL
_TTL_SECONDS = 60 * 60 * 12  # 12 hours

_LOCK = Lock()
_LAST_SEEN: dict[str, float] = {}
_EVENT_BUFFER: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "workflow_event_buffer", default=None
)
_TURN_LOCKS_GUARD = Lock()
_TURN_LOCKS: dict[str, RLock] = {}

WORKFLOW_EVENT_TYPES = frozenset(
    {
        "workflow_started",
        "workflow_field_extracted",
        "workflow_field_updated",
        "workflow_parked",
        "workflow_resumed",
        "workflow_cancelled",
        "workflow_confirmed",
        "tool_authorized",
        "tool_called",
        "tool_succeeded",
        "tool_failed",
        "workflow_completed",
        "last_query_saved",
    }
)


class StaleConversationContextError(RuntimeError):
    pass


class ConversationContextLoadError(RuntimeError):
    """Durable conversation_context could not be read; fail closed (do not save)."""


@contextmanager
def serialized_conversation_turn(thread_id: str):
    """Prevent duplicate tool execution for concurrent turns in one process.

    Uses RLock so nested callers (legacy graph → native orchestrator) do not deadlock.
    """
    with _TURN_LOCKS_GUARD:
        lock = _TURN_LOCKS.setdefault(thread_id, RLock())
    lock.acquire()
    try:
        yield
    finally:
        lock.release()


def begin_workflow_events() -> None:
    _EVENT_BUFFER.set([])


def emit_workflow_event(event_type: str, **details: Any) -> None:
    """Buffer a structured transition event; never store model prose or secrets."""
    kind = str(event_type or "").strip().lower()
    if kind not in WORKFLOW_EVENT_TYPES:
        return
    safe = {
        key: value
        for key, value in details.items()
        if key
        in {
            "workflow",
            "operation",
            "tool",
            "field",
            "fields",
            "step",
            "from_step",
            "to_step",
            "error_code",
            "state_version",
        }
        and value is not None
    }
    events = list(_EVENT_BUFFER.get() or [])
    events.append(
        {
            "event_type": kind,
            "details": safe,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    _EVENT_BUFFER.set(events)


def drain_workflow_events() -> list[dict[str, Any]]:
    events = list(_EVENT_BUFFER.get() or [])
    _EVENT_BUFFER.set([])
    return events


def _valid_org_id(value: str | None) -> bool:
    """Ticketing org PKs are bigint; accept digit strings only."""
    s = str(value or "").strip()
    return bool(s) and s.isdigit()


def load_conversation_context(
    organization_id: str, user_id: str | None, session_id: str
) -> tuple[dict[str, Any] | None, int]:
    """Load canonical durable state. Missing rows are a normal first turn.

    Database errors fail closed (raise) so callers never save over unknown state.
    """
    if not _valid_org_id(organization_id) or not session_id:
        return None, 0
    from app.memory_api_client import (
        ConversationContextApiError,
        _use_api,
        api_load_context,
    )

    if _use_api():
        try:
            return api_load_context(organization_id, user_id, session_id)
        except ConversationContextApiError as exc:
            raise ConversationContextLoadError(
                "conversation_context could not be loaded"
            ) from exc
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT context, version
                    FROM conversation_contexts
                    WHERE organization_id = %s::bigint
                      AND user_key = %s
                      AND session_key = %s
                      AND (expires_at IS NULL OR expires_at > NOW())
                    """,
                    (organization_id, str(user_id or "anonymous"), session_id),
                )
                row = cur.fetchone()
        if not row:
            return None, 0
        return dict(row.get("context") or {}), int(row.get("version") or 0)
    except Exception as exc:
        raise ConversationContextLoadError(
            "conversation_context could not be loaded"
        ) from exc


def save_conversation_context(
    organization_id: str,
    user_id: str | None,
    session_id: str,
    context: dict[str, Any],
    *,
    expected_version: int = 0,
) -> int:
    """Persist canonical state; Postgres is authoritative across restarts."""
    if not _valid_org_id(organization_id) or not session_id:
        return 0
    from app.memory_api_client import (
        ConversationContextApiError,
        ConversationContextStaleError,
        _use_api,
        api_save_context,
    )

    if _use_api():
        try:
            return api_save_context(
                organization_id,
                user_id,
                session_id,
                context,
                expected_version=expected_version,
            )
        except ConversationContextStaleError as exc:
            raise StaleConversationContextError(str(exc)) from exc
        except ConversationContextApiError as exc:
            raise ConversationContextLoadError(
                "conversation_context could not be saved"
            ) from exc
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO conversation_contexts
                  (organization_id, user_key, session_key, context, version, expires_at)
                VALUES (%s::bigint, %s, %s, %s, 1, NOW() + INTERVAL '30 days')
                ON CONFLICT (organization_id, user_key, session_key)
                DO UPDATE SET
                  context = EXCLUDED.context,
                  version = conversation_contexts.version + 1,
                  updated_at = NOW(),
                  expires_at = EXCLUDED.expires_at
                WHERE conversation_contexts.version = %s
                RETURNING version
                """,
                (
                    organization_id,
                    str(user_id or "anonymous"),
                    session_id,
                    Jsonb(context),
                    max(0, int(expected_version)),
                ),
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                raise StaleConversationContextError(
                    "conversation_context was updated by another turn"
                )
        conn.commit()
    return int((row or {}).get("version") or 0)


def persist_workflow_events(
    organization_id: str,
    user_id: str | None,
    session_id: str,
    request_id: str,
    events: list[dict[str, Any]],
) -> None:
    if not events or not _valid_org_id(organization_id) or not session_id:
        return
    from app.memory_api_client import ConversationContextApiError, _use_api, api_persist_workflow_events

    if _use_api():
        try:
            api_persist_workflow_events(
                organization_id, user_id, session_id, request_id, events
            )
        except ConversationContextApiError:
            return
        return
    with db_conn() as conn:
        with conn.cursor() as cur:
            for event in events:
                cur.execute(
                    """
                    INSERT INTO workflow_events
                      (organization_id, user_key, session_key, request_id,
                       conversation_context_id, workflow_id, workflow_type,
                       event_type, event_data, version, created_at, expires_at)
                    VALUES (
                      %s::bigint, %s, %s, %s,
                      (SELECT id FROM conversation_contexts
                       WHERE organization_id = %s::bigint
                         AND user_key = %s AND session_key = %s),
                      %s, %s, %s, %s, %s, %s::timestamptz,
                      NOW() + INTERVAL '30 days'
                    )
                    """,
                    (
                        organization_id,
                        str(user_id or "anonymous"),
                        session_id,
                        request_id,
                        organization_id,
                        str(user_id or "anonymous"),
                        session_id,
                        (event.get("details") or {}).get("workflow"),
                        (event.get("details") or {}).get("workflow")
                        or (event.get("details") or {}).get("operation")
                        or "general",
                        str(event.get("event_type") or ""),
                        Jsonb(event.get("details") or {}),
                        max(
                            1,
                            int(
                                (event.get("details") or {}).get("state_version")
                                or 1
                            ),
                        ),
                        event.get("occurred_at"),
                    ),
                )
        conn.commit()


@lru_cache
def get_saver() -> _SimpleThreadStore:
    """Process-wide thread store (LangGraph InMemorySaver removed)."""
    return _SimpleThreadStore()


def build_thread_id(organization_id: str, session_id: str) -> str:
    """Tenant-isolated thread key."""
    return f"{organization_id}:{session_id}"


def thread_config(thread_id: str) -> dict[str, Any]:
    """Legacy runnable-config fragment for transitional callers."""
    return {"configurable": {"thread_id": thread_id}}


def touch(thread_id: str) -> None:
    """Record activity and expire stale threads."""
    now = time.time()
    with _LOCK:
        _LAST_SEEN[thread_id] = now
        _sweep_unlocked(now)


def prune_thread(thread_id: str) -> None:
    """Keep only the latest checkpoint for this thread (bound in-memory growth)."""
    try:
        get_saver().prune([thread_id], strategy="keep_latest")
    except Exception:
        # Prune is best-effort; never fail a chat turn on memory housekeeping.
        pass


def delete_thread(thread_id: str) -> None:
    """Drop all checkpoints for a thread."""
    try:
        get_saver().delete_thread(thread_id)
    except Exception:
        pass
    with _LOCK:
        _LAST_SEEN.pop(thread_id, None)


def _sweep_unlocked(now: float | None = None) -> None:
    now = now if now is not None else time.time()
    dead = [tid for tid, ts in _LAST_SEEN.items() if now - ts > _TTL_SECONDS]
    for tid in dead:
        try:
            get_saver().delete_thread(tid)
        except Exception:
            pass
        _LAST_SEEN.pop(tid, None)


def sweep() -> None:
    """Public TTL sweep (also runs inside touch)."""
    with _LOCK:
        _sweep_unlocked()


def reset_for_tests() -> None:
    """Wipe in-process memory singletons (tests only)."""
    with _LOCK:
        _LAST_SEEN.clear()
    get_saver.cache_clear()
    try:
        from app.graph import get_compiled_graph

        get_compiled_graph.cache_clear()
    except Exception:
        pass
    try:
        from app.mcp.catalog import catalog_by_name, load_shared_catalog

        catalog_by_name.cache_clear()
        load_shared_catalog.cache_clear()
    except Exception:
        pass


# --- Agent memory (user preferences + long-term facts; skill memory.md) ---

_AGENT_MEMORY_READY = False
_AGENT_MEMORY_UNAVAILABLE = False
_AGENT_MEMORY_LOCK = Lock()
_AGENT_PREF_FALLBACK: dict[tuple[str, str], dict[str, Any]] = {}
_AGENT_LTM_FALLBACK: list[dict[str, Any]] = []


def _agent_memory_connect():
    """Short-timeout connection so missing DB cannot stall tool loops."""
    import psycopg
    from psycopg.rows import dict_row

    from app.config import get_settings

    settings = get_settings()
    conn = psycopg.connect(
        settings.database_url,
        row_factory=dict_row,
        connect_timeout=3,
        options="-c search_path=ticketing",
    )
    with conn.cursor() as cur:
        cur.execute("SET search_path TO ticketing")
    return conn


def ensure_agent_memory_tables() -> None:
    """Create user-preference and long-term memory tables if missing."""
    global _AGENT_MEMORY_READY, _AGENT_MEMORY_UNAVAILABLE
    if _AGENT_MEMORY_READY or _AGENT_MEMORY_UNAVAILABLE:
        return
    with _AGENT_MEMORY_LOCK:
        if _AGENT_MEMORY_READY or _AGENT_MEMORY_UNAVAILABLE:
            return
        try:
            with _agent_memory_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS agent_user_preferences (
                          organization_id  BIGINT NOT NULL,
                          user_key         TEXT NOT NULL
                            CHECK (length(btrim(user_key)) BETWEEN 1 AND 255),
                          soft             JSONB NOT NULL DEFAULT '{}'::jsonb
                            CHECK (jsonb_typeof(soft) = 'object'),
                          hard             JSONB NOT NULL DEFAULT '{}'::jsonb
                            CHECK (jsonb_typeof(hard) = 'object'),
                          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                          PRIMARY KEY (organization_id, user_key)
                        )
                        """
                    )
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS agent_long_term_memory (
                          id               BIGSERIAL PRIMARY KEY,
                          organization_id  BIGINT NOT NULL,
                          user_key         TEXT NOT NULL
                            CHECK (length(btrim(user_key)) BETWEEN 1 AND 255),
                          conversation_id  TEXT
                            CHECK (
                              conversation_id IS NULL
                              OR length(btrim(conversation_id)) BETWEEN 1 AND 255
                            ),
                          kind             TEXT NOT NULL DEFAULT 'fact'
                            CHECK (length(btrim(kind)) BETWEEN 1 AND 64),
                          content          TEXT NOT NULL
                            CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
                          payload          JSONB NOT NULL DEFAULT '{}'::jsonb
                            CHECK (jsonb_typeof(payload) = 'object'),
                          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """
                    )
                    cur.execute(
                        """
                        CREATE INDEX IF NOT EXISTS idx_agent_ltm_actor
                          ON agent_long_term_memory (organization_id, user_key, created_at DESC)
                        """
                    )
                    cur.execute(
                        """
                        CREATE INDEX IF NOT EXISTS idx_agent_ltm_content
                          ON agent_long_term_memory
                          USING GIN (to_tsvector('english', content))
                        """
                    )
                conn.commit()
            _AGENT_MEMORY_READY = True
        except Exception:
            _AGENT_MEMORY_UNAVAILABLE = True
            raise


def load_user_preferences(organization_id: str, user_id: str | None) -> dict[str, Any]:
    user_key = str(user_id or "anonymous").strip() or "anonymous"
    if not _valid_org_id(organization_id):
        return {"soft": {}, "hard": {}}
    try:
        ensure_agent_memory_tables()
    except Exception:
        cached = _AGENT_PREF_FALLBACK.get((organization_id, user_key))
        return dict(cached) if cached else {"soft": {}, "hard": {}}
    if _AGENT_MEMORY_UNAVAILABLE:
        cached = _AGENT_PREF_FALLBACK.get((organization_id, user_key))
        return dict(cached) if cached else {"soft": {}, "hard": {}}
    try:
        with _agent_memory_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT soft, hard FROM agent_user_preferences
                    WHERE organization_id = %s::bigint AND user_key = %s
                    """,
                    (organization_id, user_key),
                )
                row = cur.fetchone() or {}
    except Exception:
        cached = _AGENT_PREF_FALLBACK.get((organization_id, user_key))
        return dict(cached) if cached else {"soft": {}, "hard": {}}
    soft = row.get("soft") if isinstance(row.get("soft"), dict) else {}
    hard = row.get("hard") if isinstance(row.get("hard"), dict) else {}
    return {"soft": dict(soft), "hard": dict(hard)}


def upsert_user_preferences(
    organization_id: str,
    user_id: str | None,
    *,
    soft: dict[str, Any] | None = None,
    hard: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not _valid_org_id(organization_id):
        raise ValueError("organization_id required")
    user_key = str(user_id or "anonymous").strip() or "anonymous"
    current = load_user_preferences(organization_id, user_id)
    merged_soft = {**current["soft"], **dict(soft)} if soft is not None else current["soft"]
    merged_hard = {**current["hard"], **dict(hard)} if hard is not None else current["hard"]
    out = {"soft": merged_soft, "hard": merged_hard}
    try:
        ensure_agent_memory_tables()
        if _AGENT_MEMORY_UNAVAILABLE:
            _AGENT_PREF_FALLBACK[(organization_id, user_key)] = out
            return out
        with _agent_memory_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_user_preferences
                      (organization_id, user_key, soft, hard, updated_at)
                    VALUES (%s::bigint, %s, %s, %s, NOW())
                    ON CONFLICT (organization_id, user_key)
                    DO UPDATE SET
                      soft = EXCLUDED.soft,
                      hard = EXCLUDED.hard,
                      updated_at = NOW()
                    """,
                    (organization_id, user_key, Jsonb(merged_soft), Jsonb(merged_hard)),
                )
            conn.commit()
    except Exception:
        _AGENT_PREF_FALLBACK[(organization_id, user_key)] = out
    return out


def store_long_term_memory(
    *,
    organization_id: str,
    user_id: str | None,
    conversation_id: str | None,
    item: dict[str, Any],
) -> str:
    if not _valid_org_id(organization_id):
        raise ValueError("organization_id required")
    user_key = str(user_id or "anonymous").strip() or "anonymous"
    content = str(
        (item or {}).get("content")
        or (item or {}).get("text")
        or (item or {}).get("summary")
        or ""
    ).strip()
    if not content:
        raise ValueError("content required")
    kind = str((item or {}).get("kind") or "fact").strip() or "fact"
    payload = {
        k: v
        for k, v in dict(item or {}).items()
        if k not in {"content", "text", "summary", "kind", "id"}
    }
    try:
        ensure_agent_memory_tables()
        if _AGENT_MEMORY_UNAVAILABLE:
            raise RuntimeError("agent memory unavailable")
        with _agent_memory_connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_long_term_memory
                      (organization_id, user_key, conversation_id, kind, content, payload)
                    VALUES (%s::bigint, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        organization_id,
                        user_key,
                        (str(conversation_id).strip() or None) if conversation_id else None,
                        kind[:64],
                        content[:4000],
                        Jsonb(payload),
                    ),
                )
                row = cur.fetchone() or {}
            conn.commit()
        return str(row.get("id") or "")
    except Exception:
        import uuid as _uuid

        item_id = str(_uuid.uuid4())
        _AGENT_LTM_FALLBACK.append(
            {
                "id": item_id,
                "organization_id": organization_id,
                "user_key": user_key,
                "conversation_id": conversation_id,
                "kind": kind,
                "content": content[:4000],
                "payload": payload,
            }
        )
        return item_id


def search_long_term_memory(
    *,
    organization_id: str,
    user_id: str | None,
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    if not _valid_org_id(organization_id):
        return []
    user_key = str(user_id or "anonymous").strip() or "anonymous"
    q = str(query or "").strip()
    lim = max(1, min(20, int(limit or 5)))
    try:
        ensure_agent_memory_tables()
        if _AGENT_MEMORY_UNAVAILABLE:
            raise RuntimeError("agent memory unavailable")
        with _agent_memory_connect() as conn:
            with conn.cursor() as cur:
                if q:
                    cur.execute(
                        """
                        SELECT id, kind, content, payload, conversation_id, created_at
                        FROM agent_long_term_memory
                        WHERE organization_id = %s::bigint
                          AND user_key = %s
                          AND (
                            to_tsvector('english', content)
                              @@ plainto_tsquery('english', %s)
                            OR content ILIKE '%%' || %s || '%%'
                          )
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        (organization_id, user_key, q, q[:200], lim),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, kind, content, payload, conversation_id, created_at
                        FROM agent_long_term_memory
                        WHERE organization_id = %s::bigint AND user_key = %s
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        (organization_id, user_key, lim),
                    )
                rows = cur.fetchall() or []
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "id": str(row.get("id") or ""),
                    "kind": row.get("kind"),
                    "content": row.get("content"),
                    "payload": row.get("payload")
                    if isinstance(row.get("payload"), dict)
                    else {},
                    "conversation_id": row.get("conversation_id"),
                    "created_at": str(row.get("created_at") or ""),
                }
            )
        return out
    except Exception:
        # Token AND match (mirrors plainto_tsquery): every query word must appear.
        hits: list[dict[str, Any]] = []
        tokens = [t for t in q.lower().split() if t]
        for row in reversed(_AGENT_LTM_FALLBACK):
            if row.get("organization_id") != organization_id or row.get("user_key") != user_key:
                continue
            content_l = str(row.get("content") or "").lower()
            if tokens and not all(token in content_l for token in tokens):
                continue
            hits.append(
                {
                    "id": row.get("id"),
                    "kind": row.get("kind"),
                    "content": row.get("content"),
                    "payload": row.get("payload") or {},
                    "conversation_id": row.get("conversation_id"),
                    "created_at": "",
                }
            )
            if len(hits) >= lim:
                break
        return hits


def recent_long_term_memory(
    *,
    organization_id: str,
    user_id: str | None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    return search_long_term_memory(
        organization_id=organization_id,
        user_id=user_id,
        query="",
        limit=limit,
    )


def verify_hard_preference_action(
    *,
    organization_id: str,
    user_id: str | None,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
    channel: str | None = None,
) -> dict[str, Any]:
    """Deterministic hard-preference gate (skill PreferenceScratchpad)."""
    prefs = load_user_preferences(organization_id, user_id)
    hard = prefs.get("hard") if isinstance(prefs.get("hard"), dict) else {}
    tool = str(tool_name or "").strip()
    args = dict(arguments or {})
    ch = str(
        channel
        or args.get("channel")
        or args.get("notify_channel")
        or args.get("delivery_channel")
        or ""
    ).strip().lower()
    reasons: list[str] = []

    blocked_tools = {
        str(x).strip()
        for x in (hard.get("blocked_tools") or hard.get("block_tools") or [])
        if str(x).strip()
    }
    if tool and tool in blocked_tools:
        reasons.append(f"tool '{tool}' is blocked by hard preference")

    channel_bans = {
        str(x).strip().lower()
        for x in (hard.get("channel_bans") or hard.get("banned_channels") or [])
        if str(x).strip()
    }
    notify_tools = {
        "send_staff_notification",
        "notification_personalize_deliver",
    }
    if ch and ch in channel_bans:
        reasons.append(f"channel '{ch}' is banned by hard preference")
    if tool in notify_tools and hard.get("never_notify") is True:
        reasons.append("notifications are disabled by hard preference")

    approval_tools = {
        str(x).strip()
        for x in (
            hard.get("require_approval_tools") or hard.get("approval_required_tools") or []
        )
        if str(x).strip()
    }
    if reasons:
        return {
            "decision": "block",
            "reasons": reasons,
            "hard": hard,
        }
    if tool and tool in approval_tools:
        return {
            "decision": "approval_required",
            "reasons": [f"tool '{tool}' requires approval per hard preference"],
            "hard": hard,
        }
    return {"decision": "allow", "reasons": [], "hard": hard}
