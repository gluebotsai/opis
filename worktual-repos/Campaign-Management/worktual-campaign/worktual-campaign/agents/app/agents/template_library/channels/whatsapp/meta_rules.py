"""Meta WhatsApp Business message-template rules.

Source of truth for Campaign WhatsApp draft quality (generate + edit gates).
Aligned with Meta template fundamentals / category guidelines (marketing,
utility, authentication) as used by the WhatsApp Business Platform.

We generate *draft* fields for Meta submission later — these checks reduce
rejection risk before launch.
"""

from __future__ import annotations

import re
from typing import Any

# Meta limits (text templates)
BODY_MAX = 1024
FOOTER_MAX = 60
HEADER_TEXT_MAX = 60
BUTTON_LABEL_MAX = 25
BUTTONS_MAX = 3
NAME_MAX = 512
BODY_MIN_CHARS = 80

# Named variables we allow in Campaign drafts (Soft PDOA defaults).
ALLOWED_NAMED_VARS = frozenset(
    {
        "first_name",
        "campaign_url",
        # Only when user/edit explicitly adds them:
        "company",
        "city",
        "job_title",
        "product_name",
        "product_price",
        "product_id",
        "product_image",
    }
)

# Promotional cues → must be MARKETING (not UTILITY).
_PROMO_RE = re.compile(
    r"\b("
    r"offer|discount|sale|promo|coupon|deal|free|% off|percent off|"
    r"limited time|buy now|shop now|upgrade|subscribe|renew|"
    r"save \d+|flash sale|clearance|invite|webinar|event|"
    r"join us|register|exclusive|congratulat"
    r")\b",
    re.IGNORECASE,
)

# Non-promotional updates Meta expects as UTILITY (not MARKETING).
_UTILITY_INTENT_RE = re.compile(
    r"\b("
    r"order|delivery|shipment|tracking|parcel|dispatch|"
    r"appointment|reminder|account|password|reset|verify|verification|"
    r"meeting|schedule|rescheduled|ticket|support|assistance|"
    r"update regarding|status update|notification"
    r")\b",
    re.IGNORECASE,
)

_MARKETING_OPTOUT_RE = re.compile(
    r"\b(stop|unsubscribe|opt[\s-]?out)\b",
    re.IGNORECASE,
)

# Content Meta often rejects or flags.
_FORBIDDEN_RE = re.compile(
    r"("
    r"https?://bit\.ly/|"
    r"https?://tinyurl\.|"
    r"\b(whatsapp\.me|wa\.me)/\+?\d{8,}|"
    r"\b(viagra|casino|crypto\s*giveaway)\b|"
    r"click\s+here\s+now\s+!!!"
    r")",
    re.IGNORECASE,
)

_VAR_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
_NAME_RE = re.compile(r"^[a-z0-9_]+$")
_LANG_RE = re.compile(r"^[a-z]{2}(_[A-Za-z]{2})?$")
_URL_OK_RE = re.compile(
    r"^(\{\{\s*campaign_url\s*\}\}|https://[^\s]+)$",
    re.IGNORECASE,
)
_SCRIPT_STYLE_RE = re.compile(
    r"(?is)<(script|style)[^>]*>.*?</\1>",
)

def example_value_for_placeholder(tag: str) -> str:
    """Meta submit examples — draft keeps {{first_name}}; samples are not merge tags."""
    key = str(tag or "").strip().lower().replace(" ", "_")
    by_tag = {
        "first_name": "Customer",
        "firstname": "Customer",
        "name": "Customer",
        "company": "Acme",
        "company_name": "Acme",
        "city": "London",
        "job_title": "Director",
        "campaign_url": "https://example.com",
        "url": "https://example.com",
        "link": "https://example.com",
        "product_name": "Product",
        "product_price": "99",
        "product_id": "SKU-1",
        "product_image": "https://example.com/p.jpg",
        "product_url": "https://example.com/p",
        "report_date": "19 Sep 2026",
        "date": "19 Sep 2026",
        "period": "19 Sep 2026",
        "report_period": "19 Sep 2026",
    }
    return by_tag.get(key, "Sample")


