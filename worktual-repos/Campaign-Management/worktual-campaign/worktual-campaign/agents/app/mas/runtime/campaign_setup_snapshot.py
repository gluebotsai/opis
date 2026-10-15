"""Structured session facts for Live session JSON — no generated instructions."""

from __future__ import annotations

from typing import Any

from app.mas.runtime.creation_context import (
    audience_matched_count,
    campaign_meta_complete,
    has_templates_for_channels,
    image_plan_wants_images,
    selected_channels,
    template_ids_by_channel,
)


def _camp(session: dict[str, Any]) -> dict[str, Any]:
    raw = session.get("campaign")
    return dict(raw) if isinstance(raw, dict) else {}


def _aud(session: dict[str, Any]) -> dict[str, Any]:
    raw = session.get("audience")
    return dict(raw) if isinstance(raw, dict) else {}


def compact_gallery_selection(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[:20]:
        if not isinstance(row, dict):
            continue
        url = str(row.get("image_url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "id": str(row.get("id") or "").strip(),
                "media_id": str(row.get("media_id") or "").strip(),
                "image_url": url[:512],
                "short_description": str(row.get("short_description") or "").strip()[
                    :200
                ],
            }
        )
    return out


def live_session_facts(session: dict[str, Any] | None) -> dict[str, Any]:
    """Pure facts from session — injected into Live session JSON for the LLM."""
    if not isinstance(session, dict):
        return {}

    camp = _camp(session)
    aud = _aud(session)
    channels = selected_channels(session)
    meta_complete = campaign_meta_complete(session)
    matched = audience_matched_count(session)
    templates_ready = has_templates_for_channels(session)
    tmap = template_ids_by_channel(session)

    tpl_channels = sorted(
        {
            str(t.get("channel") or "").strip().lower()
            for t in (session.get("templates") or [])
            if isinstance(t, dict) and str(t.get("channel") or "").strip()
        }
    )
    missing_tpl = [ch for ch in channels if ch not in set(tpl_channels)]

    from app.agents.image.plan import get_image_plan

    plan = get_image_plan(session)
    plan_status = str(plan.get("status") or "").strip().lower()

    name = str(camp.get("name") or "").strip()
    goal = str(camp.get("goal") or "").strip()
    objective = str(camp.get("objective") or "").strip()

    facts: dict[str, Any] = {
        "campaign": {
            "name": name,
            "goal": goal,
            "objective": objective,
            "meta_complete": meta_complete,
        },
        "channels": channels,
        "audience": {
            "matched_count": matched,
            "description": str(aud.get("description") or aud.get("summary") or "")[:200],
            "has_matched_contacts": matched > 0,
            "launch_ready": bool(session.get("audience_launch_ready"))
            if session.get("whatsapp_approved_run")
            else matched > 0,
            "sample_names": [
                str(n).strip()
                for n in (aud.get("sample_names") or [])[:5]
                if str(n).strip()
            ],
        },
        "templates": {
            "count": len(session.get("templates") or []),
            "ready_for_channels": templates_ready,
            "channels_with_templates": tpl_channels,
            "missing_for_channels": missing_tpl,
            "template_ids_by_channel": tmap,
            "copy_image_layout_via": "view_edit" if templates_ready else None,
        },
        "image_plan": {
            "wants_images": image_plan_wants_images(session),
            "status": plan_status or "none",
            "attached": plan_status == "attached",
        },
        "launch_confirmed": bool(session.get("launch_confirmed")),
        "stage": str(session.get("stage") or ""),
    }

    from app.industry_packs.loader import normalize_campaign_profile

    profile = normalize_campaign_profile(session.get("campaign_profile"))
    facts["industry_alignment"] = {
        "mode": profile.get("mode") or "b2b",
        "industry": profile.get("industry") or "",
        "industry_type": profile.get("industry_type") or "",
    }

    launch_plan = (
        session.get("launch_plan")
        if isinstance(session.get("launch_plan"), dict)
        else {}
    )
    if launch_plan.get("ab_enabled"):
        email_has_variants = False
        for t in session.get("templates") or []:
            if not isinstance(t, dict):
                continue
            if str(t.get("channel") or "").strip().lower() != "email":
                continue
            fields = t.get("fields") if isinstance(t.get("fields"), dict) else {}
            if fields.get("ab_test") is True or (
                isinstance(fields.get("variant_a"), dict)
                and isinstance(fields.get("variant_b"), dict)
            ):
                email_has_variants = True
                break
        facts["email_ab"] = {
            "enabled": True,
            "pct_a": launch_plan.get("ab_pct_a"),
            "pct_b": launch_plan.get("ab_pct_b"),
            "pct_holdout": launch_plan.get("ab_pct_holdout"),
            "auto": launch_plan.get("ab_auto"),
            "decide_after_minutes": launch_plan.get("ab_decide_after_minutes"),
            "has_email_variants": email_has_variants,
        }

    if session.get("recommendation_run"):
        facts["recommendation_run"] = True
        facts["recommendation_provenance"] = {
            "source_recommendation_id": session.get("source_recommendation_id"),
            "why_created": str(session.get("why_created") or "")[:240],
        }

    if session.get("whatsapp_approved_run"):
        facts["whatsapp_approved_run"] = True
        snap = session.get("whatsapp_template_snapshot")
        if isinstance(snap, dict):
            facts["approved_template"] = {
                "name": str(snap.get("name") or "")[:120],
                "status": str(snap.get("status") or "approved"),
            }
        if facts["audience"].get("launch_ready"):
            facts["approved_next_step"] = (
                "launch_scheduling"
                if not session.get("launch_confirmed")
                else "monitor"
            )
        elif facts["audience"]["has_matched_contacts"]:
            facts["approved_next_step"] = "finalize_audience"
        else:
            facts["approved_next_step"] = "campaign_audience"

    gallery_sel = compact_gallery_selection(session.get("selected_gallery_images"))
    if gallery_sel:
        facts["selected_gallery_images"] = gallery_sel

    try:
        from app.agents.image.user_assets import (
            list_confirmed_chat_images,
            list_pending_chat_images,
        )

        pending = list_pending_chat_images(session)
        confirmed = list_confirmed_chat_images(session)
        if pending:
            facts["pending_chat_images"] = [
                {
                    "id": r.get("id"),
                    "filename": r.get("filename"),
                    "image_url": r.get("image_url"),
                }
                for r in pending[:8]
            ]
        if confirmed:
            facts["confirmed_chat_images"] = [
                {
                    "id": r.get("id"),
                    "filename": r.get("filename"),
                    "channels": r.get("channels"),
                    "image_url": r.get("image_url"),
                }
                for r in confirmed[:8]
            ]
    except Exception:  # noqa: BLE001
        pass

    if session.get("library_run"):
        facts["library_run"] = True
        baseline = session.get("library_baseline")
        if isinstance(baseline, dict) and baseline:
            facts["library_baseline"] = {
                "channels_selected": list(baseline.get("channels_selected") or []),
                "channels_missing": list(baseline.get("channels_missing") or []),
                "template_count": len(baseline.get("templates") or []),
                "templates": [
                    {
                        "id": str(t.get("id") or t.get("template_id") or ""),
                        "channel": str(t.get("channel") or ""),
                        "name": str(t.get("name") or "")[:80],
                    }
                    for t in (baseline.get("templates") or [])
                    if isinstance(t, dict)
                ][:12],
            }
        else:
            sel = [
                row
                for row in (session.get("selected_library_templates") or [])
                if isinstance(row, dict)
            ]
            facts["library_baseline"] = {
                "channels_selected": [
                    str(r.get("channel") or "").strip().lower()
                    for r in sel
                    if str(r.get("channel") or "").strip()
                ],
                "template_count": len(sel),
            }

    note = str(session.get("chat_memory_note") or "").strip()
    if note:
        facts["chat_memory_note"] = note

    return facts


def campaign_setup_snapshot(session: dict[str, Any] | None) -> dict[str, Any]:
    """Alias for tests and Python routing — same as live_session_facts."""
    return live_session_facts(session)


__all__ = ["campaign_setup_snapshot", "live_session_facts"]
