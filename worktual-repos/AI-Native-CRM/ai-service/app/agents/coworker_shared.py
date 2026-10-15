"""Shared helpers for CRM co-worker / draft agents.

PARALLEL B2B/B2C WORK: high-touch shared file - coordinate before editing.
This is a "reuse, don't fork" stack per .cursor/rules/agents-must-use-llm.mdc.
Log changes in docs/parallel-work-log.md (see docs/merge-validation-checklist.md).
"""

from __future__ import annotations

import difflib
import html
import json
import re
from typing import Any


_TRIVIAL_ACK_RE = re.compile(
    r"^\s*(ok(ay)?|got\s*it|on\s*it|sure|thanks?|done|yep|yeah)\s*[.!]?\s*$",
    re.I,
)
_GENERIC_COWORKER_SPEECH_RE = re.compile(
    r"^\s*((sure|okay|ok|alright)[,.]?\s*)?"
    r"((i('m| am) (happy|here)( to help)?[,.]?\s*)|(happy to help\s*[—\-–,.]?\s*))?"
    r"(what would you like to do( next)?\??|how can i help( you( today)?)?\??|"
    r"what can i (do|help)( (you|with))?\??|"
    r"let me know( what you('d| would)? like)?\??)\s*$",
    re.I,
)


def is_trivial_ack(text: str | None) -> bool:
    """Bare status words like 'Okay.' that should never be the whole reply."""
    return bool(_TRIVIAL_ACK_RE.match((text or "").strip()))


_OFFLINE_ACTION_KEYS = (
    "patch",
    "contactDraftPatch",
    "toolProposals",
    "workspaceHint",
    "sessionMemoryPatch",
    "uiRefresh",
    "actions",
)

# User-visible chat when the LLM is down or returns nothing usable.
LLM_ERROR_SPEECH = "something went wrong"

_MODULE_CREATE_HREF = {
    "contact": "/contact/new",
    "company": "/company/new",
    "sales": "/sales/new",
    "product": "/product/new",
    "finance": "/finance/new",
    "activities": "/activities/log",
    "quotes": "/sales/quotes/new",
}
_MODULE_LIST_HREF = {
    "contact": "/contact",
    "company": "/company",
    "sales": "/sales",
    "product": "/product",
    "finance": "/finance",
    "activities": "/activities",
    "quotes": "/sales/quotes",
}
_DRAFT_NAV_HREFS = frozenset(
    {*_MODULE_CREATE_HREF.values(), *_MODULE_LIST_HREF.values(), "/dashboard"}
)
_HREF_TO_MODULE = {
    **{href: mod for mod, href in _MODULE_CREATE_HREF.items()},
    **{href: mod for mod, href in _MODULE_LIST_HREF.items()},
}


def _path_only(href: str) -> str:
    raw = (href or "").split("?")[0].split("#")[0].rstrip("/") or "/"
    return raw if raw.startswith("/") else ""


def strip_draft_patch(result: dict[str, Any]) -> dict[str, Any]:
    """Drop current-record patches when the turn is leaving this create page."""
    out = dict(result)
    out.pop("patch", None)
    out.pop("contactDraftPatch", None)
    return out


def draft_navigate_tools_from_llm(
    ai: dict[str, Any] | None, *, user_text: str = ""
) -> list[dict[str, Any]]:
    """Turn JSON `navigate` / toolProposals from a draft LLM into a navigate tool."""
    if not isinstance(ai, dict):
        return []
    href = ""
    seed = ""
    nav = ai.get("navigate")
    if isinstance(nav, str):
        href = nav.strip()
    elif isinstance(nav, dict):
        href = str(nav.get("href") or nav.get("path") or "").strip()
        seed = str(nav.get("seedPrompt") or "").strip()
    if not href:
        tools = ai.get("toolProposals")
        if isinstance(tools, list):
            for tool in tools:
                if not isinstance(tool, dict):
                    continue
                if str(tool.get("name") or "") != "navigate":
                    continue
                args = tool.get("args") if isinstance(tool.get("args"), dict) else {}
                href = str(args.get("href") or "").strip()
                seed = str(args.get("seedPrompt") or seed).strip()
                break
    path = _path_only(href)
    if path not in _DRAFT_NAV_HREFS:
        return []
    if not seed:
        seed = (user_text or "").strip()[:2000]
    args: dict[str, Any] = {"href": path, "auto": True}
    if seed:
        args["seedPrompt"] = seed[:2000]
    return [
        {
            "id": "nav-draft-switch",
            "name": "navigate",
            "label": "Open",
            "args": args,
            "risk": "low",
        }
    ]


def result_leaves_current_page(
    result: dict[str, Any] | None,
    *,
    pathname: str = "",
    module: str = "",
) -> bool:
    """True when tools take the user off this create/list page."""
    if not isinstance(result, dict):
        return False
    current = _path_only(pathname) or "/"
    current_mod = (module or "").strip().lower()
    from app.agents.nav_routing import infer_sales_module_from_label

    for tool in result.get("toolProposals") or []:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or "")
        args = tool.get("args") if isinstance(tool.get("args"), dict) else {}
        if name in ("navigate", "open_entity"):
            href = _path_only(str(args.get("href") or ""))
            if not href or href == current:
                continue
            target = _HREF_TO_MODULE.get(href)
            if target and current_mod and target == current_mod:
                # Same module: empty pathname (draft JSON) must not look like a leave.
                if not pathname:
                    continue
            return True
        if name == "set_workspace":
            mode = str(args.get("mode") or "")
            hint = f"{tool.get('label') or ''} {args.get('seedPrompt') or ''}"
            inferred = infer_sales_module_from_label(hint)
            if inferred and current_mod and inferred != current_mod:
                return True
            if not pathname:
                continue
            if mode == "create" and inferred:
                dest = _MODULE_CREATE_HREF.get(inferred) or ""
                if dest and dest != current:
                    return True
            if mode == "list" and inferred:
                dest = _MODULE_LIST_HREF.get(inferred) or ""
                if dest and dest != current:
                    return True
    return False


def apply_leave_create(
    result: dict[str, Any],
    *,
    pathname: str = "",
    module: str = "",
) -> dict[str, Any]:
    if result_leaves_current_page(result, pathname=pathname, module=module):
        return strip_draft_patch(result)
    return result


def llm_unavailable_result(reason: str = "llm_unavailable") -> dict[str, Any]:
    """Fail closed. Never substitute heuristic speech, patches, or tools."""
    return {
        "ok": False,
        "assistantText": LLM_ERROR_SPEECH,
        "source": "error",
        "reason": reason,
        "error": reason,
    }


