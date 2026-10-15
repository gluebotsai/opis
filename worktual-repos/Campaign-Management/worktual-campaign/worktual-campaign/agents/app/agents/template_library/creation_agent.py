"""Creation orchestrator agent.

After CREATE_TEMPLATES / build_campaign:
1) Information Enhancer + Style Director (when enabled) pick per-channel design
2) Dispatch each selected channel's dedicated LLM agent with design plan + narrative
3) Aggregate structured templates + creative fingerprints for UI cards

No static bodies. No keyword intent matching.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from app.agents.template_generation_director.creative_fingerprints import (
    extract_fingerprint,
    merge_prior_templates,
)
from app.agents.template_generation_director.workflow import (
    critique_template,
    plan_generation,
)
from app.agents.template_library.channels import CHANNEL_AGENTS, get_channel_agent
from app.agents.template_library.channels.whatsapp.meta_rules import (
    sanitize_whatsapp_fields,
)
from app.config import get_settings
from app.knowledge_base import fetch_campaign_knowledge
from app.request_context import get_request_token
from app.template_store import list_recent_org_templates

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]

_log = logging.getLogger(__name__)


def _director_report_ok(report: dict[str, Any] | None) -> bool:
    if not isinstance(report, dict) or not report:
        return False
    if report.get("error"):
        return False
    layers = report.get("layers") if isinstance(report.get("layers"), dict) else {}
    if layers.get("style_plan") == "failed":
        return False
    trace = report.get("mas_trace") if isinstance(report.get("mas_trace"), dict) else {}
    if trace.get("status") == "failed":
        return False
    return bool(layers or trace.get("orchestrator") == "template_director")


CHANNEL_LOGOS = {
    "email": "email",
    "sms": "sms",
    "whatsapp": "whatsapp",
    "push": "push",
    "web": "web",
    "ppc": "ppc",
}


def _plans_from_payload(
    channels: list[str],
    plans: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """One plan per selected channel — never drop channels because plans are partial."""
    by_ch: dict[str, dict[str, Any]] = {}
    for plan in plans or []:
        if not isinstance(plan, dict):
            continue
        ch = str(plan.get("channel") or "").strip().lower()
        if ch == "web_push":
            ch = "web"
        elif ch == "app_push":
            ch = "push"
        if ch:
            by_ch[ch] = dict(plan)
            by_ch[ch]["channel"] = ch

    selected = [str(c).strip().lower() for c in (channels or []) if str(c).strip()]
    if not selected and by_ch:
        selected = list(by_ch.keys())

    out: list[dict[str, Any]] = []
    for ch in selected:
        if ch in by_ch:
            out.append(by_ch[ch])
        else:
            out.append(
                {
                    "channel": ch,
                    "how_it_works": f"{ch} touch for this campaign",
                    "suggested_launch_at": (
                        datetime.now(timezone.utc) + timedelta(days=1)
                    ).isoformat(),
                }
            )
    return out


def _prior_by_channel(
    prior_templates: list[dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in prior_templates or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        if ch == "web_push":
            ch = "web"
        elif ch == "app_push":
            ch = "push"
        if not ch:
            continue
        latest[ch] = row
    return latest


def _merge_director_plans(
    base_jobs: list[dict[str, Any]],
    director_plans: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_ch = {
        str(row.get("channel") or "").strip().lower(): row
        for row in director_plans
        if isinstance(row, dict) and str(row.get("channel") or "").strip()
    }
    merged: list[dict[str, Any]] = []
    for job in base_jobs:
        ch = str(job.get("channel") or "").strip().lower()
        enriched = dict(by_ch.get(ch) or {})
        out = {**job, **enriched, "channel": ch}
        merged.append(out)
    return merged


def _inject_ready_image(fields: dict[str, Any], channel: str, image_url: str) -> dict[str, Any]:
    """Deterministically place a ready image URL into template fields."""
    url = str(image_url or "").strip()
    if not url:
        return fields
    current = fields if isinstance(fields, dict) else {}
    if str(channel or "").strip().lower() == "email":
        html = str(current.get("compiled_html") or "").strip()
        if html:
            try:
                from app.mas.phase2_compose.html_images import map_hero_fields

                return map_hero_fields(current, url)
            except Exception:  # noqa: BLE001
                pass
    try:
        from app.agents.image.channel_image import build_attach_fields_for_channel

        patched = build_attach_fields_for_channel(
            current,
            channel=channel,
            image_url=url,
        )
        if isinstance(patched, dict) and patched:
            return patched
    except Exception:  # noqa: BLE001
        pass
    out = dict(current)
    if channel == "email":
        out.setdefault("header_image", url)
        out.setdefault("image_url", url)
    elif channel == "whatsapp":
        out["header_media_url"] = url
        out["header_format"] = "IMAGE"
    elif channel == "web":
        out["image_url"] = url
    return out


async def _run_email_designer(
    *,
    campaign: dict[str, Any],
    audience: dict[str, Any],
    plan: dict[str, Any],
    knowledge: str,
    campaign_profile: dict[str, Any] | None,
    company_pack: dict[str, Any] | None,
    user_request: str,
    chat_summary: str,
    prior_templates: list[dict[str, Any]] | None,
    event_callback: ProgressCallback | None,
    image_url: str = "",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Email-only: information enhancer + style director → design_plan on the job."""
    if not get_settings().template_director_enabled:
        return plan, {}
    wants_images = bool(image_url) or bool(
        isinstance(plan.get("image"), dict)
        and str((plan.get("image") or {}).get("mode") or "") in ("ready", "generate")
    )
    image_plan = {"wants_images": wants_images, "channels": ["email"]} if wants_images else None
    try:
        _brief, director_plans, generation_report = await plan_generation(
            campaign=campaign,
            audience=audience,
            channels=["email"],
            channel_plans=[plan],
            knowledge=knowledge,
            campaign_profile=campaign_profile,
            company_pack=company_pack,
            user_request=user_request,
            chat_summary=chat_summary,
            prior_templates=prior_templates,
            event_callback=event_callback,
            wants_images=wants_images,
            image_plan=image_plan,
        )
        merged = _merge_director_plans([plan], director_plans)
        out_plan = merged[0] if merged else plan
        if image_url:
            out_plan = {
                **out_plan,
                "image": {"mode": "ready", "image_url": image_url, "source": "pre_resolved"},
                "ready_image_url": image_url,
            }
        generation_report["mas_trace"] = {
            "domain": "creation",
            "orchestrator": "email_channel_designer",
            "pipeline": [
                "information_enhancer",
                "style_director",
                "email_content_agent",
                "style_critic",
            ],
        }
        return out_plan, generation_report
    except Exception as exc:  # noqa: BLE001
        _log.warning("Email designer failed: %s", exc)
        return plan, {
            "layers": {"style_plan": "failed"},
            "error": str(exc),
            "mas_trace": {"orchestrator": "email_channel_designer", "status": "failed"},
        }


