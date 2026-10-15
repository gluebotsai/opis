"""Audience filtering specialist — LLM tool loop (multi_agent style).

Create-campaign calls this via RECOMMEND_AUDIENCE. The model chooses tools to
segment, suggest, or look up contacts. No regex phrase lists for intent.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

import httpx


def is_all_contacts_request(_t: str) -> bool:
    return False

def is_invalid_person_search(_t: str) -> bool:
    return False

def normalize_person_search(s: str) -> str:
    return str(s or "").strip()

def try_identity_plan(**_k):
    return None
from app.agents.create_campaign.tool_functions import (
    _extract_emails_from_text,
    _extract_phones_from_text,
    _normalize_email_list,
    _normalize_phone_list,
    handle_filter_contacts,
    handle_set_channels,
)
from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_S,
    CHAT_MAX_TOKENS,
    CHAT_REASONING_EFFORT,
    OpenAILLM,
)
from app.session_store import get_or_create_session, save_session

_MAX_TOOL_ROUNDS = 4
_CATALOG_CACHE_TTL_S = 300.0
_catalog_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

_CORE_FALLBACK_FIELDS: list[dict[str, str]] = [
    {
        "key": "emails",
        "source": "core",
        "type": "string[]",
        "description": "Exact primary emails (OR)",
    },
    {
        "key": "phones",
        "source": "core",
        "type": "string[]",
        "description": "Exact phones, digit-normalized / last-10 (OR)",
    },
    {
        "key": "city",
        "source": "core",
        "type": "string",
        "description": "Profile city",
    },
    {
        "key": "company",
        "source": "core",
        "type": "string",
        "description": "Profile company",
    },
    {
        "key": "search",
        "source": "core",
        "type": "string",
        "description": "Free-text name / email / company / city / phone; matches first, last, and full name",
    },
    {
        "key": "has_email",
        "source": "core",
        "type": "boolean",
        "description": "Require a stored email",
    },
    {
        "key": "has_phone",
        "source": "core",
        "type": "boolean",
        "description": "Require a stored phone",
    },
    {
        "key": "consent_source",
        "source": "core",
        "type": "string",
        "description": "custom_fields.campaign_consent_source",
    },
    {
        "key": "preferred_channel",
        "source": "core",
        "type": "string",
        "description": "preferences_json channel = 1 (email|whatsapp|push|web|sms)",
    },
]

_FIRST_CLASS = {
    "emails",
    "phones",
    "city",
    "company",
    "search",
    "has_email",
    "has_phone",
    "consent_source",
    "job_title",
    "segment",
    "product_interest",
    "min_score",
    "preferred_channel",
}

_AUDIENCE_AGENT_SYSTEM = """You are the audience filtering specialist for Worktual Campaign.
You understand who should receive the campaign and call exactly one tool per turn.
Decide from meaning in the user message and conversation — never from keyword lists.

Rules:
- Use ONLY field keys from the catalog in filter tools. Never invent keys or values
  copied from campaign name, goal, or objective.
- FULL AUDIENCE: user wants everyone / the whole list / all audience / all customers /
  all contacts / entire CRM — any natural phrasing with that meaning →
  APPLY_AUDIENCE_FILTER with mode=replace and filters={} (empty object). That selects
  the full CRM audience. Never use AUDIENCE_CLARIFY for that intent.
- SEGMENT: user named stored fields (city, company, segment, job_title,
  preferred_channel, custom fields…).
  Call APPLY_AUDIENCE_FILTER with mode replace or add.
  preferred_channel = contacts with preferences_json that channel = 1
  (email|whatsapp|push|web|sms) — e.g. people most active on email.
- NAMED PEOPLE: email, phone, or a person's name.
  If user_text contains a concrete email or phone, you MUST call APPLY_AUDIENCE_FILTER
  with mode=replace and filters.emails and/or filters.phones (all addresses/numbers
  mentioned). Do NOT use AUDIENCE_CLARIFY for a clear email/phone.
  Use filters.search only for name-only requests without email/phone in the message.
  search matches first name, last name, and full name. mode replace drops leftover segments.
  Multiple emails/phones → put all of them in the emails/phones arrays.
  Campaign name / offer copy in the same message does not block named-person filters —
  extract emails/phones and apply them.
