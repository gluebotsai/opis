"""Template Gallery bootstrap chunk — ideas and per-channel templates."""

from __future__ import annotations

import logging
from typing import Any

from app.gallery.attach_image import attach_gallery_email_image_only
from app.gallery.sync_web_push_image import sync_gallery_web_push_image_from_email
from app.gallery.generate_template import generate_gallery_library_template
from app.gallery.idea_generate import generate_gallery_campaign_ideas
from app.gallery.specs import template_specs_for_idea

_log = logging.getLogger(__name__)


def _gallery_keys_for_idea(
    idea_key: str,
    sort_order: int,
    channels: list[str],
) -> list[dict[str, Any]]:
    """One template per ready channel per idea — 10 per channel across 10 ideas."""
    return template_specs_for_idea(idea_key, sort_order, channels)


async def run_gallery_bootstrap_chunk(body: dict[str, Any]) -> dict[str, Any]:
    """Process one bootstrap step: ideas | one_template."""
    step = str(body.get("step") or "ideas").strip().lower()
    org = body.get("org") if isinstance(body.get("org"), dict) else {}
    token = str(body.get("auth_token") or "").strip()
    existing_keys = body.get("existing_gallery_keys") or []
    if not isinstance(existing_keys, list):
        existing_keys = []
    existing_key_set = {str(k).strip() for k in existing_keys if str(k).strip()}

    if step == "ideas":
        need = int(body.get("ideas_needed") or 10)
        existing_titles = body.get("existing_titles") or []
        return await generate_gallery_campaign_ideas(
            count=need,
            industry=str(org.get("industry") or ""),
            industry_type=str(org.get("industry_type") or ""),
            pack_id=str(org.get("pack_id") or "generic-b2b"),
            mode=str(org.get("mode") or "b2b"),
            company_name=str(org.get("company_name") or "Company"),
            existing_titles=existing_titles if isinstance(existing_titles, list) else [],
        )

    if step == "one_template":
        idea = body.get("idea") if isinstance(body.get("idea"), dict) else {}
        spec = body.get("spec") if isinstance(body.get("spec"), dict) else {}
        gallery_key = str(spec.get("gallery_key") or "").strip()
        force_regen = body.get("force_regen") is True
        prior_gallery_templates = body.get("prior_gallery_templates") or []
        if not isinstance(prior_gallery_templates, list):
            prior_gallery_templates = []
        if (
            not gallery_key
            or (gallery_key in existing_key_set and not force_regen)
        ):
            return {"ok": True, "skipped": True, "reason": "already_exists"}

        try:
            return await generate_gallery_library_template(
                org=org,
                idea=idea,
                spec=spec,
                auth_token=token,
                prior_templates=prior_gallery_templates,
            )
        except Exception as exc:  # noqa: BLE001
            _log.exception("gallery template generation failed key=%s", gallery_key)
            return {"ok": False, "error": str(exc), "gallery_key": gallery_key}

    if step == "attach_image":
        idea = body.get("idea") if isinstance(body.get("idea"), dict) else {}
        fields = body.get("fields") if isinstance(body.get("fields"), dict) else {}
        variant_index = int(body.get("variant_index") or 1)
        if not fields:
            return {"ok": False, "error": "missing_fields_for_attach"}
        try:
            return await attach_gallery_email_image_only(
                org=org,
                idea=idea,
                fields=fields,
                variant_index=variant_index,
                auth_token=token,
            )
        except Exception as exc:  # noqa: BLE001
            _log.exception("gallery image attach failed idea=%s", idea.get("idea_key"))
            return {"ok": False, "error": str(exc)}

    if step == "sync_web_push_image":
        idea = body.get("idea") if isinstance(body.get("idea"), dict) else {}
        fields = body.get("fields") if isinstance(body.get("fields"), dict) else {}
        email_image_url = str(body.get("email_image_url") or "").strip()
        variant_index = int(body.get("variant_index") or 1)
        existing_preview = body.get("preview") if isinstance(body.get("preview"), dict) else None
        if not fields:
            return {"ok": False, "error": "missing_web_fields"}
        try:
            return sync_gallery_web_push_image_from_email(
                idea=idea,
                web_fields=fields,
                email_image_url=email_image_url,
                variant_index=variant_index,
                existing_preview=existing_preview,
            )
        except Exception as exc:  # noqa: BLE001
            _log.exception("gallery web push image sync failed idea=%s", idea.get("idea_key"))
            return {"ok": False, "error": str(exc)}

    return {"ok": False, "error": f"unknown step {step}"}


def list_missing_template_specs(
    *,
    idea_key: str,
    sort_order: int,
    channels: list[str],
    existing_gallery_keys: list[str],
) -> list[dict[str, Any]]:
    existing = {str(k).strip() for k in existing_gallery_keys if str(k).strip()}
    return [
        spec
        for spec in _gallery_keys_for_idea(idea_key, sort_order, channels)
        if spec["gallery_key"] not in existing
    ]
