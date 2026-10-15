"""MAS turn contract — frozen verbatim user text through Super → Domain → Executor."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class MasTurn:
    """Immutable per-turn envelope; verbatim_user_text is the only chat user source."""

    verbatim_user_text: str
    session_id: str
    token: str
    module: str
    entry: str

    @property
    def manages_transcript(self) -> bool:
        """True when this interactive turn should own chat transcript writes.

        Text-only turns require verbatim text. Image-only create-chat turns are
        handled by ``should_manage_transcript(turn, session)`` once pending
        chat images are on the session.
        """
        return (
            self.entry in ("interactive", "sticky_domain")
            and bool(self.verbatim_user_text.strip())
            and bool(self.session_id)
        )

    @classmethod
    def from_payload(
        cls,
        raw: dict[str, Any],
        task_spec: dict[str, Any],
        session: dict[str, Any] | None = None,
    ) -> MasTurn:
        sess = session if isinstance(session, dict) else {}
        verbatim = str(
            raw.get("verbatim_user_text")
            or raw.get("query")
            or task_spec.get("query")
            or ""
        ).strip()
        module = str(
            raw.get("module_hint")
            or task_spec.get("module")
            or sess.get("module")
            or ""
        ).strip().lower()
        entry = str(raw.get("entry") or "interactive").strip().lower()
        return cls(
            verbatim_user_text=verbatim,
            session_id=str(raw.get("session_id") or "").strip(),
            token=str(raw.get("token") or "").strip(),
            module=module,
            entry=entry,
        )


def should_manage_transcript(
    turn: MasTurn, session: dict[str, Any] | None = None
) -> bool:
    """Whether mas_invoke should record user/assistant chat rows for this turn.

    Image-only uploads send empty ``query`` but still need a user bubble +
    assistant reply on the server transcript for cross-device hydrate.
    """
    if turn.manages_transcript:
        return True
    if turn.entry not in ("interactive", "sticky_domain") or not turn.session_id:
        return False
    sess = session if isinstance(session, dict) else {}
    from app.agents.image.user_assets import peek_turn_chat_image_uploads

    return bool(peek_turn_chat_image_uploads(sess))


def verbatim_from_ctx(
    ctx: dict[str, Any],
    task_spec: dict[str, Any] | None = None,
) -> str:
    spec = task_spec if isinstance(task_spec, dict) else {}
    return str(
        ctx.get("verbatim_user_text")
        or spec.get("query")
        or ctx.get("query")
        or ""
    ).strip()


def ensure_verbatim_task_spec(ctx: dict[str, Any], task_spec: dict[str, Any]) -> str:
    """Pin task_spec['query'] to verbatim user text for the whole domain hop."""
    verbatim = verbatim_from_ctx(ctx, task_spec)
    task_spec["query"] = verbatim
    if verbatim:
        ctx["verbatim_user_text"] = verbatim
    return verbatim


def apply_routing_hint(
    task_spec: dict[str, Any],
    restated: str | None,
    verbatim: str,
) -> None:
    """LLM restated_query is routing only — never overwrites chat transcript query."""
    if restated:
        task_spec["routing_hint"] = str(restated).strip()
    task_spec["query"] = verbatim


def routing_query(task_spec: dict[str, Any], verbatim: str = "") -> str:
    """Text for domain/super LLM routing when a restated hint exists."""
    hint = str(task_spec.get("routing_hint") or "").strip()
    if hint:
        return hint
    return str(task_spec.get("query") or verbatim or "").strip()


def executor_ctx_base(raw: dict[str, Any], task_spec: dict[str, Any]) -> dict[str, Any]:
    """Common ctx keys every executor runner should receive."""
    verbatim = verbatim_from_ctx(raw, task_spec)
    return {
        "verbatim_user_text": verbatim,
        "mas_transcript_managed": bool(raw.get("mas_transcript_managed")),
    }