- Follow-ups: interpret keep / someone else / WhatsApp only / yes from conversation
  and prior_filters — do NOT rely on keyword matching.
- mode keep_prior: user confirms the same contact already in prior_filters.
- prefer_channels_without_email true when user accepts WhatsApp-only (no email on file).
- AUDIENCE_SKIP: message is about campaign idea, name, goal, channels, templates,
  launch — NOT who to send to. Skip only when no named person and no segment is present.
- AUDIENCE_CLARIFY: when they want audience but meaning is truly unclear, OR the
  message is unintelligible / contradictory for WHO — do not invent filters.
  Never clarify full-list intent.
  Never AUDIENCE_CLARIFY when the message includes a concrete email or phone — apply filters.
- Listing available filters: not your job to dump catalogs in tools — the coordinator
  answers from Context. If they ask you to apply something not in the catalog,
  AUDIENCE_CLARIFY with unsupported keys.
- Never ask for email when they gave phone or only a name.
- consent_source only when they ask for a consent bucket.
- add mode only when they mean also / plus / in addition.
"""

APPLY_AUDIENCE_FILTER_TOOL = {
    "type": "function",
    "function": {
        "name": "APPLY_AUDIENCE_FILTER",
        "description": (
            "Apply CRM audience filters and run the contact search. "
            "Use catalog keys only. When user_text names an email or phone, call this "
            "with mode=replace and filters.emails / filters.phones — do not skip to "
            "AUDIENCE_CLARIFY."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["replace", "add", "remove", "keep_prior"],
                    "description": (
                        "replace = new segment or named lookup; add = union filters; "
                        "remove = drop keys; keep_prior = reuse prior_filters identity"
                    ),
                },
                "filters": {
                    "type": "object",
                    "description": (
                        "Filter key-values from the catalog. "
                        "Use {} (empty) with mode=replace for the full audience list "
                        "(everyone / all audience / all customers — any natural phrasing)."
                    ),
                },
                "remove_keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Top-level filter keys to remove when mode=remove.",
                },
                "change_summary": {
                    "type": "string",
                    "description": "Short summary for the UI.",
                },
                "why": {
                    "type": "string",
                    "description": "Brief reason for this filter choice.",
                },
                "prefer_channels_without_email": {
                    "type": "boolean",
                    "description": (
                        "True when user wants WhatsApp-only and email should drop "
                        "from channels."
                    ),
                },
            },
            "required": ["mode", "change_summary", "why"],
        },
    },
}

AUDIENCE_CLARIFY_TOOL = {
    "type": "function",
    "function": {
        "name": "AUDIENCE_CLARIFY",
        "description": (
            "Only when audience intent is truly unclear. Never use for full-list / "
            "everyone / all audience meaning — use APPLY with empty filters instead. "
            "Never use when the message includes a concrete email or phone — APPLY "
            "with filters.emails / filters.phones instead. "
            "The coordinator LLM writes the user-facing question; do not invent scripts."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "unsupported": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Catalog keys they asked for that do not exist.",
                },
                "why": {
                    "type": "string",
                    "description": "Brief internal reason the choice is unclear.",
                },
            },
            "required": ["why"],
        },
    },
}

AUDIENCE_SKIP_TOOL = {
    "type": "function",
    "function": {
        "name": "AUDIENCE_SKIP",
        "description": (
            "User message is NOT about target audience (campaign idea, launch, etc.)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "why": {"type": "string"},
            },
            "required": ["why"],
        },
    },
}

_AUDIENCE_TOOLS = [
    APPLY_AUDIENCE_FILTER_TOOL,
    AUDIENCE_CLARIFY_TOOL,
    AUDIENCE_SKIP_TOOL,
]

_TOOL_NAMES = {t["function"]["name"] for t in _AUDIENCE_TOOLS}


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def _parse_tool_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw or "{}")
        except json.JSONDecodeError:
            return {}
    return {}


def _norm_channels(raw: Any) -> list[str]:
    out: list[str] = []
    for item in raw or []:
        ch = str(item or "").strip().lower().replace(" ", "_").replace("-", "_")
        if ch in ("web_push", "webpush"):
            ch = "web"
        elif ch in ("app_push", "mobile_push"):
            ch = "push"
        if ch and ch not in out:
            out.append(ch)
    return out


async def load_filterable_fields(token: str) -> list[dict[str, Any]]:
    cache_key = (token or "")[-24:] or "anon"
    now = time.monotonic()
    cached = _catalog_cache.get(cache_key)
    if cached and (now - cached[0]) < _CATALOG_CACHE_TTL_S:
        return list(cached[1])

    settings = get_settings()
    url = f"{settings.campaign_api_base.rstrip('/')}/contacts/filterable-fields"
    headers = {"Authorization": f"Bearer {token}"}
    fallback = list(_CORE_FALLBACK_FIELDS)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            body = res.json()
        fields = body.get("fields") or (body.get("data") or {}).get("fields")
        if isinstance(fields, list) and fields:
            clean: list[dict[str, Any]] = []
            for row in fields:
                if not isinstance(row, dict):
                    continue
                key = str(row.get("key") or "").strip()
                if not key:
                    continue
                clean.append(
                    {
                        "key": key,
                        "source": str(row.get("source") or "custom_fields"),
                        "type": str(row.get("type") or "string"),
                        "description": str(row.get("description") or key),
                    }
                )
            if clean:
                _catalog_cache[cache_key] = (now, clean)
                return clean
    except Exception:  # noqa: BLE001
        pass
    _catalog_cache[cache_key] = (now, fallback)
    return fallback


def _catalog_index(
    catalog: list[dict[str, Any]],
) -> tuple[set[str], set[str]]:
    keys = {str(f.get("key") or "") for f in catalog if f.get("key")}
    custom = {
        str(f.get("key") or "")
        for f in catalog
        if str(f.get("source") or "") == "custom_fields"
        and str(f.get("key") or "") not in _FIRST_CLASS
    }
    return keys, custom


def _is_identity_only(filters: dict[str, Any]) -> bool:
    phones = _normalize_phone_list(filters.get("phones"))
    emails = _normalize_email_list(filters.get("emails"))
    name = str(filters.get("search") or "").strip()
    if not phones and not emails and not name:
        return False
    for key, val in filters.items():
        if key in ("phones", "emails"):
            continue
        if key == "search" and name and not phones and not emails:
            continue
        if val is None or val == "" or val == [] or val == {}:
            continue
        return False
    return True


def _sanitize_filters(
    raw: Any,
    *,
    catalog_keys: set[str],
    custom_keys: set[str],
) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(raw, dict):
        return {}, []
    out: dict[str, Any] = {}
    extra: dict[str, Any] = {}
    unsupported: list[str] = []

    nested = raw.get("custom_fields")
    incoming: dict[str, Any] = {
        k: v for k, v in raw.items() if k != "custom_fields"
    }
    if isinstance(nested, dict):
        for nk, nv in nested.items():
            incoming[str(nk)] = nv

    for key, val in incoming.items():
        k = str(key or "").strip()
        if not k or val is None or val == "" or val == [] or val == {}:
            continue
        if k == "emails":
            emails = _normalize_email_list(val if isinstance(val, list) else [val])
            if emails:
                out["emails"] = emails
            continue
        if k == "phones":
            phones = _normalize_phone_list(val if isinstance(val, list) else [val])
            if phones:
                out["phones"] = phones
            continue
        if k in ("has_email", "has_phone"):
            if k in catalog_keys:
                out[k] = bool(val)
            continue
        if k == "min_score":
            if "min_score" not in catalog_keys:
                unsupported.append(k)
                continue
            try:
                out["min_score"] = float(val)
            except (TypeError, ValueError):
                unsupported.append("min_score")
            continue
        if k in _FIRST_CLASS:
            if k not in catalog_keys:
                unsupported.append(k)
                continue
            out[k] = str(val).strip() if not isinstance(val, bool) else val
            continue
        if k in custom_keys or k in catalog_keys:
            extra[k] = val
            continue
        unsupported.append(k)

    if extra:
        out["custom_fields"] = extra
    if out.get("phones"):
        out.pop("has_email", None)
    if _is_identity_only(out):
        identity: dict[str, Any] = {}
        if out.get("emails"):
            identity["emails"] = out["emails"]
        if out.get("phones"):
            identity["phones"] = out["phones"]
        elif str(out.get("search") or "").strip():
            identity["search"] = normalize_person_search(str(out["search"]))
        return identity, unsupported
    if str(out.get("search") or "").strip():
        out["search"] = normalize_person_search(str(out["search"]))
    return out, unsupported


def identity_filters_from_text(
    text: str, campaign: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Legacy helper — typed email/phone in text (format only, not intent)."""
    _ = campaign
    phones = _extract_phones_from_text(text or "")
    emails = _extract_emails_from_text(text or "")
    out: dict[str, Any] = {}
    if phones:
        out["phones"] = phones
    if emails:
        out["emails"] = emails
    return out


