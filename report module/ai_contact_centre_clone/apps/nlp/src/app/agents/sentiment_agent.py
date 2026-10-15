"""SentimentAgent — dual-axis turn and session sentiment via worktual-gemma."""

import json
from typing import Any

from app.llm.sentiment_client import get_sentiment_llm_client
from app.logging import get_logger
from app.prompts.sentiment import SENTIMENT_SESSION_SYSTEM, SENTIMENT_TURN_SYSTEM
from app.schemas.sentiment import (
    SentimentAxisResult,
    SentimentSessionRequest,
    SentimentSessionResponse,
    SentimentSignals,
    SentimentTurnRequest,
    SentimentTurnResponse,
)

logger = get_logger("nlp.sentiment_agent")

LABEL_BANDS: list[tuple[str, int, int]] = [
    ("very_positive", 81, 100),
    ("positive", 61, 80),
    ("neutral", 41, 60),
    ("negative", 21, 40),
    ("very_negative", 0, 20),
]


def _clamp_score(value: object) -> int:
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return 50
    return max(0, min(100, score))


def _label_from_score(score: int) -> str:
    for label, low, high in LABEL_BANDS:
        if low <= score <= high:
            return label
    return "neutral"


def _clamp_confidence(value: object) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, confidence))


def _normalize_axis(raw: dict[str, Any] | None, *, fallback_rationale: str) -> SentimentAxisResult:
    score = _clamp_score(raw.get("score") if raw else 50)
    label_raw = str(raw.get("label") if raw else "neutral").strip().lower()
    label = label_raw if label_raw in {item[0] for item in LABEL_BANDS} else _label_from_score(score)
    expected = _label_from_score(score)
    if label != expected:
        label = expected
    rationale = str(raw.get("rationale") if raw else fallback_rationale).strip()[:200]
    return SentimentAxisResult(
        label=label,  # type: ignore[arg-type]
        score=score,
        confidence=_clamp_confidence(raw.get("confidence") if raw else 0.5),
        rationale=rationale or fallback_rationale,
    )


def _normalize_signals(raw: dict[str, Any] | None) -> SentimentSignals:
    escalation = str((raw or {}).get("escalation_risk", "low")).strip().lower()
    shift = str((raw or {}).get("customer_intent_shift", "none")).strip().lower()
    return SentimentSignals(
        escalation_risk=escalation if escalation in {"low", "medium", "high"} else "low",
        customer_intent_shift=shift if shift in {"none", "worsening", "improving"} else "none",
    )


class SentimentAgent:
    def __init__(self) -> None:
        self.llm = get_sentiment_llm_client()

    async def analyze_turn(self, request: SentimentTurnRequest) -> SentimentTurnResponse:
        payload = {
            "channel": request.channel,
            "conversation_id": request.conversation_id,
            "trigger_turn": request.trigger_turn.model_dump(),
            "transcript": [turn.model_dump() for turn in request.transcript],
        }
        try:
            result = await self.llm.json(
                [
                    {"role": "system", "content": SENTIMENT_TURN_SYSTEM},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ]
            )
            trigger_role = request.trigger_turn.role
            if trigger_role == "customer":
                customer = _normalize_axis(
                    result.get("customer") if isinstance(result.get("customer"), dict) else None,
                    fallback_rationale="Customer tone inferred from transcript",
                )
                agent = SentimentAxisResult(
                    label="neutral",
                    score=50,
                    confidence=0.5,
                    rationale="Not evaluated on this turn.",
                )
            else:
                customer = SentimentAxisResult(
                    label="neutral",
                    score=50,
                    confidence=0.5,
                    rationale="Not evaluated on this turn.",
                )
                agent = _normalize_axis(
                    result.get("agent") if isinstance(result.get("agent"), dict) else None,
                    fallback_rationale="Agent tone inferred from transcript",
                )
            if not any(turn.role == "agent" for turn in request.transcript) and trigger_role != "agent":
                agent = SentimentAxisResult(
                    label="neutral",
                    score=50,
                    confidence=0.5,
                    rationale="No agent messages in transcript yet.",
                )
            return SentimentTurnResponse(
                customer=customer,
                agent=agent,
                signals=_normalize_signals(
                    result.get("signals") if isinstance(result.get("signals"), dict) else None
                ),
                model_name=self.llm.model,
            )
        except Exception:
            logger.warning("sentiment turn analysis failed", exc_info=True)
            return SentimentTurnResponse(
                customer=SentimentAxisResult(
                    label="neutral",
                    score=50,
                    confidence=0.3,
                    rationale="Sentiment analysis unavailable",
                ),
                agent=SentimentAxisResult(
                    label="neutral",
                    score=50,
                    confidence=0.3,
                    rationale="Sentiment analysis unavailable",
                ),
                model_name=self.llm.model,
            )

    async def summarize_session(self, request: SentimentSessionRequest) -> SentimentSessionResponse:
        payload = {
            "channel": request.channel,
            "conversation_id": request.conversation_id,
            "transcript": [turn.model_dump() for turn in request.transcript],
        }
        try:
            result = await self.llm.json(
                [
                    {"role": "system", "content": SENTIMENT_SESSION_SYSTEM},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ]
            )
            summary = str(result.get("summary") or "").strip()[:2000]
            if not summary:
                summary = "Agent session completed."
            return SentimentSessionResponse(
                customer=_normalize_axis(
                    result.get("customer") if isinstance(result.get("customer"), dict) else None,
                    fallback_rationale="Customer session tone",
                ),
                agent=_normalize_axis(
                    result.get("agent") if isinstance(result.get("agent"), dict) else None,
                    fallback_rationale="Agent session tone",
                ),
                summary=summary,
                model_name=self.llm.model,
            )
        except Exception:
            logger.warning("sentiment session summary failed", exc_info=True)
            return SentimentSessionResponse(
                customer=SentimentAxisResult(
                    label="neutral",
                    score=50,
                    confidence=0.3,
                    rationale="Session sentiment unavailable",
                ),
                agent=SentimentAxisResult(
                    label="neutral",
                    score=50,
                    confidence=0.3,
                    rationale="Session sentiment unavailable",
                ),
                summary="Agent session completed.",
                model_name=self.llm.model,
            )
