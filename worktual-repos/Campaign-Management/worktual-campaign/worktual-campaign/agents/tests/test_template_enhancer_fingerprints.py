"""Tests for Information Enhancer + creative fingerprints (Phase 1)."""

from __future__ import annotations

from app.agents.template_generation_director.creative_fingerprints import (
    extract_fingerprint,
    fingerprint_signature,
    is_too_similar,
    load_recent_fingerprints,
    prior_pattern_ids_from_fingerprints,
)
from app.agents.template_generation_director.information_enhancer import (
    normalize_enhancer_output,
)


def test_normalize_enhancer_fallback_narrative() -> None:
    out = normalize_enhancer_output({}, {"goal": "Grow signups", "objective": "Webinar"})
    assert "narrative" in out
    assert "Grow signups" in out["narrative"]
    assert out["must_avoid"]


def test_merge_prior_templates_dedupes() -> None:
    from app.agents.template_generation_director.creative_fingerprints import (
        merge_prior_templates,
    )

    session = [{"template_id": "a", "channel": "email", "fields": {"pattern_id": "editorial"}}]
    org = [{"template_id": "b", "channel": "email", "fields": {"pattern_id": "promotion"}}]
    merged = merge_prior_templates(session, org)
    ids = {str(r.get("template_id")) for r in merged}
    assert ids == {"a", "b"}


def test_email_fingerprint_extract_and_dedupe() -> None:
    fields = {
        "pattern_id": "promotion",
        "theme_id": "bold_contrast",
        "sections": [
            {"type": "offer", "content": "20% off"},
            {"type": "headline", "content": "Sale"},
            {"type": "cta", "label": "Shop", "url": "{{campaign_url}}"},
        ],
    }
    fp = extract_fingerprint(
        channel="email",
        fields=fields,
        design_plan={"content_rhythm": "promotional"},
    )
    assert fp["pattern_id"] == "promotion"
    assert fp["section_sequence"][0] == "offer"
    sig = fingerprint_signature(fp)
    assert sig
    assert is_too_similar(fp, [fp])


def test_load_recent_fingerprints_from_prior_templates() -> None:
    prior = [
        {
            "channel": "email",
            "fields": {
                "pattern_id": "editorial",
                "theme_id": "calm_professional",
                "sections": [{"type": "headline", "content": "Hi"}],
            },
        }
    ]
    fps = load_recent_fingerprints(prior, channel="email")
    assert len(fps) == 1
    ids = prior_pattern_ids_from_fingerprints(fps)
    assert "editorial" in ids
