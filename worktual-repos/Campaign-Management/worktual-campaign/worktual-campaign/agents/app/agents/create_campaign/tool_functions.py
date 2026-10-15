"""Create-campaign tool functions — single file (jun30-style handlers)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

import httpx

from app.agents.create_campaign.meta_helpers import (
    _last_user_text,
    chat_summary_from_session,
    merge_campaign_meta_from_history,
    meta_facts_message,
    validate_campaign_details,
)

from app.agents.create_campaign.user_facing import (
    looks_like_internal_reply,
    pick_user_facing_tool_message,
    sanitize_user_facing_reply,
    tool_result_for_llm,
)
from app.agents.create_campaign.launch_guard import (
    best_template_by_channel,
    launch_readiness_message,
    template_ready_for_launch,
)
from app.agents.template_library import run_creation_agent
from app.agents.create_campaign.schedule_agent import (
    DEFAULT_TZ as SCHEDULE_DEFAULT_TZ,
    recommend_send_time,
    resolve_send_window,
)
from app.config import get_settings
from app.session_store import (
    get_or_create_session,
    load_audience_ids,
    save_audience_ids,
    save_session,
    save_temp_contacts,
)
from app.template_store import (
    create_templates_batch,
    list_session_templates,
    save_campaign_from_session,
    sync_session_templates,
)

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]

logger = logging.getLogger(__name__)

DEFAULT_LAUNCH_TZ = SCHEDULE_DEFAULT_TZ


def _change_summary_claims_send(text: str) -> bool:
    """Do not infer launch from free-text summaries — LLM must set confirmed=true."""
    _ = text
    return False

# UI / chat aliases → campaign channel keys used by backend workers.
_CHANNEL_ALIASES = {
    "email": "email",
    "mail": "email",
    "sms": "sms",
    "whatsapp": "whatsapp",
    "wa": "whatsapp",
    "meta_whatsapp": "whatsapp",
    "push": "push",
    "app": "push",
    "app_push": "push",
    "app-push": "push",
    "apppush": "push",
    "mobile_push": "push",
    "mobile-push": "push",
    "web": "web",
    "web_push": "web",
    "web-push": "web",
    "webpush": "web",
    "ppc": "ppc",
    "ads": "ppc",
}


def _sanitize_launch_note(raw: Any) -> str:
    """Short chat-safe warning. Never HTML, Prisma dumps, or file paths."""
    text = str(raw or "").strip()
    if not text:
        return ""
    compact = " ".join(text.split())
    low = compact.lower()
    if (
        compact.startswith("<")
        or "<!doctype" in low
        or "<html" in low
        or "<body" in low
    ):
        code = "error"
        # Pull a simple (NNN) status if present without regex.
        for i, ch in enumerate(compact):
            if ch == "(" and i + 4 < len(compact) and compact[i + 4] == ")":
                maybe = compact[i + 1 : i + 4]
                if maybe.isdigit():
                    code = maybe
                    break
        return f"WhatsApp Meta submit failed (service {code})"
    if (
        "Unique constraint" in compact
        or "campaignSendBatch" in compact
        or ("campaign_id" in compact and "'seq'" in compact)
    ):
        return "Push queue failed (duplicate batch). Try launch again."
    if "Invalid `prisma" in compact or ".ts:" in compact:
        return "Send queue error. Try launch again."
    if len(compact) > 180:
        return compact[:180].rstrip() + "…"
    return compact


def _normalize_agent_channel(raw: Any) -> str:
    ch = str(raw or "").strip().lower().replace(" ", "_")
    return _CHANNEL_ALIASES.get(ch, ch)


def _dedupe_channels(raw: list[Any]) -> list[str]:
    out: list[str] = []
    for item in raw:
        key = _normalize_agent_channel(item)
        if key and key not in out:
            out.append(key)
    return out


def _normalize_channels_arg(raw: Any) -> list[str]:
    """Normalize channels; recover string / char-split accidents."""
    items: list[str] = []
    if isinstance(raw, str) and raw.strip():
        items = [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]
    elif isinstance(raw, (list, tuple)):
        items = [str(c).strip() for c in raw if str(c).strip()]
    joined = "".join(items).lower().replace(" ", "_")
    if len(items) > 1 and all(len(c) == 1 for c in items) and joined in _CHANNEL_ALIASES:
        items = [joined]
    return _dedupe_channels(items)


def _normalize_tz(raw: Any) -> str:
    t = str(raw or "").strip() or DEFAULT_LAUNCH_TZ
    try:
        ZoneInfo(t)
        return t
    except Exception:  # noqa: BLE001
        return DEFAULT_LAUNCH_TZ


def _coerce_schedule_mode(
    schedule_mode: Any,
    *,
    launch_local_date: Any = None,
    launch_local_time: Any = None,
    scheduled_at: Any = None,
) -> str:
    """Force schedule_mode=at whenever any clock fields are present.

    LLMs often pass schedule_mode=now (or omit it) while still filling
    launch_local_* / scheduled_at. Discarding those fields silently caused
    'scheduled' chat copy with immediate/wrong starts_at and missed sends.
    """
    mode = str(schedule_mode or "").strip().lower()
    has_local_clock = bool(
        str(launch_local_date or "").strip() or str(launch_local_time or "").strip()
    )
    has_iso = bool(str(scheduled_at or "").strip())
    if has_local_clock:
        return "at"
    # scheduled_at alone is set after resolve_send_window(prefer_now) — keep mode now.
    if has_iso:
        return "now" if mode == "now" else "at"
    if mode in ("now", "at"):
        return mode
    return "now"


def _launch_plan_timing_from_args(
    args: dict[str, Any],
    prior: dict[str, Any] | None,
) -> tuple[str, str | None, str | None, str | None]:
    """Pick schedule_mode + clock fields for set_launch_plan.

    schedule_mode=now this turn must not inherit a prior launch clock — otherwise a
    relaunch after an earlier send (e.g. 11:56) is coerced to at and rolls to tomorrow.
    """
    prior = prior if isinstance(prior, dict) else {}
    arg_mode = str(args.get("schedule_mode") or "").strip().lower()
    arg_date = str(args.get("launch_local_date") or "").strip() or None
    arg_time = str(args.get("launch_local_time") or "").strip() or None
    arg_iso = str(args.get("scheduled_at") or "").strip() or None
    if arg_mode == "now":
        mode = _coerce_schedule_mode(
            "now",
            launch_local_date=None,
            launch_local_time=None,
            scheduled_at=None,
        )
        return mode, None, None, None
    date = arg_date or (str(prior.get("launch_local_date") or "").strip() or None)
    time = arg_time or (str(prior.get("launch_local_time") or "").strip() or None)
    iso = arg_iso or (str(prior.get("scheduled_at") or "").strip() or None)
    mode = _coerce_schedule_mode(
        args.get("schedule_mode") or prior.get("schedule_mode"),
        launch_local_date=date,
        launch_local_time=time,
        scheduled_at=iso,
    )
    return mode, date, time, iso


def _local_parts_now(tz_name: str) -> tuple[str, str]:
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)
    return now.strftime("%Y-%m-%d"), now.strftime("%H:%M")


def _utc_iso_from_local(date_s: str, time_s: str, tz_name: str) -> str | None:
    date_s = (date_s or "").strip()
    time_s = (time_s or "").strip()
    if not date_s or not time_s:
        return None
    try:
        tz = ZoneInfo(tz_name)
        # Accept HH:mm or HH:mm:ss
        if len(time_s) == 5:
            time_s = f"{time_s}:00"
        local_dt = datetime.strptime(f"{date_s} {time_s}", "%Y-%m-%d %H:%M:%S")
        local_dt = local_dt.replace(tzinfo=tz)
        return local_dt.astimezone(timezone.utc).isoformat()
    except Exception:  # noqa: BLE001
        return None


def _merge_filters(
    current: dict[str, Any],
    mode: str,
    incoming: dict[str, Any],
    remove_keys: list[str] | None,
) -> dict[str, Any]:
    incoming = {k: v for k, v in (incoming or {}).items() if v is not None and v != ""}
    if mode == "replace":
        return dict(incoming)
    if mode == "remove":
        next_filters = dict(current)
        for key in remove_keys or list(incoming.keys()):
            next_filters.pop(key, None)
        return next_filters
    next_filters = dict(current)
    next_filters.update(incoming)
    # emails lists are UNIONED on add (do not AND / overwrite blindly)
    curr_emails = _normalize_email_list(current.get("emails"))
    inc_emails = _normalize_email_list(incoming.get("emails"))
    curr_phones = _normalize_phone_list(current.get("phones"))
    inc_phones = _normalize_phone_list(incoming.get("phones"))
    if curr_emails or inc_emails:
        merged_emails: list[str] = []
        seen: set[str] = set()
        for e in curr_emails + inc_emails:
            if e not in seen:
                seen.add(e)
                merged_emails.append(e)
        next_filters["emails"] = merged_emails
        next_filters.pop("search", None)
    if curr_phones or inc_phones:
        merged_phones: list[str] = []
        seen_p: set[str] = set()
        for p in curr_phones + inc_phones:
            if p not in seen_p:
                seen_p.add(p)
                merged_phones.append(p)
        next_filters["phones"] = merged_phones
        next_filters.pop("search", None)
    # Switching identity: a new phone without emails drops stale emails (and vice versa)
    if inc_phones and not inc_emails:
        next_filters.pop("emails", None)
        next_filters.pop("has_email", None)
    if inc_emails and not inc_phones:
        next_filters.pop("phones", None)
    if inc_phones or inc_emails or _incoming_is_identity_only(incoming):
        keep_name = bool(
            str(incoming.get("search") or "").strip()
            and not inc_phones
            and not inc_emails
        )
        next_filters = _strip_non_identity(next_filters, keep_search=keep_name)
        if inc_phones and not inc_emails:
            next_filters.pop("emails", None)
    return next_filters


_NON_IDENTITY_FILTER_KEYS = (
    "product_interest",
    "search",
    "has_email",
    "has_phone",
    "city",
    "company",
    "job_title",
    "segment",
    "consent_source",
    "min_score",
    "preferred_channel",
    "account_status",
    "custom_fields",
)


def _incoming_is_identity_only(incoming: dict[str, Any]) -> bool:
    phones = _normalize_phone_list(incoming.get("phones"))
    emails = _normalize_email_list(incoming.get("emails"))
    name = str(incoming.get("search") or "").strip()
    if not phones and not emails and not name:
        return False
    for key, val in (incoming or {}).items():
        if key in ("phones", "emails"):
            continue
        if key == "search" and name and not phones and not emails:
            continue
        if val is None or val == "" or val == [] or val == {}:
            continue
        return False
    return True


def _coerce_named_identity(incoming: dict[str, Any]) -> dict[str, Any]:
    """A named phone or email is identity lookup — never AND leftover segments."""
    phones = _normalize_phone_list(incoming.get("phones"))
    emails = _normalize_email_list(incoming.get("emails"))
    if phones:
        out: dict[str, Any] = {"phones": phones}
        if emails:
            out["emails"] = emails
        return out
    if emails:
        return {"emails": emails}
    return incoming


def _strip_non_identity(
    filters: dict[str, Any], *, keep_search: bool = False
) -> dict[str, Any]:
    out = dict(filters)
    for key in _NON_IDENTITY_FILTER_KEYS:
        if key == "search" and keep_search:
            continue
        out.pop(key, None)
    return out


def _normalize_email_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        e = str(item or "").strip().lower()
        if not e or "@" not in e or e in seen:
            continue
        seen.add(e)
        out.append(e)
    return out


def _digits_only(value: str) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _normalize_phone_list(value: Any) -> list[str]:
    raw = value if isinstance(value, list) else ([value] if value else [])
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        d = _digits_only(str(item or ""))
        if len(d) < 10 or len(d) > 15 or d in seen:
            continue
        seen.add(d)
        out.append(d)
    return out


def _extract_phones_from_text(text: str) -> list[str]:
    """Format-only: pull phone-like tokens from tool search strings (not chat intent)."""
    raw = str(text or "")
    # Drop email-looking tokens so digits in domains are ignored.
    tokens: list[str] = []
    buf = ""
    for ch in raw:
        if ch.isalnum() or ch in "@._%+-() ":
            buf += ch
        else:
            if buf.strip():
                tokens.append(buf.strip())
            buf = ""
    if buf.strip():
        tokens.append(buf.strip())
    # Also split on whitespace for multi-value search strings.
    pieces: list[str] = []
    for tok in tokens:
        pieces.extend(tok.replace(",", " ").split())
    found: list[str] = []
    for piece in pieces:
        if "@" in piece:
            continue
        found.extend(_normalize_phone_list([piece]))
    return found


# Soft CPMA — map natural phrases / aliases → stored consent_source values
_CONSENT_ALIASES: dict[str, str] = {
    "website_form": "website_form",
    "website form": "website_form",
    "website": "website_form",
    "web form": "website_form",
    "web_form": "website_form",
    "form": "website_form",
    "online form": "website_form",
    "purchase": "purchase",
    "customer": "purchase",
    "customers": "purchase",
    "event_opt_in": "event_opt_in",
    "event opt-in": "event_opt_in",
    "event opt in": "event_opt_in",
    "event": "event_opt_in",
    "partner": "partner",
    "referral": "partner",
    "verbal": "verbal",
    "booth": "booth",
    "offline": "booth",
    "unknown": "unknown",
}


def _normalize_consent_source(raw: Any) -> str | None:
    text = str(raw or "").strip().lower()
    if not text:
        return None
    if text in _CONSENT_ALIASES:
        return _CONSENT_ALIASES[text]
    compact = text.replace("-", " ").replace("_", " ")
    if compact in _CONSENT_ALIASES:
        return _CONSENT_ALIASES[compact]
    for key, value in _CONSENT_ALIASES.items():
        if key in text or key in compact:
            return value
    return text.replace(" ", "_")


def _infer_consent_source_from_text(text: str) -> str | None:
    """Detect consent audience intent from free text (search / user phrasing).

    Requires clear consent/source cues — do not map bare "sales" / "customer"
    goals to purchase consent (that emptied audiences in AUTO-COMPLETE).
    """
    t = (text or "").strip().lower()
    if not t:
        return None
    if any(
        p in t
        for p in (
            "website form",
            "website_form",
            "web form",
            "website consent",
            "online form",
            "all website consent",
        )
    ):
        return "website_form"
    if "purchase consent" in t or "purchase opt" in t:
        return "purchase"
    if "event opt" in t or "event_opt" in t or "event consent" in t:
        return "event_opt_in"
    if "partner consent" in t or "referral consent" in t:
        return "partner"
    if "verbal consent" in t:
        return "verbal"
    if "booth consent" in t or "booth opt" in t:
        return "booth"
    # Generic "consent" without a source → website_form only when clearly asked
    if "consent" in t and ("website" in t or "web form" in t or "all " in t):
        return "website_form"
    return None


def _prepare_incoming_filters(incoming: dict[str, Any]) -> dict[str, Any]:
    """Normalize emails + consent_source so FILTER_CONTACTS hits the API correctly."""
    out = dict(incoming or {})
    if out.get("consent_source"):
        normalized = _normalize_consent_source(out.get("consent_source"))
        if normalized:
            out["consent_source"] = normalized
    for key in (
        "city",
        "company",
        "job_title",
        "product_interest",
        "segment",
        "account_status",
        "search",
    ):
        val = out.get(key)
        if isinstance(val, str):
            stripped = val.strip()
            if stripped:
                out[key] = stripped
            else:
                out.pop(key, None)
    if isinstance(out.get("search"), str) and out.get("search"):
        def normalize_person_search(s: str) -> str:
            return str(s or "").strip()

        out["search"] = normalize_person_search(str(out["search"]))
    if out.get("min_score") is not None:
        try:
            out["min_score"] = float(out["min_score"])
        except (TypeError, ValueError):
            out.pop("min_score", None)
    pref = str(out.get("preferred_channel") or "").strip().lower()
    if pref:
        if pref in {"email", "whatsapp", "push", "web", "sms"}:
            out["preferred_channel"] = pref
        elif pref in {"app_push", "apppush"}:
            out["preferred_channel"] = "push"
        elif pref in {"web_push", "webpush"}:
            out["preferred_channel"] = "web"
        else:
            out.pop("preferred_channel", None)
    else:
        out.pop("preferred_channel", None)
    phones = _normalize_phone_list(out.get("phones"))
    raw_emails = out.get("emails")
    if isinstance(raw_emails, list):
        keep_emails: list[str] = []
        for item in raw_emails:
            s = str(item or "").strip()
            d = _digits_only(s)
            if "@" not in s and 10 <= len(d) <= 15:
                phones = list(dict.fromkeys([*phones, d]))
            elif s:
                keep_emails.append(s)
        if keep_emails:
            out["emails"] = keep_emails
        else:
            out.pop("emails", None)
    search = out.get("search")
    if isinstance(search, str) and search.strip():
        inferred = _infer_consent_source_from_text(search)
        if inferred and not out.get("consent_source"):
            out["consent_source"] = inferred
            out.pop("search", None)
        else:
            extracted = _extract_emails_from_text(search)
            if len(extracted) >= 1 and (
                " and " in search.lower()
                or "," in search
                or len(extracted) >= 2
                or ("@" in search and " " not in search.strip())
            ):
                out["emails"] = extracted
                if (
                    len(extracted) >= 2
                    or " and " in search.lower()
                    or "," in search
                ):
                    out.pop("search", None)
            search_phones = _extract_phones_from_text(search)
            if search_phones:
                phones = list(dict.fromkeys([*phones, *search_phones]))
                if not extracted:
                    out.pop("emails", None)
                digits = _digits_only(search)
                if digits and all(ch.isdigit() or ch in "+-() " for ch in search.strip()):
                    out.pop("search", None)
    cf = out.get("custom_fields")
    if isinstance(cf, dict):
        cleaned_cf = {
            str(k).strip(): v
            for k, v in cf.items()
            if str(k).strip() and v is not None and v != ""
        }
        if cleaned_cf:
            out["custom_fields"] = cleaned_cf
        else:
            out.pop("custom_fields", None)
    elif "custom_fields" in out:
        out.pop("custom_fields", None)
    if phones:
        out["phones"] = phones
        out.pop("has_email", None)
        if not _normalize_email_list(out.get("emails")):
            out.pop("emails", None)
    elif "phones" in out:
        out.pop("phones", None)
    return out


def _clamp_ab_pct(raw: Any, fallback: int) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return fallback
    return max(0, min(100, n))


def _ab_split_from_args(args: dict[str, Any], *, enabled: bool) -> dict[str, Any]:
    if not enabled:
        return {
            "ab_enabled": False,
            "ab_pct_a": None,
            "ab_pct_b": None,
            "ab_pct_holdout": None,
            "ab_auto": True,
            "ab_decide_after_minutes": 15,
            "ab_winner": None,
            "ab_note": None,
        }
    pct_a = _clamp_ab_pct(args.get("ab_pct_a"), 20)
    pct_b = _clamp_ab_pct(args.get("ab_pct_b"), 20)
    pct_h = _clamp_ab_pct(args.get("ab_pct_holdout"), 60)
    if pct_a + pct_b + pct_h != 100:
        pct_h = max(0, 100 - pct_a - pct_b)
    try:
        decide = int(args["ab_decide_after_minutes"]) if args.get("ab_decide_after_minutes") is not None else 15
    except (TypeError, ValueError):
        decide = 15
    decide = max(0, min(24 * 60, decide))
    auto = args.get("ab_auto")
    if auto is None:
        auto = True
    return {
        "ab_enabled": True,
        "ab_pct_a": pct_a,
        "ab_pct_b": pct_b,
        "ab_pct_holdout": pct_h,
        "ab_auto": bool(auto),
        "ab_decide_after_minutes": decide,
        "ab_winner": None,
        "ab_note": (
            f"Email A/B: {pct_a}% A / {pct_b}% B test, {pct_h}% holdout. "
            f"Winner auto-picked after {decide} min from open/click; "
            "remainder sends the winner automatically."
            if auto
            else (
                f"Email A/B: {pct_a}% A / {pct_b}% B test, {pct_h}% holdout. "
                "Pick the winner manually; remainder sends the winner."
            )
        ),
    }


def _email_template_has_ab_variants(session: dict[str, Any]) -> bool:
    for t in session.get("templates") or []:
        if not isinstance(t, dict):
            continue
        if str(t.get("channel") or "").strip().lower() != "email":
            continue
        fields = t.get("fields") if isinstance(t.get("fields"), dict) else {}
        if fields.get("ab_test") is True:
            return True
        if isinstance(fields.get("variant_a"), dict) and isinstance(
            fields.get("variant_b"), dict
        ):
            return True
    return False


async def _call_filter_api(
    token: str,
    filters: dict[str, Any],
    *,
    campaign_profile: Any = None,
) -> dict[str, Any]:
    from app.industry_packs.loader import is_b2c_profile
    settings = get_settings()
    url = f"{settings.campaign_api_base.rstrip('/')}/contacts/filter"
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(url, json={"filters": filters}, headers=headers)
        res.raise_for_status()
        return res.json()


async def _call_audience_insights(
    token: str, contact_ids: list[str]
) -> dict[str, Any]:
    if not contact_ids:
        return {
            "count": 0,
            "consent": {"warnings": [], "weak_count": 0, "missing_count": 0},
            "quality": {"notes": [], "missing_email": 0, "missing_phone": 0},
            "sample": [],
        }
    settings = get_settings()
    url = f"{settings.campaign_api_base.rstrip('/')}/contacts/audience-insights"
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            url, json={"contact_ids": contact_ids[:5000]}, headers=headers
        )
        res.raise_for_status()
        return res.json()


async def _call_design_check(
    token: str,
    *,
    channels: list[str],
    contact_ids: list[str],
    template_channels: list[str],
) -> dict[str, Any]:
    settings = get_settings()
    url = f"{settings.campaign_api_base.rstrip('/')}/campaigns/design-check"
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            url,
            json={
                "channels": channels,
                "contact_ids": contact_ids[:5000],
                "template_channels": template_channels,
            },
            headers=headers,
        )
        res.raise_for_status()
        return res.json()


async def _channel_reach_for_audience(
    token: str, contact_ids: list[str]
) -> dict[str, int]:
    """Per-channel reachable counts (kept; not called on audience tools — latency)."""
    ids = [str(c).strip() for c in (contact_ids or []) if str(c).strip()]
    empty = {
        "matched": 0,
        "email": 0,
        "whatsapp_phone": 0,
        "app_push": 0,
        "web_push": 0,
    }
    if not ids:
        return empty
    try:
        body = await _call_design_check(
            token,
            channels=["email", "whatsapp", "web", "push"],
            contact_ids=ids,
            template_channels=[],
        )
        design = body.get("design") if isinstance(body, dict) else {}
        if not isinstance(design, dict):
            design = {}
        aud = design.get("audience") if isinstance(design.get("audience"), dict) else {}
        return {
            "matched": int(aud.get("count") or len(ids)),
            "email": int(aud.get("with_email") or 0),
            "whatsapp_phone": int(aud.get("with_phone") or 0),
            "app_push": int(aud.get("push_endpoints") or 0),
            "web_push": int(aud.get("web_endpoints") or 0),
        }
    except Exception:  # noqa: BLE001
        try:
            insights = await _call_audience_insights(token, ids)
            quality = (
                insights.get("quality")
                if isinstance(insights.get("quality"), dict)
                else {}
            )
            return {
                "matched": int(insights.get("count") or len(ids)),
                "email": int(quality.get("with_email") or 0),
                "whatsapp_phone": int(quality.get("with_phone") or 0),
                "app_push": 0,
                "web_push": 0,
            }
        except Exception:  # noqa: BLE001
            return {**empty, "matched": len(ids)}


def _channel_reach_fact_line(reach: dict[str, int]) -> str:
    """Compact tool-fact line — model must show these numbers, never invent."""
    return (
        "channel_reach="
        f"matched:{int(reach.get('matched') or 0)},"
        f"email:{int(reach.get('email') or 0)},"
        f"whatsapp_phone:{int(reach.get('whatsapp_phone') or 0)},"
        f"app_push:{int(reach.get('app_push') or 0)},"
        f"web_push:{int(reach.get('web_push') or 0)}"
    )


async def _persist_channel_reach(
    session_id: str, reach: dict[str, int]
) -> None:
    session = await get_or_create_session(session_id)
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    aud = dict(aud)
    aud["channel_reach"] = {
        "matched": int(reach.get("matched") or 0),
        "email": int(reach.get("email") or 0),
        "whatsapp_phone": int(reach.get("whatsapp_phone") or 0),
        "app_push": int(reach.get("app_push") or 0),
        "web_push": int(reach.get("web_push") or 0),
    }
    session["audience"] = aud
    await save_session(session)


async def _call_orchestration_check(
    token: str,
    *,
    channels: list[str],
    primary_channel: str | None = None,
    orchestration_mode: str | None = None,
    audience_count: int | None = None,
    broadcast_confirmed: bool | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    url = f"{settings.campaign_api_base.rstrip('/')}/campaigns/orchestration-check"
    headers = {"Authorization": f"Bearer {token}"}
    payload: dict[str, Any] = {"channels": channels}
    if primary_channel:
        payload["primary_channel"] = primary_channel
    if orchestration_mode:
        payload["orchestration_mode"] = orchestration_mode
    if audience_count is not None:
        payload["audience_count"] = int(audience_count)
    if broadcast_confirmed is not None:
        payload["broadcast_confirmed"] = bool(broadcast_confirmed)
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        res.raise_for_status()
        return res.json()


def _audience_matched_count(session: dict[str, Any]) -> int:
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    try:
        return int(aud.get("matched_count") or 0)
    except (TypeError, ValueError):
        return 0


def _apply_send_strategy_to_plan(
    plan: dict[str, Any],
    orch: dict[str, Any],
    *,
    broadcast_confirmed: bool = False,
) -> dict[str, Any]:
    """Default prefer_primary; narrow launch_channels to T0 set from send_strategy."""
    strategy = orch.get("send_strategy") if isinstance(orch, dict) else None
    if not isinstance(strategy, dict):
        strategy = {}
    mode = str(
        plan.get("orchestration_mode")
        or strategy.get("mode")
        or orch.get("suggested_mode")
        or "prefer_primary"
    ).strip().lower()
    if mode not in ("broadcast", "prefer_primary", "staggered"):
        mode = "prefer_primary"
    if mode == "broadcast" and not broadcast_confirmed:
        mode = "prefer_primary"
    plan["orchestration_mode"] = mode
    primary = (
        str(plan.get("primary_channel") or "").strip().lower()
        or str(strategy.get("primary_channel") or "").strip().lower()
        or str(orch.get("recommended_primary") or "").strip().lower()
        or None
    )
    if primary:
        plan["primary_channel"] = primary
    t0 = strategy.get("t0_channels")
    if isinstance(t0, list) and t0:
        plan["launch_channels"] = [
            str(c).strip().lower() for c in t0 if str(c).strip()
        ]
    elif mode in ("prefer_primary", "staggered") and primary:
        plan["launch_channels"] = [primary]
    plan["send_strategy"] = strategy
    plan["channel_sequence"] = list(
        strategy.get("channel_sequence")
        or orch.get("recommended_sequence")
        or plan.get("launch_channels")
        or []
    )
    return plan


_MESSAGING_CHANNELS = frozenset({"email", "whatsapp", "push", "web", "sms"})

_CHANNEL_USER_LABELS: dict[str, str] = {
    "email": "Email",
    "whatsapp": "WhatsApp",
    "push": "App push (mobile)",
    "web": "Web push (browser)",
    "sms": "SMS",
}


def _channel_user_label(channel: str) -> str:
    key = str(channel or "").strip().lower()
    return _CHANNEL_USER_LABELS.get(key, key or "channel")


def _messaging_channels(channels: list[str] | None) -> list[str]:
    out: list[str] = []
    for raw in channels or []:
        c = str(raw or "").strip().lower()
        if c in _MESSAGING_CHANNELS and c not in out:
            out.append(c)
    return out


def _messaging_from_strategy(strategy: dict[str, Any]) -> list[str]:
    seq = [
        str(c).strip().lower()
        for c in (strategy.get("channel_sequence") or [])
        if str(c).strip()
    ]
    t0 = [
        str(c).strip().lower()
        for c in (strategy.get("t0_channels") or [])
        if str(c).strip()
    ]
    combined: list[str] = []
    for c in [*seq, *t0]:
        if c in _MESSAGING_CHANNELS and c not in combined:
            combined.append(c)
    return combined


def _pick_primary_channel(messaging: list[str]) -> str:
    priority = ["email", "whatsapp", "sms", "push", "web"]
    for p in priority:
        if p in messaging:
            return p
    return messaging[0] if messaging else "email"


def send_strategy_facts_for_llm(strategy: dict[str, Any] | None) -> dict[str, Any]:
    """Structured send-plan facts for the LLM — never user-facing copy."""
    if not isinstance(strategy, dict):
        return {}
    messaging = _messaging_from_strategy(strategy)
    primary = str(strategy.get("primary_channel") or _pick_primary_channel(messaging)).strip().lower()
    mode = str(strategy.get("mode") or "prefer_primary").strip().lower()
    count = len(messaging)
    facts: dict[str, Any] = {
        "mode": mode,
        "primary_channel": primary,
        "launch_channels": list(strategy.get("t0_channels") or ([primary] if primary else [])),
        "channel_sequence": list(strategy.get("channel_sequence") or messaging),
        "messaging_count": count,
        "multi_channel": count > 1,
    }
    if count > 1:
        facts["audience_care_hint"] = (
            "Prefer starting on one channel at launch so people are not hit on "
            "email, push, and web at the same moment — frame this positively for "
            "the audience experience (not as a restriction)."
        )
        facts["user_can_override"] = (
            "They may choose every channel together at launch, or staggered follow-ups."
        )
    return facts


async def _call_personalization_preview(
    token: str,
    *,
    contact_ids: list[str] | None = None,
    sample_size: int = 5,
    dynamic_offer: bool = True,
    subject: str | None = None,
    html: str | None = None,
    body: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    url = (
        f"{settings.campaign_api_base.rstrip('/')}/contacts/personalization-preview"
    )
    headers = {"Authorization": f"Bearer {token}"}
    payload: dict[str, Any] = {
        "sample_size": max(1, min(int(sample_size or 5), 20)),
        "dynamic_offer": dynamic_offer,
    }
    if contact_ids:
        payload["contact_ids"] = contact_ids[:50]
    template: dict[str, str] = {}
    if subject:
        template["subject"] = subject
    if html:
        template["html"] = html
    if body:
        template["body"] = body
    if template:
        payload["template"] = template
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        res.raise_for_status()
        return res.json()


AVAILABLE_DYNAMIC_TAGS = [
    "first_name",
    "company",
    "city",
    "job_title",
    "campaign_url",
    "product_name",
    "product_url",
    "product_image",
    "product_price",
    "product_id",
]


def _soft_audience_warnings(insights: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    consent = insights.get("consent") or {}
    quality = insights.get("quality") or {}
    for w in consent.get("warnings") or []:
        if isinstance(w, str) and w.strip():
            warnings.append(w.strip())
    for n in quality.get("notes") or []:
        if isinstance(n, str) and n.strip():
            warnings.append(n.strip())
    return warnings


def _is_consent_soft_warning(text: str) -> bool:
    t = (text or "").strip().lower()
    return (
        "no recorded consent source" in t
        or "weak consent provenance" in t
    )


def _merge_soft_warnings(
    *,
    fresh: list[str],
    cached: list[str],
    insights_ok: bool,
) -> list[str]:
    """Prefer fresh audience insights; never keep stale consent notes after a refresh."""
    if not insights_ok:
        return list(cached)
    out: list[str] = []
    for w in fresh:
        if w and w not in out:
            out.append(w)
    for w in cached:
        if not w or w in out or _is_consent_soft_warning(w):
            continue
        out.append(w)
    return out


async def handle_recommend_audience(
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback: Any = None,
) -> dict[str, Any]:
    """Filtering specialist entry — infer filters then FILTER_CONTACTS."""
    # Lazy import avoids circular import with filtering_agent → handlers.
    from app.agents.create_campaign.filtering import recommend_and_filter
    from app.industry_packs.loader import is_b2c_profile
    from app.progress_status import emit_process_progress

    await emit_process_progress(event_callback, "filtering")

    session = await get_or_create_session(session_id)
    campaign = session.get("campaign") or {}
    audience = session.get("audience") or {}
    channels = args.get("channels")
    if not channels:
        channels = list(session.get("channels") or [])
    user_text = str(args.get("user_text") or "").strip() or None
    if not user_text:
        for msg in reversed(session.get("messages") or []):
            if not isinstance(msg, dict):
                continue
            if str(msg.get("role") or "") != "user":
                continue
            text = str(msg.get("text") or "").strip()
            if text:
                user_text = text
                break
    rec_id = str(args.get("recommendation_id") or "").strip()
    preferred = args.get("preferred_filters")
    if not isinstance(preferred, dict):
        preferred = None
    if preferred is None and rec_id:
        snap = session.get("recommendations_snapshot") or []
        if isinstance(snap, list):
            for card in snap:
                if not isinstance(card, dict):
                    continue
                if str(card.get("id") or "") == rec_id:
                    preferred = (
                        card.get("audience_filters")
                        or card.get("audienceFilters")
                        or None
                    )
                    break
    # Drop invented consent_source unless user asked or a rec card was applied.
    if isinstance(preferred, dict) and preferred.get("consent_source") and not rec_id:
        ut = (user_text or "").lower()
        consent_asked = any(
            p in ut
            for p in (
                "consent",
                "website form",
                "web form",
                "opt-in",
                "opt in",
                "purchase consent",
            )
        )
        if not consent_asked:
            preferred = {
                k: v for k, v in preferred.items() if k != "consent_source"
            }
            if not preferred:
                preferred = None

    return await recommend_and_filter(
        session_id,
        token,
        campaign=campaign,
        user_text=user_text,
        prior_filters=dict(audience.get("filters") or {}),
        preferred_filters=preferred if isinstance(preferred, dict) else None,
        channels=list(channels) if channels else None,
        mode=str(args.get("mode") or "replace"),
        change_summary=str(args.get("change_summary") or "").strip() or None,
        b2c=is_b2c_profile(session.get("campaign_profile")),
        matched_count=int(audience.get("matched_count") or 0),
        event_callback=event_callback,
    )


async def handle_filter_contacts(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    audience = session.setdefault("audience", {})
    current = dict(audience.get("filters") or {})
    mode = args.get("mode") or "replace"
    incoming = _prepare_incoming_filters(dict(args.get("filters") or {}))
    summary_text = str(args.get("change_summary") or "")
    summary_phones = _extract_phones_from_text(summary_text)
    summary_emails = _extract_emails_from_text(summary_text)
    if summary_phones:
        incoming["phones"] = _normalize_phone_list(
            list(incoming.get("phones") or []) + summary_phones
        )
        incoming.pop("has_email", None)
        incoming.pop("search", None)
        if not summary_emails:
            incoming.pop("emails", None)
    incoming = _coerce_named_identity(incoming)
    # Also infer from change_summary when filters are empty / incomplete
    if not incoming.get("consent_source") and not (
        _normalize_phone_list(incoming.get("phones"))
        or _normalize_email_list(incoming.get("emails"))
    ):
        inferred = _infer_consent_source_from_text(summary_text)
        if inferred:
            incoming["consent_source"] = inferred
            incoming.pop("search", None)
    remove_keys = args.get("remove_keys") or []
    merged = _merge_filters(current, mode, incoming, remove_keys)
    if _incoming_is_identity_only(incoming):
        keep_name = bool(
            str(incoming.get("search") or "").strip()
            and not _normalize_phone_list(incoming.get("phones"))
            and not _normalize_email_list(incoming.get("emails"))
        )
        merged = _strip_non_identity(merged, keep_search=keep_name)
        if _normalize_phone_list(incoming.get("phones")) and not _normalize_email_list(
            incoming.get("emails")
        ):
            merged.pop("emails", None)
    if _normalize_phone_list(incoming.get("phones") or merged.get("phones")):
        merged.pop("has_email", None)

    try:
        body = await _call_filter_api(
            token,
            merged,
            campaign_profile=session.get("campaign_profile"),
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"Filter API failed: {exc}",
            "matched_count": 0,
            "active_filters": merged,
            "sample_names": [],
        }

    contact_ids = list(body.get("contact_ids") or [])
    # mode=add with emails/phones: UNION prior audience so a second identity does not wipe the first
    if mode == "add" and (
        _normalize_email_list(merged.get("emails"))
        or _normalize_phone_list(merged.get("phones"))
    ):
        prior = await load_audience_ids(session_id)
        contact_ids = list(dict.fromkeys([*prior, *contact_ids]))

    sample = list(body.get("sample") or [])
    sample_names = []
    for row in sample[:10]:
        name = " ".join(
            p
            for p in [row.get("first_name") or "", row.get("last_name") or ""]
            if p
        ).strip()
        sample_names.append(
            name or (row.get("email") or row.get("phone") or "contact")
        )

    consent = body.get("consent") or {}
    quality = body.get("quality") or {}
    scores = body.get("scores") if isinstance(body.get("scores"), dict) else None
    soft_warnings = _soft_audience_warnings(
        {"consent": consent, "quality": quality}
    )

    from app.industry_packs.loader import is_b2c_profile as _is_fin

    b2c = _is_fin(session.get("campaign_profile"))
    try:
        await save_audience_ids(session_id, contact_ids, token=token)
    except Exception as exc:  # noqa: BLE001
        # Continue chat with filter counts; launch reloads contacts from filters.
        logger.warning("save_audience_ids failed: %s", exc)
        soft_warnings = list(soft_warnings) + [
            "Could not freeze the contact list yet. Launch will reload contacts from your filters."
        ]
    audience["filters"] = merged
    audience["matched_count"] = len(contact_ids)
    audience["sample_names"] = sample_names
    audience["description"] = args.get("change_summary") or ""
    audience["emails_matched"] = list(body.get("emails_matched") or [])
    audience["emails_missing"] = list(body.get("emails_missing") or [])
    audience["phones_matched"] = list(body.get("phones_matched") or [])
    audience["phones_missing"] = list(body.get("phones_missing") or [])
    audience["consent"] = consent
    audience["quality"] = quality
    audience["soft_warnings"] = soft_warnings
    # Campaign-scoped scores only (never written to main contact DB).
    if b2c and scores:
        audience["scores"] = scores
    elif not b2c:
        audience.pop("scores", None)
    campaign = session.get("campaign") or {}
    if (
        campaign.get("name")
        and campaign.get("goal")
        and campaign.get("objective")
        and session.get("channels")
        and len(contact_ids) > 0
    ):
        # Past audience step — ready for plan / template confirm
        session["stage"] = "refine"
    else:
        session["stage"] = "audience"
    await save_session(session)

    missing = audience["emails_missing"]
    matched = audience["emails_matched"]
    phones_missing = audience["phones_missing"]
    phones_matched = audience["phones_matched"]
    label = "customers" if b2c else "contacts"
    msg = f"{audience['matched_count']} {label} match filters={merged}."
    if matched or missing:
        msg += f" emails_matched={matched}; emails_missing={missing}."
    if phones_matched or phones_missing:
        msg += f" phones_matched={phones_matched}; phones_missing={phones_missing}."
    miss_email = int((quality.get("missing_email") or 0) or 0)
    if audience["matched_count"] > 0 and miss_email:
        msg += (
            f" {miss_email} matched {label} have no email — email channel cannot send "
            f"to them until an email is on the contact. Do not report 0 matches."
        )
    if b2c and scores and isinstance(scores.get("ranked"), list):
        top = scores["ranked"][:3]
        if top:
            tip = ", ".join(
                f"{r.get('contact_id')}={r.get('score')}" for r in top if isinstance(r, dict)
            )
            msg += f" Campaign scores (top): {tip}."
    if soft_warnings:
        msg += " Soft notes (do not block): " + " ".join(soft_warnings)
    msg += (
        f" Tell the user the count, sample names, and any soft consent/quality "
        f"notes. Never say {label} were blocked."
    )

    session = await get_or_create_session(session_id)
    if session.get("whatsapp_approved_run") and audience["matched_count"] > 0:
        from app.agents.whatsapp_approved.launch_helpers import (
            finalize_whatsapp_approved_audience,
            wa_audience_tool_suffix,
        )

        fin = await finalize_whatsapp_approved_audience(session_id, token)
        session = await get_or_create_session(session_id)
        msg += wa_audience_tool_suffix(session)
        if not fin.get("ok") and fin.get("error"):
            msg += f" AUDIENCE_FREEZE_WARN: {fin.get('error')}"

    ui_payload: dict[str, Any] = {
        "matched_count": audience["matched_count"],
        "sample_names": sample_names,
        "filters": merged,
        "soft_warnings": soft_warnings,
        "consent": {
            "weak_count": consent.get("weak_count") or 0,
            "missing_count": consent.get("missing_count") or 0,
            "by_source": consent.get("by_source") or {},
        },
        "quality": {
            "with_email": quality.get("with_email") or 0,
            "with_phone": quality.get("with_phone") or 0,
            "missing_email": quality.get("missing_email") or 0,
            "missing_phone": quality.get("missing_phone") or 0,
        },
    }
    if b2c and scores:
        ui_payload["scores"] = scores

    return {
        "ok": True,
        "matched_count": audience["matched_count"],
        "active_filters": merged,
        "sample_names": sample_names,
        "emails_matched": matched,
        "emails_missing": missing,
        "phones_matched": phones_matched,
        "phones_missing": phones_missing,
        "consent": consent,
        "quality": quality,
        "soft_warnings": soft_warnings,
        "scores": scores if b2c else None,
        "message": msg,
        "ui_event": {
            "type": "audience_preview",
            "payload": ui_payload,
        },
    }


def _extract_emails_from_text(text: str) -> list[str]:
    """Format-only: pull email-like tokens from tool search strings (not chat intent)."""
    pieces = (
        str(text or "")
        .replace(",", " ")
        .replace(";", " ")
        .replace("<", " ")
        .replace(">", " ")
        .split()
    )
    found = [p.strip(".,;:()") for p in pieces if "@" in p and "." in p.split("@")[-1]]
    return _normalize_email_list(found)


async def handle_set_campaign_details(
    session_id: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    # When the LLM saves a name pick without goal/objective, merge from chat history.
    payload = merge_campaign_meta_from_history(
        dict(args) if isinstance(args, dict) else {},
        session,
    )
    guard_err = validate_campaign_details(
        payload, _last_user_text(session), session=session
    )
    if guard_err:
        return {
            "ok": False,
            "error": guard_err,
            "message": guard_err,
        }
    campaign = session.setdefault("campaign", {})
    prev_goal = str(campaign.get("goal") or "").strip()
    prev_objective = str(campaign.get("objective") or "").strip()
    goal_changed = False
    objective_changed = False
    for key in ("name", "goal", "objective"):
        if payload.get(key):
            new_val = str(payload[key]).strip()
            if key == "goal":
                goal_changed = bool(prev_goal) and new_val != prev_goal
            elif key == "objective":
                objective_changed = (
                    bool(prev_objective) and new_val != prev_objective
                )
            campaign[key] = new_val
    if campaign.get("name") and campaign.get("goal") and campaign.get("objective"):
        if list(session.get("channels") or []):
            session["stage"] = "templates" if session.get("templates") else "refine"
        else:
            session["stage"] = "intake"
    else:
        session["stage"] = "intake"
    await save_session(session)
    camp_out = {
        "name": campaign.get("name") or "",
        "goal": campaign.get("goal") or "",
        "objective": campaign.get("objective") or "",
    }
    from app.agents.create_campaign.memory_note import (
        append_memory_note,
        note_from_campaign_meta,
    )

    note_line = note_from_campaign_meta(camp_out)
    if note_line:
        append_memory_note(session, note_line)
        await save_session(session)
    return {
        "ok": True,
        "campaign": camp_out,
        "goal_changed": goal_changed,
        "objective_changed": objective_changed,
        "message": meta_facts_message(camp_out, session),
        "next_step": (
            "Ask which channels (email, whatsapp, web push, app push) — "
            "do not save channels until the user confirms."
            if not list(session.get("channels") or [])
            else None
        ),
    }


async def handle_set_channels(
    session_id: str, args: dict[str, Any]
) -> dict[str, Any]:
    from app.industry_packs.loader import is_b2c_profile

    session = await get_or_create_session(session_id)
    b2c = is_b2c_profile(session.get("campaign_profile"))
    channels = _normalize_channels_arg(args.get("channels"))
    skipped: list[str] = []
    plans = list(args.get("channel_plans") or [])
    schedule_notes: list[str] = []
    normalized_plans: list[dict[str, Any]] = []
    for plan in plans:
        if not isinstance(plan, dict):
            continue
        row = dict(plan)
        ch = _normalize_channels_arg([row.get("channel")])
        if ch:
            row["channel"] = ch[0]
        raw_launch = row.get("suggested_launch_at")
        if raw_launch:
            window = resolve_send_window(
                timezone_name=DEFAULT_LAUNCH_TZ,
                scheduled_at=str(raw_launch),
                honor_explicit=True,
                consumer_hours=b2c,
            )
            row["suggested_launch_at"] = window.scheduled_at_utc
            row["suggested_launch_local_date"] = window.local_date
            row["suggested_launch_local_time"] = window.local_time
            row["suggested_launch_timezone"] = window.timezone
            if window.adjusted:
                note = (
                    f"{row.get('channel') or 'channel'}: {window.reason}"
                )
                schedule_notes.append(note)
                row["schedule_adjusted"] = True
                row["schedule_reason"] = window.reason
            elif not window.within_business_hours:
                row["schedule_reason"] = window.reason
        normalized_plans.append(row)
    # Keep plans aligned to selected channels when possible
    if channels and normalized_plans:
        allowed = set(channels)
        filtered = [
            p
            for p in normalized_plans
            if str(p.get("channel") or "").lower() in allowed
        ]
        if filtered:
            normalized_plans = filtered
    session["channels"] = channels
    session["channel_plans"] = normalized_plans or plans
    session["stage"] = "refine"
    from app.agents.create_campaign.memory_note import (
        append_memory_note,
        note_from_channels,
    )

    note_line = note_from_channels(channels)
    if note_line:
        append_memory_note(session, note_line)

    # Default send strategy: prefer_primary unless LLM passed orchestration_mode.
    send_strategy: dict[str, Any] | None = None
    show_send_strategy = False
    messaging = _messaging_channels(channels)
    if len(messaging) >= 1:
        primary = _pick_primary_channel(messaging)
        channel_sequence = sorted(
            messaging,
            key=lambda c: (
                {"email": 0, "whatsapp": 1, "sms": 2, "push": 3, "web": 4}.get(c, 9),
                c,
            ),
        )
        show_send_strategy = len(messaging) > 1
        orch_mode = str(args.get("orchestration_mode") or "").strip().lower()
        if orch_mode not in ("prefer_primary", "staggered", "broadcast"):
            orch_mode = "prefer_primary"
        if not show_send_strategy:
            orch_mode = "prefer_primary"
        launch_at_send = [primary]
        if orch_mode == "broadcast" and show_send_strategy:
            launch_at_send = list(messaging)
        send_strategy = {
            "mode": orch_mode,
            "t0_channel_cap": 1,
            "t0_channels": launch_at_send,
            "primary_channel": primary,
            "channel_sequence": channel_sequence,
            "messaging_count": len(messaging),
            "multi_channel": show_send_strategy,
            "user_send_plan_hint": None,
            "estimated_simultaneous_sends": None,
            "requires_broadcast_confirm": orch_mode == "broadcast" and show_send_strategy,
        }
        session["send_strategy"] = send_strategy
        session["launch_plan"] = {
            **(session.get("launch_plan") if isinstance(session.get("launch_plan"), dict) else {}),
            "orchestration_mode": orch_mode,
            "primary_channel": primary,
            "launch_channels": launch_at_send,
            "channel_sequence": channel_sequence,
            "send_strategy": send_strategy,
        }
        if orch_mode == "broadcast" and show_send_strategy:
            session["launch_plan"]["broadcast_confirmed"] = True

    await save_session(session)
    msg = args.get("change_summary") or "Channels updated"
    if schedule_notes:
        msg += " Send-time notes: " + "; ".join(schedule_notes[:4])
    msg += (
        f" Session channels={channels}. "
        "Write YOUR OWN reply to the user in short HTML — never paste fixed template blocks."
    )
    if show_send_strategy:
        msg += (
            " MULTI-CHANNEL: acknowledge channels from facts. Using send_strategy_facts, "
            "write ONE short positive line in your own words (e.g. starting on one channel "
            "keeps the experience calm for the audience). Never paste fixed template text. "
            "If mode is broadcast, say every selected channel goes together. "
            "Then ask ONCE to create templates."
        )
    else:
        msg += (
            " SINGLE CHANNEL: progress snapshot (name, goal, audience, channel) + ask once to "
            "build templates. No send-strategy lecture."
        )
    strategy_facts = send_strategy_facts_for_llm(send_strategy)
    return {
        "ok": True,
        "channels": channels,
        "channel_labels": {c: _channel_user_label(c) for c in channels},
        "agent_instruction": (
            "Saved canonical ids: web=web push (browser); push=app push (mobile). "
            "Do not tell the user this is app push unless push is in channels."
        ),
        "channel_plans": session["channel_plans"],
        "schedule_notes": schedule_notes,
        "skipped_unavailable": skipped,
        "send_strategy_facts": strategy_facts,
        "show_send_strategy": show_send_strategy,
        "message": msg,
    }


async def _fetch_send_time_insight(
    token: str | None,
    *,
    timezone_name: str | None = None,
) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        settings = get_settings()
        url = f"{settings.campaign_api_base.rstrip('/')}/campaigns/send-time-insight"
        params: dict[str, str] = {}
        if timezone_name:
            params["timezone"] = timezone_name
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params=params or None,
            )
            res.raise_for_status()
            body = res.json()
        insight = body.get("insight") if isinstance(body, dict) else None
        return insight if isinstance(insight, dict) else None
    except Exception:  # noqa: BLE001
        return None


def _peak_kwargs_from_insight(insight: dict[str, Any] | None) -> dict[str, Any]:
    if not insight or not insight.get("has_peak"):
        return {}
    try:
        wd = int(insight.get("peak_weekday"))
        hr = int(insight.get("peak_hour"))
    except (TypeError, ValueError):
        return {}
    return {
        "peak_weekday": wd,
        "peak_hour": hr,
        "peak_weekday_name": str(insight.get("peak_weekday_name") or ""),
        "peak_reason": str(insight.get("reason") or ""),
    }


async def handle_recommend_send_time(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    from app.industry_packs.loader import is_b2c_profile

    session = await get_or_create_session(session_id)
    tz_name = args.get("timezone") or DEFAULT_LAUNCH_TZ
    b2c = is_b2c_profile(session.get("campaign_profile"))
    insight = None if b2c else await _fetch_send_time_insight(
        token, timezone_name=str(tz_name)
    )
    result = recommend_send_time(
        timezone_name=tz_name,
        local_date=args.get("proposed_local_date"),
        local_time=args.get("proposed_local_time"),
        scheduled_at=args.get("proposed_at"),
        user_text=args.get("user_text") or args.get("change_summary"),
        prefer_now=bool(args.get("prefer_now")),
        consumer_hours=b2c,
        **(_peak_kwargs_from_insight(insight) if insight else {}),
    )
    session["suggested_send_window"] = {
        "timezone": result.get("timezone"),
        "launch_local_date": result.get("launch_local_date"),
        "launch_local_time": result.get("launch_local_time"),
        "scheduled_at": result.get("scheduled_at"),
        "adjusted": result.get("adjusted"),
        "reason": result.get("reason"),
        "timing_label": result.get("timing_label"),
        "optimizer": result.get("optimizer"),
    }
    await save_session(session)
    if args.get("change_summary"):
        result = {
            **result,
            "message": (
                f"{args.get('change_summary')}. {result.get('message')}"
            ),
        }
    return result


async def handle_confirm_templates(
    session_id: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    confirmed = bool(args.get("confirmed"))
    existing_templates = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    if confirmed and existing_templates:
        return {
            "ok": False,
            "confirmed": False,
            "error": (
                "Templates already exist. This is a launch confirmation, not template "
                "create. Recap the campaign, then after they confirm launch now or "
                "schedule, call SET_LAUNCH_PLAN then CONFIRM_LAUNCH. Do not recreate templates."
            ),
        }
    channels = list(session.get("channels") or [])
    audience = session.get("audience") or {}
    matched = int(audience.get("matched_count") or 0)
    contact_ids = await load_audience_ids(session_id)
    if confirmed and matched <= 0 and not contact_ids:
        session["confirmed_create_templates"] = False
        session["stage"] = "audience"
        await save_session(session)
        return {
            "ok": False,
            "confirmed": False,
            "channels": channels,
            "matched_count": 0,
            "error": "Audience is empty (0 contacts). Widen filters before templates.",
            "message": (
                "Cannot confirm templates with 0 contacts. "
                "Call RECOMMEND_AUDIENCE / FILTER_CONTACTS with looser filters "
                "(e.g. has_email only), then ask the user to confirm again. "
                "Do NOT offer to create templates yet."
            ),
        }
    session["confirmed_create_templates"] = confirmed
    session["stage"] = "confirm" if confirmed else "refine"
    await save_session(session)
    base = args.get("change_summary") or (
        "Confirmed" if confirmed else "Not confirmed"
    )
    if confirmed:
        base += (
            f" Create templates for session channels only: {channels or ['(none)']} "
            f"(audience={matched})."
        )
    return {
        "ok": True,
        "confirmed": confirmed,
        "channels": channels,
        "matched_count": matched,
        "message": base,
    }


def _form_url_from_session(session: dict[str, Any]) -> str:
    """Live form launch URL when present."""
    from app.campaign_destination_url import form_url_from_session

    return form_url_from_session(session)


def _default_landing_url() -> str:
    """Deprecated: no static tracking landing. Destinations come from KB/user/form."""
    return ""


def _campaign_click_url_from_session(session: dict[str, Any]) -> str:
    """Real form URL only. Bare landing must not replace {{campaign_url}} in templates."""
    return _form_url_from_session(session)


def _inject_form_url_into_fields(fields: dict[str, Any], form_url: str) -> dict[str, Any]:
    """Bake a real form https URL into CTA fields. Never use bare tracking landing here."""
    out = dict(fields)
    has_email_shape = (
        "cta_url" in out
        or "paragraphs" in out
        or "subject" in out
        or "blocks" in out
        or "sections" in out
    )
    if has_email_shape:
        # Keep merge tag so launch/schedule send can attach per-contact wt=.
        # Only overwrite when a real form URL was provided (caller guarantees that).
        sections = out.get("sections")
        has_cta_section = False
        if isinstance(sections, list):
            has_cta_section = any(
                isinstance(item, dict)
                and str(item.get("type") or "").strip().lower() in {"cta", "secondary_link"}
                for item in sections
            )
        has_cta_label = bool(str(out.get("cta_label") or "").strip())
        if has_cta_section or has_cta_label:
            out["cta_url"] = form_url
        if isinstance(sections, list):
            new_sections: list[Any] = []
            for item in sections:
                if not isinstance(item, dict):
                    new_sections.append(item)
                    continue
                sec = dict(item)
                kind = str(sec.get("type") or "").strip().lower()
                if kind in {"cta", "secondary_link"}:
                    href = str(sec.get("url") or sec.get("href") or "").strip()
                    if (
                        not href
                        or "{{" in href
                        or "campaign_url" in href.lower()
                    ):
                        sec["url"] = form_url
                new_sections.append(sec)
            out["sections"] = new_sections
    for key in ("variant_a", "variant_b"):
        variant = out.get(key)
        if isinstance(variant, dict):
            out[key] = _inject_form_url_into_fields(variant, form_url)

    blocks = out.get("blocks")
    if isinstance(blocks, list):
        new_blocks: list[Any] = []
        for item in blocks:
            if not isinstance(item, dict):
                new_blocks.append(item)
                continue
            block = dict(item)
            if str(block.get("type") or "").strip().lower() == "button":
                href = str(block.get("href") or block.get("url") or "").strip()
                if not href or "{{" in href or "campaign_url" in href.lower():
                    block["href"] = form_url
            new_blocks.append(block)
        out["blocks"] = new_blocks

    buttons = out.get("buttons")
    if isinstance(buttons, list):
        new_btns: list[Any] = []
        replaced = False
        for item in buttons:
            if not isinstance(item, dict):
                new_btns.append(item)
                continue
            btn = dict(item)
            url = str(btn.get("url") or btn.get("href") or "").strip()
            if not url or "{{" in url or "campaign_url" in url.lower():
                btn["url"] = form_url
                replaced = True
            new_btns.append(btn)
        if not replaced and new_btns:
            # Keep existing buttons that already had https URLs.
            pass
        out["buttons"] = new_btns

    body = out.get("body")
    buttons_now = out.get("buttons")
    if (
        isinstance(body, str)
        and body
        and not has_email_shape
        and not (isinstance(buttons_now, list) and buttons_now)
    ):
        updated = (
            body.replace("{{ campaign_url }}", form_url)
            .replace("{{campaign_url}}", form_url)
        )
        if form_url not in updated and "http" not in updated.lower():
            updated = f"{updated.rstrip()} {form_url}"
        out["body"] = updated

    if "landing_url" in out:
        out["landing_url"] = form_url
    return out


def _inject_form_url_into_templates(
    templates: list[dict[str, Any]], form_url: str
) -> list[dict[str, Any]]:
    if not form_url:
        return templates
    out: list[dict[str, Any]] = []
    for row in templates:
        if not isinstance(row, dict):
            out.append(row)
            continue
        card = dict(row)
        fields = card.get("fields")
        if isinstance(fields, dict):
            card["fields"] = _inject_form_url_into_fields(fields, form_url)
        out.append(card)
    return out


def _is_placeholder_cta_url(url: str) -> bool:
    raw = str(url or "").strip()
    if not raw or "{{" in raw or "campaign_url" in raw.lower():
        return True
    lower = raw.lower()
    if lower in {"#", "/", "about:blank"} or lower.startswith("javascript:"):
        return True
    return False


def _rewrite_fields_campaign_url_tokens(
    fields: dict[str, Any], dest: str = ""
) -> dict[str, Any]:
    """Bake a real destination into CTAs, or drop placeholder merge tags."""
    from app.campaign_destination_url import is_likely_page_url

    dest = dest.strip() if is_likely_page_url(dest) else ""
    out = dict(fields)
    cta = str(out.get("cta_url") or "").strip()
    landing = str(out.get("landing_url") or "").strip()
    if dest:
        if _is_placeholder_cta_url(cta):
            out["cta_url"] = dest
        if _is_placeholder_cta_url(landing):
            out["landing_url"] = dest
        out["destination_url"] = dest
    else:
        if _is_placeholder_cta_url(cta):
            out.pop("cta_url", None)
        if _is_placeholder_cta_url(landing):
            out.pop("landing_url", None)

    sections = out.get("sections")
    if isinstance(sections, list):
        new_sections: list[Any] = []
        for item in sections:
            if not isinstance(item, dict):
                new_sections.append(item)
                continue
            sec = dict(item)
            kind = str(sec.get("type") or "").strip().lower()
            if kind in {"cta", "secondary_link"}:
                href = str(sec.get("url") or sec.get("href") or "").strip()
                if dest:
                    if _is_placeholder_cta_url(href):
                        sec["url"] = dest
                elif _is_placeholder_cta_url(href):
                    continue
            new_sections.append(sec)
        out["sections"] = new_sections

    blocks = out.get("blocks")
    if isinstance(blocks, list):
        new_blocks: list[Any] = []
        for item in blocks:
            if not isinstance(item, dict):
                new_blocks.append(item)
                continue
            block = dict(item)
            if str(block.get("type") or "").strip().lower() == "button":
                href = str(block.get("href") or block.get("url") or "").strip()
                if dest:
                    if _is_placeholder_cta_url(href):
                        block["href"] = dest
                elif _is_placeholder_cta_url(href):
                    continue
            new_blocks.append(block)
        out["blocks"] = new_blocks

    html_key = "compiled_html" if str(out.get("compiled_html") or "").strip() else (
        "html" if str(out.get("html") or "").strip() else ""
    )
    if html_key:
        from app.mas.phase2_compose.plugin import apply_destination_cta

        out[html_key] = apply_destination_cta(str(out.get(html_key) or ""), dest)

    for key in ("variant_a", "variant_b"):
        variant = out.get(key)
        if isinstance(variant, dict):
            out[key] = _rewrite_fields_campaign_url_tokens(variant, dest)
    return out


def _ensure_campaign_url_merge_tags(
    templates: list[dict[str, Any]],
    dest: str = "",
) -> list[dict[str, Any]]:
    """Bake real destination URLs (or strip placeholders) — tracking is send-time."""
    out: list[dict[str, Any]] = []
    for row in templates:
        if not isinstance(row, dict):
            out.append(row)
            continue
        card = dict(row)
        fields = card.get("fields")
        if isinstance(fields, dict):
            card["fields"] = _rewrite_fields_campaign_url_tokens(fields, dest)
        out.append(card)
    return out


def _email_ready_to_persist(template: dict[str, Any]) -> bool:
    """Email must have compiled HTML or director sections — never a subject-only stub."""
    fields = (
        template.get("fields") if isinstance(template.get("fields"), dict) else {}
    )
    html = str(fields.get("compiled_html") or fields.get("html") or "").strip()
    if html:
        return True
    sections = fields.get("sections")
    return isinstance(sections, list) and bool(sections)


def _user_persist_warning(_exc: BaseException | None = None) -> str:
    return (
        "Templates were generated, but they could not be saved. "
        "Open View to sync, or try generating again."
    )


def _empty_template_save_detail(
    persist_payload: list[dict[str, Any]],
    *,
    exc: BaseException | None = None,
) -> str:
    """Actionable note when batch/sync returned no stored rows."""
    from app.agents.template_library.fields import fields_are_usable
    from app.config import get_settings

    base = str(get_settings().campaign_api_base or "").strip()
    channels = [
        str(row.get("channel") or "").strip().lower()
        for row in persist_payload
        if isinstance(row, dict) and str(row.get("channel") or "").strip()
    ]
    thin: list[str] = []
    for row in persist_payload:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        if ch and fields and not fields_are_usable(ch, fields):
            thin.append(ch)
    parts = [
        "Templates were generated in the agent, but the Campaign API stored none.",
    ]
    if thin:
        parts.append(
            "Channels with copy that failed quality checks: "
            + ", ".join(sorted(set(thin)))
            + " (web/push need title + body ≥12 chars)."
        )
    if channels and not thin:
        parts.append(
            "Copy looked valid — check agents can reach CAMPAIGN_API_BASE "
            f"({base or 'not set'}) and retry build_campaign."
        )
    if exc is not None:
        logger.warning(
            "template persist empty sid payload_channels=%s api_base=%s err=%s",
            channels,
            base,
            exc,
        )
    else:
        logger.warning(
            "template persist empty sid payload_channels=%s api_base=%s",
            channels,
            base,
        )
    parts.append("Open View to sync, or try generating again.")
    return " ".join(parts)


async def _emit_template_save_progress(
    event_callback: ProgressCallback | None,
    *,
    status: str,
    label: str,
    percent: int,
    batch_id: str | None,
    channels: list[str],
) -> None:
    if event_callback is None:
        return
    try:
        await event_callback(
            {
                "type": "template_progress",
                "payload": {
                    "status": status,
                    "label": label,
                    "percent": percent,
                    "generation_batch_id": batch_id,
                    "channels": channels,
                },
            }
        )
    except Exception:  # noqa: BLE001
        pass


def _keep_new_generation_templates(
    saved: list[dict[str, Any]],
    preexisting_ids: set[str],
    persist_payload: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep this generate's rows only. Never treat the full session dump as new cards."""
    new_rows = [
        t
        for t in saved
        if isinstance(t, dict)
        and str(t.get("template_id") or "").strip()
        and str(t.get("template_id") or "").strip() not in preexisting_ids
    ]
    if new_rows:
        return new_rows
    if 0 < len(saved) <= len(persist_payload):
        return list(saved)
    return []