def _campaign_blob(campaign: dict[str, Any] | None) -> str:
    camp = campaign or {}
    return " ".join(
        str(camp.get(k) or "") for k in ("name", "goal", "objective")
    ).lower()


def _invented_from_campaign(
    value: Any, user_text: str, campaign: dict[str, Any] | None
) -> bool:
    """No static/word heuristics — catalog + LLM own filter values."""
    _ = (value, user_text, campaign)
    return False


def _strip_campaign_leak(
    filters: dict[str, Any],
    user_text: str,
    campaign: dict[str, Any] | None,
) -> dict[str, Any]:
    out = dict(filters or {})
    for key in ("search", "product_interest", "segment"):
        if key in out and _invented_from_campaign(out.get(key), user_text, campaign):
            out.pop(key, None)
    cf = out.get("custom_fields")
    if isinstance(cf, dict):
        cleaned = {
            k: v
            for k, v in cf.items()
            if not _invented_from_campaign(v, user_text, campaign)
        }
        if cleaned:
            out["custom_fields"] = cleaned
        else:
            out.pop("custom_fields", None)
    return out


def identity_followup_should_run(
    user_text: str,
    session: dict[str, Any] | None,
    campaign: dict[str, Any] | None = None,
) -> bool:
    """True when session expects an audience identity follow-up turn."""
    _ = user_text
    _ = campaign
    if not session:
        return False
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    return bool(aud.get("awaiting_identity_confirm"))


