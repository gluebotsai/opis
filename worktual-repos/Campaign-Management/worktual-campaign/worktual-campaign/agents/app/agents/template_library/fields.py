"""Field schemas + normalizers for structured channel templates."""

from __future__ import annotations

import copy
import json
import re
from typing import Any

from app.text_cleanup import strip_markdown_emphasis

try:
    from app.agents.template_library.channels.whatsapp.meta_rules import (
        sanitize_whatsapp_fields,
        validate_whatsapp_fields,
    )
except Exception:  # noqa: BLE001 — keep fields importable if module missing
    sanitize_whatsapp_fields = None  # type: ignore[assignment]
    validate_whatsapp_fields = None  # type: ignore[assignment]

FIELD_SCHEMAS: dict[str, dict[str, Any]] = {
    "email": {
        "subject": "",
        "preheader": "",
        "pattern_id": "",
        "theme_id": "",
        "theme": {},
        "brand": {},
        "footer_links": [],
        "social_links": [],
        "sections": [],
        "greeting": "",
        "paragraphs": [],
        "cta_label": "",
        "cta_url": "",
        "signoff": "",
        "footer": "",
    },
    "sms": {"body": ""},
    "whatsapp": {
        "name": "",
        "language": "en",
        "category": "MARKETING",
        "header_format": "TEXT",
        "header_media_url": "",
        "header_media_handle": "",
        "header": "",
        "body": "",
        "footer": "",
        "buttons": [],
    },
    "push": {"title": "", "body": "", "cta_label": ""},
    "web": {"title": "", "body": "", "cta_label": ""},
    "ppc": {
        "network": "meta",
        "objective": "traffic",
        "campaign_type": "",
        "creative_format": "",
        "placements": [],
        "headlines": [],
        "primary_text": "",
        "descriptions": "",
        "cta": "",
        "landing_url": "",
        "daily_budget": "",
        "currency": "INR",
        "geo": [],
        "keywords": [],
        "audience_notes": "",
        "media": {},
    },
}

