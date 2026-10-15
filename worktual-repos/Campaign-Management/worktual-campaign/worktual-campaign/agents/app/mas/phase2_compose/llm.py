"""OpenAI-compatible LLM client for compose pipeline."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from openai import OpenAI

# Fallbacks if campaign settings / env are unset. Prefer app.config (our LLM).
DEFAULT_BASE_URL = "http://81.17.61.149:8066/v1"
DEFAULT_MODEL = "worktual-qwen-27B"
DEFAULT_API_KEY = "dummy"

COMPOSE_TEMPERATURE = 0.95
COMPOSE_TOP_P = 0.95
PLAN_TEMPERATURE = 0.4
# Full HTML emails need a large budget; omit-style high cap + continue on length
# so the user never sees a max-token dead end (Streamlit omitted max_tokens).
COMPOSE_MAX_TOKENS = 16384
COMPOSE_LENGTH_CONTINUES = 2

# Taste / bans / modes only — never a fixed section layout (that locks structure).
TEMPLATE_COMPOSE_SYSTEM = (
    "You are an HTML email template creator for mail. "
    "Create a complete HTML email for the user's request.\n\n"
    "Follow the plan's content_brief and email_kind. Invent a structure that fits "
    "this request — do not reuse a house layout, and do not invent a section recipe.\n\n"
    "Taste (quality, not layout):\n"
    "- Clean, neat, easy to scan; clear hierarchy; limited colors.\n"
    "- Prefer restraint over decoration unless the request asks for more.\n"
    "- If the user request or content_brief asks for longer / more / larger copy "
    "or image blocks, follow that — do not shrink to a short teaser.\n"
    "- Open the body with a greeting that uses the merge tag {{first_name}} "
    "(e.g. Hi {{first_name}},). Do not invent other contact tags "
    "({{company}}, {{city}}) unless the user asked.\n\n"
    "Bans (avoid these habits):\n"
    "- No marquees/tickers, sticker/badge piles, heavy animations, or terminal/code gimmicks.\n"
    "- No fake metrics, invented addresses, or stock-layout chrome the user did not ask for.\n"
    "- Do not add Unsubscribe, Privacy Policy, or legal footers — Campaign injects one Unsubscribe link.\n"
    "- If no images are provided, do not add img tags or placeholder image URLs.\n"
    "- If images are provided, use only those URLs with the given width and height.\n\n"
    "Modes from email_kind / content_brief:\n"
    "- letter | congratulations | thank_you: prose only — no buttons, no CTA, no stats strips, no offers.\n"
    "- marketing | announcement | launch: scan-friendly copy. Do not add a button, "
    "CTA, or extra <a> unless the user asked for a click action OR knowledge/chat "
    "includes a real http(s) product/landing URL. Knowledge with no links is not "
    "a reason to invent Shop / Learn more.\n"
    "- If you do include a CTA, its href MUST be the exact https URL from "
    "the CTA constraint (knowledge, form, or user). Never href=\"#\", "
    "never {{campaign_url}}, never an empty or invented URL. "
    "Campaign injects Unsubscribe separately.\n"
    "- If constraints conflict, follow the user's request and content_brief literally.\n"
    "- If knowledge.copy_mode is illustrative: finished copy only — never "
    "[bracket] placeholders or 'Your Company Name'. Use knowledge.company as the "
    "brand. Features and benefits should sound real for that industry; do not "
    "invent prices or addresses.\n\n"
    "Reply with HTML only — no markdown fences, no explanation."
)

PLAN_SYSTEM = (
    "You plan HTML email content before design. "
    "Output a single JSON object only (no markdown).\n\n"
    "Fields:\n"
    "- subject: string\n"
    "- preheader: string\n"
    "- email_kind: one of letter, congratulations, thank_you, reminder, "
    "marketing, announcement, launch, other\n"
    "- content_brief: what the email must say (names, occasion, tone, constraints). "
    "Include taste constraints here (e.g. sentences only, no CTA) — never a fixed "
    "section list or layout blueprint.\n"
    "- image_slots: array of {role, needed, width_px, height_px, prompt}\n\n"
    "Rules:\n"
    "- Pick email_kind from the user intent. Letters / congratulations / thank-you / "
    "reminders with no visual ask → image_slots empty or all needed:false; "
    "content_brief must say prose only, no buttons, no stats, no discounts if asked.\n"
    "- Marketing / launch / visual ask → one hero slot is enough unless the user "
    "asked for more / image blocks; then add those slots (needed:true).\n"
    "- Do not invent a CTA in content_brief unless the user asked for a button/link "
    "or knowledge/chat includes a real http(s) landing URL. If knowledge has no "
    "links, content_brief must say prose only, no buttons.\n"
    "- content_brief must include a greeting that uses {{first_name}} "
    "(e.g. Hi {{first_name}},). No other contact merge tags unless the user asked.\n"
    "- If knowledge.copy_mode is illustrative: write plausible industry-typical "
    "copy using knowledge.company and knowledge.industry. Never use square-bracket "
    "placeholders ([Feature Name], [Your Company Name], lorem). Do not invent "
    "prices, street addresses, phone numbers, or fake metrics.\n"
    "- If knowledge has verified facts (kb_snippets / pack_fields), use those; "
    "do not invent extras.\n"
    "- Do not invent company names, addresses, phone numbers, or fake metrics unless "
    "the user or knowledge provided them.\n"
    "- Do not prescribe layout sections (no hero-then-cards-then-FAQ recipes).\n"
    "- Honor all user constraints literally.\n"
    "- Chat context and this-turn request override a short default: if they asked "
    "for longer / more / larger copy or image blocks, content_brief must say so "
    "and image_slots should include those blocks when images are available.\n"
)


def _campaign_llm() -> tuple[str, str, str]:
    """Use the same OpenAI-compatible gateway as the rest of Campaign agents."""
    try:
        from app.config import get_settings

        settings = get_settings()
        return (
            str(settings.llm_base_url or DEFAULT_BASE_URL),
            str(settings.llm_model or DEFAULT_MODEL),
            str(settings.llm_api_key or DEFAULT_API_KEY),
        )
    except Exception:  # noqa: BLE001
        return (DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_API_KEY)


def llm_client() -> OpenAI:
    base, _model, key = _campaign_llm()
    return OpenAI(
        base_url=os.environ.get("LLM_BASE_URL", base),
        api_key=os.environ.get("LLM_API_KEY", key),
    )


def llm_model() -> str:
    _base, model, _key = _campaign_llm()
    return os.environ.get("LLM_MODEL", model)


def strip_fences(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:html|HTML|json)?\s*\n(.*?)```\s*$", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    return text


_THINK_BLOCK = re.compile(r"<think\b[^>]*>[\s\S]*?</think>", re.I)
_HTML_START = re.compile(
    r"(?:<!DOCTYPE\s+html\b|<html\b|<body\b|<table\b|<div\b|<p\b)",
    re.I,
)


def looks_like_html(text: str) -> bool:
    """True when the string contains real email markup, not a planning dump."""
    return bool(_HTML_START.search(str(text or "")))


def extract_email_html(text: str) -> str:
    """Keep HTML only. Drop <think> and chain-of-thought with no markup."""
    t = _THINK_BLOCK.sub("", str(text or "")).strip()
    t = strip_fences(t)
    if not t:
        return ""
    m = _HTML_START.search(t)
    if not m:
        return ""
    return t[m.start() :].strip()


def chat_completion(
    *,
    system: str,
    user: str,
    temperature: float = COMPOSE_TEMPERATURE,
    top_p: float = COMPOSE_TOP_P,
) -> str:
    client = llm_client()
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    chunks: list[str] = []
    for _attempt in range(1 + COMPOSE_LENGTH_CONTINUES):
        kwargs: dict[str, Any] = {
            "model": llm_model(),
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": COMPOSE_MAX_TOKENS,
        }
        extra = {
            "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_effort": "none",
        }
        from app.mas.runtime.llm_io_log import (
            llm_io_set_context,
            log_llm_input,
            log_llm_output,
        )

        llm_io_set_context(source="phase2_compose")
        log_llm_input({**kwargs, "extra_body": extra})
        try:
            resp = client.chat.completions.create(**kwargs, extra_body=extra)
        except Exception:  # noqa: BLE001
            resp = client.chat.completions.create(**kwargs)
        choice = (resp.choices or [None])[0]
        text = ""
        finish = ""
        if choice is not None:
            text = str((choice.message.content if choice.message else None) or "").strip()
            finish = str(choice.finish_reason or "").strip().lower()
        log_llm_output(
            {
                "content": text,
                "finish_reason": finish,
                "model": llm_model(),
            }
        )
        if text:
            chunks.append(text)
        if finish != "length" or not text:
            break
        messages.append({"role": "assistant", "content": text})
        messages.append(
            {
                "role": "user",
                "content": (
                    "Continue from where you stopped. "
                    "Output only the remaining HTML, no markdown fences, no explanation."
                ),
            }
        )
    return "".join(chunks).strip()


def chat_json(*, system: str, user: str) -> dict[str, Any]:
    raw = chat_completion(system=system, user=user, temperature=PLAN_TEMPERATURE, top_p=0.9)
    raw = strip_fences(raw)
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return {}


async def achat_completion(
    *,
    system: str,
    user: str,
    temperature: float = COMPOSE_TEMPERATURE,
    top_p: float = COMPOSE_TOP_P,
) -> str:
    """Async wrapper — sync OpenAI must not block the agents event loop / websockets."""
    import asyncio

    return await asyncio.to_thread(
        chat_completion,
        system=system,
        user=user,
        temperature=temperature,
        top_p=top_p,
    )


async def achat_json(*, system: str, user: str) -> dict[str, Any]:
    import asyncio

    return await asyncio.to_thread(chat_json, system=system, user=user)