def _named_person_result(result: dict[str, Any], filters: dict[str, Any] | None) -> bool:
    why = str((result or {}).get("why") or "")
    if why.startswith("lookup") or "named" in why.lower() or why == "keep named contact":
        return True
    src = filters or {}
    if _normalize_phone_list(src.get("phones")) or _normalize_email_list(src.get("emails")):
        return True
    if str(src.get("search") or "").strip():
        return True
    if result.get("phones_matched") or result.get("phones_missing"):
        return True
    if result.get("emails_matched") or result.get("emails_missing"):
        return True
    return False


def _channels_without_email(channels: list[Any] | None) -> list[str]:
    keep = [c for c in _norm_channels(channels) if c != "email"]
    if "whatsapp" not in keep:
        keep.insert(0, "whatsapp")
    return keep or ["whatsapp"]


def _empty_plan(*, why: str, intent: str = "none") -> dict[str, Any]:
    return {
        "intent": intent,
        "filters": {},
        "drop_keys": [],
        "unsupported": [],
        "why": why,
        "needs_clarification": "",
        "keep_prior": False,
        "prefer_channels_without_email": False,
    }


def _plan_from_apply_tool(
    args: dict[str, Any],
    *,
    catalog_keys: set[str],
    custom_keys: set[str],
    user_text: str,
    campaign: dict[str, Any] | None,
    prior_filters: dict[str, Any] | None,
) -> dict[str, Any]:
    mode = str(args.get("mode") or "replace").strip().lower()
    keep_prior = mode == "keep_prior"
    exec_intent = mode if mode in {"replace", "add", "remove"} else "replace"

    filters, unsupported_keys = _sanitize_filters(
        args.get("filters") if not keep_prior else (prior_filters or {}),
        catalog_keys=catalog_keys,
        custom_keys=custom_keys,
    )
    if keep_prior and prior_filters:
        filters = dict(prior_filters)
        if args.get("filters"):
            extra, extra_unsup = _sanitize_filters(
                args.get("filters"),
                catalog_keys=catalog_keys,
                custom_keys=custom_keys,
            )
            filters.update(extra)
            unsupported_keys = list(dict.fromkeys([*unsupported_keys, *extra_unsup]))

    filters = _strip_campaign_leak(filters, user_text, campaign)
    # Never treat filler/full-list tokens as person search ("all" → full list).
    search_raw = str(filters.get("search") or "").strip()
    if search_raw and is_invalid_person_search(search_raw):
        filters.pop("search", None)

    drop_keys = [
        str(k).strip()
        for k in (args.get("remove_keys") or [])
        if str(k).strip() in catalog_keys
    ]
    if mode == "remove" and not drop_keys and args.get("remove_keys"):
        drop_keys = [str(k).strip() for k in args.get("remove_keys") if str(k).strip()]

    why = str(args.get("why") or args.get("change_summary") or "").strip()
    if keep_prior:
        why = why or "keep named contact"

    intent = exec_intent
    if _is_identity_only(filters) and intent == "replace":
        intent = "replace"

    # Specialist called APPLY with empty filters → full Audience list.
    # Trust the tool choice (LLM intent). Do NOT coerce to clarify via wording/regex.
    all_contacts = False
    if intent in {"replace", "add"} and not filters and not keep_prior:
        all_contacts = True
        intent = "replace"
        why = why or "full audience"

    return {
        "intent": intent,
        "filters": filters,
        "drop_keys": drop_keys,
        "unsupported": unsupported_keys,
        "why": why or "planned from user message",
        "needs_clarification": "",
        "catalog_keys": sorted(catalog_keys),
        "keep_prior": keep_prior,
        "prefer_channels_without_email": bool(
            args.get("prefer_channels_without_email")
        ),
        "all_contacts": all_contacts,
    }


