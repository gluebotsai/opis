"""Workspace wrap-up assist and sentiment APIs."""

import json

from fastapi import APIRouter, Depends, Header

from app.agents.sentiment_agent import SentimentAgent
from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.prompts.follow_up import FOLLOW_UP_EXTRACT_PROMPT
from app.prompts.workspace import WRAP_UP_SUGGEST_PROMPT
from app.schemas.sentiment import (
    SentimentSessionRequest,
    SentimentSessionResponse,
    SentimentTurnRequest,
    SentimentTurnResponse,
)
from app.schemas.workspace import (
    FollowUpExtractRequest,
    FollowUpExtractResponse,
    WrapUpSuggestRequest,
    WrapUpSuggestResponse,
)

_sentiment_agent = SentimentAgent()


def _fallback_summary(transcript: list[dict[str, str]]) -> str:
    if not transcript:
        return "Agent session ended with no customer-visible messages recorded."
    preview = " ".join(
        f"{turn.get('role', 'unknown')}: {turn.get('text', '').strip()}"
        for turn in transcript[-4:]
        if str(turn.get("text", "")).strip()
    )
    return preview[:500] or "Agent session ended."


def _normalize_resolution(value: object) -> str:
    if value in {"unresolved", "transferred"}:
        return str(value)
    return "resolved"


def _pick_disposition_code(
    value: object,
    dispositions: list[dict[str, str]],
) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().lower()
    for disposition in dispositions:
        code = str(disposition.get("code", "")).strip()
        label = str(disposition.get("label", "")).strip()
        if code.lower() == normalized or label.lower() == normalized:
            return code
    return None


def create_workspace_router(api_v1_base: str) -> APIRouter:
    router = APIRouter(prefix=f"{api_v1_base}/workspace", tags=["Workspace"])

    @router.post("/wrap-up/suggest", response_model=WrapUpSuggestResponse)
    async def suggest_wrap_up(
        request: WrapUpSuggestRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> WrapUpSuggestResponse:
        auth = authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "workspace_wrap_up",
        )
        transcript = [turn.model_dump() for turn in request.transcript]
        disposition_options = [option.model_dump() for option in request.dispositions]
        if not transcript:
            return WrapUpSuggestResponse(
                summary=_fallback_summary(transcript),
                resolution="resolved",
                disposition_code=disposition_options[0]["code"]
                if disposition_options
                else None,
            )

        payload = {
            "channel": request.channel,
            "subject": request.subject,
            "conversation_id": request.conversation_id,
            "tenant_id": auth.tenant_id,
            "transcript": transcript,
            "dispositions": disposition_options,
        }
        try:
            result = await llm.json(
                [
                    {
                        "role": "system",
                        "content": (
                            WRAP_UP_SUGGEST_PROMPT
                            + "\nReturn one JSON object with keys summary, resolution, disposition_code."
                        ),
                    },
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ]
            )
            summary = str(result.get("summary") or "").strip() or _fallback_summary(transcript)
            resolution = _normalize_resolution(result.get("resolution"))
            disposition_code = _pick_disposition_code(
                result.get("disposition_code"),
                disposition_options,
            )
            if disposition_code is None and disposition_options:
                disposition_code = disposition_options[0]["code"]
            return WrapUpSuggestResponse(
                summary=summary[:2000],
                resolution=resolution,  # type: ignore[arg-type]
                disposition_code=disposition_code,
            )
        except Exception:
            return WrapUpSuggestResponse(
                summary=_fallback_summary(transcript),
                resolution="resolved",
                disposition_code=disposition_options[0]["code"]
                if disposition_options
                else None,
            )

    @router.post("/follow-up/extract", response_model=FollowUpExtractResponse)
    async def extract_follow_up(
        request: FollowUpExtractRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> FollowUpExtractResponse:
        authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "workspace_follow_up_extract",
        )
        transcript = [turn.model_dump() for turn in request.transcript]
        if not transcript:
            return FollowUpExtractResponse(has_follow_up=False)

        payload = {
            "channel": request.channel,
            "subject": request.subject,
            "conversation_id": request.conversation_id,
            "reference_time": request.reference_time,
            "transcript": transcript,
        }
        try:
            result = await llm.json(
                [
                    {
                        "role": "system",
                        "content": (
                            FOLLOW_UP_EXTRACT_PROMPT
                            + "\nReturn one JSON object with keys has_follow_up, title, summary, notes, due_at."
                        ),
                    },
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ]
            )
            has_follow_up = bool(result.get("has_follow_up"))
            if not has_follow_up:
                return FollowUpExtractResponse(has_follow_up=False)

            title = str(result.get("title") or "").strip()
            summary = str(result.get("summary") or "").strip()
            if not title or not summary:
                return FollowUpExtractResponse(has_follow_up=False)

            notes_raw = result.get("notes")
            notes = str(notes_raw).strip() if isinstance(notes_raw, str) and notes_raw.strip() else None
            due_raw = result.get("due_at")
            due_at = str(due_raw).strip() if isinstance(due_raw, str) and due_raw.strip() else None

            return FollowUpExtractResponse(
                has_follow_up=True,
                title=title[:200],
                summary=summary[:2000],
                notes=notes[:4000] if notes else None,
                due_at=due_at,
            )
        except Exception:
            return FollowUpExtractResponse(has_follow_up=False)

    @router.post("/sentiment/turn", response_model=SentimentTurnResponse)
    async def analyze_sentiment_turn(
        request: SentimentTurnRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
    ) -> SentimentTurnResponse:
        authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "workspace_sentiment_turn",
        )
        return await _sentiment_agent.analyze_turn(request)

    @router.post("/sentiment/session", response_model=SentimentSessionResponse)
    async def summarize_sentiment_session(
        request: SentimentSessionRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
    ) -> SentimentSessionResponse:
        authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "workspace_sentiment_session",
        )
        return await _sentiment_agent.summarize_session(request)

    return router
