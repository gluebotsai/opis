"""Email brand theme + social/footer link helpers."""

from __future__ import annotations

from app.agents.template_library.email_brand import (
    apply_brand_to_email_fields,
    extract_brand_from_context,
    merge_brand_into_theme,
    normalize_footer_links,
    normalize_social_links,
    normalize_theme_dict,
)
from app.agents.template_generation_director.schemas import normalize_design_plan


def test_normalize_theme_and_merge_brand() -> None:
    theme = merge_brand_into_theme(
        {
            "background": "#f4f7fb",
            "surface": "#ffffff",
            "accent": "#2563eb",
            "text": "#172033",
            "muted": "#667085",
            "button_text": "#ffffff",
        },
        {"colors": {"primary": "#087f5b", "background": "#edf4f1"}},
        overrides={"accent": "#0f766e"},
    )
    assert theme["background"] == "#edf4f1"
    assert theme["accent"] == "#0f766e"


def test_rejects_invented_non_http_social() -> None:
    assert normalize_social_links(
        [{"network": "linkedin", "label": "LI", "url": "linkedin.com/x"}]
    ) == []
    assert normalize_footer_links([{"label": "Privacy", "url": "not-a-url"}]) == []
    good = normalize_social_links(
        [
            {
                "network": "linkedin",
                "label": "LinkedIn",
                "url": "https://linkedin.com/company/worktual",
            }
        ]
    )
    assert len(good) == 1
    assert good[0]["url"].startswith("https://")


def test_apply_brand_injects_social_section() -> None:
    fields = {
        "subject": "Hello",
        "theme": {"background": "#fff", "accent": "#111", "surface": "#fff", "text": "#000"},
        "sections": [
            {"type": "headline", "content": "Hi"},
            {"type": "compliance_footer", "content": "Unsub"},
        ],
    }
    out = apply_brand_to_email_fields(
        fields,
        {
            "social_links": [
                {
                    "network": "website",
                    "label": "Site",
                    "url": "https://example.com",
                }
            ]
        },
    )
    types = [str(r.get("type")) for r in out["sections"] if isinstance(r, dict)]
    assert "social_links" in types
    assert types.index("social_links") < types.index("compliance_footer")
    assert out["social_links"][0]["url"] == "https://example.com"


def test_design_plan_merges_brand_and_social() -> None:
    plan = normalize_design_plan(
        "email",
        {
            "pattern_id": "editorial",
            "theme_id": "clean_light",
            "theme_overrides": {"accent": "#9a4f2c"},
            "social_links": [
                {
                    "network": "linkedin",
                    "label": "LinkedIn",
                    "url": "https://linkedin.com/company/acme",
                }
            ],
            "_campaign": {"brand_primary": "#112233"},
            "_company_pack": {},
        },
        wants_images=False,
    )
    assert plan["theme"]["accent"] == "#9a4f2c"
    assert "social_links" in plan["sections"]
    assert plan["social_links"][0]["url"].startswith("https://")


def test_extract_brand_from_campaign_flat_keys() -> None:
    brand = extract_brand_from_context(
        campaign={
            "website_url": "https://acme.example",
            "brand_primary": "#abcabc",
            "social_links": [
                {"network": "instagram", "url": "https://instagram.com/acme", "label": "IG"}
            ],
        }
    )
    assert brand["website"] == "https://acme.example"
    assert brand["colors"]["primary"] == "#abcabc"
    assert brand["social_links"][0]["network"] == "instagram"


def test_normalize_theme_dict_rejects_bad_hex() -> None:
    out = normalize_theme_dict({"background": "blue", "accent": "#00ff00"})
    assert "background" not in out
    assert out["accent"] == "#00ff00"