GENERATE_SCHEMA_HINTS: dict[str, str] = {
    "email_sections": """Return JSON fields for a DESIGNED email (sections + theme):
{
  "subject": "compelling subject about the customer offer (NOT the campaign name)",
  "preheader": "optional inbox preview line",
  "pattern_id": "must match the design plan pattern_id",
  "theme_id": "must match the design plan theme_id",
  "theme": { "background": "#f4f7fb", "surface": "#ffffff", "accent": "#2563eb", ... },
  "brand": { "colors": {"primary":"#..."}, "website":"https://...", "name":"..." },
  "social_links": [{"network":"linkedin","label":"LinkedIn","url":"https://..."}],
  "footer_links": [{"label":"Privacy","url":"https://..."}],
  "sections": [
    {"type": "headline", "purpose": "hook", "content": "..."},
    {"type": "text", "purpose": "context", "content": "..."},
    {"type": "benefits", "purpose": "value", "items": ["...", "..."]},
    {"type": "signoff", "purpose": "close", "content": "..."},
    {"type": "social_links", "purpose": "brand_links", "links": [{"label":"LinkedIn","url":"https://..."}]},
    {"type": "compliance_footer", "purpose": "footer", "content": "Unsubscribe line"}
  ]
}
RULES:
- Write like a real marketing email that could send today: specific, scannable, brand-true.
- INTERNAL campaign goal/objective/name labels are INPUT only — never paste them into
  subject, headline, body, benefits, or CTAs. Never use brief-style lines like
  "promote … to the audience", "convert them into buyers", or "drive sales".
- sections MUST follow the DESIGN PLAN section order and types (one row per planned
  section), except cta / secondary_link: omit those when analysis says no click action.
- Fill every section with substantive customer copy inferred from the narrative — no placeholders,
  no lorem, no generic "we're excited" filler that could fit any brand.
- Headline must earn the open; body must advance one clear offer/message.
- Allowed section types: headline, image, text, benefits, product, offer, testimonial, statistics,
  event_details, comparison, proof, divider, cta, secondary_link, signoff, social_links, compliance_footer.
- Include social_links / footer_links ONLY when verified URLs exist in brand or facts — never invent links.
  When social_links is planned, fill section.links from the verified URLs (same as top-level social_links).
- Copy theme from the design plan (including theme_overrides / brand hex). Prefer plan theme over inventing
  new colours. theme colors must be real #hex.
- For type "image": one row per planned image slot (hero, product, lifestyle). Leave url empty or
  use a short placeholder in content; set "purpose" to hero|product|lifestyle matching the plan.
  NEVER put raw https URLs in text sections — the image pipeline fills each slot after copy is written.
- When the design plan lists multiple image sections, output multiple {"type":"image",...} rows in
  the same order as the plan (each with distinct purpose/subject in content if helpful).
- CTA is optional. Analyze chat, knowledge, and form/landing URLs: include a cta
  section only when a click action belongs (user asked for a button/link, or a real
  http(s) product/form URL is in facts). If not, omit cta entirely — never invent
  Shop / Learn more. When you do include cta, use label + the exact https URL
  (never {{campaign_url}}).
- Do NOT also return greeting/paragraphs as the primary body — sections are the body.
- Soft PDOA: {{first_name}} only unless user explicitly asked for more merge tags.""",
    "email": """Return JSON fields:
{
  "subject": "compelling subject about the customer offer (NOT the campaign name)",
  "greeting": "Hi {{first_name}},",
  "paragraphs": ["benefit paragraph", "context/next-step paragraph"],
  "signoff": "short sign-off",
  "footer": "Unsubscribe or compliance line"
}
Optional: "cta_label" + "cta_url" only when analysis supports a click action
(user asked for a button/link, or a real http(s) landing/form URL is in facts).
Omit both when not — never invent Shop / Learn more.
Require 2+ paragraphs. Greeting-only is invalid.
Soft PDOA: greeting uses {{first_name}} only by default — do not invent {{company}}/{{city}}.""",
    "email_ab": """Return JSON for ONE email card with A/B variants (not two templates):
{
  "ab_test": true,
  "subject": "variant A subject",
  "greeting": "Hi {{first_name}},",
  "paragraphs": ["benefit paragraph", "context/next-step paragraph"],
  "signoff": "short sign-off",
  "footer": "Unsubscribe or compliance line",
  "variant_a": {
    "subject": "variant A subject",
    "greeting": "Hi {{first_name}},",
    "paragraphs": ["A benefit paragraph", "A next-step paragraph"],
    "signoff": "short sign-off",
    "footer": "Unsubscribe or compliance line"
  },
  "variant_b": {
    "subject": "different B subject / hook",
    "greeting": "Hi {{first_name}},",
    "paragraphs": ["B benefit with a distinct angle", "B next-step paragraph"],
    "signoff": "short sign-off",
    "footer": "Unsubscribe or compliance line"
  }
}
Optional cta_label/cta_url on each variant only when a click action belongs.
Top-level fields MUST match variant_a (default preview).
Variant B must differ meaningfully (subject and/or hook) — not a typo tweak.
Each variant: 2+ paragraphs. Greeting-only is invalid.
This is ONE gallery card with two variants — never two separate email templates.""",
    "email_ab_sections": """Return JSON for ONE designed email card with A/B variants (not two templates).
Follow the DESIGN PLAN section order/types for BOTH variants. Each variant needs its own
sections[] filled with distinct copy (subject + body angle differ).
{
  "ab_test": true,
  "subject": "variant A subject",
  "preheader": "optional inbox preview",
  "pattern_id": "must match design plan",
  "theme_id": "must match design plan",
  "theme": { "background": "#f4f7fb", "surface": "#ffffff", "accent": "#2563eb" },
  "sections": [ /* same shape as variant_a.sections — default preview = A */ ],
  "variant_a": {
    "subject": "variant A subject",
    "preheader": "A preview",
    "sections": [
      {"type": "headline", "purpose": "hook", "content": "..."},
      {"type": "text", "purpose": "context", "content": "..."},
      {"type": "compliance_footer", "purpose": "footer", "content": "Unsubscribe line"}
    ]
  },
  "variant_b": {
    "subject": "different B subject / hook",
    "preheader": "B preview",
    "sections": [
      {"type": "headline", "purpose": "hook", "content": "..."},
      {"type": "text", "purpose": "context", "content": "..."},
      {"type": "compliance_footer", "purpose": "footer", "content": "Unsubscribe line"}
    ]
  }
}
RULES:
- ONE card, ab_test=true, variant_a + variant_b. Top-level fields MUST match variant_a.
- sections in each variant MUST follow the DESIGN PLAN order/types exactly.
- Variant B must differ meaningfully (subject and/or hook/CTA) — not a typo tweak.
- Do NOT also rely on greeting/paragraphs as the primary body when sections exist.
- Soft PDOA: {{first_name}} only unless user explicitly asked for more merge tags.""",
    "sms": """Return JSON fields:
{
  "body": "complete SMS: greeting + benefit + next step + https URL when known + Reply STOP to opt out"
}
Aim ≤160 chars, hard max 320. Greeting-only is invalid.
Soft PDOA: {{first_name}} only by default — do not invent other contact merge tags.""",
    "whatsapp_preset": """Return JSON fields for Meta WhatsApp submit (plain text, NO HTML).
Follow the DESIGN PLAN preset (meta_layout) exactly:
- header_format NONE when preset header=none; TEXT when preset header=text.
- body length should match preset target_body_chars when provided.
- buttons: match preset button_count and button_types (URL / QUICK_REPLY only).
{
  "name": "meta_template_name_snake_case",
  "language": "en",
  "category": "MARKETING",
  "header_format": "TEXT|NONE",
  "header": "optional TEXT header ≤60 chars when preset requires text header",
  "body": "FULL WhatsApp BODY — offer + benefit + next step. NEVER HTML.",
  "footer": "≤60 chars for MARKETING, NO variables",
  "buttons": []
}
When campaign https URL exists → one URL button as preset allows. Otherwise buttons: [].""",
    "push_native": """Return JSON push notification fields (NOT email — native mobile push):
{
  "title": "≤50 char hook",
  "body": "≤120 char benefit + next step",
  "cta_label": "optional short action"
}
Follow DESIGN PLAN content_flow rhythm. Do NOT use email sections or paragraphs.""",
    "web_native": """Return JSON web banner / web push fields (NOT email):
{
  "title": "≤60 char headline",
  "body": "≤120 char supporting line",
  "cta_label": "optional short action",
  "image_url": "optional https URL when gallery attaches hero thumbnail"
}
Follow DESIGN PLAN content_flow rhythm. Do NOT reuse email copy structure.
When creative_brief includes email_subject/email_body_snippet, write push-native copy for the SAME campaign idea — shorter hook, not pasted email paragraphs.""",
    "whatsapp": """Return JSON fields for Meta WhatsApp submit (plain text, NO HTML):
{
  "name": "meta_template_name_snake_case",
  "language": "en",
  "category": "MARKETING",
  "header_format": "TEXT|NONE (prefer TEXT or NONE; skip IMAGE for now)",
  "header": "optional TEXT header ≤60 chars",
  "body": "FULL WhatsApp BODY: spaced lines — offer + benefit + next step. NEVER greeting-only. NEVER HTML. {{first_name}} optional.",
  "footer": "required for MARKETING ≤60 chars, NO variables",
  "buttons": []
}
When a campaign https URL exists (form_url / cta_url), use exactly one URL button:
  "buttons": [{"type": "URL", "text": "≤25 chars", "url": "https://…"}]
  or a real https URL. Omit URL buttons when no link is known.
When NO URL exists → "buttons": [] always. Never PHONE_NUMBER or QUICK_REPLY.
Meta submit rules (must pass or generation is rejected):
- NO HTML tags anywhere (<p>, <br>, <b>, <div>). Plain text + \\n only.
- name: REQUIRED. ^[a-z0-9_]+$ only. Descriptive. Never spaces/hyphens/campaign-title dump.
  On edit: keep existing name unchanged. On generate: unique vs TAKEN META NAMES in context.
- language: en or en_US.
- category: MARKETING for offers/events; UTILITY only if non-promotional user-triggered;
  never AUTHENTICATION for campaign drafts. Prefer MARKETING when unsure.
- body: required, ≤1024 chars, ≥80 chars real copy, multi-line when possible.
  Named vars only ({{first_name}}); no {{1}}/{{2}}; no adjacent vars;
  never at the very start or end of BODY (real words before/after every {{…}}).
- footer: ≤60 chars, NO {{variables}} (Meta forbids variables in FOOTER). MARKETING → include footer.
- buttons: URL type ONLY when a campaign URL exists; otherwise empty array.
- Launch maps these fields to Meta components[] (BODY/FOOTER/BUTTONS) — stored on template at create.
- Meta approval submit happens on launch, not on create.""",
    "push": """Return JSON fields:
{
  "title": "specific hook ≤50 chars (not campaign name)",
  "body": "benefit + next step ≤120 chars",
  "cta_label": "optional CTA"
}
Title-only is invalid.""",
    "web": """Return JSON fields:
{
  "title": "specific headline ≤60 chars (not campaign name)",
  "body": "benefit + next step ≤120 chars",
  "cta_label": "optional CTA"
}
Title-only is invalid.""",
    "ppc": """Return JSON fields for a paid ad PLAN (not live publish):
{
  "network": "meta" or "google",
  "objective": "awareness" | "traffic" | "leads" | "sales",
  "campaign_type": "search" (google only; omit or empty for meta),
  "creative_format": "image" | "video" | "carousel" (mainly meta; optional google),
  "placements": ["feed", "stories", "reels"] (meta only),
  "headlines": ["headline 1", "headline 2", "headline 3"],
  "primary_text": "main ad body selling the offer",
  "descriptions": "optional supporting line(s)",
  "cta": "Shop now",
  "landing_url": "",
  "daily_budget": "5000",
  "currency": "INR",
  "geo": ["Chennai"],
  "keywords": [
    {"text": "crm software", "match": "phrase"},
    {"text": "best crm india", "match": "exact"}
  ],
  "audience_notes": "age/geo/interest notes — NOT individual emails or phones",
  "media": {"type": "image"|"video", "url": "", "alt": ""}
}
Require network, ≥2 headlines, and substantial primary_text.
If network is google: campaign_type default search; keywords MUST be non-empty
  { "text": "...", "match": "broad"|"phrase"|"exact" } (default phrase).
  placements usually empty.
If network is meta: set creative_format + placements (default feed);
  keywords optional interest themes (no match types);
  media.url optional placeholder (not live upload).
Empty plan is invalid.""",
}

_PPC_KEYWORD_MATCHES = frozenset({"broad", "phrase", "exact"})
_PPC_PLACEMENTS = frozenset(
    {"feed", "stories", "reels", "audience_network", "right_column", "search"}
)
_PPC_CREATIVE_FORMATS = frozenset({"image", "video", "carousel"})
_PPC_CAMPAIGN_TYPES = frozenset({"search", "pmax", "display"})


def _ppc_keyword_text(item: Any) -> str:
    if isinstance(item, dict):
        return _clean_str(item.get("text") or item.get("keyword") or item.get("query"))
    return _clean_str(item)


def _normalize_ppc_keywords(value: Any, network: str) -> list[dict[str, str]]:
    """Normalize PPC keywords; Google gets match type (default phrase)."""
    raw_items: list[Any] = []
    if isinstance(value, list):
        raw_items = value
    elif isinstance(value, str) and value.strip():
        raw_items = [part for part in re.split(r"[,;\n]+", value) if part.strip()]

    out: list[dict[str, str]] = []
    for item in raw_items:
        text = _ppc_keyword_text(item)
        if not text:
            continue
        entry: dict[str, str] = {"text": text}
        if network == "google":
            match = ""
            if isinstance(item, dict):
                match = _clean_str(item.get("match") or item.get("match_type")).lower()
            # Accept Google Ads shorthand: [exact] "phrase" broad
            if not match:
                if text.startswith("[") and text.endswith("]") and len(text) > 2:
                    entry["text"] = text[1:-1].strip()
                    match = "exact"
                elif text.startswith('"') and text.endswith('"') and len(text) > 2:
                    entry["text"] = text[1:-1].strip()
                    match = "phrase"
            if match not in _PPC_KEYWORD_MATCHES:
                match = "phrase"
            if not entry["text"]:
                continue
            entry["match"] = match
        out.append(entry)
    return out