def merge_llm_and_heuristic_patch(
    llm_patch: dict[str, Any] | None,
    heur_patch: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Offline-only merge. LLM success path must not call this."""
    merged: dict[str, Any] = {}
    if isinstance(heur_patch, dict):
        for key, val in heur_patch.items():
            if val is None:
                continue
            if isinstance(val, str) and not val.strip():
                continue
            merged[key] = val
    if isinstance(llm_patch, dict):
        for key, val in llm_patch.items():
            if val is None:
                continue
            if isinstance(val, str) and not val.strip():
                continue
            merged[key] = val
    return merged or None


def enrich_draft_result(
    result: dict[str, Any],
    *,
    heur_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Keep LLM speech and LLM draft patches.

    ``heur_result`` is ignored — field-fill heuristics are offline fallback
    only (when the LLM is down or unusable).
    """
    del heur_result
    if not isinstance(result, dict):
        return result
    out = dict(result)
    speech = str(out.get("assistantText") or "").strip()
    if speech:
        out["assistantText"] = sanitize_assistant_text_for_user(speech)
    return out


def actions_without_speech(
    result: dict[str, Any] | None,
    *,
    reason: str,
) -> dict[str, Any]:
    """Keep offline patches/tools. Never copy heuristic chat speech."""
    out: dict[str, Any] = {"ok": True, "source": "heuristic", "reason": reason}
    if not result:
        out["ok"] = False
        out["error"] = reason
        out["_unhandled"] = True
        return out
    copied = False
    for key in _OFFLINE_ACTION_KEYS:
        if result.get(key):
            out[key] = result[key]
            copied = True
    if result.get("_unhandled") or not copied:
        out["_unhandled"] = True
        if not copied:
            out["error"] = reason
    return out


def _result_has_actions(result: dict[str, Any]) -> bool:
    """True when the turn produced tools, draft patches, or UI refresh."""
    if result.get("toolProposals"):
        return True
    if result.get("patch") or result.get("contactDraftPatch"):
        return True
    if result.get("workspaceHint"):
        return True
    ui = result.get("uiRefresh")
    return isinstance(ui, dict) and bool(ui)


def drop_non_llm_speech(
    result: dict[str, Any] | None,
    *,
    fallback: str | None = LLM_ERROR_SPEECH,
) -> dict[str, Any]:
    """Validate agent response has usable speech. Strip internal workspace
    sentences but otherwise trust the LLM / agent output."""
    if not isinstance(result, dict):
        out: dict[str, Any] = {"ok": False, "error": "empty"}
        if fallback:
            out["assistantText"] = fallback
        return out
    out = dict(result)
    prior = str(out.get("assistantText") or "").strip()
    text = strip_internal_workspace_sentences(prior)
    if text and not is_generic_coworker_speech(text):
        out["assistantText"] = text
        return out
    # Tool/patch-only turns may omit chat speech — the UI applies actions.
    if _result_has_actions(out):
        out.pop("assistantText", None)
        return out
    # No usable speech — use fallback.
    if fallback:
        out["assistantText"] = fallback
    else:
        out.pop("assistantText", None)
    return out


_INTERNAL_WORKSPACE_SPEECH_RE = re.compile(
    r"\b("
    r"i('ll| will) open create|open create and|pull in what you shared|"
    r"right pane|workspace on the right|form on the right|live workspace|"
    r"set_workspace|i('ll| will) (open|switch to) (the )?(create|workspace)"
    r")\b",
    re.I,
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def is_internal_workspace_speech(text: str | None) -> bool:
    """True when speech narrates UI/workspace internals to the user."""
    return bool(_INTERNAL_WORKSPACE_SPEECH_RE.search((text or "").strip()))


def _speech_for_checks(text: str) -> str:
    """Plain words for ack / narration checks. Display HTML stays intact elsewhere."""
    if is_coworker_chat_html(text):
        return html_markup_to_chat_text(text)
    return text


def strip_internal_workspace_sentences(text: str | None) -> str:
    """Drop UI-narration sentences; keep any real question that remains."""
    original = (text or "").strip()
    if not original:
        return ""
    if is_coworker_chat_html(original):
        cleaned = sanitize_assistant_text_for_user(original)
        plain = html_markup_to_chat_text(cleaned)
        if not plain or not is_internal_workspace_speech(plain):
            return cleaned
        kept = [
            part.strip()
            for part in _SENTENCE_SPLIT_RE.split(plain)
            if part.strip() and not is_internal_workspace_speech(part)
        ]
        return " ".join(kept).strip()
    raw = sanitize_assistant_text_for_user(original).strip()
    if not raw or not is_internal_workspace_speech(raw):
        return raw
    kept = [
        part.strip()
        for part in _SENTENCE_SPLIT_RE.split(raw)
        if part.strip() and not is_internal_workspace_speech(part)
    ]
    return " ".join(kept).strip()


def is_generic_coworker_speech(text: str | None) -> bool:
    """True for empty / ack-only / 'what would you like to do next?' filler."""
    raw = strip_internal_workspace_sentences(text)
    if not raw:
        return True
    probe = _speech_for_checks(raw).strip()
    if not probe:
        return True
    if is_trivial_ack(probe):
        return True
    return bool(_GENERIC_COWORKER_SPEECH_RE.match(probe))


def _native_is_list_search(result: dict[str, Any]) -> bool:
    """True when the only workspace action is list/search — not a mutation."""
    props = result.get("toolProposals") or []
    if not isinstance(props, list) or not props:
        return False
    has_mutation = False
    has_list_search = False
    for p in props:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "")
        if name.startswith("propose_"):
            has_mutation = True
            continue
        args = p.get("args") if isinstance(p.get("args"), dict) else {}
        if name == "set_workspace" and str(args.get("mode") or "") == "list":
            has_list_search = True
    return has_list_search and not has_mutation


def _native_is_route_only(result: dict[str, Any]) -> bool:
    """True when tools only navigate / open workspace — no draft or mutation."""
    if result.get("patch") or result.get("contactDraftPatch"):
        return False
    props = result.get("toolProposals") or []
    if not isinstance(props, list) or not props:
        return False
    for p in props:
        if not isinstance(p, dict):
            return False
        name = str(p.get("name") or "")
        if name not in ("set_workspace", "navigate", "open_entity"):
            return False
    return True


def should_commit_native_turn(
    result: dict[str, Any] | None,
    *,
    user_text: str = "",
) -> bool:
    """Commit LLM tool turns only when they actually advance the conversation.

    Speech-only generic replies must not block deterministic create / edit /
    delete specialists. List/search handoffs must not steal open-record updates.
    """
    if not result or not result.get("ok") or result.get("_unhandled"):
        return False
    has_action = bool(
        result.get("toolProposals")
        or result.get("patch")
        or result.get("contactDraftPatch")
        or result.get("uiRefresh")
    )
    speech = str(result.get("assistantText") or "").strip()
    lower = (user_text or "").lower()
    try:
        from app.agents.document_section_shared import (
            parse_proposal_table_border_intent,
            parse_proposal_visible_text_swap,
        )

        props = result.get("toolProposals") or []
        if parse_proposal_visible_text_swap(user_text):
            has_text_patch = any(
                isinstance(p, dict)
                and str(p.get("name") or "")
                == "propose_patch_proposal_document_text"
                for p in props
            )
            if not has_text_patch:
                return False
        border_intent = parse_proposal_table_border_intent(user_text)
        if border_intent:
            wanted = border_intent == "on"
            has_borders = any(
                isinstance(p, dict)
                and str(p.get("name") or "")
                == "propose_patch_proposal_document_text"
                and (p.get("args") if isinstance(p.get("args"), dict) else {}).get(
                    "tableBorders"
                )
                is wanted
                for p in props
            )
            if not has_borders:
                return False
    except Exception:  # noqa: BLE001
        pass
    if has_action:
        if _native_is_list_search(result) and re.search(
            r"\b(edit|update|change|modify|rename|delete|remove|trash|"
            r"email|phone|title|domain|price|amount|stage)\b",
            lower,
        ):
            return False
        if _native_is_route_only(result) and is_generic_coworker_speech(speech):
            return False
        # Detail field assignments belong to propose_update_* — don't steal with
        # workspace-only tools. Create draft patches are the correct action when
        # the user dumps labeled fields ("title = Developer, company = Netflix").
        try:
            from app.agents.draft_conversation import (
                parse_company_field_update,
                parse_contact_field_update,
                parse_quote_field_update,
                parse_quote_section_update,
            )

            if (
                parse_contact_field_update(user_text)
                or parse_company_field_update(user_text)
                or parse_quote_field_update(user_text)
                or parse_quote_section_update(user_text)
            ):
                props = result.get("toolProposals") or []
                has_update = any(
                    isinstance(p, dict)
                    and str(p.get("name") or "").startswith("propose_update_")
                    for p in props
                )
                has_draft_patch = bool(
                    result.get("patch") or result.get("contactDraftPatch")
                )
                if not has_update and not has_draft_patch:
                    return False
        except Exception:  # noqa: BLE001
            pass
        # Bare email/phone slot fills must include a draft patch or they are lost.
        stripped = (user_text or "").strip()
        if re.search(r"[\w.+-]+@[\w.-]+\.\w+", stripped) or re.match(
            r"^\+?\d[\d\s().-]{6,}\d\s*$", stripped
        ):
            has_draft_patch = bool(
                result.get("patch") or result.get("contactDraftPatch")
            )
            if not has_draft_patch:
                return False
        return True
    if is_generic_coworker_speech(speech):
        return False
    if looks_like_affirmative(user_text) and not (
        result.get("toolProposals")
        or result.get("patch")
        or result.get("contactDraftPatch")
    ):
        return False
    if (
        not (
            result.get("toolProposals")
            or result.get("patch")
            or result.get("contactDraftPatch")
        )
        and re.search(
            r"\b(done|saved|updated|is now|that'?s saved|all set)\b",
            speech,
            re.I,
        )
    ):
        return False
    # "city as Namakkal" has no edit verb — must not accept create-draft chat.
    try:
        from app.agents.draft_conversation import (
            parse_company_field_update,
            parse_contact_field_update,
            parse_quote_field_update,
            parse_quote_section_update,
        )

        if (
            parse_contact_field_update(user_text)
            or parse_company_field_update(user_text)
            or parse_quote_field_update(user_text)
            or parse_quote_section_update(user_text)
        ):
            return False
    except Exception:  # noqa: BLE001
        pass
    # Slot fills (bare email / phone) need a draft patch — speech-only drops the value.
    stripped = (user_text or "").strip()
    if re.search(r"[\w.+-]+@[\w.-]+\.\w+", stripped) or re.match(
        r"^\+?\d[\d\s().-]{6,}\d\s*$", stripped
    ):
        return False
    if re.search(
        r"\b(create|new|start|make|draft|register|set\s*up|insert)\b|"
        r"\bhelp me (to )?(create|add|make|draft|log|start)\b|"
        r"\b(delete|remove|trash|edit|update|change|rename|send|email)\b",
        lower,
    ):
        return False
    return len(speech) >= 24


_DELETE_VERB_RE = re.compile(
    r"\b(delete|remove|erase|trash|discard|scrap)\b|"
    r"\b(get\s+rid\s+of|throw\s+away|wipe\s+(?:it\s+|this\s+|that\s+)?out|"
    r"nuke|yeet|ditch|toss)\b",
    re.I,
)


_OTHER_ACTION_RE = re.compile(
    r"\b(update|change|edit|modify|add|create|new)\b", re.I
)
_COMPOUND_CONNECTOR_RE = re.compile(r"\band\b|\bthen\b|\balso\b", re.I)


def has_compound_delete_intent(text: str) -> bool:
    """True when a message pairs a delete verb with another action verb via a
    connector ("delete this and also create a new one", "update the phone and
    then delete it"). Destructive actions should never fire on a guess when
    the message is actually asking for more than one thing — ask instead.
    """
    lower = (text or "").lower()
    if not wants_delete_intent(lower):
        return False
    return bool(_OTHER_ACTION_RE.search(lower) and _COMPOUND_CONNECTOR_RE.search(lower))


_FIELD_BOUNDARY_RE = re.compile(
    r"\s+and\s+(?:their\s+|the\s+|his\s+|her\s+|its\s+)?"
    r"(?:email|phone|mobile|number|title|role|position|notes?|"
    r"address|city|country|name|industry|domain|website|linkedin|"
    r"sku|price|amount|stage|discount)\b.*$",
    re.I,
)


def trim_at_next_field(value: str) -> str:
    """Cut a greedily-captured free-text value off before a trailing
    " and <other field> ..." clause so multi-field messages like
    "title to CEO and email to a@b.com" don't bleed into one patch value.
    """
    if not value:
        return value
    return _FIELD_BOUNDARY_RE.sub("", value).strip()


def wants_delete_intent(text: str) -> bool:
    """Shared delete-verb detector — covers slang so modules never drift.

    Kept intentionally conservative: verbs like "cut" or "axe" are excluded
    because they collide with unrelated CRM phrasing (discounts, staffing).
    """
    return bool(_DELETE_VERB_RE.search((text or "").lower()))


_NEGATION_TOKENS = {
    "no", "not", "dont", "don't", "never", "stop", "wait", "cancel",
    "nope", "nah", "actually",
}
_AFFIRM_STRONG_TOKENS = {
    "yes", "yep", "yeah", "yup", "ya", "yess", "aye", "sure", "ok", "okay",
    "alright", "confirm", "confirmed", "correct", "proceed", "affirmative",
}
_AFFIRM_FILLER_TOKENS = _AFFIRM_STRONG_TOKENS | {
    "please", "do", "it", "go", "ahead", "for", "thanks", "thank",
    "you", "sounds", "good", "thing", "great", "fine", "then", "now",
}
# Common command-style confirmations that skip the explicit "yes/ok" word.
_AFFIRM_IDIOM_RE = re.compile(
    r"^\s*(go\s+ahead|go\s+for\s+it|do\s+it(?:\s+now)?|please\s+do|"
    r"sounds\s+good|make\s+it\s+happen)\s*[.!]*$",
    re.I,
)


def looks_like_affirmative(text: str) -> bool:
    """Tolerant "yes" detector — handles repeats, filler, and softened phrasing
    ("yes yes yes", "yeah go for it", "sure thing", "go ahead") while rejecting
    negations ("no, don't", "wait no") and unrelated free text so it never
    over-triggers on a real answer that merely mentions "ok" in passing.
    """
    stripped = (text or "").strip().rstrip(".!?")
    if not stripped:
        return False
    lower = stripped.lower()
    tokens = re.findall(r"[a-z']+", lower)
    if any(t in _NEGATION_TOKENS for t in tokens):
        return False
    if _AFFIRM_IDIOM_RE.match(lower):
        return True
    if not tokens:
        return False
    if not any(t in _AFFIRM_STRONG_TOKENS for t in tokens):
        return False
    if not all(t in _AFFIRM_FILLER_TOKENS for t in tokens):
        return False
    return True


_DECLINE_RE = re.compile(
    r"^\s*(?:no|nope|nah|never\s*mind|nevermind)\b|"
    r"\b(?:don'?t|do\s+not|cancel(?:\s+that)?|stop|wait,?\s*no|actually,?\s*no)\b",
    re.I,
)


def looks_like_decline(text: str) -> bool:
    """True for "no" / "cancel that" / "wait, don't" — used to gracefully back
    out of a pending destructive confirmation instead of silently ignoring it.
    """
    stripped = (text or "").strip()
    if not stripped:
        return False
    return bool(_DECLINE_RE.search(stripped.lower()))


def _message_text(message: dict[str, Any]) -> str | None:
    """Prefer CRM `text`; also accept OpenAI-style `content` (str or parts)."""
    raw = message.get("text")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str) and part.strip():
                parts.append(part.strip())
            elif isinstance(part, dict):
                t = part.get("text")
                if isinstance(t, str) and t.strip():
                    parts.append(t.strip())
        if parts:
            return "\n".join(parts)
    return None


