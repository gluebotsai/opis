"""Curated creative patterns used by the Template Generation Director.

Patterns constrain structure without prescribing customer-facing copy. The
Director selects one; channel writers fill it using verified campaign facts.
"""

from __future__ import annotations

from typing import Any

EMAIL_PATTERNS: dict[str, dict[str, Any]] = {
    "editorial": {
        "label": "Educational editorial",
        "intents": ["education", "event", "awareness", "nurture"],
        "sections": ["headline", "text", "benefits", "cta", "signoff", "compliance_footer"],
        "direction": "Editorial hierarchy, thoughtful pacing, restrained CTA.",
    },
    "product_spotlight": {
        "label": "Product spotlight",
        "intents": ["launch", "upsell", "cross_sell", "feature"],
        "sections": ["headline", "text", "benefits", "product", "cta", "compliance_footer"],
        "direction": "Value-first product focus with scannable benefits and one decisive CTA.",
    },
    "problem_solution": {
        "label": "Problem to solution",
        "intents": ["lead_generation", "upsell", "nurture"],
        "sections": ["headline", "text", "divider", "benefits", "cta", "signoff", "compliance_footer"],
        "direction": "Open on a recognizable problem, then pivot clearly to the solution.",
    },
    "story_led": {
        "label": "Story-led message",
        "intents": ["brand", "re_engagement", "nurture", "testimonial"],
        "sections": ["headline", "text", "testimonial", "text", "cta", "signoff", "compliance_footer"],
        "direction": "Human narrative rhythm with proof before a soft action.",
    },
    "comparison": {
        "label": "Comparison",
        "intents": ["upgrade", "upsell", "conversion"],
        "sections": ["headline", "text", "comparison", "benefits", "cta", "compliance_footer"],
        "direction": "Make the decision easy through a factual before/after comparison.",
    },
    "event_invitation": {
        "label": "Event invitation",
        "intents": ["event", "webinar", "registration"],
        "sections": ["headline", "event_details", "benefits", "proof", "cta", "compliance_footer"],
        "direction": "Information-led invitation with logistics, outcomes, and registration action.",
    },
    "promotion": {
        "label": "Limited promotion",
        "intents": ["promotion", "sale", "conversion"],
        "sections": ["offer", "headline", "benefits", "cta", "secondary_link", "compliance_footer"],
        "direction": "High-energy but credible offer hierarchy; no invented urgency.",
    },
    "minimal_announcement": {
        "label": "Minimal announcement",
        "intents": ["announcement", "feature", "reminder"],
        "sections": ["headline", "text", "cta", "compliance_footer"],
        "direction": "Short, spacious, direct announcement with minimal visual noise.",
    },
}

EMAIL_THEMES: dict[str, dict[str, str]] = {
    "clean_light": {
        "font_heading": "Arial, sans-serif",
        "font_body": "Arial, sans-serif",
        "background": "#f4f7fb",
        "surface": "#ffffff",
        "text": "#172033",
        "muted": "#667085",
        "accent": "#2563eb",
        "button_text": "#ffffff",
        "button_radius": "8",
        "alignment": "left",
    },
    "editorial_warm": {
        "font_heading": "Georgia, serif",
        "font_body": "Arial, sans-serif",
        "background": "#f7f2ea",
        "surface": "#fffdf8",
        "text": "#30251e",
        "muted": "#78695f",
        "accent": "#9a4f2c",
        "button_text": "#ffffff",
        "button_radius": "2",
        "alignment": "left",
    },
    "bold_contrast": {
        "font_heading": "Arial, sans-serif",
        "font_body": "Arial, sans-serif",
        "background": "#111827",
        "surface": "#1f2937",
        "text": "#f9fafb",
        "muted": "#cbd5e1",
        "accent": "#f59e0b",
        "button_text": "#111827",
        "button_radius": "999",
        "alignment": "center",
    },
    "calm_professional": {
        "font_heading": "Arial, sans-serif",
        "font_body": "Arial, sans-serif",
        "background": "#edf4f1",
        "surface": "#ffffff",
        "text": "#16302b",
        "muted": "#62736f",
        "accent": "#087f5b",
        "button_text": "#ffffff",
        "button_radius": "6",
        "alignment": "left",
    },
}

WHATSAPP_PRESETS: dict[str, dict[str, Any]] = {
    "wa_minimal_text": {
        "header": "none",
        "target_body_chars": [110, 220],
        "button_types": ["URL"],
        "button_count": 1,
        "description": "Compact, direct message with one action.",
    },
    "wa_header_hook": {
        "header": "text",
        "target_body_chars": [150, 320],
        "button_types": ["URL"],
        "button_count": 1,
        "description": "Short text header, benefit-led body, one URL action.",
    },
    "wa_dual_choice": {
        "header": "text",
        "target_body_chars": [170, 380],
        "button_types": ["URL", "QUICK_REPLY"],
        "button_count": 2,
        "description": "Conversational choice: primary URL and one quick reply.",
    },
    "wa_educational": {
        "header": "text",
        "target_body_chars": [240, 520],
        "button_types": ["URL"],
        "button_count": 1,
        "description": "Information-rich body with one clear next step.",
    },
    "wa_awareness": {
        "header": "text",
        "target_body_chars": [120, 300],
        "button_types": [],
        "button_count": 0,
        "description": "Awareness update without a forced CTA.",
    },
    "wa_image_header": {
        "header": "image",
        "target_body_chars": [140, 320],
        "button_types": ["URL"],
        "button_count": 1,
        "description": (
            "Existing Meta-uploaded image header, concise value-led body, and one URL "
            "action. Allowed only when a valid Meta media handle is already available."
        ),
    },
}


def pattern_catalog_for_prompt() -> dict[str, Any]:
    return {
        "email_patterns": EMAIL_PATTERNS,
        "email_themes": EMAIL_THEMES,
        "whatsapp_presets": WHATSAPP_PRESETS,
    }