async def _dispatch_audience_tool(
    name: str,
    args: dict[str, Any],
    *,
    catalog_keys: set[str],
    custom_keys: set[str],
    user_text: str,
    campaign: dict[str, Any] | None,
    prior_filters: dict[str, Any] | None,
) -> dict[str, Any]:
    if name == "APPLY_AUDIENCE_FILTER":
        return _plan_from_apply_tool(
            args,
            catalog_keys=catalog_keys,
            custom_keys=custom_keys,
            user_text=user_text,
            campaign=campaign,
            prior_filters=prior_filters,
        )
    if name == "AUDIENCE_CLARIFY":
        unsupported = [
            str(x).strip()
            for x in (args.get("unsupported") or [])
            if str(x).strip()
        ]
        return {
            "intent": "clarify",
            "filters": {},
            "drop_keys": [],
            "unsupported": unsupported,
            "why": str(args.get("why") or "audience unclear").strip(),
            # Coordinator LLM writes the natural question — no static sentence.
            "needs_clarification": "",
            "catalog_keys": sorted(catalog_keys),
            "keep_prior": False,
            "prefer_channels_without_email": False,
        }
    if name == "AUDIENCE_SKIP":
        return _empty_plan(
            why=str(args.get("why") or "not an audience request"),
            intent="none",
        )
    return _empty_plan(why=f"unknown tool {name}", intent="clarify")


