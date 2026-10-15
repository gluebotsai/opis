"""Per-session module skill state — active, paused, pause/resume snapshots."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.mas.skills.registry import SKILL_ACTIONS, get_skill_registry

MODULE_SKILLS_KEY = "module_skills"
CONTACTS_MODULE = "contacts"
MONITORING_MODULE = "monitoring"
REPORTS_MODULE = "reports"
CREATE_CAMPAIGN_MODULE = "create_campaign"
LIBRARY_RUN_MODULE = "library_run"
WHATSAPP_APPROVED_MODULE = "whatsapp_approved"

_SKILL_EXECUTORS_BY_MODULE: dict[str, frozenset[str]] = {
    CONTACTS_MODULE: frozenset({"contact"}),
    MONITORING_MODULE: frozenset({"monitoring", "recovery"}),
    REPORTS_MODULE: frozenset({"analytics"}),
    CREATE_CAMPAIGN_MODULE: frozenset(
        {
            "brief_validation",
            "campaign_audience",
            "campaign_content",
            "launch_scheduling",
        }
    ),
    LIBRARY_RUN_MODULE: frozenset(
        {
            "brief_validation",
            "campaign_audience",
            "campaign_content",
            "launch_scheduling",
        }
    ),
    WHATSAPP_APPROVED_MODULE: frozenset({"whatsapp_approved_send"}),
}

_SNAPSHOT_KEYS = (
    "draft_contact",
    "draft_mode",
    "focus_contact_id",
    "upload_url",
    "uploaded_file_url",
)


def _empty_module_state() -> dict[str, Any]:
    return {"active": None, "paused": []}


def get_module_skill_state(session: dict[str, Any], module: str) -> dict[str, Any]:
    root = session.setdefault(MODULE_SKILLS_KEY, {})
    if not isinstance(root, dict):
        root = {}
        session[MODULE_SKILLS_KEY] = root
    mod = str(module or "").strip().lower()
    state = root.get(mod)
    if not isinstance(state, dict):
        state = _empty_module_state()
        root[mod] = state
    state.setdefault("active", None)
    state.setdefault("paused", [])
    if not isinstance(state["paused"], list):
        state["paused"] = []
    return state


class SkillStateStore:
    def snapshot_from_session(self, session: dict[str, Any]) -> dict[str, Any]:
        snap: dict[str, Any] = {}
        for key in _SNAPSHOT_KEYS:
            if key in session and session.get(key) is not None:
                val = session.get(key)
                snap[key] = deepcopy(val) if isinstance(val, dict) else val
        return snap

    def restore_snapshot(self, session: dict[str, Any], snapshot: dict[str, Any] | None) -> None:
        if not isinstance(snapshot, dict):
            return
        for key in _SNAPSHOT_KEYS:
            if key in snapshot:
                val = snapshot[key]
                session[key] = deepcopy(val) if isinstance(val, dict) else val

    def set_active(
        self,
        session: dict[str, Any],
        module: str,
        skill_id: str,
        *,
        snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state = get_module_skill_state(session, module)
        snap = snapshot if snapshot is not None else self.snapshot_from_session(session)
        state["active"] = {
            "skill_id": str(skill_id).strip().lower(),
            "status": "in_progress",
            "snapshot": snap,
        }
        return state

    def pause_active(self, session: dict[str, Any], module: str, *, reason: str = "") -> None:
        state = get_module_skill_state(session, module)
        active = state.get("active")
        if not isinstance(active, dict) or not active.get("skill_id"):
            return
        active = dict(active)
        active["status"] = "paused"
        active["paused_reason"] = str(reason or "").strip()
        active["snapshot"] = {
            **(active.get("snapshot") if isinstance(active.get("snapshot"), dict) else {}),
            **self.snapshot_from_session(session),
        }
        paused = list(state.get("paused") or [])
        paused.append(active)
        state["paused"] = paused
        state["active"] = None

    def complete_active(self, session: dict[str, Any], module: str) -> str | None:
        state = get_module_skill_state(session, module)
        active = state.get("active")
        skill_id = (
            str(active.get("skill_id") or "").strip().lower()
            if isinstance(active, dict)
            else ""
        )
        state["active"] = None
        return skill_id or None

    def resume_top_paused(self, session: dict[str, Any], module: str) -> str | None:
        state = get_module_skill_state(session, module)
        paused = list(state.get("paused") or [])
        if not paused:
            return None
        entry = paused.pop()
        state["paused"] = paused
        skill_id = str(entry.get("skill_id") or "").strip().lower()
        if not skill_id:
            return None
        snap = entry.get("snapshot") if isinstance(entry.get("snapshot"), dict) else {}
        self.restore_snapshot(session, snap)
        state["active"] = {
            "skill_id": skill_id,
            "status": "in_progress",
            "snapshot": snap,
            "resumed_from_pause": True,
        }
        return skill_id

    def clear_module(self, session: dict[str, Any], module: str) -> None:
        root = session.setdefault(MODULE_SKILLS_KEY, {})
        if isinstance(root, dict):
            root[str(module).strip().lower()] = _empty_module_state()

    def cancel_active(self, session: dict[str, Any], module: str) -> str | None:
        """Drop active skill without preserving it on the paused stack."""
        state = get_module_skill_state(session, module)
        active = state.get("active")
        skill_id = (
            str(active.get("skill_id") or "").strip().lower()
            if isinstance(active, dict)
            else ""
        )
        state["active"] = None
        return skill_id or None

    def summary_for_prompt(self, session: dict[str, Any], module: str) -> str:
        state = get_module_skill_state(session, module)
        lines: list[str] = []
        active = state.get("active")
        if isinstance(active, dict) and active.get("skill_id"):
            lines.append(
                f"active_skill: {active.get('skill_id')} "
                f"status={active.get('status') or 'in_progress'}"
            )
        paused = state.get("paused") or []
        if paused:
            ids = [
                str(p.get("skill_id") or "")
                for p in paused
                if isinstance(p, dict) and p.get("skill_id")
            ]
            if ids:
                lines.append(f"paused_skills: {', '.join(ids)}")
        return "\n".join(lines) if lines else "active_skill: (none)"


def get_active_skill_id(session: dict[str, Any], module: str) -> str | None:
    """Return the active skill_id for a module, if any."""
    state = get_module_skill_state(session, module)
    active = state.get("active")
    if not isinstance(active, dict):
        return None
    sid = str(active.get("skill_id") or "").strip().lower()
    return sid or None


_DRAFT_PROGRESS_KEYS = (
    "first_name",
    "last_name",
    "email",
    "phone",
    "company_name",
    "city",
)


def has_contact_draft_progress(session: dict[str, Any]) -> bool:
    draft = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
    return any(str(draft.get(k) or "").strip() for k in _DRAFT_PROGRESS_KEYS)


def is_active_contact_creation(session: dict[str, Any]) -> bool:
    """True while a chat create is in progress (draft facts or active creation skill)."""
    if str(session.get("draft_mode") or "").strip().lower() == "create":
        return True
    if has_contact_draft_progress(session):
        return True
    if get_active_skill_id(session, CONTACTS_MODULE) == "contact_creation":
        active = get_module_skill_state(session, CONTACTS_MODULE).get("active")
        if isinstance(active, dict) and str(active.get("status") or "") == "in_progress":
            return True
    return False


def normalize_contact_skill_action(
    session: dict[str, Any],
    *,
    skill_id: str | None,
    skill_action: str | None,
) -> str:
    """Avoid accidental new_task / switch resets during an active create interview."""
    action = str(skill_action or "continue").strip().lower()
    if action not in SKILL_ACTIONS:
        action = "continue"
    sid = str(skill_id or "").strip().lower()
    if not is_active_contact_creation(session):
        return action
    if sid and sid not in ("contact_creation", ""):
        return action
    if action in ("new_task", "switch", "pause_and_switch"):
        return "continue"
    return action


def apply_skill_pick(
    session: dict[str, Any],
    *,
    module: str,
    executor_id: str,
    skill_id: str | None,
    skill_action: str | None,
) -> dict[str, Any]:
    """
    Apply Domain pick to session skill state. Returns metadata for task_spec/logging.
    """
    store = SkillStateStore()
    registry = get_skill_registry()
    eid = str(executor_id or "").strip().lower()
    sid = str(skill_id or "").strip().lower() or None
    action = str(skill_action or "continue").strip().lower()
    if action not in SKILL_ACTIONS:
        action = "continue"

    meta: dict[str, Any] = {"skill_action_applied": action}
    mod = str(module or "").strip().lower()
    allowed_eids = _SKILL_EXECUTORS_BY_MODULE.get(mod)
    if not allowed_eids or eid not in allowed_eids:
        return meta

    if not sid:
        return meta

    if not registry.get(mod, sid):
        return {"ok": False, "error": f"Unknown skill {sid!r} for module {mod!r}"}

    def _record_skill_memory(action_applied: str, *, paused: str = "") -> None:
        if mod != CONTACTS_MODULE or not sid:
            return
        from app.agents.contacts.memory_note import append_memory_note, note_from_skill_start

        line = note_from_skill_start(sid, action=action_applied)
        if paused and line:
            line = f"Paused {paused}; {line}"
        if line:
            append_memory_note(session, line)

    state = get_module_skill_state(session, mod)
    active = state.get("active")
    active_id = (
        str(active.get("skill_id") or "").strip().lower()
        if isinstance(active, dict)
        else ""
    )

    if action == "new_task":
        store.clear_module(session, mod)
        store.set_active(session, mod, sid)
        meta["skill_id"] = sid
        _record_skill_memory("new_task")
        return meta

    if action == "complete":
        completed = store.complete_active(session, mod)
        meta["completed_skill"] = completed
        return meta

    if action == "cancelled":
        cancelled = store.cancel_active(session, mod)
        meta["cancelled_skill"] = cancelled
        if mod == CONTACTS_MODULE and cancelled:
            from app.agents.contacts.memory_note import append_memory_note

            append_memory_note(session, f"Skill {cancelled} cancelled")
        return meta

    if action == "resume":
        resumed = store.resume_top_paused(session, mod)
        meta["resumed_skill"] = resumed
        if resumed:
            meta["skill_id"] = resumed
            _record_skill_memory("resume")
        elif sid:
            store.set_active(session, mod, sid)
            meta["skill_id"] = sid
            _record_skill_memory("new_task")
        return meta

    if action == "pause_and_switch":
        if active_id and active_id != sid:
            store.pause_active(session, mod, reason=f"switch_to_{sid}")
        store.set_active(session, mod, sid)
        meta["skill_id"] = sid
        _record_skill_memory("pause_and_switch", paused=active_id if active_id != sid else "")
        return meta

    if action == "switch":
        if active_id and active_id != sid:
            store.pause_active(session, mod, reason=f"switch_to_{sid}")
        store.set_active(session, mod, sid)
        meta["skill_id"] = sid
        _record_skill_memory("switch", paused=active_id if active_id != sid else "")
        return meta

    # continue — same skill or first activation
    if not active_id or active_id == sid:
        if not active_id:
            store.set_active(session, mod, sid)
        else:
            active = dict(active)
            active["snapshot"] = {
                **(active.get("snapshot") if isinstance(active.get("snapshot"), dict) else {}),
                **store.snapshot_from_session(session),
            }
            state["active"] = active
        meta["skill_id"] = sid
        return meta

    store.pause_active(session, mod, reason=f"continue_conflict_{sid}")
    store.set_active(session, mod, sid)
    meta["skill_id"] = sid
    return meta


def bind_monitoring_skill_if_changed(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
    executor_id: str | None = None,
) -> bool:
    """
    Apply monitoring skill pick only when skill or action changes.
    Returns True when session skill state was mutated.
    """
    sid = str(skill_id or "").strip().lower()
    action = str(skill_action or "continue").strip().lower()
    if action not in SKILL_ACTIONS:
        action = "continue"
    registry = get_skill_registry()
    spec = registry.get(MONITORING_MODULE, sid)
    eid = str(
        executor_id
        or (spec.executor_id if spec else "")
        or task_spec.get("executor_id")
        or "monitoring"
    ).strip().lower()
    if spec and eid != spec.executor_id:
        eid = spec.executor_id
    task_spec["skill_id"] = sid
    task_spec["skill_action"] = action
    task_spec["executor_id"] = eid
    active = get_active_skill_id(session, MONITORING_MODULE)
    if active == sid and action == "continue":
        return False
    apply_skill_pick(
        session,
        module=MONITORING_MODULE,
        executor_id=eid,
        skill_id=sid,
        skill_action=action,
    )
    return True


def bind_reports_skill_if_changed(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
    executor_id: str | None = None,
) -> bool:
    """
    Apply reports/dashboard skill pick only when skill or action changes.
    Returns True when session skill state was mutated.
    """
    sid = str(skill_id or "").strip().lower()
    action = str(skill_action or "continue").strip().lower()
    if action not in SKILL_ACTIONS:
        action = "continue"
    registry = get_skill_registry()
    spec = registry.get(REPORTS_MODULE, sid)
    eid = str(
        executor_id
        or (spec.executor_id if spec else "")
        or task_spec.get("executor_id")
        or "analytics"
    ).strip().lower()
    if spec and eid != spec.executor_id:
        eid = spec.executor_id
    task_spec["skill_id"] = sid
    task_spec["skill_action"] = action
    task_spec["executor_id"] = eid
    if sid == "events_report":
        task_spec["surface"] = "events_report"
    elif not str(task_spec.get("surface") or "").strip():
        task_spec["surface"] = "reports"
    active = get_active_skill_id(session, REPORTS_MODULE)
    if active == sid and action == "continue":
        return False
    apply_skill_pick(
        session,
        module=REPORTS_MODULE,
        executor_id=eid,
        skill_id=sid,
        skill_action=action,
    )
    return True


def bind_create_campaign_skill_if_changed(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
    executor_id: str | None = None,
) -> bool:
    """
    Apply create-campaign skill pick only when skill or action changes.
    Returns True when session skill state was mutated.
    """
    sid = str(skill_id or "").strip().lower()
    action = str(skill_action or "continue").strip().lower()
    if action not in SKILL_ACTIONS:
        action = "continue"
    registry = get_skill_registry()
    spec = registry.get(CREATE_CAMPAIGN_MODULE, sid)
    eid = str(
        executor_id
        or (spec.executor_id if spec else "")
        or task_spec.get("executor_id")
        or "brief_validation"
    ).strip().lower()
    if spec and eid != spec.executor_id:
        eid = spec.executor_id
    task_spec["skill_id"] = sid
    task_spec["skill_action"] = action
    task_spec["executor_id"] = eid
    active = get_active_skill_id(session, CREATE_CAMPAIGN_MODULE)
    if active == sid and action == "continue":
        return False
    apply_skill_pick(
        session,
        module=CREATE_CAMPAIGN_MODULE,
        executor_id=eid,
        skill_id=sid,
        skill_action=action,
    )
    return True


def bind_whatsapp_approved_skill_if_changed(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
    executor_id: str | None = None,
) -> bool:
    """Apply whatsapp_approved skill pick only when skill or action changes."""
    sid = str(skill_id or "").strip().lower()
    action = str(skill_action or "continue").strip().lower()
    if action not in SKILL_ACTIONS:
        action = "continue"
    registry = get_skill_registry()
    spec = registry.get(WHATSAPP_APPROVED_MODULE, sid)
    eid = str(
        executor_id
        or (spec.executor_id if spec else "")
        or task_spec.get("executor_id")
        or "whatsapp_approved_send"
    ).strip().lower()
    if spec and eid != spec.executor_id:
        eid = spec.executor_id
    task_spec["skill_id"] = sid
    task_spec["skill_action"] = action
    task_spec["executor_id"] = eid
    active = get_active_skill_id(session, WHATSAPP_APPROVED_MODULE)
    if active == sid and action == "continue":
        return False
    apply_skill_pick(
        session,
        module=WHATSAPP_APPROVED_MODULE,
        executor_id=eid,
        skill_id=sid,
        skill_action=action,
    )
    return True


def bind_library_run_skill_if_changed(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
    executor_id: str | None = None,
) -> bool:
    """
    Apply library_run skill pick only when skill or action changes.
    Isolated from create_campaign skill state.
    """
    sid = str(skill_id or "").strip().lower()
    action = str(skill_action or "continue").strip().lower()
    if action not in SKILL_ACTIONS:
        action = "continue"
    registry = get_skill_registry()
    spec = registry.get(LIBRARY_RUN_MODULE, sid)
    eid = str(
        executor_id
        or (spec.executor_id if spec else "")
        or task_spec.get("executor_id")
        or "brief_validation"
    ).strip().lower()
    if spec and eid != spec.executor_id:
        eid = spec.executor_id
    task_spec["skill_id"] = sid
    task_spec["skill_action"] = action
    task_spec["executor_id"] = eid
    active = get_active_skill_id(session, LIBRARY_RUN_MODULE)
    if active == sid and action == "continue":
        return False
    apply_skill_pick(
        session,
        module=LIBRARY_RUN_MODULE,
        executor_id=eid,
        skill_id=sid,
        skill_action=action,
    )
    return True


def bind_contact_skill_if_changed(
    session: dict[str, Any],
    task_spec: dict[str, Any],
    *,
    skill_id: str,
    skill_action: str = "continue",
) -> bool:
    """
    Apply skill pick only when skill or action changes.
    Returns True when session skill state was mutated.
    """
    sid = str(skill_id or "").strip().lower()
    action = normalize_contact_skill_action(
        session,
        skill_id=sid,
        skill_action=skill_action,
    )
    task_spec["skill_id"] = sid
    task_spec["skill_action"] = action
    active = get_active_skill_id(session, CONTACTS_MODULE)
    if active == sid and action == "continue":
        return False
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id=sid,
        skill_action=action,
    )
    return True
