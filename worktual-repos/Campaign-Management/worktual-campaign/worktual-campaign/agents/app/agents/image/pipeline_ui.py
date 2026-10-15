"""Collect image pipeline results into frontend ui_event payloads."""

from __future__ import annotations

from typing import Any


def collect_image_pipeline_ui_events(
    pipeline: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if not isinstance(pipeline, dict):
        return []
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def _add(ev: Any) -> None:
        if not isinstance(ev, dict) or not ev.get("type"):
            return
        key = (
            f"{ev.get('type')}|{ev.get('template_id')}|{ev.get('image_url')}|"
            f"{ev.get('section_index')}"
        )
        if key in seen:
            return
        seen.add(key)
        out.append(ev)

    for ev in pipeline.get("ui_events") or []:
        _add(ev)
    attach = pipeline.get("attach")
    if isinstance(attach, dict):
        for ev in attach.get("ui_events") or []:
            _add(ev)
    for ev in pipeline.get("generate", {}).get("ui_events") or []:
        _add(ev)
    slot = pipeline.get("email_slot_fill")
    if isinstance(slot, dict):
        for ev in slot.get("ui_events") or []:
            _add(ev)
    return out


__all__ = ["collect_image_pipeline_ui_events"]
