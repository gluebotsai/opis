from app.services.seo_social_generate import (
    article_excerpt,
    caption_instructions,
    clamp_count,
    normalize_social_posts,
    resolve_counts,
)


def test_article_excerpt_prefers_blog_markdown():
    text = article_excerpt(
        "Scaling Enterprise Sales",
        {
            "blog": {
                "markdown": "# Scaling\n\nA modern CRM helps revenue teams."
            },
            "faq": [{"q": "What?", "a": "This."}],
        },
    )
    assert "Scaling Enterprise Sales" in text
    assert "modern CRM" in text
    assert "What?" not in text


def test_normalize_social_posts_caps_per_platform():
    raw = [
        {"platform": "linkedin", "caption": "L1"},
        {"platform": "linkedin", "caption": "L2"},
        {"platform": "linkedin", "caption": "L3"},
        {"platform": "facebook", "caption": "F1"},
        {"platform": "instagram", "caption": "I1", "hashtags": ["crm"]},
        {"platform": "twitter", "caption": "skip"},
        {"platform": "linkedin", "caption": ""},
    ]
    saved, counts = normalize_social_posts(
        raw,
        content_id="seoc_1",
        linkedin_count=2,
        facebook_count=3,
        instagram_count=3,
    )
    assert counts == {"linkedin": 2, "facebook": 1, "instagram": 1}
    assert [p["platform"] for p in saved] == [
        "linkedin",
        "linkedin",
        "facebook",
        "instagram",
    ]
    assert saved[3]["copy"]["hashtags"] == ["crm"]
    assert all(p["contentId"] == "seoc_1" for p in saved)


def test_clamp_count_bounds():
    assert clamp_count(None, 5) == 5
    assert clamp_count(0, 3) == 0
    assert clamp_count(99, 3) == 5
    assert clamp_count("2", 5) == 2


def test_resolve_counts_current_platform_only():
    linkedin = resolve_counts(platform="linkedin")
    assert linkedin == {"linkedin": 3, "facebook": 0, "instagram": 0}
    facebook = resolve_counts(platform="facebook")
    assert facebook == {"linkedin": 0, "facebook": 3, "instagram": 0}
    instagram = resolve_counts(platform="instagram")
    assert instagram == {"linkedin": 0, "facebook": 0, "instagram": 3}


def test_resolve_counts_all_platforms_default():
    assert resolve_counts() == {"linkedin": 3, "facebook": 3, "instagram": 3}


def test_caption_instructions_skips_zero_platforms():
    text = caption_instructions(5, 0, 0)
    assert "5 LinkedIn" in text
    assert "Facebook" not in text
    assert "Instagram" not in text


def test_generate_rejects_non_numeric_org():
    import asyncio
    from app.services.seo_social_generate import generate_and_persist_social_posts

    result = asyncio.run(
        generate_and_persist_social_posts(
            organization_id="not-a-bigint",
            user_id=None,
            content_id="seoc_1",
            posts=[{"platform": "linkedin", "caption": "Hello world from CRM"}],
        )
    )
    assert result["ok"] is False
    assert "organization" in str(result.get("error") or "").lower()