def last_user_text(messages: list[dict[str, Any]] | None) -> str | None:
    if not messages:
        return None
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        text = _message_text(m)
        if text:
            return text
    return None


def open_entity_id(ctx: dict[str, Any] | None) -> str | None:
    """Workspace memory: id of the record open on the right, if any."""
    if not ctx:
        return None
    raw = ctx.get("entityId")
    if raw is None:
        return None
    eid = str(raw).strip()
    return eid or None


def has_open_record(ctx: dict[str, Any] | None) -> bool:
    """True when the shell has an open record in memory (prefer detail surface)."""
    eid = open_entity_id(ctx)
    if not eid:
        return False
    surface = str((ctx or {}).get("surface") or "").lower()
    # entityId is authoritative; list surfaces usually clear it, but defend anyway
    return surface == "detail" or surface == ""


def display_from_catalog(
    catalog: dict[str, Any] | None,
    entity_id: str,
    *,
    list_key: str,
    name_keys: tuple[str, ...] = ("displayName", "name", "title"),
    open_key: str | None = None,
) -> str:
    """Resolve a human label for the open entity from catalog memory."""
    if open_key:
        open_row = (catalog or {}).get(open_key)
        if isinstance(open_row, dict) and str(open_row.get("id") or "") == str(
            entity_id
        ):
            for k in name_keys:
                val = str(open_row.get(k) or "").strip()
                if val:
                    return val
    for row in (catalog or {}).get(list_key) or []:
        if isinstance(row, dict) and str(row.get("id")) == str(entity_id):
            for k in name_keys:
                val = str(row.get(k) or "").strip()
                if val:
                    return val
    return ""


