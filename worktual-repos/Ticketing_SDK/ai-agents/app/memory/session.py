"""Shared conversation memory for supervisor + specialists + tool loop.

Four-layer split follows `.cursor/skills/build-nlp-agents/memory.md`:
working / short-term / long-term / preference scratchpad.
SharedMemory composes those layers over durable conversation context.
"""

from __future__ import annotations

import copy
import json
from typing import Any

from app.contracts.errors import MemoryConflict
from app.memory.durable_store import (
    load_conversation_context,
    persist_workflow_events,
    save_conversation_context,
)
from app.workflow_state import normalize_conversation_context


ALLOWED_DURABLE_KEYS = frozenset(
    {
        "current_workflow",
        "parked_workflows",
        "parked_drafts",
        "ticket_draft",
        "team_draft",
        "kb_draft",
        "macro_draft",
        "customer_draft",
        "priority_draft",
        "status_draft",
        "escalate_draft",
        "reassign_draft",
        "last_entity",
        "recent_entities",
        "last_query",
        "recent_history",
        "short_term_summary",
        "long_term_snippets",
        "preferences",
        "tool_memory",
        "last_tool_outcome",
        "pending_confirm",
        "pending_resume",
        "slots",
        "pending_ask",
        "active_agent",
        "active_domain",
        "active_executor",
        "active_task",
        "task_state",
        "parked_tasks",
        "last_cancelled_task",
        "skill_name",
        "skill_version",
        "skill_digest",
        "dependency_results",
        "confirmation_evidence",
        "idempotency_key",
        "handoff_trace",
        "offer_continue_ticket_after_customer",
        "ticket_list_cursor",
        "customer_list_cursor",
        "kb_list_cursor",
        "customer_360_candidate",
        "last_customer_360_tickets",
        "ticket_draft_at_turn_start",
        "team_draft_at_turn_start",
        "kb_draft_at_turn_start",
        "macro_draft_at_turn_start",
        "customer_draft_at_turn_start",
        "priority_draft_at_turn_start",
        "status_draft_at_turn_start",
        "escalate_draft_at_turn_start",
        "reassign_draft_at_turn_start",
        "reply_locale",
    }
)

# Active harness task → guided draft key (working-memory slot surface).
_TASK_DRAFT_KEY: dict[str, str] = {
    "priority.create": "priority_draft",
    "status.create": "status_draft",
    "customer.create": "customer_draft",
    "ticket.create": "ticket_draft",
    "macro.create": "macro_draft",
    "knowledge.article.create": "kb_draft",
    "team.create": "team_draft",
    "team.members.update": "team_draft",
    "ticket.escalate": "escalate_draft",
    "ticket.reassign": "reassign_draft",
}

_GUIDED_DRAFT_KEYS: tuple[str, ...] = (
    "ticket_draft",
    "customer_draft",
    "priority_draft",
    "status_draft",
    "team_draft",
    "kb_draft",
    "macro_draft",
    "escalate_draft",
    "reassign_draft",
)


