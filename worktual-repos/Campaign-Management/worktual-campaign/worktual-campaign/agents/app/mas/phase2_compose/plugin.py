"""Campaign adapter for the Phase 2 email compose domain.

Plugin: email create/regenerate calls TemplateDomain, then maps compiled_html
onto the existing email template card.
Query = this turn (user_request / latest user line) plus an earlier campaign
idea when it still adds facts, plus panel name/objective. Full recent chat
goes to plan/compose as Chat context. Edit/View stays on existing edit agents.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import get_settings
from app.mas.phase2_compose.domain import TemplateDomain
from app.mas.phase2_compose.llm import looks_like_html

_log = logging.getLogger(__name__)

PIPELINE = "compose"
_MAX_QUERY_CHARS = 4500
_MAX_CHAT_SUMMARY_CHARS = 2500
UNSUBSCRIBE_HREF = "{{unsubscribe_url}}"
UNSUBSCRIBE_HTML = (
    '<p style="margin-top:16px;font-size:12px;color:#666;text-align:center">'
    f'<a href="{UNSUBSCRIBE_HREF}" style="color:#666;text-decoration:underline">'
    "Unsubscribe</a></p>"
)
_UNSUB_ANCHOR_RE = re.compile(
    r"<a\b[^>]*href\s*=\s*[\"']\{\{\s*unsubscribe_url\s*\}\}[\"'][^>]*>",
    re.I,
)
_UNSUB_TAG_RE = re.compile(r"\{\{\s*unsubscribe_url\s*\}\}")
_ANY_A_TAG_RE = re.compile(r"<a\b[^>]*>(.*?)</a>", re.I | re.S)
_PLAIN_UNSUB_RE = re.compile(r"\bunsubscribe\b", re.I)
_A_OPEN_RE = re.compile(r"<a\b([^>]*)>", re.I)
_HREF_ATTR_RE = re.compile(r"href\s*=\s*(['\"])(.*?)\1", re.I | re.S)
_HTTP_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.I)
_IMAGE_PATH_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")
CAMPAIGN_URL_HREF = "{{campaign_url}}"
_CAMPAIGN_URL_RE = re.compile(r"\{\{\s*campaign_url\s*\}\}", re.I)
_SUBJECT_COMMENT_RE = re.compile(r"<!--\s*subject:\s*([^>]+?)\s*-->", re.I)
_TITLE_RE = re.compile(r"<title\b[^>]*>([\s\S]*?)</title>", re.I)
_H1_RE = re.compile(r"<h1\b[^>]*>([\s\S]*?)</h1>", re.I)
_UNSUB_LINK = (
    f'<a href="{UNSUBSCRIBE_HREF}" style="color:#666;text-decoration:underline">'
    "Unsubscribe</a>"
)
# Campaign-injected footer — drop when the template already has Unsubscribe.
_EXTRA_UNSUB_FOOTER_RE = re.compile(
    r'<p[^>]*>\s*<a\b[^>]*href\s*=\s*["\']\{\{\s*unsubscribe_url\s*\}\}["\'][^>]*>'
    r"\s*Unsubscribe\s*</a>\s*</p>\s*",
    re.I,
)


def _rewrite_unsub_anchor(tag: str) -> str:
    """Point an existing Unsubscribe <a> at the send merge tag (keep label)."""
    if _UNSUB_ANCHOR_RE.search(tag):
        return tag
    rewritten = re.sub(
        r"href\s*=\s*([\"']).*?\1",
        f'href="{UNSUBSCRIBE_HREF}"',
        tag,
        count=1,
        flags=re.I,
    )
    if rewritten == tag:
        rewritten = re.sub(
            r"<a\b",
            f'<a href="{UNSUBSCRIBE_HREF}"',
            tag,
            count=1,
            flags=re.I,
        )
    return rewritten


def _clip(text: str, limit: int) -> str:
    t = str(text or "").strip()
    if len(t) <= limit:
        return t
    return t[: max(0, limit - 1)].rstrip() + "…"


def use_phase2_email_compose(prior_template: dict[str, Any] | None = None) -> bool:
    """True when the Phase 2 email compose trial flag is on (create + regenerate)."""
    # prior_template kept for call-site compatibility; flag alone selects the path
    # so regenerate does not fall back to the section-director layout mid-trial.
    _ = prior_template
    return bool(get_settings().phase2_email_compose_enabled)


def _user_turns_from_chat_summary(chat_summary: str) -> list[str]:
    """Pull user: lines from chat_summary — no intent parsing."""
    out: list[str] = []
    for line in str(chat_summary or "").splitlines():
        raw = line.strip()
        if not raw.lower().startswith("user:"):
            continue
        text = raw.split(":", 1)[-1].strip()
        if text:
            out.append(text)
    return out


def _norm_ws(text: str) -> str:
    return " ".join(str(text or "").split()).lower()


def _latest_user_turn(*, user_request: str, chat_summary: str) -> str:
    """This generate turn: orchestrator user_text, else last user: line."""
    req = str(user_request or "").strip()
    if req:
        return req
    turns = _user_turns_from_chat_summary(chat_summary)
    return turns[-1] if turns else ""


def _earlier_idea_from_chat(*, latest: str, chat_summary: str) -> str:
    """Longest other user turn — campaign idea still in force. Not intent parsing."""
    latest_n = _norm_ws(latest)
    best = ""
    for text in _user_turns_from_chat_summary(chat_summary):
        t = text.strip()
        if not t or _norm_ws(t) == latest_n:
            continue
        if len(t) > len(best):
            best = t
    return best


def _build_query(
    *,
    campaign: dict[str, Any],
    user_request: str = "",
    chat_summary: str = "",
    knowledge: str = "",
) -> str:
    """This turn first, then earlier idea + panel. No knowledge dump."""
    _ = knowledge
    camp = campaign if isinstance(campaign, dict) else {}
    name = str(camp.get("name") or "").strip()
    goal = str(camp.get("goal") or "").strip()
    objective = str(camp.get("objective") or "").strip()
    panel = objective or goal or name
    latest = _latest_user_turn(
        user_request=user_request,
        chat_summary=chat_summary,
    )
    earlier = _earlier_idea_from_chat(latest=latest, chat_summary=chat_summary)

    parts: list[str] = []
    if latest:
        parts.append(latest)
    if earlier and earlier not in latest and len(earlier) >= len(latest):
        parts.append("Campaign idea:\n" + earlier)

    joined = "\n\n".join(parts)
    if panel and panel not in joined and len(panel) >= 12:
        if name and name not in joined:
            parts.append(f"{name}. {panel}")
        elif panel != name:
            parts.append(panel)
    elif name and name not in joined:
        parts.append(name)
    if not parts and panel:
        parts.append(f"{name}. {panel}" if name and panel != name else panel)
    elif not parts and name:
        parts.append(name)

    return _clip("\n\n".join(parts).strip(), _MAX_QUERY_CHARS)


def _strip_duplicate_unsub_footers(text: str) -> str:
    """Keep the first {{unsubscribe_url}} link; drop later injected-only footers."""
    first = _UNSUB_ANCHOR_RE.search(text)
    if not first:
        return text
    return text[: first.end()] + _EXTRA_UNSUB_FOOTER_RE.sub("", text[first.end() :])


def _is_dummy_cta_href(value: str) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return True
    lower = raw.lower()
    if lower.startswith("#") or lower.startswith("javascript:"):
        return True
    return lower in {"about:blank", "/"}


def knowledge_has_landing_url(*parts: Any) -> bool:
    """True when knowledge / request text includes a real page URL (not media)."""
    from app.campaign_destination_url import knowledge_has_landing_url as _has

    return _has(*parts)


def first_marketing_href_from_html(html: str) -> str:
    """First non-unsubscribe http(s) href in email HTML."""
    from app.campaign_destination_url import is_likely_page_url

    for match in _A_OPEN_RE.finditer(str(html or "")):
        attrs = match.group(1) or ""
        if "unsubscribe" in attrs.lower() or "unsubscribe_url" in attrs.lower():
            continue
        href_m = _HREF_ATTR_RE.search(attrs)
        if not href_m:
            continue
        url = str(href_m.group(2) or "").strip()
        if is_likely_page_url(url):
            return url
    return ""


def cta_constraint_for_compose(
    *,
    knowledge: Any = None,
    query: str = "",
    chat_summary: str = "",
    destination_url: str = "",
) -> str:
    """Fact for plan/compose — no invented buttons when there is no landing URL."""
    from app.campaign_destination_url import is_likely_page_url, resolve_campaign_destination_url

    dest = str(destination_url or "").strip()
    if not is_likely_page_url(dest):
        dest = resolve_campaign_destination_url(
            knowledge=str(knowledge or ""),
            extra_text=f"{query}\n{chat_summary}",
        )
        if not dest and knowledge_has_landing_url(knowledge, query, chat_summary):
            urls = []
            from app.campaign_destination_url import extract_page_urls_from_text

            urls = extract_page_urls_from_text(knowledge, query, chat_summary)
            dest = urls[0] if urls else ""
    if dest:
        return (
            "A product/landing URL is present. Only add a CTA if the user asked "
            "for a click action or the brief needs one. If you add a CTA, href "
            f"must be this exact URL: {dest} — never {{{{campaign_url}}}}, "
            "never href=\"#\", and never invent a different URL."
        )
    return (
        "No product/landing URL in knowledge or this request. Do not add a "
        "marketing button, Shop/Learn-more, or extra <a>. If you need a link, "
        "the host will ask the user. Campaign injects Unsubscribe. Prose only "
        "unless the user explicitly asked for a button AND provided https://…"
    )


def apply_destination_cta(html: str, dest: str = "") -> str:
    """Bake a real https destination into dummy CTA hrefs, or unwrap dummy CTAs.

    Never inserts a new button. Never uses {{campaign_url}}.
    """
    from app.campaign_destination_url import is_likely_page_url

    text = str(html or "")
    if not text.strip():
        return text
    dest = dest.strip() if is_likely_page_url(dest) else ""

    def _rewrite_open(match: re.Match[str]) -> str:
        attrs = match.group(1) or ""
        if "unsubscribe" in attrs.lower() or "unsubscribe_url" in attrs.lower():
            return match.group(0)
        href_m = _HREF_ATTR_RE.search(attrs)
        if href_m:
            val = str(href_m.group(2) or "").strip()
            dummy = _is_dummy_cta_href(val) or bool(_CAMPAIGN_URL_RE.search(val))
            if not dummy:
                return match.group(0)
            if dest:
                start, end = href_m.span(2)
                new_attrs = attrs[:start] + dest + attrs[end:]
                return f"<a{new_attrs}>"
            return match.group(0)
        if dest:
            return f'<a href="{dest}"{attrs}>'
        return match.group(0)

    out = _A_OPEN_RE.sub(_rewrite_open, text)
    if dest:
        return out

    # No destination: unwrap dummy / {{campaign_url}} marketing anchors (keep label).
    def _unwrap(match: re.Match[str]) -> str:
        tag = match.group(0)
        inner = match.group(1) or ""
        open_m = _A_OPEN_RE.search(tag)
        attrs = open_m.group(1) if open_m else ""
        if "unsubscribe" in attrs.lower() or "unsubscribe_url" in attrs.lower():
            return tag
        href_m = _HREF_ATTR_RE.search(attrs)
        val = str(href_m.group(2) or "").strip() if href_m else ""
        if _is_dummy_cta_href(val) or _CAMPAIGN_URL_RE.search(val) or not val:
            return inner
        return tag

    return _ANY_A_TAG_RE.sub(_unwrap, out)


def ensure_campaign_url_cta(html: str, dest: str = "") -> str:
    """Backward-compatible name — apply dest or strip dummy CTAs."""
    return apply_destination_cta(html, dest)


def ensure_unsubscribe(html: str) -> str:
    """One clickable Unsubscribe with href={{unsubscribe_url}}. Never append a second."""
    text = str(html or "")
    if not text.strip():
        return text
    for match in _ANY_A_TAG_RE.finditer(text):
        tag = match.group(0)
        if "unsubscribe" not in tag.lower():
            continue
        text = text[: match.start()] + _rewrite_unsub_anchor(tag) + text[match.end() :]
        break
    if not _UNSUB_ANCHOR_RE.search(text):
        if _UNSUB_TAG_RE.search(text):
            text = _UNSUB_TAG_RE.sub(_UNSUB_LINK, text, count=1)
        else:
            plain = _PLAIN_UNSUB_RE.search(text)
            if plain:
                text = text[: plain.start()] + _UNSUB_LINK + text[plain.end() :]
            else:
                lower = text.lower()
                close_body = lower.rfind("</body>")
                if close_body >= 0:
                    text = text[:close_body] + UNSUBSCRIBE_HTML + text[close_body:]
                else:
                    text = text + UNSUBSCRIBE_HTML
    return _strip_duplicate_unsub_footers(text)


def _plain_from_html_fragment(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment or "")
    return " ".join(text.split()).strip()


def _fallback_email_subject(
    html: str,
    campaign: dict[str, Any] | None = None,
) -> str:
    """Fill a missing subject so the DB quality gate can persist compiled HTML."""
    comment = _SUBJECT_COMMENT_RE.search(html)
    if comment:
        value = comment.group(1).strip()
        if value:
            return value[:180]
    title = _TITLE_RE.search(html)
    if title:
        value = _plain_from_html_fragment(title.group(1))
        if value:
            return value[:180]
    heading = _H1_RE.search(html)
    if heading:
        value = _plain_from_html_fragment(heading.group(1))
        if value:
            return value[:180]
    camp = campaign if isinstance(campaign, dict) else {}
    name = str(camp.get("name") or "").strip()
    if name:
        return name[:180]
    return "Campaign email"


def ensure_first_name_greeting(html: str) -> str:
    """Guarantee Hi {{first_name}}, like the old email director — once, after <body>."""
    text = str(html or "")
    if not text.strip():
        return text
    if re.search(r"\{\{\s*first_name\s*\}\}", text, re.I):
        return text
    greeting = "<p>Hi {{first_name}},</p>\n"
    lower = text.lower()
    body = lower.find("<body")
    if body >= 0:
        gt = text.find(">", body)
        if gt >= 0:
            return text[: gt + 1] + greeting + text[gt + 1 :]
    return greeting + text


def email_card_from_compose_result(
    out: dict[str, Any],
    *,
    plan: dict[str, Any] | None = None,
    launch_at: str = "",
    campaign: dict[str, Any] | None = None,
    dest_url: str = "",
) -> dict[str, Any]:
    payload = out if isinstance(out, dict) else {}
    raw_fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    plan_obj = (
        raw_fields.get("plan")
        if isinstance(raw_fields.get("plan"), dict)
        else payload.get("plan")
        if isinstance(payload.get("plan"), dict)
        else {}
    )
    from app.campaign_destination_url import is_likely_page_url, resolve_campaign_destination_url

    dest = str(dest_url or "").strip()
    if not is_likely_page_url(dest):
        dest = resolve_campaign_destination_url(
            campaign=campaign if isinstance(campaign, dict) else {},
            fields=raw_fields if isinstance(raw_fields, dict) else {},
        )
    html = ensure_first_name_greeting(
        apply_destination_cta(
            ensure_unsubscribe(str(raw_fields.get("compiled_html") or "").strip()),
            dest,
        )
    )
    subject = str(raw_fields.get("subject") or plan_obj.get("subject") or "").strip()
    if not subject:
        subject = _fallback_email_subject(html, campaign)
    preheader = str(
        raw_fields.get("preheader") or plan_obj.get("preheader") or ""
    ).strip()
    assets = raw_fields.get("image_assets")
    if not isinstance(assets, list):
        assets = payload.get("image_assets") if isinstance(payload.get("image_assets"), list) else []
    brand = (
        raw_fields.get("brand_guidelines")
        if isinstance(raw_fields.get("brand_guidelines"), dict)
        else {}
    )
    from app.mas.phase2_compose.html_images import (
        drop_stock_image_assets,
        hero_url_from_assets,
        sanitize_compose_images,
    )

    assets = drop_stock_image_assets(assets)
    html, assets = sanitize_compose_images(html, assets, brand=brand)
    html = ensure_first_name_greeting(apply_destination_cta(html, dest))
    mapped: dict[str, Any] = {
        "subject": subject,
        "preheader": preheader,
        "compiled_html": html,
        "pipeline": PIPELINE,
        "plan": dict(plan_obj) if isinstance(plan_obj, dict) else {},
        "image_assets": list(assets),
        "knowledge": dict(raw_fields.get("knowledge") or {})
        if isinstance(raw_fields.get("knowledge"), dict)
        else {},
        "brand_guidelines": dict(raw_fields.get("brand_guidelines") or {})
        if isinstance(raw_fields.get("brand_guidelines"), dict)
        else {},
        "warnings": list(raw_fields.get("warnings") or payload.get("warnings") or []),
    }
    if dest:
        mapped["destination_url"] = dest
        mapped["cta_url"] = dest
    hero = hero_url_from_assets(assets)
    if hero:
        mapped["header_image"] = hero
        mapped["image_url"] = hero
    launch = str(launch_at or "").strip() or (
        datetime.now(timezone.utc) + timedelta(days=1)
    ).isoformat()
    work = plan if isinstance(plan, dict) else {}
    return {
        "template_id": str(uuid.uuid4()),
        "channel": "email",
        "logo": "email",
        "launch_at": launch,
        "fields": mapped,
        "how_it_works": str(work.get("how_it_works") or ""),
        "_generation_report": {
            "layers": {"compose": "completed"},
            "mas_trace": {
                "orchestrator": "phase2_compose",
                "status": "completed",
                "trace": list(raw_fields.get("trace") or payload.get("trace") or []),
            },
            "pipeline": PIPELINE,
        },
    }


def _creative_modes(plan: dict[str, Any] | None) -> tuple[str, str]:
    work = plan if isinstance(plan, dict) else {}
    policy = (
        work.get("creative_policy")
        if isinstance(work.get("creative_policy"), dict)
        else {}
    )
    return (
        str(policy.get("content_mode") or "").strip().lower(),
        str(policy.get("image_mode") or "").strip().lower(),
    )


def _overlay_keep_fields(
    prior_template: dict[str, Any],
    *,
    ready_image: str = "",
) -> dict[str, Any]:
    from app.agents.create_campaign.template_extract import compiled_html, hero_media_url
    from app.mas.phase2_compose.html_images import map_hero_fields

    prior_fields = (
        dict(prior_template.get("fields"))
        if isinstance(prior_template.get("fields"), dict)
        else {}
    )
    html = compiled_html(prior_template)
    fields = dict(prior_fields)
    fields["compiled_html"] = html
    fields["pipeline"] = PIPELINE
    hero = str(ready_image or "").strip() or hero_media_url(prior_template)
    if hero:
        fields = map_hero_fields(fields, hero)
    return fields


async def run_phase2_email_create(
    *,
    campaign: dict[str, Any],
    plan: dict[str, Any],
    user_request: str = "",
    chat_summary: str = "",
    knowledge: str = "",
    company_pack: dict[str, Any] | None = None,
    campaign_profile: dict[str, Any] | None = None,
    launch_at: str = "",
    prior_template: dict[str, Any] | None = None,
    event_callback: Any | None = None,
    organization_id: str = "",
    generation_batch_id: str = "",
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    camp = campaign if isinstance(campaign, dict) else {}
    batch_id = str(generation_batch_id or "").strip()
    from app.campaign_destination_url import resolve_campaign_destination_url

    dest = resolve_campaign_destination_url(
        session=session if isinstance(session, dict) else None,
        campaign=camp,
        knowledge=str(knowledge or ""),
        extra_text=f"{user_request}\n{chat_summary}",
    )
    if dest:
        camp = dict(camp)
        camp["destination_url"] = dest
        camp["cta_url"] = dest
    query = _build_query(
        campaign=camp,
        user_request=user_request,
        chat_summary=chat_summary,
        knowledge=knowledge,
    )
    if not query:
        raise RuntimeError("phase2_compose_missing_query")
    prior_id = ""
    prior_extract: dict[str, Any] = {}
    prior_html = ""
    prior_hero = ""
    if isinstance(prior_template, dict):
        from app.agents.create_campaign.template_extract import (
            compact_template_extract,
            compiled_html,
            hero_media_url,
        )

        prior_id = str(prior_template.get("template_id") or "").strip()
        prior_extract = compact_template_extract(prior_template)
        prior_html = compiled_html(prior_template)
        prior_hero = hero_media_url(prior_template)
    content_mode, image_mode = _creative_modes(plan)
    _log.info(
        "email_template_path=phase2_compose start query_len=%s prior_template_id=%s "
        "content_mode=%s image_mode=%s",
        len(query),
        prior_id or None,
        content_mode or None,
        image_mode or None,
    )

    async def _progress(label: str, percent: int) -> None:
        if not event_callback:
            return
        try:
            await event_callback(
                {
                    "type": "template_progress",
                    "payload": {
                        "status": "generating",
                        "label": label,
                        "channels": ["email"],
                        "current_channel": "email",
                        "percent": max(25, min(90, int(percent))),
                        **({"generation_batch_id": batch_id} if batch_id else {}),
                    },
                }
            )
        except Exception:  # noqa: BLE001
            pass

    await _progress("Planning email…", 35)
    domain = TemplateDomain()
    token = ""
    try:
        from app.request_context import get_request_token

        token = str(get_request_token() or "").strip()
    except Exception:  # noqa: BLE001
        token = ""
    task_spec: dict[str, Any] = {
        "executor_id": "template_compose",
        "pipeline": PIPELINE,
        "query": query,
        "campaign": camp,
    }
    clipped_chat = _clip(str(chat_summary or "").strip(), _MAX_CHAT_SUMMARY_CHARS)
    if clipped_chat:
        task_spec["chat_summary"] = clipped_chat
    if dest:
        task_spec["destination_url"] = dest
    if knowledge:
        task_spec["knowledge"] = str(knowledge)
    if isinstance(company_pack, dict) and company_pack:
        task_spec["company_pack"] = company_pack
    if isinstance(campaign_profile, dict) and campaign_profile:
        task_spec["campaign_profile"] = campaign_profile
    org_id = str(organization_id or "").strip()
    if org_id:
        task_spec["organization_id"] = org_id
    if prior_extract:
        task_spec["prior_extract"] = prior_extract
    if prior_html:
        task_spec["prior_compiled_html"] = prior_html
    if content_mode:
        task_spec["content_mode"] = content_mode
    if image_mode:
        task_spec["image_mode"] = image_mode
    ready_image = str(plan.get("ready_image_url") or camp.get("ready_image_url") or "").strip()
    img_slice = plan.get("image") if isinstance(plan.get("image"), dict) else {}
    slice_mode = str(img_slice.get("mode") or "").strip().lower()
    if slice_mode == "ready" and str(img_slice.get("image_url") or "").strip():
        ready_image = str(img_slice.get("image_url") or "").strip()
    if image_mode == "keep" and prior_hero:
        ready_image = prior_hero
    if image_mode == "none":
        ready_image = ready_image if slice_mode == "ready" else ""
    wants_images = bool(ready_image) or image_mode in {"plan_new", "generate"} or slice_mode == "generate"
    if image_mode == "none" and not ready_image:
        wants_images = False
    if ready_image:
        task_spec["ready_image_url"] = ready_image
    task_spec["wants_images"] = wants_images
    invoke_ctx: dict[str, Any] = {
        "query": query,
        "task_spec": task_spec,
        "campaign": camp,
        "company_pack": company_pack if isinstance(company_pack, dict) else {},
        "campaign_profile": (
            campaign_profile if isinstance(campaign_profile, dict) else {}
        ),
        "knowledge": knowledge,
        "organization_id": org_id,
        "token": token,
        "event_callback": event_callback,
        "_phase2_progress": _progress,
    }
    if isinstance(session, dict) and session:
        invoke_ctx["session"] = session
        for key in ("organization_name", "company_name", "industry", "industry_type"):
            val = str(session.get(key) or "").strip()
            if val and key not in invoke_ctx:
                invoke_ctx[key] = val
    if ready_image:
        invoke_ctx["ready_image_url"] = ready_image
    invoke_ctx["wants_images"] = wants_images

    keep_html = (
        content_mode == "keep"
        and prior_html
        and looks_like_html(prior_html)
        and isinstance(prior_template, dict)
    )
    skip_compose = keep_html and (image_mode != "plan_new" or bool(ready_image))
    if skip_compose:
        await _progress("Keeping prior email…", 70)
        fields = _overlay_keep_fields(prior_template, ready_image=ready_image)
        out = {"ok": True, "fields": fields, "warnings": [], "trace": []}
    else:
        out = await domain.invoke(invoke_ctx)
        if (
            keep_html
            and isinstance(out, dict)
            and out.get("ok")
            and isinstance(prior_template, dict)
        ):
            keep_fields = _overlay_keep_fields(prior_template, ready_image=ready_image)
            new_fields = out.get("fields") if isinstance(out.get("fields"), dict) else {}
            from app.mas.phase2_compose.html_images import hero_url_from_assets

            hero = ready_image or hero_url_from_assets(
                new_fields.get("image_assets") if isinstance(new_fields, dict) else []
            )
            if hero:
                from app.mas.phase2_compose.html_images import map_hero_fields

                keep_fields = map_hero_fields(keep_fields, hero)
            out = {**out, "fields": keep_fields}
    if not isinstance(out, dict) or not out.get("ok"):
        err = ""
        if isinstance(out, dict):
            err = str(out.get("error") or "")
        _log.error("email_template_path=phase2_compose failed error=%s", err or "phase2_compose_failed")
        raise RuntimeError(err or "phase2_compose_failed")
    html = str((out.get("fields") or {}).get("compiled_html") or "").strip()
    if not html or not looks_like_html(html):
        _log.error("email_template_path=phase2_compose empty_html")
        raise RuntimeError("phase2_compose_empty_html")
    await _progress("Finalizing email…", 85)
    card = email_card_from_compose_result(
        out, plan=plan, launch_at=launch_at, campaign=camp, dest_url=dest
    )
    # Always mint a fresh template_id (same as director path). Reusing prior_id
    # makes the FE timeline skip the View card (newCardsOnly dedupes by id).
    if prior_id:
        card["prior_template_id"] = prior_id
    if batch_id:
        card["generation_batch_id"] = batch_id
    _log.info(
        "email_template_path=phase2_compose done html_len=%s subject=%r "
        "template_id=%s prior_template_id=%s warnings=%s",
        len(html),
        str((card.get("fields") or {}).get("subject") or "")[:80],
        card.get("template_id"),
        prior_id or None,
        list((card.get("fields") or {}).get("warnings") or []),
    )
    return card