async def _run_channel_agent(
    channel: str,
    plan: dict[str, Any],
    campaign: dict[str, Any],
    audience: dict[str, Any],
    knowledge: str = "",
    prior_template: dict[str, Any] | None = None,
    prior_templates: list[dict[str, Any]] | None = None,
    *,
    create_payload: dict[str, Any] | None = None,
    campaign_profile: dict[str, Any] | None = None,
    company_pack: dict[str, Any] | None = None,
    user_request: str = "",
    chat_summary: str = "",
    event_callback: ProgressCallback | None = None,
    use_phase2_email: bool = True,
    organization_id: str = "",
    generation_batch_id: str = "",
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    agent = get_channel_agent(channel)
    if agent is None:
        raise RuntimeError(f"No channel agent registered for '{channel}'")
    launch = plan.get("suggested_launch_at") or (
        datetime.now(timezone.utc) + timedelta(days=1)
    ).isoformat()

    from app.agents.template_library.create_payload import channel_slice, ready_image_url

    ch_slice = channel_slice(create_payload or {}, channel) if create_payload else {}
    image_url = ready_image_url(ch_slice) or str(plan.get("ready_image_url") or "").strip()
    work_plan = dict(plan)
    if ch_slice.get("user_note"):
        work_plan["user_note"] = ch_slice["user_note"]
    if ch_slice.get("image"):
        work_plan["image"] = ch_slice["image"]
    if image_url:
        work_plan["ready_image_url"] = image_url
    if create_payload and isinstance(create_payload.get("common"), dict):
        work_plan["create_common"] = create_payload["common"]
        work_plan["compliance"] = create_payload["common"].get("compliance") or {}
    if channel == "whatsapp":
        try:
            from app.agents.template_library.channels.whatsapp.meta_rules import (
                collect_whatsapp_meta_names,
            )

            work_plan["whatsapp_taken_names"] = collect_whatsapp_meta_names(
                prior_templates,
            )
        except Exception:  # noqa: BLE001
            work_plan["whatsapp_taken_names"] = []

    generation_report: dict[str, Any] = {}
    if channel == "email" and use_phase2_email:
        from app.mas.executors.email_html_compose.runner import compose_email_template_card

        composed = await compose_email_template_card(
            campaign=campaign,
            channel_plan=work_plan,
            user_request=user_request,
            chat_summary=chat_summary,
            knowledge=knowledge,
            company_pack=company_pack,
            campaign_profile=campaign_profile,
            prior_template=prior_template,
            launch_at=str(launch or ""),
            event_callback=event_callback,
            organization_id=organization_id,
            generation_batch_id=generation_batch_id,
            session=session if isinstance(session, dict) else None,
        )
        if image_url:
            fields = _inject_ready_image(
                composed.get("fields") if isinstance(composed.get("fields"), dict) else {},
                channel,
                image_url,
            )
            composed["fields"] = fields
            hero = str(fields.get("header_image") or fields.get("image_url") or "").strip()
            if "/api/media/" in hero.lower():
                warns = [
                    w
                    for w in (fields.get("warnings") or [])
                    if "did not attach" not in str(w).lower()
                ]
                fields["warnings"] = warns
                composed["fields"] = fields
        return composed

    if channel == "email" and not use_phase2_email:
        _log.info(
            "email_template_path=director prior_template_id=%s",
            str((prior_template or {}).get("template_id") or "") or None,
        )
        if get_settings().template_director_enabled:
            work_plan, generation_report = await _run_email_designer(
                campaign=campaign,
                audience=audience,
                plan=work_plan,
                knowledge=knowledge,
                campaign_profile=campaign_profile,
                company_pack=company_pack,
                user_request=user_request,
                chat_summary=chat_summary,
                prior_templates=prior_templates,
                event_callback=event_callback,
                image_url=image_url,
            )
            if not _director_report_ok(generation_report):
                err = str(
                    generation_report.get("error")
                    or "Email Template Director did not produce a design plan."
                )
                raise RuntimeError(err)

    brief = (
        work_plan.get("creative_brief")
        if isinstance(work_plan.get("creative_brief"), dict)
        else {}
    )
    design = (
        work_plan.get("design_plan")
        if isinstance(work_plan.get("design_plan"), dict)
        else {}
    )

    fields = await agent.generate(
        campaign=campaign,
        audience_summary=audience,
        plan=work_plan,
        knowledge=knowledge,
        prior_template=prior_template,
    )

    if get_settings().template_director_enabled and brief and design:
        critique = await critique_template(
            channel=channel,
            fields=fields,
            brief=brief,
            design_plan=design,
            prior_templates=prior_templates,
        )
        if (
            not critique.get("pass")
            and critique.get("status") == "completed"
            and critique.get("failures")
        ):
            retry_plan = {
                **work_plan,
                "critique_failures": list(critique.get("failures") or []),
            }
            fields = await agent.generate(
                campaign=campaign,
                audience_summary=audience,
                plan=retry_plan,
                knowledge=knowledge,
                prior_template=prior_template,
            )

    if image_url:
        fields = _inject_ready_image(fields, channel, image_url)

    if channel == "whatsapp":
        taken = (
            work_plan.get("whatsapp_taken_names")
            if isinstance(work_plan.get("whatsapp_taken_names"), list)
            else []
        )
        fields = _ensure_whatsapp_meta_name(fields, campaign, taken_names=taken)
        fields = sanitize_whatsapp_fields(fields, campaign=campaign)
    fp = extract_fingerprint(channel=channel, fields=fields, design_plan=design)
    fields["creative_fingerprint"] = fp
    out = {
        "template_id": str(uuid.uuid4()),
        "channel": channel,
        "logo": CHANNEL_LOGOS.get(channel, channel),
        "launch_at": launch,
        "fields": fields,
        "how_it_works": work_plan.get("how_it_works") or plan.get("how_it_works") or "",
    }
    if generation_report:
        out["_generation_report"] = generation_report
        if isinstance(work_plan.get("design_plan"), dict):
            out["_design_plan"] = work_plan["design_plan"]
    return out


def _ensure_whatsapp_meta_name(
    fields: dict[str, Any],
    campaign: dict[str, Any],
    *,
    taken_names: list[str] | None = None,
    preserve_name: bool = False,
) -> dict[str, Any]:
    """Guarantee a Meta-safe unique template name (WABA name+language unique)."""
    out = dict(fields or {})
    raw = str(out.get("name") or "").strip().lower()
    taken = {str(n).strip().lower() for n in (taken_names or []) if str(n).strip()}

    cleaned = re.sub(r"[^a-z0-9_]+", "_", raw)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    if not cleaned:
        base = re.sub(
            r"[^a-z0-9_]+",
            "_",
            str(campaign.get("name") or "campaign").lower(),
        )
        base = re.sub(r"_+", "_", base).strip("_")[:40] or "wa_campaign"
        cleaned = base
    reserved = {"template", "whatsapp", "wa", "test", "campaign"}
    needs_suffix = (
        not preserve_name
        or cleaned in taken
        or cleaned in reserved
        or not re.search(r"_[a-f0-9]{6,}$", cleaned)
    )
    if needs_suffix and not preserve_name:
        stem = cleaned[:503].rstrip("_") or "wa_campaign"
        for _ in range(12):
            candidate = f"{stem}_{uuid.uuid4().hex[:8]}"
            if candidate not in taken:
                cleaned = candidate
                break
    elif cleaned in taken or cleaned in reserved:
        stem = cleaned[:503].rstrip("_") or "wa_campaign"
        for _ in range(12):
            candidate = f"{stem}_{uuid.uuid4().hex[:8]}"
            if candidate not in taken:
                cleaned = candidate
                break
    out["name"] = cleaned[:512]
    if not str(out.get("language") or "").strip():
        out["language"] = "en"
    cat = str(out.get("category") or "MARKETING").strip().upper()
    if cat not in {"MARKETING", "UTILITY", "AUTHENTICATION"}:
        cat = "MARKETING"
    out["category"] = cat
    return out


async def run_creation_agent(
    *,
    campaign: dict[str, Any],
    audience: dict[str, Any],
    channels: list[str],
    channel_plans: list[dict[str, Any]] | None = None,
    prior_templates: list[dict[str, Any]] | None = None,
    event_callback: ProgressCallback | None = None,
    campaign_profile: dict[str, Any] | None = None,
    company_pack: dict[str, Any] | None = None,
    user_request: str = "",
    chat_summary: str = "",
    wants_images: bool = False,
    creative_policy: dict[str, Any] | None = None,
    image_plan: dict[str, Any] | None = None,
    confirmed_chat_images: list[dict[str, Any]] | None = None,
    session: dict[str, Any] | None = None,
    create_payload: dict[str, Any] | None = None,
    use_phase2_email: bool = True,
) -> dict[str, Any]:
    """Create templates from a clear payload: common + per-channel slices.

    Email: Phase 2 HTML compose when ``use_phase2_email`` (default).
    Chat UI and Hub on-demand both use this path. Pass False only to force
    Phase 1 director + content agent.
    """
    from app.agents.image.channel_visual_orchestrator import (
        apply_inherit_from_email_templates,
    )
    from app.agents.template_library.create_payload import (
        apply_ready_image_urls,
        build_create_payload,
        channels_needing_image_generation,
        channels_needing_image_generation_from_resolution,
        channels_with_image_slices,
        fan_out_shared_image_urls,
        ready_image_url,
        channel_slice,
    )

    selected = [
        str(c).strip().lower()
        for c in (channels or [])
        if str(c).strip().lower() in CHANNEL_AGENTS
    ]
    base_plans = _plans_from_payload(selected, list(channel_plans or []))
    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for plan in base_plans:
        ch = str(plan.get("channel") or "").strip().lower()
        if ch not in CHANNEL_AGENTS or ch in seen:
            continue
        if selected and ch not in selected:
            continue
        seen.add(ch)
        jobs.append(plan)

    if not jobs and selected:
        jobs = _plans_from_payload(selected, [])

    if not jobs:
        return {
            "ok": False,
            "error": "Creation agent: no channel agents to run for selected channels.",
            "templates": [],
        }

    channel_names = [
        str(plan.get("channel") or "").strip().lower() for plan in jobs
    ]
    generation_batch_id = str(uuid.uuid4())

    def _trace_stage(stage: str, **fields: Any) -> None:
        try:
            from app.mas.runtime.turn_audit_log import turn_audit_stage

            turn_audit_stage(stage, **fields)
        except Exception:  # noqa: BLE001
            pass

    sess = session if isinstance(session, dict) else {}
    knowledge = await fetch_campaign_knowledge(
        campaign,
        session=sess,
        query=user_request,
    )
    payload = create_payload if isinstance(create_payload, dict) else None
    if not payload:
        payload = build_create_payload(
            sess,
            channels=channel_names,
            campaign=campaign,
            channel_plans=jobs,
            knowledge=knowledge,
            user_request=user_request,
        )
    else:
        payload = dict(payload)
        payload["knowledge"] = str(payload.get("knowledge") or knowledge or "").strip()

    _trace_stage(
        "create_start",
        channels=channel_names,
        channel_count=len(jobs),
        session_id=str(sess.get("session_id") or "") or None,
        wants_images=bool(wants_images),
    )

    # Pre-generate images when asked; pass ready URLs into content agents.
    images_by_channel: dict[str, str] = {}
    for row in payload.get("channels") or []:
        if not isinstance(row, dict):
            continue
        url = ready_image_url(row)
        ch = str(row.get("channel") or "").strip().lower()
        if ch and url:
            images_by_channel[ch] = url

    plan_mode = str(payload.get("image_mode") or "shared").strip().lower()
    need_gen = channels_needing_image_generation_from_resolution(
        payload, plan_mode=plan_mode
    )
    # Also honor wants_images / image_plan when slice said generate.
    if wants_images and image_plan and isinstance(image_plan, dict):
        for ch in image_plan.get("channels") or []:
            ch_n = str(ch).strip().lower()
            if (
                ch_n in channel_names
                and ch_n not in images_by_channel
                and ch_n not in need_gen
            ):
                slice_row = channel_slice(payload, ch_n)
                image = slice_row.get("image") if isinstance(slice_row.get("image"), dict) else {}
                if str(image.get("mode") or "") == "generate":
                    if plan_mode == "shared" and need_gen:
                        continue
                    need_gen.append(ch_n)

    pre_image_ui: list[dict[str, Any]] = []
    image_errors: list[str] = []
    if need_gen and sess:
        if event_callback:
            await event_callback(
                {
                    "type": "template_progress",
                    "payload": {
                        "status": "generating",
                        "label": "Generating campaign images…",
                        "stage": "images",
                        "channels": list(need_gen),
                        "completed_channels": [],
                        "failed_channels": [],
                        "percent": 10,
                        "generation_batch_id": generation_batch_id,
                    },
                }
            )
        try:
            from app.agents.image.batch import generate_campaign_images
            from app.agents.image.plan import set_image_plan

            plan_chs = channels_with_image_slices(payload) or [
                ch for ch in channel_names if channel_slice(payload, ch).get("image")
            ]
            set_image_plan(
                sess,
                wants_images=True,
                channels=plan_chs or need_gen,
                mode=str(payload.get("image_mode") or "shared"),
                scope="subset",
                auto_after_build=False,
                user_confirmed=True,
            )
            token = ""
            try:
                token = get_request_token()
            except RuntimeError:
                token = ""
            gen = await generate_campaign_images(
                sess, token=token or "", channels=need_gen
            )
            if gen.get("ok"):
                for ch, url in (gen.get("images_by_channel") or {}).items():
                    if str(url).strip():
                        images_by_channel[str(ch).strip().lower()] = str(url).strip()
                images_by_channel = fan_out_shared_image_urls(
                    images_by_channel,
                    payload,
                    plan_mode=plan_mode,
                )
                pre_image_ui = list(gen.get("ui_events") or [])
                missing = [
                    str(ch).strip().lower()
                    for ch in need_gen
                    if str(ch).strip().lower() not in images_by_channel
                ]
                if missing:
                    image_errors.append(
                        "Images did not attach for " + ", ".join(missing)
                    )
            else:
                err = str(gen.get("error") or "image generate failed")
                _log.warning(
                    "Pre-generate images failed (continuing without): %s",
                    err,
                )
                image_errors.append(f"Images did not attach: {err[:240]}")
        except Exception as img_exc:  # noqa: BLE001
            _log.warning("Pre-generate images error (continuing without): %s", img_exc)
            image_errors.append(f"Images did not attach: {img_exc}")

    if images_by_channel:
        payload = apply_ready_image_urls(payload, images_by_channel)

    # Merge payload channel slices onto jobs (required fields only).
    for job in jobs:
        ch = str(job.get("channel") or "").strip().lower()
        slice_row = channel_slice(payload, ch)
        if slice_row.get("user_note"):
            job["user_note"] = slice_row["user_note"]
        if slice_row.get("image"):
            job["image"] = slice_row["image"]
        url = ready_image_url(slice_row)
        if url:
            job["ready_image_url"] = url
        if isinstance(payload.get("common"), dict):
            job["create_common"] = payload["common"]
            job["compliance"] = payload["common"].get("compliance") or {}

    generation_report: dict[str, Any] = {}
    design_plans: list[dict[str, Any]] = []

    merged_prior = list(prior_templates or [])
    settings = get_settings()
    if settings.template_director_enabled and settings.template_org_fingerprints_enabled:
        token = ""
        try:
            token = get_request_token()
        except RuntimeError:
            token = ""
        org_recent: list[dict[str, Any]] = []
        for ch in channel_names:
            try:
                rows = await list_recent_org_templates(
                    channel=ch,
                    limit=12,
                    token=token or None,
                )
                org_recent.extend(rows)
            except Exception:  # noqa: BLE001
                continue
        merged_prior = merge_prior_templates(prior_templates, org_recent)

    prior_map = _prior_by_channel(merged_prior)
    policy = creative_policy if isinstance(creative_policy, dict) else {}
    design_mode = str(policy.get("design_mode") or "").strip().lower()
    content_mode = str(policy.get("content_mode") or "").strip().lower()
    for job in jobs:
        ch = str(job.get("channel") or "").strip().lower()
        if policy:
            job["creative_policy"] = {
                k: policy[k]
                for k in ("content_mode", "design_mode", "image_mode")
                if policy.get(k)
            }
            if design_mode == "rewrite":
                job["regenerate_layout"] = True
            elif design_mode == "keep":
                job["regenerate_layout"] = False
            elif prior_map.get(ch):
                job["regenerate_layout"] = True
            if content_mode == "keep":
                job["preserve_content"] = True
            if str(policy.get("image_mode") or "").strip().lower() == "keep":
                from app.agents.create_campaign.template_extract import hero_media_url

                image_slice = (
                    job.get("image") if isinstance(job.get("image"), dict) else {}
                )
                slice_source = str(image_slice.get("source") or "").strip()
                slice_mode = str(image_slice.get("mode") or "").strip()
                payload_resolved = bool(str(job.get("ready_image_url") or "").strip())
                if payload_resolved and slice_mode == "ready" and slice_source in (
                    "upload_or_gallery",
                    "ai_generate",
                    "inherit_email_primary",
                    "shared_from_email_compose",
                ):
                    pass
                else:
                    prior_hero = hero_media_url(prior_map.get(ch))
                    if prior_hero and not (
                        payload_resolved
                        and slice_source == "upload_or_gallery"
                    ):
                        job["ready_image_url"] = prior_hero
        elif prior_map.get(ch):
            job["regenerate_layout"] = True

    # Confirmed chat images kept for compatibility with callers.
    _ = confirmed_chat_images

    if event_callback:
        await event_callback(
            {
                "type": "template_progress",
                "payload": {
                    "status": "generating",
                    "label": "Writing channel templates…",
                    "channels": channel_names,
                    "completed_channels": [],
                    "failed_channels": [],
                    "percent": 25,
                    "generation_batch_id": generation_batch_id,
                },
            }
        )

    async def _tracked(channel: str, plan: dict[str, Any]) -> tuple[str, str, Any]:
        try:
            template = await _run_channel_agent(
                channel,
                plan,
                campaign,
                audience,
                knowledge,
                prior_map.get(channel),
                merged_prior,
                create_payload=payload,
                campaign_profile=campaign_profile,
                company_pack=company_pack,
                user_request=user_request,
                chat_summary=chat_summary,
                event_callback=event_callback,
                use_phase2_email=use_phase2_email,
                organization_id=str(sess.get("organization_id") or sess.get("tenant_id") or ""),
                generation_batch_id=generation_batch_id,
                session=sess,
            )
            return ("ok", channel, template)
        except Exception as exc:  # noqa: BLE001
            try:
                template = await _run_channel_agent(
                    channel,
                    plan,
                    campaign,
                    audience,
                    knowledge,
                    prior_map.get(channel),
                    merged_prior,
                    create_payload=payload,
                    campaign_profile=campaign_profile,
                    company_pack=company_pack,
                    user_request=user_request,
                    chat_summary=chat_summary,
                    event_callback=event_callback,
                    use_phase2_email=use_phase2_email,
                    organization_id=str(sess.get("organization_id") or sess.get("tenant_id") or ""),
                    generation_batch_id=generation_batch_id,
                    session=sess,
                )
                return ("ok", channel, template)
            except Exception as retry_exc:  # noqa: BLE001
                _trace_stage(
                    "create_channel_failed",
                    channel=channel,
                    error=str(retry_exc or exc)[:400],
                )
                return ("err", channel, retry_exc or exc)

    # Email designer is sequential inside email; other channels can fan out.
    # Run email first when present so progress messaging stays clear, then others.
    email_jobs = [j for j in jobs if str(j.get("channel") or "").lower() == "email"]
    other_jobs = [j for j in jobs if str(j.get("channel") or "").lower() != "email"]

    templates: list[dict[str, Any]] = []
    errors: list[str] = list(image_errors)
    completed: list[str] = []
    failed: list[str] = []
    finished_count = 0

    async def _consume(status: str, channel: str, payload_row: Any) -> None:
        nonlocal finished_count, generation_report
        finished_count += 1
        if status == "ok":
            template = payload_row
            if isinstance(template, dict):
                report = template.pop("_generation_report", None)
                design = template.pop("_design_plan", None)
                if isinstance(report, dict) and report:
                    generation_report = report
                if isinstance(design, dict):
                    design_plans.append(design)
                template["generation_batch_id"] = generation_batch_id
                templates.append(template)
                completed.append(channel)
                field_warns = (template.get("fields") or {}).get("warnings") or []
                if isinstance(field_warns, list):
                    for raw_w in field_warns:
                        note = str(raw_w or "").strip()
                        if note.lower().startswith("images did not attach"):
                            errors.append(note[:240])
        else:
            err = str(payload_row)
            errors.append(f"{channel}: {err}" if channel else err)
            if channel and channel not in failed:
                failed.append(channel)
            _log.warning("Channel template generation failed channel=%s: %s", channel, err)

        if event_callback:
            await event_callback(
                {
                    "type": "template_progress",
                    "payload": {
                        "status": "generating",
                        "label": "Writing channel templates…",
                        "channels": channel_names,
                        "current_channel": channel,
                        "completed_channels": list(completed),
                        "failed_channels": list(failed),
                        "percent": min(
                            95,
                            25
                            + round(
                                finished_count / max(len(channel_names), 1) * 70
                            ),
                        ),
                        "generation_batch_id": generation_batch_id,
                    },
                }
            )

    for plan in email_jobs:
        ch = str(plan.get("channel") or "").strip().lower()
        status, channel, payload_row = await _tracked(ch, plan)
        await _consume(status, channel, payload_row)

    if email_jobs and other_jobs and templates:
        payload = apply_inherit_from_email_templates(payload, templates)
        from app.agents.image.hero_image import select_primary_hero_url

        email_fields: dict[str, Any] = {}
        for row in templates:
            if str(row.get("channel") or "").strip().lower() == "email":
                raw = row.get("fields")
                if isinstance(raw, dict):
                    email_fields = raw
                break
        email_hero = select_primary_hero_url(email_fields) if email_fields else ""
        for job in other_jobs:
            ch = str(job.get("channel") or "").strip().lower()
            slice_row = channel_slice(payload, ch)
            if slice_row.get("image"):
                job["image"] = slice_row["image"]
            url = ready_image_url(slice_row)
            if not url and email_hero:
                image = (
                    slice_row.get("image")
                    if isinstance(slice_row.get("image"), dict)
                    else {}
                )
                mode = str(image.get("mode") or "")
                visual = str(image.get("visual") or "")
                if mode == "generate" or visual == "shared" or mode == "inherit_email_primary":
                    url = email_hero
                    job["image"] = {
                        "mode": "ready",
                        "image_url": email_hero,
                        "source": "shared_from_email_compose",
                    }
            if url:
                job["ready_image_url"] = url
                images_by_channel[ch] = url

    if other_jobs:
        tasks = [
            asyncio.create_task(
                _tracked(str(plan.get("channel") or "").strip().lower(), plan)
            )
            for plan in other_jobs
        ]
        for finished in asyncio.as_completed(tasks):
            status, channel, payload_row = await finished
            await _consume(status, channel, payload_row)

    order = {ch: i for i, ch in enumerate(channel_names)}
    templates.sort(key=lambda row: order.get(row["channel"], len(order)))

    if event_callback:
        label = "Saving templates…"
        final_status = "generating"
        percent = 96
        if failed and completed:
            label = (
                f"Saving {', '.join(completed)}; "
                f"failed: {', '.join(failed)}"
            )
        elif failed and not completed:
            label = "Template generation failed"
            final_status = "failed"
            percent = 100
        await event_callback(
            {
                "type": "template_progress",
                "payload": {
                    "status": final_status,
                    "label": label,
                    "channels": channel_names,
                    "completed_channels": list(completed),
                    "failed_channels": list(failed),
                    "percent": percent,
                    "generation_batch_id": generation_batch_id,
                },
            }
        )

    if not templates:
        _trace_stage(
            "create_done",
            ok=False,
            failed_channels=failed,
            error_count=len(errors),
            error_preview=(errors[0][:240] if errors else None),
        )
        return {
            "ok": False,
            "error": "All channel agents failed: " + "; ".join(errors),
            "templates": [],
            "errors": errors,
            "failed_channels": failed,
            "generation_report": generation_report,
            "design_plans": design_plans,
            "create_payload": payload,
            "images_by_channel": images_by_channel,
            "images_pre_resolved": bool(images_by_channel),
            "ui_events": pre_image_ui,
        }

    _trace_stage(
        "create_done",
        ok=True,
        template_count=len(templates),
        channels=[t["channel"] for t in templates],
        failed_channels=failed or None,
    )
    return {
        "ok": True,
        "templates": templates,
        "errors": errors,
        "channels": [t["channel"] for t in templates],
        "failed_channels": failed,
        "generation_batch_id": generation_batch_id,
        "generation_report": generation_report,
        "design_plans": design_plans,
        "create_payload": payload,
        "images_by_channel": images_by_channel,
        "images_pre_resolved": bool(images_by_channel),
        "ui_events": pre_image_ui,
    }


async def edit_with_channel_agent(
    channel: str,
    current_fields: dict[str, Any],
    instruction: str,
    campaign: dict[str, Any],
    recent_messages: list[dict[str, Any]] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    agent = get_channel_agent(channel)
    if agent is None:
        return {
            "intent": "clarify",
            "fields": None,
            "reply": "",
            "display_fields": None,
            "emit_template": False,
            "persist_fields": False,
        }
    return await agent.edit(
        current_fields=current_fields,
        instruction=instruction,
        campaign=campaign,
        recent_messages=recent_messages,
        **kwargs,
    )