def _latest_templates_by_channel(templates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the best renderable card per channel for campaign_channels store."""
    return list(best_template_by_channel(templates).values())


def _sync_template_ids_by_channel(
    session: dict[str, Any],
    templates: list[dict[str, Any]],
) -> dict[str, str]:
    """Index this generate's template_id per channel without dropping other channels."""
    latest = _latest_templates_by_channel(templates)
    by_ch: dict[str, str] = {}
    prev = session.get("template_ids_by_channel")
    if isinstance(prev, dict):
        for key, val in prev.items():
            ch = str(key or "").strip().lower()
            tid = str(val or "").strip()
            if ch and tid:
                by_ch[ch] = tid
    for row in latest:
        ch = str(row.get("channel") or "").strip().lower()
        tid = str(row.get("template_id") or row.get("id") or "").strip()
        if ch and tid:
            by_ch[ch] = tid
    if by_ch:
        session["template_ids_by_channel"] = by_ch
    return by_ch


def _sync_primary_template_id(
    session: dict[str, Any],
    templates: list[dict[str, Any]],
) -> str | None:
    """Set session.template_id for image attach from primary channel or first template."""
    if not templates:
        return None
    by_ch = _sync_template_ids_by_channel(session, templates)
    strategy = session.get("send_strategy")
    primary = ""
    if isinstance(strategy, dict):
        primary = str(strategy.get("primary_channel") or "").strip().lower()
    if not primary:
        channels = session.get("channels") or []
        if isinstance(channels, list) and channels:
            first = channels[0]
            if isinstance(first, dict):
                primary = str(first.get("channel") or first.get("id") or "").strip().lower()
            else:
                primary = str(first).strip().lower()
    picked = by_ch.get(primary) if primary else None
    if not picked:
        for tid in by_ch.values():
            picked = tid
            break
    if picked:
        session["template_id"] = picked
    return picked or None


async def _hydrate_session_templates_from_db(
    session: dict[str, Any],
    session_id: str,
    *,
    append_unknown: bool = False,
) -> dict[str, Any]:
    """Overlay latest saved fields from DB so launch/approval uses edits."""
    try:
        db_rows = await list_session_templates(session_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "hydrate templates from db failed sid=%s: %s", session_id, exc
        )
        return session
    by_id: dict[str, dict[str, Any]] = {}
    for row in db_rows or []:
        if not isinstance(row, dict):
            continue
        tid = str(row.get("template_id") or "").strip()
        if tid:
            by_id[tid] = row
    if not by_id:
        return session
    cards = list(session.get("templates") or [])
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        tid = str(card.get("template_id") or "").strip()
        if tid and tid in by_id:
            db = by_id[tid]
            merged = {**card, **db}
            ch = str(merged.get("channel") or card.get("channel") or "").strip().lower()
            card_fields = card.get("fields") if isinstance(card.get("fields"), dict) else {}
            db_fields = db.get("fields") if isinstance(db.get("fields"), dict) else {}
            if ch == "email" and (card_fields or db_fields):
                from app.agents.template_library.fields import merge_email_fields_for_launch

                merged["fields"] = merge_email_fields_for_launch(card_fields, db_fields)
            elif isinstance(db_fields, dict) and db_fields:
                merged["fields"] = db_fields
            out.append(merged)
            seen.add(tid)
        else:
            out.append(card)
    if append_unknown:
        for tid, row in by_id.items():
            if tid not in seen:
                out.append(row)
    session["templates"] = out
    return session


async def _persist_canonical_email_templates(
    session: dict[str, Any],
    *,
    token: str,
) -> dict[str, Any]:
    """Write canonical email fields to DB before launch so send matches last saved edit."""
    from app.agents.template_library.fields import canonicalize_email_fields
    from app.template_store import update_template_fields

    cards = list(session.get("templates") or [])
    for idx, card in enumerate(cards):
        if not isinstance(card, dict):
            continue
        ch = str(card.get("channel") or "").strip().lower()
        if ch != "email":
            continue
        fields = card.get("fields")
        if not isinstance(fields, dict):
            continue
        tid = str(card.get("template_id") or "").strip()
        if not tid:
            continue
        from app.agents.image.media_upload import publicize_html_media_urls
        from app.agents.template_library.fields import sanitize_outbound_email_html

        canonical = canonicalize_email_fields(fields)
        html = sanitize_outbound_email_html(
            str(fields.get("compiled_html") or fields.get("html") or "")
        )
        if html:
            html = publicize_html_media_urls(html)
            canonical["compiled_html"] = html
            if not str(canonical.get("html") or "").strip():
                canonical["html"] = html
        try:
            saved = await update_template_fields(tid, canonical, token=token)
            tpl = saved.get("template") if isinstance(saved, dict) else None
            if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
                canonical = tpl["fields"]
                if html and not str(canonical.get("compiled_html") or "").strip():
                    canonical["compiled_html"] = html
        except Exception as exc:  # noqa: BLE001
            logger.warning("canonical template persist failed tid=%s: %s", tid, exc)
        cards[idx] = {**card, "fields": canonical}
    session["templates"] = cards
    return session


def _normalize_creative_mode(raw: Any, *, allowed: frozenset[str]) -> str | None:
    val = str(raw or "").strip().lower()
    return val if val in allowed else None


def _creative_policy_from_args(args: dict[str, Any]) -> dict[str, str] | None:
    """Optional library/adapt modes — None means today's create behavior."""
    content = _normalize_creative_mode(
        args.get("content_mode"), allowed=frozenset({"keep", "rewrite"})
    )
    design = _normalize_creative_mode(
        args.get("design_mode"), allowed=frozenset({"keep", "rewrite"})
    )
    image = _normalize_creative_mode(
        args.get("image_mode"), allowed=frozenset({"keep", "plan_new", "none"})
    )
    scope = _normalize_creative_mode(
        args.get("scope"),
        allowed=frozenset({"selected", "missing_only", "all_session"}),
    )
    if not any((content, design, image, scope)):
        return None
    policy: dict[str, str] = {}
    if content:
        policy["content_mode"] = content
    if design:
        policy["design_mode"] = design
    if image:
        policy["image_mode"] = image
    if scope:
        policy["scope"] = scope
    return policy


async def handle_inspect_session_template(
    session_id: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Compact stored-template facts for the content agent (no HTML dump)."""
    from app.agents.create_campaign.template_extract import (
        compact_template_extract,
        pick_session_template,
    )

    session = await get_or_create_session(session_id)
    cards = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict)
    ]
    card = pick_session_template(
        session,
        template_id=str(args.get("template_id") or "").strip(),
        channel=str(args.get("channel") or "").strip(),
    )
    if not card:
        return {
            "ok": False,
            "error": "no_session_template",
            "message": (
                "No matching template in this session yet. Generate first, then inspect."
            ),
            "templates_count": len(cards),
        }
    extract = compact_template_extract(card)
    return {
        "ok": True,
        "extract": extract,
        "templates_count": len(cards),
        "message": (
            f"Latest stored {extract.get('channel') or 'template'} "
            f"id={extract.get('template_id')}. "
            f"subject={extract.get('subject') or '(none)'}; "
            f"words={extract.get('word_count')}; "
            f"hero={'yes' if extract.get('hero_url') else 'none'}. "
            "Set content_mode keep|rewrite and image_mode keep|plan_new on build_campaign."
        ),
    }


def _library_channels_missing(session: dict[str, Any]) -> list[str]:
    have = {
        _normalize_agent_channel(t.get("channel"))
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and _normalize_agent_channel(t.get("channel"))
    }
    selected = _dedupe_channels(list(session.get("channels") or []))
    return [ch for ch in selected if ch not in have]


def _library_source_ref(row: dict[str, Any]) -> str:
    """Library catalog id — never use as session channel template_id."""
    return str(
        row.get("library_template_id")
        or row.get("library_id")
        or row.get("template_id")
        or row.get("id")
        or ""
    ).strip()


def _adopt_persist_payload(templates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build batch payload without library ids (backend would reuse numeric ids)."""
    payload: list[dict[str, Any]] = []
    for card in templates:
        if not isinstance(card, dict):
            continue
        channel = _normalize_agent_channel(card.get("channel"))
        fields = card.get("fields") if isinstance(card.get("fields"), dict) else None
        if not channel or not fields:
            continue
        payload.append(
            {
                "channel": channel,
                "logo": card.get("logo"),
                "launch_at": card.get("launch_at"),
                "how_it_works": card.get("how_it_works")
                or f"{channel} touch from library",
                "fields": fields,
            }
        )
    return payload


async def _adopt_seeded_library_templates(
    session_id: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Keep exact baseline: confirm seeded templates without regenerating."""
    from app.request_context import get_request_token

    session = await get_or_create_session(session_id)
    token = get_request_token() or ""
    source_templates: list[dict[str, Any]] = [
        dict(t)
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    if not source_templates:
        # Materialize from selected_library_templates.fields when join seeded refs only.
        seeded: list[dict[str, Any]] = []
        for row in session.get("selected_library_templates") or []:
            if not isinstance(row, dict):
                continue
            channel = _normalize_agent_channel(row.get("channel"))
            fields = row.get("fields") if isinstance(row.get("fields"), dict) else None
            lib_ref = _library_source_ref(row)
            if not channel or not fields:
                continue
            card: dict[str, Any] = {
                "channel": channel,
                "fields": fields,
                "how_it_works": row.get("how_it_works")
                or f"{channel} touch from library",
                "generation_batch_id": row.get("generation_batch_id"),
            }
            if lib_ref:
                card["library_template_id"] = lib_ref
            seeded.append(card)
        if seeded:
            source_templates = seeded
        else:
            return {
                "ok": False,
                "error": "no_library_baseline_templates",
                "message": (
                    "No seeded library templates to adopt. Pass content_mode=rewrite "
                    "or design_mode=rewrite to generate, or ensure join seeded fields."
                ),
            }

    persist_payload = _adopt_persist_payload(source_templates)
    if not persist_payload:
        return {
            "ok": False,
            "error": "no_library_baseline_templates",
            "message": "Library templates are missing channel fields.",
        }

    persist_warning: str | None = None
    saved: list[dict[str, Any]] = []
    batch_id = str(args.get("generation_batch_id") or "").strip() or None
    try:
        persisted = await create_templates_batch(
            session_id,
            persist_payload,
            generation_batch_id=batch_id,
            token=token or None,
        )
        saved = list(persisted.get("templates") or [])
        if not saved:
            synced = await sync_session_templates(
                session_id,
                persist_payload,
                generation_batch_id=batch_id,
                token=token or None,
            )
            saved = list(synced.get("templates") or [])
    except Exception as exc:  # noqa: BLE001
        try:
            synced = await sync_session_templates(
                session_id,
                persist_payload,
                generation_batch_id=batch_id,
                token=token or None,
            )
            saved = list(synced.get("templates") or [])
        except Exception as sync_exc:  # noqa: BLE001
            persist_warning = f"{exc}; sync: {sync_exc}"
        else:
            if not saved:
                persist_warning = str(exc)
    if not saved:
        return {
            "ok": False,
            "error": "template_persist_failed",
            "message": (
                "Could not save adopted library templates to the database. "
                "Try build_campaign again or open View to sync."
            ),
            "detail": persist_warning,
        }

    saved_by_channel: dict[str, dict[str, Any]] = {}
    for row in saved:
        ch = _normalize_agent_channel(row.get("channel"))
        if ch:
            saved_by_channel[ch] = row

    merged_templates: list[dict[str, Any]] = []
    for src in source_templates:
        ch = _normalize_agent_channel(src.get("channel"))
        db_row = saved_by_channel.get(ch) if ch else None
        if not db_row:
            continue
        card = {**db_row}
        lib_ref = _library_source_ref(src)
        if lib_ref:
            card["library_template_id"] = lib_ref
        merged_templates.append(card)

    if not merged_templates:
        return {
            "ok": False,
            "error": "template_persist_failed",
            "message": "Adopted templates could not be matched after save.",
        }

    session["templates"] = merged_templates
    session["confirmed_create_templates"] = True
    session["stage"] = "templates"
    await save_session(session)
    channels = sorted(
        {
            _normalize_agent_channel(t.get("channel"))
            for t in merged_templates
            if _normalize_agent_channel(t.get("channel"))
        }
    )
    out: dict[str, Any] = {
        "ok": True,
        "adopted": True,
        "channels": channels,
        "template_count": len(merged_templates),
        "template_ids": [
            str(t.get("template_id") or "") for t in merged_templates if t.get("template_id")
        ],
        "content_mode": "keep",
        "design_mode": "keep",
        "message": (
            f"Adopted {len(merged_templates)} library template(s) as-is "
            f"({', '.join(channels)}). Saved to session templates for launch."
        ),
        "change_summary": str(args.get("change_summary") or "adopt library baseline"),
    }
    if persist_warning:
        out["persist_warning"] = persist_warning
    return out


async def _generate_and_persist_templates(
    session_id: str,
    args: dict[str, Any],
    *,
    channels_override: list[str] | None = None,
    require_confirm: bool = True,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Create NEW template cards (append-only) and refresh stored campaign."""
    session = await get_or_create_session(session_id)
    if require_confirm and not session.get("confirmed_create_templates"):
        return {
            "ok": False,
            "error": "User has not confirmed template creation yet.",
        }

    campaign = session.get("campaign") or {}
    prior_templates = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    has_prior = bool(prior_templates) or bool(session.get("clone_mode"))
    if not (campaign.get("name") and campaign.get("goal")):
        return {"ok": False, "error": "Campaign name and goal required."}
    if not has_prior and not campaign.get("objective"):
        return {"ok": False, "error": "Campaign name, goal, and objective required."}

    contact_ids: list[str] = []
    try:
        from app.http_retry import with_http_retry

        contact_ids = await with_http_retry(
            f"load_audience_ids:{session_id}",
            lambda: load_audience_ids(session_id),
            attempts=3,
        )
    except Exception as aud_exc:  # noqa: BLE001
        logging.getLogger(__name__).warning(
            "load_audience_ids failed sid=%s: %s — continuing with session count",
            session_id,
            aud_exc,
        )
        contact_ids = []
    audience = session.get("audience") or {}
    audience_count = audience.get("matched_count") or 0
    # Templates may be created before audience; launch still requires contacts.
    audience_deferred = audience_count <= 0 and not contact_ids

    selected = list(session.get("channels") or [])
    plans = list(session.get("channel_plans") or [])
    if channels_override:
        channels = _dedupe_channels(list(channels_override))
    else:
        channels = _dedupe_channels(selected)

    if not channels and not plans:
        return {"ok": False, "error": "No channels selected."}
    if not channels:
        channels = _dedupe_channels(
            [p.get("channel") for p in plans if p.get("channel")]
        )

    # Attach library format references onto channel plans (followed by creation agent).
    lib_by_channel: dict[str, dict[str, Any]] = {}
    for row in session.get("selected_library_templates") or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        # FE uses web_push/app_push; creation agents use web/push.
        if ch == "web_push":
            ch = "web"
        elif ch == "app_push":
            ch = "push"
        if ch:
            lib_by_channel[ch] = row

    enriched_plans: list[dict[str, Any]] = []
    seen_plan_channels: set[str] = set()
    for plan in plans:
        p = dict(plan) if isinstance(plan, dict) else {}
        ch = str(p.get("channel") or "").strip().lower()
        if ch in lib_by_channel:
            ref = lib_by_channel[ch]
            p["library_format"] = {
                "name": ref.get("name"),
                "description": ref.get("description"),
                "body_preview": ref.get("body_preview") or ref.get("bodyPreview"),
                "format_notes": ref.get("format_notes"),
            }
        if ch:
            seen_plan_channels.add(ch)
        enriched_plans.append(p)
    for ch, ref in lib_by_channel.items():
        if ch in seen_plan_channels:
            continue
        enriched_plans.append(
            {
                "channel": ch,
                "how_it_works": f"{ch} touch for this campaign",
                "library_format": {
                    "name": ref.get("name"),
                    "description": ref.get("description"),
                    "body_preview": ref.get("body_preview") or ref.get("bodyPreview"),
                    "format_notes": ref.get("format_notes"),
                },
            }
        )
    launch_plan = session.get("launch_plan") if isinstance(session.get("launch_plan"), dict) else {}
    ab_on = bool(launch_plan.get("ab_enabled"))
    if ab_on:
        stamped = False
        for p in enriched_plans:
            if str(p.get("channel") or "").strip().lower() == "email":
                p["ab_test"] = True
                stamped = True
        if not stamped and "email" in {str(c).strip().lower() for c in channels}:
            enriched_plans.append(
                {
                    "channel": "email",
                    "how_it_works": "email touch for this campaign",
                    "ab_test": True,
                }
            )

    # Real destination only: form launch, campaign, or KB/user https URL.
    from app.campaign_destination_url import resolve_campaign_destination_url

    click_url = _campaign_click_url_from_session(session)
    dest = click_url or resolve_campaign_destination_url(
        session=session,
        campaign=campaign if isinstance(campaign, dict) else {},
        extra_text=str(args.get("user_text") or ""),
        knowledge=str(
            (session.get("campaign") or {}).get("knowledge")
            if isinstance(session.get("campaign"), dict)
            else ""
        ),
    )
    campaign = dict(campaign or {})
    if dest:
        campaign["form_url"] = click_url or dest
        campaign["cta_url"] = dest
        campaign["destination_url"] = dest
    else:
        campaign.pop("cta_url", None)

    from app.industry_packs.loader import stamp_campaign_industry

    campaign = stamp_campaign_industry(campaign, session.get("campaign_profile"))

    from app.mas.runtime.creation_context import image_plan_wants_images

    creative_policy = _creative_policy_from_args(args)
    from app.agents.image.user_assets import (
        confirmed_template_images,
        sync_image_plan_for_confirmed_uploads,
    )

    sync_image_plan_for_confirmed_uploads(session)
    uploads = bool(confirmed_template_images(session))
    image_mode = str((creative_policy or {}).get("image_mode") or "").strip().lower()
    from app.agents.image.channel_visual_orchestrator import (
        channel_assets_summary,
        merge_channel_visuals,
    )

    visual_resolution = merge_channel_visuals(
        session,
        channels=channels,
        args={**args, "wants_images": args.get("wants_images"), "image_mode": image_mode or args.get("image_mode")},
    )
    explicit_visuals = isinstance(args.get("channel_visuals"), list) and bool(
        args.get("channel_visuals")
    )
    if args.get("wants_images") is True or image_mode == "plan_new" or explicit_visuals:
        wants_images = True
    elif args.get("wants_images") is False or image_mode == "none":
        wants_images = uploads
    elif image_mode == "keep":
        wants_images = uploads or visual_resolution.wants_images
    elif has_prior:
        wants_images = uploads or visual_resolution.wants_images
    else:
        wants_images = image_plan_wants_images(session) or uploads or visual_resolution.wants_images

    from app.agents.template_generation_director.creative_context import (
        gather_director_session_context,
    )
    from app.agents.image.plan import get_image_plan

    director_ctx = gather_director_session_context(session)
    user_request = str(
        args.get("user_text") or director_ctx.get("user_request") or ""
    ).strip()
    chat_summary = str(director_ctx.get("chat_summary") or "").strip() or chat_summary_from_session(
        session, limit=24
    )

    from app.agents.template_library.create_payload import build_create_payload

    create_payload = build_create_payload(
        session,
        channels=channels,
        campaign=campaign,
        channel_plans=enriched_plans or plans,
        user_request=user_request,
        tool_args=args,
    )
    session["create_template_payload"] = create_payload
    try:
        await save_session(session)
    except Exception:  # noqa: BLE001
        pass

    created = await run_creation_agent(
        campaign=campaign,
        audience=audience,
        channels=channels,
        channel_plans=enriched_plans or plans,
        prior_templates=prior_templates or None,
        campaign_profile=session.get("campaign_profile")
        if isinstance(session.get("campaign_profile"), dict)
        else None,
        company_pack=session.get("company_pack")
        if isinstance(session.get("company_pack"), dict)
        else None,
        user_request=user_request,
        chat_summary=chat_summary,
        event_callback=event_callback,
        wants_images=wants_images,
        creative_policy=creative_policy,
        image_plan=get_image_plan(session),
        confirmed_chat_images=list(director_ctx.get("confirmed_chat_images") or []),
        session=session,
        create_payload=create_payload,
    )
    if isinstance(created.get("create_payload"), dict):
        session["create_template_payload"] = created["create_payload"]
    if created.get("images_by_channel"):
        try:
            from app.agents.image.plan import mark_plan_status, set_images_by_channel

            set_images_by_channel(session, dict(created["images_by_channel"]))
            if created.get("images_pre_resolved"):
                # Images already injected into generated fields — avoid re-fetch/gen.
                mark_plan_status(session, "attached")
            await save_session(session)
        except Exception:  # noqa: BLE001
            pass
    for ev in list(created.get("ui_events") or []):
        if event_callback is not None and isinstance(ev, dict):
            try:
                await event_callback(ev)
            except Exception:  # noqa: BLE001
                pass
    if not created.get("ok"):
        failed_ch = list(created.get("failed_channels") or [])
        errs = list(created.get("errors") or [])
        return {
            "ok": False,
            "error": created.get("error") or "Creation agent failed",
            "errors": errs,
            "failed_channels": failed_ch or list(channels),
            "message": _templates_failed_message(failed_ch or channels, errs),
        }

    templates = list(created.get("templates") or [])
    session["template_generation_report"] = created.get("generation_report") or {}
    session["template_design_plans"] = created.get("design_plans") or []
    try:
        from app.agents.image.design_plan_sync import apply_design_plans_to_image_plan

        apply_design_plans_to_image_plan(session, created.get("design_plans"))
        await save_session(session)
    except Exception:  # noqa: BLE001
        pass
    if click_url:
        templates = _inject_form_url_into_templates(templates, click_url)
    if not dest:
        from app.campaign_destination_url import destination_from_fields

        for t in templates:
            fields = t.get("fields") if isinstance(t, dict) else None
            dest = destination_from_fields(fields if isinstance(fields, dict) else {})
            if dest:
                break
    templates = _ensure_campaign_url_merge_tags(templates, dest)
    batch_id = created.get("generation_batch_id")
    if not templates:
        failed_ch = list(created.get("failed_channels") or [])
        errs = list(created.get("errors") or [])
        return {
            "ok": False,
            "error": "Creation agent returned no templates.",
            "errors": errs,
            "templates": [],
            "failed_channels": failed_ch or list(channels),
            "message": _templates_failed_message(failed_ch or channels, errs),
        }

    if get_settings().template_director_enabled:
        email_templates = [
            t for t in templates if str(t.get("channel") or "").strip().lower() == "email"
        ]
        report = created.get("generation_report") if isinstance(created.get("generation_report"), dict) else {}
        if email_templates and not all(_email_template_has_director_shape(t) for t in email_templates):
            if not _director_generation_report_ok(report):
                return {
                    "ok": False,
                    "error": "template_director_required",
                    "errors": [str(report.get("error") or "Template Director did not run.")],
                    "templates": [],
                    "failed_channels": ["email"],
                    "message": (
                        "Email templates must be generated through Template Director "
                        "(section-based layout). Please retry build_campaign."
                    ),
                    "generation_report": report,
                }

    # Ensure every card has ids the FE timeline / View navigation need.
    import uuid as _uuid

    existing_ids = {
        str(t.get("template_id") or "").strip()
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and str(t.get("template_id") or "").strip()
    }
    preexisting_ids = set(existing_ids)
    templates = [
        t
        for t in templates
        if str(t.get("channel") or "").strip().lower() != "email"
        or _email_ready_to_persist(t)
    ]
    if not templates:
        return {
            "ok": False,
            "error": "empty_email_html",
            "errors": ["Email generate returned no compiled HTML."],
            "templates": [],
            "message": (
                "The new email template was empty, so it was not saved. "
                "Existing templates were left unchanged. Please generate again."
            ),
        }
    for t in templates:
        if not t.get("template_id"):
            continue
        if batch_id and not t.get("generation_batch_id"):
            t["generation_batch_id"] = batch_id
        tid = str(t.get("template_id") or "").strip()
        if tid and tid in existing_ids:
            tid = str(_uuid.uuid4())
            t["template_id"] = tid
        if tid:
            existing_ids.add(tid)

    from app.agents.image.media_upload import publicize_template_image_fields

    persist_payload = [
        {
            "template_id": t["template_id"],
            "channel": t["channel"],
            "logo": t.get("logo"),
            "launch_at": t.get("launch_at"),
            "how_it_works": t.get("how_it_works"),
            "fields": publicize_template_image_fields(
                t.get("fields") if isinstance(t.get("fields"), dict) else {}
            ),
            "generation_batch_id": t.get("generation_batch_id") or batch_id,
        }
        for t in templates
        if t.get("template_id") and t.get("channel")
    ]
    persist_warning: str | None = None
    kept: list[dict[str, Any]] = []
    try:
        persisted = await create_templates_batch(
            session_id,
            persist_payload,
            generation_batch_id=batch_id,
        )
        from app.template_store import persist_templates_from_body

        saved = persist_templates_from_body(persisted)
        kept = _keep_new_generation_templates(
            saved, preexisting_ids, persist_payload
        )
        if kept:
            templates = kept
        else:
            synced = await sync_session_templates(
                session_id,
                persist_payload,
                generation_batch_id=batch_id,
            )
            saved = persist_templates_from_body(synced)
            kept = _keep_new_generation_templates(
                saved, preexisting_ids, persist_payload
            )
            if kept:
                templates = kept
            else:
                persist_warning = _empty_template_save_detail(persist_payload)
    except Exception as persist_exc:  # noqa: BLE001
        logger.warning(
            "create_templates_batch failed sid=%s: %s",
            session_id,
            persist_exc,
        )
        try:
            from app.template_store import persist_templates_from_body

            synced = await sync_session_templates(
                session_id,
                persist_payload,
                generation_batch_id=batch_id,
            )
            saved = persist_templates_from_body(synced)
            kept = _keep_new_generation_templates(
                saved, preexisting_ids, persist_payload
            )
            if kept:
                templates = kept
            else:
                persist_warning = _empty_template_save_detail(
                    persist_payload, exc=persist_exc
                )
        except Exception as sync_exc:  # noqa: BLE001
            logger.warning(
                "sync_session_templates failed sid=%s: %s",
                session_id,
                sync_exc,
            )
            persist_warning = _empty_template_save_detail(
                persist_payload, exc=persist_exc or sync_exc
            )

    if persist_warning and not kept:
        await _emit_template_save_progress(
            event_callback,
            status="failed",
            label="Could not save templates",
            percent=100,
            batch_id=str(batch_id or "") or None,
            channels=[
                str(t.get("channel") or "")
                for t in templates
                if str(t.get("channel") or "").strip()
            ],
        )
        return {
            "ok": False,
            "error": "template_persist_failed",
            "errors": [persist_warning],
            "templates": [],
            "failed_channels": [
                str(t.get("channel") or "")
                for t in templates
                if str(t.get("channel") or "").strip()
            ],
            "message": persist_warning,
        }

    if not templates:
        return {
            "ok": False,
            "error": "No template cards available after generation.",
            "errors": (created.get("errors") or [])
            + ([persist_warning] if persist_warning else []),
            "templates": [],
        }

    # Append-only: never overwrite prior generation cards.
    existing = list(session.get("templates") or [])
    existing.extend(templates)
    session["templates"] = existing
    session["stage"] = "templates"
    session["confirmed_create_templates"] = True

    from app.agents.create_campaign.memory_note import (
        append_memory_note,
        note_from_templates,
    )

    ready_channels = _dedupe_channels(
        [t.get("channel") for t in templates]
        or list(session.get("channels") or [])
        or channels
    )
    note_line = note_from_templates(ready_channels)
    if note_line:
        append_memory_note(session, note_line)
        session["_templates_generated_note"] = note_line

    from app.mas.runtime.creation_context import last_user_turn_pin

    pin_user_message_id, pin_user_ordinal = last_user_turn_pin(session)

    persisted_batch = ""
    for t in templates:
        if not isinstance(t, dict):
            continue
        bid = str(t.get("generation_batch_id") or "").strip()
        if bid:
            persisted_batch = bid
            break

    # Frontend owns the board: signal that created templates are ready to load.
    batch_ids = [
        str(x).strip()
        for x in (persisted_batch, batch_id)
        if str(x).strip()
    ]
    ready_payload: dict[str, object] = {
        "generation_batch_id": persisted_batch or batch_id,
        "generation_batch_ids": list(dict.fromkeys(batch_ids)),
        "template_count": len(templates),
        "template_ids": [
            str(t.get("template_id") or "").strip()
            for t in templates
            if str(t.get("template_id") or "").strip()
        ],
    }
    if pin_user_message_id:
        ready_payload["pin_user_message_id"] = pin_user_message_id
    if pin_user_ordinal >= 1:
        ready_payload["pin_user_ordinal"] = pin_user_ordinal
    ready_event = {
        "type": "templates_ready",
        "payload": ready_payload,
    }
    await _emit_template_save_progress(
        event_callback,
        status="completed",
        label="Templates ready",
        percent=100,
        batch_id=str(persisted_batch or batch_id or "") or None,
        channels=list(ready_channels),
    )
    if event_callback is not None:
        try:
            await event_callback(ready_event)
        except Exception:  # noqa: BLE001
            pass

    _sync_primary_template_id(session, templates)

    try:
        session = await save_session(session)
    except Exception as save_exc:  # noqa: BLE001
        persist_warning = (
            (persist_warning + " ") if persist_warning else ""
        ) + f"Session save warning: {save_exc}"

    plan_by_channel = {
        _normalize_agent_channel(p.get("channel")): p
        for p in plans
        if p.get("channel")
    }
    latest = _latest_templates_by_channel(existing)
    campaign_channels = []
    for t in latest:
        ch = _normalize_agent_channel(t.get("channel"))
        if not ch:
            continue
        plan = plan_by_channel.get(ch) or {}
        campaign_channels.append(
            {
                "channel": ch,
                "template_id": t.get("template_id"),
                "how_it_works": t.get("how_it_works") or plan.get("how_it_works"),
                "planned_launch_at": t.get("launch_at")
                or plan.get("suggested_launch_at"),
                "status": "ready",
            }
        )
    for ch in selected:
        key = _normalize_agent_channel(ch)
        if key and not any(c["channel"] == key for c in campaign_channels):
            plan = plan_by_channel.get(key) or {}
            campaign_channels.append(
                {
                    "channel": key,
                    "template_id": None,
                    "how_it_works": plan.get("how_it_works"),
                    "planned_launch_at": plan.get("suggested_launch_at"),
                    "status": "pending_template",
                }
            )

    campaign_id = session.get("campaign_id")
    store_errors: list[str] = []
    try:
        saved_campaign = await save_campaign_from_session(
            session_id,
            {
                "name": campaign.get("name"),
                "goal": campaign.get("goal"),
                "objective": campaign.get("objective"),
                "audience_summary": audience.get("description")
                or audience.get("summary"),
                "audience_filters": audience.get("filters") or {},
                "audience_count": len(contact_ids) or audience_count,
                "contact_ids": contact_ids,
                "channels": campaign_channels,
                "status": "draft",
                "launch_plan": session.get("launch_plan"),
            },
        )
        campaign_id = (saved_campaign.get("campaign") or {}).get("id") or campaign_id
        if campaign_id:
            session["campaign_id"] = campaign_id
            await save_session(session)
    except Exception as camp_exc:  # noqa: BLE001
        store_errors.append(f"Templates saved but campaign store failed: {camp_exc}")

    if persist_warning:
        store_errors.append(persist_warning)

    image_pipeline: dict[str, Any] | None = None
    from app.agents.image.hero_image import templates_channels_needing_hero
    from app.agents.image.plan import get_image_plan, set_image_plan, should_run_pipeline_after_build
    from app.agents.image.user_assets import sync_image_plan_for_confirmed_uploads

    # Confirmed main-chat uploads must attach after build (any channel set).
    sync_image_plan_for_confirmed_uploads(session)

    channels_needing_hero = templates_channels_needing_hero(templates)
    if channels_needing_hero and not get_image_plan(session).get("wants_images"):
        set_image_plan(
            session,
            wants_images=True,
            channels=channels_needing_hero,
            auto_after_build=True,
            user_confirmed=True,
        )
        await save_session(session)
    elif get_image_plan(session).get("wants_images"):
        await save_session(session)

    try:
        from app.agents.image.batch import run_campaign_image_pipeline
        from app.request_context import peek_request_token

        if should_run_pipeline_after_build(session):
            image_pipeline = await run_campaign_image_pipeline(
                session,
                token=peek_request_token(),
                generation_batch_id=str(batch_id or ""),
            )
            await save_session(session)
            if image_pipeline.get("ok"):
                session = await get_or_create_session(session_id)
                hydrated = await _hydrate_session_templates_from_db(session, session_id)
                if hydrated.get("templates"):
                    session["templates"] = hydrated["templates"]
                    this_batch = [
                        t
                        for t in session.get("templates") or []
                        if isinstance(t, dict)
                        and str(t.get("generation_batch_id") or "").strip()
                        == str(batch_id or "").strip()
                    ]
                    if this_batch:
                        templates = this_batch
                    await save_session(session)
    except Exception as img_exc:  # noqa: BLE001
        logging.getLogger(__name__).warning(
            "post-build image pipeline sid=%s: %s", session_id, img_exc
        )
        image_pipeline = {"ok": False, "error": str(img_exc)}

    image_ui_events: list[dict[str, Any]] = []
    if isinstance(image_pipeline, dict):
        from app.agents.image.pipeline_ui import collect_image_pipeline_ui_events

        image_ui_events = collect_image_pipeline_ui_events(image_pipeline)
        if event_callback is not None:
            for ev in image_ui_events:
                try:
                    await event_callback(ev)
                except Exception:  # noqa: BLE001
                    pass

    # Cards were already emitted above; keep ui_event for end-of-turn re-emit.
    ab_facts = _email_ab_card_facts(templates)
    return {
        "ok": True,
        "created_count": len(templates),
        "channels": [t["channel"] for t in templates],
        "audience_count": len(contact_ids) or audience_count,
        "campaign_name": campaign.get("name"),
        "campaign_goal": campaign.get("goal"),
        "campaign_objective": campaign.get("objective"),
        "errors": (created.get("errors") or [])
        + store_errors
        + _image_pipeline_generation_notes(image_pipeline),
        "persist_warning": persist_warning,
        "generation_batch_id": batch_id,
        "generation_report": created.get("generation_report") or {},
        "campaign_id": campaign_id,
        "template_ids_by_channel": session.get("template_ids_by_channel") or {},
        "image_pipeline": image_pipeline,
        "image_plan": get_image_plan(session),
        "cards": [
            {
                "template_id": t["template_id"],
                "channel": t["channel"],
                "logo": t.get("logo"),
            }
            for t in templates
        ],
        "channel_assets": channel_assets_summary(templates),
        "email_ab": ab_facts,
        "message": _templates_created_message(
            args,
            templates,
            persist_warning,
            selected_channels=channels,
            generation_errors=list(created.get("errors") or [])
            + _image_pipeline_generation_notes(image_pipeline),
            audience_deferred=audience_deferred,
        ),
        "ui_event": ready_event,
        "ui_events": image_ui_events,
        "selected_channels": list(channels),
        "audience_deferred": audience_deferred,
        "missing_channels": [
            ch
            for ch in channels
            if ch
            and ch
            not in {
                str(t.get("channel") or "").strip().lower()
                for t in templates
                if str(t.get("channel") or "").strip()
            }
        ],
    }


def _email_template_has_director_shape(template: dict[str, Any]) -> bool:
    fields = template.get("fields") if isinstance(template.get("fields"), dict) else {}
    compiled = str(fields.get("compiled_html") or "").strip()
    if compiled and str(fields.get("pipeline") or "").strip().lower() == "compose":
        return True
    sections = fields.get("sections")
    if isinstance(sections, list) and sections:
        return True
    return bool(str(fields.get("pattern_id") or "").strip())


def _director_generation_report_ok(report: dict[str, Any] | None) -> bool:
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


def _templates_failed_message(
    channels: list[str],
    errors: list[str] | None = None,
) -> str:
    label = ", ".join(channels) if channels else "selected channels"
    parts = [
        f"Template generation failed for {label}. No template cards were created.",
        "Apologize briefly, say which channels failed, and ask if they want to "
        "retry (build_campaign mode=create or regenerate) or adjust channels.",
    ]
    if errors:
        parts.append(
            "Failure notes (paraphrase for the user — do not paste raw stack traces): "
            + "; ".join(str(e)[:160] for e in errors[:4])
        )
    return "\n\n".join(parts)


def _email_ab_card_facts(templates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Facts for LLM replies — one email A/B card, real subjects only."""
    for t in templates:
        if not isinstance(t, dict):
            continue
        if str(t.get("channel") or "").strip().lower() != "email":
            continue
        fields = t.get("fields") if isinstance(t.get("fields"), dict) else {}
        va = fields.get("variant_a") if isinstance(fields.get("variant_a"), dict) else {}
        vb = fields.get("variant_b") if isinstance(fields.get("variant_b"), dict) else {}
        ab = bool(fields.get("ab_test")) or bool(va and vb)
        if not ab:
            continue
        subj_a = str(va.get("subject") or fields.get("subject") or "").strip()
        subj_b = str(vb.get("subject") or "").strip()
        return {
            "card_count": 1,
            "ab_enabled": True,
            "template_id": str(t.get("template_id") or "").strip() or None,
            "variant_a_subject": subj_a or None,
            "variant_b_subject": subj_b or None,
        }
    return None


def _image_pipeline_generation_notes(pipeline: dict[str, Any] | None) -> list[str]:
    """Surface post-build image failures in build_campaign tool message for the LLM."""
    if not isinstance(pipeline, dict):
        return []
    notes: list[str] = []
    if not pipeline.get("ok"):
        err = str(pipeline.get("error") or "").strip()
        if err:
            notes.append(f"Images did not attach: {err[:200]}")
    slot = pipeline.get("email_slot_fill")
    if isinstance(slot, dict) and not slot.get("ok"):
        err = str(slot.get("error") or "").strip()
        if err and err not in str(notes):
            notes.append(f"Images did not attach: {err[:200]}")
    gen = pipeline.get("generate")
    if isinstance(gen, dict) and not gen.get("ok"):
        err = str(gen.get("error") or "").strip()
        if err and err not in str(notes):
            notes.append(f"Images did not attach: {err[:200]}")
    return notes


def _templates_created_message(
    args: dict[str, Any],
    templates: list[dict[str, Any]],
    persist_warning: str | None = None,
    *,
    selected_channels: list[str] | None = None,
    generation_errors: list[str] | None = None,
    audience_deferred: bool = False,
) -> str:
    channels = [
        str(t.get("channel") or "").strip().lower()
        for t in templates
        if str(t.get("channel") or "").strip()
    ]
    label = ", ".join(channels) if channels else "your channels"
    selected = [
        str(c).strip().lower()
        for c in (selected_channels or [])
        if str(c).strip()
    ]
    missing = [ch for ch in selected if ch and ch not in set(channels)]
    ab_facts = _email_ab_card_facts(templates)
    if missing:
        base = (
            f"Template card{'s' if len(templates) != 1 else ''} ready for {label}. "
            f"Still missing: {', '.join(missing)}. "
            "Review the cards on the panel, or ask to regenerate the missing channels. "
            "Do not launch until every selected channel has a card (or remove those channels)."
        )
    elif ab_facts:
        sub_a = ab_facts.get("variant_a_subject") or "(see card)"
        sub_b = ab_facts.get("variant_b_subject") or "(see card)"
        base = (
            "ONE email A/B template card is ready (not two cards). "
            f"Variant A subject: {sub_a}. Variant B subject: {sub_b}. "
            "Tell the user it is one Email A/B card with two variants — use ONLY these "
            "subjects (never invent different ones). Click View on the card to open edit."
        )
        if args.get("change_summary"):
            base = f"{str(args.get('change_summary')).strip()} {base}"
    else:
        base = args.get("change_summary") or (
            f"Template card{'s' if len(templates) != 1 else ''} ready for {label}. "
            "Click View on a card to open the edit space. Ask the user to review, then confirm launch."
        )
    parts = [str(base).strip()]
    if audience_deferred:
        parts.append(
            "Audience is still empty (matched_count=0) — do NOT claim emails/contacts were "
            "saved. Ask the user to pick contacts or call check_contacts/create_contact "
            "with the emails they gave. Templates are fine without audience."
        )
    if generation_errors:
        parts.append(
            "Generation notes (for your reply — paraphrase, do not paste raw): "
            + "; ".join(str(e)[:160] for e in generation_errors[:4])
        )
    has_wa = any(ch == "whatsapp" for ch in channels)
    if has_wa:
        parts.append(
            "WhatsApp template is a draft. Meta approval and send start only "
            "after you confirm launch."
        )
    if persist_warning:
        parts.append(persist_warning)
    from app.campaign_destination_url import destination_from_fields, is_likely_page_url

    has_dest = False
    for t in templates:
        fields = t.get("fields") if isinstance(t, dict) else None
        if destination_from_fields(fields if isinstance(fields, dict) else {}):
            has_dest = True
            break
        if isinstance(fields, dict) and is_likely_page_url(str(fields.get("cta_url") or "")):
            has_dest = True
            break
    if not has_dest and any(
        str(t.get("channel") or "").strip().lower() in {"email", "sms", "whatsapp", "web", "push"}
        for t in templates
        if isinstance(t, dict)
    ):
        parts.append(
            "No product/landing URL was found in knowledge or the user's request, so "
            "templates have no marketing button. Ask the user for the https link if they "
            "want a clickable CTA."
        )
    return "\n\n".join(parts)


async def handle_create_templates(
    session_id: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    existing = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    if existing:
        have = {
            _normalize_agent_channel(t.get("channel"))
            for t in existing
            if _normalize_agent_channel(t.get("channel"))
        }
        requested = _normalize_channels_arg(args.get("channels")) or _dedupe_channels(
            list(session.get("channels") or [])
        )
        missing = [ch for ch in requested if ch not in have]
        if not missing:
            return {
                "ok": False,
                "error": "templates_already_exist",
                "channels": sorted(have),
                "user_message": (
                    "<p>Your templates are already on the panel.</p>"
                    "<p>Say <b>launch now</b> when you want to send.</p>"
                ),
                "message": (
                    "Templates already exist for every selected channel. "
                    "If the user wants to send, call launch_campaign "
                    "(confirmed=true, schedule_mode=now unless they named a time). "
                    "Use mode=regenerate on build_campaign only if they asked to redo templates."
                ),
            }
        # Adding a channel to a campaign that already has cards: build only the
        # new channels and keep the existing ones untouched.
        session["channels"] = _dedupe_channels(
            list(session.get("channels") or []) + missing
        )
        await save_session(session)
        return await _generate_and_persist_templates(
            session_id,
            {**args, "channels": missing},
            channels_override=missing,
            require_confirm=False,
            event_callback=event_callback,
        )
    return await _generate_and_persist_templates(
        session_id,
        args,
        require_confirm=True,
        event_callback=event_callback,
    )


async def handle_regenerate_templates(
    session_id: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    if not (
        session.get("templates")
        or session.get("confirmed_create_templates")
        or session.get("clone_mode")
    ):
        return {
            "ok": False,
            "error": "No templates yet. Confirm and create templates first.",
        }
    channels = args.get("channels") or None
    return await _generate_and_persist_templates(
        session_id,
        args,
        channels_override=list(channels) if channels else None,
        require_confirm=False,
        event_callback=event_callback,
    )


async def handle_set_email_ab(
    session_id: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    enabled = bool(args.get("enabled"))
    channels = [
        str(c).strip().lower()
        for c in (session.get("channels") or [])
        if str(c).strip()
    ]
    if enabled and "email" not in channels:
        return {
            "ok": False,
            "error": (
                "A/B testing needs a measurable outcome (open/click rate). "
                "Only email supports that today. Add email to channels, or launch without A/B."
            ),
            "suggested_channel": "email",
        }
    prior = session.get("launch_plan") if isinstance(session.get("launch_plan"), dict) else {}
    ab_fields = _ab_split_from_args(args, enabled=enabled)
    plan = {**prior, **ab_fields}
    session["launch_plan"] = plan
    session["last_action"] = "set_email_ab"
    await save_session(session)
    needs_variants = enabled and bool(session.get("templates")) and not _email_template_has_ab_variants(
        session
    )
    regenerated = False
    regenerate_result: dict[str, Any] | None = None
    if needs_variants:
        regenerate_result = await handle_regenerate_templates(
            session_id,
            {
                **dict(args or {}),
                "channels": ["email"],
                "change_summary": str(
                    args.get("change_summary") or "Regenerate email with A/B variants"
                ),
            },
            event_callback=event_callback,
        )
        regenerated = bool(regenerate_result.get("ok"))
        session = await get_or_create_session(session_id)
        needs_variants = enabled and not _email_template_has_ab_variants(session)

    note = args.get("change_summary") or (
        plan.get("ab_note") if enabled else "Email A/B disabled."
    )
    if regenerated:
        note = f"{note} Email card regenerated with Variant A and B."
    elif needs_variants:
        note = (
            f"{note} Could not auto-regenerate email variants — "
            "ask the user to regenerate the email template."
        )
    ab_facts = _email_ab_card_facts(
        list(session.get("templates") or []) if isinstance(session.get("templates"), list) else []
    )
    if enabled and ab_facts:
        sub_a = ab_facts.get("variant_a_subject")
        sub_b = ab_facts.get("variant_b_subject")
        if sub_a or sub_b:
            note = (
                f"{note} ONE email A/B card. "
                f"Variant A subject: {sub_a or '(see card)'}. "
                f"Variant B subject: {sub_b or '(see card)'}. "
                "Reply using ONLY these subjects — never invent different ones."
            )
        else:
            note = (
                f"{note} ONE email A/B card (not two templates). "
                "Subjects are on the card — do not invent them."
            )
    elif enabled:
        note = (
            f"{note} Email A/B means ONE card with variant_a and variant_b "
            "(not two separate templates)."
        )

    return {
        "ok": True,
        "ab_enabled": enabled,
        "launch_plan": plan,
        "needs_email_variants": needs_variants,
        "email_variants_regenerated": regenerated,
        "email_ab": ab_facts,
        "regenerate_result": regenerate_result if regenerate_result is not None else None,
        "message": note,
        "hint": (
            "Regenerate the email template so this campaign has one email card with variant A and B."
            if needs_variants
            else None
        ),
        "ui_event": {
            "type": "email_ab",
            "payload": {
                "ab_enabled": enabled,
                "launch_plan": plan,
                "needs_email_variants": needs_variants,
                "email_variants_regenerated": regenerated,
                "email_ab": ab_facts,
            },
        },
    }


def _session_for_launch_readiness(
    session: dict[str, Any], args: dict[str, Any]
) -> dict[str, Any]:
    """Apply launch_channels from this tool call before readiness checks."""
    from app.agents.create_campaign.channels import normalize_channels

    raw = args.get("launch_channels")
    if raw is None:
        return session
    if isinstance(raw, str):
        raw = [raw]
    planned = normalize_channels(raw if isinstance(raw, list) else [])
    if not planned:
        return session
    plan = dict(session.get("launch_plan") if isinstance(session.get("launch_plan"), dict) else {})
    plan["launch_channels"] = planned
    return {**session, "launch_plan": plan}


async def handle_set_launch_plan(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    from app.industry_packs.loader import is_b2c_profile

    session = await get_or_create_session(session_id)
    ready_session = _session_for_launch_readiness(session, args)
    ready_err = launch_readiness_message(ready_session)
    if ready_err:
        from app.agents.create_campaign.launch_guard import launch_readiness_user_html

        user_html = launch_readiness_user_html(ready_session) or (
            "<p>We can't launch yet — some setup is still missing.</p>"
        )
        return {
            "ok": False,
            "error": "launch_not_ready",
            "message": ready_err,
            "user_message": user_html,
        }
    b2c = is_b2c_profile(session.get("campaign_profile"))
    if not (session.get("templates") or []):
        return {
            "ok": False,
            "error": "Create templates before setting a launch plan.",
        }

    user_text = str(args.get("user_text") or "").strip() or _last_user_text(session)

    raw_launch = args.get("launch_channels") or []
    # LLM sometimes sends a bare string "email" — iterating that yields e,m,a,i,l.
    if isinstance(raw_launch, str):
        raw_launch = [raw_launch]
    elif not isinstance(raw_launch, list):
        raw_launch = [raw_launch]
    known = {"email", "sms", "whatsapp", "push", "web", "ppc"}
    # Recover char-split lists: ["e","m","a","i","l"] → ["email"]
    if (
        len(raw_launch) > 1
        and all(isinstance(c, str) and len(c.strip()) == 1 for c in raw_launch)
    ):
        joined = "".join(str(c).strip() for c in raw_launch).lower()
        joined = _normalize_agent_channel(joined)
        if joined in known:
            raw_launch = [joined]
    launch_channels: list[str] = []
    for c in raw_launch:
        key = _normalize_agent_channel(c)
        if key in known and key not in launch_channels:
            launch_channels.append(key)
    if not launch_channels and isinstance(args.get("launch_channels"), str):
        one = _normalize_agent_channel(args.get("launch_channels"))
        if one in known:
            launch_channels = [one]
    if not launch_channels:
        return {"ok": False, "error": "launch_channels required."}

    from app.agents.create_campaign.channels import reconcile_launch_channels

    launch_channels, push_swap_note = reconcile_launch_channels(
        launch_channels,
        session.get("channels") or [],
    )
    if not launch_channels:
        return {"ok": False, "error": "launch_channels required."}

    timezone_name = _normalize_tz(args.get("timezone"))
    launch_local_date = str(args.get("launch_local_date") or "").strip() or None
    launch_local_time = str(args.get("launch_local_time") or "").strip() or None
    scheduled_at = str(args.get("scheduled_at") or "").strip() or None
    schedule_mode = _coerce_schedule_mode(
        args.get("schedule_mode"),
        launch_local_date=launch_local_date,
        launch_local_time=launch_local_time,
        scheduled_at=scheduled_at,
    )

    insight = (
        None
        if b2c
        else await _fetch_send_time_insight(token, timezone_name=timezone_name)
    )
    peak = _peak_kwargs_from_insight(insight)
    explicit_time = bool(launch_local_date or launch_local_time or scheduled_at)
    window = resolve_send_window(
        timezone_name=timezone_name,
        local_date=None if schedule_mode == "now" else launch_local_date,
        local_time=None if schedule_mode == "now" else launch_local_time,
        scheduled_at=None if schedule_mode == "now" else scheduled_at,
        prefer_now=schedule_mode == "now",
        honor_explicit=True,
        peak_weekday=peak.get("peak_weekday"),
        peak_hour=peak.get("peak_hour"),
        use_peak_when_unspecified=(
            schedule_mode != "now" and not explicit_time and not b2c
        ),
        consumer_hours=b2c,
        user_text=user_text,
    )
    timezone_name = window.timezone
    launch_local_date = window.local_date
    launch_local_time = window.local_time
    scheduled_at = window.scheduled_at_utc
    schedule_adjusted = window.adjusted
    schedule_reason = window.reason
    timing_label = window.timing_label

    ab_enabled = bool(args.get("ab_enabled"))
    contact_ids = await load_audience_ids(session_id, token=token)
    audience_count = len(contact_ids) or int(
        (session.get("audience") or {}).get("matched_count") or 0
    )
    if audience_count <= 0:
        return {
            "ok": False,
            "error": (
                "No contacts on this campaign. Add people in Audience "
                "(or name emails here so they can be filtered), then set a launch time."
            ),
        }
    ab_fields = _ab_split_from_args(args, enabled=ab_enabled)

    plan = {
        "schedule_mode": schedule_mode,
        "scheduled_at": scheduled_at,
        "timezone": timezone_name,
        "launch_local_date": launch_local_date,
        "launch_local_time": launch_local_time,
        "timing_label": timing_label,
        "schedule_adjusted": schedule_adjusted,
        "schedule_reason": schedule_reason,
        "launch_channels": launch_channels,
        "primary_channel": (
            _normalize_agent_channel(args.get("primary_channel")) or None
            if args.get("primary_channel")
            else None
        ),
        "orchestration_mode": (
            str(args.get("orchestration_mode") or "").strip().lower() or None
        ),
        **ab_fields,
    }
    pc = plan.get("primary_channel")
    if pc and launch_channels and pc not in launch_channels:
        plan["primary_channel"] = launch_channels[0]
    # Preserve prior personalization unless SET_LAUNCH_PLAN overrides.
    prior_plan = session.get("launch_plan") or {}
    prior_pers = (
        prior_plan.get("personalization")
        if isinstance(prior_plan, dict)
        else None
    )
    mode_arg = str(args.get("personalization_mode") or "").strip().lower()
    if mode_arg in ("dynamic_offer", "none"):
        plan["personalization"] = {
            "mode": mode_arg,
            "adapter": (
                (prior_pers or {}).get("adapter")
                if isinstance(prior_pers, dict)
                else None
            ),
        }
    elif isinstance(prior_pers, dict) and prior_pers.get("mode"):
        plan["personalization"] = {
            "mode": prior_pers.get("mode") or "none",
            "adapter": prior_pers.get("adapter"),
        }
    if plan["orchestration_mode"] not in (
        None,
        "broadcast",
        "prefer_primary",
        "staggered",
    ):
        plan["orchestration_mode"] = None
    if ab_enabled and "email" not in launch_channels:
        return {
            "ok": False,
            "error": "Email A/B requires email in launch_channels.",
        }

    soft_warnings: list[str] = list(
        (session.get("audience") or {}).get("soft_warnings") or []
    )
    insights_ok = False
    fresh_insights: list[str] = []
    try:
        insights = await _call_audience_insights(token, contact_ids)
        fresh_insights = _soft_audience_warnings(insights)
        insights_ok = True
        aud = session.setdefault("audience", {})
        aud["consent"] = insights.get("consent") or aud.get("consent")
        aud["quality"] = insights.get("quality") or aud.get("quality")
    except Exception:  # noqa: BLE001
        pass
    soft_warnings = _merge_soft_warnings(
        fresh=fresh_insights,
        cached=soft_warnings,
        insights_ok=insights_ok,
    )
    try:
        templates = list(session.get("templates") or [])
        template_channels = [
            str(t.get("channel") or "").strip().lower()
            for t in templates
            if str(t.get("channel") or "").strip()
        ]
        design_body = await _call_design_check(
            token,
            channels=launch_channels or list(session.get("channels") or []),
            contact_ids=contact_ids,
            template_channels=template_channels,
        )
        design = design_body.get("design") or {}
        for w in design.get("warnings") or []:
            note = w.strip() if isinstance(w, str) else ""
            if not note or note in soft_warnings:
                continue
            if insights_ok and _is_consent_soft_warning(note):
                continue
            soft_warnings.append(note)
        session["design_check"] = design
    except Exception:  # noqa: BLE001
        pass
    try:
        broadcast_confirmed = bool(args.get("broadcast_confirmed"))
        orch_channels = list(session.get("channels") or launch_channels)
        orch_body = await _call_orchestration_check(
            token,
            channels=orch_channels or launch_channels,
            primary_channel=plan.get("primary_channel"),
            orchestration_mode=plan.get("orchestration_mode") or "prefer_primary",
            audience_count=audience_count,
            broadcast_confirmed=broadcast_confirmed,
        )
        orch = orch_body.get("orchestration") or {}
        session["orchestration_check"] = orch
        plan = _apply_send_strategy_to_plan(
            plan,
            orch,
            broadcast_confirmed=broadcast_confirmed,
        )
        session["send_strategy"] = plan.get("send_strategy")
        for w in list(orch.get("warnings") or []) + list(orch.get("notes") or []):
            if isinstance(w, str) and w.strip() and w.strip() not in soft_warnings:
                soft_warnings.append(w.strip())
        strategy = plan.get("send_strategy") if isinstance(plan.get("send_strategy"), dict) else {}
        if strategy.get("requires_broadcast_confirm") and not broadcast_confirmed:
            soft_warnings.append(
                "Broadcast not confirmed — T0 limited to primary channel. "
                "Pass broadcast_confirmed=true only if the user explicitly wants every channel at once."
            )
    except Exception:  # noqa: BLE001
        # Offline fallback: still prefer primary at T0.
        if not plan.get("orchestration_mode"):
            plan["orchestration_mode"] = "prefer_primary"
        if not plan.get("primary_channel") and launch_channels:
            priority = ["email", "whatsapp", "sms", "push", "web"]
            plan["primary_channel"] = next(
                (c for c in priority if c in launch_channels),
                launch_channels[0],
            )
        if plan.get("orchestration_mode") in ("prefer_primary", "staggered") and plan.get(
            "primary_channel"
        ):
            plan["launch_channels"] = [plan["primary_channel"]]
    aud = session.setdefault("audience", {})
    aud["soft_warnings"] = soft_warnings

    session["launch_plan"] = plan
    session["stage"] = "launch_plan"
    await save_session(session)

    msg = args.get("change_summary") or "Launch plan updated"
    if _change_summary_claims_send(str(msg)):
        msg = (
            "Launch plan saved. The campaign is still a draft until you confirm launch."
        )
    if schedule_adjusted:
        msg += (
            f" Send time note: {timing_label} "
            f"({timezone_name}) — {schedule_reason}."
        )
    elif not window.within_business_hours:
        msg += f" {schedule_reason}."
    if soft_warnings:
        msg += " Soft design/audience/orchestration notes (launch not blocked): " + " ".join(
            soft_warnings[:6]
        )
        if len(soft_warnings) > 6:
            msg += f" (+{len(soft_warnings) - 6} more)"

    strategy_obj = (
        plan.get("send_strategy") if isinstance(plan.get("send_strategy"), dict) else None
    )
    if isinstance(strategy_obj, dict) and plan.get("orchestration_mode"):
        strategy_obj["mode"] = plan.get("orchestration_mode")
    strategy_facts = send_strategy_facts_for_llm(strategy_obj)
    show_send_strategy = bool(strategy_facts.get("multi_channel"))
    if push_swap_note:
        msg += " " + push_swap_note
    if show_send_strategy:
        msg += (
            " Explain the send plan in your own words before final launch confirm "
            f"(launch_channels={plan.get('launch_channels')}). No template blocks."
        )

    return {
        "ok": True,
        "launch_plan": plan,
        "send_strategy_facts": strategy_facts,
        "show_send_strategy": show_send_strategy,
        "schedule_adjusted": schedule_adjusted,
        "schedule_reason": schedule_reason,
        "timing_label": timing_label,
        "soft_warnings": soft_warnings,
        "message": msg,
        "ui_event": {
            "type": "launch_plan",
            "payload": {**plan, "soft_warnings": soft_warnings},
        },
    }


async def handle_plan_dynamic_fields(
    session_id: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Enable/disable dynamic_offer personalization on the session launch_plan."""
    session = await get_or_create_session(session_id)
    enabled = bool(args.get("enabled"))
    mode = "dynamic_offer" if enabled else "none"
    channels_raw = args.get("channels") or list(session.get("channels") or [])
    if isinstance(channels_raw, str):
        channels_raw = [channels_raw]
    channels = _dedupe_channels(list(channels_raw) if channels_raw else [])
    suggested = [
        str(t).strip().lower()
        for t in (args.get("suggested_tags") or [])
        if str(t).strip()
    ]
    if enabled and not suggested:
        suggested = [
            "first_name",
            "product_name",
            "product_url",
            "campaign_url",
            "product_price",
        ]

    personalization = {"mode": mode, "adapter": None}
    plan = dict(session.get("launch_plan") or {})
    plan["personalization"] = personalization
    session["launch_plan"] = plan
    session["personalization"] = {
        **personalization,
        "channels": channels,
        "suggested_tags": suggested,
        "available_tags": list(AVAILABLE_DYNAMIC_TAGS),
    }
    await save_session(session)

    msg = args.get("change_summary") or (
        "Dynamic product offers enabled"
        if enabled
        else "Dynamic product offers disabled"
    )
    if enabled:
        msg += (
            " Available tags: "
            + ", ".join(f"{{{{{t}}}}}" for t in AVAILABLE_DYNAMIC_TAGS)
            + ". Prefer email/push for product_* tags; WhatsApp only fills "
            "placeholders already on the approved Meta template. "
            "Call PREVIEW_DYNAMIC_SEND to sample different products per contact. "
            "Do not create recommendation-board cards for these products."
        )

    return {
        "ok": True,
        "personalization": session["personalization"],
        "launch_plan": plan,
        "available_tags": AVAILABLE_DYNAMIC_TAGS,
        "suggested_tags": suggested,
        "message": msg,
        "ui_event": {
            "type": "personalization_plan",
            "payload": {
                "mode": mode,
                "channels": channels,
                "suggested_tags": suggested,
                "available_tags": AVAILABLE_DYNAMIC_TAGS,
            },
        },
    }


async def handle_preview_dynamic_send(
    session_id: str,
    token: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    use_audience = args.get("use_audience")
    if use_audience is None:
        use_audience = True
    sample_size = int(args.get("sample_size") or 5)
    sample_size = max(1, min(sample_size, 20))

    contact_ids: list[str] = []
    if use_audience:
        contact_ids = (await load_audience_ids(session_id))[:sample_size]

    pers = session.get("personalization") or {}
    plan_pers = (session.get("launch_plan") or {}).get("personalization") or {}
    mode = (
        (pers.get("mode") if isinstance(pers, dict) else None)
        or (plan_pers.get("mode") if isinstance(plan_pers, dict) else None)
        or "none"
    )
    # Preview always samples adapter offers so the agent can show variety;
    # launch still respects launch_plan.personalization.mode.
    try:
        body = await _call_personalization_preview(
            token,
            contact_ids=contact_ids or None,
            sample_size=sample_size,
            dynamic_offer=True,
            subject=str(args.get("subject") or "").strip() or None,
            html=str(args.get("html") or "").strip() or None,
            body=str(args.get("body") or "").strip() or None,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"Personalization preview API failed: {exc}",
            "message": (
                "Could not preview dynamic send. Check backend is up and "
                "PERSONALIZATION_ADAPTER is set."
            ),
        }

    samples = list(body.get("samples") or [])
    distinct = list(body.get("distinct_products") or [])
    # Compact rows for the LLM (avoid dumping huge merge maps).
    compact = []
    for row in samples[:sample_size]:
        if not isinstance(row, dict):
            continue
        compact.append(
            {
                "contact_id": row.get("contact_id"),
                "first_name": (row.get("merge_map") or {}).get("first_name"),
                "product_name": row.get("product_name"),
                "product_url": row.get("product_url"),
                "product_price": (row.get("merge_map") or {}).get("product_price"),
                "campaign_url": row.get("campaign_url"),
                "rendered": row.get("rendered"),
            }
        )

    msg = args.get("change_summary") or "Dynamic send preview ready"
    if mode != "dynamic_offer":
        msg += (
            " Note: dynamic_offer is not enabled on launch_plan yet — "
            "call PLAN_DYNAMIC_FIELDS(enabled=true) before launch to apply at send time."
        )
    msg += (
        f" Sampled {len(compact)} contacts; "
        f"{body.get('distinct_product_count') or len(distinct)} distinct products"
        + (f" ({', '.join(distinct[:6])})" if distinct else "")
        + ". Summarize in chat only — do not create recommendation-board cards."
    )

    return {
        "ok": True,
        "adapter": body.get("adapter"),
        "dynamic_offer": body.get("dynamic_offer"),
        "sample_count": len(compact),
        "distinct_product_count": body.get("distinct_product_count") or len(distinct),
        "distinct_products": distinct,
        "samples": compact,
        "available_tags": body.get("available_tags") or AVAILABLE_DYNAMIC_TAGS,
        "message": msg,
    }


async def _ensure_frozen_contact_ids(
    session_id: str,
    session: dict[str, Any],
    token: str,
) -> list[str]:
    """Return persisted audience ids. If refs are empty, re-run filters and save.

    CRM/GEM all-contacts lists include opaque CDP ids. A failed PUT used to leave
    matched_count>0 with zero frozen ids, and launch then queued nothing.
    """
    ids = await load_audience_ids(session_id, token=token)
    if ids:
        return ids
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    filters = aud.get("filters") if isinstance(aud.get("filters"), dict) else {}
    matched = int(aud.get("matched_count") or 0)
    if matched <= 0 and not filters:
        return []
    try:
        body = await _call_filter_api(
            token,
            filters,
            campaign_profile=session.get("campaign_profile"),
        )
        ids = [
            str(cid).strip()
            for cid in (body.get("contact_ids") or [])
            if str(cid).strip()
        ]
    except Exception as exc:  # noqa: BLE001
        logger.warning("re-filter audience for launch failed: %s", exc)
        return []
    if not ids:
        return []
    try:
        await save_audience_ids(session_id, ids, token=token)
    except Exception as exc:  # noqa: BLE001
        # from-session still receives contact_ids on the launch payload.
        logger.warning("save_audience_ids during launch failed: %s", exc)
    aud["matched_count"] = len(ids)
    session["audience"] = aud
    return ids


def _whatsapp_config_launch_retry_allowed(session: dict[str, Any]) -> bool:
    """Allow one more confirm when WhatsApp failed due to channel config / CCaaS setup."""
    from app.agents.create_campaign.channels import normalize_channels

    channels = normalize_channels(session.get("channels") or [])
    if "whatsapp" not in channels:
        return False
    warnings = session.get("soft_warnings") or []
    if not isinstance(warnings, list):
        return False
    needles = (
        "configuration",
        "channelconfigid",
        "not connected",
        "whatsapp ccaa",
        "internal service key",
        "not configured",
        "channel configuration",
    )
    for w in warnings:
        text = str(w).lower()
        if "whatsapp" not in text:
            continue
        if any(n in text for n in needles):
            return True
    return False


def _launch_outcomes(session: dict[str, Any]) -> dict[str, Any]:
    raw = session.get("launch_outcomes")
    return raw if isinstance(raw, dict) else {}


def _email_launch_retry_allowed(session: dict[str, Any]) -> bool:
    """Re-confirm when email was selected but never queued (suppression, mailbox, plan error)."""
    from app.agents.create_campaign.channels import normalize_channels

    channels = normalize_channels(session.get("channels") or [])
    if "email" not in channels:
        return False
    outcomes = _launch_outcomes(session)
    if outcomes.get("email_queued") is False:
        return True
    email_line = str(outcomes.get("email") or "").lower()
    if email_line and ("not queued" in email_line or "failed" in email_line):
        return True
    needles = (
        "suppression",
        "eligible recipient",
        "not queued",
        "mailbox",
        "no_destinations",
        "email was not queued",
        "send planning failed",
    )
    for w in session.get("soft_warnings") or []:
        text = str(w).lower()
        if any(n in text for n in needles):
            return True
    warn = str(session.get("last_email_send_warning") or "").strip().lower()
    return bool(warn) and any(n in warn for n in needles)


def _launch_retry_allowed(session: dict[str, Any]) -> bool:
    """Allow another launch_campaign(confirm) after a failed or partial channel plan."""
    if not session.get("launch_confirmed"):
        return False
    if _whatsapp_config_launch_retry_allowed(session):
        return True
    if _email_launch_retry_allowed(session):
        return True
    outcomes = _launch_outcomes(session)
    if outcomes.get("push_queued") is False:
        from app.agents.create_campaign.channels import normalize_channels

        ch = normalize_channels(session.get("channels") or [])
        if "push" in ch or "web" in ch:
            return True
    return False


def _already_launched_reply(session: dict[str, Any]) -> dict[str, Any] | None:
    """Refuse a second confirm on a live/scheduled campaign (same session)."""
    if not session.get("launch_confirmed"):
        return None
    campaign_id = str(session.get("campaign_id") or "").strip()
    if not campaign_id:
        return None
    stage = str(session.get("stage") or "").strip().lower()
    if stage not in {"live", "scheduled", "launched", "completed"}:
        return None
    return {
        "ok": True,
        "confirmed": True,
        "already_launched": True,
        "campaign_id": campaign_id,
        "message": (
            "This campaign is already launched. The same app-push message "
            "will not be queued again."
        ),
        "user_message": (
            "<p>This campaign is already live. I did not send the same "
            "app push again.</p>"
        ),
    }


async def handle_confirm_launch(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token)
    if session.get("whatsapp_approved_run"):
        from app.agents.whatsapp_approved.launch_helpers import (
            persist_approved_whatsapp_templates_for_launch,
        )

        session, tpl_err = await persist_approved_whatsapp_templates_for_launch(
            session_id, token, session
        )
        if tpl_err:
            return {
                "ok": False,
                "error": "launch_not_ready",
                "message": f"WA_TEMPLATE_PERSIST: {tpl_err}",
                "user_message": (
                    f"<p>Could not prepare the approved WhatsApp template for launch. "
                    f"{tpl_err}</p>"
                ),
            }
        await save_session(session, token=token)
        session = await get_or_create_session(session_id, token=token)
    session = await _hydrate_session_templates_from_db(
        session, session_id, append_unknown=True
    )
    session = await _persist_canonical_email_templates(session, token=token)
    confirmed = bool(args.get("confirmed"))
    if not confirmed:
        return {
            "ok": True,
            "confirmed": False,
            "message": (
                "Launch not confirmed yet. The campaign is still a draft. "
                "Say launch clearly so I can save it."
            ),
        }

    already = _already_launched_reply(session)
    if already and _launch_retry_allowed(session):
        already = None
    if already:
        return already

    ready_err = launch_readiness_message(session)
    if ready_err:
        from app.agents.create_campaign.launch_guard import launch_readiness_user_html

        return {
            "ok": False,
            "error": "launch_not_ready",
            "message": ready_err,
            "user_message": launch_readiness_user_html(session)
            or "<p>We can't launch yet — some setup is still missing.</p>",
        }

    plan = session.get("launch_plan")
    if not plan:
        ready_err = launch_readiness_message(session)
        if not ready_err and confirmed:
            channels = normalize_channels(session.get("channels") or [])
            auto_plan = await handle_set_launch_plan(
                session_id,
                token,
                {
                    "launch_channels": channels,
                    "schedule_mode": "now",
                    "change_summary": "Auto launch plan from confirm",
                    "user_text": str(args.get("user_text") or "").strip()
                    or _last_user_text(session),
                },
            )
            if auto_plan.get("ok", True):
                session = await get_or_create_session(session_id)
                plan = session.get("launch_plan")
        if not plan:
            return {
                "ok": False,
                "error": "Call SET_LAUNCH_PLAN before CONFIRM_LAUNCH.",
                "message": (
                    "Launch plan is missing. Call launch_campaign to set timing, "
                    "then confirm send."
                ),
                "user_message": (
                    "<p>Launch plan is not set yet. Say <b>launch now</b> to continue.</p>"
                ),
            }

    plan = dict(plan)
    mode = _coerce_schedule_mode(
        plan.get("schedule_mode"),
        launch_local_date=plan.get("launch_local_date"),
        launch_local_time=plan.get("launch_local_time"),
        scheduled_at=plan.get("scheduled_at"),
    )
    from app.industry_packs.loader import is_b2c_profile

    user_text = str(args.get("user_text") or "").strip() or _last_user_text(session)

    window = resolve_send_window(
        timezone_name=plan.get("timezone") or DEFAULT_LAUNCH_TZ,
        local_date=None if mode == "now" else plan.get("launch_local_date"),
        local_time=None if mode == "now" else plan.get("launch_local_time"),
        scheduled_at=None if mode == "now" else plan.get("scheduled_at"),
        prefer_now=mode == "now",
        honor_explicit=True,
        consumer_hours=is_b2c_profile(session.get("campaign_profile")),
        user_text=user_text,
    )
    plan["schedule_mode"] = mode
    plan["timezone"] = window.timezone
    plan["launch_local_date"] = window.local_date
    plan["launch_local_time"] = window.local_time
    plan["scheduled_at"] = window.scheduled_at_utc
    plan["timing_label"] = window.timing_label
    plan["schedule_reason"] = window.reason
    plan["schedule_adjusted"] = bool(window.adjusted)
    # Approved-template runs: long-lead schedules use 30m poll worker; near-term
    # (e.g. +5 min) use the normal WhatsApp worker when scheduledFor is due.
    if session.get("whatsapp_approved_run") and mode != "now":
        use_poll = True
        sched_raw = plan.get("scheduled_at")
        if sched_raw:
            try:
                sched_s = str(sched_raw).strip().replace("Z", "+00:00")
                sched_dt = datetime.fromisoformat(sched_s)
                if sched_dt.tzinfo is None:
                    sched_dt = sched_dt.replace(tzinfo=timezone.utc)
                lead = sched_dt - datetime.now(timezone.utc)
                if lead <= timedelta(hours=1):
                    use_poll = False
            except (TypeError, ValueError):
                pass
        plan["approved_template_poll_30m"] = use_poll
    session["launch_plan"] = plan
    await save_session(session, token=token)

    if session.get("whatsapp_approved_run"):
        from app.agents.whatsapp_approved.launch_helpers import (
            ensure_approved_audience_frozen,
        )

        session = await get_or_create_session(session_id)
        ok_frozen, freeze_err = await ensure_approved_audience_frozen(
            session_id, token, session
        )
        if not ok_frozen:
            from app.agents.create_campaign.launch_guard import launch_readiness_user_html

            plain = freeze_err or "Audience is not ready to launch."
            return {
                "ok": False,
                "error": "launch_not_ready",
                "message": f"LAUNCH_AUDIENCE_NOT_FROZEN: {plain}",
                "user_message": launch_readiness_user_html(session)
                or f"<p>{plain}</p>",
            }
        session["audience_launch_ready"] = True
        await save_session(session, token=token)
        session = await get_or_create_session(session_id)

    contact_ids = await _ensure_frozen_contact_ids(session_id, session, token)
    if not contact_ids:
        return {
            "ok": False,
            "error": (
                "No contacts on this campaign. Add people in Audience "
                "(or name emails here so they can be filtered), then launch again."
            ),
        }

    soft_warnings: list[str] = list(
        (session.get("audience") or {}).get("soft_warnings") or []
    )
    insights_ok = False
    fresh_insights: list[str] = []
    try:
        insights = await _call_audience_insights(token, contact_ids)
        fresh_insights = _soft_audience_warnings(insights)
        insights_ok = True
        aud = session.setdefault("audience", {})
        aud["consent"] = insights.get("consent") or aud.get("consent")
        aud["quality"] = insights.get("quality") or aud.get("quality")
    except Exception:  # noqa: BLE001
        pass
    soft_warnings = _merge_soft_warnings(
        fresh=fresh_insights,
        cached=soft_warnings,
        insights_ok=insights_ok,
    )
    aud = session.setdefault("audience", {})
    aud["soft_warnings"] = soft_warnings

    campaign = session.get("campaign") or {}
    audience = session.get("audience") or {}
    plans = list(session.get("channel_plans") or [])
    plan_by_channel = {
        _normalize_agent_channel(p.get("channel")): p
        for p in plans
        if p.get("channel")
    }
    template_by_channel = {
        _normalize_agent_channel(ch): row
        for ch, row in best_template_by_channel(
            list(session.get("templates") or [])
        ).items()
    }

    # Always persist EVERY selected launch channel (email + push, etc.).
    # Previously we only iterated templates, so push was dropped when email
    # already had a template and the empty-list fallback never ran.
    raw_launch = list(plan.get("launch_channels") or [])
    launch_channels: list[str] = []
    for ch in raw_launch:
        key = _normalize_agent_channel(ch)
        if key and key not in launch_channels:
            launch_channels.append(key)
    if not launch_channels:
        launch_channels = [
            ch
            for ch in template_by_channel
            if template_ready_for_launch(ch, template_by_channel[ch])
        ]

    ready_launch: list[str] = []
    for ch in launch_channels:
        row = template_by_channel.get(ch)
        if row and template_ready_for_launch(ch, row):
            ready_launch.append(ch)
    if not ready_launch:
        return {
            "ok": False,
            "error": "launch_not_ready",
            "message": (
                "No renderable template for the selected launch channels. "
                "Regenerate templates or narrow launch_channels."
            ),
            "user_message": (
                "<p>No send-ready template was found for those channels. "
                "Generate or fix templates, or launch email only with "
                "<b>launch_channels: [email]</b>.</p>"
            ),
        }
    launch_channels = ready_launch

    campaign_channels: list[dict[str, Any]] = []
    for ch in launch_channels:
        t = template_by_channel.get(ch) or {}
        p = plan_by_channel.get(ch) or {}
        template_id = t.get("template_id")
        campaign_channels.append(
            {
                "channel": ch,
                "template_id": template_id,
                "how_it_works": t.get("how_it_works") or p.get("how_it_works"),
                "planned_launch_at": plan.get("scheduled_at")
                or t.get("launch_at")
                or p.get("suggested_launch_at"),
                "status": "ready" if mode == "now" else "scheduled",
            }
        )

    plan = {**plan, "launch_channels": launch_channels, "schedule_mode": mode}
    session["launch_plan"] = plan

    from app.integrations.email_launch_transport import email_channel_mailbox_block

    mailbox_block = await email_channel_mailbox_block(
        channels=launch_channels, token=token
    )
    if mailbox_block:
        return mailbox_block

    campaign_status = "live" if mode == "now" else "scheduled"
    starts_at = plan.get("scheduled_at") or datetime.now(timezone.utc).isoformat()

    try:
        saved = await save_campaign_from_session(
            session_id,
            {
                "name": campaign.get("name"),
                "goal": campaign.get("goal"),
                "objective": campaign.get("objective"),
                "audience_summary": audience.get("description")
                or audience.get("summary"),
                "audience_filters": audience.get("filters") or {},
                "audience_count": len(contact_ids),
                "contact_ids": contact_ids,
                "channels": campaign_channels,
                "status": campaign_status,
                "launch_plan": plan,
                "starts_at": starts_at,
                "timezone": plan.get("timezone") or DEFAULT_LAUNCH_TZ,
                "launch_local_date": plan.get("launch_local_date"),
                "launch_local_time": plan.get("launch_local_time"),
            },
            token=token,
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Failed to launch campaign: {exc}"}

    campaign_id = (
        (saved.get("campaign") or {}).get("id")
        or saved.get("id")
    )
    session["campaign_id"] = campaign_id

    email_warn = _sanitize_launch_note(saved.get("email_send_warning"))
    push_warn = _sanitize_launch_note(saved.get("push_send_warning"))
    wa_warn = _sanitize_launch_note(saved.get("whatsapp_send_warning"))
    for note in (email_warn, push_warn, wa_warn):
        if note and note not in soft_warnings:
            soft_warnings.append(note)

    email_plan = saved.get("email_send_plan")
    email_queued = False
    if isinstance(email_plan, dict):
        email_queued = bool(email_plan.get("scheduled")) or str(
            email_plan.get("reason") or ""
        ).strip().lower() in ("already_planned",)
    if "email" in launch_channels and not email_queued and not email_warn:
        reason = (
            str(email_plan.get("reason") or "").strip()
            if isinstance(email_plan, dict)
            else ""
        )
        email_warn = (
            "Email was not queued — send planning failed"
            + (f" ({reason})." if reason else ".")
        )
        if email_warn not in soft_warnings:
            soft_warnings.append(email_warn)

    wa_meta: dict[str, Any] = {}
    wa_plan = saved.get("whatsapp_send_plan")
    if isinstance(wa_plan, dict):
        raw_meta = wa_plan.get("whatsapp")
        if isinstance(raw_meta, dict):
            wa_meta = raw_meta
    wa_status = str(wa_meta.get("status") or "").strip().lower()

    push_plan = saved.get("push_send_plan")
    if not isinstance(push_plan, dict):
        push_plan = {}
    push_queued = saved.get("push_queued")
    if push_queued is None:
        push_queued = bool(push_plan.get("scheduled"))
        if not push_queued:
            push_queued = any(
                isinstance(p, dict)
                and (p.get("scheduled") or p.get("reason") == "already_planned")
                for p in (push_plan.get("plans") or [])
            )
    wants_push = "push" in launch_channels or "web" in launch_channels

    def _push_channel_queued(key: str) -> bool:
        for row in push_plan.get("plans") or []:
            if not isinstance(row, dict):
                continue
            ch = str(row.get("channel") or "").strip().lower()
            if ch != key:
                continue
            if row.get("scheduled") or row.get("reason") == "already_planned":
                return True
        return bool(push_queued) if wants_push and key in launch_channels else False

    timing = str(plan.get("timing_label") or "").strip()
    if not timing:
        timing = " ".join(
            p
            for p in (
                str(plan.get("launch_local_date") or "").strip(),
                str(plan.get("launch_local_time") or "").strip(),
            )
            if p
        ) or "the scheduled time"
    tz = str(plan.get("timezone") or DEFAULT_LAUNCH_TZ)
    channel_lines: list[str] = []
    if "email" in launch_channels:
        if email_queued:
            channel_lines.append(f"Email: {email_warn or 'queued.'}")
        else:
            channel_lines.append(
                f"Email: {email_warn or 'not queued — send planning failed.'}"
            )
    if "whatsapp" in launch_channels:
        if wa_warn:
            channel_lines.append(f"WhatsApp: {wa_warn}.")
        elif wa_status == "pending":
            channel_lines.append("WhatsApp: submitted to Meta (PENDING).")
        elif wa_status == "approved":
            channel_lines.append("WhatsApp: Meta APPROVED.")
        elif wa_status == "rejected":
            reason = _sanitize_launch_note(
                wa_meta.get("rejected_reason") or wa_meta.get("error") or "rejected"
            )
            channel_lines.append(f"WhatsApp: Meta REJECTED ({reason}).")
        elif wa_status:
            channel_lines.append(f"WhatsApp: Meta {wa_status.upper()}.")
        else:
            channel_lines.append("WhatsApp: queued (Meta status pending).")
    if "web" in launch_channels:
        if _push_channel_queued("web"):
            channel_lines.append(
                "Web push: queued. This is a browser notification, not email."
            )
        else:
            channel_lines.append(
                "Web push: "
                + (
                    push_warn
                    or "not queued — no browser subscription for the selected "
                    "contact (same email or phone on the website + Allow notifications)."
                )
            )
    if "push" in launch_channels:
        if _push_channel_queued("push"):
            channel_lines.append(f"App push: {push_warn or 'queued.'}")
        else:
            channel_lines.append(
                f"App push: {push_warn or 'not queued — no device token or queue failed.'}"
            )
    consent_notes = [
        _sanitize_launch_note(w)
        for w in soft_warnings
        if w not in (email_warn, push_warn, wa_warn)
    ]
    consent_notes = [n for n in consent_notes if n][:2]
    if mode == "now":
        parts = ["Launching now."]
    elif session.get("whatsapp_approved_run") and plan.get("approved_template_poll_30m"):
        parts = [
            f"Scheduled for {timing} ({tz}). "
            "The approved template is saved for the selected contacts. "
            "A check every 30 minutes starts sending when that time is reached "
            "or if that time has already passed."
        ]
    else:
        parts = [f"Scheduled for {timing} ({tz}). Sends start at that time."]
    parts.extend(channel_lines)
    if consent_notes:
        parts.append("Note: " + " ".join(consent_notes))
    base_msg = " ".join(parts)

    push_outcome = None
    if wants_push:
        push_outcome = (
            (push_warn or "queued") if push_queued else (push_warn or "not queued")
        )

    outcomes = {
        "status": campaign_status,
        "schedule_mode": mode,
        "email": (
            (email_warn or "queued")
            if ("email" in launch_channels and email_queued)
            else (
                (email_warn or "not queued")
                if "email" in launch_channels
                else None
            )
        ),
        "push": push_outcome,
        "whatsapp": wa_warn or (wa_status or None),
        "timing": timing,
        "timezone": tz,
        "push_queued": bool(push_queued) if wants_push else None,
        "email_queued": bool(email_queued) if "email" in launch_channels else None,
    }
    session["launch_outcomes"] = outcomes
    if "whatsapp" in launch_channels and wa_meta:
        session["whatsapp_approval"] = wa_meta
        from app.agents.create_campaign.memory_note import (
            upsert_whatsapp_approval_memory_note,
        )

        mem_line = str(wa_meta.get("agent_memory_line") or "").strip()
        if not mem_line:
            tpl = str(wa_meta.get("template_name") or "template").strip()
            st = str(wa_status or "pending").strip().upper()
            if st == "PENDING":
                mem_line = (
                    f'WhatsApp Meta: submitted for approval; PENDING template "{tpl}".'
                )
            else:
                mem_line = f'WhatsApp Meta: {st} template "{tpl}".'
        upsert_whatsapp_approval_memory_note(session, mem_line)

    all_channels_failed = False
    if launch_channels:
        fails: list[bool] = []
        if "email" in launch_channels:
            fails.append(not email_queued)
        if wants_push:
            fails.append(not bool(push_queued))
        if "whatsapp" in launch_channels:
            fails.append(bool(wa_warn) or wa_status == "rejected")
        all_channels_failed = bool(fails) and all(fails)

    launch_ok = not all_channels_failed
    if launch_ok:
        session["stage"] = campaign_status
        session["launch_confirmed"] = True
    else:
        session["launch_confirmed"] = False
        session["stage"] = "launch"
    if email_warn:
        session["last_email_send_warning"] = email_warn[:500]

    failure_html = ""
    if not launch_ok:
        parts_fail: list[str] = [
            "<p><b>Launch did not complete</b> — the campaign was saved but "
            "one or more channels did not queue sends.</p>"
        ]
        if email_warn and "email" in launch_channels:
            parts_fail.append(f"<p>Email: {email_warn}</p>")
        elif "email" in launch_channels and not email_queued:
            parts_fail.append(
                "<p>Email was not queued. Check audience, suppressions, and "
                "mailbox setup, then confirm send again.</p>"
            )
        if push_warn and wants_push:
            parts_fail.append(f"<p>Push: {push_warn}</p>")
        if wa_warn and "whatsapp" in launch_channels:
            parts_fail.append(f"<p>WhatsApp: {wa_warn}</p>")
        failure_html = "".join(parts_fail)

    await save_session(session, token=token)

    return {
        "ok": launch_ok,
        "confirmed": launch_ok,
        "campaign_id": campaign_id,
        "status": campaign_status if launch_ok else str(session.get("stage") or "launch"),
        "schedule_mode": mode,
        "launch_plan": plan,
        "launch_outcomes": outcomes,
        "channels_scheduled": launch_channels,
        "channel_labels": {c: _channel_user_label(c) for c in launch_channels},
        "soft_warnings": soft_warnings,
        "email_send_warning": saved.get("email_send_warning"),
        "push_send_warning": saved.get("push_send_warning"),
        "push_queued": bool(push_queued) if wants_push else None,
        "whatsapp_send_warning": wa_warn,
        "whatsapp_meta": wa_meta or None,
        "whatsapp_meta_status": wa_status or None,
        "message": base_msg if launch_ok else (email_warn or base_msg),
        "user_message": failure_html or None,
        "launch_failed": not launch_ok,
        "email_queued": bool(email_queued) if "email" in launch_channels else None,
        "ui_event": {
            "type": "campaign_scheduled" if launch_ok else "campaign_launch_failed",
            "payload": {
                "campaign_id": campaign_id,
                "status": campaign_status if launch_ok else "launch",
                "launch_confirmed": launch_ok,
                "launch_plan": plan,
                "launch_outcomes": outcomes,
                "channels_scheduled": launch_channels,
                "soft_warnings": soft_warnings,
                "push_send_warning": saved.get("push_send_warning"),
                "push_queued": bool(push_queued) if wants_push else None,
                "email_send_warning": saved.get("email_send_warning"),
                "email_queued": bool(email_queued) if "email" in launch_channels else None,
            },
        },
    }


async def handle_get_launch_status(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    campaign_id = str(
        args.get("campaign_id") or session.get("campaign_id") or ""
    ).strip()
    if not campaign_id:
        return {
            "ok": False,
            "error": (
                "This campaign is still a draft. Nothing was sent. "
                "Say launch so I can confirm and save it."
            ),
        }

    base = get_settings().campaign_api_base.rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(f"{base}/campaigns/{campaign_id}", headers=headers)
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith("application/json")
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Status lookup failed",
                }
            body = res.json() or {}
            rec_res = await client.get(
                f"{base}/campaigns/{campaign_id}/recipients",
                headers=headers,
                params={"limit": "20"},
            )
            recipients = rec_res.json() if rec_res.status_code < 400 else {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Status lookup failed: {exc}"}

    campaign = body.get("campaign") or body
    status = str(campaign.get("status") or "").strip().lower() or "unknown"
    name = str(campaign.get("name") or "this campaign").strip()
    selected = int(
        campaign.get("audienceCount")
        or campaign.get("audience_count")
        or 0
    )
    sent = int(campaign.get("sent") or 0)
    stub = int(campaign.get("stubSent") or campaign.get("stub_sent") or 0)
    failed = int(campaign.get("failed") or 0)
    rec_totals = recipients.get("totals") or {}
    if rec_totals:
        selected = int(rec_totals.get("selected") or selected)
        sent = int(rec_totals.get("sent") or sent)
        stub = int(rec_totals.get("stub") or stub)
        failed = int(rec_totals.get("failed") or failed)

    channels = list(campaign.get("channels") or [])
    channel_bits: list[str] = []
    for ch in channels:
        key = str(ch.get("channel") or "").strip().lower()
        if not key:
            continue
        ch_sent = int(ch.get("sent") or 0)
        ch_fail = int(ch.get("failed") or 0)
        ch_stub = int(ch.get("stubSent") or ch.get("stub_sent") or 0)
        paused = bool(ch.get("paused"))
        label = {"web": "web push", "push": "app push"}.get(key, key)
        bit = f"{label}: sent {ch_sent}"
        if ch_stub:
            bit += f", stub {ch_stub}"
        if ch_fail:
            bit += f", failed {ch_fail}"
        if paused:
            bit += ", paused"
        channel_bits.append(bit)

    prior = session.get("launch_outcomes") or {}
    if isinstance(prior, dict):
        if prior.get("push") and "fail" in str(prior.get("push")).lower():
            channel_bits.append(f"push queue: {prior.get('push')}")
        if prior.get("email") and "fail" in str(prior.get("email")).lower():
            channel_bits.append(f"email queue: {prior.get('email')}")
        if prior.get("whatsapp") and str(prior.get("whatsapp")).lower() not in (
            "approved",
            "pending",
            "",
        ):
            if "fail" in str(prior.get("whatsapp")).lower() or "reject" in str(
                prior.get("whatsapp")
            ).lower():
                channel_bits.append(f"whatsapp: {prior.get('whatsapp')}")

    plan = campaign.get("launchPlan") or campaign.get("launch_plan") or session.get(
        "launch_plan"
    ) or {}
    wa_launch = {}
    if isinstance(plan, dict):
        raw_wa = plan.get("whatsapp")
        if isinstance(raw_wa, dict):
            wa_launch = raw_wa
    wa_live_status = str(wa_launch.get("status") or "").strip().lower()
    wa_tpl = str(wa_launch.get("template_name") or "").strip()
    wa_mem = str(wa_launch.get("agent_memory_line") or "").strip()
    if wa_live_status and wa_tpl:
        channel_bits.append(
            f"whatsapp meta: {wa_live_status.upper()} ({wa_tpl})"
        )
        if isinstance(prior, dict):
            prior = dict(prior)
            prior["whatsapp"] = wa_live_status
            session["whatsapp_approval"] = wa_launch
            if wa_mem:
                from app.agents.create_campaign.memory_note import (
                    upsert_whatsapp_approval_memory_note,
                )

                upsert_whatsapp_approval_memory_note(session, wa_mem)
                await save_session(session, token=token)

    mode = ""
    if isinstance(plan, dict):
        mode = str(plan.get("schedule_mode") or "").strip().lower()

    if status in ("draft", "intake", ""):
        lead = (
            f"{name} has not launched — it is still {status or 'a draft'}. "
            f"0 of {selected} sent. Confirm launch so the header leaves Draft."
        )
    elif status == "live":
        lead = f"{name} is live. {sent} of {selected} selected already sent"
        if stub:
            lead += f" ({stub} stub, not a real browser/inbox send)"
        lead += "."
    elif status == "scheduled":
        when = ""
        if isinstance(plan, dict):
            when = " ".join(
                p
                for p in (
                    str(plan.get("launch_local_date") or "").strip(),
                    str(plan.get("launch_local_time") or "").strip(),
                )
                if p
            )
            tz = str(plan.get("timezone") or "").strip()
            if when and tz:
                when = f"{when} ({tz})"
        lead = (
            f"{name} is scheduled"
            + (f" for {when}" if when else "")
            + f". 0 sent yet of {selected} selected. Sends start at that time."
        )
    elif status in ("completed", "cancelled"):
        lead = f"{name} is already {status}. {sent} of {selected} sent."
    else:
        lead = f"{name} status is {status}. {sent} of {selected} sent."

    parts = [lead]
    if channel_bits:
        parts.append(" ".join(channel_bits) + ".")
    message = " ".join(parts)

    return {
        "ok": True,
        "campaign_id": campaign_id,
        "name": name,
        "status": status,
        "schedule_mode": mode or None,
        "selected": selected,
        "sent": sent,
        "stub": stub,
        "failed": failed,
        "channels": channels,
        "launch_outcomes": prior if isinstance(prior, dict) else None,
        "whatsapp_meta": wa_launch or None,
        "whatsapp_meta_status": wa_live_status or None,
        "message": message,
    }


async def handle_check_campaign_design(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    contact_ids = await load_audience_ids(session_id)
    channels = _dedupe_channels(list(session.get("channels") or []))
    plan = session.get("launch_plan") or {}
    if plan.get("launch_channels"):
        channels = _dedupe_channels(list(plan.get("launch_channels") or []))
    templates = list(session.get("templates") or [])
    template_channels = _dedupe_channels(
        [t.get("channel") for t in templates if t.get("channel")]
    )
    try:
        body = await _call_design_check(
            token,
            channels=channels,
            contact_ids=contact_ids,
            template_channels=template_channels,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"Design check failed: {exc}",
            "soft_warnings": [],
        }

    design = body.get("design") or {}
    warnings = [
        w.strip()
        for w in (design.get("warnings") or [])
        if isinstance(w, str) and w.strip()
    ]
    session["design_check"] = design
    aud = session.setdefault("audience", {})
    # merge without wiping consent notes
    prior = list(aud.get("soft_warnings") or [])
    merged = list(prior)
    for w in warnings:
        if w not in merged:
            merged.append(w)
    aud["soft_warnings"] = merged
    await save_session(session)

    msg = args.get("change_summary") or "Design check complete."
    if warnings:
        msg += " Soft notes (not blocked): " + " ".join(warnings[:6])
    else:
        msg += " No design warnings."

    return {
        "ok": True,
        "design": design,
        "soft_warnings": warnings,
        "message": msg,
        "ui_event": {
            "type": "design_check",
            "payload": {"soft_warnings": warnings, "design": design},
        },
    }


async def handle_check_channel_orchestration(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    channels = _dedupe_channels(list(session.get("channels") or []))
    plan = session.get("launch_plan") or {}
    if plan.get("launch_channels"):
        channels = _dedupe_channels(list(plan.get("launch_channels") or []))
    primary = _normalize_agent_channel(
        args.get("primary_channel") or plan.get("primary_channel") or ""
    ) or None
    mode = (
        str(args.get("orchestration_mode") or plan.get("orchestration_mode") or "")
        .strip()
        .lower()
        or None
    )
    try:
        body = await _call_orchestration_check(
            token,
            channels=channels,
            primary_channel=primary,
            orchestration_mode=mode,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"Orchestration check failed: {exc}",
            "soft_warnings": [],
        }

    orch = body.get("orchestration") or {}
    warnings = [
        w.strip()
        for w in list(orch.get("warnings") or []) + list(orch.get("notes") or [])
        if isinstance(w, str) and w.strip()
    ]
    session["orchestration_check"] = orch
    if isinstance(plan, dict) and plan:
        if primary:
            plan["primary_channel"] = primary
        elif orch.get("recommended_primary"):
            plan["primary_channel"] = orch.get("recommended_primary")
        if mode:
            plan["orchestration_mode"] = mode
        elif orch.get("suggested_mode"):
            plan["orchestration_mode"] = orch.get("suggested_mode")
        session["launch_plan"] = plan
    aud = session.setdefault("audience", {})
    prior = list(aud.get("soft_warnings") or [])
    merged = list(prior)
    for w in warnings:
        if w not in merged:
            merged.append(w)
    aud["soft_warnings"] = merged
    await save_session(session)

    msg = args.get("change_summary") or "Channel orchestration check complete."
    if warnings:
        msg += " Soft PDOA notes (not blocked): " + " ".join(warnings[:6])
    else:
        msg += " No multi-channel overlap notes."

    return {
        "ok": True,
        "orchestration": orch,
        "soft_warnings": warnings,
        "message": msg,
        "ui_event": {
            "type": "orchestration_check",
            "payload": {"soft_warnings": warnings, "orchestration": orch},
        },
    }


_HUB_DESTINATION_PATHS: dict[str, str] = {
    "recommendations": "/campaigns/create/recommendations",
    "templates": "/campaigns/create?tool=templates",
    "drafts": "/campaigns/create?tool=drafts",
    "whatsapp_approvals": "/campaigns/create/whatsapp",
    "create_space": "/campaigns/create",
    "events": "/events",
    "reports": "/dashboard",
}


def _truthy_arg(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    s = str(value or "").strip().lower()
    return s in {"1", "true", "yes", "y", "on"}


async def handle_open_hub_destination(
    session_id: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Hub-only navigation — FE opens path / panels from ui_event."""
    _ = session_id
    if not _truthy_arg(args.get("confirmed")):
        return {
            "ok": False,
            "error": (
                "confirmed must be true. Ask the user to confirm first, "
                "then call again with confirmed=true."
            ),
        }
    dest = str(args.get("destination") or "").strip().lower()
    if dest not in {
        "recommendations",
        "templates",
        "drafts",
        "whatsapp_approvals",
        "create_space",
        "open_draft",
        "events",
        "reports",
    }:
        return {
            "ok": False,
            "error": (
                "Unknown destination. Use recommendations, templates, drafts, "
                "whatsapp_approvals, create_space, open_draft, or reports."
            ),
        }

    draft_id = str(args.get("draft_id") or "").strip()
    handoff = _truthy_arg(args.get("handoff_history"))
    if dest == "create_space":
        handoff = True if args.get("handoff_history") is None else handoff

    if dest == "open_draft":
        if not draft_id or draft_id.startswith("hub-"):
            return {
                "ok": False,
                "error": "open_draft requires a real draft_id from drafts_snapshot.",
            }
        path = f"/campaigns/create/{draft_id}"
    else:
        path = _HUB_DESTINATION_PATHS[dest]

    summary = str(args.get("change_summary") or "").strip() or f"Opening {dest}."
    payload: dict[str, Any] = {
        "destination": dest,
        "path": path,
        "handoff_history": bool(handoff) if dest == "create_space" else False,
        "draft_id": draft_id or None,
    }
    return {
        "ok": True,
        "status": "handoff",
        "destination": dest,
        "path": path,
        "message": summary,
        "ui_event": {"type": "navigate", "payload": payload},
    }


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    if name == "OPEN_HUB_DESTINATION":
        return await handle_open_hub_destination(session_id, args)
    if name == "RECOMMEND_AUDIENCE":
        return await handle_recommend_audience(session_id, token, args)
    if name == "FILTER_CONTACTS":
        return await handle_filter_contacts(session_id, token, args)
    if name == "SET_CAMPAIGN_DETAILS":
        return await handle_set_campaign_details(session_id, args)
    if name == "SET_CHANNELS_AND_SCHEDULE":
        return await handle_set_channels(session_id, args)
    if name == "CONFIRM_CREATE_TEMPLATES":
        return await handle_confirm_templates(session_id, args)
    if name == "CREATE_TEMPLATES":
        return await handle_create_templates(
            session_id, args, event_callback=event_callback
        )
    if name == "REGENERATE_TEMPLATES":
        return await handle_regenerate_templates(
            session_id, args, event_callback=event_callback
        )
    if name == "CHECK_CAMPAIGN_DESIGN":
        return await handle_check_campaign_design(session_id, token, args)
    if name == "CHECK_CHANNEL_ORCHESTRATION":
        return await handle_check_channel_orchestration(session_id, token, args)
    if name == "PLAN_DYNAMIC_FIELDS":
        return await handle_plan_dynamic_fields(session_id, args)
    if name == "PREVIEW_DYNAMIC_SEND":
        return await handle_preview_dynamic_send(session_id, token, args)
    if name == "RECOMMEND_SEND_TIME":
        return await handle_recommend_send_time(session_id, token, args)
    if name == "SET_EMAIL_AB":
        return await handle_set_email_ab(
            session_id, args, event_callback=event_callback
        )
    if name == "SET_LAUNCH_PLAN":
        return await handle_set_launch_plan(session_id, token, args)
    if name == "CONFIRM_LAUNCH":
        return await handle_confirm_launch(session_id, token, args)
    if name == "GET_LAUNCH_STATUS":
        return await handle_get_launch_status(session_id, token, args)
    if name == "ROUTE_TO_MODULE":
        result = await dispatch_route_to_module(args)
        if event_callback and result.get("ui_event"):
            await event_callback(result["ui_event"])
        return result
    return {"ok": False, "error": f"Unknown tool: {name}"}


# ---- core wrappers (jun30-style public dispatch) ----

from app.agents.create_campaign.channels import (
    launch_blocked_reason,
    normalize_channels,
)
from app.session_store import get_or_create_session, save_session

ProgressCallback = Any


async def handle_update_campaign_meta(
    session_id: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Persist meta + strategist journey flags from LLM tool args."""
    payload = dict(args) if isinstance(args, dict) else {}

    session = await get_or_create_session(session_id)
    journey_touch = False

    if "strategy_summary" in payload and payload.get("strategy_summary") is not None:
        session["strategy_summary"] = str(payload.get("strategy_summary") or "").strip()
        journey_touch = True
    if "strategy_accepted" in payload and payload.get("strategy_accepted") is not None:
        session["strategy_accepted"] = bool(payload.get("strategy_accepted"))
        journey_touch = True
    if "templates_finalized" in payload and payload.get("templates_finalized") is not None:
        session["templates_finalized"] = bool(payload.get("templates_finalized"))
        journey_touch = True
    if "whatsapp_retry" in payload and payload.get("whatsapp_retry") is not None:
        try:
            retry = int(payload.get("whatsapp_retry"))
        except (TypeError, ValueError):
            retry = -1
        if retry in (0, 1, 2, 3):
            session["whatsapp_retry"] = retry
            journey_touch = True

    async def _emit_after_memory() -> None:
        if not event_callback:
            return
        try:
            from app.session_store import public_state

            fresh = await get_or_create_session(session_id)
            await event_callback(
                {"type": "state_update", "state": public_state(fresh)}
            )
        except Exception:  # noqa: BLE001
            pass

    has_meta_fields = any(
        str(payload.get(key) or "").strip() for key in ("name", "goal", "objective", "user_text")
    )
    if has_meta_fields:
        result = await handle_set_campaign_details(session_id, payload)
        # Re-load and re-apply journey flags (set_campaign_details may have saved).
        session = await get_or_create_session(session_id)
        if "strategy_summary" in payload and payload.get("strategy_summary") is not None:
            session["strategy_summary"] = str(payload.get("strategy_summary") or "").strip()
        if "strategy_accepted" in payload and payload.get("strategy_accepted") is not None:
            session["strategy_accepted"] = bool(payload.get("strategy_accepted"))
        if "templates_finalized" in payload and payload.get("templates_finalized") is not None:
            session["templates_finalized"] = bool(payload.get("templates_finalized"))
        if "whatsapp_retry" in payload and payload.get("whatsapp_retry") is not None:
            try:
                retry = int(payload.get("whatsapp_retry"))
            except (TypeError, ValueError):
                retry = -1
            if retry in (0, 1, 2, 3):
                session["whatsapp_retry"] = retry
        await save_session(session)
        await _emit_after_memory()
        return {
            **result,
            "strategy_accepted": bool(session.get("strategy_accepted")),
            "whatsapp_retry": session.get("whatsapp_retry"),
            "templates_finalized": bool(session.get("templates_finalized")),
        }

    if journey_touch:
        await save_session(session)
        await _emit_after_memory()
        parts: list[str] = []
        if session.get("strategy_accepted"):
            parts.append("Strategy accepted — we can build templates next.")
        if session.get("whatsapp_retry") is not None:
            parts.append(f"WhatsApp retry set to {session.get('whatsapp_retry')}.")
        if session.get("templates_finalized"):
            parts.append("Templates marked finalized.")
        return {
            "ok": True,
            "strategy_accepted": bool(session.get("strategy_accepted")),
            "strategy_summary": session.get("strategy_summary") or "",
            "whatsapp_retry": session.get("whatsapp_retry"),
            "templates_finalized": bool(session.get("templates_finalized")),
            "message": " ".join(parts) or "Updated campaign plan.",
        }

    result = await handle_set_campaign_details(session_id, payload)
    if result.get("ok"):
        await _emit_after_memory()
    return result


async def handle_create_contact_for_campaign(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Create a CRM contact from create-campaign when lookup missed them."""
    from app.agents.contacts.tools.handlers import handle_create
    from app.agents.contacts.validation import review_email_address
    from app.agents.create_campaign.context import refresh_audience_summary
    from app.progress_status import emit_process_progress
    from app.session_store import get_or_create_session, save_session

    await emit_process_progress(event_callback, "filtering")

    session = await get_or_create_session(session_id)
    pending = session.get("pending_contact_create")
    if not isinstance(pending, dict):
        pending = {}

    first_name = str(args.get("first_name") or "").strip()
    email = str(args.get("email") or "").strip()
    phone = str(args.get("phone") or "").strip()

    # LLM often forgets to re-pass email — reuse last LOOKUP_NOT_FOUND missing list.
    if not email:
        for cand in pending.get("emails_missing") or pending.get("emails") or []:
            c = str(cand or "").strip()
            if c:
                email = c
                break
    if not phone:
        for cand in pending.get("phones_missing") or pending.get("phones") or []:
            c = str(cand or "").strip()
            if c:
                phone = c
                break

    if not first_name:
        return {
            "ok": False,
            "error": "first_name_required",
            "message": (
                "CREATE_CONTACT_NEED_NAME: ask for first name only — reuse any "
                "email already given (phone is optional when email is present). "
                "Do not ask for phone."
            ),
        }

    if email:
        reviewed = review_email_address(email)
        if not reviewed.get("ok"):
            if reviewed.get("error") == "likely_typo":
                return {
                    "ok": False,
                    "error": "email_typo",
                    "email": reviewed.get("email"),
                    "suggested_email": reviewed.get("suggested_email"),
                    "message": (
                        "CREATE_CONTACT_EMAIL_TYPO: "
                        f"{reviewed.get('message')} "
                        "Ask the user to confirm the correction. Do not ask for phone. "
                        "Do not create until they confirm or give a corrected email."
                    ),
                }
            return {
                "ok": False,
                "error": "invalid_email",
                "email": reviewed.get("email"),
                "message": (
                    "CREATE_CONTACT_INVALID_EMAIL: "
                    f"{reviewed.get('message')} "
                    "Ask for a corrected email. Phone is optional — do not require phone."
                ),
            }
        email = str(reviewed.get("email") or email).strip()

    if not email and not phone:
        return {
            "ok": False,
            "error": "channel_required",
            "message": (
                "CREATE_CONTACT_NEED_CHANNEL: pass email= from earlier check_contacts "
                "emails_missing (or a phone). Email alone is enough — NEVER require "
                "phone when an email was already given in this chat."
            ),
        }
    if args.get("user_confirmed") is not True:
        return {
            "ok": False,
            "error": "not_confirmed",
            "message": (
                "CREATE_CONTACT_CONFIRM: briefly confirm creating "
                f"{first_name}"
                + (f" <{email}>" if email else "")
                + (f" ({phone})" if phone else "")
                + " then call create_contact again with user_confirmed=true "
                "and the same email/phone args. Do not re-ask for fields already listed. "
                "Do not ask for phone when email is present."
            ),
        }

    create_args: dict[str, Any] = {
        "user_confirmed": True,
        "first_name": first_name,
        "change_summary": str(
            args.get("change_summary") or "Create contact from campaign chat"
        ),
    }
    for key in ("last_name", "company_name", "city"):
        val = str(args.get(key) or "").strip()
        if val:
            create_args[key] = val
    if email:
        create_args["email"] = email
    if phone:
        create_args["phone"] = phone

    created = await handle_create(session_id, token, create_args)
    if not created.get("ok"):
        contact = (
            created.get("contact")
            if isinstance(created.get("contact"), dict)
            else {}
        )
        contact_id = str(contact.get("id") or created.get("contact_id") or "").strip()
        if created.get("already_exists") and contact_id:
            session["pending_contact_update"] = {
                "contact_id": contact_id,
                "email": str(contact.get("email") or "").strip() or None,
                "phone": str(contact.get("phone") or "").strip() or None,
                "first_name": str(contact.get("first_name") or "").strip() or None,
                "last_name": str(contact.get("last_name") or "").strip() or None,
            }
            await save_session(session)

            existing_email = str(contact.get("email") or "").strip().lower()
            existing_phone = str(contact.get("phone") or "").strip()
            wants_change = bool(
                (email and email.strip().lower() != existing_email)
                or (phone and phone.strip() and phone.strip() not in existing_phone
                    and existing_phone not in phone.strip())
                or (
                    first_name
                    and first_name.strip().lower()
                    != str(contact.get("first_name") or "").strip().lower()
                )
            )
            # LLM often calls create_contact to "change email" on a phone match —
            # apply the update when they already confirmed.
            if wants_change:
                update_payload: dict[str, Any] = {
                    "contact_id": contact_id,
                    "user_confirmed": True,
                    "change_summary": str(
                        args.get("change_summary")
                        or "Update existing contact from create attempt"
                    ),
                }
                if email and email.strip().lower() != existing_email:
                    update_payload["email"] = email
                if phone:
                    update_payload["phone"] = phone
                if first_name:
                    update_payload["first_name"] = first_name
                for key in ("last_name", "company_name", "city"):
                    val = str(args.get(key) or "").strip()
                    if val:
                        update_payload[key] = val
                return await handle_update_contact_for_campaign(
                    session_id,
                    token,
                    update_payload,
                    event_callback=event_callback,
                )

            label = (
                " ".join(
                    p
                    for p in (
                        str(contact.get("first_name") or "").strip(),
                        str(contact.get("last_name") or "").strip(),
                    )
                    if p
                ).strip()
                or "that contact"
            )
            return {
                "ok": False,
                "already_exists": True,
                "error": "already_exists",
                "contact_id": contact_id,
                "contact": contact,
                "message": (
                    "CREATE_CONTACT_ALREADY_EXISTS: "
                    f"contact_id={contact_id} name={label} "
                    f"email={contact.get('email') or 'n/a'} "
                    f"phone={contact.get('phone') or 'n/a'}. "
                    "Do NOT say you cannot change the email because the phone is in use. "
                    "That phone belongs to this same contact — call update_contact with "
                    f"contact_id={contact_id} and the new email/phone/name fields "
                    "(user_confirmed=true when they said yes). "
                    "Never ask for a different phone just to set a new email."
                ),
                "raw": created,
            }
        return {
            "ok": False,
            "error": created.get("error") or "create_failed",
            "contact_id": contact_id or None,
            "contact": contact or None,
            "message": (
                "CREATE_CONTACT_FAILED: "
                f"{created.get('error') or created.get('message') or 'create failed'}. "
                "Explain briefly; do not invent success. "
                "If they said email only, do not insist on phone. "
                "If the contact already exists, use update_contact — do not invent "
                "a 'keep as-is or different phone' dead-end."
            ),
            "raw": created,
        }

    session.pop("pending_contact_create", None)
    contact = created.get("contact") if isinstance(created.get("contact"), dict) else {}
    contact_id = str(
        created.get("contact_id") or contact.get("id") or ""
    ).strip()
    if contact_id:
        session["pending_contact_update"] = {
            "contact_id": contact_id,
            "email": email or str(contact.get("email") or "").strip() or None,
            "phone": phone or str(contact.get("phone") or "").strip() or None,
            "first_name": first_name
            or str(contact.get("first_name") or "").strip()
            or None,
            "last_name": str(contact.get("last_name") or "").strip() or None,
        }
    await save_session(session)

    try:
        await refresh_audience_summary(session_id, token)
    except Exception:  # noqa: BLE001
        pass

    lookup_args: dict[str, Any] = {
        "change_summary": "Re-check contact after create",
    }
    if email:
        lookup_args["emails"] = [email]
    if phone:
        lookup_args["phones"] = [phone]
    if first_name and not email and not phone:
        lookup_args["names"] = [first_name]

    lookup = await handle_lookup_contacts(
        session_id, token, lookup_args, event_callback=event_callback
    )

    return {
        "ok": True,
        "created": True,
        "contact_id": contact_id or None,
        "contact": contact or None,
        "found": bool(lookup.get("found")),
        "matched_count": int(lookup.get("matched_count") or 0),
        "sample_names": lookup.get("sample_names") or [],
        "lookup": lookup,
        "message": (
            "CREATE_OK: contact created in Audience. "
            f"contact_id={contact_id or 'n/a'}. "
            "check_contacts was re-run — if found=true, audience is on the panel. "
            "Confirm briefly, then ask the next open campaign step "
            "(channels / name / templates). Never say you cannot create contacts. "
            "Never require phone when email was used. "
            "Later email/phone fixes → update_contact with this contact_id."
        ),
        "ui_event": lookup.get("ui_event"),
    }


async def handle_update_contact_for_campaign(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Update an existing CRM contact from create-campaign (email/phone/name fixes)."""
    from app.agents.contacts.tools.handlers import handle_lookup, handle_update
    from app.agents.contacts.validation import review_email_address
    from app.agents.create_campaign.context import refresh_audience_summary
    from app.progress_status import emit_process_progress
    from app.session_store import get_or_create_session, save_session

    await emit_process_progress(event_callback, "filtering")

    session = await get_or_create_session(session_id)
    pending = session.get("pending_contact_update")
    if not isinstance(pending, dict):
        pending = {}

    contact_id = str(args.get("contact_id") or pending.get("contact_id") or "").strip()
    match_email = str(args.get("match_email") or "").strip()
    match_phone = str(args.get("match_phone") or "").strip()
    new_email = str(args.get("email") or "").strip()
    new_phone = str(args.get("phone") or "").strip()
    first_name = str(args.get("first_name") or "").strip()
    last_name = str(args.get("last_name") or "").strip()

    if not match_email and pending.get("email"):
        match_email = str(pending.get("email") or "").strip()
    if not match_phone and pending.get("phone"):
        match_phone = str(pending.get("phone") or "").strip()

    if new_email:
        reviewed = review_email_address(new_email)
        if not reviewed.get("ok"):
            if reviewed.get("error") == "likely_typo":
                return {
                    "ok": False,
                    "error": "email_typo",
                    "email": reviewed.get("email"),
                    "suggested_email": reviewed.get("suggested_email"),
                    "message": (
                        "UPDATE_CONTACT_EMAIL_TYPO: "
                        f"{reviewed.get('message')} "
                        "Ask them to confirm the correction, then retry update_contact. "
                        "Do not ask for a different phone."
                    ),
                }
            return {
                "ok": False,
                "error": "invalid_email",
                "email": reviewed.get("email"),
                "message": (
                    "UPDATE_CONTACT_INVALID_EMAIL: "
                    f"{reviewed.get('message')} Ask for a corrected email."
                ),
            }
        new_email = str(reviewed.get("email") or new_email).strip()

    if not any(
        (
            new_email,
            new_phone,
            first_name,
            last_name,
            args.get("company_name"),
            args.get("city"),
        )
    ):
        return {
            "ok": False,
            "error": "no_changes",
            "message": (
                "UPDATE_CONTACT_NO_CHANGES: pass the field(s) to change "
                "(email, phone, first_name, …)."
            ),
        }

    if not contact_id:
        ids = await load_audience_ids(session_id)
        if len(ids) == 1:
            contact_id = str(ids[0]).strip()

    if not contact_id and (match_email or match_phone):
        looked = await handle_lookup(
            session_id,
            token,
            {
                "email": match_email or None,
                "phone": match_phone or None,
                "change_summary": "Resolve contact for campaign update",
            },
        )
        cands = looked.get("candidates") if isinstance(looked, dict) else None
        if isinstance(cands, list) and len(cands) == 1 and isinstance(cands[0], dict):
            contact_id = str(cands[0].get("id") or "").strip()
        if not contact_id:
            session = await get_or_create_session(session_id)
            contact_id = str(session.get("focus_contact_id") or "").strip()

    if not contact_id:
        return {
            "ok": False,
            "error": "contact_not_found",
            "message": (
                "UPDATE_CONTACT_NEED_ID: could not resolve which contact to update. "
                "Pass contact_id from check_contacts/create_contact, or match_email / "
                "match_phone for the existing record. Do not create a duplicate."
            ),
        }

    if args.get("user_confirmed") is not True:
        bits = [f"contact_id={contact_id}"]
        if new_email:
            bits.append(f"email→{new_email}")
        if new_phone:
            bits.append(f"phone→{new_phone}")
        if first_name:
            bits.append(f"first_name→{first_name}")
        if last_name:
            bits.append(f"last_name→{last_name}")
        return {
            "ok": False,
            "error": "not_confirmed",
            "contact_id": contact_id,
            "message": (
                "UPDATE_CONTACT_CONFIRM: briefly confirm updating "
                + ", ".join(bits)
                + " then call update_contact again with user_confirmed=true "
                "and the same fields. Do not invent create-vs-new-phone options."
            ),
        }

    update_args: dict[str, Any] = {
        "user_confirmed": True,
        "contact_id": contact_id,
        "change_summary": str(
            args.get("change_summary") or "Update contact from campaign chat"
        ),
    }
    for key, val in (
        ("email", new_email),
        ("phone", new_phone),
        ("first_name", first_name),
        ("last_name", last_name),
        ("company_name", str(args.get("company_name") or "").strip()),
        ("city", str(args.get("city") or "").strip()),
    ):
        if val:
            update_args[key] = val

    updated = await handle_update(session_id, token, update_args)
    if not updated.get("ok"):
        return {
            "ok": False,
            "error": updated.get("error") or "update_failed",
            "contact_id": contact_id,
            "message": (
                "UPDATE_CONTACT_FAILED: "
                f"{updated.get('error') or updated.get('message') or 'update failed'}. "
                "Explain briefly; do not invent success. Do not ask for a new phone "
                "just because the email changed."
            ),
            "raw": updated,
        }

    contact = updated.get("contact") if isinstance(updated.get("contact"), dict) else {}
    session["pending_contact_update"] = {
        "contact_id": str(contact.get("id") or contact_id).strip(),
        "email": str(contact.get("email") or new_email or "").strip() or None,
        "phone": str(contact.get("phone") or new_phone or "").strip() or None,
        "first_name": str(contact.get("first_name") or first_name or "").strip() or None,
        "last_name": str(contact.get("last_name") or last_name or "").strip() or None,
    }
    await save_session(session)

    try:
        await refresh_audience_summary(session_id, token)
    except Exception:  # noqa: BLE001
        pass

    lookup_args: dict[str, Any] = {
        "change_summary": "Re-check contact after update",
    }
    lookup_email = str(contact.get("email") or new_email or "").strip()
    lookup_phone = str(contact.get("phone") or new_phone or "").strip()
    if lookup_email:
        lookup_args["emails"] = [lookup_email]
    if lookup_phone:
        lookup_args["phones"] = [lookup_phone]

    lookup: dict[str, Any] = {}
    if lookup_args.get("emails") or lookup_args.get("phones"):
        lookup = await handle_lookup_contacts(
            session_id, token, lookup_args, event_callback=event_callback
        )

    return {
        "ok": True,
        "updated": True,
        "contact_id": str(contact.get("id") or contact_id).strip(),
        "contact": contact or None,
        "found": bool(lookup.get("found")) if lookup else True,
        "matched_count": int(lookup.get("matched_count") or 0) if lookup else 0,
        "sample_names": (lookup.get("sample_names") or []) if lookup else [],
        "lookup": lookup or None,
        "message": (
            "UPDATE_OK: contact updated in Audience. "
            f"contact_id={contact.get('id') or contact_id}. "
            f"email={contact.get('email') or lookup_email or 'n/a'}; "
            f"phone={contact.get('phone') or lookup_phone or 'n/a'}. "
            "Confirm briefly, then continue the campaign. "
            "Do not ask to create a new contact for this change."
        ),
        "ui_event": (lookup or {}).get("ui_event") or updated.get("ui_event"),
    }


async def handle_lookup_contacts(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """CRM identity check from LLM-supplied emails/phones/names — facts only for LLM reply."""
    from app.progress_status import emit_process_progress

    await emit_process_progress(event_callback, "filtering")

    from app.agents.contacts.validation import review_email_address

    emails_in = _normalize_email_list(args.get("emails"))
    phones = _normalize_phone_list(args.get("phones"))
    names_raw = args.get("names") if isinstance(args.get("names"), list) else []
    names = [str(n).strip() for n in names_raw if str(n or "").strip()]

    if not emails_in and not phones and not names:
        return {
            "ok": False,
            "matched_count": 0,
            "found": False,
            "emails_requested": [],
            "phones_requested": [],
            "names_requested": [],
            "emails_matched": [],
            "emails_missing": [],
            "phones_matched": [],
            "phones_missing": [],
            "names_matched": [],
            "names_missing": [],
            "sample_names": [],
            "message": (
                "LOOKUP_EMPTY_ARGS: no emails/phones/names supplied. "
                "Ask the user for the contact email, phone, or name."
            ),
        }

    emails: list[str] = []
    email_typos: list[dict[str, str]] = []
    invalid_emails: list[str] = []
    for raw_em in emails_in:
        reviewed = review_email_address(raw_em)
        if reviewed.get("ok"):
            emails.append(str(reviewed.get("email") or raw_em))
            continue
        if reviewed.get("error") == "likely_typo" and reviewed.get("suggested_email"):
            email_typos.append(
                {
                    "email": str(reviewed.get("email") or raw_em),
                    "suggested_email": str(reviewed["suggested_email"]),
                }
            )
            continue
        invalid_emails.append(str(reviewed.get("email") or raw_em))

    if email_typos and not emails and not phones and not names:
        typo = email_typos[0]
        await emit_process_progress(event_callback, "filtering", status="done")
        return {
            "ok": False,
            "found": False,
            "matched_count": 0,
            "error": "email_typo",
            "email": typo["email"],
            "suggested_email": typo["suggested_email"],
            "email_typos": email_typos,
            "emails_requested": emails_in,
            "emails_missing": [t["email"] for t in email_typos],
            "phones_requested": phones,
            "names_requested": names,
            "message": (
                "LOOKUP_EMAIL_TYPO: "
                f"{typo['email']} looks mistyped — did they mean "
                f"{typo['suggested_email']}? Ask them to confirm the correction "
                "(or give the right email). Do NOT ask for phone. Do NOT create "
                "until they confirm. Then call check_contacts again with the "
                "corrected email."
            ),
        }

    if invalid_emails and not emails and not phones and not names:
        bad = invalid_emails[0]
        await emit_process_progress(event_callback, "filtering", status="done")
        return {
            "ok": False,
            "found": False,
            "matched_count": 0,
            "error": "invalid_email",
            "email": bad,
            "emails_requested": emails_in,
            "emails_missing": invalid_emails,
            "phones_requested": phones,
            "names_requested": names,
            "message": (
                f"LOOKUP_INVALID_EMAIL: {bad} is not a valid email format. "
                "Ask for a corrected email. Do NOT ask for phone when they only "
                "gave an email."
            ),
        }

    emails_matched: list[str] = []
    emails_missing: list[str] = []
    phones_matched: list[str] = []
    phones_missing: list[str] = []
    names_matched: list[str] = []
    names_missing: list[str] = []
    sample_names: list[str] = []
    soft_warnings: list[str] = []
    last_body: dict[str, Any] = {}
    if email_typos:
        soft_warnings.extend(
            f"typo:{t['email']}→{t['suggested_email']}" for t in email_typos
        )
    if invalid_emails:
        soft_warnings.extend(f"invalid_email:{e}" for e in invalid_emails)

    identity_filters: dict[str, Any] = {}
    if emails:
        identity_filters["emails"] = emails
    if phones:
        identity_filters["phones"] = phones

    if identity_filters:
        result = await handle_filter_contacts(
            session_id,
            token,
            {
                "filters": identity_filters,
                "mode": "replace",
                "change_summary": args.get("change_summary")
                or "Lookup specific contacts",
            },
        )
        last_body = result
        if not result.get("ok", True) and result.get("error"):
            await emit_process_progress(event_callback, "filtering", status="done")
            return {
                "ok": False,
                "error": result.get("error"),
                "matched_count": 0,
                "found": False,
                "message": f"LOOKUP_ERROR: {result.get('error')}",
            }
        emails_matched = [str(e) for e in (result.get("emails_matched") or []) if e]
        emails_missing = [str(e) for e in (result.get("emails_missing") or []) if e]
        phones_matched = [str(p) for p in (result.get("phones_matched") or []) if p]
        phones_missing = [str(p) for p in (result.get("phones_missing") or []) if p]
        for n in result.get("sample_names") or []:
            s = str(n).strip()
            if s and s not in sample_names:
                sample_names.append(s)

    for name in names:
        prior_ids = await load_audience_ids(session_id)
        mode = "add" if prior_ids else "replace"
        name_result = await handle_filter_contacts(
            session_id,
            token,
            {
                "filters": {"search": name},
                "mode": mode,
                "change_summary": args.get("change_summary")
                or f"Lookup name {name}",
            },
        )
        last_body = name_result
        if not name_result.get("ok", True) and name_result.get("error"):
            soft_warnings.append(str(name_result.get("error")))
            names_missing.append(name)
            continue
        if int(name_result.get("matched_count") or 0) > 0:
            names_matched.append(name)
            for n in name_result.get("sample_names") or []:
                s = str(n).strip()
                if s and s not in sample_names:
                    sample_names.append(s)
        else:
            names_missing.append(name)

    contact_ids = await load_audience_ids(session_id)
    matched = len(contact_ids)
    found = matched > 0

    if found:
        session = await get_or_create_session(session_id)
        session["pending_contact_update"] = {
            "contact_ids": list(contact_ids),
            "contact_id": contact_ids[0] if len(contact_ids) == 1 else None,
            "email": (emails_matched[0] if emails_matched else (emails[0] if emails else None)),
            "phone": (phones_matched[0] if phones_matched else (phones[0] if phones else None)),
            "sample_names": list(sample_names[:5]),
        }
        await save_session(session)

    if not found:
        session = await get_or_create_session(session_id)
        audience = (
            session.get("audience")
            if isinstance(session.get("audience"), dict)
            else {}
        )
        audience["filters"] = {}
        audience["matched_count"] = 0
        audience["sample_names"] = []
        audience["description"] = ""
        session["audience"] = audience
        try:
            await save_audience_ids(session_id, [])
        except Exception:  # noqa: BLE001
            pass
        await save_session(session)

    await emit_process_progress(event_callback, "calculating")
    await emit_process_progress(event_callback, "filtering", status="done")

    fact_bits = [
        f"found={found}",
        f"matched_count={matched}",
        f"samples={sample_names[:5]}",
        f"emails_requested={emails}",
        f"emails_matched={emails_matched}",
        f"emails_missing={emails_missing}",
        f"phones_requested={phones}",
        f"phones_matched={phones_matched}",
        f"phones_missing={phones_missing}",
        f"names_requested={names}",
        f"names_matched={names_matched}",
        f"names_missing={names_missing}",
    ]
    if found:
        fact_bits.append(
            "LOOKUP_OK: confirm these contacts as audience in your own words; "
            "do not ask to upload/add them. Then ask the next open campaign step. "
            f"contact_ids={contact_ids[:5]} — use update_contact with contact_id "
            "when they ask to change email/phone/name on this audience contact."
        )
    else:
        fact_bits.append(
            "LOOKUP_NOT_FOUND: these contacts were not found in Audience. "
            f"emails_missing={emails_missing}; phones_missing={phones_missing}; "
            f"names_missing={names_missing}. "
            "Tell the user they are not in Audience yet. Offer to create them with "
            "create_contact. Reuse emails_missing/phones_missing and any name already "
            "in this chat — NEVER re-ask for the same email/phone. "
            "Ask only for first_name if still unknown. "
            "Email alone is enough — NEVER require or ask for phone when an email "
            "is already present (including when they say email only / no number). "
            "Do not claim the audience was set. Do not build templates or launch yet. "
            "Do not say you cannot create contacts here. Do not require CSV unless "
            "they want bulk import."
        )

    if not found and (emails_missing or phones_missing):
        session = await get_or_create_session(session_id)
        session["pending_contact_create"] = {
            "emails_missing": list(emails_missing),
            "phones_missing": list(phones_missing),
            "emails": list(emails),
            "phones": list(phones),
            "names_missing": list(names_missing),
        }
        await save_session(session)

    if found:
        from app.agents.create_campaign.memory_note import (
            append_memory_note,
            note_from_audience,
        )

        session = await get_or_create_session(session_id)
        line = note_from_audience(
            {
                "matched_count": matched,
                "description": (
                    f"lookup emails={emails_matched or emails} "
                    f"phones={phones_matched or phones} names={names_matched or names}"
                ),
            }
        )
        if line:
            append_memory_note(session, line)
            await save_session(session)
        if session.get("whatsapp_approved_run"):
            from app.agents.whatsapp_approved.launch_helpers import (
                finalize_whatsapp_approved_audience,
                wa_audience_tool_suffix,
            )

            fin = await finalize_whatsapp_approved_audience(session_id, token)
            session = await get_or_create_session(session_id)
            fact_bits.append(
                "LOOKUP_OK_WA: CRM match saved for approved WhatsApp run. "
                "WhatsApp-only; template already approved. "
                "Do NOT ask for phone when email matched a contact who has phone on file. "
                "Do NOT ask for channels."
            )
            if fin.get("ok"):
                fact_bits.append(
                    "NEXT:LAUNCH: confirm recipient(s) in plain language, then ask "
                    "launch now or schedule and call launch_campaign(confirmed=true)."
                )
            else:
                fact_bits.append(
                    f"AUDIENCE_FREEZE_WARN: {fin.get('error') or 'freeze pending'}"
                )
            fact_bits.append(wa_audience_tool_suffix(session).lstrip(" |"))
        else:
            fact_bits.append(
                "NEXT:ASK_CHANNELS: after confirming audience, ask which channels to use "
                "(email, WhatsApp, web push, app push)."
            )

    return {
        "ok": True,
        "found": found,
        "matched_count": matched,
        "contact_ids": contact_ids[:20],
        "emails_requested": emails,
        "phones_requested": phones,
        "names_requested": names,
        "emails_matched": emails_matched,
        "emails_missing": emails_missing,
        "phones_matched": phones_matched,
        "phones_missing": phones_missing,
        "names_matched": names_matched,
        "names_missing": names_missing,
        "sample_names": sample_names[:10],
        "soft_warnings": soft_warnings,
        "message": " | ".join(fact_bits),
        "ui_event": last_body.get("ui_event") if found else None,
    }


async def handle_select_audience(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.progress_status import emit_process_progress

    await emit_process_progress(event_callback, "filtering")
    user_text = str(args.get("user_text") or "").strip()
    result = await handle_recommend_audience(
        session_id,
        token,
        {"user_text": user_text, "change_summary": args.get("change_summary")},
        event_callback=event_callback,
    )
    await emit_process_progress(event_callback, "calculating")
    session = await get_or_create_session(session_id)
    # Facts only — coordinator LLM writes natural chat (no static scripts).
    count = int(result.get("matched_count") or 0)
    names = [str(n) for n in (result.get("sample_names") or []) if n][:5]
    missing_e = [str(e) for e in (result.get("emails_missing") or []) if e][:8]
    missing_p = [str(p) for p in (result.get("phones_missing") or []) if p][:8]
    seg = session.get("audience_segmentation")
    org_total = int(seg.get("total_contacts") or 0) if isinstance(seg, dict) else 0
    intent = str(result.get("intent") or "")
    all_contacts = bool(result.get("all_contacts"))
    unsupported = [str(x) for x in (result.get("unsupported") or []) if x][:8]
    channels = [str(c).strip() for c in (session.get("channels") or []) if str(c).strip()]
    channels_empty = len(channels) == 0
    fact_bits = [
        f"intent={intent}",
        f"matched_count={count}",
        f"samples={names}",
        f"emails_missing={missing_e}",
        f"phones_missing={missing_p}",
        f"org_total_contacts={org_total}",
        f"all_contacts={all_contacts}",
        f"unsupported={unsupported}",
        f"channels_empty={channels_empty}",
        f"session_channels={channels}",
    ]
    if org_total <= 0 and count <= 0:
        fact_bits.append(
            "ORG_EMPTY: no contacts in CRM yet. For a named email/phone, offer "
            "create_contact (reuse values already given). For bulk lists, mention "
            "CSV upload in Audience. Do not invent recipients."
        )
    elif intent == "clarify" or result.get("skipped"):
        fact_bits.append(
            "NEEDS_WHO: audience choice unclear — ask naturally who should receive "
            "(CRM segments from Context if helpful, named people/emails, AND temporary "
            "contact sheet — paste CONTEXT temporary_contact_template_link hypertext in "
            "the same reply). No canned script."
        )
    elif count <= 0 and (missing_e or missing_p or not all_contacts):
        fact_bits.append(
            "SELECTION_NOT_FOUND: tell them the requested segment/contacts were not "
            "found in Audience; do not claim success."
        )
    elif count > 0:
        fact_bits.append(
            "SELECTION_OK: briefly confirm who/what was selected in your own words "
            "(never 'Found N contact(s), including…')."
        )
        if channels_empty:
            fact_bits.append(
                "NEXT:ASK_CHANNELS: ask ONE natural question about which channels "
                "to use (email, WhatsApp, web push, app push)."
            )
        else:
            fact_bits.append(
                "NEXT: ask ONE natural next open step from Context (templates if ready)."
            )
        from app.agents.create_campaign.memory_note import (
            append_memory_note,
            note_from_audience,
        )

        aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
        line = note_from_audience(
            {
                "matched_count": count,
                "description": aud.get("description")
                or aud.get("summary")
                or (f"all contacts" if all_contacts else intent or "segment"),
            }
        )
        if line:
            append_memory_note(session, line)
            await save_session(session)
    result = {
        **result,
        "message": (
            "Audience tool facts (write a short natural reply + one follow-up): "
            + "; ".join(fact_bits)
        ),
    }
    if event_callback and result.get("ui_event"):
        await event_callback(result["ui_event"])
    return result


async def handle_set_channels_core(
    session_id: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    channels = normalize_channels(args.get("channels"))
    if not channels:
        return {
            "ok": False,
            "error": "No valid channels. Pass channels array: email, whatsapp, web/web_push, or push/app_push (not SMS).",
        }
    payload = {
        **args,
        "channels": channels,
        "channel_plans": args.get("channel_plans") or _default_channel_plans(channels),
    }
    result = await handle_set_channels(session_id, payload)
    if not result.get("ok"):
        return result

    session = await get_or_create_session(session_id)
    # User has progressed past strategy in the journey — do not block templates later.
    if _ensure_strategy_accepted_if_ready(session):
        await save_session(session)

    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    count = int(aud.get("matched_count") or 0)
    saved = [str(c).strip() for c in (session.get("channels") or []) if str(c).strip()]
    needs_wa_retry = "whatsapp" in saved and session.get("whatsapp_retry") is None
    fact_bits = [
        f"channels={saved}",
        f"channel_labels={[f'{c}={_channel_user_label(c)}' for c in saved]}",
        f"audience_matched={count}",
        f"strategy_accepted={bool(session.get('strategy_accepted'))}",
        f"needs_whatsapp_retry={needs_wa_retry}",
    ]
    if count <= 0:
        fact_bits.append(
            "NEXT: audience still empty — ask who should receive (CRM options and/or named "
            "people, AND temporary contact sheet with CONTEXT temporary_contact_template_link "
            "pasted in the same reply) before templates."
        )
    elif needs_wa_retry:
        fact_bits.append(
            "NEXT:ASK_WHATSAPP_RETRY: ask naturally for WhatsApp retry count 0/1/2/3, "
            "then create templates."
        )
    else:
        fact_bits.append(
            "NEXT: audience + channels ready — confirm then build_campaign for templates."
        )
    return {
        **result,
        "message": (
            "Channels tool facts (write natural reply): " + "; ".join(fact_bits)
        ),
    }


def _campaign_recap_payload(session: dict[str, Any]) -> dict[str, Any]:
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    templates = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    latest = _latest_templates_by_channel(templates)
    template_rows: list[dict[str, Any]] = []
    template_ids: list[str] = []
    for row in latest:
        tid = str(row.get("template_id") or row.get("id") or "").strip()
        ch = str(row.get("channel") or "").strip().lower()
        if tid:
            template_ids.append(tid)
        template_rows.append({"template_id": tid or None, "channel": ch})
    channels = [
        str(c).strip().lower()
        for c in (session.get("channels") or [])
        if str(c).strip()
    ]
    return {
        "name": str(camp.get("name") or "").strip(),
        "goal": str(camp.get("goal") or "").strip(),
        "objective": str(camp.get("objective") or "").strip(),
        "audience_count": int(aud.get("matched_count") or 0),
        "audience_description": str(aud.get("description") or "")[:200],
        "channels": channels,
        "template_ids": template_ids,
        "templates": template_rows,
    }


def _campaign_meta_complete(session: dict[str, Any]) -> bool:
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    return all(str(camp.get(k) or "").strip() for k in ("name", "goal", "objective"))


def _audience_matched_count(session: dict[str, Any]) -> int:
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    return int(aud.get("matched_count") or 0)


def _ensure_strategy_accepted_if_ready(session: dict[str, Any]) -> bool:
    """
    If meta + channels are set, treat strategy as accepted for template build.
    Audience is optional until launch.
    """
    if session.get("strategy_accepted"):
        return False
    if _campaign_meta_complete(session) and list(session.get("channels") or []):
        session["strategy_accepted"] = True
        return True
    return False


def _default_channel_plans(channels: list[str]) -> list[dict[str, Any]]:
    labels = {
        "email": "Personalized email with clear CTA",
        "whatsapp": "WhatsApp message with link or quick reply",
        "web": "Browser push notification on subscribed visitors",
        "push": "In-app push notification",
    }
    return [
        {
            "channel": ch,
            "how_it_works": labels.get(ch, "Campaign message on this channel"),
            "suggested_launch_at": "next business morning",
        }
        for ch in channels
    ]


async def handle_build_campaign(
    session_id: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.progress_status import emit_process_progress

    await emit_process_progress(event_callback, "templates")
    try:
        return await _handle_build_campaign_inner(
            session_id, args, event_callback=event_callback
        )
    except (httpx.TransportError, httpx.TimeoutException) as exc:
        logging.getLogger(__name__).warning(
            "build_campaign transport failure sid=%s: %s", session_id, exc
        )
        return {
            "ok": False,
            "error": "backend_temporarily_unavailable",
            "retry_suggested": True,
            "message": (
                "Template generation hit a temporary API disconnect. "
                "Tell the user briefly and offer to try again — "
                "do not restart the whole campaign."
            ),
            "user_message": (
                "<p>Template generation hit a temporary connection issue. "
                "Say <b>try again</b> when you want me to rebuild the templates.</p>"
            ),
        }


async def _handle_build_campaign_inner(
    session_id: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    mode = str(args.get("mode") or "create").strip().lower()
    confirmed = bool(args.get("user_confirmed"))
    # Persist channels from this call first (needed for templates + launch).
    channels = normalize_channels(args.get("channels")) or list(
        session.get("channels") or []
    )
    if channels and args.get("channels") is not None:
        existing = _dedupe_channels(list(session.get("channels") or []))
        session["channels"] = _dedupe_channels(existing + channels) if existing else channels
        if not list(session.get("channel_plans") or []):
            session["channel_plans"] = _default_channel_plans(session["channels"])
        await save_session(session)
    elif channels and not list(session.get("channels") or []):
        pass  # do not invent channels from empty session

    # Broadcast only when LLM passes orchestration_mode on this call.
    orch = str(args.get("orchestration_mode") or "").strip().lower()
    if orch == "broadcast":
        plan = (
            session.get("launch_plan")
            if isinstance(session.get("launch_plan"), dict)
            else {}
        )
        plan = dict(plan)
        plan["orchestration_mode"] = "broadcast"
        plan["broadcast_confirmed"] = True
        session["launch_plan"] = plan
        await save_session(session)

    meta_payload = merge_campaign_meta_from_history(args, session)
    if any(
        str(meta_payload.get(key) or "").strip()
        for key in ("name", "goal", "objective")
    ):
        await handle_set_campaign_details(session_id, meta_payload)
        session = await get_or_create_session(session_id)

    if args.get("whatsapp_retry") is not None:
        try:
            retry = int(args.get("whatsapp_retry"))
        except (TypeError, ValueError):
            retry = -1
        if retry in (0, 1, 2, 3):
            session["whatsapp_retry"] = retry
            await save_session(session)
    elif "whatsapp" in channels and session.get("whatsapp_retry") is None:
        # Default retries so template gen is not blocked when the model omits the field.
        session["whatsapp_retry"] = 0
        await save_session(session)

    if _ensure_strategy_accepted_if_ready(session):
        await save_session(session)

    if (
        mode == "create"
        and not session.get("strategy_accepted")
        and not list(session.get("templates") or [])
    ):
        if not _campaign_meta_complete(session):
            return {
                "ok": False,
                "error": "Campaign name, goal, and objective required.",
                "message": (
                    "Pass name, goal, and objective on update_campaign_meta or "
                    "on this build_campaign call."
                ),
            }
        return {
            "ok": False,
            "error": "Campaign is not ready for templates yet.",
            "message": (
                "Need name/goal/objective and channels before build_campaign. "
                "Pass channels on this call if the user already agreed them in chat. "
                "Audience can wait until launch."
            ),
        }

    if not channels:
        return {
            "ok": False,
            "error": "Select channels before building templates.",
            "message": (
                "Pass channels=[email|whatsapp|web|push] on build_campaign "
                "(app/app push → push; web push → web)."
            ),
        }

    if args.get("wants_images") is True:
        from app.agents.image.plan import set_image_plan

        plan_channels = channels or list(session.get("channels") or [])
        set_image_plan(
            session,
            wants_images=True,
            channels=plan_channels,
            auto_after_build=True,
            user_confirmed=bool(confirmed or mode == "regenerate"),
        )
        await save_session(session)

    creative_policy = _creative_policy_from_args(args)
    if creative_policy and creative_policy.get("image_mode") == "plan_new":
        from app.agents.image.plan import set_image_plan

        plan_channels = channels or list(session.get("channels") or [])
        set_image_plan(
            session,
            wants_images=True,
            channels=plan_channels,
            auto_after_build=True,
            user_confirmed=bool(confirmed or mode == "regenerate"),
        )
        await save_session(session)
    elif creative_policy and creative_policy.get("image_mode") in ("keep", "none"):
        from app.agents.image.plan import set_image_plan

        plan_channels = channels or list(session.get("channels") or [])
        set_image_plan(
            session,
            wants_images=False,
            channels=plan_channels,
            auto_after_build=False,
            user_confirmed=bool(confirmed or mode == "regenerate"),
        )
        await save_session(session)

    if args.get("wants_images") is False:
        from app.agents.image.plan import set_image_plan

        plan_channels = channels or list(session.get("channels") or [])
        set_image_plan(
            session,
            wants_images=False,
            channels=plan_channels,
            auto_after_build=False,
            user_confirmed=bool(confirmed or mode == "regenerate"),
        )
        await save_session(session)

    if mode == "regenerate":
        return await handle_regenerate_templates(
            session_id,
            {**args, "channels": channels or None},
            event_callback=event_callback,
        )

    if (
        creative_policy
        and creative_policy.get("content_mode") == "keep"
        and creative_policy.get("design_mode") == "keep"
    ):
        if not confirmed:
            return {
                "ok": False,
                "error": "User has not confirmed template creation yet.",
                "message": (
                    "Ask once to confirm adopting the library templates as-is, "
                    "then call build_campaign with user_confirmed=true, "
                    "content_mode=keep, design_mode=keep."
                ),
            }
        session["confirmed_create_templates"] = True
        await save_session(session)
        return await _adopt_seeded_library_templates(session_id, args)

    if creative_policy and creative_policy.get("scope") == "missing_only":
        missing = _library_channels_missing(session)
        if not missing:
            return {
                "ok": True,
                "channels": channels,
                "message": (
                    "No missing channels — every selected channel already has a template."
                ),
            }
        channels = missing
        args = {**args, "channels": missing}

    if not confirmed:
        return {
            "ok": False,
            "error": "User has not confirmed template creation yet.",
            "message": (
                "Ask once in your own words if you should create template cards now, "
                "or wait for clear go-ahead (yes / create / proceed / all at once)."
            ),
        }

    session["confirmed_create_templates"] = True
    await save_session(session)
    return await handle_create_templates(
        session_id,
        {**args, "channels": channels or None},
        event_callback=event_callback,
    )


async def handle_present_campaign_summary(
    session_id: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Persist name/goal/objective once and emit the recap panel."""
    session = await get_or_create_session(session_id)
    templates = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    if not templates:
        return {
            "ok": False,
            "error": "No templates yet.",
            "message": (
                "Call build_campaign first. After the user approves the cards, "
                "call present_campaign_summary."
            ),
        }

    meta_result = await handle_set_campaign_details(session_id, args)
    if meta_result.get("ok") is False:
        return meta_result
    session = await get_or_create_session(session_id)
    if not _campaign_meta_complete(session):
        return {
            "ok": False,
            "error": "Campaign name, goal, and objective required.",
            "message": (
                "Pass name, goal, and objective from this conversation on "
                "present_campaign_summary."
            ),
        }

    session["templates_finalized"] = True
    session["strategy_accepted"] = True
    session["summary_presented"] = True
    session["stage"] = "launch"
    await save_session(session)

    recap = _campaign_recap_payload(session)
    ui_event = {"type": "campaign_summary", "payload": recap}
    if event_callback:
        try:
            await event_callback(ui_event)
        except Exception:  # noqa: BLE001
            pass

    return {
        "ok": True,
        "recap": recap,
        "summary_presented": True,
        "message": (
            "Campaign recap saved "
            f"(name={recap.get('name')}; audience={recap.get('audience_count')}; "
            f"channels={recap.get('channels')}; templates={recap.get('template_ids')}). "
            "Ask the user to confirm launch now or pick a send time, then call launch_campaign."
        ),
        "ui_event": ui_event,
    }


async def handle_launch_campaign(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    from app.progress_status import emit_process_progress

    await emit_process_progress(event_callback, "launch")
    session = await get_or_create_session(session_id, token=token)
    session = await _hydrate_session_templates_from_db(
        session, session_id, append_unknown=True
    )
    await save_session(session, token=token)
    if bool(args.get("confirmed")):
        already = _already_launched_reply(session)
        if already and not _launch_retry_allowed(session):
            return already
        if _launch_retry_allowed(session) and not str(
            args.get("schedule_mode") or ""
        ).strip():
            args = dict(args)
            args["schedule_mode"] = "now"
    # Clear launch intent with existing cards = accept those templates.
    if list(session.get("templates") or []) and bool(args.get("confirmed")):
        session["templates_finalized"] = True
        await save_session(session)

    blocked = launch_blocked_reason(session)
    if blocked and bool(args.get("confirmed")):
        from app.agents.create_campaign.launch_guard import (
            launch_readiness_message,
            launch_readiness_user_html,
        )

        llm_msg = launch_readiness_message(session) or blocked
        user_html = launch_readiness_user_html(session) or f"<p>{blocked}</p>"
        return {
            "ok": False,
            "error": "launch_not_ready",
            "message": llm_msg,
            "user_message": user_html,
        }

    # Also block when launch_channels (this turn) still lack renderable templates.
    from app.agents.create_campaign.launch_guard import (
        launch_readiness_message as _ready_msg,
        launch_readiness_user_html as _ready_html,
    )

    readiness_session = _session_for_launch_readiness(
        session,
        {
            "launch_channels": normalize_channels(
                args.get("launch_channels") or session.get("channels") or []
            ),
        },
    )
    ready_err = _ready_msg(readiness_session)
    if ready_err and bool(args.get("confirmed")):
        return {
            "ok": False,
            "error": "launch_not_ready",
            "message": ready_err,
            "user_message": _ready_html(readiness_session)
            or "<p>We can't launch yet — some setup is still missing.</p>",
        }

    if bool(args.get("confirmed")):
        from app.integrations.email_launch_transport import email_channel_mailbox_block

        early_channels = normalize_channels(
            args.get("launch_channels") or session.get("channels") or []
        )
        mailbox_block = await email_channel_mailbox_block(
            channels=early_channels, token=token
        )
        if mailbox_block:
            return mailbox_block

    channels = normalize_channels(
        args.get("launch_channels") or session.get("channels") or []
    )
    prior = session.get("launch_plan") if isinstance(session.get("launch_plan"), dict) else {}
    schedule_mode, launch_local_date, launch_local_time, scheduled_at = (
        _launch_plan_timing_from_args(args, prior)
    )
    plan_args = {
        "launch_channels": channels,
        "schedule_mode": schedule_mode,
        "launch_local_date": launch_local_date,
        "launch_local_time": launch_local_time,
        "scheduled_at": scheduled_at,
        "timezone": args.get("timezone") or prior.get("timezone"),
        "primary_channel": args.get("primary_channel") or prior.get("primary_channel"),
        "orchestration_mode": (
            args.get("orchestration_mode")
            or prior.get("orchestration_mode")
            or "prefer_primary"
        ),
        "broadcast_confirmed": bool(args.get("broadcast_confirmed")),
        "change_summary": args.get("change_summary") or "Launch plan",
        "user_text": str(args.get("user_text") or "").strip() or _last_user_text(session),
    }
    plan_result = await handle_set_launch_plan(session_id, token, plan_args)
    if not plan_result.get("ok", True) and plan_result.get("error"):
        return plan_result

    if not bool(args.get("confirmed")):
        return {
            **plan_result,
            "ok": True,
            "confirmed": False,
            "message": (
                plan_result.get("message")
                or "Launch plan saved. Confirm send now or schedule to go live."
            ),
        }

    launch_result = await handle_confirm_launch(
        session_id,
        token,
        {
            "confirmed": True,
            "change_summary": args.get("change_summary") or "Launch",
            "user_text": str(args.get("user_text") or "").strip()
            or _last_user_text(await get_or_create_session(session_id, token=token)),
        },
    )
    if event_callback and launch_result.get("ui_event"):
        await event_callback(launch_result["ui_event"])
    return launch_result


async def handle_update_campaign_setup(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Single right-panel updater: meta, channels, CRM segment audience (partial OK)."""
    payload = dict(args) if isinstance(args, dict) else {}
    summary = str(payload.get("change_summary") or "Updated campaign setup").strip()
    updated: list[str] = []
    results: dict[str, Any] = {"ok": True, "updated_fields": updated}

    session_pre = await get_or_create_session(session_id)
    camp_pre = (
        session_pre.get("campaign")
        if isinstance(session_pre.get("campaign"), dict)
        else {}
    )
    existing_name = str(camp_pre.get("name") or "").strip()
    incoming_name = str(payload.get("name") or "").strip()
    incoming_goal = str(payload.get("goal") or "").strip()
    incoming_objective = str(payload.get("objective") or "").strip()
    ui_pre = (
        session_pre.get("ui") if isinstance(session_pre.get("ui"), dict) else {}
    )
    suggestions_offered = bool(ui_pre.get("name_suggestions_offered"))
    # Readiness gate: goal/objective without a title → require suggest_campaign_names once.
    if (
        (incoming_goal or incoming_objective)
        and not incoming_name
        and not existing_name
        and not suggestions_offered
    ):
        return {
            "ok": False,
            "error": "needs_name_suggestions",
            "needs_name_suggestions": True,
            "updated_fields": [],
            "agent_instruction": (
                "Campaign title is still empty. Call suggest_campaign_names with exactly "
                "three short names based on the goal/objective, present them in your HTML "
                "reply, then after the user picks call update_campaign_setup with name=."
            ),
            "user_message": (
                "<p>I can lock in the goal — pick a campaign name next. "
                "I'll suggest three short options.</p>"
            ),
        }

    meta_keys = (
        "name",
        "goal",
        "objective",
        "user_text",
        "strategy_summary",
        "strategy_accepted",
        "whatsapp_retry",
        "templates_finalized",
    )
    has_meta = any(
        payload.get(k) is not None and str(payload.get(k) or "").strip() != ""
        for k in ("name", "goal", "objective", "strategy_summary")
    ) or any(
        k in payload and payload.get(k) is not None
        for k in (
            "strategy_accepted",
            "whatsapp_retry",
            "templates_finalized",
        )
    )
    if has_meta:
        meta_args = {k: payload.get(k) for k in meta_keys if k in payload}
        meta_args["change_summary"] = summary
        meta_result = await handle_update_campaign_meta(
            session_id, meta_args, event_callback=event_callback
        )
        results["meta"] = meta_result
        if meta_result.get("ok") is False:
            return {
                **meta_result,
                "ok": False,
                "updated_fields": updated,
                "message": meta_result.get("message")
                or meta_result.get("error")
                or "Could not update campaign details.",
            }
        updated.append("meta")

    audience_text = str(payload.get("audience_text") or "").strip()
    if audience_text:
        aud_result = await handle_select_audience(
            session_id,
            token,
            {
                "user_text": audience_text,
                "change_summary": summary or "Audience from setup",
            },
            event_callback=event_callback,
        )
        results["audience"] = aud_result
        count = int(aud_result.get("matched_count") or 0)
        if aud_result.get("ok") is False or count <= 0:
            return {
                "ok": False,
                "found": False,
                "matched_count": count,
                "updated_fields": updated,
                "audience": aud_result,
                "message": (
                    aud_result.get("message")
                    or "No contacts matched that audience. "
                    "Need contacts (or different filters) before this campaign can run."
                ),
            }
        updated.append("audience")

    channels_raw = payload.get("channels")
    user_text_setup = str(payload.get("user_text") or audience_text or "").strip()
    if channels_raw is not None:
        if not bool(payload.get("channels_confirmed")):
            return {
                "ok": False,
                "error": "channels_not_confirmed",
                "updated_fields": updated,
                "agent_instruction": (
                    "Channels were not saved — user has not confirmed channels this turn. "
                    "Do not default to email. Ask which channels (email, whatsapp, "
                    "web push=web/web_push, app push=push/app_push) in your HTML reply, "
                    "then call update_campaign_setup with channels=[...] and "
                    "channels_confirmed=true."
                ),
                "user_message": (
                    "<p>Which channels should we use for this campaign — "
                    "<b>email</b>, <b>WhatsApp</b>, <b>web push</b>, or <b>app push</b>?</p>"
                ),
            }
        if has_meta:
            return {
                "ok": False,
                "error": "channels_with_meta",
                "updated_fields": updated,
                "agent_instruction": (
                    "Save meta and channels in separate tool calls unless the user gave "
                    "both in one message. This turn: save meta only (no channels), ask "
                    "which channels in your reply."
                ),
                "user_message": (
                    "<p>Understood. I'll save your campaign details first, then confirm "
                    "channels in a separate step.</p>"
                ),
            }
        ch_result = await handle_set_channels_core(
            session_id,
            {
                "channels": channels_raw,
                "user_text": user_text_setup,
                "channel_plans": payload.get("channel_plans"),
                "orchestration_mode": payload.get("orchestration_mode"),
                "change_summary": summary or "Channels from setup",
            },
            event_callback=event_callback,
        )
        results["channels"] = ch_result
        if ch_result.get("ok") is False:
            return {
                **ch_result,
                "ok": False,
                "updated_fields": updated,
            }
        updated.append("channels")
        if ch_result.get("send_strategy_facts"):
            results["send_strategy_facts"] = ch_result.get("send_strategy_facts")
        if ch_result.get("show_send_strategy") is not None:
            results["show_send_strategy"] = ch_result.get("show_send_strategy")

    # Optional send-plan fields on the launch_plan / send_strategy.
    orch = str(payload.get("orchestration_mode") or "").strip().lower()
    primary = str(payload.get("primary_channel") or "").strip().lower()
    if orch or primary:
        session = await get_or_create_session(session_id)
        plan = (
            session.get("launch_plan")
            if isinstance(session.get("launch_plan"), dict)
            else {}
        )
        plan = dict(plan)
        if orch in ("prefer_primary", "staggered", "broadcast"):
            plan["orchestration_mode"] = orch
            strategy = (
                plan.get("send_strategy")
                if isinstance(plan.get("send_strategy"), dict)
                else {}
            )
            strategy = dict(strategy)
            strategy["mode"] = orch
            if orch == "broadcast":
                messaging = list(session.get("channels") or plan.get("channel_sequence") or [])
                plan["launch_channels"] = list(messaging)
                strategy["t0_channels"] = list(messaging)
                plan["broadcast_confirmed"] = True
            elif primary or strategy.get("primary_channel") or plan.get("primary_channel"):
                p = primary or str(
                    strategy.get("primary_channel") or plan.get("primary_channel") or ""
                ).strip().lower()
                if p:
                    plan["primary_channel"] = p
                    plan["launch_channels"] = [p]
                    strategy["primary_channel"] = p
                    strategy["t0_channels"] = [p]
            plan["send_strategy"] = strategy
            results["send_strategy_facts"] = send_strategy_facts_for_llm(strategy)
            results["show_send_strategy"] = bool(
                results["send_strategy_facts"].get("multi_channel")
            )
        if primary:
            plan["primary_channel"] = primary
        session["launch_plan"] = plan
        if plan.get("send_strategy"):
            session["send_strategy"] = plan["send_strategy"]
        await save_session(session)
        updated.append("send_plan")

    if not updated:
        return {
            "ok": False,
            "error": "No setup fields provided.",
            "message": (
                "Pass name/goal/objective, channels, and/or audience_text "
                "(or use check_contacts for named people)."
            ),
            "updated_fields": [],
        }

    session = await get_or_create_session(session_id)
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    results["panel"] = {
        "name": camp.get("name") or "",
        "goal": camp.get("goal") or "",
        "objective": camp.get("objective") or "",
        "channels": list(session.get("channels") or []),
        "matched_count": int(aud.get("matched_count") or 0),
        "audience_description": aud.get("description") or "",
    }
    results["message"] = (
        f"Campaign setup updated ({', '.join(updated)}). "
        "Write your own short HTML reply from these facts — no template blocks."
    )
    if results.get("show_send_strategy"):
        results["message"] += (
            " Multi-channel: one short positive audience-care line from "
            "send_strategy_facts in your own words (never paste fixed copy), "
            "then ask once to create templates."
        )
    return results


async def handle_upload_temporary_contacts(
    session_id: str,
    token: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Validate + store sheet rows as temporary contacts for this campaign session."""
    from app.progress_status import emit_process_progress

    await emit_process_progress(event_callback, "filtering")

    raw_rows = args.get("rows")
    if not isinstance(raw_rows, list) or not raw_rows:
        return {
            "ok": False,
            "error": "TEMP_CONTACTS_EMPTY",
            "message": "Pass rows from the uploaded contact sheet (email or phone required).",
        }

    rows: list[dict[str, Any]] = []
    for item in raw_rows:
        if not isinstance(item, dict):
            continue
        # Accept both camelCase and snake_case from FE / LLM.
        row = {
            "firstName": item.get("firstName") or item.get("first_name") or "",
            "lastName": item.get("lastName") or item.get("last_name") or "",
            "email": item.get("email") or "",
            "phone": item.get("phone")
            or item.get("whatsappNumber")
            or item.get("phoneNumber")
            or "",
            "companyName": item.get("companyName")
            or item.get("company_name")
            or item.get("company")
            or "",
            "city": item.get("city") or "",
            "name": item.get("name") or "",
        }
        rows.append(row)

    if not rows:
        return {
            "ok": False,
            "error": "TEMP_CONTACTS_EMPTY",
            "message": "No usable contact rows in the upload.",
        }

    try:
        body = await save_temp_contacts(session_id, rows, token=token)
    except Exception as exc:  # noqa: BLE001
        logger.exception("upload_temporary_contacts failed")
        return {
            "ok": False,
            "error": "TEMP_CONTACTS_SAVE_FAILED",
            "message": str(exc)[:240],
        }

    summary = body.get("summary") if isinstance(body.get("summary"), dict) else {}
    inserted = int(summary.get("inserted") or 0)
    failed = int(summary.get("failed") or 0)
    total = int(summary.get("total") or len(rows))
    sample = body.get("sample") if isinstance(body.get("sample"), list) else []
    temp_summary = str(body.get("temporary_contact_summary") or "").strip()
    errors = body.get("errors") if isinstance(body.get("errors"), list) else []

    session = await get_or_create_session(session_id)
    aud = session.setdefault("audience", {})
    if not isinstance(aud, dict):
        aud = {}
        session["audience"] = aud
    aud["source"] = "temporary_upload"
    aud["matched_count"] = inserted
    aud["description"] = temp_summary or f"{inserted} temporary contacts"
    aud["sample_names"] = [
        (
            " ".join(
                p
                for p in (
                    str(s.get("firstName") or "").strip(),
                    str(s.get("lastName") or "").strip(),
                )
                if p
            ).strip()
            or str(s.get("email") or s.get("phone") or "").strip()
        )
        for s in sample[:5]
        if isinstance(s, dict)
    ]
    session["temporary_contact_summary"] = temp_summary
    session["temporary_contact_count"] = inserted
    await save_session(session, token=token)

    # Temp audience replaces CRM audience refs for this draft.
    try:
        await save_audience_ids(session_id, [], token=token)
    except Exception as exc:  # noqa: BLE001
        logger.warning("clear audience refs after temp upload failed: %s", exc)

    msg = (
        f"Saved <b>{inserted}</b> temporary contact(s) for this campaign "
        f"({failed} row(s) failed validation of {total})."
    )
    if inserted <= 0:
        msg = (
            f"No temporary contacts were saved ({failed} of {total} failed validation). "
            "Each row needs a valid email or phone (with country code)."
        )

    if inserted > 0:
        session = await get_or_create_session(session_id)
        if session.get("whatsapp_approved_run"):
            from app.agents.whatsapp_approved.launch_helpers import (
                finalize_whatsapp_approved_audience,
                wa_audience_tool_suffix,
            )

            fin = await finalize_whatsapp_approved_audience(session_id, token)
            session = await get_or_create_session(session_id)
            msg += wa_audience_tool_suffix(session)
            if not fin.get("ok") and fin.get("error"):
                msg += f" AUDIENCE_FREEZE_WARN: {fin.get('error')}"

    return {
        "ok": inserted > 0,
        "inserted": inserted,
        "failed": failed,
        "total": total,
        "sample": sample[:5],
        "errors": errors[:20],
        "temporary_contact_summary": temp_summary,
        "matched_count": inserted,
        "audience_source": "temporary_upload",
        "message": msg,
        "user_message": f"<p>{msg}</p>",
    }


async def handle_suggest_campaign_names(
    session_id: str,
    args: dict[str, Any],
    *,
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Persist three LLM-provided name options for the user to pick (once per gap)."""
    payload = dict(args) if isinstance(args, dict) else {}
    raw_names = payload.get("names")
    if not isinstance(raw_names, list):
        return {
            "ok": False,
            "error": "names_required",
            "agent_instruction": "Pass names=[three short titles].",
        }
    cleaned: list[str] = []
    seen: set[str] = set()
    for row in raw_names:
        name = " ".join(str(row or "").split()).strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(name[:80])
        if len(cleaned) >= 3:
            break
    if len(cleaned) < 3:
        return {
            "ok": False,
            "error": "need_three_names",
            "agent_instruction": (
                "Provide exactly three distinct short campaign names in names=[...]."
            ),
        }

    session = await get_or_create_session(session_id)
    ui = session.get("ui") if isinstance(session.get("ui"), dict) else {}
    ui = dict(ui)
    ui["name_suggestions"] = cleaned
    ui["name_suggestions_offered"] = True
    based_on = str(payload.get("based_on_goal") or "").strip()
    if based_on:
        ui["name_suggestions_based_on"] = based_on[:240]
    session["ui"] = ui
    await save_session(session)

    if event_callback:
        try:
            from app.session_store import public_state

            fresh = await get_or_create_session(session_id)
            await event_callback(
                {"type": "state_update", "state": public_state(fresh)}
            )
        except Exception:  # noqa: BLE001
            pass

    return {
        "ok": True,
        "names": cleaned,
        "name_suggestions_offered": True,
        "agent_instruction": (
            "Present these three names in your HTML reply and ask which to use. "
            "On their pick, call update_campaign_setup with name= their choice "
            "(plus goal/objective if not already saved)."
        ),
        "user_message": (
            "<p>Here are three short name options:</p><ol>"
            + "".join(f"<li>{n}</li>" for n in cleaned)
            + "</ol><p>Which one should we use?</p>"
        ),
    }


async def handle_search_knowledge(
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Create-campaign tool: tenant KB via context_layer. LLM supplies query only."""
    _ = event_callback
    query = str((args or {}).get("query") or (args or {}).get("restated_query") or "").strip()
    module = str((args or {}).get("module") or "auto").strip().lower() or "auto"
    session = await get_or_create_session(session_id, token=token or None)
    from app.knowledge_base import search_knowledge_for_agent

    out = await search_knowledge_for_agent(
        query=query,
        session=session,
        token=token,
        module=module,
    )
    if out.get("snippets"):
        session["last_kb_snippets"] = str(out["snippets"])[:4000]
        try:
            await save_session(session, token=token or None)
        except Exception:  # noqa: BLE001
            pass
    return out


async def dispatch_core_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    if name in ("update_campaign_setup", "update_campaign_meta"):
        if name == "update_campaign_meta" and not any(
            k in (args or {})
            for k in ("channels", "audience_text", "orchestration_mode", "primary_channel")
        ):
            return await handle_update_campaign_meta(
                session_id, args, event_callback=event_callback
            )
        return await handle_update_campaign_setup(
            session_id, token, args, event_callback=event_callback
        )
    if name == "suggest_campaign_names":
        return await handle_suggest_campaign_names(
            session_id, args, event_callback=event_callback
        )
    if name == "select_audience":
        return await handle_select_audience(
            session_id, token, args, event_callback=event_callback
        )
    if name in ("check_contacts", "lookup_contacts"):
        return await handle_lookup_contacts(
            session_id, token, args, event_callback=event_callback
        )
    if name == "create_contact":
        return await handle_create_contact_for_campaign(
            session_id, token, args, event_callback=event_callback
        )
    if name == "upload_temporary_contacts":
        return await handle_upload_temporary_contacts(
            session_id, token, args, event_callback=event_callback
        )
    if name == "update_contact":
        return await handle_update_contact_for_campaign(
            session_id, token, args, event_callback=event_callback
        )
    if name == "set_channels":
        return await handle_set_channels_core(
            session_id, args, event_callback=event_callback
        )
    if name == "build_campaign":
        return await handle_build_campaign(
            session_id, args, event_callback=event_callback
        )
    if name == "inspect_session_template":
        return await handle_inspect_session_template(session_id, args)
    if name == "present_campaign_summary":
        return {
            "ok": False,
            "error": "recap_removed",
            "message": (
                "Do not recap or ask to show a summary. "
                "If the user confirmed send, call launch_campaign "
                "with confirmed=true and schedule_mode=now "
                "(or at if they named a time)."
            ),
        }
    if name == "launch_campaign":
        return await handle_launch_campaign(
            session_id, token, args, event_callback=event_callback
        )
    if name in ("set_email_ab", "SET_EMAIL_AB"):
        return await handle_set_email_ab(
            session_id, args, event_callback=event_callback
        )
    if name == "plan_campaign_images":
        from app.agents.image.tools.handlers import dispatch_tool as image_dispatch

        return await image_dispatch(
            "PLAN_CAMPAIGN_IMAGES",
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )
    if name == "confirm_chat_images":
        from app.agents.image.tools.handlers import dispatch_tool as image_dispatch

        return await image_dispatch(
            "CONFIRM_CHAT_IMAGES",
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )
    if name == "clear_chat_images":
        from app.agents.image.tools.handlers import dispatch_tool as image_dispatch

        return await image_dispatch(
            "CLEAR_CHAT_IMAGES",
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )
    if name == "search_knowledge":
        return await handle_search_knowledge(
            session_id, token, args, event_callback=event_callback
        )
    return {"ok": False, "error": f"Unknown tool: {name}"}
