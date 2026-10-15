"""Internal generate social posts from saved Digital Marketing content — no Semrush."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import require_internal_secret
from app.services.seo_social_generate import generate_and_persist_social_posts

router = APIRouter()


class SocialRepurposeRequest(BaseModel):
    organizationId: str = Field(min_length=1)
    contentId: str = Field(min_length=1)
    userId: str | None = None
    platform: str | None = None
    linkedinCount: int | None = None
    facebookCount: int | None = None
    instagramCount: int | None = None


@router.post("/ai/v1/internal/seo/repurpose-social")
async def seo_repurpose_social_internal(
    body: SocialRepurposeRequest,
    _: None = Depends(require_internal_secret),
) -> dict[str, Any]:
    user_raw = str(body.userId or "").strip()
    user_id = int(user_raw) if user_raw.isdigit() else None
    result = await generate_and_persist_social_posts(
        organization_id=body.organizationId,
        user_id=user_id,
        content_id=body.contentId,
        platform=body.platform,
        linkedin_count=body.linkedinCount,
        facebook_count=body.facebookCount,
        instagram_count=body.instagramCount,
    )
    return {"organizationId": body.organizationId, **result}
