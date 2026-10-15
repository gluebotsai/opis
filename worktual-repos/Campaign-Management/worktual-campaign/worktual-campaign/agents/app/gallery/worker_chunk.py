"""
Gallery bootstrap job-chunk — decision + generation live in Python.

Backend loads job/ideas/templates from Prisma, POSTs state here, then applies
returned mutations. Frontend APIs stay unchanged.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.gallery.attach_image import attach_gallery_email_image_only
from app.gallery.generate_template import generate_gallery_library_template
from app.gallery.idea_generate import generate_gallery_campaign_ideas
from app.gallery.images import (
    gallery_image_work_targets_for_org,
    hero_url_from_fields,
)
from app.gallery.specs import (
    GALLERY_MIN_IDEAS,
    MAX_TEMPLATE_FAILURES,
    active_gallery_channels,
    email_gallery_template_needs_regen,
    expected_gallery_template_count,
    is_current_gallery_template_key,
    template_specs_for_idea,
)
from app.gallery.sync_web_push_image import sync_gallery_web_push_image_from_email

_log = logging.getLogger(__name__)


def _template_failure_count(progress: dict[str, Any], gallery_key: str) -> int:
    failures = progress.get("templateFailures")
    if not isinstance(failures, dict):
        return 0
    return int(failures.get(gallery_key) or 0)


def _row_key(row: dict[str, Any]) -> str:
    return str(row.get("seedSlug") or row.get("galleryKey") or row.get("gallery_key") or "").strip()


def _existing_keys(templates: list[dict[str, Any]]) -> list[str]:
    keys: list[str] = []
    for row in templates:
        key = _row_key(row)
        if key and is_current_gallery_template_key(key):
            keys.append(key)
    return keys


def _pick_next_template_work(
    ideas: list[dict[str, Any]],
    channels: list[str],
    key_set: set[str],
    progress: dict[str, Any],
    rows_by_key: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    for idea in ideas:
        idea_key = str(idea.get("ideaKey") or idea.get("idea_key") or "").strip()
        sort_order = int(idea.get("sortOrder") or idea.get("sort_order") or 0)
        if not idea_key:
            continue
        for spec in template_specs_for_idea(idea_key, sort_order, channels):
            if spec["gallery_key"] in key_set:
                continue
            if _template_failure_count(progress, spec["gallery_key"]) >= MAX_TEMPLATE_FAILURES:
                continue
            return {"spec": spec, "idea": idea, "forceRegen": False}

    for idea in ideas:
        idea_key = str(idea.get("ideaKey") or idea.get("idea_key") or "").strip()
        sort_order = int(idea.get("sortOrder") or idea.get("sort_order") or 0)
        if not idea_key:
            continue
        for spec in template_specs_for_idea(idea_key, sort_order, channels):
            if spec["primary_channel"] != "email":
                continue
            row = rows_by_key.get(spec["gallery_key"])
            if not row or not email_gallery_template_needs_regen(row):
                continue
            if _template_failure_count(progress, spec["gallery_key"]) >= MAX_TEMPLATE_FAILURES:
                continue
            return {"spec": spec, "idea": idea, "forceRegen": True}
    return None


def _count_remaining(
    ideas: list[dict[str, Any]],
    channels: list[str],
    key_set: set[str],
) -> int:
    n = 0
    for idea in ideas:
        idea_key = str(idea.get("ideaKey") or idea.get("idea_key") or "").strip()
        sort_order = int(idea.get("sortOrder") or idea.get("sort_order") or 0)
        for spec in template_specs_for_idea(idea_key, sort_order, channels):
            if spec["gallery_key"] not in key_set:
                n += 1
    return n


def _reachable_http(url: str) -> bool:
    raw = str(url or "").strip()
    return bool(re.match(r"^https?://", raw, re.I)) and "127.0.0.1" not in raw and "localhost" not in raw.lower()


async def process_gallery_job_chunk(body: dict[str, Any]) -> dict[str, Any]:
    """
    Run one gallery worker tick of decision + generation.

    Returns mutations for the Campaign backend to persist via Prisma.
    """
    job = body.get("job") if isinstance(body.get("job"), dict) else {}
    org = body.get("org") if isinstance(body.get("org"), dict) else {}
    org_ctx = body.get("org_ctx") if isinstance(body.get("org_ctx"), dict) else {}
    auth_token = str(body.get("auth_token") or "").strip()
    ideas = body.get("ideas") if isinstance(body.get("ideas"), list) else []
    templates = body.get("templates") if isinstance(body.get("templates"), list) else []
    templates_per_tick = max(1, min(int(body.get("templates_per_tick") or 2), 5))

    org_id = str(job.get("organizationId") or org.get("organization_id") or "").strip()
    job_id = str(job.get("id") or "").strip()
    progress = dict(job.get("progress") or {}) if isinstance(job.get("progress"), dict) else {}
    channels_raw = job.get("channelsSnapshot") or job.get("channels_snapshot") or []
    if not isinstance(channels_raw, list):
        channels_raw = []
    channels = active_gallery_channels([str(c) for c in channels_raw])

    mutations: list[dict[str, Any]] = []
    logs: list[dict[str, Any]] = []

    def update_job(**kwargs: Any) -> None:
        mutations.append({"op": "update_job", "job_id": job_id, **kwargs})

    def upsert_idea(payload: dict[str, Any]) -> None:
        mutations.append({"op": "upsert_idea", "organization_id": org_id, **payload})

    def upsert_template(payload: dict[str, Any]) -> None:
        mutations.append({"op": "upsert_template", "organization_id": org_id, **payload})

    if not progress.get("legacyHidden"):
        mutations.append({"op": "purge_legacy", "organization_id": org_id})
        progress["legacyHidden"] = True
        logs.append({"level": "info", "msg": "Gallery: legacy purge requested", "data": {"orgId": org_id}})

    idea_count = len(ideas)
    ideas_target = int(progress.get("ideasTarget") or GALLERY_MIN_IDEAS)

    if idea_count < ideas_target:
        need = ideas_target - idea_count
        existing_titles = [str(i.get("title") or "") for i in ideas]
        gen = await generate_gallery_campaign_ideas(
            count=need,
            industry=str(org.get("industry") or org_ctx.get("industry") or ""),
            industry_type=str(org.get("industry_type") or org_ctx.get("industryType") or ""),
            pack_id=str(org.get("pack_id") or org_ctx.get("packId") or "generic-b2b"),
            mode=str(org.get("mode") or org_ctx.get("mode") or "b2b"),
            company_name=str(org.get("company_name") or org_ctx.get("companyName") or "Company"),
            existing_titles=existing_titles,
        )
        if not gen.get("ok"):
            update_job(
                status="failed",
                error_message=str(gen.get("error") or "ideas failed"),
                progress={**progress, "phase": "ideas_failed"},
            )
            return {"ok": True, "mutations": mutations, "logs": logs}

        new_ideas = gen.get("ideas") if isinstance(gen.get("ideas"), list) else []
        added = 0
        for row in new_ideas:
            if not isinstance(row, dict):
                continue
            if not row.get("idea_key") or not row.get("title"):
                continue
            upsert_idea(
                {
                    "idea_key": str(row["idea_key"]),
                    "title": str(row["title"]),
                    "summary": str(row.get("summary") or ""),
                    "goal": str(row.get("goal") or "Engagement"),
                    "industry": str(org_ctx.get("industry") or ""),
                    "industry_type": str(org_ctx.get("industryType") or ""),
                    "pack_id": str(org_ctx.get("packId") or "generic-b2b"),
                    "sort_order": idea_count + added,
                }
            )
            added += 1

        if added == 0:
            empty_retries = int(progress.get("ideasEmptyRetries") or 0) + 1
            if empty_retries >= 3:
                update_job(
                    status="failed",
                    error_message="Gallery idea generation returned no usable ideas after 3 attempts",
                    progress={
                        **progress,
                        "phase": "ideas_failed",
                        "ideasEmptyRetries": empty_retries,
                    },
                )
                return {"ok": True, "mutations": mutations, "logs": logs}
            progress = {
                **progress,
                "phase": "ideas",
                "ideasEmptyRetries": empty_retries,
                "ideasDone": idea_count,
                "ideasTarget": ideas_target,
            }
            update_job(progress=progress)
            logs.append(
                {
                    "level": "warn",
                    "msg": "Gallery: ideas chunk returned nothing — will retry",
                    "data": {"orgId": org_id, "emptyRetries": empty_retries},
                }
            )
            return {"ok": True, "mutations": mutations, "logs": logs}

        progress = {
            **progress,
            "phase": "ideas",
            "ideasDone": idea_count + added,
            "ideasTarget": ideas_target,
        }
        update_job(progress=progress)
        logs.append(
            {
                "level": "info",
                "msg": "Gallery: ideas chunk generated",
                "data": {"orgId": org_id, "added": added},
            }
        )
        return {"ok": True, "mutations": mutations, "logs": logs}

    if not channels:
        update_job(
            status="completed",
            progress={
                **progress,
                "phase": "completed_no_channels",
                "ideasDone": idea_count,
            },
        )
        return {"ok": True, "mutations": mutations, "logs": logs}

    # Working copies — mutate locally as we generate within this tick
    working_ideas = [dict(i) for i in ideas if isinstance(i, dict)]
    working_templates = [dict(t) for t in templates if isinstance(t, dict)]
    progress["templatesTarget"] = expected_gallery_template_count(channels)
    generated_this_tick = 0

    while generated_this_tick < templates_per_tick:
        keys = _existing_keys(working_templates)
        key_set = set(keys)
        rows_by_key = {_row_key(r): r for r in working_templates if _row_key(r)}
        picked = _pick_next_template_work(
            working_ideas, channels, key_set, progress, rows_by_key
        )

        if not picked:
            image_targets = gallery_image_work_targets_for_org(
                working_ideas, channels, rows_by_key
            )
            image_target = image_targets[0] if image_targets else None
            if image_target:
                hero_idea = next(
                    (
                        i
                        for i in working_ideas
                        if str(i.get("ideaKey") or i.get("idea_key") or "")
                        == image_target["ideaKey"]
                    ),
                    None,
                )
                hero_row = rows_by_key.get(image_target["galleryKey"])
                hero_fields = (
                    hero_row.get("fields")
                    if hero_row and isinstance(hero_row.get("fields"), dict)
                    else None
                )
                if (
                    hero_idea
                    and hero_fields
                    and image_target["kind"] == "email_attach"
                ):
                    attach = await attach_gallery_email_image_only(
                        org=org,
                        idea={
                            "idea_key": image_target["ideaKey"],
                            "title": hero_idea.get("title"),
                            "summary": hero_idea.get("summary"),
                            "goal": hero_idea.get("goal"),
                        },
                        fields=hero_fields,
                        variant_index=int(image_target["variantIndex"]),
                        auth_token=auth_token,
                    )
                    if not attach.get("ok"):
                        progress = {
                            **progress,
                            "phase": "hero_images",
                            "lastImageError": str(attach.get("error") or "attach failed"),
                        }
                        update_job(progress=progress)
                        logs.append(
                            {
                                "level": "warn",
                                "msg": "Gallery: hero image attach failed — will retry",
                                "data": {
                                    "orgId": org_id,
                                    "galleryKey": image_target["galleryKey"],
                                    "error": attach.get("error"),
                                },
                            }
                        )
                        break
                    if not attach.get("skipped"):
                        patch = (
                            attach.get("metadata_patch")
                            if isinstance(attach.get("metadata_patch"), dict)
                            else {}
                        )
                        existing_meta = (
                            hero_row.get("metadata")
                            if isinstance(hero_row.get("metadata"), dict)
                            else {}
                        )
                        tpl_payload = {
                            "gallery_key": image_target["galleryKey"],
                            "name": str(hero_row.get("name") or hero_idea.get("title") or ""),
                            "description": str(
                                hero_row.get("description") or hero_idea.get("summary") or ""
                            ),
                            "goal": str(hero_row.get("goal") or hero_idea.get("goal") or ""),
                            "primary_channel": "email",
                            "channels": ["email"],
                            "body_preview": str(hero_row.get("bodyPreview") or ""),
                            "content_body": str(hero_row.get("contentBody") or ""),
                            "preview_image": attach.get("preview_image"),
                            "preview": attach.get("preview"),
                            "fields": attach.get("fields") or hero_fields,
                            "metadata": {
                                **existing_meta,
                                **patch,
                                "galleryStatus": "active",
                                "campaignIdeaId": hero_idea.get("id"),
                                "campaignIdeaKey": image_target["ideaKey"],
                                "campaignIdeaTitle": hero_idea.get("title"),
                                "packId": org_ctx.get("packId"),
                            },
                        }
                        upsert_template(tpl_payload)
                        # refresh local row
                        hero_row.update(
                            {
                                "previewImage": attach.get("preview_image"),
                                "preview": attach.get("preview"),
                                "fields": attach.get("fields") or hero_fields,
                                "metadata": tpl_payload["metadata"],
                            }
                        )
                        generated_this_tick += 1
                        logs.append(
                            {
                                "level": "info",
                                "msg": "Gallery: hero image attached",
                                "data": {
                                    "orgId": org_id,
                                    "galleryKey": image_target["galleryKey"],
                                },
                            }
                        )
                        continue

                if (
                    hero_idea
                    and hero_fields
                    and image_target["kind"] == "web_push_sync"
                ):
                    existing_preview = (
                        hero_row.get("preview")
                        if isinstance(hero_row.get("preview"), dict)
                        else None
                    )
                    sync = sync_gallery_web_push_image_from_email(
                        idea={
                            "idea_key": image_target["ideaKey"],
                            "title": hero_idea.get("title"),
                            "summary": hero_idea.get("summary"),
                            "goal": hero_idea.get("goal"),
                        },
                        web_fields=hero_fields,
                        email_image_url=str(image_target.get("emailImageUrl") or ""),
                        variant_index=int(image_target["variantIndex"]),
                        existing_preview=existing_preview,
                    )
                    if not sync.get("ok"):
                        progress = {
                            **progress,
                            "phase": "hero_images",
                            "lastImageError": str(sync.get("error") or "sync failed"),
                        }
                        update_job(progress=progress)
                        logs.append(
                            {
                                "level": "warn",
                                "msg": "Gallery: web push image sync failed — will retry",
                                "data": {
                                    "orgId": org_id,
                                    "galleryKey": image_target["galleryKey"],
                                    "error": sync.get("error"),
                                },
                            }
                        )
                        break
                    if not sync.get("skipped"):
                        patch = (
                            sync.get("metadata_patch")
                            if isinstance(sync.get("metadata_patch"), dict)
                            else {}
                        )
                        existing_meta = (
                            hero_row.get("metadata")
                            if isinstance(hero_row.get("metadata"), dict)
                            else {}
                        )
                        tpl_payload = {
                            "gallery_key": image_target["galleryKey"],
                            "name": str(hero_row.get("name") or hero_idea.get("title") or ""),
                            "description": str(
                                hero_row.get("description") or hero_idea.get("summary") or ""
                            ),
                            "goal": str(hero_row.get("goal") or hero_idea.get("goal") or ""),
                            "primary_channel": "web_push",
                            "channels": ["web_push"],
                            "body_preview": str(hero_row.get("bodyPreview") or ""),
                            "content_body": str(hero_row.get("contentBody") or ""),
                            "preview_image": sync.get("preview_image"),
                            "preview": sync.get("preview"),
                            "fields": sync.get("fields") or hero_fields,
                            "metadata": {
                                **existing_meta,
                                **patch,
                                "galleryStatus": "active",
                                "campaignIdeaId": hero_idea.get("id"),
                                "campaignIdeaKey": image_target["ideaKey"],
                                "campaignIdeaTitle": hero_idea.get("title"),
                                "packId": org_ctx.get("packId"),
                            },
                        }
                        upsert_template(tpl_payload)
                        hero_row.update(
                            {
                                "previewImage": sync.get("preview_image"),
                                "preview": sync.get("preview"),
                                "fields": sync.get("fields") or hero_fields,
                                "metadata": tpl_payload["metadata"],
                            }
                        )
                        generated_this_tick += 1
                        continue

            remaining = _count_remaining(working_ideas, channels, key_set)
            hero_remaining = len(
                gallery_image_work_targets_for_org(working_ideas, channels, rows_by_key)
            )
            phase = (
                "completed_partial"
                if remaining > 0 or hero_remaining > 0
                else "completed"
            )
            update_job(
                status="completed",
                progress={
                    **progress,
                    "phase": phase,
                    "ideasDone": idea_count,
                    "templatesDone": len(keys),
                    "templatesRemaining": remaining,
                    "heroImagesRemaining": hero_remaining,
                },
            )
            logs.append(
                {
                    "level": "info",
                    "msg": "Gallery bootstrap completed",
                    "data": {
                        "orgId": org_id,
                        "remaining": remaining,
                        "heroRemaining": hero_remaining,
                        "phase": phase,
                    },
                }
            )
            return {"ok": True, "mutations": mutations, "logs": logs}

        next_spec = picked["spec"]
        next_idea = picked["idea"]
        force_regen = bool(picked.get("forceRegen"))
        idea_key = str(next_idea.get("ideaKey") or next_idea.get("idea_key") or "")

        if not force_regen and next_spec["gallery_key"] in key_set:
            progress["templatesDone"] = len(keys)
            update_job(progress=progress)
            break

        idea_email_key = f"{idea_key}:email:txt:01"
        idea_email_row = rows_by_key.get(idea_email_key)
        idea_email_fields = (
            idea_email_row.get("fields")
            if idea_email_row and isinstance(idea_email_row.get("fields"), dict)
            else None
        )
        idea_email_image_url = str(
            (idea_email_row or {}).get("previewImage")
            or (idea_email_row or {}).get("preview_image")
            or ""
        ).strip() or (
            hero_url_from_fields(idea_email_fields) if idea_email_fields else ""
        )

        prior_gallery_templates: list[dict[str, Any]] = []
        for row in working_templates:
            fields = row.get("fields")
            if not isinstance(fields, dict):
                continue
            key = _row_key(row)
            if key == next_spec["gallery_key"]:
                continue
            primary = str(row.get("primaryChannel") or row.get("primary_channel") or "")
            if next_spec["primary_channel"] == "web_push":
                if primary == "email" and key.startswith(f"{idea_key}:email:"):
                    prior_gallery_templates.append(
                        {"channel": "email", "fields": fields, "gallery_key": key}
                    )
            elif primary == "email":
                prior_gallery_templates.append(
                    {"channel": "email", "fields": fields, "gallery_key": key}
                )

        spec_payload = dict(next_spec)
        if (
            next_spec["primary_channel"] == "web_push"
            and next_spec.get("has_image")
            and _reachable_http(idea_email_image_url)
        ):
            spec_payload["email_image_url"] = idea_email_image_url

        try:
            gen = await generate_gallery_library_template(
                org=org,
                idea={
                    "idea_key": idea_key,
                    "title": next_idea.get("title"),
                    "summary": next_idea.get("summary"),
                    "goal": next_idea.get("goal"),
                    "image_url": next_idea.get("imageUrl") or next_idea.get("image_url"),
                },
                spec=spec_payload,
                auth_token=auth_token,
                prior_templates=prior_gallery_templates,
            )
        except Exception as exc:  # noqa: BLE001
            _log.exception("gallery template generation failed")
            gen = {"ok": False, "error": str(exc)}

        if not gen.get("ok"):
            failures = dict(progress.get("templateFailures") or {}) if isinstance(progress.get("templateFailures"), dict) else {}
            key = next_spec["gallery_key"]
            failures[key] = _template_failure_count(progress, key) + 1
            progress = {
                **progress,
                "phase": "templates",
                "templateFailures": failures,
                "lastTemplateError": str(gen.get("error") or "template failed"),
                "templatesDone": len(keys),
            }
            update_job(progress=progress)
            logs.append(
                {
                    "level": "warn",
                    "msg": "Gallery: template chunk failed — will retry or skip",
                    "data": {
                        "orgId": org_id,
                        "galleryKey": key,
                        "attempt": failures[key],
                        "error": gen.get("error"),
                    },
                }
            )
            break

        if gen.get("skipped"):
            break

        tpl = gen.get("template") if isinstance(gen.get("template"), dict) else None
        if not tpl:
            break

        meta = tpl.get("metadata") if isinstance(tpl.get("metadata"), dict) else {}
        tpl_payload = {
            "gallery_key": str(tpl.get("gallery_key") or next_spec["gallery_key"]),
            "name": str(tpl.get("name") or next_idea.get("title") or ""),
            "description": str(tpl.get("description") or next_idea.get("summary") or ""),
            "goal": str(tpl.get("goal") or next_idea.get("goal") or ""),
            "primary_channel": str(
                tpl.get("primary_channel") or next_spec["primary_channel"]
            ),
            "channels": [
                str(tpl.get("primary_channel") or next_spec["primary_channel"])
            ],
            "body_preview": str(tpl.get("body_preview") or ""),
            "content_body": str(tpl.get("content_body") or ""),
            "preview_image": tpl.get("preview_image")
            or next_idea.get("imageUrl")
            or next_idea.get("image_url"),
            "preview": tpl.get("preview"),
            "fields": tpl.get("fields"),
            "metadata": {
                **meta,
                "galleryStatus": "active",
                "campaignIdeaId": next_idea.get("id"),
                "campaignIdeaKey": idea_key,
                "campaignIdeaTitle": next_idea.get("title"),
                "packId": org_ctx.get("packId"),
            },
        }
        upsert_template(tpl_payload)
        working_templates.append(
            {
                "seedSlug": tpl_payload["gallery_key"],
                "galleryKey": tpl_payload["gallery_key"],
                "primaryChannel": tpl_payload["primary_channel"],
                "fields": tpl_payload["fields"],
                "previewImage": tpl_payload["preview_image"],
                "preview": tpl_payload["preview"],
                "metadata": tpl_payload["metadata"],
                "name": tpl_payload["name"],
                "description": tpl_payload["description"],
                "goal": tpl_payload["goal"],
                "bodyPreview": tpl_payload["body_preview"],
                "contentBody": tpl_payload["content_body"],
            }
        )
        generated_this_tick += 1

    templates_done = len(_existing_keys(working_templates))
    progress = {
        **progress,
        "phase": "templates",
        "ideasDone": idea_count,
        "templatesDone": templates_done,
    }
    update_job(progress=progress)
    if generated_this_tick > 0:
        logs.append(
            {
                "level": "info",
                "msg": "Gallery: template chunk(s) generated",
                "data": {
                    "orgId": org_id,
                    "generatedThisTick": generated_this_tick,
                    "templatesDone": templates_done,
                },
            }
        )

    return {"ok": True, "mutations": mutations, "logs": logs}
