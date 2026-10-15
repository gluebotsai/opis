"""Daily voice briefing — today's to-dos as punctuated spoken prose."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.llm_result import (
    extract_json,
    label_ai,
    label_fallback,
    sectioned_system_prompt,
)
from app.llm import generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.\w+\b", re.I)
_AMOUNT = re.compile(
    r"(?:₹|rs\.?|inr|usd|eur|gbp|\$|€|£)\s*[\d,]+(?:\.\d+)?|"
    r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b",
    re.I,
)
_CLOSERS = [
    "Have a great day!",
    "Have a good one.",
    "Take care today.",
    "Wishing you a smooth day ahead.",
    "All the best for today.",
    "Make it a good one.",
]
_CLOSER_RE = re.compile(
    r"have a (great|good|nice|lovely) (day|one)|take care|smooth day|"
    r"all the best|enjoy (your|the) day|make it a good one|go well today",
    re.I,
)


def _fallback_closer(seed: str) -> str:
    h = 0
    for ch in seed:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _CLOSERS[h % len(_CLOSERS)]


def _with_closer(script: str, seed: str = "") -> str:
    body = _clean_prose(script)
    closer = _fallback_closer(seed or "briefing")
    if not body:
        return closer
    if _CLOSER_RE.search(body):
        return body
    return f"{body}\n{closer}"

_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
]
_TEENS = [
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen",
]
_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
]


def _under_hundred(n: int) -> str:
    if n < 10:
        return _ONES[n]
    if n < 20:
        return _TEENS[n - 10]
    tens, ones = divmod(n, 10)
    if ones == 0:
        return _TENS[tens]
    return f"{_TENS[tens]} {_ONES[ones]}"


def integer_to_spoken_words(n: int) -> str:
    if n < 0:
        return f"minus {integer_to_spoken_words(-n)}"
    if n < 100:
        return _under_hundred(n)
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        head = f"{_ONES[hundreds]} hundred"
        return head if rest == 0 else f"{head} and {_under_hundred(rest)}"
    if n < 1_000_000:
        thousands, rest = divmod(n, 1000)
        head = f"{integer_to_spoken_words(thousands)} thousand"
        if rest == 0:
            return head
        if rest < 100:
            return f"{head} and {_under_hundred(rest)}"
        return f"{head} {integer_to_spoken_words(rest)}"
    return str(n)


def digits_to_spoken_text(text: str) -> str:
    # Leave clock fragments like 10:30 so TTS can pause on the colon.
    return re.sub(
        r"(?<![:\d])\b\d+\b(?![:\d])",
        lambda m: integer_to_spoken_words(int(m.group(0))),
        text,
    )


def _ensure_sentence(text: str) -> str:
    trimmed = re.sub(r"[ \t]+", " ", text).strip(" -•*")
    trimmed = trimmed.strip()
    if not trimmed:
        return ""
    if trimmed[-1] in ".!?…":
        return trimmed
    return f"{trimmed}."


def _as_bullet_block(text: str) -> str:
    raw = text.strip()
    if "\n" not in raw and len(raw) > 90:
        chunks = re.split(r"(?<=[.!?])\s+", raw)
    else:
        chunks = re.split(r"[\n\r]+", raw)
    lines: list[str] = []
    for chunk in chunks:
        piece = re.sub(r"^[ \t]*[-•*]+\s*", "", chunk)
        piece = _ensure_sentence(piece)
        if piece:
            lines.append(piece)
    return "\n".join(lines)


def _clean_prose(raw: Any, first_name: str = "") -> str:
    text = str(raw or "").strip()
    text = _EMAIL.sub("", text)
    text = _AMOUNT.sub("", text)
    text = digits_to_spoken_text(text)
    name = first_name.strip()
    if name:
        text = re.sub(rf"^{re.escape(name)}\s*,\s*", "", text, flags=re.I)
        text = re.sub(
            rf"^(morning|hey|evening|good morning|good afternoon|good evening)\s+{re.escape(name)}[.,!]?\s*",
            "",
            text,
            flags=re.I,
        )
        text = re.sub(
            r"^(good morning|good afternoon|good evening)[.,!]?\s*",
            "",
            text,
            flags=re.I,
        )
    text = _as_bullet_block(text)
    if len(text) > 3500:
        text = text[:3497].rstrip() + "…"
    return text


def _clamp_lines(lines: Any, first_name: str = "") -> list[str]:
    if not isinstance(lines, list):
        return []
    out: list[str] = []
    for item in lines:
        cleaned = _clean_prose(item, first_name)
        for line in cleaned.split("\n"):
            if line:
                out.append(line)
            if len(out) >= 24:
                return out
    return out


def _pulse(payload: dict[str, Any]) -> dict[str, int]:
    raw = payload.get("pulse") if isinstance(payload.get("pulse"), dict) else {}
    out: dict[str, int] = {}
    for key in (
        "openDeals",
        "untouchedLeads",
        "needsReview",
        "overdueInvoices",
        "meetingsToday",
        "overdueTasks",
    ):
        try:
            out[key] = int(raw.get(key) or 0)
        except (TypeError, ValueError):
            out[key] = 0
    return out


def _human_count(n: int) -> str:
    if n <= 0:
        return "no"
    if n == 1:
        return "one"
    if n == 2:
        return "a couple of"
    if n <= 12:
        return integer_to_spoken_words(n)
    if n < 40:
        return "a couple of dozen"
    if n < 80:
        return "around fifty"
    if n < 130:
        return "around a hundred"
    if n < 180:
        return "well over a hundred"
    if n < 250:
        return "around two hundred"
    if n < 400:
        return "a few hundred"
    return "quite a lot of"


def _contact(row: Any) -> str:
    if not isinstance(row, dict):
        return "someone"
    return str(row.get("contactName") or "someone").strip() or "someone"


def _title(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return str(row.get("title") or row.get("subject") or "").strip()


def _when(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return str(row.get("when") or "").strip()


def _heuristic_lines(payload: dict[str, Any]) -> list[str]:
    role = str(payload.get("role") or "")
    pulse = _pulse(payload)
    meetings = payload.get("meetings") if isinstance(payload.get("meetings"), list) else []
    tasks = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
    follow_ups = payload.get("followUps") if isinstance(payload.get("followUps"), list) else []
    invoices = payload.get("invoices") if isinstance(payload.get("invoices"), list) else []
    picked: list[str] = []

    if meetings:
        bits: list[str] = []
        for row in meetings:
            who = _contact(row)
            title = _title(row)
            when = _when(row)
            piece = f"{who}"
            if when:
                piece += f" at {when}"
            if title:
                piece += f", for {title}"
            bits.append(piece)
        if len(bits) == 1:
            picked.append(f"Meeting: {bits[0]}.")
        else:
            for bit in bits:
                picked.append(f"Meeting: {bit}.")

    if tasks:
        bits = []
        for row in tasks:
            who = _contact(row)
            title = _title(row) or "an open task"
            overdue = bool(isinstance(row, dict) and row.get("overdue"))
            label = f"{title} with {who}"
            if overdue:
                label += ", overdue"
            bits.append(label)
        for bit in bits:
            picked.append(f"Task: {bit}.")

    if follow_ups:
        for row in follow_ups:
            who = _contact(row)
            title = _title(row) or "a follow-up"
            picked.append(f"Reminder: {title} with {who}.")

    if role in {"admin", "sales_manager"}:
        if pulse["untouchedLeads"]:
            picked.append(
                f"Quiet leads: {_human_count(pulse['untouchedLeads'])} need a nudge."
            )
        if pulse["needsReview"]:
            picked.append(
                f"Reviews waiting: {_human_count(pulse['needsReview'])} contacts."
            )
        if pulse["overdueInvoices"]:
            picked.append("Collections: a few invoices are past due.")
        if not picked and pulse["openDeals"]:
            picked.append("Pipeline is open. Keep the team moving.")
        if not picked:
            picked.append("Calm day. Good window to check in with the team.")
        return [digits_to_spoken_text(_ensure_sentence(line)) for line in picked]

    if role == "finance":
        if invoices:
            names = []
            for row in invoices:
                if isinstance(row, dict):
                    names.append(str(row.get("companyName") or "a customer"))
            unique = list(dict.fromkeys(names))
            first = unique[0]
            picked.append(f"Chase {first} first on overdue payment.")
            extra = len(unique) - 1
            if extra > 0:
                rest = ", ".join(unique[1:-1])
                last = unique[-1]
                more = f"{rest}, and {last}" if rest else last
                picked.append(f"Also past due: {more}.")
        elif pulse["overdueInvoices"]:
            picked.append("A few invoices are past due. A friendly reminder today.")
        if not picked:
            picked.append("Collections is quiet. Nothing overdue.")
        return [digits_to_spoken_text(_ensure_sentence(line)) for line in picked]

    if pulse["untouchedLeads"] and len(meetings) + len(tasks) < 2:
        picked.append("A few leads have gone quiet. A short hello helps.")
    if not picked and pulse["openDeals"]:
        picked.append("Open deals on the board. Push one forward if you can.")
    if not picked:
        picked.append("Light day. Good moment to reach out to someone new.")
    return [digits_to_spoken_text(_ensure_sentence(line)) for line in picked]


def _role_instructions(role: str) -> str:
    if role in {"admin", "sales_manager"}:
        return (
            "- Brief a sales leader: today's personal calendar first if listed, then team health.\n"
            "- Talk about people going quiet, reviews waiting, money stuck — not KPI labels.\n"
            "- Soften large org counts (around two hundred) instead of exact recitals.\n"
            "- Never say the day is empty if meetings, tasks, or pulse items are listed."
        )
    if role == "finance":
        return (
            "- You are a calm collections colleague.\n"
            "- Name each overdue customer in the invoice list, not just the first one.\n"
            "- Skip personal meetings unless listed."
        )
    return (
        "- You are a helpful sales buddy walking through today's to-do list.\n"
        "- Cover every meeting, task, and follow-up in the context. If there is only one, say just that.\n"
        "- Use contact first names and meeting times when provided.\n"
        "- Do not use the listener's own name in the body."
    )


async def run(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload if isinstance(payload, dict) else {}
    role = str(body.get("role") or "")
    first_name = str(body.get("firstName") or "there")
    hour = body.get("hourIst")

    compact = {
        "role": role,
        "hourIst": hour,
        "pulse": _pulse(body),
        "meetings": body.get("meetings") or [],
        "tasks": body.get("tasks") or [],
        "followUps": body.get("followUps") or [],
        "invoices": body.get("invoices") or [],
    }

    system = sectioned_system_prompt(
        role=(
            "You are a warm, senior CRM colleague at Worktual in India. "
            "You brief people the way a human would, with natural pauses."
        ),
        goal=(
            "Write today's briefing as short, sweet bullet points: to-dos, reminders, "
            "meetings, and other important work. One point per line. Mention every listed "
            "item. Few items stay few lines. Many items stay one short line each."
        ),
        instructions=(
            f"{_role_instructions(role)}\n"
            "- Output a short bulleted list only. Each bullet is one short line, under twelve words.\n"
            "- Put each bullet on its own line. Do not write a paragraph.\n"
            "- No markdown dashes that TTS would read aloud. Plain lines ending with a period.\n"
            "- Contractions are good (there's, you'll).\n"
            "- Soften org-wide counts: around two hundred, a few, a couple.\n"
            "- If you must use a number, write it in English words, except clock times like 10:30 am.\n"
            "- Do not greet; greeting is added separately.\n"
            "- Last line is a short, warm sign-off in the spirit of 'have a great day' — "
            "vary the wording. Do not use the same phrase every time.\n"
            "- Do not invent work that is not in the context."
        ),
        context=json.dumps(compact, default=str)[:12000],
        output=(
            'Return JSON only: { "script": "line one.\\nline two.\\n..." } '
            "and optionally { \"lines\": [\"line one.\", \"line two.\"] }."
        ),
        guardrails=(
            "- Do not include emails, phone numbers, currency amounts, or secrets.\n"
            "- Do not greet.\n"
            "- Do not mention being an AI or reading a dashboard.\n"
            "- Do not sound like an IVR or a status page.\n"
            "- Use only facts in the context.\n"
            "- Never emit digit counts except in clock times (10:30).\n"
            "- Never skip a named meeting, task, or follow-up from the lists."
        ),
    )

    def pack(lines: list[str], script: str | None = None) -> dict[str, Any]:
        seed = f"{role}:{hour}:{first_name}"
        joined = _with_closer(script or "\n".join(lines), seed)
        return {"ok": True, "script": joined, "lines": lines or joined.split("\n")}

    if not is_ai_configured():
        return label_fallback(pack(_heuristic_lines(body)), "llm_unavailable")

    try:
        text = await generate_ai_text(
            system=system,
            user=(
                "Write today's briefing as short sweet bullet points, one line each. JSON only."
            ),
            max_tokens=1200,
        )
        data = extract_json(text or "") or {}
        script_raw = _clean_prose(data.get("script"), first_name)
        lines = _clamp_lines(data.get("lines"), first_name)
        if not script_raw and not lines:
            raise ValueError("empty_script")
        return label_ai(pack(lines, script_raw or None))
    except Exception as exc:  # noqa: BLE001
        logger.warning("daily-briefing LLM unavailable: %s", exc)
        return label_fallback(pack(_heuristic_lines(body)), "llm_error")
