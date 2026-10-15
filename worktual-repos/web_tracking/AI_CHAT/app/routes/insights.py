"""Internal HTTP route for proactive analytics insights generation."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Header, HTTPException

from app.insights.insights_agent import insights_agent
from app.insights.schemas import InsightsGenerateRequest, InsightsNarrativeResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _verify_key(key: str | None) -> None:
    expected = os.environ.get("INSIGHTS_INTERNAL_KEY", "")
    if not expected or key != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/insights/generate", response_model=InsightsNarrativeResponse)
async def generate_insights(
    body: InsightsGenerateRequest,
    x_insights_key: str | None = Header(default=None, alias="X-Insights-Key"),
) -> InsightsNarrativeResponse:
    _verify_key(x_insights_key)
    try:
        result = await insights_agent.generate(
            body.snapshot,
            body.website_id,
            body.period,
            organization_id=body.organization_id,
            user_id=body.user_id,
        )
        return InsightsNarrativeResponse.model_validate(result)
    except Exception as exc:
        logger.exception("Insights generation failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
