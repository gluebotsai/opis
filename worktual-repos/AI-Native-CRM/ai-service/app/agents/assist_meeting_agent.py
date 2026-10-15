"""Meeting Assist agent — KB-backed live coaching suggestions.

Harness (job-agent style):
1. Resolve sales/service mode from the customer question
2. LLM tool loop: model calls `retrieve_knowledge` with a focused query
3. LLM returns coaching JSON grounded in those KB hits + CRM/catalog context

Heuristics / blind KB dump are offline fallback only (`llm_not_configured`,
`llm_unusable_kb_fallback`).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any, Optional, TypedDict

from app.agents.native_pipeline import run_steps

from app.agents.llm_result import (
    extract_json,
    generate_json_with_retries,
    sectioned_system_prompt,
)
from app.llm import chat_with_tools, generate_ai_text, is_ai_configured
from app.services.knowledge_base import get_meeting_knowledge

logger = logging.getLogger(__name__)

# Assist retrieves more KB hits than the default (still clamped ≤8 in client).
ASSIST_KB_LIMIT = 6
# Mid-call latency: at most two KB retrieves, then force the JSON answer.
ASSIST_MAX_TOOL_ROUNDS = 2

RETRIEVE_KNOWLEDGE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "retrieve_knowledge",
        "description": (
            "Search the enterprise knowledge base for facts needed to answer "
            "the CUSTOMER QUESTION. Pass a focused search query (named product, "
            "feature, pricing topic) — not the full transcript. Call this before "
            "answering product, feature, pricing, or how-to questions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Focused retrieval query, e.g. "
                        "'CVM customer value management capabilities' or "
                        "'Cognitive CDP pricing'."
                    ),
                },
                "domain": {
                    "type": "string",
                    "enum": ["product", "support", "business", "sales", "service"],
                    "description": (
                        "product = product docs/capabilities; "
                        "support = customer support how-tos; "
                        "business = company policy. "
                        "Legacy sales→product, service→support. Defaults to detected mode."
                    ),
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}


_ACTION_KINDS = (
    "schedule_meeting",
    "call",
    "send_case_study",
    "involve_presales",
    "send_follow_up",
    "task",
)
_ACTION_LABELS = {
    "schedule_meeting": "Schedule meeting",
    "call": "Create call",
    "send_case_study": "Send case study",
    "involve_presales": "Involve presales",
    "send_follow_up": "Send follow-up",
    "task": "Create task",
}

_ACTION_RULES = (
    "- action is optional. Set it to null on ordinary answers. A product "
    "question, an explanation, or small talk does not get an action.\n"
    "- Set action only when this moment needs a CRM action now: the customer "
    "asked to meet or named a time; they asked to be sent something; a gap "
    "calls for a call, a case study, or presales; or stage, last touch, and "
    "engagement make a follow-up due.\n"
    "- action.kind is one of schedule_meeting, call, send_case_study, "
    "involve_presales, send_follow_up, task.\n"
    "- action.label is the button label (Schedule meeting, Create call, "
    "Send case study, Involve presales, Send follow-up, Create task).\n"
    "- action.detail is one sentence describing what the click will do.\n"
    "- schedule_meeting requires whenLocal as YYYY-MM-DDTHH:mm wall-clock "
    "with no timezone suffix. 'Today' and 'tomorrow' use the local calendar "
    "in the current-time line, not UTC. 'Tomorrow at 4 pm' is 16:00 on that "
    "local tomorrow. durationMinutes is 30 unless they named a length.\n"
    "- send_follow_up and send_case_study require subject and body: the "
    "email that is sent when the rep clicks.\n"
    "- call, involve_presales, and task require subject and body for the "
    "activity the click creates."
)

_ACTION_SCHEMA = (
    '  "action": null or {\n'
    '    "kind": "schedule_meeting|call|send_case_study|involve_presales|'
    'send_follow_up|task",\n'
    '    "label": "button label",\n'
    '    "detail": "what the click will do",\n'
    '    "whenLocal": "YYYY-MM-DDTHH:mm for schedule_meeting",\n'
    '    "durationMinutes": 30,\n'
    '    "subject": "activity or email subject",\n'
    '    "body": "activity detail or email body"\n'
    "  },\n"
)


_SESSION_MEMORY_TURNS = 6


def _format_session_memory(turns: Any) -> str:
    """Last N customer-line + coach-reply pairs. Older turns are omitted."""
    if not isinstance(turns, list) or not turns:
        return "(none yet — this is the first turn)"
    lines: list[str] = []
    for turn in turns[-_SESSION_MEMORY_TURNS:]:
        if not isinstance(turn, dict):
            continue
        query = str(turn.get("query") or "").strip()
        reply = str(turn.get("reply") or "").strip()
        if not query and not reply:
            continue
        lines.append(f"Customer: {query[:400]}\nCoach: {reply[:600]}")
    if not lines:
        return "(none yet — this is the first turn)"
    return "\n\n".join(lines[-_SESSION_MEMORY_TURNS:])


def _kb_prompt_block(kb_context: str) -> str:
    text = (kb_context or "").strip()
    if text:
        return (
            text
            + "\n\nThese knowledge base results are loaded. Answer from them. "
            "Do not say documentation is missing or not loaded."
        )
    return (
        "(no matching knowledge base articles for this question — "
        "answer from the product catalog and the last turns of this call; "
        "do not say the knowledge base is disconnected)"
    )


def _now_clock_line(time_zone: str | None = None) -> str:
    """Local date, weekday, and clock for the rep. 'Today' follows this zone."""
    zone_name = (time_zone or "").strip() or "UTC"
    try:
        zone = ZoneInfo(zone_name)
    except Exception:
        zone = ZoneInfo("UTC")
        zone_name = "UTC"
    now = datetime.now(zone).replace(microsecond=0)
    today = now.strftime("%Y-%m-%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    clock = f"{now.strftime('%A')}, {now.day} {now.strftime('%B %Y')}, {now.strftime('%H:%M')}"
    return (
        f"Current local time: {clock} ({zone_name}). "
        f"Today is {today} ({now.strftime('%A')}). Tomorrow is {tomorrow}. "
        "Today and tomorrow follow this local calendar, not UTC. "
        "A time the customer names, such as 5 PM, is wall-clock in this timezone. "
        "Put it in action.whenLocal as YYYY-MM-DDTHH:mm with no offset, using "
        "today's local date when they say today."
    )


def _parse_action(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or "").strip().lower()
    if kind not in _ACTION_KINDS:
        return None
    detail = str(raw.get("detail") or "").strip()[:400]
    if not detail:
        return None
    label = str(raw.get("label") or "").strip()[:80] or _ACTION_LABELS[kind]
    subject = str(raw.get("subject") or "").strip()[:160] or None
    body = str(raw.get("body") or "").strip()[:2000] or None
    when_local = str(raw.get("whenLocal") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", when_local):
        when_local = ""
    try:
        duration_n = int(raw.get("durationMinutes"))
    except (TypeError, ValueError):
        duration_n = 30
    duration_n = max(15, min(180, duration_n))
    if kind == "schedule_meeting" and not when_local:
        return None
    if kind in {"send_case_study", "send_follow_up"} and not (subject and body):
        return None
    if kind in {"call", "task", "involve_presales"}:
        subject = subject or label
        body = body or detail
    return {
        "kind": kind,
        "label": label,
        "detail": detail,
        "whenLocal": when_local or None,
        "durationMinutes": duration_n if kind == "schedule_meeting" else None,
        "subject": subject,
        "body": body,
    }


class AssistState(TypedDict, total=False):
    live_assist: bool
    persona: str
    mode: str
    query: str
    transcript_window: str
    conversation_context: dict[str, str]
    next_best_action: str | None
    action: dict[str, Any] | None
    sentiment_coach_hint: str | None
    contact_id: Optional[str]
    contact_name: Optional[str]
    company_name: Optional[str]
    provider: Optional[str]
    topic: Optional[str]
    organization_id: Optional[str]
    context_pack_text: str
    product_catalog_text: str
    kb_status: str
    kb_context: str
    kb_queries: list[str]
    suggestions: list[dict[str, Any]]
    talk_track: Optional[str]
    objections: list[str]
    next_questions: list[str]
    fit_gaps: list[dict[str, Any]]
    sentiment: Optional[str]
    status: str
    reason: Optional[str]


_VALID_SENTIMENTS = {"positive", "neutral", "negative", "confused"}


def _normalize_sentiment(raw: Any) -> str:
    value = str(raw or "").strip().lower()
    if value in _VALID_SENTIMENTS:
        return value
    if value in {"happy", "excited", "interested", "engaged"}:
        return "positive"
    if value in {"frustrated", "angry", "upset", "annoyed", "hesitant", "concerned"}:
        return "negative"
    if value in {"confused", "uncertain", "mixed", "unsure"}:
        return "confused"
    return "neutral"


def _build_system_prompt(persona: str = "sales") -> str:
    if (persona or "").strip().lower() == "presales":
        return sectioned_system_prompt(
            role=(
                "You write what a presales person says to the customer on a live "
                "B2B call. The knowledge base supplies the facts. You turn those "
                "facts into the line the presales person would actually say."
            ),
            goal=(
                "Answer the CUSTOMER QUESTION the way a presales person would say "
                "it to this customer, using only knowledge-base and catalog facts, "
                "and note where the need fits or is a gap."
            ),
            instructions=(
                "- PRIMARY: Answer ONLY the CUSTOMER QUESTION.\n"
                "- Call retrieve_knowledge for capabilities, integrations, limits, "
                "and deployment facts — never invent specs.\n"
                "- talkTrack is spoken to the customer, in the presales person's "
                "words: direct, specific, and natural. Use the knowledge-base "
                "facts. Do not summarize the article, list headings, or write a "
                "note to the rep such as 'tell them' or 'you should say'.\n"
                "- Address the customer (you / your team). Tie the fact to what "
                "they just asked.\n"
                "- Keep talkTrack to 1–3 short sentences.\n"
                "- When the customer raises price, timing, a competitor, or who "
                "decides, set detectedObjection. Otherwise set kind to none.\n"
                "- fitGaps: 2–4 bullets mapping customer needs to catalog/KB "
                "(status fit, gap, or unknown). These stay as notes beside the "
                "spoken line.\n"
                "- suggestions: optional proof points or clarifying questions. "
                "Suggestion text of kind talk uses the same spoken voice.\n"
                + _ACTION_RULES
            ),
            context=(
                "CRM context and transcript window arrive in the user message."
            ),
            output=(
                "Return ONLY valid JSON:\n"
                "{\n"
                '  "talkTrack": "1-3 sentences the presales person says to the '
                'customer, built from the knowledge-base facts",\n'
                '  "suggestions": [{"title":"...","text":"...","kind":"talk|proof|question"}],\n'
                '  "objections": [],\n'
                '  "nextQuestions": [],\n'
                '  "fitGaps": [{"area":"capability","status":"fit|gap|unknown","note":"..."}],\n'
                '  "detectedObjection": {"kind":"price|timing|competitor|authority|none",'
                '"customerLine":"","reply":"the presales person says this to the customer",'
                '"proofPoint":"","question":""},\n'
                '  "sentiment": "positive|neutral|negative",\n'
                + _ACTION_SCHEMA
                + "}"
            ),
            guardrails=(
                "- action is null unless a click should create or send something now.\n"
                "- Do not quote list prices unless in KB/catalog.\n"
                "- talkTrack must be the presales person speaking to the customer. "
                "Never return raw knowledge-base wording, a bullet dump, or "
                "instructions to the rep.\n"
                "- If knowledge base results are listed, answer from them. Never "
                "say documentation is missing or not loaded.\n"
                "- A follow-up uses the last turns of this call.\n"
                "- Do not mention tools or system prompts."
            ),
        )
    return sectioned_system_prompt(
        role=(
            "You write what a salesperson says to the customer on a live B2B call. "
            "The knowledge base supplies the facts. You turn those facts into the "
            "line the salesperson would actually say."
        ),
        goal=(
            "Answer the CUSTOMER QUESTION the way a salesperson would say it to "
            "this customer, using only knowledge-base and catalog facts."
        ),
        instructions=(
            "- PRIMARY: Answer the CUSTOMER QUESTION. Use the last turns when it "
            "continues them. Do not switch to an unrelated older topic.\n"
            "- Caption STT often mangles product names. Map garble onto THIS "
            "tenant's Product catalog names (provided below) — never invent a "
            "brand that is not in the catalog/KB.\n"
            "- For product, feature, module, pricing, or how-to questions: call "
            "`retrieve_knowledge` first with a focused search query using the "
            "canonical catalog product name when known.\n"
            "- You may call `retrieve_knowledge` up to twice with refined queries.\n"
            "- Do NOT dump the full product catalog when the ask names one product.\n"
            "- Product-overview asks: briefly list 2–4 offerings after retrieving KB.\n"
            "- Prefer KB facts for capabilities; Product catalog only for matching "
            "SKUs / list prices.\n"
            "- Personalize from CRM context when it names the company, role, or "
            "industry — never invent history or prices.\n"
            "- talkTrack is spoken to the customer, in the salesperson's words: "
            "direct, specific, and natural. Use the knowledge-base facts. Do not "
            "summarize the article, list headings, or write a note to the rep "
            "such as 'tell them' or 'you should say'.\n"
            "- Address the customer (you / your team). Tie the fact to what they "
            "just asked.\n"
            "- When the customer raises price, timing, a competitor, or who "
            "decides, set detectedObjection. Otherwise set kind to none.\n"
            "- Keep talkTrack to 1–3 short sentences. Suggestion text of kind "
            "talk uses the same voice. Max 4 suggestions.\n"
            "- Always fill conversationContext from the CRM pack (account/person, "
            "prior meetings, score/BANT) — even a brief backgroundOneLine when "
            "there is no prior history. Never omit the key.\n"
            + _ACTION_RULES
        ),
        context=(
            "Working context is supplied in the user message: customer question, "
            "CRM pack, optional catalog lines, and transcript window."
        ),
        output=(
            "After tool use (if any), return ONLY valid JSON (no markdown):\n"
            "{\n"
            '  "talkTrack": "1-3 sentences the salesperson says to the customer, '
            'built from the knowledge-base facts",\n'
            '  "suggestions": [\n'
            '    {"title": "short label", "text": "what to say or do", '
            '"kind": "talk|proof|question|objection"}\n'
            "  ],\n"
            '  "objections": ["likely objection"],\n'
            '  "nextQuestions": ["discovery question"],\n'
            '  "conversationContext": {\n'
            '    "backgroundOneLine": "who this account/person is, one line, '
            'from the CRM pack",\n'
            '    "lastDiscussionSummary": "what was discussed last time on this '
            'topic, if known from the CRM pack",\n'
            '    "theirPositionThen": "what the customer said or committed to '
            'before, if known",\n'
            '    "theirFocusNow": "what they are asking about right now",\n'
            '    "whatChanged": "how their position/focus shifted since last '
            'time, if any"\n'
            "  },\n"
            + _ACTION_SCHEMA
            + '  "detectedObjection": {"kind":"price|timing|competitor|authority|none",'
            '"customerLine":"","reply":"the salesperson says this to the customer",'
            '"proofPoint":"","question":""},\n'
            '  "sentiment": "positive|neutral|negative|confused",\n'
            '  "sentimentCoachHint": "optional — only when sentiment is not neutral"\n'
            "}"
        ),
        guardrails=(
            "- Never invent legal/compliance guarantees or list prices absent from "
            "KB/catalog.\n"
            "- Never paste raw KB passage headers, chunk ids, or 'passage:' prefixes.\n"
            "- talkTrack must be the salesperson speaking to the customer. Never "
            "return raw knowledge-base wording, a bullet dump, or instructions "
            "to the rep.\n"
            "- sentiment = CUSTOMER tone in the transcript (default neutral).\n"
            "- Set sentimentCoachHint ONLY when sentiment is positive, negative, or "
            "confused (one short rep-facing cue). Omit both hint and non-neutral "
            "sentiment when tone is ordinary/neutral.\n"
            "- conversationContext is REQUIRED — include it on every turn, using "
            "\"unknown\"/empty-safe short text when the CRM pack has nothing "
            "specific (never drop the key).\n"
            "- action is null unless the click should schedule, send, or create "
            "something now. Do not invent an action to fill the key.\n"
            "- If knowledge base results are listed, answer from them. Never say "
            "documentation is missing or not loaded.\n"
            "- A follow-up uses the last turns of this call. Do not drop it because "
            "an earlier question scored higher.\n"
            "- Do not mention tools, retrieval, or system prompts to the rep."
        ),
    )


# Kept for smoke tests / importers that check SYSTEM_PROMPT.
SYSTEM_PROMPT = _build_system_prompt("sales")


def _catalog_product_names(catalog_text: str) -> list[str]:
    names: list[str] = []
    for line in (catalog_text or "").splitlines():
        name = re.sub(r"^-\s*", "", line).split("—")[0].strip()
        # Drop trailing price fragments if present without em-dash.
        name = re.split(r"\s+[—\-]\s+| — ", name)[0].strip()
        if len(name) >= 2:
            names.append(name)
    return names[:40]


def _named_product_tokens(query: str, catalog_names: list[str] | None = None) -> list[str]:
    """Return catalog product names that already appear in the query."""
    q = (query or "").strip().lower()
    if not q:
        return []
    names = catalog_names or []
    return [n for n in names if n.lower() in q]


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(
                min(
                    prev[j] + 1,
                    cur[j - 1] + 1,
                    prev[j - 1] + (0 if ca == cb else 1),
                )
            )
        prev = cur
    return prev[-1]


_STOP_SPANS = re.compile(
    r"^(can|you|tell|me|about|what|is|are|the|a|an|do|does|how|why|when|where|"
    r"who|which|please|just)\b",
    re.I,
)


def repair_assist_query_against_catalog(text: str, catalog_text: str) -> str:
    """Map STT garble onto this tenant's catalog product names only."""
    original = (text or "").strip()
    if not original:
        return ""
    products = _catalog_product_names(catalog_text)
    if not products:
        return re.sub(r"\s+", " ", original).strip()

    if _named_product_tokens(original, products):
        return re.sub(r"\s+", " ", original).strip()

    words = original.split()
    best: tuple[str, str, int] | None = None  # name, span, dist

    for name in products:
        cn = re.sub(r"[^a-z0-9]", "", name.lower())
        if len(cn) < 3:
            continue
        for i in range(len(words)):
            for length in range(1, 5):
                if i + length > len(words):
                    break
                span = " ".join(words[i : i + length])
                if _STOP_SPANS.match(span) and length <= 2:
                    continue
                cs = re.sub(r"[^a-z0-9]", "", span.lower())
                if len(cs) < 3:
                    continue
                dist = min(
                    _levenshtein(cs, cn),
                    _levenshtein(cs[2:] if cs.startswith("ai") else cs, cn[2:] if cn.startswith("ai") else cn),
                    _levenshtein(cs, "ai" + cn),
                    _levenshtein(cs[:-1] if cs.endswith("s") else cs, cn),
                )
                max_len = max(len(cs), len(cn))
                threshold = min(3, max(1, max_len * 2 // 5))
                if dist > threshold:
                    continue
                if (
                    best is None
                    or dist < best[2]
                    or (dist == best[2] and len(name) > len(best[0]))
                ):
                    best = (name, span, dist)

    if not best:
        return re.sub(r"\s+", " ", original).strip()
    name, span, _ = best
    replaced = re.sub(re.escape(span), name, original, count=1, flags=re.I)
    return re.sub(r"\s+", " ", replaced).strip()


def repair_assist_stt_query(text: str, catalog_text: str = "") -> str:
    """Backward-compatible alias — catalog-driven when catalog_text provided."""
    if catalog_text:
        return repair_assist_query_against_catalog(text, catalog_text)
    return re.sub(r"\s+", " ", (text or "").strip())


# Mirrors backend `GENERIC_PRODUCT_OVERVIEW` — broad catalog asks, not one SKU.
_GENERIC_PRODUCT_LISTING_RE = re.compile(
    r"\b("
    r"what are|what do you|which products|your products|"
    r"products (do )?you (have|offer|sell)|product (list|catalog|portfolio|lineup)|"
    r"what products|tell me about your products|what solutions do you"
    r")\b",
    re.I,
)


def is_generic_product_listing_query(text: str) -> bool:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) < 10:
        return False
    if _GENERIC_PRODUCT_LISTING_RE.search(t):
        return True
    if re.search(r"\bproducts?\b", t, re.I) and re.search(
        r"\b(what|which|list|offer|have|carry|sell)\b", t, re.I
    ):
        return True
    return False


def _filter_catalog_for_query(catalog_text: str, query: str) -> str:
    """When the ask names a product, keep matching catalog lines only."""
    text = (catalog_text or "").strip()
    if not text:
        return text
    names = _catalog_product_names(text)
    tokens = _named_product_tokens(query, names)
    if not tokens:
        # Try repaired query for filtering.
        repaired = repair_assist_query_against_catalog(query, text)
        tokens = _named_product_tokens(repaired, names)
    if not tokens:
        return text
    lines = [ln for ln in text.splitlines() if ln.strip()]
    matched = [
        ln
        for ln in lines
        if any(tok.lower() in ln.lower() for tok in tokens)
    ]
    return "\n".join(matched) if matched else text

def _clean_kb_snippet(ctx: str, *, prefer_tokens: list[str] | None = None) -> str:
    tokens = [t.lower() for t in (prefer_tokens or []) if t]
    lines = [ln.strip() for ln in (ctx or "").splitlines() if ln.strip()]
    scored: list[tuple[int, str]] = []
    for clean in lines:
        low = clean.lower()
        if low.startswith("passage") or low.startswith("●") or low.startswith("*"):
            if ":" in clean[:40]:
                clean = clean.split(":", 1)[1].strip()
                low = clean.lower()
            else:
                continue
        if len(clean) < 40:
            continue
        score = 1
        if tokens and any(tok in low for tok in tokens):
            score += 5
        scored.append((score, clean[:400]))
    scored.sort(key=lambda x: x[0], reverse=True)
    if scored and scored[0][0] > 0:
        return scored[0][1]
    return (ctx or "").strip()[:400]


def _tokens_from_queries(
    queries: list[str],
    customer_query: str,
    catalog_text: str = "",
) -> list[str]:
    blob = " ".join([*(queries or []), customer_query or ""]).lower()
    names = _catalog_product_names(catalog_text)
    hits = _named_product_tokens(blob, names)
    if hits:
        return [h.lower() for h in hits]
    # Fall back to compact tokens from queries for snippet preference.
    return [t for t in re.findall(r"[a-z0-9]{3,}", blob) if t not in {"the", "and", "for", "about"}][:8]


def _parse_assist_json(text: str | None) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    raw = re.sub(r"<think>[\s\S]*?</think>", "", raw, flags=re.I).strip()
    return extract_json(raw)


def _pack_assist_result(
    state: AssistState,
    parsed: dict[str, Any],
    *,
    kb_status: str,
    reason: str | None,
) -> AssistState:
    suggestions_raw = parsed.get("suggestions") or []
    suggestions: list[dict[str, Any]] = []
    if isinstance(suggestions_raw, list):
        for item in suggestions_raw[:4]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip() or "Suggestion"
            body = str(item.get("text") or "").strip()
            kind = str(item.get("kind") or "talk").strip().lower()
            if not body:
                continue
            suggestions.append(
                {"title": title[:80], "text": body[:500], "kind": kind[:32]}
            )

    objections = [
        str(o).strip()[:240]
        for o in (parsed.get("objections") or [])
        if str(o).strip()
    ][:4]
    next_questions = [
        str(q).strip()[:240]
        for q in (parsed.get("nextQuestions") or [])
        if str(q).strip()
    ][:4]
    talk = str(parsed.get("talkTrack") or "").strip()[:800] or None
    if not talk:
        rec = str(parsed.get("recommendation") or "").strip()[:800]
        talk = rec or None
    sentiment = _normalize_sentiment(parsed.get("sentiment"))
    action = _parse_action(parsed.get("action"))
    if action is None and isinstance(parsed.get("nextBestAction"), dict):
        action = _parse_action(parsed.get("nextBestAction"))
    next_best = action["detail"] if action else None
    coach_hint = str(parsed.get("sentimentCoachHint") or "").strip()[:200] or None
    if sentiment == "neutral":
        coach_hint = None
    conversation_context = _parse_conversation_context(parsed.get("conversationContext"))
    detected = _parse_detected_objection(parsed.get("detectedObjection"))

    fit_gaps: list[dict[str, Any]] = []
    raw_gaps = parsed.get("fitGaps") or []
    if isinstance(raw_gaps, list):
        for item in raw_gaps[:6]:
            if not isinstance(item, dict):
                continue
            area = str(item.get("area") or "").strip()
            if not area:
                continue
            status = str(item.get("status") or "unknown").strip().lower()
            if status not in {"fit", "gap", "unknown"}:
                status = "unknown"
            note = str(item.get("note") or "").strip()[:280] or None
            fit_gaps.append({"area": area[:120], "status": status, "note": note})

    return {
        **state,
        "status": "ok",
        "talk_track": talk,
        "suggestions": suggestions,
        "objections": objections,
        "next_questions": next_questions,
        "fit_gaps": fit_gaps,
        "sentiment": sentiment,
        "conversation_context": conversation_context,
        "action": action,
        "next_best_action": next_best,
        "sentiment_coach_hint": coach_hint,
        "detected_objection": detected,
        "kb_status": kb_status,
        "reason": reason,
    }


def _parse_detected_objection(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or "").strip().lower()
    reply = str(raw.get("reply") or "").strip()
    if kind not in {"price", "timing", "competitor", "authority"} or not reply:
        return None
    proof = str(raw.get("proofPoint") or "").strip()
    question = str(raw.get("question") or "").strip()
    return {
        "kind": kind,
        "customerLine": str(raw.get("customerLine") or "").strip()[:400],
        "reply": reply[:800],
        "proofPoint": proof[:400] or None,
        "question": question[:300] or None,
    }


def _parse_conversation_context(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    key_map = {
        "backgroundOneLine": ("backgroundOneLine", "background_one_line"),
        "lastDiscussionSummary": ("lastDiscussionSummary", "last_discussion_summary"),
        "theirPositionThen": ("theirPositionThen", "their_position_then"),
        "theirFocusNow": ("theirFocusNow", "their_focus_now"),
        "whatChanged": ("whatChanged", "what_changed"),
    }
    out: dict[str, str] = {}
    for out_key, variants in key_map.items():
        val = ""
        for v in variants:
            if v in raw and raw[v]:
                val = str(raw[v]).strip()
                break
        if val:
            out[out_key] = val[:500]
    return out if out else None


def _catalog_fallback_state(
    state: AssistState,
    *,
    reason: str,
    kb_status: str,
) -> AssistState | None:
    """Offline fallback when KB/LLM JSON fail but CRM sent a product catalog."""
    catalog = (state.get("product_catalog_text") or "").strip()
    if not catalog:
        return None
    query = (state.get("query") or "").strip()
    filtered = _filter_catalog_for_query(catalog, query)
    names = _catalog_product_names(filtered or catalog)
    if not names:
        return None
    contact = (state.get("contact_name") or "the customer").strip()
    list_text = ", ".join(names[:10])
    talk = (
        f"We offer {list_text}. "
        f"Ask {contact} which capability matters most and tie one product to their stated need."
    )
    return {
        **state,
        "status": "ok",
        "talk_track": talk[:800],
        "suggestions": [
            {
                "title": "From CRM catalog",
                "text": list_text[:500],
                "kind": "proof",
            },
            {
                "title": "Discovery",
                "text": "Which of these is the highest priority for your team this quarter?",
                "kind": "question",
            },
        ],
        "objections": [],
        "next_questions": [
            "Who else needs to sign off on a new platform?",
            "What timeline are you working toward?",
        ],
        "sentiment": "neutral",
        "kb_status": kb_status,
        "reason": reason,
    }


def _kb_fallback_state(
    state: AssistState,
    *,
    reason: str,
    kb_status: str,
) -> AssistState:
    ctx = (state.get("kb_context") or "").strip()
    prefer = _tokens_from_queries(
        list(state.get("kb_queries") or []),
        state.get("query") or "",
        state.get("product_catalog_text") or "",
    )
    snippet = _clean_kb_snippet(ctx, prefer_tokens=prefer) or (
        "No product context available yet."
    )
    return {
        **state,
        "status": "ok",
        "talk_track": snippet,
        "suggestions": [
            {"title": "From knowledge base", "text": snippet, "kind": "proof"},
            {
                "title": "Discovery",
                "text": "Which of these matters most for your team right now?",
                "kind": "question",
            },
        ],
        "objections": [],
        "next_questions": [
            "What does success look like if we solve this?",
            "Who else needs to be involved in the decision?",
        ],
        "sentiment": "neutral",
        "kb_status": kb_status,
        "reason": reason,
    }


_SERVICE_HINTS = re.compile(
    r"\b(support|ticket|bug|outage|downtime|refund|broken|error|incident|"
    r"login|password|not working|help desk|sla|onboarding|how do i|"
    r"can't|cannot|troubleshoot|fix|issue)\b",
    re.I,
)
_SALES_HINTS = re.compile(
    r"\b(price|pricing|quote|quotation|demo|proposal|buy|purchase|roi|"
    r"competitor|discount|contract|feature|product|plan|license|seat|"
    r"trial|upsell|renewal|procurement)\b",
    re.I,
)


def infer_assist_mode(
    *,
    query: str = "",
    transcript_window: str = "",
    topic: str = "",
) -> str:
    blob = f"{query}\n{transcript_window}\n{topic}".strip()
    if not blob:
        return "sales"
    service_hits = len(_SERVICE_HINTS.findall(blob))
    sales_hits = len(_SALES_HINTS.findall(blob))
    if service_hits > sales_hits:
        return "service"
    return "sales"


def resolve_assist_mode(raw: str | None, **hints: str) -> str:
    mode = (raw or "auto").strip().lower()
    if mode in {"service", "support", "cs"}:
        return "service"
    if mode in {"business", "hr", "policy", "company"}:
        return "business"
    if mode in {"sales", "sell", "product"}:
        return "sales"
    return infer_assist_mode(
        query=hints.get("query") or "",
        transcript_window=hints.get("transcript_window") or "",
        topic=hints.get("topic") or "",
    )


def _normalize_context_pack(raw: Any) -> tuple[str, str]:
    """Return (crm_pack_text, product_catalog_text)."""
    if raw is None:
        return "", ""
    if isinstance(raw, str):
        return raw.strip()[:2500], ""
    if not isinstance(raw, dict):
        return "", ""

    pack_text = str(raw.get("packText") or raw.get("pack_text") or "").strip()
    products = raw.get("products")
    product_lines: list[str] = []
    if isinstance(products, list):
        for item in products[:12]:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                price = item.get("price")
                currency = str(item.get("currency") or "").strip()
                if price is not None and str(price).strip():
                    product_lines.append(f"- {name} — {currency} {price}".strip())
                else:
                    product_lines.append(f"- {name}")
            elif str(item).strip():
                product_lines.append(f"- {str(item).strip()}")

    catalog_text = "\n".join(product_lines).strip()
    if not pack_text:
        bits: list[str] = []
        contact = raw.get("contact") if isinstance(raw.get("contact"), dict) else None
        if contact:
            bits.append(f"Contact: {contact.get('name') or 'unknown'}")
        company = raw.get("company") if isinstance(raw.get("company"), dict) else None
        if company and company.get("name"):
            bits.append(f"Company: {company.get('name')}")
        deal = raw.get("primaryDeal") if isinstance(raw.get("primaryDeal"), dict) else None
        if deal and (deal.get("title") or deal.get("stage")):
            bits.append(
                f"Deal: {deal.get('title') or 'Open'} — {deal.get('stage') or ''}".strip()
            )
        summary = raw.get("leadSummary") or raw.get("lead_summary")
        if summary:
            bits.append(f"Lead summary: {str(summary)[:400]}")
        pack_text = "\n".join(bits).strip()

    return pack_text[:2500], catalog_text[:1500]


def _tool_args(call: dict[str, Any]) -> dict[str, Any]:
    fn = call.get("function") if isinstance(call.get("function"), dict) else {}
    raw = (fn or {}).get("arguments")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _tool_name(call: dict[str, Any]) -> str:
    fn = call.get("function") if isinstance(call.get("function"), dict) else {}
    return str((fn or {}).get("name") or call.get("name") or "").strip()


async def _run_retrieve_knowledge(
    *,
    search_query: str,
    domain: str | None,
    default_mode: str,
    catalog_text: str = "",
    organization_id: str | None = None,
) -> dict[str, Any]:
    q = (search_query or "").strip()
    if not q:
        return {
            "status": "failure",
            "error": "empty_query",
            "context": "",
            "query": "",
        }
    mode = resolve_assist_mode(domain or default_mode)
    kb = await get_meeting_knowledge(
        q,
        mode=mode,
        limit=ASSIST_KB_LIMIT,
        organization_id=organization_id,
    )
    raw_context = str(kb.get("context") or "")[:8_000]
    # Prefer paragraphs that match the search / catalog product terms.
    names = _catalog_product_names(catalog_text)
    tokens = [n.lower() for n in _named_product_tokens(q, names)]
    if not tokens:
        tokens = [t for t in re.findall(r"[a-z0-9]{3,}", q.lower())][:6]
    context = raw_context
    if tokens and raw_context:
        parts = [p.strip() for p in re.split(r"\n{2,}", raw_context) if p.strip()]
        matched = [
            p
            for p in parts
            if any(tok in p.lower() for tok in tokens)
            and not p.lower().lstrip().startswith("passage")
        ]
        if matched:
            context = "\n\n".join(matched)[:8_000]
    return {
        "status": kb.get("status") or "failure",
        "query": q,
        "domain": mode,
        "hitCount": kb.get("hitCount") or 0,
        "context": context,
        "error": kb.get("error"),
    }


def _resolve_persona(raw: Any) -> str:
    p = str(raw or "sales").strip().lower()
    return "presales" if p == "presales" else "sales"


async def prepare_assist(state: AssistState) -> AssistState:
    """Resolve mode only — KB is fetched by the LLM via retrieve_knowledge."""
    catalog = state.get("product_catalog_text") or ""
    persona = _resolve_persona(state.get("persona"))
    live_assist = bool(state.get("live_assist"))
    raw_query = (state.get("query") or state.get("transcript_window") or "").strip()
    query = repair_assist_query_against_catalog(raw_query, catalog)
    if not query:
        query = state.get("topic") or "product overview"
    mode = resolve_assist_mode(
        state.get("mode"),
        query=query,
        transcript_window=state.get("transcript_window") or "",
        topic=state.get("topic") or "",
    )
    return {
        **state,
        "live_assist": live_assist,
        "persona": persona,
        "query": query,
        "mode": mode,
        "kb_status": "pending",
        "kb_context": "",
        "kb_queries": [],
    }


async def _generate_assist_live_fast(state: AssistState) -> AssistState:
    """Mid-call path: one KB fetch + one JSON turn (no tool loop) for lower latency."""
    catalog_full = state.get("product_catalog_text") or ""
    query = repair_assist_query_against_catalog(
        (state.get("query") or "").strip(),
        catalog_full,
    )
    mode = state.get("mode") or "sales"
    persona = _resolve_persona(state.get("persona"))
    catalog = _filter_catalog_for_query(catalog_full, query)
    coach_system = _build_system_prompt(persona)
    catalog_listing = is_generic_product_listing_query(query) and bool(
        catalog.strip() or catalog_full.strip()
    )

    if not is_ai_configured():
        kb = await get_meeting_knowledge(
            query or state.get("topic") or "product overview",
            mode=mode,
            limit=ASSIST_KB_LIMIT,
            organization_id=state.get("organization_id"),
        )
        kb_ctx = str(kb.get("context") or "")[:12_000]
        return _kb_fallback_state(
            {
                **state,
                "kb_context": kb_ctx,
                "kb_queries": [query] if query else [],
            },
            reason="llm_not_configured",
            kb_status="success" if kb.get("status") == "success" else "failure",
        )

    if catalog_listing:
        # Live path: skip KB wait for "what products do you offer?" — answer
        # from tenant catalog + CRM context via one LLM JSON turn (~1s budget).
        kb_status = "skipped"
        kb_context = ""
        kb_queries: list[str] = []
    else:
        kb = await get_meeting_knowledge(
            query or state.get("topic") or "product overview",
            mode=mode,
            limit=3,
            organization_id=state.get("organization_id"),
            timeout=2.5,
        )
        kb_status = str(kb.get("status") or "failure")
        kb_context = str(kb.get("context") or "")[:8000]
        kb_queries = [query] if query else []
    state = {
        **state,
        "kb_context": kb_context,
        "kb_queries": kb_queries,
        "kb_status": kb_status,
    }

    answer_user = "\n".join(
        [
            "CUSTOMER QUESTION (answer this, using the last turns when it continues them):",
            query or "(none — use the latest customer question in the transcript)",
            "",
            f"Detected mode: {mode}",
            f"Provider: {state.get('provider') or 'unknown'}",
            f"Contact: {state.get('contact_name') or 'unknown'}",
            f"Company: {state.get('company_name') or 'unknown'}",
            f"Topic: {state.get('topic') or 'n/a'}",
            _now_clock_line(str(state.get("time_zone") or "")),
            "",
            "Last turns of this call (session memory — older turns are dropped):",
            _format_session_memory(state.get("session_memory")),
            "",
            "Customer CRM context (personalize only — do not change the question):",
            (state.get("context_pack_text") or "(empty)")[:900],
            "",
            "Knowledge base results (use these facts — do not invent):",
            _kb_prompt_block(kb_context[:3500]),
            "",
            "Product catalog (SKUs / list prices — list from here for catalog questions):",
            (catalog[:2000] if catalog_listing else catalog[:800]) or "(empty)",
            "",
            "Recent transcript window (context + sentiment only):",
            (state.get("transcript_window") or "(empty)")[:1200],
            "",
            "Using CRM context + transcript, answer these into conversationContext",
            "(required — see system prompt schema):",
            "1) Who is this account/person (one line)? → backgroundOneLine",
            "2) What was discussed last time on this topic? → lastDiscussionSummary",
            "3) What did the customer say/commit then? → theirPositionThen",
            "4) What are they saying now vs before? → theirFocusNow / whatChanged",
            "",
            (
                "Write talkTrack as the presales person would say it to this customer, "
                "using the knowledge-base facts above. Do not summarize the knowledge "
                "base or write a note to the rep. Return ONLY the JSON object now."
                if persona == "presales"
                else
                "Write talkTrack as the salesperson would say it to this customer, "
                "using the knowledge-base facts above. Do not summarize the knowledge "
                "base or write a note to the rep. Return ONLY the JSON object now."
            ),
        ]
    )

    talk_track_key = (
        "talkTrack (1-3 sentences the presales person says to the customer, from the knowledge-base facts)"
        if persona == "presales"
        else
        "talkTrack (1-3 sentences the salesperson says to the customer, from the knowledge-base facts)"
    )
    live_json_keys = (
        "conversationContext (object with backgroundOneLine, lastDiscussionSummary, "
        "theirPositionThen, theirFocusNow, whatChanged), "
        f"{talk_track_key}, action (null, or the object to run on click), "
        "sentimentCoachHint (short rep-facing emotion cue), sentiment, "
        "suggestions (optional, max 2), nextQuestions (optional discovery, max 2)"
    )
    repair_hint = f"Return ONLY one JSON object with keys: {live_json_keys}."
    if persona == "presales":
        repair_hint = (
            f"Return ONLY one JSON object with keys: {live_json_keys}, fitGaps."
        )

    def _valid_coach_json(data: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(data, dict):
            return None
        talk = str(data.get("talkTrack") or data.get("recommendation") or "").strip()
        action = _parse_action(data.get("action"))
        suggestions = data.get("suggestions") or []
        ctx = _parse_conversation_context(data.get("conversationContext"))
        if talk or action or ctx:
            return data
        if isinstance(suggestions, list) and any(
            isinstance(s, dict) and str(s.get("text") or "").strip()
            for s in suggestions
        ):
            return data
        return None

    parsed, json_reason = await generate_json_with_retries(
        system=coach_system,
        user=answer_user,
        # A full response includes conversationContext's 5 sub-fields on top
        # of talkTrack/suggestions/objections/nextQuestions. action is
        # omitted on ordinary answers. Observed full
        # JSON runs ~1400-2100 chars (~350-525 tokens); 320 truncated on
        # attempt 1 almost every time (finish_reason="length"), forcing the
        # slow bumped-token retry (2000 tokens, ~2-3.5s more) on nearly every
        # call — the single biggest remaining latency cost. 700 covers a
        # full response in one attempt with headroom.
        max_tokens=700,
        timeout_ms=5_500,
        attempts=1,
        repair_hint=repair_hint,
        validate=_valid_coach_json,
        # Live mid-call coaching is on a ~1s latency budget — the model's
        # "thinking" pass adds multiple seconds for a JSON turn this short
        # and structured. Only this fast live-assist call site skips it;
        # the slower "Ask" tool-calling path (generate_assist) keeps
        # thinking=True (default) since it isn't on the same latency budget.
        enable_thinking=False,
    )
    if not parsed:
        if kb_context.strip():
            return _kb_fallback_state(
                state,
                reason="llm_unusable_kb_fallback",
                kb_status=kb_status if kb_status != "pending" else "success",
            )
        catalog_fb = _catalog_fallback_state(
            state,
            reason="catalog_fallback_llm_unusable",
            kb_status=kb_status if kb_status != "pending" else "skipped",
        )
        if catalog_fb:
            return catalog_fb
        return {
            **state,
            "status": "failed",
            "reason": json_reason or "empty_or_invalid_llm",
            "suggestions": [],
            "talk_track": None,
            "objections": [],
            "next_questions": [],
            "fit_gaps": [],
            "sentiment": "neutral",
        }

    reason = None if kb_status == "success" else (
        "kb_not_retrieved" if kb_status == "skipped" else "kb_unavailable"
    )
    return _pack_assist_result(
        state,
        parsed,
        kb_status=kb_status,
        reason=reason,
    )


async def generate_assist(state: AssistState) -> AssistState:
    if state.get("live_assist"):
        return await _generate_assist_live_fast(state)

    catalog_full = state.get("product_catalog_text") or ""
    query = repair_assist_query_against_catalog(
        (state.get("query") or "").strip(),
        catalog_full,
    )
    mode = state.get("mode") or "sales"
    persona = _resolve_persona(state.get("persona"))
    catalog = _filter_catalog_for_query(catalog_full, query)
    coach_system = _build_system_prompt(persona)

    # Offline path: one deterministic retrieve (not LLM tool), clearly labeled.
    if not is_ai_configured():
        kb = await get_meeting_knowledge(
            query or state.get("topic") or "product overview",
            mode=mode,
            limit=ASSIST_KB_LIMIT,
            organization_id=state.get("organization_id"),
        )
        kb_ctx = str(kb.get("context") or "")[:12_000]
        return _kb_fallback_state(
            {
                **state,
                "kb_context": kb_ctx,
                "kb_queries": [query] if query else [],
            },
            reason="llm_not_configured",
            kb_status="success" if kb.get("status") == "success" else "failure",
        )

    brief_user = "\n".join(
        [
            "CUSTOMER QUESTION:",
            query or "(none)",
            f"Detected mode: {mode}",
            f"Contact: {state.get('contact_name') or 'unknown'}",
            f"Company: {state.get('company_name') or 'unknown'}",
            f"Topic: {state.get('topic') or 'n/a'}",
            "",
            "Call retrieve_knowledge with a focused search query for this question "
            "(named product/feature/pricing). Do not answer yet.",
        ]
    )

    kb_chunks: list[str] = []
    kb_queries: list[str] = []
    kb_status = "skipped"

    # --- Tool loop: LLM chooses KB queries ---
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": (
                "You retrieve product knowledge for a live sales assist coach. "
                "Call retrieve_knowledge with a focused query derived from the "
                "CUSTOMER QUESTION. Prefer this tenant's Product catalog names. "
                "If STT looks garbled, search the closest catalog product — "
                "do not invent brands missing from the catalog."
            ),
        },
        {"role": "user", "content": brief_user},
    ]

    for round_idx in range(ASSIST_MAX_TOOL_ROUNDS):
        result = await chat_with_tools(
            messages=messages,
            tools=[RETRIEVE_KNOWLEDGE_TOOL],
            max_tokens=300,
            timeout_ms=20_000,
            temperature=0.2,
        )
        if not result:
            break
        tool_calls = [
            c for c in (result.get("tool_calls") or []) if isinstance(c, dict)
        ]
        if not tool_calls:
            break

        # OpenAI requires function.arguments as a JSON *string* when echoed back.
        serialized_calls: list[dict[str, Any]] = []
        for call in tool_calls:
            fn = call.get("function") if isinstance(call.get("function"), dict) else {}
            args = (fn or {}).get("arguments")
            if isinstance(args, dict):
                args_s = json.dumps(args)
            else:
                args_s = str(args or "{}")
            serialized_calls.append(
                {
                    "id": str(call.get("id") or f"call_{round_idx}"),
                    "type": "function",
                    "function": {
                        "name": str((fn or {}).get("name") or ""),
                        "arguments": args_s,
                    },
                }
            )

        messages.append(
            {
                "role": "assistant",
                "content": result.get("content") or None,
                "tool_calls": serialized_calls,
            }
        )

        retrieved_this_round = False
        for call in tool_calls:
            name = _tool_name(call)
            call_id = str(call.get("id") or f"call_{round_idx}")
            if name != "retrieve_knowledge":
                tool_payload = {"status": "failure", "error": f"unknown_tool:{name}"}
            else:
                args = _tool_args(call)
                search_q = str(args.get("query") or "").strip()
                domain = str(args.get("domain") or "").strip() or None
                tool_payload = await _run_retrieve_knowledge(
                    search_query=search_q,
                    domain=domain,
                    default_mode=mode,
                    catalog_text=catalog_full,
                    organization_id=state.get("organization_id"),
                )
                if tool_payload.get("query"):
                    kb_queries.append(str(tool_payload["query"]))
                ctx = str(tool_payload.get("context") or "").strip()
                if ctx and tool_payload.get("status") == "success":
                    kb_chunks.append(ctx)
                    kb_status = "success"
                    retrieved_this_round = True
                elif kb_status != "success":
                    kb_status = "failure"
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": json.dumps(tool_payload)[:10_000],
                }
            )

        # One successful retrieve is enough for mid-call latency.
        if retrieved_this_round:
            break

        messages.append(
            {
                "role": "user",
                "content": (
                    "Refine retrieve_knowledge with a more specific product query, "
                    "or stop if nothing relevant exists."
                ),
            }
        )

    kb_context = "\n\n---\n\n".join(kb_chunks)[:12_000]
    state = {
        **state,
        "kb_context": kb_context,
        "kb_queries": kb_queries,
        "kb_status": kb_status,
    }

    # --- Answer turn: no tools; coach JSON from retrieved KB ---
    answer_user = "\n".join(
        [
            "CUSTOMER QUESTION (answer this, using the last turns when it continues them):",
            query or "(none — use the latest customer question in the transcript)",
            "",
            f"Detected mode: {mode}",
            f"Provider: {state.get('provider') or 'unknown'}",
            f"Contact: {state.get('contact_name') or 'unknown'}",
            f"Company: {state.get('company_name') or 'unknown'}",
            f"Topic: {state.get('topic') or 'n/a'}",
            _now_clock_line(str(state.get("time_zone") or "")),
            "",
            "Last turns of this call (session memory — older turns are dropped):",
            _format_session_memory(state.get("session_memory")),
            "",
            "Customer CRM context (personalize only — do not change the question):",
            (state.get("context_pack_text") or "(empty)")[:2500],
            "",
            "Knowledge base results from retrieve_knowledge "
            f"(queries={kb_queries or ['(none)']}):",
            _kb_prompt_block(kb_context[:8000]),
            "",
            "Product catalog (SKUs / list prices — only if relevant to CUSTOMER QUESTION):",
            catalog[:1500] or "(empty)",
            "",
            "Recent transcript window (context + sentiment only — do NOT switch topics):",
            (state.get("transcript_window") or "(empty)")[:6000],
            "",
            (
                "Write talkTrack as the presales person would say it to this customer, "
                "using the knowledge-base facts above. Do not summarize the knowledge "
                "base or write a note to the rep. Return ONLY the JSON object now."
                if persona == "presales"
                else
                "Write talkTrack as the salesperson would say it to this customer, "
                "using the knowledge-base facts above. Do not summarize the knowledge "
                "base or write a note to the rep. Return ONLY the JSON object now."
            ),
        ]
    )

    def _valid_coach_json(data: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(data, dict):
            return None
        talk = str(data.get("talkTrack") or data.get("recommendation") or "").strip()
        action = _parse_action(data.get("action"))
        suggestions = data.get("suggestions") or []
        ctx = _parse_conversation_context(data.get("conversationContext"))
        if talk or action or ctx:
            return data
        if isinstance(suggestions, list) and any(
            isinstance(s, dict) and str(s.get("text") or "").strip()
            for s in suggestions
        ):
            return data
        return None

    repair_hint = (
        "Return ONLY one JSON object with keys talkTrack, suggestions, "
        "objections, nextQuestions, sentiment. No markdown fences or prose."
    )
    if persona == "presales":
        repair_hint = (
            "Return ONLY one JSON object with keys talkTrack, suggestions, "
            "objections, nextQuestions, fitGaps, sentiment. fitGaps is an array "
            "of {area, status: fit|gap|unknown, note}."
        )

    parsed, json_reason = await generate_json_with_retries(
        system=coach_system,
        user=answer_user,
        max_tokens=700,
        timeout_ms=25_000,
        attempts=2,
        repair_hint=repair_hint,
        validate=_valid_coach_json,
    )
    if not parsed:
        if kb_context.strip():
            return _kb_fallback_state(
                state,
                reason="llm_unusable_kb_fallback",
                kb_status=kb_status if kb_status != "pending" else "success",
            )
        catalog_fb = _catalog_fallback_state(
            state,
            reason="catalog_fallback_kb_unavailable"
            if kb_status == "failure"
            else "catalog_fallback_llm_unusable",
            kb_status=kb_status if kb_status != "pending" else "skipped",
        )
        if catalog_fb:
            return catalog_fb
        logger.warning(
            "assist-meeting empty_or_invalid_llm reason=%s queries=%s",
            json_reason or "empty_or_invalid_llm",
            kb_queries,
        )
        return {
            **state,
            "status": "failed",
            "reason": json_reason or "empty_or_invalid_llm",
            "suggestions": [],
            "talk_track": None,
            "objections": [],
            "next_questions": [],
            "sentiment": "neutral",
        }

    reason = None if kb_status == "success" else (
        "kb_not_retrieved" if kb_status == "skipped" else "kb_unavailable"
    )
    return _pack_assist_result(
        state,
        parsed,
        kb_status=kb_status,
        reason=reason,
    )


_PIPELINE_STEPS = (
    prepare_assist,
    generate_assist,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    *,
    query: str | None = None,
    transcript_window: str | None = None,
    mode: str = "auto",
    persona: str = "sales",
    live_assist: bool = True,
    contact_id: str | None = None,
    contact_name: str | None = None,
    company_name: str | None = None,
    provider: str | None = None,
    topic: str | None = None,
    organization_id: str | None = None,
    context_pack: Any = None,
    session_memory: list | None = None,
    time_zone: str | None = None,
) -> dict[str, Any]:
    pack_text, catalog_text = _normalize_context_pack(context_pack)
    result = await _run_pipeline(
        {
            "live_assist": bool(live_assist),
            "persona": _resolve_persona(persona),
            "mode": mode or "auto",
            "query": (query or "").strip(),
            "transcript_window": (transcript_window or "").strip(),
            "session_memory": session_memory if isinstance(session_memory, list) else [],
            "time_zone": (time_zone or "").strip(),
            "contact_id": contact_id,
            "contact_name": contact_name,
            "company_name": company_name,
            "provider": provider,
            "topic": topic,
            "organization_id": organization_id,
            "context_pack_text": pack_text,
            "product_catalog_text": catalog_text,
            "status": "running",
        }
    )
    return {
        "ok": result.get("status") == "ok",
        "kbStatus": result.get("kb_status"),
        "kbQueries": result.get("kb_queries") or [],
        "talkTrack": result.get("talk_track"),
        "suggestions": result.get("suggestions") or [],
        "objections": result.get("objections") or [],
        "nextQuestions": result.get("next_questions") or [],
        "fitGaps": result.get("fit_gaps") or [],
        "sentiment": result.get("sentiment") or "neutral",
        "conversationContext": result.get("conversation_context"),
        "action": result.get("action"),
        "nextBestAction": result.get("next_best_action"),
        "sentimentCoachHint": result.get("sentiment_coach_hint"),
        "detectedObjection": result.get("detected_objection"),
        "reason": result.get("reason"),
    }