async def run_audience_agent(
    *,
    token: str,
    user_text: str,
    campaign: dict[str, Any] | None = None,
    prior_filters: dict[str, Any] | None = None,
    preferred_filters: dict[str, Any] | None = None,
    channels: list[Any] | None = None,
    catalog: list[dict[str, Any]] | None = None,
    b2c: bool = False,
    matched_count: int = 0,
    awaiting_identity_confirm: bool = False,
    sample_names: list[str] | None = None,
) -> dict[str, Any]:
    """LLM + tools loop — returns a plan dict for recommend_and_filter."""
    text = (user_text or "").strip()
    if not text:
        return _empty_plan(why="no user text", intent="none")

    fields = catalog if catalog is not None else await load_filterable_fields(token)
    catalog_keys, custom_keys = _catalog_index(fields)

    context = {
        "user_text": text,
        "matched_count": matched_count,
        "prior_filters": prior_filters or {},
        "preferred_filters": preferred_filters or {},
        "channels": _norm_channels(channels),
        "profile": "b2c" if b2c else "b2b",
        "awaiting_identity_confirm": awaiting_identity_confirm,
        "sample_names": sample_names or [],
        "campaign_context_only": {
            "name": (campaign or {}).get("name"),
            "goal": (campaign or {}).get("goal"),
            "objective": (campaign or {}).get("objective"),
        },
        "catalog": fields,
    }

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _AUDIENCE_AGENT_SYSTEM},
        {
            "role": "user",
            "content": (
                "Understand the audience request and call exactly one tool.\n"
                + json.dumps(context, indent=2)
            ),
        },
    ]

    llm = _llm()
    terminal_plan: dict[str, Any] | None = None

    try:
        for _ in range(_MAX_TOOL_ROUNDS):
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    llm.run,
                    messages,
                    _AUDIENCE_TOOLS,
                    CHAT_REASONING_EFFORT,
                    min(CHAT_MAX_TOKENS, 512),
                    0.2,
                ),
                timeout=CHAT_LLM_TIMEOUT_S,
            )
            tool_calls = (result or {}).get("tool_calls") or []
            content = str((result or {}).get("content") or "").strip()

            if not tool_calls:
                if content:
                    return {
                        "intent": "clarify",
                        "filters": {},
                        "drop_keys": [],
                        "unsupported": [],
                        "why": "model replied without tool",
                        "needs_clarification": content[:400],
                        "catalog_keys": sorted(catalog_keys),
                        "keep_prior": False,
                        "prefer_channels_without_email": False,
                    }
                break

            # One terminal tool per turn (multi_agent style).
            call = tool_calls[0]
            fn = call.get("function") or {}
            tool_name = str(fn.get("name") or "")
            if tool_name not in _TOOL_NAMES:
                messages.append(
                    {
                        "role": "assistant",
                        "content": content or None,
                        "tool_calls": [call],
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") or str(uuid.uuid4()),
                        "name": tool_name,
                        "content": json.dumps(
                            {"ok": False, "error": f"Unknown tool {tool_name}"}
                        ),
                    }
                )
                continue

            tool_args = _parse_tool_args(fn.get("arguments"))
            terminal_plan = await _dispatch_audience_tool(
                tool_name,
                tool_args,
                catalog_keys=catalog_keys,
                custom_keys=custom_keys,
                user_text=text,
                campaign=campaign,
                prior_filters=prior_filters,
            )
            return terminal_plan

    except asyncio.TimeoutError:
        return {
            "intent": "clarify",
            "filters": {},
            "drop_keys": [],
            "unsupported": [],
            "why": "audience specialist timed out",
            "needs_clarification": "",
            "catalog_keys": sorted(catalog_keys),
            "keep_prior": False,
            "prefer_channels_without_email": False,
        }
    except Exception:  # noqa: BLE001
        return _empty_plan(
            why="filtering specialist unavailable",
            intent="clarify",
        )

    if terminal_plan:
        return terminal_plan
    return _empty_plan(why="filtering specialist unavailable", intent="clarify")


async def plan_filters(
    *,
    token: str,
    user_text: str,
    campaign: dict[str, Any] | None = None,
    prior_filters: dict[str, Any] | None = None,
    preferred_filters: dict[str, Any] | None = None,
    channels: list[Any] | None = None,
    catalog: list[dict[str, Any]] | None = None,
    b2c: bool = False,
    matched_count: int = 0,
    awaiting_identity_confirm: bool = False,
) -> dict[str, Any]:
    """Plan audience filters via the tool-calling specialist."""
    return await run_audience_agent(
        token=token,
        user_text=user_text,
        campaign=campaign,
        prior_filters=prior_filters,
        preferred_filters=preferred_filters,
        channels=channels,
        catalog=catalog,
        b2c=b2c,
        matched_count=matched_count,
        awaiting_identity_confirm=awaiting_identity_confirm,
    )


def user_facing_filter_reply(
    result: dict[str, Any],
    *,
    b2c: bool,
    channels: list[Any] | None = None,
) -> str:
    """Deprecated for chat — always empty.

    Coordinator LLM writes found / not-found / next-step from tool facts.
    Kept for import compatibility; do not surface static audience scripts.
    """
    _ = (result, b2c, channels)
    return ""


def _plan_only_message(plan: dict[str, Any], *, b2c: bool) -> str:
    """Internal note for clarify/skip — coordinator writes the user-facing text."""
    _ = b2c
    intent = plan.get("intent")
    unsupported = plan.get("unsupported") or []
    if intent == "none":
        return ""
    bits: list[str] = []
    if unsupported:
        bits.append(
            "These are not stored on contacts: " + ", ".join(unsupported) + "."
        )
    if intent == "clarify":
        bits.append(
            "Audience choice unclear — coordinator should ask naturally who should receive "
            "(include CONTEXT temporary_contact_template_link when asking)."
        )
    return " ".join(bits).strip()


