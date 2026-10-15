"""Internal meeting assist.

One agent, three tasks. Each task's primary output comes from the LLM.
TypeScript decides the meeting type and who may see the card.
"""

from __future__ import annotations

import logging
from typing import Any

from app.agents.llm_result import (
    generate_json_with_retries,
    label_ai,
    label_fallback,
    sectioned_system_prompt,
)

logger = logging.getLogger(__name__)

_TOPICS = {"sales", "presales", "marketing", "finance", "support", "unclear"}
_TARGET_TYPES = {"person", "team", "general"}
_VERDICTS = {"matches", "differs", "unknown"}


def _clamp_topic(value: Any) -> str:
    topic = str(value or "").strip().lower()
    return topic if topic in _TOPICS else "unclear"


def _clamp_verdict(value: Any) -> str:
    verdict = str(value or "").strip().lower()
    return verdict if verdict in _VERDICTS else "unknown"


def _clamp_target_type(value: Any) -> str:
    target = str(value or "").strip().lower()
    return target if target in _TARGET_TYPES else "general"


def _user_turn(label: str, text: str, extra: str = "") -> str:
    """Same shape as live customer coaching, which this model actually answers."""
    parts = [label, text.strip(), ""]
    if extra.strip():
        parts.extend([extra.strip(), ""])
    parts.append("Return ONLY the JSON object now.")
    return "\n".join(parts)


async def _ask(system: str, user: str, repair_hint: str) -> tuple[Any, str | None]:
    return await generate_json_with_retries(
        system=system,
        user=user,
        max_tokens=2000,
        timeout_ms=12_000,
        attempts=1,
        repair_hint=repair_hint,
        enable_thinking=False,
    )


async def _route(utterance: str) -> dict[str, Any]:
    system = sectioned_system_prompt(
        role="You listen to an internal company meeting between managers and employees.",
        goal="Decide whether the latest line is a question and exactly who should receive help answering it.",
        instructions=(
            "Read only the utterance. Set isQuestion true only when the speaker is asking "
            "for an answer, number, status, or explanation. targetType is person when one "
            "employee is addressed by name, team when a role/team is addressed, and general "
            "when no person or team is named. For person, copy only the spoken person's name "
            "to addresseeName. Otherwise addresseeName is null. topic is sales, presales, "
            "marketing, finance, support, or unclear. Keep sales and presales separate. "
            "Do not answer the question."
        ),
        output=(
            '{"isQuestion": boolean, "targetType": "person" | "team" | "general", '
            '"addresseeName": string | null, "topic": "sales" | "presales" | '
            '"marketing" | "finance" | "support" | "unclear"}'
        ),
        guardrails=(
            "Return JSON only. Do not invent a name that was not spoken. "
            "If the line is a statement, isQuestion is false."
        ),
    )
    repair = (
        'Return ONLY JSON {"isQuestion": boolean, "targetType": "person" or "team" '
        'or "general", "addresseeName": string or null, "topic": "sales" or '
        '"presales" or "marketing" or "finance" or "support" or "unclear"}.'
    )
    parsed, reason = await _ask(
        system,
        _user_turn("LATEST LINE:", utterance[:2000]),
        repair,
    )
    if not isinstance(parsed, dict):
        return label_fallback(
            {
                "isQuestion": False,
                "targetType": "general",
                "addresseeName": None,
                "topic": "unclear",
            },
            reason or "llm_empty",
        )
    name = parsed.get("addresseeName")
    addressee = str(name).strip() if isinstance(name, str) and str(name).strip() else None
    return label_ai(
        {
            "isQuestion": bool(parsed.get("isQuestion")),
            "targetType": _clamp_target_type(parsed.get("targetType")),
            "addresseeName": addressee,
            "topic": _clamp_topic(parsed.get("topic")),
        }
    )