class WorkingMemory:
    """Current-task scratch state for slot filling (skill WorkingMemory)."""

    def __init__(self, memory: "SharedMemory") -> None:
        self._memory = memory

    def get(self, key: str) -> object | None:
        key = str(key or "").strip()
        if not key:
            return None
        if key == "task":
            state = self._memory.current_task_state()
            return state.model_dump(mode="json") if state else None
        if key == "slots":
            state = self._memory.current_task_state()
            return dict(state.collected) if state else {}
        if key in _GUIDED_DRAFT_KEYS or key in {
            "current_workflow",
            "pending_ask",
            "last_tool_outcome",
            "slots",
        }:
            return self._memory.durable.get(key)
        state = self._memory.current_task_state()
        if state and key in (state.collected or {}):
            return state.collected.get(key)
        return self._memory.durable.get(key)

    def set(self, key: str, value: object) -> None:
        key = str(key or "").strip()
        if not key:
            return
        if key in _GUIDED_DRAFT_KEYS:
            if value is None:
                self._memory.durable.pop(key, None)
            elif isinstance(value, dict):
                self._memory.durable[key] = dict(value)
            else:
                self._memory.durable[key] = value
            return
        if key in {"current_workflow", "pending_ask", "last_tool_outcome", "slots"}:
            self._memory.durable[key] = value
            return
        state = self._memory.current_task_state()
        if state is not None:
            collected = dict(state.collected or {})
            if value is None:
                collected.pop(key, None)
            else:
                collected[key] = value
            self._memory.set_task_state(
                state.model_copy(update={"collected": collected})
            )
            return
        self._memory.durable[key] = value

    def update(self, values: dict[str, object]) -> None:
        if not isinstance(values, dict):
            return
        for key, value in values.items():
            self.set(str(key), value)

    def clear(self) -> None:
        """Reset working scratch for the active task boundary."""
        state = self._memory.current_task_state()
        draft_key = _TASK_DRAFT_KEY.get(state.task_id) if state else None
        if draft_key:
            self._memory.durable.pop(draft_key, None)
        for key in (
            "current_workflow",
            "pending_ask",
            "slots",
            "last_tool_outcome",
            "offer_continue_ticket_after_customer",
        ):
            self._memory.durable.pop(key, None)
        self._memory.set_task_state(None)

    def as_dict(self) -> dict[str, Any]:
        state = self._memory.current_task_state()
        task = state.model_dump(mode="json") if state else None
        draft_key = _TASK_DRAFT_KEY.get(state.task_id) if state else None
        active_draft = None
        if draft_key:
            blob = self._memory.durable.get(draft_key)
            active_draft = dict(blob) if isinstance(blob, dict) else None
        guided = {
            key: dict(val)
            for key in _GUIDED_DRAFT_KEYS
            if isinstance((val := self._memory.durable.get(key)), dict)
        }
        last_tool = self._memory.durable.get("last_tool_outcome")
        last_entity = self._memory.durable.get("last_entity")
        out: dict[str, Any] = {
            "task": task,
            "slots": dict(state.collected) if state else {},
            "active_draft_key": draft_key,
            "active_draft": active_draft,
            "guided_drafts": guided,
            # UI-open item (ticket/team/KB/macro/…) hydrated from Express — use for
            # pronouns like "this" / "here" / "add a member".
            "last_entity": dict(last_entity) if isinstance(last_entity, dict) else None,
            "current_workflow": str(self._memory.durable.get("current_workflow") or "")
            or None,
            "pending_ask": self._memory.durable.get("pending_ask"),
            "last_tool_outcome": dict(last_tool) if isinstance(last_tool, dict) else None,
            "offer_continue_ticket_after_customer": bool(
                self._memory.durable.get("offer_continue_ticket_after_customer")
            ),
        }
        # Flat TaskState fields for callers that read working.skill_name etc.
        if isinstance(task, dict):
            for key, value in task.items():
                out.setdefault(key, value)
        return out

    def as_prompt_block(self) -> str:
        payload = self.as_dict()
        return "## Working memory\n" + json.dumps(
            payload, ensure_ascii=False, default=str
        )