def build_conversation_prompt(
    catalog: Any,
    messages: list[dict[str, Any]] | None,
) -> str:
    history_parts: list[str] = []
    for m in (messages or [])[-8:]:
        role = m.get("role") or "user"
        text = m.get("text") or ""
        history_parts.append(f"{role}: {text}")
    history = "\n".join(history_parts)
    safe_catalog = redact_catalog_for_prompt(catalog)
    return (
        f"Catalog (JSON):\n{json.dumps(safe_catalog, default=str)}\n\n"
        f"Conversation:\n{history}\n\nRespond with JSON only."
    )


# Prisma cuid-ish / CRM ids users must never see in chat.
_CRM_ID_RE = re.compile(
    r"\b(?:cm[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|wt-[a-z0-9-]{6,})\b",
    re.I,
)
_ID_PAREN_RE = re.compile(
    r"\s*[\(\[]\s*(?:id|ID)\s*[:#]?\s*[a-z0-9-]{8,}\s*[\)\]]",
    re.I,
)
_ID_LABEL_RE = re.compile(
    r"\b(?:deal|contact|product|company|quote|invoice)\s+id\s*[:=]?\s*[a-z0-9-]{8,}\b",
    re.I,
)


_SUGGESTIONS_RE = re.compile(
    r"<suggestions>\s*(\[.*?\])\s*</suggestions>", re.S
)
_TRAILING_SUGGESTION_LIST_RE = re.compile(
    r"\s*(\[\s*\"[^\"]{1,80}\"(?:\s*,\s*\"[^\"]{1,80}\"){0,6}\s*\])\s*$"
)
_CONFIRM_CHIP_RE = re.compile(
    r"^(confirm(\s|:)|tap confirm|click confirm)",
    re.I,
)


def _parse_suggestion_labels(raw: str) -> list[str]:
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    labels: list[str] = []
    for item in parsed[:5]:
        label = str(item).strip()
        if not label or _CONFIRM_CHIP_RE.match(label):
            continue
        labels.append(label)
    return labels


def extract_suggestions(text: str | None) -> tuple[str, list[str]]:
    """Extract <suggestions>[...]</suggestions> from assistant text.

    Also strips a leaked trailing JSON string array (models often omit the tags).
    Returns (cleaned_text, suggestions_list).
    """
    if not text:
        return ("", [])
    m = _SUGGESTIONS_RE.search(text)
    if m:
        cleaned = _SUGGESTIONS_RE.sub("", text).strip()
        return (cleaned, _parse_suggestion_labels(m.group(1)))
    trailing = _TRAILING_SUGGESTION_LIST_RE.search(text)
    if trailing:
        try:
            json.loads(trailing.group(1))
        except (json.JSONDecodeError, ValueError):
            return (text, [])
        cleaned = text[: trailing.start()].rstrip()
        return (cleaned, _parse_suggestion_labels(trailing.group(1)))
    return (text, [])


_HTML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
_CHAT_HTML_TAGS = frozenset(
    {
        "p",
        "ul",
        "ol",
        "li",
        "strong",
        "em",
        "br",
        "span",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "b",
    }
)
_CHAT_HTML_BLOCKS = frozenset({"p", "ul", "ol", "table"})
_CHAT_TAG_RE = re.compile(
    r"<\s*(/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?/?>",
    re.S,
)


