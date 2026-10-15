"""Shared contracts for compose pipeline (plan → image → HTML)."""

from __future__ import annotations

from typing import Any, TypedDict


class ImageSlot(TypedDict, total=False):
    role: str
    needed: bool
    width_px: int
    height_px: int
    prompt: str


class EmailPlan(TypedDict, total=False):
    subject: str
    preheader: str
    email_kind: str
    content_brief: str
    image_slots: list[ImageSlot]


class ExecutorEnvelope(TypedDict, total=False):
    ok: bool
    status: str  # completed | need_input | failed | soft_fail
    executor_id: str
    need: str
    payload: dict[str, Any]
    warnings: list[str]
    error: str


def envelope(
    *,
    executor_id: str,
    status: str,
    ok: bool | None = None,
    need: str | None = None,
    payload: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    if ok is None:
        ok = status in ("completed", "soft_fail")
    out: dict[str, Any] = {
        "ok": ok,
        "status": status,
        "executor_id": executor_id,
        "payload": payload or {},
        "warnings": list(warnings or []),
    }
    if need:
        out["need"] = need
    if error:
        out["error"] = error
    return out


class ImageAsset(TypedDict, total=False):
    role: str
    url: str
    width_px: int
    height_px: int


def plan_from_dict(data: dict[str, Any]) -> EmailPlan:
    slots_raw = data.get("image_slots")
    slots: list[ImageSlot] = []
    if isinstance(slots_raw, list):
        for row in slots_raw:
            if isinstance(row, dict):
                slots.append(
                    {
                        "role": str(row.get("role") or "hero"),
                        "needed": bool(row.get("needed")),
                        "width_px": int(row.get("width_px") or 600),
                        "height_px": int(row.get("height_px") or 338),
                        "prompt": str(row.get("prompt") or ""),
                    }
                )
    return {
        "subject": str(data.get("subject") or "").strip(),
        "preheader": str(data.get("preheader") or "").strip(),
        "email_kind": str(data.get("email_kind") or "").strip().lower(),
        "content_brief": str(data.get("content_brief") or "").strip(),
        "image_slots": slots,
    }