_GREETING_ONLY = re.compile(
    r"^(hi|hello|hey)\b[\s\S]{0,50}$",
    re.IGNORECASE,
)


def empty_fields(channel: str) -> dict[str, Any]:
    base = FIELD_SCHEMAS.get(channel) or {}
    out: dict[str, Any] = {}
    for key, value in base.items():
        if isinstance(value, list):
            out[key] = []
        elif isinstance(value, dict):
            out[key] = {}
        else:
            out[key] = value
    return out


def _clean_str(value: Any) -> str:
    return strip_markdown_emphasis(str(value or "").strip())


def _email_column_cells(raw: dict[str, Any]) -> dict[str, str]:
    cells = raw.get("cells")
    if isinstance(cells, dict):
        return {
            "a": _clean_str(cells.get("a")),
            "b": _clean_str(cells.get("b")),
        }
    items = raw.get("items")
    if isinstance(items, list) and items:
        return {
            "a": _clean_str(items[0] if len(items) > 0 else ""),
            "b": _clean_str(items[1] if len(items) > 1 else ""),
        }
    content = _clean_str(raw.get("content"))
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return {
                "a": _clean_str(parsed.get("a")),
                "b": _clean_str(parsed.get("b")),
            }
    except Exception:
        pass
    return {"a": content, "b": ""}


_EMAIL_SECTION_TYPES = frozenset(
    {
        "headline",
        "text",
        "image",
        "benefits",
        "product",
        "offer",
        "testimonial",
        "statistics",
        "event_details",
        "comparison",
        "proof",
        "divider",
        "cta",
        "secondary_link",
        "signoff",
        "social_links",
        "compliance_footer",
        "columns",
        "spacer",
    }
)


def _keep_section_layout(row: dict[str, Any], raw: dict[str, Any]) -> None:
    align = _clean_str(raw.get("align")).lower()
    if align in {"left", "center", "right"}:
        row["align"] = align
    try:
        width = int(float(raw.get("width")))
    except (TypeError, ValueError):
        width = 0
    if 24 <= width < 100:
        row["width"] = width


def _normalize_email_sections(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    sections: list[dict[str, Any]] = []
    for raw in value[:12]:
        if not isinstance(raw, dict):
            continue
        kind = _clean_str(raw.get("type")).lower()
        if kind not in _EMAIL_SECTION_TYPES:
            continue
        row: dict[str, Any] = {
            "type": kind,
            "purpose": _clean_str(raw.get("purpose")),
        }
        content = _clean_str(raw.get("content") or raw.get("text"))
        url = _clean_str(raw.get("url") or raw.get("href") or raw.get("cta_url"))
        if kind in {"text", ""} and content and _is_http_image_url(content) and not url:
            kind = "image"
            row["type"] = "image"
            row["url"] = content
        if content:
            row["content"] = content
        items = raw.get("items")
        if isinstance(items, list):
            clean_items = [_clean_str(item) for item in items if _clean_str(item)]
            if clean_items:
                row["items"] = clean_items[:8]
        label = _clean_str(raw.get("label") or raw.get("cta_label"))
        if label:
            row["label"] = label
        if not url:
            url = _clean_str(raw.get("url") or raw.get("href") or raw.get("cta_url"))
        if url:
            row["url"] = url
        if kind == "image" and url and not content:
            row["content"] = url
        if kind == "columns":
            cells = _email_column_cells(raw)
            row["cells"] = cells
            row["items"] = [cells["a"], cells["b"]]
            row["content"] = json.dumps(cells, ensure_ascii=False)
            _keep_section_layout(row, raw)
            sections.append(row)
            continue
        if kind == "spacer":
            row["content"] = content or "24"
            _keep_section_layout(row, raw)
            sections.append(row)
            continue
        if kind == "social_links":
            from app.agents.template_library.email_brand import normalize_social_links

            links = normalize_social_links(raw.get("links") or raw.get("social_links"))
            if not links and isinstance(raw.get("items"), list):
                reconstructed: list[dict[str, Any]] = []
                for item in raw["items"]:
                    text = _clean_str(item)
                    if "|" in text:
                        lab, href = text.split("|", 1)
                        reconstructed.append({"label": lab, "url": href})
                links = normalize_social_links(reconstructed)
            if links:
                row["links"] = links
                row["items"] = [f"{l['label']}|{l['url']}" for l in links]
        if (
            kind == "divider"
            or kind == "image"
            or kind == "social_links"
            or content
            or row.get("items")
            or row.get("links")
            or label
            or url
        ):
            _keep_section_layout(row, raw)
            sections.append(row)
    return sections


def _is_http_image_url(value: Any) -> bool:
    """Real media URL only — never landing pages or {{campaign_url}}."""
    from app.agents.image.hero_image import is_http_image_url

    return is_http_image_url(value)


def _section_image_url(row: dict[str, Any]) -> str:
    kind = _clean_str(row.get("type")).lower() or "text"
    # Never treat CTA href as a hero — only explicit image slots / URL-only text body.
    url = _clean_str(row.get("url"))
    content = _clean_str(row.get("content") or row.get("text"))
    if kind == "image":
        if _is_http_image_url(url):
            return url
        if _is_http_image_url(content):
            return content
        return ""
    # URL-only text rows that are actual media URLs can promote to hero.
    if _is_http_image_url(content):
        return content
    if kind in {"text", ""} and _is_http_image_url(url):
        return url
    return ""


def _default_image_insert_index(sections: list[dict[str, Any]]) -> int:
    for i, row in enumerate(sections):
        if _clean_str(row.get("type")).lower() == "headline":
            return i + 1
    return 0


def normalize_email_hero_sections(
    sections: list[Any],
    hero_hint: str = "",
) -> list[Any]:
    """Promote URL-only text to image sections; drop duplicate URL text rows."""
    rows: list[dict[str, Any]] = []
    for raw in sections:
        if isinstance(raw, dict):
            rows.append(dict(raw))
        else:
            rows.append(raw)  # type: ignore[arg-type]

    hero = str(hero_hint or "").strip()
    if not _is_http_image_url(hero):
        hero = ""
    for row in rows:
        if isinstance(row, dict):
            img = _section_image_url(row)
            if img:
                hero = hero or img

    out: list[Any] = []
    hero_placed = False

    for row in rows:
        if not isinstance(row, dict):
            out.append(row)
            continue
        kind = _clean_str(row.get("type")).lower() or "text"
        content = _clean_str(row.get("content") or row.get("text"))
        url = _clean_str(row.get("url") or row.get("href") or row.get("cta_url"))
        has_items = isinstance(row.get("items"), list) and bool(row.get("items"))
        has_label = bool(_clean_str(row.get("label") or row.get("cta_label")))
        img_url = _section_image_url(row)

        if (
            hero
            and kind in {"text", ""}
            and not has_items
            and not has_label
            and (content == hero or url == hero)
        ):
            continue

        if img_url and (
            kind == "image"
            or (
                kind in {"text", ""}
                and _is_http_image_url(content)
                and not has_items
                and not has_label
            )
        ):
            out.append(
                {
                    **row,
                    "type": "image",
                    "url": img_url,
                    "content": img_url,
                }
            )
            hero_placed = True
            hero = hero or img_url
            continue

        if kind == "image" and img_url:
            out.append({**row, "type": "image", "url": img_url, "content": img_url})
            hero_placed = True
            continue

        out.append(dict(row))

    dict_rows = [r for r in out if isinstance(r, dict)]
    has_image = any(
        _clean_str(r.get("type")).lower() == "image" and _section_image_url(r)
        for r in dict_rows
    )
    if hero and not hero_placed and not has_image:
        insert_at = _default_image_insert_index(dict_rows)
        out.insert(insert_at, {"type": "image", "url": hero, "content": hero})

    return out


def _resolve_flat_hero_url(fields: dict[str, Any]) -> str:
    for key in (
        "header_image",
        "image_url",
        "image",
        "header_media_url",
        "media_url",
    ):
        url = _clean_str(fields.get(key))
        if _is_http_image_url(url):
            return url
    return ""


def _sync_flat_hero_fields(out: dict[str, Any]) -> None:
    hero = _resolve_flat_hero_url(out)
    sections = out.get("sections")
    if isinstance(sections, list):
        for raw in sections:
            if isinstance(raw, dict):
                img = _section_image_url(raw)
                if img:
                    hero = hero or img
                    break
    if hero:
        out["header_image"] = hero
        out["image_url"] = hero
    else:
        out["header_image"] = ""
        out["image_url"] = ""
        for key in (
            "headerImage",
            "hero_image",
            "heroImage",
            "image",
            "header_media_url",
            "media_url",
        ):
            if key in out:
                out[key] = ""


def _norm_email_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _section_content_key(row: dict[str, Any]) -> str:
    kind = _clean_str(row.get("type")).lower() or "text"
    content = _norm_email_text(str(row.get("content") or ""))
    label = _norm_email_text(str(row.get("label") or ""))
    items = row.get("items")
    items_key = ""
    if isinstance(items, list):
        items_key = "|".join(_norm_email_text(str(item)) for item in items if str(item).strip())
    return f"{kind}|{content}|{label}|{items_key}"


def dedupe_email_sections(sections: list[Any]) -> list[Any]:
    """Drop consecutive duplicate text/headline sections."""
    out: list[Any] = []
    prev_key = ""
    for raw in sections:
        if not isinstance(raw, dict):
            out.append(raw)
            prev_key = ""
            continue
        kind = _clean_str(raw.get("type")).lower() or "text"
        key = _section_content_key(raw)
        if kind in {"text", "headline", ""} and key and key == prev_key:
            continue
        out.append(dict(raw))
        prev_key = key if kind in {"text", "headline", ""} else ""
    return out


def canonicalize_email_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """Designed emails: sections[] only. Flat: dedupe greeting vs paragraphs[0]."""
    out = dict(fields or {})
    sections = out.get("sections")
    if isinstance(sections, list) and sections:
        hero_hint = _resolve_flat_hero_url(out)
        out["sections"] = normalize_email_hero_sections(
            dedupe_email_sections(sections),
            hero_hint,
        )
        _sync_flat_hero_fields(out)
        out["greeting"] = ""
        out["paragraphs"] = []
        out["body"] = ""
        out["signoff"] = ""
        out["footer"] = ""
        out.pop("blocks", None)
        html = str(out.get("compiled_html") or out.get("html") or "").strip()
        if html and not _compiled_html_is_meaningful(html):
            out.pop("compiled_html", None)
            out.pop("html", None)
        from app.agents.image.media_upload import publicize_template_image_fields

        return publicize_template_image_fields(out)
    greeting = _clean_str(out.get("greeting"))
    paragraphs = out.get("paragraphs")
    if greeting and isinstance(paragraphs, list) and paragraphs:
        first = _clean_str(str(paragraphs[0] or ""))
        if first and _norm_email_text(first) == _norm_email_text(greeting):
            out["paragraphs"] = [
                _clean_str(str(p or "")) for p in paragraphs[1:] if _clean_str(str(p or ""))
            ]
    from app.agents.image.media_upload import publicize_template_image_fields

    return publicize_template_image_fields(out)


EMAIL_MIN_VISIBLE_BODY_CHARS = 40


def _email_html_visible_text(html: str) -> str:
    text = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.IGNORECASE)
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _compiled_html_is_meaningful(html: str) -> bool:
    cleaned = str(html or "").strip()
    if not cleaned:
        return False
    return len(_email_html_visible_text(cleaned)) >= EMAIL_MIN_VISIBLE_BODY_CHARS