def is_coworker_chat_html(text: str | None) -> bool:
    """True when speech is the coworker chat HTML contract, not a document dump."""
    raw = _SUGGESTIONS_RE.sub("", text or "").strip()
    if not raw or "<" not in raw:
        return False
    if re.search(r"<\s*(script|style)\b", raw, re.I):
        return False
    names = [match.group(2).lower() for match in _CHAT_TAG_RE.finditer(raw)]
    if not names or any(name not in _CHAT_HTML_TAGS for name in names):
        return False
    return bool(set(names) & _CHAT_HTML_BLOCKS)


def _normalize_chat_html(text: str) -> str:
    """Keep allowed chat tags and their text. Drop attributes and CRM ids."""
    suggestion = _SUGGESTIONS_RE.search(text)
    body = _SUGGESTIONS_RE.sub("", text)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)

    def _tag(match: re.Match[str]) -> str:
        name = match.group(2).lower()
        if name == "br":
            return "<br>"
        if match.group(1):
            return f"</{name}>"
        return f"<{name}>"

    body = _CHAT_TAG_RE.sub(_tag, body)
    body = _ID_PAREN_RE.sub("", body)
    body = _ID_LABEL_RE.sub("", body)
    body = _CRM_ID_RE.sub("", body)
    body = re.sub(r"[ \t]{2,}", " ", body)
    body = re.sub(r"\(\s*\)", "", body).strip()
    if suggestion:
        return f"{body}\n{suggestion.group(0)}".strip()
    return body