def map_url_button_for_meta(raw_url: str) -> tuple[str, list[str] | None, list[str]]:
    """URL button merge tags → Meta {{n}} + example suffixes."""
    url = str(raw_url or "").strip()
    if not url or "{{" not in url:
        return url, None, []
    keys: list[str] = []
    examples: list[str] = []

    def _repl(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower().replace(" ", "_")
        keys.append(key)
        examples.append(example_value_for_placeholder(key))
        return "{{%d}}" % len(keys)

    mapped = _VAR_RE.sub(_repl, url)
    if mapped == "{{1}}" and len(keys) == 1:
        return (
            "https://example.com/{{1}}",
            [examples[0] or "https://example.com"],
            keys,
        )
    return mapped, (examples or None), keys


def strip_html_to_plain(text: str | None) -> str:
    """Meta submit/send must be plain text — no HTML tags."""
    if not text:
        return ""
    s = str(text)
    s = _SCRIPT_STYLE_RE.sub(" ", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|h[1-6]|li|tr|blockquote)>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (
        s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def map_named_vars_for_meta(text: str) -> tuple[str, list[str], list[str]]:
    """Convert {{first_name}} → {{1}} and collect Meta example values."""
    placeholders: list[str] = []

    def _repl(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower().replace(" ", "_")
        placeholders.append(key)
        return "{{%d}}" % len(placeholders)

    mapped = _VAR_RE.sub(_repl, text or "")
    examples = [example_value_for_placeholder(p) for p in placeholders]
    return mapped.strip(), placeholders, examples


def build_meta_submit_components(
    fields: dict[str, Any] | None,
) -> dict[str, Any]:
    """Exact Meta submit-approval `components` (+ placeholders) from draft fields."""
    data = fields if isinstance(fields, dict) else {}
    header_format = str(data.get("header_format") or "TEXT").strip().upper()
    header = strip_html_to_plain(str(data.get("header") or ""))
    header_media_handle = str(data.get("header_media_handle") or "").strip()
    body = strip_html_to_plain(str(data.get("body") or ""))
    footer = strip_html_to_plain(str(data.get("footer") or ""))[:FOOTER_MAX]
    buttons_in = data.get("buttons") if isinstance(data.get("buttons"), list) else []

    components: list[dict[str, Any]] = []
    body_placeholders: list[str] = []

    if header_format == "IMAGE" and header_media_handle:
        components.append(
            {
                "type": "HEADER",
                "format": "IMAGE",
                "example": {"header_handle": [header_media_handle]},
            }
        )
    elif header:
        h_text, h_ph, h_ex = map_named_vars_for_meta(header)
        header_comp: dict[str, Any] = {
            "type": "HEADER",
            "format": "TEXT",
            "text": h_text,
        }
        if h_ex:
            header_comp["example"] = {"header_text": h_ex}
        components.append(header_comp)

    b_text, body_placeholders, b_ex = map_named_vars_for_meta(body)
    body_comp: dict[str, Any] = {"type": "BODY", "text": b_text}
    if b_ex:
        body_comp["example"] = {"body_text": [b_ex]}
    components.append(body_comp)

    if footer:
        components.append({"type": "FOOTER", "text": footer[:FOOTER_MAX]})

    meta_buttons: list[dict[str, Any]] = []
    for item in buttons_in[:BUTTONS_MAX]:
        if not isinstance(item, dict):
            continue
        label = strip_html_to_plain(
            str(item.get("text") or item.get("label") or "")
        )[:BUTTON_LABEL_MAX]
        if not label:
            continue
        btype = str(item.get("type") or "").strip().upper()
        phone = re.sub(
            r"\D",
            "",
            str(item.get("phone_number") or item.get("phone") or ""),
        )
        if btype in {"PHONE_NUMBER", "PHONE"} or phone:
            continue
        url = str(item.get("url") or item.get("href") or "").strip()
        if btype == "QUICK_REPLY" or (not url and btype != "URL"):
            meta_buttons.append({"type": "QUICK_REPLY", "text": label})
            continue
        if url:
            mapped_url, ex, _keys = map_url_button_for_meta(url)
            btn: dict[str, Any] = {"type": "URL", "text": label, "url": mapped_url}
            if ex:
                btn["example"] = ex
            meta_buttons.append(btn)
    if meta_buttons:
        components.append({"type": "BUTTONS", "buttons": meta_buttons})

    language = str(data.get("language") or "en").strip() or "en"
    category = str(data.get("category") or "MARKETING").strip().upper()
    if category not in {"MARKETING", "UTILITY", "AUTHENTICATION"}:
        category = "MARKETING"

    return {
        "components": components,
        "body_placeholders": body_placeholders,
        "language": language,
        "category": category,
    }


def extract_variables(text: str) -> list[str]:
    return [m.group(1).strip() for m in _VAR_RE.finditer(text or "")]


def _has_adjacent_variables(text: str) -> bool:
    return bool(re.search(r"\}\}\s*\{\{", text or ""))


def _variable_at_edge_only(text: str) -> bool:
    """Body that is only variables / whitespace (Meta: unclear content)."""
    stripped = _VAR_RE.sub("", text or "").strip()
    return len(stripped) < 20 and bool(extract_variables(text or ""))


def _variables_at_body_edges(text: str) -> bool:
    """Meta: {{n}} cannot be at the very start or end of BODY text."""
    t = (text or "").strip()
    if not t or not extract_variables(t):
        return False
    if re.match(r"^\{\{", t):
        return True
    if re.search(r"\}\}\s*$", t):
        return True
    return False


def infer_whatsapp_meta_category(
    body: str,
    *,
    goal: str = "",
    objective: str = "",
) -> str:
    """Pick MARKETING vs UTILITY to reduce Meta category / format rejections."""
    if _PROMO_RE.search(body or ""):
        return "MARKETING"
    blob = " ".join(
        p for p in (body or "", goal or "", objective or "") if p
    ).strip()
    if blob and _UTILITY_INTENT_RE.search(blob) and not _PROMO_RE.search(body or ""):
        return "UTILITY"
    return "MARKETING"


def approval_first_static_body(body: str) -> str:
    """This WABA often rejects BODY variables (INVALID_FORMAT) — use static copy for submit."""
    t = strip_html_to_plain(str(body or "")).strip()
    if not extract_variables(t):
        return t[:BODY_MAX]
    t = _VAR_RE.sub("", t)
    t = re.sub(r"(?mi)^\s*(hi|hey|hello|dear)\s*,?\s*\n+", "", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\s+\.", ".", t)
    if len(t.strip()) < BODY_MIN_CHARS:
        t = (
            t.strip()
            + " Please contact our support team if you need any help."
        ).strip()
    return t[:BODY_MAX]


def ensure_body_meta_safe_opening(body: str) -> str:
    """Lead with a static line; avoid variable-heavy first line (Meta INVALID_FORMAT)."""
    t = strip_html_to_plain(str(body or "")).strip()
    if not t or not extract_variables(t):
        return t[:BODY_MAX]
    if _variables_at_body_edges(t):
        if re.match(r"^\{\{", t):
            t = "Hello,\n\n" + t
        if re.search(r"\}\}\s*$", t):
            t = t.rstrip() + "\n\nThank you."
    first_line = (t.split("\n")[0] or "").strip()
    if re.match(r"^(hi|hey|hello|dear)\s*,?\s*\{\{", first_line, re.IGNORECASE):
        t = "We have an update for you.\n\n" + t
    return t[:BODY_MAX]


def ensure_marketing_opt_out_footer(footer: str, category: str) -> str:
    """MARKETING templates need opt-out language in many WABAs."""
    cat = str(category or "").strip().upper()
    if cat != "MARKETING":
        return (footer or "")[:FOOTER_MAX]
    foot = strip_html_to_plain(str(footer or "")).strip()
    if _MARKETING_OPTOUT_RE.search(foot):
        return foot[:FOOTER_MAX]
    if not foot:
        return "Reply STOP to opt out"[:FOOTER_MAX]
    combined = f"{foot}. Reply STOP to opt out."
    return combined[:FOOTER_MAX]


def approval_first_strip_text_header(fields: dict[str, Any]) -> None:
    """TEXT headers often trigger INVALID_FORMAT — UTILITY and variable BODY use NONE."""
    hf = str(fields.get("header_format") or "NONE").strip().upper()
    if hf != "TEXT":
        return
    if str(fields.get("header_media_handle") or "").strip():
        return
    header = strip_html_to_plain(str(fields.get("header") or ""))
    cat = str(fields.get("category") or "").strip().upper()
    if cat == "UTILITY":
        fields["header"] = ""
        fields["header_format"] = "NONE"
        return
    if not header:
        fields["header_format"] = "NONE"
        return
    body = str(fields.get("body") or "")
    if extract_variables(body) or extract_variables(header):
        fields["header"] = ""
        fields["header_format"] = "NONE"


def collect_whatsapp_meta_names(
    prior_templates: list[dict[str, Any]] | None,
) -> list[str]:
    """Names already used on this WABA (prior session + org templates) — do not reuse."""
    seen: set[str] = set()
    out: list[str] = []
    for row in prior_templates or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        if ch not in {"whatsapp", "meta_whatsapp"}:
            continue
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        for key in ("name",):
            raw = str(fields.get(key) or row.get("name") or "").strip().lower()
            if not raw or not _NAME_RE.fullmatch(raw):
                continue
            if raw not in seen:
                seen.add(raw)
                out.append(raw)
    return out[:120]


def validate_whatsapp_fields(
    fields: dict[str, Any] | None,
    *,
    strict: bool = True,
    campaign: dict[str, Any] | None = None,
) -> tuple[bool, list[str]]:
    """Return (ok, error messages). strict=True for generate; False for soft edit."""
    errors: list[str] = []
    data = fields if isinstance(fields, dict) else {}

    name = str(data.get("name") or "").strip()
    language = str(data.get("language") or "en").strip().replace("-", "_")
    category = str(data.get("category") or "MARKETING").strip().upper()
    body = strip_html_to_plain(str(data.get("body") or ""))
    footer = strip_html_to_plain(str(data.get("footer") or ""))
    header = strip_html_to_plain(str(data.get("header") or ""))
    header_format = str(data.get("header_format") or ("TEXT" if header else "NONE")).strip().upper()
    header_media_handle = str(data.get("header_media_handle") or "").strip()
    buttons = data.get("buttons") if isinstance(data.get("buttons"), list) else []

    # --- name ---
    if not name:
        errors.append("Meta template name is required (lowercase_snake_case).")
    elif not _NAME_RE.fullmatch(name):
        errors.append(
            "Template name must match ^[a-z0-9_]+$ (no spaces, hyphens, or capitals)."
        )
    elif len(name) > NAME_MAX:
        errors.append(f"Template name max {NAME_MAX} characters.")
    elif name in {"template", "whatsapp", "wa", "test", "campaign"}:
        errors.append(
            "Template name is too generic — use a descriptive snake_case name."
        )

    # --- language ---
    if not _LANG_RE.fullmatch(language):
        errors.append("language must be a Meta code like en or en_US.")

    # --- category ---
    if category not in {"MARKETING", "UTILITY", "AUTHENTICATION"}:
        errors.append("category must be MARKETING, UTILITY, or AUTHENTICATION.")
    elif category == "UTILITY" and _PROMO_RE.search(body):
        errors.append(
            "Body looks promotional — use category MARKETING (Meta will reclassify "
            "promotional UTILITY as MARKETING / may reject)."
        )
    elif category == "AUTHENTICATION":
        errors.append(
            "AUTHENTICATION templates are OTP/code flows — campaign drafts should "
            "use MARKETING or UTILITY."
        )

    # --- body ---
    if not body:
        errors.append("BODY is required.")
    else:
        if len(body) > BODY_MAX:
            errors.append(f"BODY max {BODY_MAX} characters (Meta limit).")
        if strict and len(body) < BODY_MIN_CHARS:
            errors.append(
                f"BODY too thin (<{BODY_MIN_CHARS} chars) — add offer, benefit, and next step."
            )
        if _has_adjacent_variables(body):
            errors.append(
                "Variables cannot be adjacent (e.g. {{a}}{{b}}) — put text between them."
            )
        if _variable_at_edge_only(body):
            errors.append(
                "BODY cannot be variables-only — Meta treats unclear content as marketing risk."
            )
        if _variables_at_body_edges(body):
            errors.append(
                "Variables cannot be at the very start or end of BODY — put real words "
                "before the first {{…}} and after the last {{…}} (Meta rule)."
            )
        for var in extract_variables(body):
            if re.fullmatch(r"\d+", var):
                errors.append(
                    "Use named variables ({{first_name}}), not positional {{1}}/{{2}}."
                )
                break
            key = var.lower().replace(" ", "_")
            if key not in ALLOWED_NAMED_VARS:
                errors.append(
                    f"Unsupported variable {{{{{var}}}}} — allowed: "
                    f"{', '.join(sorted(ALLOWED_NAMED_VARS))}."
                )
                break
        if _FORBIDDEN_RE.search(body):
            errors.append(
                "BODY contains content Meta is likely to reject (spam/policy)."
            )

    # --- header (optional) ---
    if header_format not in {"NONE", "TEXT", "IMAGE"}:
        errors.append("HEADER format must be NONE, TEXT, or IMAGE.")
    elif header_format == "IMAGE":
        if not header_media_handle:
            errors.append(
                "IMAGE HEADER requires an existing Meta-uploaded header_media_handle."
            )
        if header:
            errors.append("IMAGE HEADER cannot also contain text.")
    elif header_format == "NONE" and header:
        errors.append("HEADER format NONE cannot contain header text.")
    elif header:
        if len(header) > HEADER_TEXT_MAX:
            errors.append(f"HEADER text max {HEADER_TEXT_MAX} characters.")
        for var in extract_variables(header):
            if var.lower() not in {"first_name"}:
                errors.append(
                    "HEADER may only use {{first_name}} if a variable is needed."
                )
                break

    # --- footer: Meta FOOTER cannot contain variables ---
    if footer:
        if len(footer) > FOOTER_MAX:
            errors.append(f"FOOTER max {FOOTER_MAX} characters.")
        if extract_variables(footer):
            errors.append("FOOTER cannot contain variables (Meta rule).")

    # --- buttons ---
    has_url, _preferred = url_available_for_whatsapp_buttons(data, campaign)
    if len(buttons) > BUTTONS_MAX:
        errors.append(f"Max {BUTTONS_MAX} buttons.")
    url_count = 0
    quick_count = 0
    for i, btn in enumerate(buttons[: BUTTONS_MAX + 1]):
        if not isinstance(btn, dict):
            errors.append(f"Button {i + 1} must be an object with label.")
            continue
        label = strip_html_to_plain(
            str(btn.get("label") or btn.get("text") or "")
        )
        if not label:
            errors.append(
                f"Button {i + 1} needs a non-empty label (≤{BUTTON_LABEL_MAX} chars)."
            )
        elif len(label) > BUTTON_LABEL_MAX:
            errors.append(
                f"Button {i + 1} label max {BUTTON_LABEL_MAX} characters."
            )
        btype = str(btn.get("type") or "").strip().upper()
        url = str(btn.get("url") or btn.get("href") or "").strip()
        phone = re.sub(
            r"\D",
            "",
            str(btn.get("phone_number") or btn.get("phone") or ""),
        )
        if btype in {"PHONE_NUMBER", "PHONE"} or phone:
            errors.append(
                f"Button {i + 1}: PHONE_NUMBER buttons are not used — URL buttons only."
            )
            continue
        if btype == "QUICK_REPLY" or (not url and btype != "URL"):
            quick_count += 1
            continue
        if url:
            url_count += 1
            if not _URL_OK_RE.match(url):
                errors.append(
                    f"Button {i + 1} URL must be https://… or {{{{campaign_url}}}} "
                    "(no http:// or shorteners)."
                )
    if url_count > 0 and not has_url:
        errors.append(
            "URL buttons need a campaign https link or {{{{campaign_url}}}} in the template."
        )
    if url_count > 2:
        errors.append("Meta allows at most 2 URL buttons per template.")
    if quick_count + url_count > BUTTONS_MAX:
        errors.append(f"Max {BUTTONS_MAX} buttons total (URL + quick reply).")

    if strict and not errors and body:
        sentences = [s for s in re.split(r"[.!?\n]+", body) if s.strip()]
        if len(sentences) < 2 and len(body) < 120:
            errors.append(
                "BODY should have greeting + offer + next step (2+ sentences)."
            )

    return (len(errors) == 0, errors)


def validate_whatsapp_layout(
    fields: dict[str, Any] | None,
    design_plan: dict[str, Any] | None,
) -> tuple[bool, list[str]]:
    """Validate the Director-selected Meta layout preset after copy generation."""
    data = fields if isinstance(fields, dict) else {}
    plan = design_plan if isinstance(design_plan, dict) else {}
    layout = plan.get("meta_layout") if isinstance(plan.get("meta_layout"), dict) else {}
    if not layout:
        return True, []

    errors: list[str] = []
    header_mode = str(layout.get("header") or "none").strip().lower()
    header = strip_html_to_plain(str(data.get("header") or ""))
    header_format = str(data.get("header_format") or ("TEXT" if header else "NONE")).strip().upper()
    media_handle = str(data.get("header_media_handle") or "").strip()
    if header_mode == "none" and (header or header_format != "NONE"):
        errors.append("Selected WhatsApp preset requires no header.")
    elif header_mode == "text" and (not header or header_format != "TEXT"):
        errors.append("Selected WhatsApp preset requires a text header.")
    elif header_mode == "image" and (
        header_format != "IMAGE" or not media_handle or header
    ):
        errors.append(
            "Selected WhatsApp preset requires an IMAGE header with an existing Meta media handle."
        )

    buttons = data.get("buttons") if isinstance(data.get("buttons"), list) else []
    if buttons:
        expected_count = int(layout.get("button_count") or 0)
        if expected_count and len(buttons) != expected_count:
            errors.append(
                f"Selected WhatsApp preset requires exactly {expected_count} button(s)."
            )
        expected_types = [
            str(value).strip().upper()
            for value in layout.get("button_types", [])
            if str(value).strip()
        ] if isinstance(layout.get("button_types"), list) else []
        actual_types = [
            "URL"
            if isinstance(button, dict)
            and (button.get("url") or str(button.get("type") or "").upper() == "URL")
            else "QUICK_REPLY"
            for button in buttons
        ]
        if expected_types and actual_types != expected_types:
            errors.append(
                "Selected WhatsApp preset requires button types "
                + ", ".join(expected_types)
                + "."
            )

    target = layout.get("target_body_chars")
    body_len = len(strip_html_to_plain(str(data.get("body") or "")))
    if isinstance(target, list) and len(target) >= 2:
        low, high = int(target[0]), int(target[1])
        if body_len < low or body_len > high:
            errors.append(
                f"Selected WhatsApp preset targets a {low}–{high} character body."
            )
    return (not errors, errors)


_CAMPAIGN_URL_KEYS = (
    "form_url",
    "cta_url",
    "campaign_url",
    "landing_url",
    "product_url",
)


def _https_url(raw: str | None) -> str:
    val = str(raw or "").strip()
    if val.lower().startswith("https://"):
        return val
    return ""


def url_available_for_whatsapp_buttons(
    fields: dict[str, Any] | None,
    campaign: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    """Return whether a URL exists for URL buttons and the preferred button URL."""
    data = fields if isinstance(fields, dict) else {}
    camp = campaign if isinstance(campaign, dict) else {}
    for source in (camp, data):
        for key in _CAMPAIGN_URL_KEYS:
            url = _https_url(str(source.get(key) or ""))
            if url:
                return True, url
    buttons = data.get("buttons") if isinstance(data.get("buttons"), list) else []
    for item in buttons:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or item.get("href") or "").strip()
        if _https_url(url):
            return True, url
        if "{{campaign_url}}" in url.replace(" ", "").lower():
            return True, "{{campaign_url}}"
    return False, ""


def _normalize_meta_buttons(
    buttons_in: list[Any],
    *,
    has_url: bool,
    preferred_url: str,
) -> list[dict[str, str]]:
    """Normalize URL + QUICK_REPLY buttons for Meta submit (max 3, max 2 URL)."""
    out: list[dict[str, str]] = []
    url_count = 0
    for item in buttons_in[:BUTTONS_MAX]:
        if isinstance(item, str) and item.strip():
            continue
        if not isinstance(item, dict):
            continue
        label = strip_html_to_plain(
            str(item.get("text") or item.get("label") or "")
        )[:BUTTON_LABEL_MAX]
        if not label:
            continue
        btype = str(item.get("type") or "").strip().upper()
        url = str(item.get("url") or item.get("href") or "").strip()
        phone = re.sub(
            r"\D",
            "",
            str(item.get("phone_number") or item.get("phone") or ""),
        )
        if btype in {"PHONE_NUMBER", "PHONE"} or phone:
            continue
        if btype == "QUICK_REPLY" or (not url and btype != "URL"):
            out.append({"type": "QUICK_REPLY", "text": label, "label": label})
            continue
        if not has_url and not url:
            continue
        if url.lower().startswith("http://"):
            url = "https://" + url[7:]
        if "{{" in url:
            if "{{campaign_url}}" in url.replace(" ", "").lower():
                out.append(
                    {
                        "type": "URL",
                        "text": label,
                        "label": label,
                        "url": "{{campaign_url}}",
                    }
                )
                url_count += 1
            elif _https_url(preferred_url):
                out.append(
                    {
                        "type": "URL",
                        "text": label,
                        "label": label,
                        "url": preferred_url,
                    }
                )
                url_count += 1
            continue
        if not url.lower().startswith("https://"):
            if _https_url(preferred_url):
                url = preferred_url
            else:
                continue
        if not url:
            continue
        out.append({"type": "URL", "text": label, "label": label, "url": url})
        url_count += 1
        if url_count >= 2 and len(out) >= BUTTONS_MAX:
            break
    return out[:BUTTONS_MAX]


def sanitize_whatsapp_fields(
    fields: dict[str, Any] | None,
    *,
    campaign: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize fields toward Meta submit JSON (plain text, no HTML)."""
    out = dict(fields or {})
    raw_name = str(out.get("name") or "").strip().lower()
    cleaned = re.sub(r"[^a-z0-9_]+", "_", raw_name)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")[:NAME_MAX]
    out["name"] = cleaned

    lang = str(out.get("language") or "en").strip().replace("-", "_") or "en"
    out["language"] = lang

    header = strip_html_to_plain(str(out.get("header") or ""))[:HEADER_TEXT_MAX]
    header_format = str(
        out.get("header_format") or ("TEXT" if header else "NONE")
    ).strip().upper()
    if header_format not in {"NONE", "TEXT", "IMAGE"}:
        header_format = "TEXT" if header else "NONE"
    if header_format == "IMAGE":
        header = ""
    out["header_format"] = header_format
    out["header"] = header
    out["header_media_handle"] = str(
        out.get("header_media_handle") or ""
    ).strip()
    media_url = str(out.get("header_media_url") or "").strip()
    out["header_media_url"] = (
        media_url if media_url.lower().startswith("https://") else ""
    )
    goal = str((campaign or {}).get("goal") or "")
    objective = str((campaign or {}).get("objective") or "")

    body = approval_first_static_body(str(out.get("body") or ""))
    out["body"] = body

    cat = str(out.get("category") or "").strip().upper()
    if cat not in {"MARKETING", "UTILITY", "AUTHENTICATION"}:
        cat = infer_whatsapp_meta_category(body, goal=goal, objective=objective)
    elif cat == "MARKETING" and not _PROMO_RE.search(body):
        inferred = infer_whatsapp_meta_category(body, goal=goal, objective=objective)
        if inferred == "UTILITY":
            cat = "UTILITY"
    if cat == "UTILITY" and _PROMO_RE.search(body):
        cat = "MARKETING"
    if cat == "AUTHENTICATION":
        cat = "MARKETING"
    out["category"] = cat

    approval_first_strip_text_header(out)

    footer = strip_html_to_plain(str(out.get("footer") or ""))
    if footer:
        footer = _VAR_RE.sub("", footer).strip()
    footer = ensure_marketing_opt_out_footer(footer, cat)
    out["footer"] = footer[:FOOTER_MAX]

    buttons_in = out.get("buttons") if isinstance(out.get("buttons"), list) else []
    has_url, preferred_url = url_available_for_whatsapp_buttons(out, campaign)
    out["buttons"] = _normalize_meta_buttons(
        buttons_in,
        has_url=has_url,
        preferred_url=preferred_url,
    )

    meta = build_meta_submit_components(out)
    out["components"] = meta["components"]
    out["body_placeholders"] = meta["body_placeholders"]
    return out


def meta_rules_prompt_block() -> str:
    """Inject into WhatsApp agent system / schema hints."""
    return """
META WHATSAPP TEMPLATE RULES (strict — output must be submit-ready for Meta):

NO HTML. Ever. HEADER / BODY / FOOTER / button text are plain text only.
Newlines (\\n) are OK. Never <p>, <br>, <b>, <div>, Markdown, or code fences.

NAME
- Required. Pattern ^[a-z0-9_]+$ only. Descriptive (e.g. q2_webinar_invite_2026).
- Never spaces, hyphens, capitals, or the internal campaign title dumped as-is.

LANGUAGE
- Use en or en_US (or the campaign locale). Codes like en_US are fine.

CATEGORY (Meta pricing / review)
- MARKETING — offers, sales, invites, events, awareness, retargeting, mixed content.
- UTILITY — ONLY non-promotional follow-ups to a user action (order update, account alert)
  with no promo/upsell language. If unsure → MARKETING.
- AUTHENTICATION — OTP / verification only (do NOT use for campaign marketing drafts).
- Meta may auto-reclassify miscategorized UTILITY → MARKETING. Prefer MARKETING for offers.

BODY (type BODY, max 1024 chars)
- Required. Static text only — no {{first_name}} or any {{…}} in BODY (WABA rejects variable BODY).
- ≥80 characters; ≥2 sentences. Order/delivery/meeting/reminder copy → category UTILITY.
- Personalization: use a friendly static greeting (e.g. "Hello,") not merge tags.
- Dynamic links: URL button with https://… or {{campaign_url}} only — not in BODY text.
- No spammy shorteners / policy-violating content.

TEMPLATE NAME (WABA-unique)
- You MUST invent a new name on every generate. Pattern ^[a-z0-9_]+$ only.
- When TAKEN META NAMES are listed in context, your "name" MUST NOT match any of them
  (same language — Meta rejects duplicate name+language).
- On edit/modify: keep the existing "name" unchanged unless the user asked to rename.

FOOTER (optional, max 60 chars)
- Plain text only — NO variables. MARKETING MUST include opt-out (e.g. Reply STOP to opt out).

BUTTONS (Meta submit — type BUTTONS, 1–3 buttons)
- If NO https URL in campaign context → "buttons": [] (omit BUTTONS at submit) unless user asked for quick replies only.
- Allowed types: QUICK_REPLY (text ≤25) and URL (text + url). Never PHONE_NUMBER.
- URL: https://… or {{campaign_url}} for dynamic links; never http:// or shorteners.
- At most 3 buttons total; at most 2 URL buttons. QUICK_REPLY + URL may be combined (see CCaaS submit-approval samples).

HEADER (approval-first: prefer NONE)
- Default header_format="NONE", header="" (best first-pass approval rate).
- Avoid TEXT header when BODY uses {{first_name}} / {{campaign_url}}.
- IMAGE only when header_media_handle already exists from upload pipeline.

SUBMIT-APPROVAL PAYLOAD (POST …/submit-approval — launch builds this from your draft):
- Top-level: name (^ [a-z0-9_]+$), language (en / en_US), category (UTILITY|MARKETING|AUTHENTICATION), allowCategoryChange false, components[].
- components[] must include type BODY. Optional HEADER (format TEXT|IMAGE…), FOOTER, BUTTONS.
- In components, BODY text uses positional {{1}}, {{2}} — mapped from your draft {{first_name}}, {{campaign_url}} at save/launch.
- Draft fields keep NAMED tags only; never put {{1}} in body/header the user edits.
- BODY: variables cannot be at the very start or end of text (Meta rule).
- If BODY/HEADER uses {{n}}, submit adds example.body_text / example.header_text (samples only — not shown in UI).
- BUTTONS example: [{"type":"QUICK_REPLY","text":"Sales"},{"type":"URL","text":"Open app","url":"https://…"}]
- REJECTED templates need a NEW name before resubmit. Do not submit hello_world.

User-visible template cards show plain static BODY text (no merge tags in BODY).
""".strip()
