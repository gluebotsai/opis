"""Internal LLM keyword estimates — never calls Semrush."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import require_internal_secret
from app.integrations.seo.keyword_estimates import estimate_keywords_llm

router = APIRouter()


class KeywordEstimateRequest(BaseModel):
    organizationId: str = Field(min_length=1)
    seed: str = Field(min_length=1)
    location: str | None = "us"
    language: str | None = "en"


@router.post("/ai/v1/internal/seo/keyword-estimates")
async def seo_keyword_estimates(
    body: KeywordEstimateRequest,
    _: None = Depends(require_internal_secret),
) -> dict[str, Any]:
    result = await estimate_keywords_llm(
        seed=body.seed,
        location=body.location or "us",
        language=body.language or "en",
    )
    return {"organizationId": body.organizationId, **result}
