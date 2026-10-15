"""Generate and persist LinkedIn / Facebook / Instagram posts from saved SEO content.

Captions come from the LLM. Images attach via Gemini. Never calls Semrush.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_COUNTS = {"linkedin": 3, "facebook": 3, "instagram": 3}
PLATFORMS = ("linkedin", "facebook", "instagram")


def clamp_count(raw: Any, default: int, *, cap: int = 5) -> int:
    if raw is None or raw is False:
        return default
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return default
    if n <= 0:
        return 0
    return min(cap, n)


def resolve_counts(
    *,
    platform: str | None = None,
    linkedin_count: Any = None,
    facebook_count: Any = None,
    instagram_count: Any = None,
) -> dict[str, int]:
    selected = str(platform or "").strip().lower()
    raw = {
        "linkedin": linkedin_count,
        "facebook": facebook_count,
        "instagram": instagram_count,
    }
    if selected in DEFAULT_COUNTS:
        return {
            name: clamp_count(raw[name], DEFAULT_COUNTS[name]) if name == selected else 0
            for name in PLATFORMS
        }
    return {
        name: clamp_count(raw[name], DEFAULT_COUNTS[name]) for name in PLATFORMS
    }


def caption_instructions(
    linkedin_count: int, facebook_count: int, instagram_count: int
) -> str:
    parts: list[str] = []
    if linkedin_count:
        parts.append(
            f"Write exactly {linkedin_count} LinkedIn posts: professional insight, no hashtag dump."
        )
    if facebook_count:
        parts.append(
            f"Write exactly {facebook_count} Facebook posts: conversational."
        )
    if instagram_count:
        parts.append(
            f"Write exactly {instagram_count} Instagram posts: shorter caption plus 5–12 hashtags."
        )
    parts.append("Vary hooks; do not copy the article verbatim.")
    return " ".join(parts)


def article_excerpt(title: str, body: Any) -> str:
    markdown = ""
    parsed: Any = body
    if isinstance(body, str):
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            markdown = body
            parsed = None
    if isinstance(parsed, dict):
        blog = parsed.get("blog") if isinstance(parsed.get("blog"), dict) else {}
        markdown = str(
            blog.get("markdown")
            or blog.get("body")
            or parsed.get("markdown")
            or parsed.get("text")
            or ""
        ).strip()
        if not markdown:
            markdown = json.dumps(parsed, ensure_ascii=False)
    excerpt = f"{(title or '').strip()}\n\n{markdown}".strip()
    return excerpt[:8000]


def slim_social_item(item: dict[str, Any]) -> dict[str, Any]:
    copy = dict(item.get("copy") or {})
    has_image = bool(copy.pop("imageDataUrl", None))
    copy["hasImage"] = has_image
    return {**item, "copy": copy}


def normalize_social_posts(
    posts_raw: list[Any],
    *,
    content_id: str,
    linkedin_count: int,
    facebook_count: int,
    instagram_count: int,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    limits = {
        "linkedin": linkedin_count,
        "facebook": facebook_count,
        "instagram": instagram_count,
    }
    counts = {"linkedin": 0, "facebook": 0, "instagram": 0}
    saved: list[dict[str, Any]] = []
    for item in posts_raw:
        rec = item if isinstance(item, dict) else {}
        platform = str(rec.get("platform") or "").strip().lower()
        if platform not in limits:
            continue
        if counts[platform] >= limits[platform]:
            continue
        text = str(
            rec.get("caption") or rec.get("text") or rec.get("body") or ""
        ).strip()
        if not text:
            continue
        hashtags = rec.get("hashtags") if isinstance(rec.get("hashtags"), list) else []
        pid = str(rec.get("id") or "").strip() or f"seosp_{uuid.uuid4().hex[:16]}"
        counts[platform] += 1
        saved.append(
            {
                "id": pid,
                "platform": platform,
                "postType": str(rec.get("postType") or "feed").strip() or "feed",
                "copy": {
                    "caption": text,
                    "hashtags": [str(h) for h in hashtags if str(h).strip()],
                    "brief": str(rec.get("brief") or "").strip(),
                    "carousel": rec.get("carousel")
                    if isinstance(rec.get("carousel"), list)
                    else [],
                },
                "status": "draft",
                "contentId": content_id,
            }
        )
    return saved, counts


async def captions_from_article(
    *,
    excerpt: str,
    linkedin_count: int,
    facebook_count: int,
    instagram_count: int,
) -> tuple[list[dict[str, Any]] | None, str | None]:
    from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
    needed = linkedin_count + facebook_count + instagram_count
    if needed <= 0:
        return None, "no_platforms"
    active = [
        name
        for name, n in (
            ("linkedin", linkedin_count),
            ("facebook", facebook_count),
            ("instagram", instagram_count),
        )
        if n
    ]
    min_posts = max(1, min(needed, 3 if needed > 3 else needed))
    system = sectioned_system_prompt(
        role="You write native social posts from a Digital Marketing article.",
        goal=f"Return JSON captions for {', '.join(active)} only.",
        instructions=caption_instructions(
            linkedin_count, facebook_count, instagram_count
        ),
        context=excerpt[:6000],
        output=(
            '{"posts":[{"platform":"linkedin|facebook|instagram","caption":"...",'
            '"hashtags":["..."],"postType":"feed","brief":"..."}]}'
        ),
        guardrails=(
            "JSON object only. No markdown. Do not call or mention Semrush. "
            "Do not invent publish status or tenant IDs. "
            f"Only include platforms that were requested: {', '.join(active)}."
        ),
    )
    user = (
        "Repurpose the article into the requested social posts now. "
        "Return the JSON object only."
    )

    def validate(parsed: dict[str, Any]) -> dict[str, Any]:
        raw = parsed.get("posts")
        if not isinstance(raw, list) or not raw:
            raise ValueError("posts array required")
        items = [p for p in raw if isinstance(p, dict)]
        if len(items) < min_posts:
            raise ValueError(f"need at least {min_posts} posts")
        return {"posts": items}

    parsed, reason = await generate_json_with_retries(
        system=system,
        user=user,
        max_tokens=5000,
        validate=validate,
    )
    if not parsed:
        return None, reason or "llm_invalid"
    posts = parsed.get("posts") if isinstance(parsed, dict) else None
    if not isinstance(posts, list):
        return None, "llm_invalid"
    return [p for p in posts if isinstance(p, dict)], None


async def generate_and_persist_social_posts(
    *,
    organization_id: str,
    user_id: int | None,
    content_id: str,
    linkedin_count: int | None = None,
    facebook_count: int | None = None,
    instagram_count: int | None = None,
    platform: str | None = None,
    posts: list[Any] | None = None,
) -> dict[str, Any]:
    try:
        return await _generate_and_persist_social_posts(
            organization_id=organization_id,
            user_id=user_id,
            content_id=content_id,
            linkedin_count=linkedin_count,
            facebook_count=facebook_count,
            instagram_count=instagram_count,
            platform=platform,
            posts=posts,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("seo social generate failed")
        return {
            "ok": False,
            "error": "Could not generate social posts right now. Try again.",
            "reason": type(exc).__name__,
        }


async def _generate_and_persist_social_posts(
    *,
    organization_id: str,
    user_id: int | None,
    content_id: str,
    linkedin_count: Any = None,
    facebook_count: Any = None,
    instagram_count: Any = None,
    platform: str | None = None,
    posts: list[Any] | None = None,
) -> dict[str, Any]:
    try:
        org_id = int(organization_id)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Invalid organization."}

    from app.mcp import db
    from app.services.social_gemini_image import attach_social_images

    content = await db.fetchrow(
        """
        SELECT id, title, body FROM seo_generated_content
        WHERE organization_id = $1::bigint AND id = $2
        LIMIT 1
        """,
        org_id,
        content_id,
    )
    if not content:
        return {
            "ok": False,
            "error": "Content not found. Save a Digital Marketing article first.",
        }

    counts_wanted = resolve_counts(
        platform=platform,
        linkedin_count=linkedin_count,
        facebook_count=facebook_count,
        instagram_count=instagram_count,
    )
    linkedin_n = counts_wanted["linkedin"]
    facebook_n = counts_wanted["facebook"]
    instagram_n = counts_wanted["instagram"]
    if linkedin_n + facebook_n + instagram_n <= 0:
        return {"ok": False, "error": "Pick a social platform to generate."}

    posts_raw = posts if isinstance(posts, list) and posts else None
    if not posts_raw:
        excerpt = article_excerpt(str(content.get("title") or ""), content.get("body"))
        if len(excerpt.strip()) < 40:
            return {
                "ok": False,
                "error": "That article has no body to repurpose yet.",
            }
        generated, reason = await captions_from_article(
            excerpt=excerpt,
            linkedin_count=linkedin_n,
            facebook_count=facebook_n,
            instagram_count=instagram_n,
        )
        if not generated:
            return {
                "ok": False,
                "error": "Could not write social captions right now. Try Generate Posts again.",
                "reason": reason,
            }
        posts_raw = generated

    saved, counts = normalize_social_posts(
        posts_raw,
        content_id=content_id,
        linkedin_count=linkedin_n,
        facebook_count=facebook_n,
        instagram_count=instagram_n,
    )
    if not saved:
        return {
            "ok": False,
            "error": "No valid LinkedIn/Facebook/Instagram posts were produced.",
        }

    title = str(content.get("title") or "").strip()
    saved = await attach_social_images(saved, title=title)
    platforms_to_replace = [
        name
        for name, n in (
            ("linkedin", linkedin_n),
            ("facebook", facebook_n),
            ("instagram", instagram_n),
        )
        if n > 0
    ]
    if platforms_to_replace:
        # Regenerate replaces drafts for this article+platform; keep published posts.
        await db.execute(
            """
            DELETE FROM seo_social_posts
            WHERE organization_id = $1::bigint
              AND content_id = $2
              AND platform = ANY($3::text[])
              AND COALESCE(status, 'draft') <> 'published'
            """,
            org_id,
            content_id,
            platforms_to_replace,
        )
    for item in saved:
        copy = item.get("copy") if isinstance(item.get("copy"), dict) else {}
        await db.execute(
            """
            INSERT INTO seo_social_posts (
              id, organization_id, user_id, content_id, platform, post_type, copy,
              status, created_at, updated_at
            ) VALUES (
              $1, $2::bigint, $3::bigint, $4, $5, $6, $7::jsonb, 'draft', NOW(), NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              copy = EXCLUDED.copy,
              platform = EXCLUDED.platform,
              post_type = EXCLUDED.post_type,
              updated_at = NOW()
            """,
            item["id"],
            org_id,
            user_id,
            content_id,
            item["platform"],
            item.get("postType") or "feed",
            json.dumps(copy),
        )
    imaged = sum(
        1
        for item in saved
        if isinstance(item.get("copy"), dict) and item["copy"].get("imageDataUrl")
    )
    labels = [
        name
        for name, n in (
            ("LinkedIn", linkedin_n),
            ("Facebook", facebook_n),
            ("Instagram", instagram_n),
        )
        if n
    ]
    slim_items = [slim_social_item(item) for item in saved]
    text = (
        f"{', '.join(labels)} posts are ready to review."
        if labels
        else "Social posts are ready to review."
    )
    return {
        "ok": True,
        "assistantText": text,
        "items": slim_items,
        "counts": counts,
        "images": imaged,
        "contentId": content_id,
    }