async def _answer(*, role: str, question: str, context: str) -> dict[str, Any]:
    system = sectioned_system_prompt(
        role=f"You prepare a spoken answer for a {role} employee in an internal meeting.",
        goal="Quietly coach the employee with a natural answer they can say immediately.",
        instructions=(
            "Start with 'You could say:' and then write one or two warm, conversational "
            "sentences in the employee's voice. Use only this person's "
            "records. When the question asks how many, answer with the number on the Counts "
            "line. Converted deals means closed won. Do not name one deal when they asked "
            "for a count. When they ask which deal, name one row. If the count is zero, "
            "say zero. If the context has no count for the question, say the CRM does not "
            "show that yet. Avoid database words such as row, field, or record in the answer."
        ),
        output='{"answer": string}',
        guardrails=(
            "Return JSON only. Do not add a recommendation, a next step, or advice to the manager. "
            "Do not invent numbers."
        ),
    )
    parsed, reason = await _ask(
        system,
        _user_turn(
            "QUESTION TO ANSWER:",
            question[:2000],
            "CRM records for this employee:\n" + (context[:4000] or "No CRM records were provided."),
        ),
        'Return ONLY JSON {"answer": string}.',
    )
    answer = ""
    if isinstance(parsed, dict):
        answer = str(parsed.get("answer") or "").strip()
    if not answer:
        return label_fallback({"answer": ""}, reason or "llm_empty")
    return label_ai({"answer": answer[:800]})


async def _fact(
    *,
    role: str,
    question: str,
    utterance: str,
    context: str,
) -> dict[str, Any]:
    system = sectioned_system_prompt(
        role="You check an employee's statement in an internal meeting against CRM records.",
        goal="Tell the official, in natural language, whether this employee's answer is supported by CRM facts.",
        instructions=(
            "Compare the employee's answer to the manager's question first. "
            "Set isAnswer false for greetings, unrelated remarks, or a new question that "
            "does not answer the manager. In that case use verdict unknown. Set isAnswer "
            "true for a direct answer, including an uncertain or incomplete answer. "
            "The context is this employee's own records, including a Counts line. "
            "Customers owned are not converted deals. Converted deals are closed won. "
            "verdict matches when the spoken number agrees with that count. "
            "verdict differs when that count is a different number. "
            "verdict unknown when the statement is not covered by the Counts line. "
            "detail is one concise, conversational sentence. For matches, say what checks "
            "out. For differences, gently contrast what they said with the CRM count. "
            "For unknown, say what could not be verified. Do not use robotic phrases."
        ),
        output=(
            '{"isAnswer": boolean, "verdict": "matches" or "differs" or '
            '"unknown", "detail": string}'
        ),
        guardrails=(
            "Return JSON only. Do not call a statement false when no record covers it. "
            "Do not recommend a next step."
        ),
    )
    parsed, reason = await _ask(
        system,
        _user_turn(
            f"EMPLOYEE STATEMENT ({role}):",
            utterance[:2000],
            "MANAGER QUESTION:\n"
            + (question[:2000] or "No manager question was provided.")
            + "\n\nCRM records:\n"
            + (context[:4000] or "No CRM records were provided."),
        ),
        'Return ONLY JSON {"isAnswer": boolean, "verdict": "matches" or '
        '"differs" or "unknown", "detail": string}.',
    )
    if not isinstance(parsed, dict):
        return label_fallback(
            {"isAnswer": False, "verdict": "unknown", "detail": ""},
            reason or "llm_empty",
        )
    detail = str(parsed.get("detail") or "").strip()[:500]
    return label_ai(
        {
            "isAnswer": bool(parsed.get("isAnswer")),
            "verdict": _clamp_verdict(parsed.get("verdict")),
            "detail": detail,
        }
    )


async def run(
    *,
    task: str,
    utterance: str | None = None,
    question: str | None = None,
    role: str | None = None,
    context: str | None = None,
    organization_id: str | None = None,
) -> dict[str, Any]:
    del organization_id  # tenancy is enforced by the caller that loaded context
    kind = (task or "").strip().lower()
    text = (utterance or "").strip()
    if kind == "route":
        if not text:
            return label_fallback(
                {
                    "isQuestion": False,
                    "targetType": "general",
                    "addresseeName": None,
                    "topic": "unclear",
                },
                "empty_utterance",
            )
        return await _route(text)
    if kind == "answer":
        if not text:
            return label_fallback({"answer": ""}, "empty_utterance")
        return await _answer(
            role=(role or "employee").strip() or "employee",
            question=text,
            context=(context or "").strip() or "No CRM records were provided.",
        )
    if kind == "fact":
        if not text:
            return label_fallback(
                {"isAnswer": False, "verdict": "unknown", "detail": ""},
                "empty_utterance",
            )
        return await _fact(
            role=(role or "employee").strip() or "employee",
            question=(question or "").strip(),
            utterance=text,
            context=(context or "").strip() or "No CRM records were provided.",
        )
    logger.warning("assist-internal-meeting unknown task %s", kind)
    return label_fallback({"ok": False}, "unknown_task")