def sanitize_outbound_email_html(html: str) -> str:
    """Remove preview-only artifacts before persist/send."""
    out = str(html or "")
    out = re.sub(
        r"<base\b[^>]*\/?>",
        "",
        out,
        flags=re.IGNORECASE,
    )
    return out.strip()


def email_fields_body_richness(fields: dict[str, Any]) -> int:
    """Score visible body content for launch merge (higher = closer to preview)."""
    blob = fields or {}
    html_len = len(
        _email_html_visible_text(
            str(blob.get("compiled_html") or blob.get("html") or "")
        )
    )
    sections = blob.get("sections")
    section_score = 0
    if isinstance(sections, list):
        for row in sections:
            if not isinstance(row, dict):
                continue
            section_score += len(_clean_str(row.get("content")))
            section_score += len(_clean_str(row.get("label")))
            items = row.get("items")
            if isinstance(items, list):
                for item in items:
                    section_score += len(_clean_str(str(item or "")))
            url = _clean_str(row.get("url"))
            if url.startswith("http") or url.startswith("/api/media"):
                section_score += 80
    paragraphs = blob.get("paragraphs")
    para_score = 0
    if isinstance(paragraphs, list):
        para_score = sum(len(_clean_str(str(p or ""))) for p in paragraphs)
    return max(html_len, section_score, para_score)


def merge_email_fields_for_launch(
    session_fields: dict[str, Any],
    db_fields: dict[str, Any],
) -> dict[str, Any]:
    """Prefer the richest email snapshot so launch/send matches preview."""
    s = dict(session_fields or {})
    d = dict(db_fields or {})
    rs = email_fields_body_richness(s)
    rd = email_fields_body_richness(d)
    if rs > rd:
        winner, other = s, d
    elif rd > rs:
        winner, other = d, s
    else:
        winner, other = d, s
    out: dict[str, Any] = {**other, **winner}
    sub = _clean_str(d.get("subject")) or _clean_str(s.get("subject"))
    if sub:
        out["subject"] = sub
    pre = _clean_str(d.get("preheader")) or _clean_str(s.get("preheader"))
    if pre:
        out["preheader"] = pre
    for key in ("compiled_html", "html"):
        raw = _clean_str(winner.get(key)) or _clean_str(other.get(key))
        if raw:
            out[key] = sanitize_outbound_email_html(raw)
    if isinstance(winner.get("sections"), list) and winner["sections"]:
        out["sections"] = winner["sections"]
    return out


def _email_variant_sections_from_flat(blob: dict[str, Any]) -> list[dict[str, Any]]:
    """Build a minimal sections[] layout from flat email copy (A/B variants)."""
    sections: list[dict[str, Any]] = []
    subject = _clean_str(blob.get("subject"))
    if subject:
        sections.append({"type": "headline", "purpose": "hook", "content": subject})
    greeting = _clean_str(blob.get("greeting"))
    if greeting:
        sections.append({"type": "text", "purpose": "greeting", "content": greeting})
    for item in blob.get("paragraphs") or []:
        text = _clean_str(item)
        if text:
            sections.append({"type": "text", "purpose": "body", "content": text})
    cta_label = _clean_str(blob.get("cta_label"))
    cta_url = _clean_str(blob.get("cta_url"))
    if cta_label or cta_url:
        sections.append(
            {
                "type": "cta",
                "purpose": "action",
                "label": cta_label,
                "url": cta_url,
            }
        )
    signoff = _clean_str(blob.get("signoff"))
    if signoff:
        sections.append({"type": "signoff", "purpose": "close", "content": signoff})
    footer = _clean_str(blob.get("footer"))
    if footer:
        sections.append(
            {"type": "compliance_footer", "purpose": "footer", "content": footer}
        )
    return _normalize_email_sections(sections)


def _overlay_variant_copy_on_sections(
    base_sections: list[dict[str, Any]],
    variant: dict[str, Any],
) -> list[dict[str, Any]]:
    """Clone designed sections and apply this variant's subject / body / CTA."""
    out = copy.deepcopy(base_sections)
    subject = _clean_str(variant.get("subject"))
    paragraphs = [
        _clean_str(p) for p in (variant.get("paragraphs") or []) if _clean_str(p)
    ]
    cta_label = _clean_str(variant.get("cta_label"))
    cta_url = _clean_str(variant.get("cta_url"))
    if subject:
        for i, row in enumerate(out):
            if isinstance(row, dict) and _clean_str(row.get("type")).lower() == "headline":
                out[i] = {**row, "content": subject}
                break
    text_idxs = [
        i
        for i, row in enumerate(out)
        if isinstance(row, dict) and _clean_str(row.get("type")).lower() == "text"
    ]
    for idx, para in zip(text_idxs, paragraphs):
        out[idx] = {**out[idx], "content": para}
    if cta_label or cta_url:
        for i, row in enumerate(out):
            if isinstance(row, dict) and _clean_str(row.get("type")).lower() == "cta":
                patched = dict(row)
                if cta_label:
                    patched["label"] = cta_label
                if cta_url:
                    patched["url"] = cta_url
                out[i] = patched
                break
    return _normalize_email_sections(out)