def html_markup_to_chat_text(text: str) -> str:
    """Turn leaked HTML (BRD / ontology dumps) into readable chat text."""
    raw = (text or "").strip()
    if not raw or not _HTML_TAG_RE.search(raw):
        return raw
    out = re.sub(r"(?is)<(script|style)\b[^>]*>.*?</\1>", " ", raw)
    out = re.sub(r"(?i)<br\s*/?>", "\n", out)
    out = re.sub(r"(?i)</(p|div|h[1-6]|li|tr|section|article|table|blockquote)>", "\n", out)
    out = re.sub(r"(?i)</t[dh]>", " ", out)
    out = _HTML_TAG_RE.sub("", out)
    out = html.unescape(out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    return out.strip() or raw


def unwrap_markdown_emphasis(text: str) -> str:
    """Drop markdown bold so a recap reads as Name: Pooja, never Name:**."""
    raw = text or ""
    raw = re.sub(r"\*\*([^*]+)\*\*", r"\1", raw)
    # A bullet strip can eat the opening ** and leave Name:** value.
    raw = re.sub(r"([A-Za-z][A-Za-z0-9 /_-]{0,40}):\*\*", r"\1:", raw)
    return raw.replace("**", "")


def sanitize_assistant_text_for_user(text: str | None) -> str:
    """Strip raw CRM / DB ids and leaked HTML from user-visible coworker speech."""
    raw = (text or "").strip()
    if not raw:
        return ""
    raw = re.sub(r"<tool_code>.*?</tool_code>", "", raw, flags=re.I | re.S).strip()
    if is_coworker_chat_html(raw):
        return _normalize_chat_html(raw)
    raw = html_markup_to_chat_text(raw)
    raw = unwrap_markdown_emphasis(raw)
    # Models often prefix every line with a markdown bullet ("- Got it…").
    # A single asterisk or dash needs a following space. **bold** is not a bullet.
    raw = re.sub(r"^(?:(?:[-•]+|\*(?!\*))\s+)+", "", raw)
    raw = re.sub(r"\n(?:(?:[-•]+|\*(?!\*))\s+)+", "\n", raw)
    raw = raw.strip()
    out = _ID_PAREN_RE.sub("", raw)
    out = _ID_LABEL_RE.sub("", out)
    out = _CRM_ID_RE.sub("", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\s+([,.;:])", r"\1", out)
    out = re.sub(r"\(\s*\)", "", out)
    out = re.sub(r"\s+\n", "\n", out)
    return out.strip() or raw


def redact_catalog_for_prompt(catalog: Any) -> Any:
    """Keep ids for tool patches, but label human names so the model prefers titles."""
    if not isinstance(catalog, dict):
        return catalog
    out = dict(catalog)
    deals = out.get("deals")
    if isinstance(deals, list):
        brief = []
        for d in deals[:40]:
            if not isinstance(d, dict):
                continue
            title = str(d.get("title") or d.get("name") or "").strip()
            did = str(d.get("id") or "").strip()
            if not did:
                continue
            brief.append(
                {
                    "id": did,
                    "title": title or did,
                    **(
                        {"companyName": str(d.get("companyName") or "").strip()}
                        if d.get("companyName")
                        else {}
                    ),
                    **(
                        {"contactName": str(d.get("contactName") or "").strip()}
                        if d.get("contactName")
                        else {}
                    ),
                }
            )
        out["deals"] = brief
        out["speakRule"] = (
            "Use deal/product titles in assistantText. Never paste id values into chat."
        )
    products = out.get("products")
    if isinstance(products, list):
        brief_p = []
        for p in products[:40]:
            if not isinstance(p, dict):
                continue
            name = str(p.get("name") or "").strip()
            pid = str(p.get("id") or "").strip()
            if not pid:
                continue
            brief_p.append({"id": pid, "name": name or pid})
        out["products"] = brief_p
    draft = out.get("currentDraft")
    if isinstance(draft, dict):
        labeled = dict(draft)
        deal_id = str(labeled.get("dealId") or "").strip()
        if deal_id and isinstance(out.get("deals"), list):
            match = next(
                (
                    d
                    for d in out["deals"]
                    if isinstance(d, dict) and str(d.get("id")) == deal_id
                ),
                None,
            )
            if match and match.get("title"):
                labeled["dealTitle"] = match["title"]
        product_id = str(labeled.get("productId") or "").strip()
        if product_id and isinstance(out.get("products"), list):
            match = next(
                (
                    p
                    for p in out["products"]
                    if isinstance(p, dict) and str(p.get("id")) == product_id
                ),
                None,
            )
            if match and match.get("name"):
                labeled["productName"] = match["name"]
        out["currentDraft"] = labeled
    return out


def parse_assistant_json(text: str) -> dict[str, Any] | None:
    trimmed = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", trimmed, re.I)
    raw = fence.group(1).strip() if fence else trimmed
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        obj = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    return obj


def str_fields(
    patch: dict[str, Any] | None,
    keys: list[str],
    max_len: int = 500,
) -> dict[str, str]:
    out: dict[str, str] = {}
    if not patch:
        return out
    for k in keys:
        v = patch.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:max_len]
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = str(v)
    return out


def _edit_distance(a: str, b: str) -> int:
    """Levenshtein distance (small strings only)."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if not la:
        return lb
    if not lb:
        return la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[lb]


def _meaningful_substring(a: str, b: str) -> bool:
    """True when one string contains the other as a real name fragment.

    Short tokens like "new" / "me" / "log" must not match "noreply" or
    "messages" — that used to auto-pick LinkedIn noreply contacts.
    """
    if not a or not b:
        return False
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) < 4:
        return False
    if shorter not in longer:
        return False
    return len(shorter) / max(len(longer), 1) >= 0.4


def name_similarity(a: str, b: str) -> float:
    """0–1 similarity; tolerant of typos (monaj≈manoj) and substrings."""
    def _norm(s: str) -> str:
        # Collapse fancy dashes/quotes so "Zoho — X" ≈ "Zoho – X" ≈ 'Zoho - X'
        s = (s or "").strip().lower()
        for ch in ("\u2014", "\u2013", "\u2212", "\u2010", "\u2011"):
            s = s.replace(ch, "-")
        for ch in ("\u201c", "\u201d", "\u2018", "\u2019", '"', "'"):
            s = s.replace(ch, "")
        return re.sub(r"\s+", " ", s).strip()

    left = _norm(a)
    right = _norm(b)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if _meaningful_substring(left, right):
        return 0.92

    def pair_score(x: str, y: str) -> float:
        if not x or not y:
            return 0.0
        if x == y:
            return 1.0
        if _meaningful_substring(x, y):
            return 0.92
        ratio = difflib.SequenceMatcher(None, x, y).ratio()
        # Short-name typos: same letters rearranged (monaj↔manoj) or ≤2 edits.
        # 3-letter tokens are too small — "log"≈"com" used to auto-pick contacts.
        if len(x) >= 4 and len(y) >= 4 and abs(len(x) - len(y)) <= 2:
            if sorted(x) == sorted(y):
                return max(ratio, 0.9)
            dist = _edit_distance(x, y)
            maxlen = max(len(x), len(y))
            if dist <= 1:
                return max(ratio, 0.88)
            if dist == 2 and maxlen <= 10:
                return max(ratio, 0.8)
            if dist / maxlen <= 0.35:
                return max(ratio, 1.0 - dist / maxlen)
        return ratio

    tokens = [t for t in re.split(r"[^a-z0-9]+", right) if len(t) > 1]
    best = pair_score(left, right)
    for tok in tokens:
        best = max(best, pair_score(left, tok))
    for qtok in [t for t in re.split(r"[^a-z0-9]+", left) if len(t) > 1]:
        best = max(best, pair_score(qtok, right))
        for tok in tokens:
            best = max(best, pair_score(qtok, tok))
    return best


def rank_deals_by_name(
    catalog: dict[str, Any] | None,
    query: str,
    *,
    min_score: float = 0.72,
    limit: int = 5,
) -> list[tuple[float, dict[str, Any]]]:
    """Rank catalog deals by fuzzy title/company/contact match."""
    q = (query or "").strip()
    if not q or not catalog:
        return []
    deals = catalog.get("deals") if isinstance(catalog.get("deals"), list) else []
    scored: list[tuple[float, dict[str, Any]]] = []
    for raw in deals:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        title = str(raw.get("title") or "")
        company = str(raw.get("companyName") or "")
        contact = str(raw.get("contactName") or "")
        score = max(
            name_similarity(q, title),
            name_similarity(q, company),
            name_similarity(q, contact),
        )
        if score >= min_score:
            scored.append((score, raw))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:limit]


def rank_products_by_name(
    catalog: dict[str, Any] | None,
    query: str,
    *,
    min_score: float = 0.72,
    limit: int = 5,
) -> list[tuple[float, dict[str, Any]]]:
    """Rank catalog products by fuzzy name/SKU match."""
    q = (query or "").strip()
    if not q or not catalog:
        return []
    products = (
        catalog.get("products") if isinstance(catalog.get("products"), list) else []
    )
    scored: list[tuple[float, dict[str, Any]]] = []
    for raw in products:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        name = str(raw.get("name") or "")
        sku = str(raw.get("sku") or "")
        score = max(name_similarity(q, name), name_similarity(q, sku))
        if score >= min_score:
            scored.append((score, raw))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:limit]


def rank_contacts_by_name(
    catalog: dict[str, Any] | None,
    query: str,
    *,
    min_score: float = 0.72,
    limit: int = 5,
) -> list[tuple[float, dict[str, Any]]]:
    """Rank catalog contacts by fuzzy display name / email."""
    q = (query or "").strip()
    if not q or not catalog:
        return []
    contacts = (
        catalog.get("contacts") if isinstance(catalog.get("contacts"), list) else []
    )
    scored: list[tuple[float, dict[str, Any]]] = []
    for raw in contacts:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        display = str(raw.get("displayName") or raw.get("name") or "")
        email = str(raw.get("email") or "")
        score = max(name_similarity(q, display), name_similarity(q, email))
        if score >= min_score:
            scored.append((score, raw))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:limit]


def rank_companies_by_name(
    catalog: dict[str, Any] | None,
    query: str,
    *,
    min_score: float = 0.72,
    limit: int = 5,
) -> list[tuple[float, dict[str, Any]]]:
    """Rank catalog companies by fuzzy name."""
    q = (query or "").strip()
    if not q or not catalog:
        return []
    companies = (
        catalog.get("companies") if isinstance(catalog.get("companies"), list) else []
    )
    scored: list[tuple[float, dict[str, Any]]] = []
    for raw in companies:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        name = str(raw.get("name") or "")
        score = name_similarity(q, name)
        if score >= min_score:
            scored.append((score, raw))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:limit]


def clear_rank_winner(
    ranked: list[tuple[float, dict[str, Any]]],
    *,
    margin: float = 0.08,
) -> dict[str, Any] | None:
    """Return the top hit when it clearly beats the runner-up (or is alone)."""
    if not ranked:
        return None
    if len(ranked) == 1:
        return ranked[0][1]
    # Near-exact title hits win even if another deal shares a short token.
    if ranked[0][0] >= 0.92:
        return ranked[0][1]
    if ranked[0][0] >= ranked[1][0] + margin:
        return ranked[0][1]
    return None


_QUOTED_NAME_RE = re.compile(
    r"[\"'“”‘’]([^\"'“”‘’]{2,80})[\"'“”‘’]"
    r"|exactly\s+[\"'“”‘’]?([^\"'“”‘’\?.!]{2,80})"
    r"|deal titled\s+[\"'“”‘’]?([^\"'“”‘’\?.!]{2,80})",
    re.I,
)


def extract_quoted_names(text: str) -> list[str]:
    """Pull candidate entity names from soft-confirm assistant questions."""
    out: list[str] = []
    for m in _QUOTED_NAME_RE.finditer(text or ""):
        cand = (m.group(1) or m.group(2) or m.group(3) or "").strip(" \t\"'“”‘’.,")
        if cand and cand.lower() not in {"yes", "no", "deal", "product", "quote"}:
            out.append(cand)
    return out


def resolve_catalog_id(
    value: str,
    *,
    items: list[dict[str, Any]],
    kind: str,
    min_score: float = 0.78,
) -> str | None:
    """Map a raw tool arg (id or free-text name) onto a catalog id, or None."""
    raw = (value or "").strip()
    if not raw or not items:
        return None
    if any(str(it.get("id") or "") == raw for it in items):
        return raw
    if kind == "deal":
        ranked = rank_deals_by_name({"deals": items}, raw, min_score=min_score, limit=2)
    elif kind == "contact":
        ranked = rank_contacts_by_name(
            {"contacts": items}, raw, min_score=min_score, limit=2
        )
    elif kind == "company":
        ranked = rank_companies_by_name(
            {"companies": items}, raw, min_score=min_score, limit=2
        )
    else:
        ranked = rank_products_by_name(
            {"products": items}, raw, min_score=min_score, limit=2
        )
    winner = clear_rank_winner(ranked)
    return str(winner["id"]) if winner and winner.get("id") else None


COWORKER_TURN_INTENTS = frozenset(
    {"continue_create", "switch_intent", "clarify", "cancel", "query"}
)
COWORKER_TARGET_MODULES = frozenset(
    {
        "contact",
        "company",
        "sales",
        "product",
        "finance",
        "quotes",
        "activities",
        "dashboard",
        "inbox",
        "calendar",
        "reports",
        "marketing",
        "agents",
        "commerce",
        "service",
        "configuration",
    }
)

_COMMANDISH_UTTERANCE_RE = re.compile(
    r"\b("
    r"i\s+(want|wanna|need|would like)|i'd like|"
    r"show(\s+me)?|take me|go to|move to|switch to|open|"
    r"see\s+(the\s+)?(activit|contact|deal|product|invoice|quote|compan|calendar|inbox|pipeline)|"
    r"cancel|never mind|leave this|stop creating|not the (title|name)"
    r")\b",
    re.I,
)


def utterance_looks_like_command(text: str | None) -> bool:
    """True when the utterance is likely a new request, not a field value."""
    raw = (text or "").strip()
    if not raw:
        return False
    return bool(_COMMANDISH_UTTERANCE_RE.search(raw))


def validate_coworker_intent(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    intent = str(data.get("intent") or "").strip()
    if intent not in COWORKER_TURN_INTENTS:
        return None
    confidence = str(data.get("confidence") or "medium").strip().lower()
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium"
    if confidence == "low" and intent != "clarify":
        intent = "clarify"
    target = str(data.get("targetModule") or "").strip().lower() or None
    if target and target not in COWORKER_TARGET_MODULES:
        target = None
    speech = str(data.get("assistantText") or "").strip()[:400]
    return {
        "intent": intent,
        "confidence": confidence,
        "targetModule": target,
        "assistantText": speech,
        "source": "ai",
    }


async def classify_coworker_intent(
    *,
    user_text: str,
    module: str,
    surface: str,
    last_assistant: str = "",
    draft: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """LLM-primary: is this still answering create, or a new request?

    Heuristic callers must only use this after ``None`` (LLM down / unusable).
    """
    from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt

    text = (user_text or "").strip()
    if not text:
        return None

    draft_keys = []
    if isinstance(draft, dict):
        for key, val in draft.items():
            if val in (None, "", [], {}):
                continue
            draft_keys.append(f"{key}={str(val)[:40]}")
            if len(draft_keys) >= 12:
                break

    system = sectioned_system_prompt(
        role=(
            "You are a CRM coworker deciding what the user meant in this turn. "
            "You think like a teammate: understand the request, do not treat chat as a form."
        ),
        goal=(
            "Classify the latest user message. If they are clearly answering the last "
            "create question, continue. If they want another area, a different action, "
            "or to stop, do not treat the sentence as a field value. If unsure, clarify."
        ),
        instructions=(
            "continue_create — they are filling the current create/edit slot "
            "(a name, title, email, company, amount, date, yes/skip).\n"
            "switch_intent — they want another module or record "
            "('see activity', 'open contacts', 'show products', 'go to inbox'). "
            "Set targetModule.\n"
            "cancel — leave this draft / stop creating.\n"
            "query — they asked a question about CRM that is not a field answer.\n"
            "clarify — ambiguous (could be a deal title OR a request to open Activities).\n"
            "If confidence is low, use clarify.\n"
            "'i want to see activity' during deal create is switch_intent to activities, "
            "never continue_create."
        ),
        context=(
            f"module={module or ''} surface={surface or ''}\n"
            f"lastAssistant={last_assistant[:400]}\n"
            f"draft={', '.join(draft_keys) or '(empty)'}\n"
            f"user={text[:500]}"
        ),
        output=(
            '{"intent":"continue_create|switch_intent|clarify|cancel|query",'
            '"confidence":"high|medium|low",'
            '"targetModule":"activities|contact|sales|product|finance|quotes|'
            'company|inbox|calendar|null",'
            '"assistantText":"one short human sentence if clarify/switch/cancel"}'
        ),
        guardrails=(
            "Never copy a command-like utterance into a title or name. "
            "Ask instead of guessing when it could be either a field value or navigation. "
            "JSON only."
        ),
    )
    parsed, _reason = await generate_json_with_retries(
        system=system,
        user=text,
        max_tokens=220,
        timeout_ms=25_000,
        attempts=2,
        validate=validate_coworker_intent,
    )
    if isinstance(parsed, dict):
        return parsed
    return None


def last_assistant_text(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if not isinstance(m, dict):
            continue
        if m.get("role") != "assistant":
            continue
        text = m.get("text") or m.get("content") or ""
        if isinstance(text, str) and text.strip():
            return text.strip()
    return ""


def _primary_product_from_soft_prompt(
    assistant_text: str, products: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """When the assistant offered CRM as main / Ticketing as addon, pick main."""
    lower = (assistant_text or "").lower()
    if not products:
        return None
    # "set the CRM product as the main item" / "CRM product or the Ticketing"
    if "main" in lower or "addon" in lower or " or " in lower:
        ranked = rank_products_by_name(
            {"products": products}, assistant_text, min_score=0.72, limit=5
        )
        # Prefer the first product name that appears in the assistant text order.
        for p in products:
            name = str(p.get("name") or "")
            if name and name.lower() in lower:
                return p
        if ranked:
            return ranked[0][1]
    return None


def enrich_quote_result_from_catalog(
    result: dict[str, Any],
    *,
    user_text: str,
    draft: dict[str, Any],
    catalog: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
    fill_missing: bool = True,
) -> dict[str, Any]:
    """Resolve quote dealId/productId against the catalog.

    When ``fill_missing`` is False (LLM success path), only clamp IDs the
    model already patched — do not infer new fields from user text.
    """
    from app.agents.draft_conversation import (
        looks_like_create_confirm,
        merge_draft,
    )

    deals = [d for d in (catalog.get("deals") or []) if isinstance(d, dict)]
    products = [p for p in (catalog.get("products") or []) if isinstance(p, dict)]
    if not deals and not products:
        return result

    patch = dict(result.get("patch") or {}) if isinstance(result.get("patch"), dict) else {}
    changed = False
    prior = last_assistant_text(messages)

    if "dealId" in patch:
        resolved = resolve_catalog_id(str(patch.get("dealId") or ""), items=deals, kind="deal")
        if resolved:
            if patch.get("dealId") != resolved:
                patch["dealId"] = resolved
                changed = True
        else:
            patch.pop("dealId", None)
            changed = True
    if "productId" in patch:
        resolved = resolve_catalog_id(
            str(patch.get("productId") or ""), items=products, kind="product"
        )
        if resolved:
            if patch.get("productId") != resolved:
                patch["productId"] = resolved
                changed = True
        else:
            patch.pop("productId", None)
            changed = True

    merged = merge_draft(draft if isinstance(draft, dict) else {}, patch)
    if not fill_missing:
        if not changed:
            return result
        out = dict(result)
        out["ok"] = True
        out["patch"] = patch or None
        return out

    soft = looks_like_create_confirm(user_text) or bool(
        re.match(
            r"^\s*(both|either|first|the\s+first(\s+one)?|crm|ticketing)\b",
            (user_text or "").strip(),
            re.I,
        )
    )

    queries: list[str] = []
    if soft:
        queries.extend(extract_quoted_names(prior))
        if prior:
            queries.append(prior)
    queries.append(user_text or "")

    if not str(merged.get("dealId") or "").strip() and deals:
        for q in queries:
            if not (q or "").strip():
                continue
            winner = clear_rank_winner(
                rank_deals_by_name({"deals": deals}, q, min_score=0.78, limit=2)
            )
            if winner and winner.get("id"):
                patch["dealId"] = str(winner["id"])
                changed = True
                merged = merge_draft(draft if isinstance(draft, dict) else {}, patch)
                break

    if not str(merged.get("productId") or "").strip() and products:
        if soft:
            primary = _primary_product_from_soft_prompt(prior, products)
            if primary and primary.get("id"):
                patch["productId"] = str(primary["id"])
                changed = True
                merged = merge_draft(draft if isinstance(draft, dict) else {}, patch)
        if not str(merged.get("productId") or "").strip():
            for q in queries:
                if not (q or "").strip():
                    continue
                # Bare yes alone is not a product name — need prior-turn context.
                if soft and q is user_text:
                    continue
                winner = clear_rank_winner(
                    rank_products_by_name(
                        {"products": products}, q, min_score=0.78, limit=2
                    )
                )
                if winner and winner.get("id"):
                    patch["productId"] = str(winner["id"])
                    changed = True
                    merged = merge_draft(draft if isinstance(draft, dict) else {}, patch)
                    break

    if not changed:
        return result

    out = dict(result)
    out["ok"] = True
    out["patch"] = patch or None
    speech = str(out.get("assistantText") or "")
    if is_generic_coworker_speech(speech) or is_trivial_ack(speech):
        out["assistantText"] = ""
    return out


def enrich_quote_detail_update_from_llm(
    result: dict[str, Any],
    *,
    user_text: str,
    messages: list[dict[str, Any]] | None,
    catalog: dict[str, Any],
    entity_id: str | None,
) -> dict[str, Any]:
    """After a native LLM turn on quote detail, attach update tools the model omitted."""
    if not result.get("ok") or not entity_id:
        return result
    props = [
        p
        for p in (result.get("toolProposals") or [])
        if isinstance(p, dict)
    ]
    if any(str(p.get("name") or "") == "propose_update_quote" for p in props):
        return result

    from app.agents.draft_conversation import (
        looks_like_create_confirm,
        parse_quote_field_update,
        parse_quote_line_update,
        parse_quote_section_update,
        propose_update_quote_proposal,
        resolve_pending_quote_update_on_confirm,
    )

    patch: dict[str, Any] | None = None
    if looks_like_create_confirm(user_text):
        patch = resolve_pending_quote_update_on_confirm(messages, catalog)
    if not patch:
        section = parse_quote_section_update(user_text, catalog)
        field = parse_quote_field_update(user_text)
        lines = parse_quote_line_update(user_text, catalog)
        patch = section or field or lines
    if not patch:
        return result

    props = [
        *props,
        propose_update_quote_proposal(quote_id=entity_id, patch=patch),
    ]
    out = dict(result)
    out["toolProposals"] = props
    out["source"] = "ai"
    if not str(out.get("assistantText") or "").strip():
        out["assistantText"] = "Updating the quote now."
    return out


def try_quote_deterministic_turn(
    *,
    user_text: str,
    draft: dict[str, Any],
    catalog: dict[str, Any],
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Resolve deal/product without the LLM when the match is unambiguous.

    Soft yes/ok after the model asked to confirm a deal/product must never
    round-trip through the LLM (it re-asks and claims the deal isn't found).
    """
    from app.agents.draft_conversation import (
        looks_like_create_confirm,
        quote_draft_ready,
    )

    draft = draft if isinstance(draft, dict) else {}
    if quote_draft_ready(draft) and looks_like_create_confirm(user_text):
        return None  # let create-confirm path emit propose_create_quote

    soft = looks_like_create_confirm(user_text) or bool(
        re.match(
            r"^\s*(both|either|first|the\s+first(\s+one)?|crm|ticketing)\b",
            (user_text or "").strip(),
            re.I,
        )
    )

    base = {"ok": True, "assistantText": ""}
    enriched = enrich_quote_result_from_catalog(
        base,
        user_text=user_text,
        draft=draft,
        catalog=catalog,
        messages=messages,
    )
    patch = enriched.get("patch")
    if not isinstance(patch, dict) or not patch:
        return None

    # Soft confirm always takes the deterministic path once we resolved ids.
    # Free-text turns take it when we newly resolved a missing required field.
    newly = False
    if patch.get("dealId") and not str(draft.get("dealId") or "").strip():
        newly = True
    if patch.get("productId") and not str(draft.get("productId") or "").strip():
        newly = True
    if not soft and not newly:
        return None

    enriched["assistantText"] = ""
    enriched["ok"] = True
    enriched["source"] = "heuristic"
    enriched["reason"] = "quote_deterministic_ids"
    return enriched


async def run_chat_json(
    *,
    system: str,
    user: str,
    max_tokens: int = 600,
) -> dict[str, Any] | None:
    """Call the chat LLM and parse assistantText/patch JSON envelope."""
    from app.agents import chat_agent

    result = await chat_agent.run(
        system=system,
        user=user,
        max_tokens=max_tokens,
        timeout_ms=20_000,
    )
    if not result.get("ok") or not (result.get("text") or "").strip():
        return None
    parsed = parse_assistant_json(str(result["text"]))
    if not parsed or not isinstance(parsed.get("assistantText"), str):
        return None
    out: dict[str, Any] = {
        "assistantText": str(parsed["assistantText"]),
    }
    if isinstance(parsed.get("patch"), dict):
        out["patch"] = parsed["patch"]
    if "actions" in parsed:
        out["actions"] = parsed["actions"]
    if "toolProposals" in parsed:
        out["toolProposals"] = parsed["toolProposals"]
    if parsed.get("navigate") is not None:
        out["navigate"] = parsed["navigate"]
    return out