class ShortTermMemory:
    """Session transcript + running summary (skill ShortTermMemory)."""

    def __init__(self, memory: "SharedMemory") -> None:
        self._memory = memory

    def add_message(self, message: dict) -> None:
        if not isinstance(message, dict):
            return
        role = str(message.get("role") or "").strip()
        content = str(message.get("content") or message.get("text") or "").strip()
        if role and content:
            self._memory.add_message(role, content)

    def get_messages(self, limit: int | None = None) -> list[dict]:
        msgs = list(self._memory.messages)
        if limit is not None and limit >= 0:
            return msgs[-limit:]
        return msgs

    def set_summary(self, summary: str) -> None:
        self._memory.durable["short_term_summary"] = str(summary or "")[:4000]

    def get_summary(self) -> str | None:
        text = str(self._memory.durable.get("short_term_summary") or "").strip()
        return text or None

    def clear(self) -> None:
        self._memory.messages = []
        self._memory.durable["recent_history"] = []
        self._memory.durable.pop("short_term_summary", None)

    def as_dict(self) -> dict[str, Any]:
        recent = [
            item
            for item in list(self._memory.durable.get("recent_history") or [])[-80:]
            if isinstance(item, dict)
        ]
        return {
            "summary": (self.get_summary() or "")[:4000] or None,
            "recent_turns": recent,
        }

    def as_prompt_block(self) -> str:
        return "## Short-term memory\n" + json.dumps(
            self.as_dict(), ensure_ascii=False, default=str
        )


class LongTermMemory:
    """Cross-session Postgres memory (skill LongTermMemory; sync adapter)."""

    def __init__(self, memory: "SharedMemory") -> None:
        self._memory = memory

    def store(
        self,
        *,
        tenant_id: str,
        user_id: str,
        conversation_id: str,
        item: dict,
    ) -> str:
        from app.memory.durable_store import store_long_term_memory

        item_id = store_long_term_memory(
            organization_id=tenant_id or self._memory.organization_id,
            user_id=user_id or self._memory.user_id,
            conversation_id=conversation_id or self._memory.session_id,
            item=dict(item or {}),
        )
        # Keep session inject list warm.
        rows = list(self._memory.durable.get("long_term_snippets") or [])
        entry = dict(item or {})
        entry["id"] = item_id
        rows.append(entry)
        self._memory.durable["long_term_snippets"] = rows[-50:]
        return item_id

    def search(
        self,
        *,
        tenant_id: str,
        user_id: str,
        query: str,
        limit: int = 5,
    ) -> list[dict]:
        from app.memory.durable_store import search_long_term_memory

        hits = search_long_term_memory(
            organization_id=tenant_id or self._memory.organization_id,
            user_id=user_id or self._memory.user_id,
            query=query,
            limit=limit,
        )
        self._memory.durable["long_term_snippets"] = hits
        return hits

    def get_recent(
        self,
        *,
        tenant_id: str,
        user_id: str,
        limit: int = 10,
    ) -> list[dict]:
        from app.memory.durable_store import recent_long_term_memory

        rows = recent_long_term_memory(
            organization_id=tenant_id or self._memory.organization_id,
            user_id=user_id or self._memory.user_id,
            limit=limit,
        )
        self._memory.durable["long_term_snippets"] = rows
        return rows

    def as_dict(self) -> list[Any]:
        cached = self._memory.durable.get("long_term_snippets")
        if isinstance(cached, list) and cached:
            return [
                dict(row) if isinstance(row, dict) else {"value": row}
                for row in cached[:10]
            ]
        try:
            return self.get_recent(
                tenant_id=self._memory.organization_id,
                user_id=self._memory.user_id,
                limit=10,
            )
        except Exception:  # noqa: BLE001
            return []

    def as_prompt_block(self) -> str:
        snippets = self.as_dict()
        if not snippets:
            return "## Long-term memory\n[]"
        return "## Long-term memory\n" + json.dumps(
            snippets, ensure_ascii=False, default=str
        )


