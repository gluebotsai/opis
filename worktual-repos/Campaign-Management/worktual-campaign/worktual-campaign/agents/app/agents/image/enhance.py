"""Visual director enhance + safety gates for Image MAS tools."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

from app.config import get_settings

# Campaign-safe defaults — merged into every enhanced brief (handoff negatives).
DEFAULT_NEGATIVES = (
    "No watermarks, unrelated brand logos, or generic stock-photo clutter. "
    "No readable text, letters, numbers, slogans, captions, posters, banners, "
    "screens, or signs in the image. "
    "No merge tags, curly-brace placeholders, or contact-field tokens. "
    "No campaign headlines painted as pixels. "
    "No plastic skin, oversaturated HDR, uncanny AI faces, or distorted anatomy. "
    "No extra limbs, deformed hands or faces, low-resolution artifacts. "
    "No blood, gore, weapons-as-threat, hate symbols. "
    "No vulgar, sexual, pornographic, or NSFW content. "
    "No discriminatory or hateful imagery."
)

_DEFAULT_STYLE = (
    "Natural, premium marketing look — authentic lighting, realistic materials, "
    "cohesive palette, editorial composition. Avoid cheesy stock clichés and flat "
    "gradient blobs."
)

_CHANNEL_FRAMING: dict[str, str] = {
    "email": (
        "Email hero: landscape 16:9 photoreal photograph, clean crop, "
        "no letters, signs, screens, posters, or banners with text."
    ),
    "whatsapp": "WhatsApp header: compact, bold subject, minimal fine detail, no text overlay.",
    "web_push": "Web push thumbnail: square or 4:3, readable at small size, no text overlay.",
    "web": "Web banner: wide hero, clear focal subject, no text overlay.",
    "push": "App push asset: square 1:1, high contrast icon-like focal point, no text overlay.",
    "app_push": "App push asset: square 1:1, high contrast icon-like focal point, no text overlay.",
}

_MERGE_TAG_RE = re.compile(r"\{\{[^}]+\}\}")

# Obvious unsafe asks — handler gate only (not chat intent routing).
_UNSAFE_TERMS = frozenset(
    {
        "porn",
        "pornographic",
        "nude",
        "nudes",
        "naked",
        "nsfw",
        "xxx",
        "sexual",
        "explicit sex",
    }
)

REFUSAL_MESSAGE = (
    "I can't generate that kind of image for a campaign. "
    "I can create a brand-safe, professional marketing visual instead — "
    "describe the product, offer, or mood you want."
)

_MIN_ENHANCED_LEN = 80
_MIN_EXPANSION_CHARS = 40


@dataclass
class EnhanceResult:
    ok: bool
    enhanced_prompt: str = ""
    refused: bool = False
    error: str = ""
    negatives_applied: str = ""


def normalize_channel(raw: str) -> str:
    c = str(raw or "").strip().lower().replace("-", "_")
    if c in ("webpush", "web_push_notification"):
        return "web_push"
    if c in ("apppush", "app"):
        return "app_push"
    return c


def channel_framing_hint(channel: str) -> str:
    return _CHANNEL_FRAMING.get(normalize_channel(channel), "")


def strip_merge_tags(text: str) -> str:
    """Remove {{first_name}} / other merge tags so they cannot be painted as pixels."""
    cleaned = _MERGE_TAG_RE.sub(" ", str(text or ""))
    return re.sub(r"\s+", " ", cleaned).strip()


def visual_alignment_copy(text: str, *, max_len: int = 220) -> str:
    """Short mood/theme snippet — never include merge tags."""
    cleaned = strip_merge_tags(text)
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def is_unsafe_image_request(user_prompt: str) -> bool:
    text = str(user_prompt or "").strip().lower()
    if not text:
        return False
    return any(term in text for term in _UNSAFE_TERMS)


def enhanced_prompt_body(enhanced: str) -> str:
    """Visual direction only — strip the appended Avoid: negatives."""
    text = str(enhanced or "").strip()
    lower = text.lower()
    cut = lower.find("avoid:")
    if cut >= 0:
        return text[:cut].strip()
    return text


def validate_enhanced_prompt(
    user_prompt: str,
    enhanced: str,
    *,
    min_length: int = _MIN_ENHANCED_LEN,
) -> tuple[bool, str | None]:
    """Structural gate — not Domain taste-check.

    Fail closed when the director did not expand the user line. Appending
    Avoid: negatives to the raw request is not an enhance.
    """
    raw = str(user_prompt or "").strip()
    enh = str(enhanced or "").strip()
    if not enh:
        return False, "Enhanced prompt is empty."
    body = enhanced_prompt_body(enh)
    if len(body) < min_length:
        return False, "Enhanced prompt is too short for image generation."
    if raw and body.lower() == raw.lower():
        return False, "Enhanced prompt must expand beyond the raw user line."
    if raw and len(body) < len(raw) + _MIN_EXPANSION_CHARS:
        return False, "Enhanced prompt must add visual direction (setting, lighting, composition)."
    return True, None


def build_visual_director_system(*, must_avoid: str = "") -> str:
    extra_neg = str(must_avoid or "").strip()
    neg_block = DEFAULT_NEGATIVES
    if extra_neg:
        neg_block = f"{DEFAULT_NEGATIVES} Also avoid: {extra_neg}."
    return (
        "You are a marketing visual director for Worktual Campaign.\n"
        "Expand the user's image idea into ONE detailed image-generation brief "
        "(about 120–220 words of visual direction).\n"
        "Campaign name/goal/copy are alignment context only — do not invent a scene "
        "the user did not ask for. Ground the brief in their subject.\n"
        "Must include: primary subject, setting, foreground/background, camera/framing, "
        "lighting, materials/textures, color palette, mood, and channel crop when given.\n"
        f"Default aesthetic: {_DEFAULT_STYLE}\n"
        "Photoreal or high-end brand creative. Default: ZERO readable text in the image "
        "(no slogans, headlines, numbers-as-copy, screens, posters, or placeholders). "
        "Campaign subject/body is mood alignment only — never paint that copy. "
        "On-image words only if the User request names exact caption words to print.\n"
        "Always append a final line starting with 'Avoid:' followed by negatives.\n"
        f"Default negatives to include: {neg_block}\n"
        "If the user asks for vulgar, sexual, NSFW, hateful, or illegal-harm imagery, "
        "respond with exactly: REFUSE_UNSAFE\n"
        "Output only the brief (or REFUSE_UNSAFE) — no preamble."
    )


def build_enhance_user_message(
    user_prompt: str,
    *,
    channel: str = "",
    aspect_hint: str = "",
    campaign_name: str = "",
    campaign_goal: str = "",
    campaign_brief: str = "",
    messaging_angle: str = "",
    template_subject: str = "",
    template_body_snippet: str = "",
    must_include: str = "",
    style_hint: str = "",
) -> str:
    lines: list[str] = []
    brief = visual_alignment_copy(campaign_brief)
    angle = visual_alignment_copy(messaging_angle)
    subject = visual_alignment_copy(template_subject, max_len=120)
    snippet = visual_alignment_copy(template_body_snippet, max_len=180)
    name = visual_alignment_copy(campaign_name, max_len=80)
    goal = visual_alignment_copy(campaign_goal, max_len=120)
    if brief or name:
        lines.append(
            "Campaign context (mood/theme only — do not paint this copy, slogans, "
            "numbers, or placeholders in the image):"
        )
        if brief:
            lines.append(brief)
        elif name:
            lines.append(f"Campaign: {name}")
            if goal:
                lines.append(f"Goal: {goal}")
    if angle and angle != brief:
        lines.append(f"Messaging mood: {angle}")
    if subject:
        lines.append(f"Email subject (do not render as text): {subject}")
    if snippet:
        lines.append(f"Copy theme (do not render as text): {snippet}")
    ch = normalize_channel(channel)
    if ch:
        lines.append(f"Channel: {ch}")
        frame = channel_framing_hint(ch)
        if frame:
            lines.append(f"Framing: {frame}")
    if aspect_hint:
        lines.append(f"Aspect/placement: {aspect_hint}")
    if style_hint:
        lines.append(f"Style hint: {style_hint}")
    if must_include:
        lines.append(f"Must include: {must_include}")
    lines.append(f"User request: {strip_merge_tags(user_prompt)}")
    return "\n".join(lines)


async def enhance_image_prompt(
    user_prompt: str,
    *,
    channel: str = "",
    aspect_hint: str = "",
    campaign_name: str = "",
    campaign_goal: str = "",
    campaign_brief: str = "",
    messaging_angle: str = "",
    template_subject: str = "",
    template_body_snippet: str = "",
    must_include: str = "",
    must_avoid: str = "",
    style_hint: str = "",
) -> EnhanceResult:
    """Text LLM visual director — must run before GENERATE_IMAGE / REFINE_IMAGE."""
    raw = strip_merge_tags(user_prompt)
    if not raw:
        return EnhanceResult(ok=False, error="user_prompt is required")

    if is_unsafe_image_request(raw):
        return EnhanceResult(ok=False, refused=True, error=REFUSAL_MESSAGE)

    from app.llm import OpenAILLM

    settings = get_settings()
    llm = OpenAILLM(
        api_key=settings.llm_api_key,
        model_name=settings.llm_model,
        base_url=settings.llm_base_url,
    )
    system = build_visual_director_system(must_avoid=must_avoid)
    user = build_enhance_user_message(
        raw,
        channel=channel,
        aspect_hint=aspect_hint,
        campaign_name=campaign_name,
        campaign_goal=campaign_goal,
        campaign_brief=campaign_brief,
        messaging_angle=messaging_angle,
        template_subject=template_subject,
        template_body_snippet=template_body_snippet,
        must_include=must_include,
        style_hint=style_hint or _DEFAULT_STYLE,
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    def _call() -> str:
        resp = llm.run(
            messages,
            max_tokens=1024,
            temperature=0.45,
            disable_thinking=True,
        )
        return str(resp.get("content") or "").strip()

    text = ""
    ok = False
    err: str | None = "Enhance failed validation."
    for attempt in range(2):
        text = await asyncio.to_thread(_call)
        if not text or text.upper() == "REFUSE_UNSAFE" or "REFUSE_UNSAFE" in text[:32].upper():
            return EnhanceResult(ok=False, refused=True, error=REFUSAL_MESSAGE)
        ok, err = validate_enhanced_prompt(raw, text)
        if ok:
            break
        messages = [
            *messages,
            {"role": "assistant", "content": text or "(empty)"},
            {
                "role": "user",
                "content": (
                    "That brief did not expand the request. Rewrite a longer visual-direction "
                    "brief: subject, setting, lighting, materials, composition, palette, mood. "
                    "Do not repeat the user line. Still end with Avoid: ..."
                ),
            },
        ]
    if not ok:
        return EnhanceResult(ok=False, error=err or "Enhance failed validation.")

    if "avoid:" not in text.lower():
        text = f"{text}\n\nAvoid: {DEFAULT_NEGATIVES}"
        if must_avoid:
            text = f"{text} {must_avoid.strip()}."

    return EnhanceResult(
        ok=True,
        enhanced_prompt=text,
        negatives_applied=DEFAULT_NEGATIVES,
    )


def merge_image_slots_from_session(
    session: dict[str, Any],
    task_spec: dict[str, Any],
) -> dict[str, Any]:
    """Thin slots from session + task_spec for executor enhance calls."""
    spec = dict(task_spec or {})
    slots = spec.get("slots")
    img: dict[str, Any] = {}
    if isinstance(slots, dict) and isinstance(slots.get("image"), dict):
        img.update(slots["image"])

    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    if not spec.get("channel"):
        channels = session.get("channels") or campaign.get("channels") or []
        if isinstance(channels, list) and channels:
            spec["channel"] = normalize_channel(str(channels[0]))
        elif img.get("channel"):
            spec["channel"] = img["channel"]
    if not spec.get("campaign_name"):
        spec["campaign_name"] = (
            session.get("focus_campaign_name")
            or campaign.get("name")
            or session.get("campaign_name")
            or img.get("campaign_name")
            or ""
        )
    if not spec.get("campaign_goal"):
        spec["campaign_goal"] = campaign.get("goal") or campaign.get("objective") or ""
    if not spec.get("template_id") and session.get("template_id"):
        spec["template_id"] = session["template_id"]
    if not spec.get("aspect_hint") and img.get("aspect_hint"):
        spec["aspect_hint"] = img["aspect_hint"]
    if not spec.get("must_include") and img.get("must_include"):
        spec["must_include"] = img["must_include"]
    if not spec.get("must_avoid") and img.get("must_avoid"):
        spec["must_avoid"] = img["must_avoid"]
    if not spec.get("style_hint") and img.get("style_hint"):
        spec["style_hint"] = img["style_hint"]
    if not spec.get("campaign_brief"):
        from app.agents.image.campaign_image_context import build_campaign_image_context

        ctx = build_campaign_image_context(session, channel=str(spec.get("channel") or ""))
        for key in (
            "campaign_brief",
            "messaging_angle",
            "template_subject",
            "template_body_snippet",
        ):
            if not spec.get(key) and ctx.get(key):
                spec[key] = ctx[key]
        if not spec.get("campaign_name") and ctx.get("campaign_name"):
            spec["campaign_name"] = ctx["campaign_name"]
        if not spec.get("campaign_goal") and ctx.get("campaign_goal"):
            spec["campaign_goal"] = ctx["campaign_goal"]
    return spec


def is_unsafe_enhanced_prompt(enhanced: str) -> bool:
    """Second-line safety before image API — ignore appended Avoid: negatives."""
    text = str(enhanced or "").strip()
    if not text:
        return False
    lower = text.lower()
    cut = lower.find("avoid:")
    if cut >= 0:
        text = text[:cut]
    return is_unsafe_image_request(text)


__all__ = [
    "DEFAULT_NEGATIVES",
    "EnhanceResult",
    "REFUSAL_MESSAGE",
    "build_visual_director_system",
    "channel_framing_hint",
    "enhanced_prompt_body",
    "enhance_image_prompt",
    "is_unsafe_enhanced_prompt",
    "is_unsafe_image_request",
    "merge_image_slots_from_session",
    "normalize_channel",
    "strip_merge_tags",
    "validate_enhanced_prompt",
    "visual_alignment_copy",
]