async def recommend_and_filter(
    session_id: str,
    token: str,
    *,
    campaign: dict[str, Any] | None = None,
    user_text: str | None = None,
    prior_filters: dict[str, Any] | None = None,
    preferred_filters: dict[str, Any] | None = None,
    channels: list[Any] | None = None,
    mode: str = "replace",
    change_summary: str | None = None,
    b2c: bool = False,
    matched_count: int = 0,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Audience specialist — LLM tools then FILTER_CONTACTS."""
    from app.progress_status import emit_process_progress

    await emit_process_progress(event_callback, "filtering")
    text = user_text or ""
    session = await get_or_create_session(session_id)
    audience = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    awaiting = bool(audience.get("awaiting_identity_confirm"))
    prior_names = [
        str(n).strip() for n in (audience.get("sample_names") or []) if n
    ]
    prior_count = int(matched_count or audience.get("matched_count") or 0)
    session_channels = list(channels or session.get("channels") or [])

    plan = None
    # Always LLM audience specialist — no regex identity short-circuit.
    catalog = await load_filterable_fields(token)
    plan = await run_audience_agent(
        token=token,
        user_text=text,
        campaign=campaign,
        prior_filters=prior_filters,
        preferred_filters=preferred_filters,
        channels=session_channels,
        catalog=catalog,
        b2c=b2c,
        matched_count=matched_count,
        awaiting_identity_confirm=awaiting,
        sample_names=prior_names,
    )
    intent = str(plan.get("intent") or "none")
    people = "customers" if b2c else "contacts"
    why_plan = str(plan.get("why") or "")
    confirmed_keep = bool(plan.get("keep_prior")) or why_plan == "keep named contact"

    if intent in {"none", "clarify"}:
        if intent == "clarify" and awaiting:
            audience["awaiting_identity_confirm"] = False
            session["audience"] = audience
            await save_session(session)
        msg = _plan_only_message(plan, b2c=b2c)
        return {
            "ok": True,
            "skipped": intent == "none",
            "planned": True,
            "intent": intent,
            "proposed_filters": prior_filters or {},
            "original_filters": prior_filters or {},
            "matched_count": matched_count,
            "sample_names": list(prior_names),
            "soft_warnings": [],
            "emails_matched": [],
            "emails_missing": [],
            "phones_matched": [],
            "phones_missing": [],
            "consent": {},
            "quality": {},
            "why": plan.get("why"),
            "widened": False,
            "unsupported": plan.get("unsupported") or [],
            "needs_clarification": "",
            "all_contacts": False,
            "message": msg,
            "ui_event": None,
            "confirmed_keep": False,
            "same_contact": False,
            "channels": session_channels,
        }

    filters = dict(plan.get("filters") or {})
    if intent == "replace" and preferred_filters and not filters:
        catalog_keys, custom_keys = _catalog_index(catalog)
        filters, _uns = _sanitize_filters(
            preferred_filters,
            catalog_keys=catalog_keys,
            custom_keys=custom_keys,
        )
        filters = _strip_campaign_leak(filters, text, campaign)

    exec_mode = intent if intent in {"replace", "add", "remove"} else (
        mode if mode in {"replace", "add", "remove"} else "replace"
    )
    if _is_identity_only(filters) and exec_mode != "add":
        exec_mode = "replace"

    summary = (change_summary or "").strip() or str(plan.get("why") or "Audience filter")
    result = await handle_filter_contacts(
        session_id,
        token,
        {
            "mode": exec_mode,
            "filters": filters,
            "remove_keys": plan.get("drop_keys") or [],
            "change_summary": summary,
        },
    )
    await emit_process_progress(event_callback, "calculating")

    count = int(result.get("matched_count") or 0)
    proposed = result.get("active_filters") or filters
    why = why_plan
    identity = _named_person_result({**result, "why": why}, proposed) or bool(
        _normalize_phone_list(filters.get("phones"))
        or _normalize_email_list(filters.get("emails"))
        or str(filters.get("search") or "").strip()
    )
    quality = result.get("quality") if isinstance(result.get("quality"), dict) else {}
    missing_email_n = int((quality.get("missing_email") or 0) or 0)

    new_names = [str(n).strip() for n in (result.get("sample_names") or []) if n]
    same_contact = False
    if count > 0 and prior_count > 0:
        old_set = {n.lower() for n in prior_names}
        new_set = {n.lower() for n in new_names}
        if old_set and new_set and old_set & new_set:
            same_contact = True
        prior_phones = set(_normalize_phone_list((prior_filters or {}).get("phones")))
        new_phones = set(_normalize_phone_list((proposed or {}).get("phones")))
        if prior_phones and new_phones and prior_phones == new_phones:
            same_contact = True

    out_channels = list(session_channels)
    drop_email_channel = identity and count > 0 and (
        confirmed_keep
        and (
            bool(plan.get("prefer_channels_without_email"))
            or missing_email_n > 0
        )
    )
    if drop_email_channel:
        out_channels = _channels_without_email(session_channels)
        ch_result = await handle_set_channels(
            session_id,
            {
                "channels": out_channels,
                "change_summary": "WhatsApp — no email on this contact",
            },
        )
        if isinstance(ch_result, dict) and ch_result.get("channels"):
            out_channels = list(ch_result["channels"])

    session = await get_or_create_session(session_id)
    audience = session.setdefault("audience", {})
    if identity and count > 0 and missing_email_n and not confirmed_keep:
        audience["awaiting_identity_confirm"] = True
    else:
        audience["awaiting_identity_confirm"] = False
    session["audience"] = audience
    await save_session(session)

    msg = (
        f"{count} {people} match. Why: {why}. "
        "Report count, sample names, and quality notes from the tool. "
        "User can change filters anytime."
    )
    missing_phones = result.get("phones_missing") or []
    missing_emails = result.get("emails_missing") or []
    if identity:
        msg += (
            " Named-person lookup: do not mention leftover sale/launch/"
            "product_interest. Do not ask which filter to drop."
        )
    if missing_phones:
        msg += f" Phones not in Audience: {', '.join(str(p) for p in missing_phones)}."
    if missing_emails:
        msg += f" Emails not in Audience: {', '.join(str(e) for e in missing_emails)}."
    if count == 0:
        if missing_phones or missing_emails or identity:
            msg += " Do not ask which leftover filter to drop. Do not ask for templates yet."
        else:
            dims = [
                k
                for k, v in (proposed or {}).items()
                if v not in (None, "", [], {})
            ]
            if dims:
                msg += (
                    f" Still 0 with filters ({', '.join(dims)}). "
                    "Ask which of those applied filters to drop, or name emails/phones. "
                    "Do not dump the CRM. Do not ask for templates yet."
                )
            else:
                msg += (
                    " Still 0. Ask for named emails, phones, or an existing field "
                    "— do not dump the full list. Do not ask for templates yet."
                )
    if plan.get("unsupported"):
        msg += (
            " Not stored on contacts: "
            + ", ".join(plan["unsupported"])
            + "."
        )
    if confirmed_keep:
        msg += " User kept this contact."
    if drop_email_channel:
        msg += f" Channels now {out_channels}."

    return {
        "ok": bool(result.get("ok")),
        "skipped": False,
        "planned": True,
        "intent": intent,
        "proposed_filters": proposed,
        "relaxed_filters": None,
        "original_filters": prior_filters or {},
        "matched_count": count,
        "sample_names": result.get("sample_names") or [],
        "soft_warnings": result.get("soft_warnings") or [],
        "emails_matched": result.get("emails_matched") or [],
        "emails_missing": missing_emails,
        "phones_matched": result.get("phones_matched") or [],
        "phones_missing": missing_phones,
        "consent": result.get("consent") or {},
        "quality": quality,
        "why": why,
        "widened": False,
        "widen_reason": None,
        "unsupported": plan.get("unsupported") or [],
        "needs_clarification": "",
        "all_contacts": bool(plan.get("all_contacts")) or (
            intent == "replace" and not filters and count > 0
        ),
        "error": result.get("error"),
        "message": msg,
        "ui_event": result.get("ui_event"),
        "confirmed_keep": confirmed_keep,
        "same_contact": same_contact,
        "channels": out_channels,
    }


__all__ = [
    "plan_filters",
    "run_audience_agent",
    "recommend_and_filter",
    "load_filterable_fields",
    "user_facing_filter_reply",
    "identity_filters_from_text",
    "identity_followup_should_run",
]