class PreferenceScratchpad:
    """User preference scratchpad backed by Postgres (skill PreferenceScratchpad)."""

    def __init__(self, memory: "SharedMemory") -> None:
        self._memory = memory

    def get(self, *, tenant_id: str, user_id: str) -> dict:
        from app.memory.durable_store import load_user_preferences

        try:
            prefs = load_user_preferences(
                tenant_id or self._memory.organization_id,
                user_id or self._memory.user_id,
            )
        except Exception:  # noqa: BLE001
            current = self._memory.durable.get("preferences")
            current = dict(current) if isinstance(current, dict) else {}
            prefs = {
                "soft": dict(current.get("soft") or {}),
                "hard": dict(current.get("hard") or {}),
            }
        self._memory.durable["preferences"] = {
            "soft": prefs.get("soft") or {},
            "hard": prefs.get("hard") or {},
        }
        return prefs

    def upsert(self, *, tenant_id: str, user_id: str, patch: dict) -> dict:
        from app.memory.durable_store import upsert_user_preferences

        patch = dict(patch) if isinstance(patch, dict) else {}
        soft_patch: dict[str, Any] | None = None
        hard_patch: dict[str, Any] | None = None
        if isinstance(patch.get("soft"), dict):
            soft_patch = dict(patch["soft"])
        if isinstance(patch.get("hard"), dict):
            hard_patch = dict(patch["hard"])
        kind = str(patch.get("kind") or "").strip().lower()
        key = str(patch.get("key") or "").strip()
        if key and kind in {"soft", "hard"}:
            if kind == "soft":
                soft_patch = {**(soft_patch or {}), key: patch.get("value")}
            else:
                hard_patch = {**(hard_patch or {}), key: patch.get("value")}
        try:
            current = upsert_user_preferences(
                tenant_id or self._memory.organization_id,
                user_id or self._memory.user_id,
                soft=soft_patch,
                hard=hard_patch,
            )
        except Exception:  # noqa: BLE001
            current = self.get(
                tenant_id=tenant_id or self._memory.organization_id,
                user_id=user_id or self._memory.user_id,
            )
            if soft_patch:
                current["soft"].update(soft_patch)
            if hard_patch:
                current["hard"].update(hard_patch)
            self._memory.durable["preferences"] = {
                "soft": current["soft"],
                "hard": current["hard"],
            }
            return current
        self._memory.durable["preferences"] = {
            "soft": current.get("soft") or {},
            "hard": current.get("hard") or {},
        }
        return current

    def as_dict(self) -> dict[str, Any]:
        # Prefer turn-hydrated durable prefs (orchestrator / prior get) to avoid
        # duplicate DB hits when building soft + hard prompt blocks.
        cached = self._memory.durable.get("preferences")
        if isinstance(cached, dict) and (
            isinstance(cached.get("soft"), dict) or isinstance(cached.get("hard"), dict)
        ):
            return {
                "soft": dict(cached.get("soft") or {}),
                "hard_constraints": dict(cached.get("hard") or {}),
            }
        prefs = self.get(
            tenant_id=self._memory.organization_id,
            user_id=self._memory.user_id,
        )
        return {
            "soft": prefs.get("soft") or {},
            "hard_constraints": prefs.get("hard") or {},
        }

    def soft_prompt_block(self) -> str:
        soft = self.as_dict().get("soft") or {}
        if not soft:
            return "## Soft preferences\n{}"
        return "## Soft preferences\n" + json.dumps(
            soft, ensure_ascii=False, default=str
        )

    def hard_prompt_block(self) -> str:
        hard = self.as_dict().get("hard_constraints") or {}
        if not hard:
            return "## Hard preference constraints\n{}"
        return (
            "## Hard preference constraints\n"
            + json.dumps(hard, ensure_ascii=False, default=str)
            + "\n(Informational only; verification tools enforce.)"
        )


