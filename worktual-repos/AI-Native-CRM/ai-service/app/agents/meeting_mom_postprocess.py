"""Transcript cleanup and MOM post-processing (dedupe, structure, validation)."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

# Common speech-to-text mis-hearings in sales calls.
_ASR_FIXES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bserum\b", re.I), "CRM"),
    (re.compile(r"\bsee\s+ram\b", re.I), "CRM"),
    (re.compile(r"\bwork\s+tual\b", re.I), "Worktual"),
)

_QUOTE_MARKERS = re.compile(
    r"^(because|now,|could you|i am currently|i'm currently|we are currently|"
    r"what are the|tell me|i need to buy)",
    re.I,
)
_INCOMPLETE_END = re.compile(r"\b(of me|advantages of|using a traditional)\.?\s*$", re.I)


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _fix_asr(text: str) -> str:
    out = text
    for pattern, repl in _ASR_FIXES:
        out = pattern.sub(repl, out)
    return out


def _normalize_line(line: str) -> str:
    line = _fix_asr(line.strip())
    line = re.sub(r"\s+", " ", line)
    return line


def clean_transcript(text: str, *, max_chars: int = 16000) -> str:
    """Dedupe consecutive lines and drop obvious STT fragments."""
    raw = re.sub(r"<[^>]+>", " ", text or "")
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    if not raw.strip():
        return ""

    lines: list[str] = []
    for line in raw.split("\n"):
        line = _normalize_line(line)
        if not line:
            continue
        if len(line) < 8 and not re.match(r"^[^:]+:\s*.+$", line):
            continue
        if lines and _similar(lines[-1], line) >= 0.92:
            continue
        # Drop truncated sentence stubs repeated across the call.
        if _INCOMPLETE_END.search(line) and len(line.split()) < 12:
            continue
        lines.append(line)

    # Merge consecutive short fragments from the same speaker.
    merged: list[str] = []
    for line in lines:
        m = re.match(r"^([^:]{1,80}):\s*(.+)$", line)
        if merged and m:
            prev_m = re.match(r"^([^:]{1,80}):\s*(.+)$", merged[-1])
            if (
                prev_m
                and prev_m.group(1).strip() == m.group(1).strip()
                and len(m.group(2).split()) < 10
                and not m.group(2).rstrip().endswith((".", "?", "!"))
            ):
                merged[-1] = f"{m.group(1).strip()}: {prev_m.group(2)} {m.group(2)}".strip()
                continue
        merged.append(line)

    out = "\n".join(merged).strip()
    if len(out) > max_chars:
        out = out[:max_chars]
    return out


def looks_like_transcript_quote(text: str) -> bool:
    s = text.strip()
    if not s:
        return True
    if _QUOTE_MARKERS.search(s):
        return True
    if _INCOMPLETE_END.search(s):
        return True
    # Long first-person monologue without an imperative verb.
    if len(s.split()) > 14 and not re.search(
        r"\b(send|schedule|prepare|follow up|follow-up|share|confirm|review|assign|"
        r"deliver|book|email|call|propose|draft)\b",
        s,
        re.I,
    ):
        return True
    return False


def dedupe_strings(items: list[str], *, max_n: int = 12) -> list[str]:
    out: list[str] = []
    for item in items:
        s = item.strip()
        if not s:
            continue
        norm = re.sub(r"\s+", " ", s.lower())
        if any(_similar(norm, re.sub(r"\s+", " ", o.lower())) >= 0.82 for o in out):
            continue
        out.append(s[:280])
        if len(out) >= max_n:
            break
    return out


def _default_owner(raw: str, meta: dict[str, Any]) -> str:
    owner = str(meta.get("ownerName") or "").strip()
    seller = str(meta.get("sellerName") or "Worktual").strip() or "Worktual"
    contact = str(meta.get("contactName") or "Customer").strip() or "Customer"
    lower = raw.lower()
    if re.search(r"\b(client|customer|they will|their team)\b", lower):
        return contact
    if re.search(r"\b(we will|our team|worktual|sales rep|rep will)\b", lower):
        return owner or f"{seller} Team"
    if owner:
        return owner
    return f"{seller} Team"


def normalize_action_item(item: Any, meta: dict[str, Any]) -> dict[str, str] | None:
    if isinstance(item, dict):
        action = str(item.get("action") or "").strip()[:280]
        if not action or looks_like_transcript_quote(action):
            return None
        owner = str(item.get("owner") or "").strip()[:80]
        due = str(item.get("dueDate") or "").strip()[:40]
        if due.lower() in {"[date]", "tbd", "n/a", "na", ""}:
            due = ""
        if not owner or owner in {"—", "-", "unknown", "n/a"}:
            owner = _default_owner(action, meta)
        return {"action": action, "owner": owner, "dueDate": due or "—"}
    if isinstance(item, str) and item.strip():
        action = item.strip()[:280]
        if looks_like_transcript_quote(action):
            return None
        return {
            "action": action,
            "owner": _default_owner(action, meta),
            "dueDate": "—",
        }
    return None


def normalize_action_items(
    raw: Any,
    meta: dict[str, Any],
    *,
    max_n: int = 10,
) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        row = normalize_action_item(item, meta)
        if not row:
            continue
        key = re.sub(r"\s+", " ", row["action"].lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
        if len(out) >= max_n:
            break
    return out


def _buying_signal_lines(mom: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if mom.get("proposalRequested"):
        lines.append("Customer requested a proposal or formal quote.")
    intent = str(mom.get("buyingIntent") or "").strip()
    if intent:
        lines.append(f"Buying intent: {intent[:240]}")
    current = str(mom.get("currentSolution") or "").strip()
    if current:
        lines.append(f"Current solution: {current[:240]}")
    for pt in mom.get("painPoints") or []:
        s = str(pt).strip()
        if s:
            lines.append(f"Pain point: {s[:240]}")
    for crit in mom.get("evaluationCriteria") or []:
        s = str(crit).strip()
        if s:
            lines.append(f"Evaluation criteria: {s[:240]}")
    return dedupe_strings(lines, max_n=10)


def postprocess_mom(mom: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """Dedupe lists, structure actions, and derive next best action."""
    out = dict(mom)
    rep = str(meta.get("ownerName") or "").strip()
    contact = str(meta.get("contactName") or "Customer").strip()

    for key in (
        "discussionTopics",
        "keyDetails",
        "decisions",
        "commitments",
        "objections",
        "openQuestions",
        "risks",
    ):
        out[key] = dedupe_strings(
            [str(x).strip() for x in (out.get(key) or []) if str(x).strip()],
        )

    structured = normalize_action_items(out.get("actionItems"), meta)
    if not structured:
        structured = normalize_action_items(out.get("commitments"), meta)
    out["actionItemsStructured"] = structured
    out["actionItems"] = [row["action"] for row in structured]

    next_steps = dedupe_strings(
        [str(x).strip() for x in (out.get("nextSteps") or []) if str(x).strip()],
    )
    next_steps = [s for s in next_steps if not looks_like_transcript_quote(s)]
    nba = str(out.get("nextBestAction") or "").strip()
    if not nba or looks_like_transcript_quote(nba):
        if out.get("proposalRequested"):
            nba = f"Prepare and send proposal to {contact}."
        elif structured:
            nba = structured[0]["action"]
        elif next_steps:
            nba = next_steps[0]
        elif rep:
            nba = f"{rep} to review transcript and confirm follow-ups in CRM."
        else:
            nba = "Review transcript and confirm follow-ups in CRM."
    out["nextBestAction"] = nba[:280]

    if not next_steps:
        next_steps = [nba]
        for row in structured[1:3]:
            if row["action"] not in next_steps:
                next_steps.append(row["action"])
    out["nextSteps"] = dedupe_strings(next_steps, max_n=6)

    follow_up = str(out.get("followUpBy") or "").strip()
    if not follow_up:
        follow_up = ""
    out["followUpBy"] = follow_up[:80]

    out["buyingSignalLines"] = _buying_signal_lines(out)

    # Enrich discussion when proposal was requested but not listed.
    if out.get("proposalRequested"):
        topics = list(out.get("discussionTopics") or [])
        marker = "Customer requested a proposal"
        if not any(marker.lower() in t.lower() for t in topics):
            topics.insert(0, marker)
        out["discussionTopics"] = dedupe_strings(topics)

    return out