def ensure_email_ab_variant_layouts(fields: dict[str, Any]) -> dict[str, Any]:
    """Guarantee variant_a/b carry full sections[] for preview and send."""
    out = dict(fields or {})
    if not (
        out.get("ab_test")
        or isinstance(out.get("variant_a"), dict)
        or isinstance(out.get("variant_b"), dict)
    ):
        return out
    layout_sections = (
        out.get("sections")
        if isinstance(out.get("sections"), list) and out.get("sections")
        else []
    )
    for key in ("variant_a", "variant_b"):
        raw = out.get(key)
        if not isinstance(raw, dict):
            continue
        var = dict(raw)
        vsec = var.get("sections") if isinstance(var.get("sections"), list) else []
        if vsec:
            out[key] = canonicalize_email_fields(var)
            continue
        if layout_sections:
            var["sections"] = _overlay_variant_copy_on_sections(layout_sections, var)
        else:
            var["sections"] = _email_variant_sections_from_flat(var)
        out[key] = canonicalize_email_fields(var)
    return out


def _merge_section_row(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Merge one email section row — patch wins on non-empty fields."""
    out = copy.deepcopy(current)
    for key, val in patch.items():
        if key == "type":
            continue
        if val is None:
            continue
        if isinstance(val, str):
            if val.strip():
                out[key] = val.strip()
        elif isinstance(val, list):
            if val:
                out[key] = val
        elif isinstance(val, dict) and val:
            base = dict(out.get(key) or {})
            base.update(val)
            out[key] = base
        else:
            out[key] = val
    kind = _clean_str(patch.get("type")).lower()
    if kind in _EMAIL_SECTION_TYPES:
        out["type"] = kind
    return out


def _merge_section_lists(
    current: list[dict[str, Any]],
    patch: list[dict[str, Any]],
    *,
    replace_all: bool = False,
) -> list[dict[str, Any]]:
    """Merge section rows by type (when typed) or by index."""
    if not patch:
        return current
    if replace_all:
        return _normalize_email_sections(patch)
    if not current:
        return _normalize_email_sections(patch)

    merged = copy.deepcopy(current)
    typed_patch = [
        p
        for p in patch
        if isinstance(p, dict) and _clean_str(p.get("type"))
    ]
    # Full-layout patches (attach/redesign) must keep slot order. Matching only
    # by type would copy a product image onto the first hero image row.
    if (
        typed_patch
        and len(typed_patch) == len(patch)
        and len(patch) == len(merged)
    ):
        by_index = True
        for i, prow in enumerate(patch):
            if not isinstance(prow, dict):
                by_index = False
                break
            if isinstance(prow.get("index"), int) and int(prow.get("index")) != i:
                by_index = False
                break
        if by_index:
            for i, prow in enumerate(patch):
                if isinstance(prow, dict):
                    merged[i] = _merge_section_row(merged[i], prow)
            return merged
    if typed_patch and len(typed_patch) == len(patch):
        multi_match_types = {"text", "benefits", "product", "cta", "secondary_link"}
        for prow in patch:
            if not isinstance(prow, dict):
                continue
            match_type = _clean_str(prow.get("type")).lower()
            match_idx = prow.get("index")
            if isinstance(match_idx, int) and 0 <= match_idx < len(merged):
                merged[match_idx] = _merge_section_row(merged[match_idx], prow)
                continue
            matched = 0
            for i, row in enumerate(merged):
                if _clean_str(row.get("type")).lower() != match_type:
                    continue
                merged[i] = _merge_section_row(row, prow)
                matched += 1
                if match_type not in multi_match_types:
                    break
            if not matched:
                normalized = _normalize_email_sections([prow])
                if normalized:
                    merged.append(normalized[0])
        return merged

    for i, prow in enumerate(patch):
        if not isinstance(prow, dict):
            continue
        if i < len(merged):
            merged[i] = _merge_section_row(merged[i], prow)
        else:
            normalized = _normalize_email_sections([prow])
            if normalized:
                merged.append(normalized[0])
    return merged


def apply_section_operations(
    sections: list[dict[str, Any]],
    operations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Apply structured section edits (update/remove/insert/move/replace_all)."""
    out = copy.deepcopy(sections)
    for op in operations or []:
        if not isinstance(op, dict):
            continue
        kind = _clean_str(op.get("op")).lower()
        if kind == "replace_all":
            replacement = op.get("sections")
            if isinstance(replacement, list) and replacement:
                out = _normalize_email_sections(replacement)
            continue
        if kind == "update":
            updates = {
                k: v
                for k, v in op.items()
                if k not in {"op", "index", "type", "match_first_only"}
            }
            idx = op.get("index")
            match_type = _clean_str(op.get("type")).lower()
            if isinstance(idx, int) and 0 <= idx < len(out):
                out[idx] = _merge_section_row(out[idx], updates)
                continue
            if match_type:
                first_only = op.get("match_first_only", True)
                for i, row in enumerate(out):
                    if _clean_str(row.get("type")).lower() != match_type:
                        continue
                    out[i] = _merge_section_row(row, updates)
                    if first_only:
                        break
            continue
        if kind == "remove":
            idx = op.get("index")
            match_type = _clean_str(op.get("type")).lower()
            if isinstance(idx, int) and 0 <= idx < len(out):
                out.pop(idx)
                continue
            if match_type:
                one_only = bool(op.get("one_only", False))
                kept: list[dict[str, Any]] = []
                removed = 0
                for row in out:
                    if (
                        isinstance(row, dict)
                        and _clean_str(row.get("type")).lower() == match_type
                    ):
                        if one_only and removed >= 1:
                            kept.append(row)
                            continue
                        removed += 1
                        continue
                    kept.append(row)
                out = kept
            continue
        if kind == "insert":
            after_idx = op.get("after_index")
            after_type = _clean_str(op.get("after_type")).lower()
            if not isinstance(after_idx, int) and after_type:
                for i, row in enumerate(out):
                    if (
                        isinstance(row, dict)
                        and _clean_str(row.get("type")).lower() == after_type
                    ):
                        after_idx = i
                        break
            section = op.get("section")
            if not isinstance(section, dict):
                built = {
                    k: v
                    for k, v in op.items()
                    if k
                    not in {
                        "op",
                        "index",
                        "from_index",
                        "to_index",
                        "after_index",
                        "after_type",
                        "one_only",
                    }
                    and v is not None
                }
                if _clean_str(built.get("type")):
                    section = built
            if not isinstance(section, dict):
                continue
            normalized = _normalize_email_sections([section])
            if not normalized:
                continue
            insert_at = len(out)
            if isinstance(after_idx, int):
                insert_at = max(0, min(len(out), after_idx + 1))
            out.insert(insert_at, normalized[0])
            continue
        if kind == "move":
            from_idx = op.get("from_index")
            to_idx = op.get("to_index")
            from_type = _clean_str(op.get("from_type") or op.get("type")).lower()
            if not isinstance(from_idx, int) and from_type:
                for i, row in enumerate(out):
                    if (
                        isinstance(row, dict)
                        and _clean_str(row.get("type")).lower() == from_type
                    ):
                        from_idx = i
                        break
            to_type = _clean_str(op.get("to_type")).lower()
            if not isinstance(to_idx, int) and to_type:
                for i, row in enumerate(out):
                    if (
                        isinstance(row, dict)
                        and _clean_str(row.get("type")).lower() == to_type
                    ):
                        to_idx = i
                        break
            if (
                isinstance(from_idx, int)
                and isinstance(to_idx, int)
                and 0 <= from_idx < len(out)
                and 0 <= to_idx < len(out)
                and from_idx != to_idx
            ):
                row = out.pop(from_idx)
                out.insert(to_idx, row)
    return out


def merge_edit_fields(
    channel: str,
    current_raw: dict[str, Any],
    patch_raw: dict[str, Any],
    *,
    replace_sections: bool = False,
) -> dict[str, Any]:
    """Deep-merge a partial LLM/tool patch onto current template fields."""
    current = normalize_fields(channel, current_raw)
    if not isinstance(patch_raw, dict) or not patch_raw:
        return current
    out = copy.deepcopy(current)
    schema = FIELD_SCHEMAS.get(channel) or {}
    extra_keys = {
        "header_image",
        "image_url",
        "ab_test",
        "variant_a",
        "variant_b",
        "body",
        "blocks",
    }

    for key, raw_val in patch_raw.items():
        if key not in schema and key not in extra_keys:
            continue
        if raw_val is None or (
            isinstance(raw_val, str)
            and not raw_val.strip()
            and key in extra_keys
        ):
            if key in extra_keys:
                out[key] = ""
            continue
        if key == "sections" and channel == "email":
            if isinstance(raw_val, list) and raw_val:
                patch_rows = [
                    r for r in raw_val if isinstance(r, dict)
                ]
                out["sections"] = _merge_section_lists(
                    list(out.get("sections") or []),
                    patch_rows,
                    replace_all=replace_sections,
                )
            continue
        if key == "theme" and isinstance(raw_val, dict):
            from app.agents.template_library.email_brand import normalize_theme_dict

            out["theme"] = normalize_theme_dict(
                raw_val, base=out.get("theme") if isinstance(out.get("theme"), dict) else {}
            )
            continue
        if key == "brand" and isinstance(raw_val, dict):
            from app.agents.template_library.email_brand import normalize_brand_dict

            prior = out.get("brand") if isinstance(out.get("brand"), dict) else {}
            merged_brand = {**prior, **normalize_brand_dict(raw_val)}
            out["brand"] = normalize_brand_dict(merged_brand)
            continue
        if key == "footer_links" and isinstance(raw_val, list):
            from app.agents.template_library.email_brand import normalize_footer_links

            out["footer_links"] = normalize_footer_links(raw_val)
            continue
        if key == "social_links" and isinstance(raw_val, list):
            from app.agents.template_library.email_brand import normalize_social_links

            out["social_links"] = normalize_social_links(raw_val)
            continue
        if key in {"variant_a", "variant_b"} and isinstance(raw_val, dict):
            nested = out.get(key) if isinstance(out.get(key), dict) else {}
            out[key] = merge_edit_fields(channel, nested, raw_val)
            continue
        if key == "buttons" and isinstance(raw_val, list):
            out["buttons"] = raw_val
            continue
        if key == "paragraphs" and isinstance(raw_val, list):
            if raw_val or key in patch_raw:
                out["paragraphs"] = [
                    _clean_str(v) for v in raw_val if _clean_str(v)
                ]
            continue
        if isinstance(raw_val, str):
            if raw_val.strip() or (key in patch_raw and raw_val == ""):
                out[key] = raw_val.strip()
        elif isinstance(raw_val, (list, dict)) and raw_val:
            out[key] = copy.deepcopy(raw_val)

    if channel == "email":
        explicit_clear = "header_image" in patch_raw and not str(
            patch_raw.get("header_image") or ""
        ).strip()
        if explicit_clear:
            out["header_image"] = ""
            out["image_url"] = ""
            sections = out.get("sections")
            if isinstance(sections, list):
                out["sections"] = [
                    row
                    for row in sections
                    if not (
                        isinstance(row, dict)
                        and _clean_str(row.get("type")).lower() == "image"
                    )
                ]
        else:
            hero = str(current.get("header_image") or "").strip()
            if hero and not str(out.get("header_image") or "").strip():
                if "header_image" not in patch_raw:
                    out["header_image"] = hero

    return normalize_fields(channel, out)


def edit_schema_hint(channel: str, current_fields: dict[str, Any] | None) -> str:
    """Pick generate/edit schema hint for the current template shape."""
    current = current_fields if isinstance(current_fields, dict) else {}
    if channel == "email":
        if current.get("ab_test") or isinstance(current.get("variant_a"), dict):
            hint = GENERATE_SCHEMA_HINTS.get("email_ab") or GENERATE_SCHEMA_HINTS["email"]
            return (
                hint
                + "\nEDIT: pass ONLY changed keys via apply_template_changes; "
                "use section_operations for remove/move/insert. Never drop unchanged sections."
            )
        sections = current.get("sections")
        if isinstance(sections, list) and sections:
            hint = GENERATE_SCHEMA_HINTS.get("email_sections") or GENERATE_SCHEMA_HINTS["email"]
            return (
                hint
                + "\nEDIT: pass ONLY changed keys via apply_template_changes.changes; "
                "partial sections merge by type/index. Use section_operations to remove CTAs, "
                "reorder rows, or replace_all sections when rewriting layout.\n"
                "For background/brand colours use set_email_theme. For website/social/footer "
                "URLs use set_footer_social_links (never invent URLs)."
            )
        hint = GENERATE_SCHEMA_HINTS.get("email") or ""
        return (
            hint
            + "\nEDIT: pass ONLY changed flat keys (subject, greeting, paragraphs, cta_label, etc.)."
        )
    if channel == "whatsapp":
        try:
            from app.agents.template_library.channels.whatsapp.meta_rules import (
                meta_rules_prompt_block,
            )

            rules = meta_rules_prompt_block()
        except Exception:  # noqa: BLE001
            rules = ""
        return (
            (GENERATE_SCHEMA_HINTS.get("whatsapp") or "")
            + ("\n\n" + rules if rules else "")
            + "\nEDIT (Meta rules still apply): pass ONLY changed keys; plain text, no HTML; "
            "footer without {{variables}}; BODY placeholders never at start/end; "
            "URL buttons only when a campaign https URL exists else buttons []; "
            "keep existing name unless user asked to rename; empty buttons [] clears buttons."
        )
    if channel == "sms":
        return (GENERATE_SCHEMA_HINTS.get("sms") or "") + "\nEDIT: pass body when changing copy."
    if channel in {"push", "web"}:
        key = "push_native" if channel == "push" else "web_native"
        return (
            GENERATE_SCHEMA_HINTS.get(key) or ""
        ) + "\nEDIT: pass ONLY changed title/body/cta_label."
    return GENERATE_SCHEMA_HINTS.get(channel) or "Return fields JSON."


def normalize_fields(channel: str, raw: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only known keys; coerce types. No invented default CTAs/buttons."""
    schema = FIELD_SCHEMAS.get(channel) or {}
    data = raw if isinstance(raw, dict) else {}
    out = empty_fields(channel)

    for key in schema:
        if key not in data:
            continue
        value = data[key]
        if channel == "email" and key == "sections":
            out[key] = _normalize_email_sections(value)
            continue
        if channel == "email" and key == "theme":
            from app.agents.template_library.email_brand import normalize_theme_dict

            out[key] = normalize_theme_dict(value)
            continue
        if channel == "email" and key == "brand":
            from app.agents.template_library.email_brand import normalize_brand_dict

            out[key] = normalize_brand_dict(value)
            continue
        if channel == "email" and key == "footer_links":
            from app.agents.template_library.email_brand import normalize_footer_links

            out[key] = normalize_footer_links(value)
            continue
        if channel == "email" and key == "social_links":
            from app.agents.template_library.email_brand import normalize_social_links

            out[key] = normalize_social_links(value)
            continue
        if key == "paragraphs":
            if isinstance(value, list):
                out[key] = [_clean_str(v) for v in value if _clean_str(v)]
            elif isinstance(value, str) and value.strip():
                out[key] = [_clean_str(value)]
            continue
        if key == "keywords" and channel == "ppc":
            network = str(out.get("network") or "meta").strip().lower()
            if network not in {"meta", "google"}:
                network = "meta"
            out[key] = _normalize_ppc_keywords(value, network)
            continue
        if key == "placements" and channel == "ppc":
            raw_items: list[Any] = []
            if isinstance(value, list):
                raw_items = value
            elif isinstance(value, str) and value.strip():
                raw_items = re.split(r"[,;\n]+", value)
            placements: list[str] = []
            for item in raw_items:
                p = _clean_str(item).lower().replace(" ", "_")
                if p in _PPC_PLACEMENTS and p not in placements:
                    placements.append(p)
            out[key] = placements
            continue
        if key in {"headlines", "geo", "keywords"}:
            items: list[str] = []
            if isinstance(value, list):
                items = [_clean_str(v) for v in value if _clean_str(v)]
            elif isinstance(value, str) and value.strip():
                items = [
                    _clean_str(part)
                    for part in re.split(r"[,;\n]+", value)
                    if _clean_str(part)
                ]
            out[key] = items
            continue
        if key == "footer" and channel == "whatsapp":
            # Meta FOOTER cannot contain variables.
            text = re.sub(r"\{\{[^}]+\}\}", "", _clean_str(value)).strip()[:60]
            out[key] = text
            continue
        if key == "name" and channel == "whatsapp":
            # Do not strip_markdown_emphasis — underscores are part of Meta names
            # (e.g. summer_sale_2026); emphasis cleanup would eat `_word_` segments.
            raw_name = str(value or "").strip().lower()
            cleaned = re.sub(r"[^a-z0-9_]+", "_", raw_name)
            cleaned = re.sub(r"_+", "_", cleaned).strip("_")[:512]
            out[key] = cleaned
            continue
        if key == "language" and channel == "whatsapp":
            lang = _clean_str(value).replace("-", "_") or "en"
            out[key] = lang
            continue
        if key == "header_format" and channel == "whatsapp":
            fmt = _clean_str(value).upper()
            out[key] = fmt if fmt in {"NONE", "TEXT", "IMAGE"} else "TEXT"
            continue
        if key == "category" and channel == "whatsapp":
            cat = _clean_str(value).upper()
            if cat not in {"MARKETING", "UTILITY", "AUTHENTICATION"}:
                cat = "MARKETING"
            # Promotional campaign copy must not sit under UTILITY.
            body_preview = _clean_str(data.get("body") or out.get("body") or "")
            if cat == "UTILITY" and re.search(
                r"\b(offer|discount|sale|promo|invite|free|upgrade)\b",
                body_preview,
                re.I,
            ):
                cat = "MARKETING"
            if cat == "AUTHENTICATION":
                cat = "MARKETING"
            out[key] = cat
            continue
        if key == "buttons" and channel == "whatsapp":
            buttons: list[dict[str, str]] = []
            if isinstance(value, list):
                url_count = 0
                for item in value[:3]:
                    if isinstance(item, str) and item.strip():
                        continue
                    elif isinstance(item, dict):
                        label = _clean_str(
                            item.get("text") or item.get("label")
                        )[:25]
                        if not label:
                            continue
                        url = _clean_str(item.get("url") or item.get("href"))
                        btype = _clean_str(item.get("type")).upper()
                        phone = re.sub(
                            r"\D",
                            "",
                            str(item.get("phone_number") or item.get("phone") or ""),
                        )
                        if btype in {"PHONE_NUMBER", "PHONE"} or phone:
                            continue
                        if btype == "QUICK_REPLY" or (not url and btype != "URL"):
                            continue
                        if url or btype == "URL":
                            if url_count >= 2:
                                continue
                            if url.lower().startswith("http://"):
                                url = "https://" + url[7:]
                            if not url.lower().startswith("https://"):
                                continue
                            if "{{" in url:
                                continue
                            buttons.append(
                                {
                                    "type": "URL",
                                    "text": label,
                                    "label": label,
                                    "url": url,
                                }
                            )
                            url_count += 1
            out[key] = buttons
            continue
        if key == "buttons":
            buttons: list[dict[str, str]] = []
            if isinstance(value, list):
                for item in value[:3]:
                    if isinstance(item, str) and item.strip():
                        label = _clean_str(item)[:25]
                        if label:
                            buttons.append({"label": label})
                    elif isinstance(item, dict):
                        label = _clean_str(item.get("label") or item.get("text"))[:25]
                        if not label:
                            continue
                        btn: dict[str, str] = {"label": label}
                        url = _clean_str(item.get("url") or item.get("href"))
                        if url:
                            btn["url"] = url
                        buttons.append(btn)
            out[key] = buttons
            continue
        if key == "media" and channel == "ppc":
            media: dict[str, str] = {}
            if isinstance(value, dict):
                mtype = _clean_str(value.get("type")).lower()
                if mtype in {"image", "video"}:
                    media["type"] = mtype
                url = _clean_str(value.get("url") or value.get("src"))
                if url:
                    media["url"] = url
                asset_id = _clean_str(value.get("asset_id") or value.get("id"))
                if asset_id:
                    media["asset_id"] = asset_id
                alt = _clean_str(value.get("alt") or value.get("caption"))
                if alt:
                    media["alt"] = alt
            elif isinstance(value, str) and value.strip():
                media = {"url": _clean_str(value)}
            out[key] = media
            continue
        if key == "network":
            net = _clean_str(value).lower()
            out[key] = net if net in {"meta", "google"} else "meta"
            continue
        if key == "objective":
            obj = _clean_str(value).lower()
            allowed = {"awareness", "traffic", "leads", "sales"}
            out[key] = obj if obj in allowed else "traffic"
            continue
        if key == "creative_format":
            fmt = _clean_str(value).lower()
            out[key] = fmt if fmt in _PPC_CREATIVE_FORMATS else ""
            continue
        if key == "campaign_type":
            ctype = _clean_str(value).lower()
            out[key] = ctype if ctype in _PPC_CAMPAIGN_TYPES else ""
            continue
        if key == "daily_budget":
            if isinstance(value, (int, float)):
                out[key] = str(value)
            else:
                out[key] = _clean_str(value)
            continue
        out[key] = _clean_str(value)

    # Network-aware defaults for PPC plans.
    if channel == "ppc":
        network = str(out.get("network") or "meta").strip().lower()
        if network == "google":
            if not out.get("campaign_type"):
                out["campaign_type"] = "search"
            # Search plans should not carry Meta placements.
            out["placements"] = []
        elif network == "meta":
            out["campaign_type"] = ""
            if not out.get("creative_format"):
                out["creative_format"] = "image"
            if not out.get("placements"):
                out["placements"] = ["feed"]
            media = out.get("media") if isinstance(out.get("media"), dict) else {}
            if not media.get("type") and out.get("creative_format") in {"image", "video"}:
                media = {**media, "type": str(out["creative_format"])}
                out["media"] = media

    if channel == "whatsapp" and sanitize_whatsapp_fields is not None:
        out = sanitize_whatsapp_fields(out)

    if channel == "email":
        va_raw = data.get("variant_a") if isinstance(data.get("variant_a"), dict) else None
        vb_raw = data.get("variant_b") if isinstance(data.get("variant_b"), dict) else None
        if data.get("ab_test") is True or va_raw or vb_raw:
            out["ab_test"] = True
            core_keys = list(FIELD_SCHEMAS["email"].keys())
            layout_keys = (
                "theme",
                "theme_id",
                "pattern_id",
                "brand",
                "footer_links",
                "social_links",
                "preheader",
            )

            def _variant_src(raw: dict[str, Any] | None) -> dict[str, Any]:
                if not isinstance(raw, dict):
                    return {k: data.get(k) for k in core_keys}
                src = {k: raw.get(k) for k in core_keys}
                # Empty sections[] from flat A/B LLMs must not block parent layout.
                if isinstance(src.get("sections"), list) and not src.get("sections"):
                    src["sections"] = []
                for key in layout_keys:
                    if src.get(key) in (None, "", []) and data.get(key) not in (
                        None,
                        "",
                        [],
                    ):
                        src[key] = data.get(key)
                return src

            out["variant_a"] = normalize_fields("email", _variant_src(va_raw))
            if vb_raw:
                out["variant_b"] = normalize_fields("email", _variant_src(vb_raw))
            else:
                out["variant_b"] = dict(out["variant_a"])

            # Designed emails often get sections only at top-level (align step).
            # Re-apply variant subject/body onto that layout when variants are thin.
            layout_sections = (
                data.get("sections")
                if isinstance(data.get("sections"), list) and data.get("sections")
                else (
                    out.get("sections")
                    if isinstance(out.get("sections"), list) and out.get("sections")
                    else []
                )
            )
            for key, raw in (("variant_a", va_raw), ("variant_b", vb_raw)):
                var = out.get(key)
                if not isinstance(var, dict):
                    continue
                vsec = var.get("sections") if isinstance(var.get("sections"), list) else []
                if vsec:
                    continue
                copy_src = dict(var)
                if isinstance(raw, dict):
                    for field in (
                        "subject",
                        "paragraphs",
                        "greeting",
                        "cta_label",
                        "cta_url",
                        "signoff",
                        "footer",
                        "preheader",
                    ):
                        if raw.get(field) not in (None, "", []):
                            copy_src[field] = raw.get(field)
                var = dict(var)
                if layout_sections:
                    var["sections"] = _overlay_variant_copy_on_sections(
                        layout_sections, copy_src
                    )
                else:
                    var["sections"] = _email_variant_sections_from_flat(copy_src)
                out[key] = canonicalize_email_fields(var)

            out = ensure_email_ab_variant_layouts(out)
            for key in core_keys:
                if out["variant_a"].get(key) not in (None, "", []):
                    out[key] = out["variant_a"][key]
        out = canonicalize_email_fields(out)

    return out


def _is_greeting_only(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
    if not lines:
        return True
    # Entire body is only a greeting line (with optional name placeholder).
    if len(lines) == 1 and _GREETING_ONLY.match(lines[0]):
        return True
    if _GREETING_ONLY.match(cleaned) and len(cleaned) < 45:
        return True
    return False


def fields_are_usable(channel: str, fields: dict[str, Any]) -> bool:
    """Strict gate for newly generated templates."""
    if channel == "email":
        html = str(fields.get("compiled_html") or fields.get("html") or "").strip()
        if html:
            return bool(str(fields.get("subject") or "").strip()) and len(html) >= 40
        va = fields.get("variant_a") if isinstance(fields.get("variant_a"), dict) else None
        vb = fields.get("variant_b") if isinstance(fields.get("variant_b"), dict) else None
        if fields.get("ab_test") or va or vb:
            def _email_ok(blob: dict[str, Any]) -> bool:
                paragraphs = blob.get("paragraphs") or []
                sections = blob.get("sections") or []
                return bool(str(blob.get("subject") or "").strip()) and (
                    len(paragraphs) >= 1 or len(sections) >= 3
                )

            return _email_ok(va or fields) and _email_ok(vb or {})
        sections = fields.get("sections")
        if isinstance(sections, list) and sections:
            types = {
                str(row.get("type") or "").strip()
                for row in sections
                if isinstance(row, dict)
            }
            meaningful = [
                row
                for row in sections
                if isinstance(row, dict)
                and (
                    str(row.get("content") or "").strip()
                    or row.get("items")
                    or str(row.get("label") or "").strip()
                    or row.get("type") == "divider"
                )
            ]
            return (
                bool(str(fields.get("subject") or "").strip())
                and "headline" in types
                and len(meaningful) >= 3
            )
        paragraphs = fields.get("paragraphs") or []
        return bool(str(fields.get("subject") or "").strip()) and len(paragraphs) >= 1
    if channel == "sms":
        body = str(fields.get("body") or "")
        return len(body) >= 40 and not _is_greeting_only(body)
    if channel == "whatsapp":
        body = str(fields.get("body") or "")
        if validate_whatsapp_fields is not None:
            ok, _errs = validate_whatsapp_fields(fields, strict=True)
            return ok and not _is_greeting_only(body)
        name = str(fields.get("name") or "").strip()
        return (
            bool(name)
            and bool(re.fullmatch(r"[a-z0-9_]+", name))
            and len(body) >= 80
            and not _is_greeting_only(body)
        )
    if channel in {"push", "web"}:
        title = str(fields.get("title") or "").strip()
        body = str(fields.get("body") or "").strip()
        return bool(title) and bool(body) and len(body) >= 12
    if channel == "ppc":
        headlines = fields.get("headlines") or []
        primary = str(fields.get("primary_text") or "").strip()
        network = str(fields.get("network") or "").strip().lower()
        keywords = fields.get("keywords") or []
        usable_headlines = (
            isinstance(headlines, list)
            and len([h for h in headlines if str(h).strip()]) >= 2
        )
        if not (
            network in {"meta", "google"}
            and usable_headlines
            and len(primary) >= 40
        ):
            return False
        # Google Search plans require at least one concrete keyword (+ match).
        if network == "google":
            if not isinstance(keywords, list):
                return False
            for item in keywords:
                text = _ppc_keyword_text(item)
                if not text:
                    continue
                if isinstance(item, dict):
                    match = _clean_str(item.get("match") or "").lower()
                    if match and match not in _PPC_KEYWORD_MATCHES:
                        continue
                return True
            return False
        # Meta: keywords optional if headlines + primary_text are solid.
        return True
    return bool(fields)


def fields_ok_for_edit(channel: str, fields: dict[str, Any]) -> bool:
    """Looser gate after user edits — allow short copy if still a real body."""
    if channel == "email":
        va = fields.get("variant_a") if isinstance(fields.get("variant_a"), dict) else None
        vb = fields.get("variant_b") if isinstance(fields.get("variant_b"), dict) else None
        if fields.get("ab_test") or va or vb:
            def _email_ok_edit(blob: dict[str, Any]) -> bool:
                paragraphs = blob.get("paragraphs") or []
                sections = blob.get("sections") or []
                return bool(
                    str(blob.get("subject") or "").strip() or paragraphs or sections
                )

            return _email_ok_edit(va or fields) or _email_ok_edit(vb or fields)
        sections = fields.get("sections")
        if isinstance(sections, list) and sections:
            return bool(str(fields.get("subject") or "").strip() or sections)
        paragraphs = fields.get("paragraphs") or []
        return bool(str(fields.get("subject") or "").strip() or paragraphs)
    if channel in {"sms", "whatsapp"}:
        body = str(fields.get("body") or "").strip()
        if channel == "whatsapp" and validate_whatsapp_fields is not None:
            ok, _ = validate_whatsapp_fields(fields, strict=False)
            return ok and bool(body) and not _is_greeting_only(body)
        return bool(body) and not _is_greeting_only(body)
    if channel in {"push", "web"}:
        return bool(
            str(fields.get("title") or "").strip()
            or str(fields.get("body") or "").strip()
        )
    if channel == "ppc":
        headlines = fields.get("headlines") or []
        primary = str(fields.get("primary_text") or "").strip()
        return bool(
            (isinstance(headlines, list) and any(str(h).strip() for h in headlines))
            or primary
        )
    return bool(fields)


def normalize_edit_result(
    data: dict[str, Any] | None,
    channel: str,
) -> dict[str, Any]:
    if not data:
        return {
            "intent": "clarify",
            "fields": None,
            "reply": "",
            "edit_outcome": "clarify",
            "reply_facts": {"action": "empty_model_response"},
        }
    intent = str(data.get("intent") or "").strip().lower()
    if intent not in {"modify", "save", "clarify", "general", "show"}:
        intent = "clarify"
    reply = strip_markdown_emphasis(str(data.get("reply") or "").strip())
    fields_raw = data.get("fields")
    fields = None

    if intent in {"modify", "save"}:
        if isinstance(fields_raw, dict):
            if intent == "modify":
                # Partial patches OK — finalize merges onto current fields.
                fields = fields_raw
            else:
                fields = normalize_fields(channel, fields_raw)
                if not fields_ok_for_edit(channel, fields):
                    fields = None
        elif intent == "modify":
            # Model claimed modify without fields — cannot show a new template.
            intent = "clarify"
            fields = None
        # intent=save with fields=null is OK — finalize persists Current fields.

    reply_facts: dict[str, Any] = {"action": intent or "general"}
    edit_outcome = intent if intent in {"modify", "save", "show", "clarify"} else "general"
    if intent == "modify" and fields:
        changed = [
            k
            for k in ("subject", "greeting", "body", "title", "cta_label", "buttons")
            if k in fields
        ]
        reply_facts["changed_keys"] = changed[:6]
        if "buttons" in fields and not fields.get("buttons"):
            reply_facts["action"] = "clear_buttons"
    elif intent == "modify" and not fields:
        edit_outcome = "clarify"
        reply_facts["action"] = "modify_missing_fields"

    return {
        "intent": intent,
        "fields": fields,
        "reply": reply,
        "edit_outcome": edit_outcome,
        "reply_facts": reply_facts,
    }