class SharedMemory:
    """Composer over working / short-term / long-term / preference layers."""

    def __init__(
        self,
        *,
        organization_id: str | None,
        user_id: str | None,
        session_id: str | None,
        request_id: str | None = None,
        session_memory: dict[str, Any] | None = None,
        durable: dict[str, Any] | None = None,
        version: int = 0,
        history: list[dict[str, Any]] | None = None,
    ) -> None:
        self.organization_id = organization_id or ""
        self.user_id = user_id or "anonymous"
        self.session_id = session_id or ""
        self.request_id = request_id or ""
        self.version = int(version or 0)
        self.session_memory = dict(session_memory or {})
        self.durable = self._normalize_durable(durable)
        self.messages: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.handoff_trace: list[str] = list(self.durable.get("handoff_trace") or [])
        self.working = WorkingMemory(self)
        self.short_term = ShortTermMemory(self)
        self.long_term = LongTermMemory(self)
        self.preferences = PreferenceScratchpad(self)
        if history:
            for item in history:
                if isinstance(item, dict):
                    role = str(item.get("role") or "")
                    text = str(item.get("text") or item.get("content") or "")
                    if role in ("user", "assistant") and text.strip():
                        self.messages.append({"role": role, "content": text.strip()})
        self._merge_recent_history_into_messages()

    @staticmethod
    def _normalize_durable(raw: dict[str, Any] | None) -> dict[str, Any]:
        """Canonical context plus allowlisted draft/workflow keys for native runs."""
        data = raw if isinstance(raw, dict) else {}
        normalized = normalize_conversation_context(data)
        for key in ALLOWED_DURABLE_KEYS:
            if key not in data:
                continue
            if key in normalized and normalized.get(key) is not None:
                continue
            value = data.get(key)
            if value is None:
                continue
            if isinstance(value, (dict, list)):
                normalized[key] = copy.deepcopy(value)
            else:
                normalized[key] = value
        # Legacy current_workflow → active_workflow when missing
        if not normalized.get("active_workflow") and data.get("current_workflow"):
            wf = str(data.get("current_workflow") or "").strip()
            if wf:
                draft_key = f"{wf.replace('create_', '')}_draft"
                if wf == "create_ticket":
                    draft_key = "ticket_draft"
                draft = data.get(draft_key) if isinstance(data.get(draft_key), dict) else {}
                step = str((draft or {}).get("awaiting") or "").strip() or None
                normalized["active_workflow"] = {
                    "workflow_type": wf,
                    "step": step,
                    "data": dict(draft or {}),
                    "status": "active",
                }
                if not normalized.get("active_agent"):
                    normalized["active_agent"] = {
                        "create_ticket": "ticket_creation_executor",
                        "create_team": "team_queue_crud_executor",
                        "create_customer": "customer_directory_crud_executor",
                        "create_macro": "macro_crud_executor",
                        "create_kb": "kb_quality_crud_executor",
                    }.get(wf)
        return normalized

    @classmethod
    def hydrate(
        cls,
        *,
        organization_id: str | None,
        user_id: str | None,
        session_id: str | None,
        request_id: str | None = None,
        session_memory: dict[str, Any] | None = None,
        history: list[dict[str, Any]] | None = None,
        actor_headers: dict[str, str] | None = None,
    ) -> SharedMemory:
        del actor_headers  # durable_store uses settings secret headers
        durable: dict[str, Any] | None = None
        version = 0
        if organization_id and session_id:
            from app.memory.durable_store import ConversationContextLoadError

            try:
                durable, version = load_conversation_context(
                    organization_id, user_id or "anonymous", session_id
                )
            except ConversationContextLoadError:
                raise
            except Exception:
                durable = None
                version = 0
        return cls(
            organization_id=organization_id,
            user_id=user_id,
            session_id=session_id,
            request_id=request_id,
            session_memory=session_memory,
            durable=durable,
            version=version,
            history=history,
        )

    def _merge_recent_history_into_messages(self) -> None:
        """Durable recent_history is shared session memory for every specialist."""
        hist = self.durable.get("recent_history")
        if not isinstance(hist, list) or not hist:
            return
        have = {
            (str(m.get("role") or ""), str(m.get("content") or "").strip())
            for m in self.messages
        }
        extras: list[dict[str, Any]] = []
        for item in hist:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "")
            text = str(item.get("text") or item.get("content") or "").strip()
            if role in ("user", "assistant") and text and (role, text) not in have:
                extras.append({"role": role, "content": text})
                have.add((role, text))
        if extras:
            self.messages = extras + self.messages

    def add_message(self, role: str, content: str, **extra: Any) -> None:
        msg = {"role": role, "content": content, **extra}
        self.messages.append(msg)
        if role in ("user", "assistant") and content:
            hist = list(self.durable.get("recent_history") or [])
            hist.append({"role": role, "text": content})
            self.durable["recent_history"] = hist[-80:]

    @staticmethod
    def _compact_guided_patch_payload(payload: dict[str, Any]) -> dict[str, Any]:
        """Keep awaiting + live draft so the next LLM turn can reason from it."""
        draft = payload.get("draft")
        public: dict[str, Any] = {}
        if isinstance(draft, dict):
            skip = {"available_members", "availableMembers"}
            for key, value in draft.items():
                if str(key).startswith("_") or key in skip:
                    continue
                public[key] = value
        out: dict[str, Any] = {
            "operation": payload.get("operation"),
            "persisted": payload.get("persisted"),
            "awaiting": payload.get("awaiting"),
            "next_action": copy.deepcopy(payload.get("next_action")),
            "correction": payload.get("correction"),
            "ready": payload.get("ready"),
            "missing": payload.get("missing"),
            "updated_fields": payload.get("updated_fields"),
            "workflow": payload.get("workflow"),
            "draft_key": payload.get("draft_key"),
            "skippedFields": payload.get("skippedFields"),
            "draft": public,
        }
        if payload.get("message"):
            out["message"] = payload.get("message")
        return out

    def record_tool(
        self,
        *,
        name: str,
        arguments: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        success = bool(result.get("success", True))
        outcome: dict[str, Any] = {
            "tool": name,
            "success": success,
            "error": None
            if success
            else str(result.get("message") or result.get("error") or ""),
            "error_code": result.get("error_code"),
            "kind": result.get("kind"),
            "message": None
            if success
            else str(result.get("message") or result.get("error") or ""),
            "arguments": arguments,
        }
        if success and name == "list_tickets":
            payload = result.get("payload")
            if isinstance(payload, dict):
                rows = payload.get("data") if isinstance(payload.get("data"), list) else []
                outcome["payload"] = {
                    "totalRows": payload.get("totalRows"),
                    "offset": payload.get("offset"),
                    "limit": payload.get("limit"),
                    "rowCount": len(rows),
                    "hasMore": payload.get("hasMore"),
                    "truncated": payload.get("truncated"),
                    "createdRange": payload.get("createdRange"),
                    "updatedRange": payload.get("updatedRange"),
                }
        elif success and name in {"list_kb", "get_kb"}:
            payload = result.get("payload")
            compact_rows: list[dict[str, Any]] = []
            raw_rows: list[Any] = []
            if isinstance(payload, list):
                raw_rows = payload
            elif isinstance(payload, dict):
                article = payload.get("article")
                if isinstance(article, dict):
                    raw_rows = [article]
                else:
                    raw = (
                        payload.get("articles")
                        or payload.get("data")
                        or payload.get("items")
                    )
                    raw_rows = raw if isinstance(raw, list) else []
            for row in raw_rows[:8]:
                if not isinstance(row, dict):
                    continue
                title = str(row.get("title") or "").strip()
                aid = str(row.get("id") or "").strip()
                if not title and not aid:
                    continue
                body = str(
                    row.get("excerpt") or row.get("content") or row.get("body") or ""
                ).strip()
                compact_rows.append(
                    {
                        "id": aid,
                        "title": title or "Untitled",
                        "excerpt": body[:240],
                        "category": str(row.get("category") or ""),
                    }
                )
            packed = {"articles": compact_rows}
            outcome["result"] = {"success": True, "payload": packed}
            outcome["payload"] = packed
        elif success and str(name).startswith("patch_") and str(name).endswith("_draft"):
            payload = result.get("payload")
            if isinstance(payload, dict):
                compact = self._compact_guided_patch_payload(payload)
                outcome["payload"] = compact
                if compact.get("message"):
                    outcome["message"] = compact["message"]
        if not success:
            if "retryable" in result:
                outcome["retryable"] = bool(result.get("retryable"))
            else:
                from app.contracts.tool_results import write_failure_retryable

                outcome["retryable"] = write_failure_retryable(result)
        self.durable["last_tool_outcome"] = outcome
        try:
            from app.observability.turn_log import record_tool

            record_tool(name, arguments, result)
        except Exception:  # noqa: BLE001
            pass
        tool_memory = dict(self.durable.get("tool_memory") or {})
        tool_memory["last"] = {
            "tool": name,
            "success": success,
            "summary": _compact_payload(result),
        }
        self.durable["tool_memory"] = tool_memory
        self.emit("tool_called", {"tool": name, "success": success})

    def record_handoff(self, from_agent: str, to_agent: str) -> None:
        self.handoff_trace.append(f"{from_agent}->{to_agent}")
        self.durable["handoff_trace"] = self.handoff_trace[-20:]
        self.durable["active_agent"] = to_agent
        self.emit("handoff", {"from": from_agent, "to": to_agent})

    def current_task_state(self) -> "TaskState | None":
        from app.contracts.execution import TaskState

        raw = self.durable.get("task_state")
        if not isinstance(raw, dict):
            return None
        try:
            return TaskState.model_validate(raw)
        except Exception:
            return None

    def set_task_state(self, state: "TaskState | None") -> None:
        if state is None:
            for key in (
                "task_state",
                "active_domain",
                "active_executor",
                "active_task",
                "skill_name",
                "skill_version",
                "skill_digest",
                "dependency_results",
                "confirmation_evidence",
                "idempotency_key",
            ):
                self.durable.pop(key, None)
            return
        self.durable["task_state"] = state.model_dump(mode="json")
        self.durable["active_domain"] = state.domain
        self.durable["active_executor"] = state.executor
        self.durable["active_task"] = state.task_id
        self.durable["skill_name"] = state.skill_name
        self.durable["skill_version"] = state.skill_version
        self.durable["skill_digest"] = state.skill_digest
        self.durable["dependency_results"] = dict(state.dependency_results)
        self.durable["confirmation_evidence"] = (
            state.confirmation.model_dump(mode="json")
            if state.confirmation
            else None
        )
        self.durable["idempotency_key"] = state.idempotency_key
        self.emit(
            "task_state_updated",
            {
                "task_id": state.task_id,
                "skill_name": state.skill_name,
                "status": state.status,
            },
        )

    def harness_prompt_context(self) -> dict[str, Any]:
        """Four-layer prompt context (skill memory.md order as dict)."""
        working = self.working.as_dict()
        guided = working.get("guided_drafts") if isinstance(working, dict) else {}
        guided = guided if isinstance(guided, dict) else {}
        # Top-level draft mirrors kept for older prompt/tests; source of truth is working.
        return {
            "working": working,
            "ticket_draft": guided.get("ticket_draft"),
            "customer_draft": guided.get("customer_draft"),
            "priority_draft": guided.get("priority_draft"),
            "status_draft": guided.get("status_draft"),
            "current_workflow": working.get("current_workflow"),
            "last_tool_outcome": working.get("last_tool_outcome"),
            "offer_continue_ticket_after_customer": working.get(
                "offer_continue_ticket_after_customer"
            ),
            "short_term": self.short_term.as_dict(),
            "long_term": self.long_term.as_dict(),
            "preferences": self.preferences.as_dict(),
        }

    def memory_prompt_blocks(self) -> str:
        """Skill memory injection order: working → ST → LT → soft → hard."""
        return "\n\n".join(
            [
                self.working.as_prompt_block(),
                self.short_term.as_prompt_block(),
                self.long_term.as_prompt_block(),
                self.preferences.soft_prompt_block(),
                self.preferences.hard_prompt_block(),
            ]
        )

    def set_preference_memory(
        self,
        *,
        soft: dict[str, Any] | None = None,
        hard: dict[str, Any] | None = None,
    ) -> None:
        patch: dict[str, Any] = {}
        if soft is not None:
            patch["soft"] = dict(soft)
        if hard is not None:
            patch["hard"] = dict(hard)
        if patch:
            self.preferences.upsert(
                tenant_id=self.organization_id,
                user_id=self.user_id,
                patch=patch,
            )

    def emit(self, event_type: str, details: dict[str, Any] | None = None) -> None:
        self.events.append(
            {
                "event_type": event_type,
                "type": event_type,
                "details": details or {},
                "version": self.version,
            }
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            "session_memory": copy.deepcopy(self.session_memory),
            "durable": copy.deepcopy(self.durable),
            "messages": list(self.messages),
            "handoff_trace": list(self.handoff_trace),
            "version": self.version,
        }

    def allowlisted_durable(self) -> dict[str, Any]:
        return {k: v for k, v in self.durable.items() if k in ALLOWED_DURABLE_KEYS}

    def _persist_once(self) -> int:
        self.version = save_conversation_context(
            self.organization_id,
            self.user_id,
            self.session_id,
            self.allowlisted_durable(),
            expected_version=self.version,
        )
        if self.events and self.request_id:
            try:
                persist_workflow_events(
                    self.organization_id,
                    self.user_id,
                    self.session_id,
                    self.request_id,
                    self.events,
                )
            except Exception:
                pass
            self.events = []
        return self.version

    def _reload_and_merge_for_retry(self) -> None:
        """After a CAS conflict, adopt the newer row then re-apply this turn's durable."""
        from app.memory.durable_store import ConversationContextLoadError

        try:
            latest, version = load_conversation_context(
                self.organization_id,
                self.user_id,
                self.session_id,
            )
        except ConversationContextLoadError:
            raise
        except Exception:
            latest, version = None, self.version
        base = dict(latest or {})
        # This turn's allowlisted writes win, but do not clobber concurrent
        # non-null values (e.g. /focus last_entity) with normalized nulls.
        for key, value in self.allowlisted_durable().items():
            if value is None and base.get(key) is not None:
                continue
            base[key] = value
        self.durable = self._normalize_durable(base)
        self.version = int(version or 0)

    def persist(
        self,
        *,
        actor_headers: dict[str, str] | None = None,
        max_retries: int = 3,
    ) -> int:
        """Persist durable state with optimistic-concurrency retries.

        Concurrent `/focus` (or another turn) can bump version between hydrate and
        save. Retry by reloading the newer row and re-applying this turn's state.
        """
        del actor_headers
        if not self.organization_id or not self.session_id:
            return self.version
        attempts = max(1, int(max_retries or 1))
        last_exc: Exception | None = None
        for attempt in range(attempts):
            try:
                return self._persist_once()
            except Exception as exc:
                is_conflict = (
                    isinstance(exc, MemoryConflict)
                    or "updated by another turn" in str(exc).lower()
                    or "409" in str(exc)
                )
                if not is_conflict:
                    raise
                wrapped = (
                    exc
                    if isinstance(exc, MemoryConflict)
                    else MemoryConflict(str(exc))
                )
                last_exc = wrapped
                if attempt + 1 >= attempts:
                    raise wrapped from exc
                self._reload_and_merge_for_retry()
        assert last_exc is not None
        raise last_exc


def _compact_payload(result: dict[str, Any]) -> dict[str, Any]:
    payload = result.get("payload") if isinstance(result, dict) else None
    if not isinstance(payload, dict):
        return {"ok": bool(result.get("success", False))}
    out: dict[str, Any] = {}
    for key in ("id", "ticket_number", "name", "count", "items", "status"):
        if key in payload:
            out[key] = payload[key]
    if not out:
        out["keys"] = list(payload.keys())[:12]
    return out
