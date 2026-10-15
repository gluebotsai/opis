"""Generate proposal / quote / invoice template sections from a brief (+ optional sample)."""

from __future__ import annotations

import base64
import io
import json
import os
import re
import shutil
import subprocess
import zipfile
from typing import Any, TypedDict, Optional
from xml.etree import ElementTree as ET

from app.agents.native_pipeline import run_steps

from app.llm import generate_ai_text, is_ai_configured

PROPOSAL_TOKENS = (
    "{{customerName}}",
    "{{companyName}}",
    "{{dealTitle}}",
    "{{date}}",
    "{{vendorName}}",
)
QUOTE_TOKENS = PROPOSAL_TOKENS + (
    "{{quoteNumber}}",
    "{{currency}}",
    "{{subtotal}}",
    "{{discountPct}}",
    "{{total}}",
    "{{validUntil}}",
)
INVOICE_TOKENS = (
    "{{customerName}}",
    "{{companyName}}",
    "{{invoiceNumber}}",
    "{{date}}",
    "{{dueDate}}",
    "{{vendorName}}",
    "{{sellerAddress}}",
    "{{currency}}",
    "{{subtotal}}",
    "{{taxAmount}}",
    "{{total}}",
    "{{paymentTerms}}",
    "{{billingAddress}}",
    "{{taxId}}",
)

PROPOSAL_KEYS = (
    "introduction",
    "features",
    "scope",
    "plan_of_action",
    "commercials",
    "onboarding",
    "implementation",
    "support",
    "conclusion",
)

# Never allow these on invoice clones — they come from proposal templates.
INVOICE_FORBIDDEN_KEYS = {
    "features",
    "scope",
    "plan_of_action",
    "commercials",
    "onboarding",
    "implementation",
    "support",
    "conclusion",
    "cover",
    "hero",
    "overview",
}

PAGE_BREAK_CSS = (
    ".proposal-blueprint .bp-cover-page{page-break-after:always;break-after:page;}"
    ".proposal-blueprint .bp-cover{page-break-after:auto;break-after:auto;}"
    # Content flows across pages; only the cover forces a page break (sample PDF).
    ".proposal-blueprint .bp-section{page-break-before:auto;break-before:auto;}"
    ".proposal-blueprint .bp-section h2{page-break-after:avoid;break-after:avoid;}"
)
INVOICE_PAGE_CSS = (
    ".proposal-blueprint .bp-section{page-break-before:auto;break-before:auto;}"
    ".proposal-blueprint .bp-section h2{page-break-after:avoid;break-after:avoid;}"
)
QUOTE_KEYS = (
    "introduction",
    "tax_note",
    "bank",
    "terms",
    "payment_terms",
    "delivery",
    "footer",
)
INVOICE_KEYS = (
    "introduction",
    "line_items",
    "tax",
    "payment",
    "footer",
)

TOKEN_RE = re.compile(r"\{\{[a-zA-Z0-9_]+\}\}")


class TemplateState(TypedDict, total=False):
    kind: str
    brief: str
    sample_text: str
    organization_name: str
    existing_sections: list[dict[str, Any]]
    cleaned_brief: str
    cleaned_sample: str
    sections: list[dict[str, Any]]
    blueprint: dict[str, Any]
    assets: list[dict[str, Any]]
    sample_images: list[dict[str, Any]]
    warnings: list[str]
    status: str
    reason: Optional[str]


def _slug(value: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")
    return s[:48] or fallback


def _extract_json_array(text: str) -> list[Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    start = raw.find("[")
    end = raw.rfind("]")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            return data if isinstance(data, list) else None
        except json.JSONDecodeError:
            pass
    return None


def _extract_json_payload(text: str) -> dict[str, Any] | None:
    """Parse model output that may be {sections, blueprint} or a bare sections array."""
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return {"sections": data}
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            pass
    arr = _extract_json_array(text)
    return {"sections": arr} if arr else None


def _section_blocks(sections: list[dict[str, Any]]) -> tuple[list[dict[str, str]], list[str]]:
    """Build slot metadata + HTML. Skip cover/footer/header — those are layout chrome."""
    layout_keys = {"cover", "footer", "header", "letterhead"}
    slots: list[dict[str, str]] = []
    blocks: list[str] = []
    for s in sections:
        key = str(s.get("key") or "section")
        if key.strip().lower() in layout_keys:
            continue
        title = str(s.get("title") or key)
        slots.append({"key": key, "label": title})
        blocks.append(
            f'<section class="bp-section" data-slot="{key}">'
            f'<h2 data-slot-title>{title}</h2>'
            f'<div class="bp-body" data-slot-body></div>'
            f"</section>"
        )
    return slots, blocks


def _default_blueprint(kind: str, sections: list[dict[str, Any]]) -> dict[str, Any]:
    doc = (
        "Invoice"
        if kind == "invoice"
        else "Quotation"
        if kind == "quote"
        else "Proposal"
    )
    slots, section_html = _section_blocks(sections)
    return {
        "version": 1,
        "theme": {
            "primary": "#1e3a5f",
            "secondary": "#64748b",
            "fonts": "Georgia, 'Times New Roman', serif",
            "background": "#ffffff",
        },
        "slots": slots,
        "css": (
            ".proposal-blueprint{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;background:#fff;}"
            ".proposal-blueprint .bp-header{border-bottom:3px solid #1e3a5f;padding-bottom:1rem;margin-bottom:1.5rem;}"
            ".proposal-blueprint .bp-header h1{margin:0;font-size:1.75rem;color:#1e3a5f;}"
            ".proposal-blueprint .bp-meta{color:#64748b;font-size:.875rem;margin-top:.35rem;}"
            ".proposal-blueprint .bp-logo{max-height:48px;margin-bottom:.75rem;}"
            ".proposal-blueprint .bp-section{margin-bottom:1.25rem;}"
            ".proposal-blueprint .bp-section h2{font-size:1.1rem;color:#1e3a5f;margin:0 0 .5rem;"
            "border-bottom:1px solid #e2e8f0;padding-bottom:.25rem;}"
            ".proposal-blueprint .bp-section .bp-body{white-space:pre-wrap;line-height:1.55;font-size:.95rem;}"
            ".proposal-blueprint .bp-footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e2e8f0;"
            "font-size:.8rem;color:#64748b;}"
            + PAGE_BREAK_CSS
        ),
        "html": (
            f'<header class="bp-header">'
            f'<img class="bp-logo" src="asset:logo" alt=""/>'
            f"<h1>{doc}</h1>"
            f'<div class="bp-meta">{{{{companyName}}}} · {{{{customerName}}}} · {{{{date}}}}</div>'
            f"</header>"
            + "".join(section_html)
            + '<footer class="bp-footer">Prepared by {{vendorName}}</footer>'
        ),
    }


def _cover_style_blueprint(
    kind: str,
    sections: list[dict[str, Any]],
    asset_ids: set[str],
) -> dict[str, Any]:
    """Word-style proposal cover matching sample PDFs (logo + hero + rainbow footer)."""
    slots, section_html = _section_blocks(sections)
    has_logo = "logo" in asset_ids
    has_hero = "hero" in asset_ids
    has_footer = "footer" in asset_ids
    # B2B cover recipient is the company (sample PDFs: "Submitted to POTHYS").
    cover_title = (
        "Invoice for {{companyName}}"
        if kind == "invoice"
        else "Quotation for {{companyName}}"
        if kind == "quote"
        else "Proposal Submitted to {{companyName}}"
    )
    letterhead = ""
    if has_logo:
        letterhead += '<img class="bp-logo" src="asset:logo" alt=""/>'
    letterhead += (
        '<div class="bp-company">{{vendorName}}</div>'
        '<div class="bp-address">{{sellerAddress}}</div>'
    )
    cover = (
        f'<div class="bp-cover">'
        f'<h1 class="bp-cover-title">{cover_title}</h1>'
        f'<p class="bp-cover-for">for</p>'
        f'<p class="bp-cover-deal">({{{{productScope}}}})</p>'
        f'<p class="bp-cover-date">{{{{date}}}}</p>'
    )
    if has_hero:
        cover += '<img class="bp-hero" src="asset:hero" alt=""/>'
    else:
        cover += (
            '<div class="bp-hero-banner" role="img" aria-label="Solution">'
            '<p class="bp-hero-eyebrow">Solution</p>'
            '<h2 class="bp-hero-product">{{productScope}}</h2>'
            '<p class="bp-hero-tagline">Tailored for {{companyName}}</p>'
            "</div>"
        )
    cover += "</div>"
    footer = '<footer class="bp-footer">'
    if has_footer:
        footer += '<img class="bp-footer-stripe" src="asset:footer" alt=""/>'
    else:
        footer += '<div class="bp-footer-stripe-fallback"></div>'
    footer += "<div class=\"bp-footer-meta\">Prepared by {{vendorName}}</div></footer>"
    cover_page = (
        f'<div class="bp-cover-page">'
        f'<header class="bp-letterhead">{letterhead}</header>'
        f"{cover}"
        f"{footer}"
        f"</div>"
    )
    return {
        "version": 1,
        "theme": {
            "primary": "#5F62F1",
            "secondary": "#00E79F",
            "fonts": "Calibri, Arial, 'Helvetica Neue', sans-serif",
            "background": "#ffffff",
        },
        "slots": slots,
        "css": (
            ".proposal-blueprint{font-family:Calibri,Arial,'Helvetica Neue',sans-serif;"
            "color:#000;background:#fff;max-width:720px;margin:0 auto;padding:28px 36px 24px;}"
            ".proposal-blueprint .bp-cover-page{page-break-after:always;break-after:page;}"
            ".proposal-blueprint .bp-letterhead{text-align:center;margin-bottom:28px;}"
            ".proposal-blueprint .bp-logo{display:block;margin:0 auto 10px;max-height:40px;width:auto;}"
            ".proposal-blueprint .bp-company{font-family:'Times New Roman',Times,serif;font-weight:700;"
            "font-size:12px;margin:0;}"
            ".proposal-blueprint .bp-address{font-size:9px;color:#222;margin-top:4px;line-height:1.35;}"
            ".proposal-blueprint .bp-cover{text-align:center;margin:20px 0 24px;}"
            ".proposal-blueprint .bp-cover-title{font-size:20px;font-weight:700;margin:0 0 8px;}"
            ".proposal-blueprint .bp-cover-for{margin:0 0 6px;font-size:14px;}"
            ".proposal-blueprint .bp-cover-deal{font-weight:700;font-size:15px;margin:0 0 8px;}"
            ".proposal-blueprint .bp-cover-date{font-weight:700;font-size:14px;margin:0 0 20px;}"
            ".proposal-blueprint .bp-hero{display:block;width:100%;max-width:560px;margin:12px auto 0;"
            "border-radius:2px;}"
            ".proposal-blueprint .bp-hero-banner{display:block;width:100%;max-width:560px;margin:16px auto 0;"
            "padding:28px 24px 32px;text-align:left;border-radius:4px;"
            "background:linear-gradient(135deg,#5F62F1 0%,#3d41c9 55%,#2a2d8f 100%);color:#fff;"
            "box-sizing:border-box}"
            ".proposal-blueprint .bp-hero-eyebrow{margin:0 0 8px;font-size:11px;letter-spacing:.12em;"
            "text-transform:uppercase;color:#00E79F;font-weight:600}"
            ".proposal-blueprint .bp-hero-product{margin:0 0 10px;font-size:22px;line-height:1.25;"
            "font-weight:700;color:#fff}"
            ".proposal-blueprint .bp-hero-tagline{margin:0;font-size:13px;line-height:1.45;"
            "color:rgba(255,255,255,.88);max-width:36em}"
            ".proposal-blueprint .bp-section{margin:0 0 1.35rem;text-align:left;}"
            ".proposal-blueprint .bp-section h2{font-size:14px;font-weight:700;color:#365F91;"
            "margin:0 0 .55rem;border:none;padding:0;}"
            ".proposal-blueprint .bp-section .bp-body{white-space:pre-wrap;line-height:1.5;font-size:12px;}"
            ".proposal-blueprint .bp-footer{margin-top:1.5rem;text-align:center;}"
            ".proposal-blueprint .bp-footer-stripe{display:block;width:100%;height:8px;object-fit:cover;"
            "margin:0 0 10px;}"
            ".proposal-blueprint .bp-footer-stripe-fallback{height:6px;margin:0 0 10px;"
            "background:linear-gradient(90deg,#E7372B 0 20%,#8067A8 20% 40%,#663534 40% 60%,"
            "#337FBD 60% 80%,#B4D068 80% 100%);}"
            ".proposal-blueprint .bp-footer-meta{font-size:10px;color:#333;line-height:1.4;}"
            + PAGE_BREAK_CSS
        ),
        "html": cover_page + "".join(section_html),
    }


def _sample_looks_commercial_invoice(sample_text: str) -> bool:
    blob = (sample_text or "").lower()
    return bool(
        re.search(r"customer\s+details", blob)
        and re.search(r"\bitems\b", blob)
        and re.search(r"financial\s+summary|bank\s+details", blob)
    )


def _commercial_invoice_fill_blueprint(
    sections: list[dict[str, Any]],
    asset_ids: set[str],
    *,
    sample_text: str = "",
) -> dict[str, Any]:
    """Live-invoice HTML matching commercial PDF samples (black banner + boxes)."""
    tagline, _address = _invoice_letterhead_bits(sample_text)
    logo = (
        '<img class="bp-inv-logo" src="asset:logo" alt=""/>' if "logo" in asset_ids else ""
    )
    tagline_html = (
        f'<div class="bp-inv-tagline">{_escape_html(tagline)}</div>' if tagline else ""
    )
    html = f"""
<header class="bp-inv-banner">
  <div class="bp-inv-banner-left">
    <div class="bp-inv-brand">{logo}<div class="bp-inv-wordmark">{{{{vendorName}}}}</div></div>
    {tagline_html}
    <div class="bp-inv-seller">{{{{sellerAddress}}}}</div>
    <div class="bp-inv-seller-meta">GST: {{{{taxId}}}}</div>
  </div>
  <div class="bp-inv-banner-right">
    <div class="bp-inv-meta-row"><strong>Invoice #:</strong> {{{{invoiceNumber}}}}</div>
    <div class="bp-inv-meta-row"><strong>Date:</strong> {{{{date}}}}</div>
    <div class="bp-inv-meta-row"><strong>Due:</strong> {{{{dueDate}}}}</div>
  </div>
</header>
<section class="bp-section bp-inv-block" data-slot="customer">
  <h2 data-slot-title>Customer details</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section bp-inv-block" data-slot="line_items">
  <h2 data-slot-title>Items</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<div class="bp-inv-mid">
  <div class="bp-inv-words">Amount due: {{{{currency}}}} {{{{total}}}}</div>
  <section class="bp-section bp-inv-summary" data-slot="tax">
    <h2 data-slot-title>Financial Summary</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
</div>
<div class="bp-inv-grid2">
  <section class="bp-section bp-inv-box" data-slot="payment">
    <h2 data-slot-title>Bank details</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
  <section class="bp-section bp-inv-box" data-slot="disclaimer">
    <h2 data-slot-title>{{{{vendorName}}}}</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
</div>
<div class="bp-inv-grid3">
  <section class="bp-section bp-inv-box" data-slot="terms">
    <h2 data-slot-title>Terms &amp; Conditions</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
  <section class="bp-section bp-inv-box" data-slot="payment_terms">
    <h2 data-slot-title>Payment Terms</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
  <section class="bp-section bp-inv-box" data-slot="delivery">
    <h2 data-slot-title>Delivery Timeline</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
</div>
""".strip()
    slots = [
        {"key": "customer", "label": "Customer details"},
        {"key": "line_items", "label": "Items"},
        {"key": "tax", "label": "Financial Summary"},
        {"key": "payment", "label": "Bank details"},
        {"key": "disclaimer", "label": "Company note"},
        {"key": "terms", "label": "Terms & Conditions"},
        {"key": "payment_terms", "label": "Payment Terms"},
        {"key": "delivery", "label": "Delivery Timeline"},
    ]
    css = (
        ".proposal-blueprint{font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;"
        "color:#111;background:#fff;max-width:800px;margin:0 auto;padding:0 0 28px}"
        ".proposal-blueprint .bp-inv-banner{display:flex;justify-content:space-between;gap:24px;"
        "align-items:flex-start;background:#111;color:#fff;padding:22px 24px 20px;margin:0 0 22px}"
        ".proposal-blueprint .bp-inv-banner-left{flex:1;min-width:0}"
        ".proposal-blueprint .bp-inv-banner-right{flex:0 0 auto;text-align:right;font-size:12px;"
        "line-height:1.55;padding-top:2px}"
        ".proposal-blueprint .bp-inv-brand{display:flex;align-items:center;gap:10px;margin:0 0 10px}"
        ".proposal-blueprint .bp-inv-logo{display:block;max-height:36px;width:auto;"
        "filter:brightness(0) invert(1)}"
        ".proposal-blueprint .bp-inv-wordmark{font-size:20px;font-weight:700;letter-spacing:.06em;"
        "text-transform:uppercase;margin:0;line-height:1}"
        ".proposal-blueprint .bp-inv-tagline{font-size:11px;opacity:.88;margin:0 0 6px}"
        ".proposal-blueprint .bp-inv-seller,.proposal-blueprint .bp-inv-seller-meta{font-size:11px;"
        "line-height:1.45;opacity:.92;white-space:pre-wrap}"
        ".proposal-blueprint .bp-inv-seller-meta{margin-top:4px}"
        ".proposal-blueprint .bp-inv-meta-row{margin:0 0 2px}"
        ".proposal-blueprint .bp-inv-block{padding:0 24px;margin:0 0 1.15rem}"
        ".proposal-blueprint .bp-section h2{font-size:10px;font-weight:600;letter-spacing:.1em;"
        "text-transform:uppercase;color:#9ca3af;margin:0 0 .55rem;border:none;padding:0}"
        ".proposal-blueprint .bp-inv-summary h2,.proposal-blueprint .bp-inv-box h2{color:#111;"
        "font-size:12px;letter-spacing:0;text-transform:none;font-weight:700}"
        ".proposal-blueprint .bp-section .bp-body{white-space:pre-wrap;line-height:1.5;"
        "font-size:13px;color:#111}"
        ".proposal-blueprint .bp-table{width:100%;border-collapse:collapse;margin:.15em 0 .35em;"
        "font-size:12px;table-layout:fixed;border:1px solid #d1d5db}"
        ".proposal-blueprint .bp-table th,.proposal-blueprint .bp-table td{border:1px solid #d1d5db;"
        "padding:.55em .6em;text-align:left;vertical-align:top;line-height:1.4}"
        ".proposal-blueprint .bp-table th{font-weight:700;background:#f3f4f6;color:#111}"
        ".proposal-blueprint .bp-inv-mid{display:flex;justify-content:space-between;gap:20px;"
        "align-items:flex-start;padding:0 24px;margin:0 0 1.25rem}"
        ".proposal-blueprint .bp-inv-words{flex:1;font-size:12px;color:#374151;padding-top:8px}"
        ".proposal-blueprint .bp-inv-summary{flex:0 0 260px;border:1px solid #d1d5db;"
        "border-radius:10px;padding:12px 14px;margin:0;background:#fff}"
        ".proposal-blueprint .bp-inv-grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:12px;"
        "padding:0 24px;margin:0 0 12px}"
        ".proposal-blueprint .bp-inv-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;"
        "padding:0 24px}"
        ".proposal-blueprint .bp-inv-box{border:1px solid #d1d5db;border-radius:10px;"
        "padding:12px 14px;margin:0;background:#fff}"
        ".proposal-blueprint .bp-inv-box .bp-body{font-size:12px;color:#374151}"
        + INVOICE_PAGE_CSS
    )
    return {
        "version": 1,
        "theme": {
            "primary": "#111111",
            "secondary": "#9ca3af",
            "fonts": "Arial, 'Helvetica Neue', Helvetica, sans-serif",
            "background": "#ffffff",
        },
        "slots": slots,
        "css": css,
        "html": html,
    }


def _invoice_letterhead_blueprint(
    sections: list[dict[str, Any]],
    asset_ids: set[str],
    *,
    sample_text: str = "",
) -> dict[str, Any]:
    """Commercial invoice letterhead from THIS sample only — never proposal chrome.

    No cover page, no product hero, no rainbow proposal footer stripe.
    """
    if _sample_looks_commercial_invoice(sample_text):
        return _commercial_invoice_fill_blueprint(
            sections, asset_ids, sample_text=sample_text
        )
    slots, section_html = _section_blocks(sections)
    has_logo = "logo" in asset_ids
    has_footer = "footer" in asset_ids
    tagline, address = _invoice_letterhead_bits(sample_text)
    letterhead = '<header class="bp-letterhead">'
    if has_logo:
        letterhead += '<img class="bp-logo" src="asset:logo" alt=""/>'
    letterhead += '<div class="bp-company">{{vendorName}}</div>'
    if tagline:
        letterhead += f'<div class="bp-tagline">{_escape_html(tagline)}</div>'
    letterhead += (
        f'<div class="bp-address">{_escape_html(address) if address else "{{sellerAddress}}"}</div>'
        "</header>"
    )
    meta = (
        '<div class="bp-invoice-meta">'
        '<div class="bp-meta-row"><span>Invoice #:</span> <strong>{{invoiceNumber}}</strong></div>'
        '<div class="bp-meta-row"><span>Date:</span> <strong>{{date}}</strong></div>'
        '<div class="bp-meta-row"><span>Due:</span> <strong>{{dueDate}}</strong></div>'
        '<div class="bp-meta-row"><span>Bill to:</span> <strong>{{companyName}}</strong></div>'
        "</div>"
    )
    footer = '<footer class="bp-footer">'
    if has_footer:
        # Only the footer image extracted from THIS sample — never invent stripes.
        footer += '<img class="bp-footer-stripe" src="asset:footer" alt=""/>'
    footer += (
        '<div class="bp-footer-meta">'
        "This is a computer-generated invoice from {{vendorName}}."
        "</div></footer>"
    )
    return {
        "version": 1,
        "theme": {
            "primary": "#1e3a5f",
            "secondary": "#64748b",
            "fonts": "Arial, 'Helvetica Neue', Helvetica, sans-serif",
            "background": "#ffffff",
        },
        "slots": slots,
        "css": (
            ".proposal-blueprint{font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;"
            "color:#111;background:#fff;max-width:720px;margin:0 auto;padding:24px 32px 20px;}"
            ".proposal-blueprint .bp-letterhead{text-align:left;margin:0 0 18px;"
            "padding-bottom:14px;border-bottom:2px solid #1e3a5f;}"
            ".proposal-blueprint .bp-logo{display:block;margin:0 0 8px;max-height:64px;width:auto;}"
            ".proposal-blueprint .bp-company{font-weight:700;font-size:15px;margin:0;letter-spacing:.02em;}"
            ".proposal-blueprint .bp-tagline{font-size:11px;color:#555;margin:4px 0 0;}"
            ".proposal-blueprint .bp-address{font-size:10px;color:#444;margin-top:6px;line-height:1.4;"
            "white-space:pre-wrap;}"
            ".proposal-blueprint .bp-invoice-meta{margin:0 0 1.25rem;font-size:12px;line-height:1.55;}"
            ".proposal-blueprint .bp-meta-row{margin:0 0 .25rem;}"
            ".proposal-blueprint .bp-meta-row span{color:#64748b;}"
            ".proposal-blueprint .bp-section{margin:0 0 1rem;text-align:left;}"
            ".proposal-blueprint .bp-section h2{font-size:13px;font-weight:700;color:#1e3a5f;"
            "margin:0 0 .45rem;border:none;padding:0;}"
            ".proposal-blueprint .bp-section .bp-body{white-space:pre-wrap;line-height:1.5;font-size:12px;}"
            ".proposal-blueprint .bp-table{width:100%;border-collapse:collapse;margin:.4em 0 .9em;"
            "font-size:12px;table-layout:fixed}"
            ".proposal-blueprint .bp-table th,.proposal-blueprint .bp-table td{"
            "border:1px solid #000;padding:.35em .5em;text-align:left;vertical-align:top}"
            ".proposal-blueprint .bp-table th{font-weight:700;background:#fff}"
            ".proposal-blueprint .bp-footer{margin-top:1.5rem;padding-top:.75rem;"
            "border-top:1px solid #e2e8f0;}"
            ".proposal-blueprint .bp-footer-stripe{display:block;width:100%;height:8px;object-fit:cover;"
            "margin:0 0 8px}"
            ".proposal-blueprint .bp-footer-meta{font-size:10px;color:#333;line-height:1.4;}"
            + INVOICE_PAGE_CSS
        ),
        "html": letterhead + meta + "".join(section_html) + footer,
    }


def _escape_html(value: str) -> str:
    return (
        (value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _invoice_letterhead_bits(sample_text: str) -> tuple[str, str]:
    """Pull tagline + address lines from the uploaded invoice sample only."""
    lines = [ln.strip() for ln in (sample_text or "").splitlines() if ln.strip()]
    if not lines:
        return "", "{{sellerAddress}}"
    tagline = ""
    addr_parts: list[str] = []
    # Skip vendor name (line 0); next non-contact line is often tagline.
    for ln in lines[1:16]:
        low = ln.lower()
        if re.search(
            r"invoice\s*#|^\s*date\s*:|customer\s+details|^\s*bill\s+to\b|^\s*items\s*$|"
            r"financial\s+summary|bank\s+details",
            low,
        ):
            break
        if re.match(r"^(gst|tax\s*id|phone|email|website|tel|www)\b", low):
            addr_parts.append(ln)
            continue
        if not tagline and not re.search(r"\d{3,}", ln) and len(ln) < 60:
            tagline = ln
            continue
        addr_parts.append(ln)
        if len(addr_parts) >= 6:
            break
    address = "\n".join(addr_parts).strip()
    return tagline, address or "{{sellerAddress}}"


def _templatize_invoice_fragment(text: str) -> str:
    """Replace sample-specific values with merge tokens; keep layout wording."""
    out = _normalize_plain_text(text or "")
    out = re.sub(
        r"Invoice\s*#:\s*\S+",
        "Invoice #: {{invoiceNumber}}",
        out,
        flags=re.I,
    )
    out = re.sub(r"(?m)^Date:\s*.+$", "Date: {{date}}", out, flags=re.I)
    out = re.sub(
        r"(?m)^Due(?:\s*Date)?:\s*.+$",
        "Due Date: {{dueDate}}",
        out,
        flags=re.I,
    )
    out = re.sub(r"(?m)^Due on\s+.+$", "Due on {{dueDate}}", out, flags=re.I)
    # Do NOT replace seller GST on the letterhead with {{taxId}} — that blanked
    # the banner. Customer tax id stays a separate merge field when needed.
    out = re.sub(
        r"(Subtotal(?:\s*\([^)]*\))?)\s*[₹$Rs.\s]*[\d,]+\.?\d*",
        r"\1 {{currency}} {{subtotal}}",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"(@?\s*\d+%\s*(?:IGST|CGST|SGST|GST|VAT|Tax)[^\n]*)\s*[₹$Rs.\s]*[\d,]+\.?\d*",
        r"\1 {{currency}} {{taxAmount}}",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"(Total(?:\s*Amount)?)\s*:?\s*[₹$Rs.\s]*[\d,]+\.?\d*",
        r"\1: {{currency}} {{total}}",
        out,
        flags=re.I,
    )
    return out.strip()


def _sections_from_invoice_sample(sample_text: str) -> list[dict[str, Any]]:
    """Deterministic invoice sections from the uploaded sample — no proposal keys."""
    text = _normalize_plain_text(sample_text or "")
    if len(text) < 40:
        return []

    markers: list[tuple[str, str, re.Pattern[str]]] = [
        ("customer", "Customer details", re.compile(r"CUSTOMER\s+DETAILS", re.I)),
        ("line_items", "Items", re.compile(r"(?m)^\s*ITEMS\s*$", re.I)),
        ("tax", "Financial Summary", re.compile(r"Financial\s+Summary", re.I)),
        ("payment", "Bank details", re.compile(r"Bank\s+details", re.I)),
        ("terms", "Terms & Conditions", re.compile(r"Terms\s*&\s*Conditions|Terms\s+and\s+Conditions", re.I)),
        ("payment_terms", "Payment Terms", re.compile(r"(?m)^\s*Payment\s+Terms\s*$", re.I)),
        ("delivery", "Delivery Timeline", re.compile(r"Delivery\s+Timeline", re.I)),
    ]

    hits: list[tuple[int, str, str]] = []
    for key, title, pat in markers:
        m = pat.search(text)
        if m:
            hits.append((m.start(), key, title))
    hits.sort(key=lambda x: x[0])

    intro_end = hits[0][0] if hits else len(text)
    intro_raw = text[:intro_end].strip()
    # Keep letterhead + invoice meta in introduction; tokenise identifiers.
    intro_body = _templatize_invoice_fragment(intro_raw)
    # Drop the one-off customer name from the letterhead block if CUSTOMER DETAILS follows.
    if not intro_body:
        intro_body = (
            "{{vendorName}}\n{{sellerAddress}}\nGST: {{taxId}}\n\n"
            "Invoice #: {{invoiceNumber}}\nDate: {{date}}\nDue Date: {{dueDate}}"
        )

    sections: list[dict[str, Any]] = [
        {
            "id": "sec-intro",
            "key": "introduction",
            "title": "Invoice",
            "body": intro_body,
            "sortOrder": 1,
        }
    ]

    for i, (start, key, title) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(text)
        chunk = text[start:end].strip()
        # Strip the heading line from body when present.
        chunk = re.sub(r"^[^\n]+\n", "", chunk, count=1).strip()
        if key == "customer":
            body = (
                "Bill To:\n{{companyName}}\n{{customerName}}\n{{billingAddress}}"
            )
            sections.append(
                {
                    "id": f"sec-{key}",
                    "key": "introduction",  # merge into intro via append? keep separate key
                    "title": title,
                    "body": body,
                    "sortOrder": len(sections) + 1,
                }
            )
            # Use a stable non-proposal key
            sections[-1]["key"] = "customer"
            sections[-1]["id"] = "sec-customer"
            continue
        if key == "line_items":
            body = (
                "| Description | Qty | Unit Price | Subtotal |\n"
                "| --- | --- | --- | --- |\n"
                "| Line item (from deal) | 1 | {{currency}} 0.00 | {{currency}} {{subtotal}} |"
            )
            sections.append(
                {
                    "id": "sec-line-items",
                    "key": "line_items",
                    "title": title,
                    "body": body,
                    "sortOrder": len(sections) + 1,
                }
            )
            continue
        body = _templatize_invoice_fragment(chunk)
        if key == "payment":
            # Keep bank numbers from sample (vendor bank) — only tokenize vendor name.
            body = re.sub(
                r"(Account\s+name\s*:)\s*.+",
                r"\1 {{vendorName}}",
                body,
                flags=re.I,
            )
            map_key = "payment"
        elif key == "tax":
            map_key = "tax"
        elif key == "terms":
            map_key = "terms"
        elif key == "payment_terms":
            body = "Payment Terms: {{paymentTerms}}\nDue on {{dueDate}}"
            map_key = "payment_terms"
        elif key == "delivery":
            map_key = "delivery"
        else:
            map_key = key
        if not body:
            continue
        sections.append(
            {
                "id": f"sec-{map_key}",
                "key": map_key,
                "title": title,
                "body": body,
                "sortOrder": len(sections) + 1,
            }
        )

    # Always end with a short footer note from the sample when present.
    if not any(str(s.get("key")) == "footer" for s in sections):
        sections.append(
            {
                "id": "sec-footer",
                "key": "footer",
                "title": "Footer",
                "body": (
                    "This is a computer-generated invoice from {{vendorName}} "
                    "and does not require a signature."
                ),
                "sortOrder": len(sections) + 1,
            }
        )
    return sections


def _looks_like_proposal_blueprint(html: str, css: str = "") -> bool:
    blob = f"{html}\n{css}".lower()
    if re.search(r"bp-cover|bp-hero|asset:hero|submitted to", blob):
        return True
    if "bp-footer-stripe-fallback" in blob:
        return True
    # Rainbow gradient used by Pothys proposal chrome — never for invoices.
    if "#e7372b" in blob and "#b4d068" in blob:
        return True
    return False


def _has_invoice_letterhead(html: str) -> bool:
    return bool(
        re.search(r"bp-letterhead|bp-invoice-meta|class=\"bp-company\"", html or "", re.I)
    )


def _sanitize_invoice_blueprint(
    blueprint: dict[str, Any],
    sections: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    sample_text: str = "",
) -> dict[str, Any]:
    """Drop proposal chrome. If the AI hallucinated a proposal layout, rebuild."""
    html = str(blueprint.get("html") or "")
    css = str(blueprint.get("css") or "")
    ids = {str(a.get("id") or "") for a in assets if isinstance(a, dict)}
    if (
        _looks_like_proposal_blueprint(html, css)
        or not html.strip()
        or not _has_invoice_letterhead(html)
    ):
        return _invoice_letterhead_blueprint(
            sections, ids, sample_text=sample_text
        )

    # Strip any proposal nodes that leaked into an otherwise usable blueprint.
    html = re.sub(
        r'<div\b[^>]*class="[^"]*\bbp-cover-page\b[^"]*"[^>]*>[\s\S]*?</div>',
        "",
        html,
        flags=re.I,
    )
    html = re.sub(
        r'<div\b[^>]*class="[^"]*\bbp-cover\b[^"]*"[^>]*>[\s\S]*?</div>',
        "",
        html,
        flags=re.I,
    )
    html = re.sub(
        r'<div\b[^>]*class="[^"]*\bbp-hero-banner\b[^"]*"[^>]*>[\s\S]*?</div>',
        "",
        html,
        flags=re.I,
    )
    html = re.sub(r'<img\b[^>]*class="[^"]*\bbp-hero\b[^"]*"[^>]*>', "", html, flags=re.I)
    html = re.sub(r'<img\b[^>]*src="asset:hero"[^>]*>', "", html, flags=re.I)
    html = re.sub(
        r'<div\b[^>]*class="[^"]*\bbp-footer-stripe-fallback\b[^"]*"[^>]*>\s*</div>',
        "",
        html,
        flags=re.I,
    )
    # Never keep a footer stripe img unless this sample extracted asset:footer.
    if "footer" not in ids:
        html = re.sub(
            r'<img\b[^>]*class="[^"]*\bbp-footer-stripe\b[^"]*"[^>]*>',
            "",
            html,
            flags=re.I,
        )
        html = re.sub(r'<img\b[^>]*src="asset:footer"[^>]*>', "", html, flags=re.I)

    css = re.sub(
        r"\.proposal-blueprint\s+\.bp-footer-stripe-fallback\{[^}]*\}",
        "",
        css,
        flags=re.I,
    )
    css = re.sub(
        r"background:linear-gradient\(90deg,#E7372B[^;)]+\)",
        "background:transparent",
        css,
        flags=re.I,
    )
    if "page-break-after:always" in css.replace(" ", "").lower():
        css = re.sub(
            r"\.proposal-blueprint\s+\.bp-cover-page\{[^}]*\}",
            "",
            css,
            flags=re.I,
        )

    out = dict(blueprint)
    out["html"] = html.strip()
    out["css"] = css.strip() or _invoice_letterhead_blueprint(
        sections, ids, sample_text=sample_text
    )["css"]
    theme = out.get("theme") if isinstance(out.get("theme"), dict) else {}
    out["theme"] = {
        "primary": str(theme.get("primary") or "#1e3a5f"),
        "secondary": str(theme.get("secondary") or "#64748b"),
        "fonts": str(
            theme.get("fonts") or "Arial, 'Helvetica Neue', Helvetica, sans-serif"
        ),
        "background": str(theme.get("background") or "#ffffff"),
    }
    return out


def _filter_invoice_sections(
    sections: list[dict[str, Any]],
    sample_sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Reject proposal-only keys; fall back to sample-derived sections."""
    cleaned = [
        s
        for s in sections
        if str(s.get("key") or "").strip().lower() not in INVOICE_FORBIDDEN_KEYS
    ]
    if sample_sections and (
        not cleaned
        or len(cleaned) < 3
        or any(
            str(s.get("key") or "").lower() in INVOICE_FORBIDDEN_KEYS for s in sections
        )
    ):
        return sample_sections
    return cleaned or sample_sections or sections


def _blueprint_for_assets(
    kind: str,
    sections: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    ai_blueprint: dict[str, Any] | None = None,
    sample_text: str = "",
) -> dict[str, Any]:
    """Prefer sample branding layout when PDF/DOCX yielded brand images.

    Invoices: exact page clone when page-* assets exist; never proposal chrome.
    """
    ids = {str(a.get("id") or "") for a in assets if isinstance(a, dict)}
    page_ids = _page_ids_from_assets(assets)
    if page_ids and kind in ("invoice", "quote", "proposal"):
        return _page_clone_blueprint(
            page_ids, sections, assets, sample_text=sample_text, kind=kind
        )
    if kind == "invoice":
        if (
            ai_blueprint
            and isinstance(ai_blueprint.get("html"), str)
            and str(ai_blueprint.get("html") or "").strip()
        ):
            return _sanitize_invoice_blueprint(
                ai_blueprint, sections, assets, sample_text=sample_text
            )
        return _invoice_letterhead_blueprint(
            sections, ids, sample_text=sample_text
        )
    if (
        ai_blueprint
        and isinstance(ai_blueprint.get("html"), str)
        and str(ai_blueprint.get("html") or "").strip()
    ):
        return ai_blueprint
    if "logo" in ids or "hero" in ids:
        return _cover_style_blueprint(kind, sections, ids)
    return _default_blueprint(kind, sections)


def _normalize_blueprint(
    raw: Any,
    kind: str,
    sections: list[dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return _default_blueprint(kind, sections)
    html = str(raw.get("html") or "").strip()
    css = str(raw.get("css") or "").strip()
    if not html:
        return _default_blueprint(kind, sections)
    theme = raw.get("theme") if isinstance(raw.get("theme"), dict) else {}
    slots_raw = raw.get("slots") if isinstance(raw.get("slots"), list) else []
    slots: list[dict[str, str]] = []
    for s in slots_raw:
        if isinstance(s, dict) and s.get("key"):
            slots.append(
                {
                    "key": str(s["key"]),
                    "label": str(s.get("label") or s["key"]),
                }
            )
    if not slots:
        slots = [
            {"key": str(s.get("key") or f"s{i}"), "label": str(s.get("title") or "Section")}
            for i, s in enumerate(sections)
        ]
    # Ensure every section has a data-slot block
    for s in sections:
        key = str(s.get("key") or "")
        if key and f'data-slot="{key}"' not in html:
            html += (
                f'<section class="bp-section" data-slot="{key}">'
                f'<h2 data-slot-title>{s.get("title") or key}</h2>'
                f'<div class="bp-body" data-slot-body></div></section>'
            )
    if not css:
        css = _default_blueprint(kind, sections)["css"]
    if kind == "invoice":
        if "page-break-after:always" in css.replace(" ", "").lower():
            css = re.sub(
                r"\.proposal-blueprint\s+\.bp-cover-page\{[^}]*\}",
                "",
                css,
                flags=re.I,
            )
        if "page-break-before" not in css:
            css = f"{css}\n{INVOICE_PAGE_CSS}".strip()
    elif "page-break-after" not in css and "break-after:page" not in css:
        css = f"{css}\n{PAGE_BREAK_CSS}".strip()
    return {
        "version": int(raw.get("version") or 1),
        "html": html,
        "css": css,
        "theme": {
            "primary": str(theme.get("primary") or "#1e3a5f"),
            "secondary": str(theme.get("secondary") or "#64748b"),
            "fonts": str(
                theme.get("fonts")
                or (
                    "Arial, 'Helvetica Neue', Helvetica, sans-serif"
                    if kind == "invoice"
                    else "Georgia, serif"
                )
            ),
            "background": str(theme.get("background") or "#ffffff"),
        },
        "slots": slots,
    }


def _extract_docx_assets(
    content_base64: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    assets: list[dict[str, Any]] = []
    try:
        raw = base64.b64decode(content_base64, validate=False)
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            media = [n for n in zf.namelist() if n.startswith("word/media/")]
            for i, name in enumerate(media[:6]):
                data = zf.read(name)
                if len(data) > 500_000:
                    continue
                lower = name.lower()
                mime = "image/png"
                if lower.endswith(".jpg") or lower.endswith(".jpeg"):
                    mime = "image/jpeg"
                elif lower.endswith(".gif"):
                    mime = "image/gif"
                elif lower.endswith(".webp"):
                    mime = "image/webp"
                asset_id = "logo" if i == 0 else f"img-{i}"
                assets.append(
                    {
                        "id": asset_id,
                        "kind": "logo" if i == 0 else "image",
                        "mime": mime,
                        "dataBase64": base64.b64encode(data).decode("ascii"),
                    }
                )
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Could not extract DOCX images: {exc}")
    return assets, warnings


_PDF_IMAGE_SCRIPT = r"""
import base64, io, json, struct, sys
from pypdf import PdfReader

def png_wh(data):
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None, None
    return struct.unpack(">II", data[16:24])

def jpeg_wh(data):
    if data[:3] != b"\xff\xd8\xff":
        return None, None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5 : i + 9])
            return w, h
        if marker == 0xD9:
            break
        if marker in (0xD8, 0x01) or (0xD0 <= marker <= 0xD7):
            i += 2
            continue
        ln = struct.unpack(">H", data[i + 2 : i + 4])[0]
        i += 2 + ln
    return None, None

def mime_of(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return "application/octet-stream"

raw = sys.stdin.buffer.read()
reader = PdfReader(io.BytesIO(raw))
uniques = []
seen = set()
for page in reader.pages:
    for img in getattr(page, "images", []) or []:
        data = img.data
        mime = mime_of(data)
        w, h = (jpeg_wh(data) if mime == "image/jpeg" else png_wh(data))
        key = (w, h, mime, len(data))
        if key in seen:
            continue
        seen.add(key)
        uniques.append({"w": w, "h": h, "mime": mime, "data": data})

def pick_logo(items):
    exact = [x for x in items if x["w"] == 185 and x["h"] == 43]
    if exact:
        return exact[0]
    cands = [x for x in items if x["w"] and x["h"] and x["w"] > x["h"] and x["h"] <= 80 and x["w"] >= 80]
    if cands:
        return min(cands, key=lambda x: abs((x["w"] or 0) * (x["h"] or 0) - 185 * 43))
    # Invoice / seal logos are often square (e.g. 382x378 Worktual mark).
    square = [
        x for x in items
        if x["w"] and x["h"] and 40 <= x["w"] <= 600 and 40 <= x["h"] <= 600
        and 0.55 <= (x["w"] / max(x["h"], 1)) <= 1.8
    ]
    if square:
        return max(square, key=lambda x: (x["w"] or 0) * (x["h"] or 0))
    if len(items) == 1 and items[0].get("w") and items[0].get("h"):
        return items[0]
    return None

def pick_hero(items):
    photos = [
        x for x in items
        if x["w"] and x["h"] and x["w"] >= 280 and x["h"] >= 140
        and (x["w"] / max(x["h"], 1)) >= 1.25
        and x["mime"] in ("image/jpeg", "image/png")
    ]
    return max(photos, key=lambda x: (x["w"] or 0) * (x["h"] or 0), default=None)

def pick_footer(items):
    exact = [x for x in items if x["w"] == 571 and x["h"] == 10]
    if exact:
        return exact[0]
    cands = [x for x in items if x["h"] and x["h"] <= 24 and x["w"] and x["w"] >= 200]
    return min(cands, key=lambda x: abs((x["w"] or 0) - 571), default=None)

def shrink_embed(data, mime, max_b64=750_000):
    ext = (mime or "image/png").split("/")[-1]
    try:
        import fitz
        ft = ext if ext in ("png", "jpeg", "jpg", "gif", "bmp") else "png"
        img = fitz.open(stream=data, filetype=ft)
        pix = fitz.Pixmap(img, 0)
        img.close()
        if pix.n >= 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        base = pix
        for scale in (0.85, 0.7, 0.55, 0.4):
            mat = fitz.Matrix(scale, scale)
            spix = fitz.Pixmap(base, mat) if scale < 1.0 else base
            for q in (85, 75, 65, 55):
                jpg = spix.tobytes("jpeg", jpg_quality=q)
                if len(base64.b64encode(jpg)) <= max_b64:
                    return jpg, "image/jpeg"
        jpg = spix.tobytes("jpeg", jpg_quality=45)
        return jpg, "image/jpeg"
    except Exception:
        pass
    b64 = base64.b64encode(data).decode("ascii")
    if len(b64) <= max_b64:
        return data, mime
    return None, None

out = []
used = set()
for kind, item in (("logo", pick_logo(uniques)), ("hero", pick_hero(uniques)), ("footer", pick_footer(uniques))):
    if not item:
        continue
    # Do not reuse the same embed as both logo and hero.
    key = (item.get("w"), item.get("h"), item.get("mime"), len(item.get("data") or b""))
    if key in used:
        continue
    used.add(key)
    data, mime = shrink_embed(item["data"], item["mime"])
    if not data:
        continue
    b64 = base64.b64encode(data).decode("ascii")
    if len(b64) > 950_000:
        continue
    out.append({"id": kind, "kind": "logo" if kind == "logo" else "image", "mime": mime, "dataBase64": b64})
print(json.dumps(out, separators=(",", ":")))
"""


def _extract_pdf_assets_via_external_python(raw: bytes) -> list[dict[str, Any]]:
    for py in _fitz_python_candidates():
        try:
            proc = subprocess.run(
                [py, "-c", _PDF_IMAGE_SCRIPT],
                input=raw,
                capture_output=True,
                timeout=90,
                check=False,
            )
        except (OSError, subprocess.SubprocessError, TimeoutError):
            continue
        if proc.returncode != 0:
            continue
        try:
            data = json.loads(proc.stdout.decode("utf-8", errors="ignore") or "[]")
        except json.JSONDecodeError:
            continue
        if isinstance(data, list) and data:
            return [
                a
                for a in data
                if isinstance(a, dict)
                and a.get("id")
                and a.get("mime")
                and a.get("dataBase64")
            ]
    return []


_PDF_PAGE_RENDER_SCRIPT = r"""
import base64, json, sys
try:
    import fitz
except Exception:
    sys.exit(2)
MAX_PAGES = 20
MAX_B64 = 3_200_000
raw = sys.stdin.buffer.read()
doc = fitz.open(stream=raw, filetype="pdf")
out = []
page_count = int(doc.page_count)
for i in range(min(page_count, MAX_PAGES)):
    page = doc.load_page(i)
    data = b""
    mime = "image/jpeg"
    for attempt_scale in (2.0, 1.75, 1.5, 1.25, 1.0):
        pix = page.get_pixmap(matrix=fitz.Matrix(attempt_scale, attempt_scale), alpha=False)
        data = pix.tobytes("jpeg", jpg_quality=85)
        mime = "image/jpeg"
        if len(base64.b64encode(data)) <= MAX_B64:
            break
    else:
        continue
    b64 = base64.b64encode(data).decode("ascii")
    if len(b64) > MAX_B64:
        continue
    out.append({
        "id": f"page-{i + 1}",
        "kind": "image",
        "mime": mime,
        "dataBase64": b64,
    })
print(json.dumps({"pages": out, "pageCount": page_count}, separators=(",", ":")))
"""


def _render_pdf_pages_via_fitz_inprocess(
    raw: bytes,
) -> tuple[list[dict[str, Any]], int]:
    """Rasterize PDF pages with PyMuPDF in the current process (Docker-safe)."""
    try:
        import fitz
    except ImportError:
        return [], 0

    max_pages = 20
    max_b64 = 3_200_000
    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception:
        return [], 0

    out: list[dict[str, Any]] = []
    page_count = int(doc.page_count)
    try:
        for i in range(min(page_count, max_pages)):
            page = doc.load_page(i)
            data = b""
            mime = "image/jpeg"
            for attempt_scale in (2.0, 1.75, 1.5, 1.25, 1.0):
                pix = page.get_pixmap(
                    matrix=fitz.Matrix(attempt_scale, attempt_scale),
                    alpha=False,
                )
                data = pix.tobytes("jpeg", jpg_quality=85)
                mime = "image/jpeg"
                if len(base64.b64encode(data)) <= max_b64:
                    break
            else:
                continue
            b64 = base64.b64encode(data).decode("ascii")
            if len(b64) > max_b64:
                continue
            out.append(
                {
                    "id": f"page-{i + 1}",
                    "kind": "image",
                    "mime": mime,
                    "dataBase64": b64,
                }
            )
    finally:
        doc.close()
    if out:
        return out, page_count or len(out)
    return [], 0


def _render_pdf_pages_via_fitz(raw: bytes) -> tuple[list[dict[str, Any]], int]:
    pages, page_count = _render_pdf_pages_via_fitz_inprocess(raw)
    if pages:
        return pages, page_count

    for py in _fitz_python_candidates():
        try:
            proc = subprocess.run(
                [py, "-c", _PDF_PAGE_RENDER_SCRIPT],
                input=raw,
                capture_output=True,
                timeout=180,
                check=False,
            )
        except (OSError, subprocess.SubprocessError, TimeoutError):
            continue
        if proc.returncode != 0:
            continue
        try:
            payload = json.loads(proc.stdout.decode("utf-8", errors="ignore") or "[]")
        except json.JSONDecodeError:
            continue
        pages_raw: list[Any]
        page_count = 0
        if isinstance(payload, dict):
            pages_raw = payload.get("pages") if isinstance(payload.get("pages"), list) else []
            try:
                page_count = int(payload.get("pageCount") or 0)
            except (TypeError, ValueError):
                page_count = 0
        elif isinstance(payload, list):
            pages_raw = payload
        else:
            continue
        pages = [
            a
            for a in pages_raw
            if isinstance(a, dict)
            and str(a.get("id") or "").startswith("page-")
            and a.get("mime")
            and a.get("dataBase64")
        ]
        if pages:
            return pages, page_count or len(pages)
    return [], 0


def _render_pdf_pages_via_qlmanage(raw: bytes) -> tuple[list[dict[str, Any]], int]:
    """macOS fallback: Quick Look thumbnail of page 1."""
    ql = shutil.which("qlmanage")
    if not ql:
        return [], 0
    import tempfile

    try:
        with tempfile.TemporaryDirectory(prefix="crm-pdf-page-") as td:
            pdf_path = os.path.join(td, "sample.pdf")
            with open(pdf_path, "wb") as fh:
                fh.write(raw)
            proc = subprocess.run(
                [ql, "-t", "-s", "2000", "-o", td, pdf_path],
                capture_output=True,
                timeout=60,
                check=False,
            )
            if proc.returncode not in (0, None) and not any(
                name.endswith(".png") for name in os.listdir(td)
            ):
                return [], 0
            pngs = sorted(
                os.path.join(td, name)
                for name in os.listdir(td)
                if name.lower().endswith(".png")
            )
            out: list[dict[str, Any]] = []
            for i, path in enumerate(pngs[:20]):
                with open(path, "rb") as fh:
                    data = fh.read()
                if not data or len(data) > 2_500_000:
                    continue
                b64 = base64.b64encode(data).decode("ascii")
                if len(b64) > 3_200_000:
                    continue
                out.append(
                    {
                        "id": f"page-{i + 1}",
                        "kind": "image",
                        "mime": "image/png",
                        "dataBase64": b64,
                    }
                )
            return out, len(out)
    except (OSError, subprocess.SubprocessError, TimeoutError):
        return [], 0


# Real text spans / vector shapes / images positioned at exact PDF coordinates,
# converted to percentage-of-page units so the reproduction scales fluidly in
# any container (screen preview or print) while staying pixel-faithful to the
# source. Adapted from the pdf2template_v4 extraction approach: reconstruct the
# document from its real internals instead of flattening it to a raster image.
_PDF_ELEMENT_RENDER_SCRIPT = r"""
import base64, json, sys
try:
    import fitz
except Exception:
    sys.exit(2)

MAX_PAGES = 20
MAX_IMAGE_B64 = 1_500_000


def _shrink_image(data, ext, max_b64=950_000):
    enc = base64.b64encode(data).decode("ascii")
    if len(enc) <= max_b64:
        return data, ext
    try:
        ft = ext if ext in ("png", "jpeg", "jpg", "gif", "bmp", "tif", "tiff") else "png"
        img = fitz.open(stream=data, filetype=ft)
        pix = fitz.Pixmap(img, 0)
        img.close()
        if pix.n >= 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        base = pix
        for scale in (0.85, 0.7, 0.55, 0.4, 0.3):
            mat = fitz.Matrix(scale, scale)
            spix = fitz.Pixmap(base, mat) if scale < 1.0 else base
            for q in (85, 75, 65, 55, 45):
                jpg = spix.tobytes("jpeg", jpg_quality=q)
                if len(base64.b64encode(jpg)) <= max_b64:
                    return jpg, "jpeg"
        jpg = spix.tobytes("jpeg", jpg_quality=40)
        return jpg, "jpeg"
    except Exception:
        return data, ext


def _rgb_int_to_hex(color_int):
    if color_int is None:
        return "#000000"
    r = (color_int >> 16) & 255
    g = (color_int >> 8) & 255
    b = color_int & 255
    return f"#{r:02x}{g:02x}{b:02x}"


def _color_tuple_to_int(rgb_tuple):
    if not rgb_tuple:
        return None
    r, g, b = [max(0, min(255, int(round(c * 255)))) for c in rgb_tuple]
    return (r << 16) + (g << 8) + b


def _esc(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _pct(value, denom):
    if not denom:
        return 0.0
    return round(max(0.0, value) / denom * 100, 4)


def render_page(page, page_index, pw, ph, img_id_prefix):
    # Returns (html, images, needs_raster_fallback).
    images = []
    needs_fallback = False
    html_parts = []

    # Shapes first (backgrounds/borders), then images, then text on top.
    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []
    for d in drawings:
        stroke_color = d.get("color")
        fill_color = d.get("fill")
        width = d.get("width") or 1.0
        for item in d.get("items", []):
            op = item[0]
            if op == "re":
                rect = item[1]
                left = _pct(rect.x0, pw)
                top = _pct(rect.y0, ph)
                w = _pct(rect.width, pw)
                h = _pct(rect.height, ph)
                border = _rgb_int_to_hex(_color_tuple_to_int(stroke_color)) if stroke_color else "#000000"
                style = f"left:{left}%;top:{top}%;width:{w}%;height:{h}%;border:{width}px solid {border};"
                if fill_color:
                    style += f"background-color:{_rgb_int_to_hex(_color_tuple_to_int(fill_color))};"
                html_parts.append(f'<div class="pdf-shape pdf-rect" style="{style}"></div>')
            elif op == "l":
                p1, p2 = item[1], item[2]
                x0, y0 = min(p1.x, p2.x), min(p1.y, p2.y)
                w = abs(p2.x - p1.x) or width
                h = abs(p2.y - p1.y) or width
                border = _rgb_int_to_hex(_color_tuple_to_int(stroke_color)) if stroke_color else "#000000"
                # Tall thin segments are vertical column rules — border-top only
                # paints a speck; use border-left so the stroke actually shows.
                stroke = (
                    f"border-left:{width}px solid {border};"
                    if h > w * 2
                    else f"border-top:{width}px solid {border};"
                )
                style = (
                    f"left:{_pct(x0, pw)}%;top:{_pct(y0, ph)}%;"
                    f"width:{_pct(w, pw)}%;height:{_pct(h, ph)}%;"
                    f"{stroke}"
                )
                html_parts.append(f'<div class="pdf-shape pdf-line" style="{style}"></div>')

    # get_image_info sees placed image regions even for inline images (xref=0)
    # that get_images() misses entirely — use it as the ground truth for how
    # many image regions this page actually has.
    try:
        info_list = page.get_image_info(xrefs=True)
    except Exception:
        info_list = []
    try:
        text_dict = page.get_text("dict")
    except Exception:
        text_dict = {"blocks": []}
    inline_blocks = [b for b in text_dict.get("blocks", []) if b.get("type") == 1]

    def _bbox_close(a, b, tol=2.0):
        return all(abs(a[i] - b[i]) <= tol for i in range(4))

    placed = 0
    for idx, info in enumerate(info_list):
        bbox = info.get("bbox")
        if not bbox:
            continue
        x0, y0, x1, y1 = bbox
        xref = info.get("xref") or 0
        data = None
        ext = "png"
        if xref:
            try:
                base_image = page.parent.extract_image(xref)
                data = base_image.get("image")
                ext = base_image.get("ext", "png")
            except Exception:
                data = None
        if not data:
            # Inline (BI/EI) image or a Form-XObject-nested image with no
            # resolvable xref — get_text("dict") still surfaces its raw bytes.
            for b in inline_blocks:
                if _bbox_close(b.get("bbox") or (0, 0, 0, 0), bbox):
                    data = b.get("image")
                    ext = b.get("ext", ext)
                    break
        if not data:
            continue
        data, ext = _shrink_image(data, ext)
        b64 = base64.b64encode(data).decode("ascii")
        if len(b64) > MAX_IMAGE_B64:
            data, ext = _shrink_image(data, ext, max_b64=700_000)
            b64 = base64.b64encode(data).decode("ascii")
        if len(b64) > MAX_IMAGE_B64:
            needs_fallback = True
            continue
        img_id = f"{img_id_prefix}-{idx}"
        mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
        images.append({"id": img_id, "mime": mime, "dataBase64": b64})
        style = (
            f"left:{_pct(x0, pw)}%;top:{_pct(y0, ph)}%;"
            f"width:{_pct(x1 - x0, pw)}%;height:{_pct(y1 - y0, ph)}%;"
        )
        html_parts.append(f'<img class="pdf-image" src="asset:{img_id}" style="{style}" alt=""/>')
        placed += 1

    if placed < len(info_list):
        # Some images (nested Form XObjects, unrecognized masks, etc.) could
        # not be placed — never silently drop visual content; the caller
        # rasterizes this page instead.
        needs_fallback = True

    try:
        raw_text = page.get_text("dict")
    except Exception:
        raw_text = {"blocks": []}
    for block in raw_text.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text.strip():
                    continue
                x0, y0, x1, y1 = span["bbox"]
                font_name = span.get("font", "")
                flags = span.get("flags", 0)
                is_bold = bool(flags & 2 ** 4) or "bold" in font_name.lower()
                is_italic = (
                    bool(flags & 2 ** 1)
                    or "italic" in font_name.lower()
                    or "oblique" in font_name.lower()
                )
                size_pct = _pct(span.get("size", 12.0), pw)
                box_h = max(float(y1) - float(y0), float(span.get("size", 12.0)) * 1.15)
                style = (
                    f"left:{_pct(x0, pw)}%;top:{_pct(y0, ph)}%;"
                    f"width:{_pct(x1 - x0, pw)}%;max-width:{_pct(x1 - x0, pw)}%;"
                    f"height:{_pct(box_h, ph)}%;"
                    f"font-size:{size_pct}cqw;"
                    f"color:{_rgb_int_to_hex(span.get('color'))};"
                    f"font-weight:{'bold' if is_bold else 'normal'};"
                    f"font-style:{'italic' if is_italic else 'normal'};"
                )
                html_parts.append(f'<span class="pdf-text" style="{style}">{_esc(text)}</span>')

    return "".join(html_parts), images, needs_fallback


raw = sys.stdin.buffer.read()
doc = fitz.open(stream=raw, filetype="pdf")
page_count = int(doc.page_count)
out_pages = []
for i in range(min(page_count, MAX_PAGES)):
    page = doc.load_page(i)
    rect = page.rect
    pw, ph = rect.width, rect.height
    try:
        html, images, needs_fallback = render_page(page, i, pw, ph, f"pimg-{i + 1}")
    except Exception:
        html, images, needs_fallback = "", [], True
    out_pages.append(
        {
            "index": i,
            "width": round(pw, 2),
            "height": round(ph, 2),
            "html": html,
            "images": images,
            "needsRasterFallback": needs_fallback,
        }
    )
doc.close()
print(json.dumps({"pages": out_pages, "pageCount": page_count}, separators=(",", ":")))
"""


def _vector_page_has_editable_text(page: dict[str, Any]) -> bool:
    """True when positioned pdf-text spans were extracted (personalizable)."""
    html = str(page.get("html") or "")
    return "pdf-text" in html and bool(html.strip())


def _use_raster_page_instead_of_vector(page: dict[str, Any]) -> bool:
    """Rasterize only when vector HTML has no editable text layers."""
    if _vector_page_has_editable_text(page):
        return False
    html = str(page.get("html") or "").strip()
    if not html:
        return True
    return bool(page.get("needsRasterFallback"))


def _render_pdf_pages_vector_inprocess(
    raw: bytes,
) -> tuple[list[dict[str, Any]], int]:
    """Vector page clone in the uvicorn process (Docker has pymupdf here)."""
    from app.pdf_page_vector import render_vector_pages

    return render_vector_pages(raw)


def _render_pdf_pages_vector(raw: bytes) -> tuple[list[dict[str, Any]], int]:
    """Real text/shape/image reconstruction — in-process fitz first, then subprocess."""
    pages, page_count = _render_pdf_pages_vector_inprocess(raw)
    if pages:
        return pages, page_count

    last_stderr = ""
    for py in _fitz_python_candidates():
        try:
            proc = subprocess.run(
                [py, "-c", _PDF_ELEMENT_RENDER_SCRIPT],
                input=raw,
                capture_output=True,
                timeout=180,
                check=False,
            )
        except (OSError, subprocess.SubprocessError, TimeoutError):
            continue
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="ignore").strip()
            if err:
                last_stderr = err[:240]
            continue
        try:
            payload = json.loads(proc.stdout.decode("utf-8", errors="ignore") or "{}")
        except json.JSONDecodeError:
            continue
        pages_raw = payload.get("pages") if isinstance(payload, dict) else None
        if not isinstance(pages_raw, list):
            continue
        try:
            page_count = int(payload.get("pageCount") or 0)
        except (TypeError, ValueError):
            page_count = 0
        pages = [p for p in pages_raw if isinstance(p, dict) and "index" in p]
        if pages:
            return pages, page_count or len(pages)
    if last_stderr:
        logger.warning("vector PDF subprocess failed: %s", last_stderr)
    return [], 0


def _render_pdf_page_assets(raw: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    """Exact visual clone: real positioned text/shapes/images per page, falling
    back to a full-page raster only for pages where an image (e.g. nested in a
    Form XObject) could not be placed — never a blank/missing region."""
    warnings: list[str] = []
    vector_pages, vector_page_count = _render_pdf_pages_vector(raw)

    fallback_indexes = {
        p["index"] for p in vector_pages if _use_raster_page_instead_of_vector(p)
    }
    editable_vector_pages = sum(
        1 for p in vector_pages if _vector_page_has_editable_text(p)
    )
    # Vector extraction produced nothing usable at all — raster every page.
    all_fallback = not vector_pages or (
        len(fallback_indexes) == len(vector_pages) and editable_vector_pages == 0
    )

    raster_pages: list[dict[str, Any]] = []
    raster_page_count = 0
    if all_fallback or fallback_indexes:
        raster_pages, raster_page_count = _render_pdf_pages_via_fitz(raw)
        if not raster_pages:
            raster_pages, raster_page_count = _render_pdf_pages_via_qlmanage(raw)
    raster_by_index = {}
    for a in raster_pages:
        try:
            idx = int(str(a.get("id") or "").split("-", 1)[1]) - 1
        except (IndexError, ValueError):
            continue
        raster_by_index[idx] = a

    if all_fallback:
        if not raster_pages:
            warnings.append(
                "Could not rasterize PDF pages for exact clone. "
                "Ensure the file is not password-protected and try again."
            )
            return [], warnings
        if not vector_pages:
            warnings.append(
                "Vector PDF text extraction returned no editable layers; "
                "stored page images only. Rebuild ai-orchestrator and re-run backfill --force."
            )
        if raster_page_count > len(raster_pages):
            warnings.append(
                f"Template has {raster_page_count} pages; only the first "
                f"{len(raster_pages)} are supported (max 20)."
            )
        warnings.append(
            f"Exact page clone: stored {len(raster_pages)} page image(s) from the uploaded PDF."
        )
        return raster_pages, warnings

    assets: list[dict[str, Any]] = []
    vector_count = 0
    for p in sorted(vector_pages, key=lambda x: x["index"]):
        idx = p["index"]
        page_id = f"page-{idx + 1}"
        if idx in fallback_indexes:
            raster_asset = raster_by_index.get(idx)
            if raster_asset:
                assets.append(raster_asset)
            continue
        vector_count += 1
        assets.append(
            {
                "id": page_id,
                "kind": "page-meta",
                "pageHtml": p.get("html") or "",
                "pageWidth": p.get("width"),
                "pageHeight": p.get("height"),
            }
        )
        for img in p.get("images") or []:
            if (
                isinstance(img, dict)
                and img.get("id")
                and img.get("mime")
                and img.get("dataBase64")
            ):
                assets.append(
                    {"id": str(img["id"]), "kind": "image", **{k: img[k] for k in ("mime", "dataBase64")}}
                )

    total_pages = vector_page_count or len(vector_pages)
    if total_pages > len(vector_pages):
        warnings.append(
            f"Template has {total_pages} pages; only the first {len(vector_pages)} "
            f"are supported (max 20)."
        )
    if fallback_indexes:
        warnings.append(
            f"Exact page clone: {vector_count} page(s) reproduced from real text/"
            f"images, {len(fallback_indexes)} page(s) used a page image fallback."
        )
    else:
        warnings.append(
            f"Exact page clone: reproduced {vector_count} page(s) from the uploaded "
            f"PDF's real text, images, and layout."
        )
    return assets, warnings


def _page_ids_from_assets(assets: list[dict[str, Any]]) -> list[str]:
    ids = [
        str(a.get("id") or "")
        for a in assets
        if isinstance(a, dict) and str(a.get("id") or "").startswith("page-")
    ]

    def _page_num(pid: str) -> int:
        try:
            return int(pid.split("-", 1)[1])
        except (IndexError, ValueError):
            return 0

    return sorted(ids, key=_page_num)


def _page_clone_blueprint(
    page_ids: list[str],
    sections: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    sample_text: str = "",
    kind: str = "invoice",
) -> dict[str, Any]:
    """Exact visual: real positioned text/shapes/images reproduced per page
    (falling back to a full-page image only where a page's images could not
    be placed). Invoice may keep a mergeable fillHtml; proposal/quote stay
    exact clones only (no redesigned fill layout)."""
    asset_by_id = {
        str(a.get("id") or ""): a for a in assets if isinstance(a, dict)
    }
    page_blocks: list[str] = []
    for pid in page_ids:
        asset = asset_by_id.get(pid) or {}
        page_html = asset.get("pageHtml")
        if isinstance(page_html, str) and page_html.strip():
            pw = asset.get("pageWidth") or 1
            ph = asset.get("pageHeight") or 1
            ratio = round((float(ph) / float(pw)) * 100, 4) if pw else 100
            page_blocks.append(
                f'<div class="bp-page-clone bp-page-clone-vector" '
                f'style="padding-top:{ratio}%;">'
                f'<div class="pdf-page-abs">{page_html}</div></div>'
            )
        else:
            page_blocks.append(
                f'<div class="bp-page-clone">'
                f'<img class="bp-page-img" src="asset:{pid}" alt="Sample page"/></div>'
            )
    imgs = "".join(page_blocks)
    slots = [
        {
            "key": str(s.get("key") or f"s{i}"),
            "label": str(s.get("title") or "Section"),
        }
        for i, s in enumerate(sections)
    ]
    theme = {
        "primary": "#111111",
        "secondary": "#64748b",
        "fonts": "Arial, 'Helvetica Neue', Helvetica, sans-serif",
        "background": "#ffffff",
    }
    fill_html = ""
    fill_css = ""
    # Uploaded pages are the template. Do not attach the stock invoice
    # letterhead as a fill layout — that is the default design.
    return {
        "version": 1,
        "mode": "page-clone",
        "chrome": False,
        "html": f'<div class="bp-page-clone-root">{imgs}</div>',
        "css": (
            ".proposal-blueprint .bp-page-clone-root{margin:0;padding:0;background:#fff;}"
            ".proposal-blueprint .bp-page-clone{margin:0;padding:0;page-break-after:always;"
            "break-after:page;}"
            ".proposal-blueprint .bp-page-clone:last-child{page-break-after:auto;break-after:auto;}"
            ".proposal-blueprint .bp-page-img{display:block;width:100%;height:auto;margin:0;"
            "padding:0;border:0;}"
            # Vector-cloned pages: a padding-top aspect box keeps the page's exact
            # width/height ratio while scaling fluidly to any container width.
            # Container query units (cqw) let font-size scale with that same width.
            ".proposal-blueprint .bp-page-clone-vector{position:relative;width:100%;"
            "container-type:inline-size;overflow:hidden;background:#fff;}"
            ".proposal-blueprint .pdf-page-abs{position:absolute;inset:0;overflow:hidden;}"
            ".proposal-blueprint .pdf-text{position:absolute;white-space:pre;line-height:1;"
            "overflow:hidden;box-sizing:border-box;"
            "font-family:Arial,Helvetica,sans-serif;}"
            ".proposal-blueprint .pdf-image{position:absolute;object-fit:contain;}"
            ".proposal-blueprint .pdf-shape{position:absolute;}"
        ),
        "fillHtml": fill_html,
        "fillCss": fill_css,
        "theme": theme,
        "slots": slots,
    }


def _extract_pdf_assets(raw: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    """Pull exact page renders + logo / hero / footer embeds from a sample PDF."""
    warnings: list[str] = []
    pages, pw = _render_pdf_page_assets(raw)
    warnings.extend(pw)
    embeds = _extract_pdf_assets_via_external_python(raw)
    # Prefer page clone; keep logo only when pages are raster-only (vector clones
    # already embed header images as pimg-* on each page).
    assets: list[dict[str, Any]] = list(pages)
    has_vector_clone = any(
        isinstance(a, dict) and str(a.get("pageHtml") or "").strip() for a in pages
    )
    for a in embeds:
        if not isinstance(a, dict):
            continue
        aid = str(a.get("id") or "").lower()
        if aid == "logo" and not has_vector_clone and not any(
            str(x.get("id") or "").lower() == "logo" for x in assets
        ):
            assets.append(a)
    if embeds and not pages:
        warnings.append(
            "Matched sample branding images (logo / cover / footer) into the template layout."
        )
    elif not embeds and not pages:
        warnings.append(
            "Could not extract images from this PDF; layout will use colors from the text sample."
        )
    return assets, warnings


def _user_facing_warnings(warnings: list[str]) -> list[str]:
    """Drop infra noise (venv / pyexpat) from admin-visible messages."""
    out: list[str] = []
    for w in warnings:
        low = w.lower()
        if "venv pypdf" in low or (
            "system python" in low and "extracted via" in low
        ):
            continue
        if "pyexpat" in low:
            continue
        out.append(w)
    return out


def _allowed_tokens(kind: str) -> set[str]:
    if kind == "quote":
        return set(QUOTE_TOKENS)
    if kind == "invoice":
        return set(INVOICE_TOKENS)
    return set(PROPOSAL_TOKENS)


def _preferred_keys(kind: str) -> tuple[str, ...]:
    if kind == "quote":
        return QUOTE_KEYS
    if kind == "invoice":
        return INVOICE_KEYS
    return PROPOSAL_KEYS


def _normalize_plain_text(value: str) -> str:
    """Decode escaped \\n / markdown noise into human-readable plain text."""
    out = value or ""
    for _ in range(4):
        if "\\n" not in out and "\\t" not in out and "\\r" not in out:
            break
        out = (
            out.replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\r", "\n")
        )
    out = out.replace("\r\n", "\n").replace("\r", "\n")
    # Soften markdown to plain text (renderer also handles leftovers)
    out = re.sub(r"\*\*([^*]+)\*\*", r"\1", out)
    out = re.sub(r"__([^_]+)__", r"\1", out)
    out = re.sub(r"`([^`]+)`", r"\1", out)
    out = re.sub(r"^#{1,6}\s+", "", out, flags=re.M)
    out = out.replace("**", "").replace("__", "")
    return out.strip()


def _sanitize_body(body: str, allowed: set[str]) -> tuple[str, list[str]]:
    warnings: list[str] = []
    out = _normalize_plain_text(body or "")
    # Convert raw HTML images to markdown so the CRM renderer can show them.
    def _img_to_md(match: re.Match[str]) -> str:
        src = match.group(1)
        alt_m = re.search(r'\balt=["\']([^"\']*)["\']', match.group(0), re.I)
        alt = alt_m.group(1) if alt_m else ""
        return f"![{alt}]({src})"

    out = re.sub(
        r'<img\b[^>]*\bsrc=["\'](asset:[a-z0-9_-]+|data:image/[^"\']+|https?://[^"\'>\s]+)["\'][^>]*/?>',
        _img_to_md,
        out,
        flags=re.I,
    )
    for match in TOKEN_RE.findall(out):
        if match not in allowed:
            warnings.append(f"Removed unknown token {match}")
            out = out.replace(match, "")
    return out.strip(), warnings


def _normalize_sections(
    raw: list[Any],
    kind: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    allowed = _allowed_tokens(kind)
    preferred = _preferred_keys(kind)
    warnings: list[str] = []
    sections: list[dict[str, Any]] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        body_raw = str(item.get("body") or "")
        body, body_warns = _sanitize_body(body_raw, allowed)
        warnings.extend(body_warns)
        if not title and not body:
            continue
        key_in = str(item.get("key") or "").strip()
        key = key_in or (
            preferred[idx] if idx < len(preferred) else _slug(title, f"section_{idx + 1}")
        )
        sort_order = item.get("sortOrder")
        try:
            sort_order = int(sort_order)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            sort_order = idx + 1
        if sort_order < 1:
            sort_order = idx + 1
        sec_id = str(item.get("id") or "").strip() or f"sec-{idx + 1}"
        sections.append(
            {
                "id": sec_id,
                "key": key[:64],
                "title": title or f"Section {idx + 1}",
                "body": body,
                "sortOrder": sort_order,
            }
        )
    sections.sort(key=lambda s: s["sortOrder"])
    for i, sec in enumerate(sections):
        sec["sortOrder"] = i + 1
    return sections, warnings


def _default_sections(kind: str) -> list[dict[str, Any]]:
    if kind == "invoice":
        return [
            {
                "id": "sec-intro",
                "key": "introduction",
                "title": "Introduction",
                "body": (
                    "Dear {{customerName}},\n\nPlease find invoice {{invoiceNumber}} "
                    "issued by {{vendorName}} for {{companyName}}.\n\n"
                    "Issue date: {{date}}\nDue date: {{dueDate}}\n"
                    "Payment terms: {{paymentTerms}}"
                ),
                "sortOrder": 1,
            },
            {
                "id": "sec-line-items",
                "key": "line_items",
                "title": "Line items",
                "body": "Line items appear here when the invoice is generated.",
                "sortOrder": 2,
            },
            {
                "id": "sec-tax",
                "key": "tax",
                "title": "Tax",
                "body": (
                    "Tax amount: {{currency}} {{taxAmount}}\nTax ID: {{taxId}}\n\n"
                    "Replace with {{vendorName}} tax language."
                ),
                "sortOrder": 3,
            },
            {
                "id": "sec-payment",
                "key": "payment",
                "title": "Payment",
                "body": (
                    "Please remit {{currency}} {{total}} by {{dueDate}}.\n\n"
                    "Billing address:\n{{billingAddress}}\n\n"
                    "Payment terms: {{paymentTerms}}"
                ),
                "sortOrder": 4,
            },
            {
                "id": "sec-footer",
                "key": "footer",
                "title": "Footer",
                "body": (
                    "Computer-generated invoice from {{vendorName}}; "
                    "signature not required."
                ),
                "sortOrder": 5,
            },
        ]
    if kind == "quote":
        return [
            {
                "id": "sec-intro",
                "key": "introduction",
                "title": "Introduction",
                "body": (
                    "Dear {{customerName}},\n\nPlease find quotation {{quoteNumber}} "
                    "for {{dealTitle}} on behalf of {{companyName}}.\n\nIssued by "
                    "{{vendorName}}. Valid until {{validUntil}}."
                ),
                "sortOrder": 1,
            },
            {
                "id": "sec-tax-note",
                "key": "tax_note",
                "title": "Taxes",
                "body": (
                    "Prices are exclusive of applicable taxes unless stated otherwise. "
                    "Replace with {{vendorName}} tax language."
                ),
                "sortOrder": 2,
            },
            {
                "id": "sec-bank",
                "key": "bank",
                "title": "Bank details",
                "body": (
                    "Account name: [Legal entity]\nBank: [Bank]\nAccount number: [Number]\n"
                    "IFSC / IBAN: [Code]\n\nReplace with {{vendorName}} payment details."
                ),
                "sortOrder": 3,
            },
            {
                "id": "sec-terms",
                "key": "terms",
                "title": "Terms & conditions",
                "body": (
                    "1. Prices subject to applicable taxes.\n"
                    "2. Valid until {{validUntil}}.\n"
                    "3. Scope limited to listed line items.\n"
                    "4. Payment and delivery terms below apply unless agreed otherwise."
                ),
                "sortOrder": 4,
            },
            {
                "id": "sec-payment",
                "key": "payment_terms",
                "title": "Payment terms",
                "body": "Due within [7 / 15 / 30] days of acceptance, or as agreed on the PO.",
                "sortOrder": 5,
            },
            {
                "id": "sec-delivery",
                "key": "delivery",
                "title": "Delivery timeline",
                "body": "Delivery / service start confirmed after acceptance.",
                "sortOrder": 6,
            },
            {
                "id": "sec-footer",
                "key": "footer",
                "title": "Footer",
                "body": (
                    "Computer-generated quotation from {{vendorName}}; "
                    "signature not required."
                ),
                "sortOrder": 7,
            },
        ]
    return [
        {
            "id": "sec-intro",
            "key": "introduction",
            "title": "1. Introduction",
            "body": (
                "We are pleased to submit this proposal for {{customerName}} "
                "({{companyName}}).\n\nThis proposal relates to {{dealTitle}}."
            ),
            "sortOrder": 1,
        },
        {
            "id": "sec-features",
            "key": "features",
            "title": "2. Key Product Features",
            "body": "Describe products and capabilities relevant to this customer.",
            "sortOrder": 2,
        },
        {
            "id": "sec-scope",
            "key": "scope",
            "title": "3. Scope of Work",
            "body": (
                "Following discussions with {{customerName}}, this proposal covers "
                "the agreed scope. Items not listed are out of scope."
            ),
            "sortOrder": 3,
        },
        {
            "id": "sec-plan",
            "key": "plan_of_action",
            "title": "3.1 Plan of Action",
            "body": (
                "| Activity | Responsibility | Target |\n"
                "| --- | --- | --- |\n"
                "| Kick-off | {{vendorName}} / {{customerName}} | Week 1 |\n"
                "| Configuration | {{vendorName}} | Week 2–3 |\n"
                "| UAT / Go-live | Joint | Week 4 |"
            ),
            "sortOrder": 4,
        },
        {
            "id": "sec-commercials",
            "key": "commercials",
            "title": "4. Commercials",
            "body": (
                "Summarize commercial terms or link to the CRM quote. "
                "Validity from {{date}}."
            ),
            "sortOrder": 5,
        },
        {
            "id": "sec-onboarding",
            "key": "onboarding",
            "title": "5. Onboarding Process",
            "body": (
                "Typical onboarding for {{customerName}} vs {{vendorName}} "
                "(edit responsibilities)."
            ),
            "sortOrder": 6,
        },
        {
            "id": "sec-implementation",
            "key": "implementation",
            "title": "6. Implementation",
            "body": "Outline implementation phases and milestones.",
            "sortOrder": 7,
        },
        {
            "id": "sec-support",
            "key": "support",
            "title": "7. Support",
            "body": "Describe support hours, SLAs, and escalation for {{vendorName}}.",
            "sortOrder": 8,
        },
        {
            "id": "sec-conclusion",
            "key": "conclusion",
            "title": "8. Conclusion",
            "body": (
                "We look forward to partnering with {{customerName}}. "
                "Contact {{vendorName}} with questions."
            ),
            "sortOrder": 9,
        },
    ]


def _extract_pdf_text_lightweight(raw: bytes) -> str:
    """Best-effort PDF text without pypdf (literal strings + common Tj/TJ ops)."""
    # Prefer latin-1 so binary PDF bytes always decode.
    data = raw.decode("latin-1", errors="ignore")
    chunks: list[str] = []

    # (literal) Tj  or  [(parts)] TJ
    for m in re.finditer(r"\((?:\\.|[^\\)])*\)\s*Tj", data):
        s = m.group(0)
        inner = s[1 : s.rfind(")")]
        inner = (
            inner.replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace("\\(", "(")
            .replace("\\)", ")")
            .replace("\\\\", "\\")
        )
        if inner.strip():
            chunks.append(inner)

    for m in re.finditer(r"\[(.*?)\]\s*TJ", data, re.S):
        for sm in re.finditer(r"\((?:\\.|[^\\)])*\)", m.group(1)):
            inner = sm.group(0)[1:-1]
            inner = (
                inner.replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t")
                .replace("\\(", "(")
                .replace("\\)", ")")
                .replace("\\\\", "\\")
            )
            if inner.strip():
                chunks.append(inner)

    text = "\n".join(chunks)
    # Drop control-heavy noise
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return text.strip()


def _fitz_python_candidates() -> list[str]:
    """Interpreters for PyMuPDF (fitz) page-clone scripts.

    Production Docker installs pymupdf into the running interpreter; macOS dev
    often has fitz only on /usr/bin/python3. Try current first, then fallbacks.
    """
    ordered: list[str] = []
    seen: set[str] = set()

    def _add(path: str) -> None:
        if not path:
            return
        try:
            real = os.path.realpath(path)
        except OSError:
            return
        if real in seen:
            return
        seen.add(real)
        ordered.append(path)

    _add(os.sys.executable)
    _add((os.environ.get("PDF_EXTRACT_PYTHON") or "").strip())
    for path in (
        "/usr/bin/python3",
        shutil.which("python3.11") or "",
        shutil.which("python3.12") or "",
        shutil.which("python3.9") or "",
        shutil.which("python3") or "",
    ):
        _add(path)
    return ordered


def _pdf_extract_python_candidates() -> list[str]:
    """Prefer a working system Python when the AI venv cannot import pypdf."""
    ordered: list[str] = []
    env = (os.environ.get("PDF_EXTRACT_PYTHON") or "").strip()
    if env:
        ordered.append(env)
    for path in (
        "/usr/bin/python3",
        shutil.which("python3.9") or "",
        shutil.which("python3.11") or "",
        shutil.which("python3.12") or "",
        shutil.which("python3") or "",
    ):
        if path and path not in ordered:
            ordered.append(path)
    # Skip the current interpreter — pypdf text extraction already failed here.
    current = os.path.realpath(os.sys.executable)
    return [p for p in ordered if os.path.realpath(p) != current]


_PDF_EXTRACT_SCRIPT = r"""
import sys
from io import BytesIO
try:
    from pypdf import PdfReader
except Exception:
    sys.exit(2)
raw = sys.stdin.buffer.read()
reader = PdfReader(BytesIO(raw))
parts = []
for page in reader.pages[:40]:
    parts.append(page.extract_text() or "")
sys.stdout.write("\n".join(parts))
"""


def _extract_pdf_via_external_python(raw: bytes) -> str:
    """Run pypdf in another Python (macOS /usr/bin/python3 often works when 3.14 venv does not)."""
    for py in _pdf_extract_python_candidates():
        try:
            proc = subprocess.run(
                [py, "-c", _PDF_EXTRACT_SCRIPT],
                input=raw,
                capture_output=True,
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.SubprocessError, TimeoutError):
            continue
        if proc.returncode != 0:
            continue
        text = proc.stdout.decode("utf-8", errors="ignore").strip()
        if text:
            return text
    return ""


def _extract_pdf_text(raw: bytes) -> tuple[str, list[str]]:
    """Extract PDF text with pypdf, then external Python, then lightweight fallback."""
    warnings: list[str] = []
    text = ""
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(io.BytesIO(raw))
        parts: list[str] = []
        for page in reader.pages[:40]:
            parts.append(page.extract_text() or "")
        text = "\n".join(parts).strip()
    except Exception:  # noqa: BLE001 — ImportError or broken pyexpat on some Pythons
        text = ""

    if not text:
        text = _extract_pdf_via_external_python(raw)
        if text:
            warnings.append(
                "PDF text extracted via system Python (venv pypdf unavailable)."
            )

    if not text:
        text = _extract_pdf_text_lightweight(raw)
        if text:
            warnings.append(
                "Used basic PDF text extraction; review the draft carefully."
            )

    if not text:
        warnings.append(
            "Could not read text from this PDF. Try DOCX/TXT, or describe the template."
        )
        return "", warnings

    if not warnings and len(text) < 40:
        warnings.append("PDF had little extractable text (may be scanned).")
    return text, warnings


def extract_sample_text_from_file(
    filename: str,
    content_base64: str,
) -> tuple[str, list[str]]:
    """Extract plain text from TXT / MD / CSV / PDF / DOCX uploads."""
    warnings: list[str] = []
    name = (filename or "sample.txt").lower()
    try:
        raw = base64.b64decode(content_base64, validate=False)
    except Exception:
        return "", ["Could not decode uploaded file."]

    if name.endswith(".txt") or name.endswith(".md") or name.endswith(".csv"):
        for enc in ("utf-8", "utf-16", "latin-1"):
            try:
                return raw.decode(enc), warnings
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="ignore"), warnings

    if name.endswith(".pdf"):
        return _extract_pdf_text(raw)

    if name.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                xml = zf.read("word/document.xml")
            root = ET.fromstring(xml)
            texts = [
                (node.text or "")
                for node in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
            ]
            if not texts:
                texts = [n.text or "" for n in root.iter() if n.text]
            return "\n".join(t for t in texts if t.strip()), warnings
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"DOCX extract failed: {exc}")
            return "", warnings

    warnings.append("Unsupported file type; use PDF, Word (.docx), or text (.txt/.md).")
    return "", warnings


def _render_docx_page_assets(
    content_base64: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Convert DOCX → PDF → page images when LibreOffice/soffice is available."""
    warnings: list[str] = []
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return [], warnings
    try:
        raw = base64.b64decode(content_base64, validate=False)
    except Exception:  # noqa: BLE001
        return [], ["Could not decode DOCX for page clone."]
    if not raw or len(raw) > 8_000_000:
        return [], warnings
    import tempfile

    try:
        with tempfile.TemporaryDirectory() as td:
            docx_path = os.path.join(td, "sample.docx")
            pdf_path = os.path.join(td, "sample.pdf")
            with open(docx_path, "wb") as f:
                f.write(raw)
            subprocess.run(
                [
                    soffice,
                    "--headless",
                    "--nologo",
                    "--nolockcheck",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    td,
                    docx_path,
                ],
                check=False,
                capture_output=True,
                timeout=90,
            )
            if not os.path.isfile(pdf_path):
                return [], warnings
            with open(pdf_path, "rb") as f:
                pdf_raw = f.read()
            pages, pw = _render_pdf_page_assets(pdf_raw)
            warnings.extend(pw)
            if pages:
                warnings.append(
                    f"Exact page clone: rendered {len(pages)} page(s) from DOCX."
                )
            return pages, warnings
    except (OSError, subprocess.SubprocessError, TimeoutError) as exc:
        warnings.append(f"DOCX page render unavailable: {exc}")
        return [], warnings


def _trim_sheet(rows: list[list[str]]) -> list[list[str]]:
    """Drop columns that are empty on every row. Keep gaps where a value sits later."""
    if not rows:
        return []
    last = 0
    for row in rows:
        for i, cell in enumerate(row):
            if str(cell or "").strip():
                last = max(last, i)
    width = last + 1
    trimmed: list[list[str]] = []
    for row in rows:
        padded = list(row) + [""] * (width - len(row))
        trimmed.append(padded[:width])
    return trimmed


def _parse_quote_spreadsheet(
    filename: str,
    content_base64: str,
) -> tuple[list[list[str]], list[str]]:
    """Parse CSV/XLS/XLSX into sheet rows. The first row is data, not a header."""
    import csv
    import io

    warnings: list[str] = []
    name = (filename or "sample.bin").lower()
    try:
        raw = base64.b64decode(content_base64, validate=False)
    except Exception:
        return [], ["Could not decode spreadsheet upload."]

    rows: list[list[str]] = []

    if name.endswith(".csv"):
        text = raw.decode("utf-8-sig", errors="replace")
        reader = csv.reader(io.StringIO(text))
        for row in reader:
            cells = [_sheet_cell(c) for c in row]
            rows.append(cells)
            if len(rows) >= 80:
                break
        return _trim_sheet(rows), warnings

    if name.endswith((".xlsx", ".xls")):
        try:
            import openpyxl  # type: ignore
        except ImportError:
            return [], [
                "Excel upload needs openpyxl on the AI service host. Use CSV or upload PDF/DOCX instead.",
            ]
        try:
            wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            sheet = wb.active
            for row in sheet.iter_rows(values_only=True):
                cells = [_sheet_cell(c) for c in row]
                rows.append(cells)
                if len(rows) >= 80:
                    break
        except Exception as exc:  # noqa: BLE001
            return [], [f"Could not read Excel file: {exc}"]
        return _trim_sheet(rows), warnings

    return [], ["Unsupported spreadsheet format."]


def _sheet_cell(value: object) -> str:
    """One spreadsheet cell as a single table cell (keep line breaks inside it)."""
    text = "" if value is None else str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("|", "/")
    lines = [line.strip() for line in text.split("\n")]
    return "‹br›".join(lines).strip("‹br›").strip()


def _gfm_table_from_spreadsheet(rows: list[list[str]]) -> str:
    """Every sheet row is data. A separator row would paint row 1 as a header."""
    if not rows:
        return "_No columns detected._"
    lines: list[str] = []
    width = max(len(r) for r in rows)
    for row in rows:
        padded = list(row) + [""] * (width - len(row))
        lines.append("| " + " | ".join(padded[:width]) + " |")
    return "\n".join(lines)


def _html_escape_cell(value: str) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _html_table_from_spreadsheet(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    body_rows: list[str] = []
    for row in rows:
        padded = list(row) + [""] * (width - len(row))
        cells = "".join(
            f"<td>{_html_escape_cell(c).replace('‹br›', '<br/>')}</td>"
            for c in padded[:width]
        )
        body_rows.append(f"<tr>{cells}</tr>")
    return (
        '<table class="bp-table"><tbody>'
        + "".join(body_rows)
        + "</tbody></table>"
    )


def build_quote_spreadsheet_template(
    filename: str,
    content_base64: str,
) -> dict[str, Any]:
    rows, warnings = _parse_quote_spreadsheet(filename, content_base64)
    if not rows:
        return {"ok": False, "warnings": warnings, "reason": "empty_spreadsheet"}
    table_md = _gfm_table_from_spreadsheet(rows)
    table_html = _html_table_from_spreadsheet(rows)
    sections = [
        {
            "id": "sec-line-items",
            "key": "line_items",
            "title": "Line items",
            "body": table_md,
            "sortOrder": 1,
        }
    ]

    blueprint = {
        "version": 1,
        "mode": "spreadsheet-layout",
        "chrome": False,
        "theme": {
            "primary": "#1e3a5f",
            "secondary": "#64748b",
            "fonts": "Arial, Helvetica, sans-serif",
            "background": "#ffffff",
        },
        "spreadsheetLayout": {
            "columns": rows[0],
            "sampleRowCount": len(rows),
        },
        "slots": [{"key": "line_items", "label": "Line items"}],
        "css": (
            ".proposal-blueprint{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;}"
            ".proposal-blueprint .bp-sheet-title{font-size:1.15rem;margin:0 0 .75rem;color:#1e3a5f;}"
            ".proposal-blueprint table.bp-table{width:100%;border-collapse:collapse;font-size:12px;}"
            ".proposal-blueprint table.bp-table th,.proposal-blueprint table.bp-table td"
            "{border:1px solid #d1d5db;padding:6px 8px;text-align:left;vertical-align:top;}"
            ".proposal-blueprint table.bp-table th{background:#f3f4f6;font-weight:600;}"
        ),
        "html": (
            '<section class="bp-section" data-slot="line_items">'
            '<h2 class="bp-sheet-title" data-slot-title>Line items</h2>'
            f'<div class="bp-body" data-slot-body>{table_html}</div>'
            "</section>"
        ),
    }
    warnings.append(
        "Preview shows the uploaded spreadsheet columns and sample rows. "
        "Upload PDF or DOCX if you need the full letterhead design."
    )
    return {
        "ok": True,
        "sections": sections,
        "blueprint": blueprint,
        "assets": [],
        "warnings": warnings,
    }


def extract_sample_bundle(
    filename: str,
    content_base64: str,
) -> tuple[str, list[dict[str, Any]], list[str]]:
    """Return (text, assets, warnings) from an uploaded sample.

    Exact visual clone requires PDF or DOCX. Images/TXT are rejected.
    """
    warnings: list[str] = []
    name = (filename or "sample.bin").lower()
    assets: list[dict[str, Any]] = []

    if name.endswith((".csv", ".xlsx", ".xls")):
        return ("", [], [])

    if name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".md")):
        return (
            "",
            [],
            ["Sample must be a PDF or Word (.docx) file for exact template cloning."],
        )

    if not name.endswith(".pdf") and not name.endswith(".docx"):
        return (
            "",
            [],
            ["Sample must be a PDF or Word (.docx) file for exact template cloning."],
        )

    text, tw = extract_sample_text_from_file(filename, content_base64)
    warnings.extend(tw)

    if name.endswith(".pdf"):
        try:
            raw = base64.b64decode(content_base64, validate=False)
        except Exception:
            raw = b""
        if raw:
            pdf_assets, aw = _extract_pdf_assets(raw)
            warnings.extend(aw)
            assets.extend(pdf_assets)

    if name.endswith(".docx"):
        page_assets, pw = _render_docx_page_assets(content_base64)
        warnings.extend(pw)
        if page_assets:
            assets.extend(page_assets)
        else:
            warnings.append(
                "Could not rasterize DOCX pages for exact clone. "
                "Install LibreOffice on the AI host, or upload a PDF instead."
            )

    return text, assets, warnings


def _clean_sample_text(raw: str) -> str:
    """Keep newlines so tables/headings stay visible; only normalize spaces."""
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).rstrip() for line in text.split("\n")]
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()[:40_000]


def _system_prompt(kind: str) -> str:
    if kind == "quote":
        tokens = ", ".join(QUOTE_TOKENS)
        keys = ", ".join(QUOTE_KEYS)
        doc = "quotation"
        layout_rules = """- Include a letterhead with title + {{companyName}} / {{customerName}} / {{date}}, and footer with {{vendorName}}.
- Blueprint CSS MUST include page breaks for print/PDF: .bp-cover-page with page-break-after:always; do NOT force page-break-before on every .bp-section.
- Match the sample branding: centered logo letterhead, hero image when present, Word-blue (#365F91) section headings, Arial/Calibri body, footer stripe when asset:footer exists.
- Corporate commercial document — not a SaaS marketing landing page. No heavy card shadows."""
    elif kind == "invoice":
        tokens = ", ".join(INVOICE_TOKENS)
        keys = ", ".join(INVOICE_KEYS)
        doc = "invoice"
        layout_rules = """- Use a commercial invoice letterhead (NOT a proposal cover). No "Submitted to" cover page, no product hero banner, no large empty cover gap, no rainbow proposal footer.
- Letterhead: logo from THIS sample only (asset:logo when extracted), {{vendorName}}, invoice meta ({{invoiceNumber}}, {{date}}, {{dueDate}}, Bill to {{companyName}}).
- Body sections must mirror the uploaded sample order (customer, items, financial summary, bank, terms).
- Forbidden section keys: features, scope, plan_of_action, commercials, onboarding, implementation, support, conclusion.
- Do NOT set min-height on the cover/header and do NOT force page-break-before on every .bp-section.
- Footer text only unless THIS sample extracted asset:footer — never invent a multicolor stripe.
- Match sample invoice branding only — never reuse proposal/quote chrome from other templates."""
    else:
        tokens = ", ".join(PROPOSAL_TOKENS)
        keys = ", ".join(PROPOSAL_KEYS)
        doc = "sales proposal"
        layout_rules = """- Include a cover/letterhead with title + {{companyName}} / {{customerName}} / {{date}}, and footer with {{vendorName}}.
- Blueprint CSS MUST include page breaks for print/PDF: .bp-cover-page with page-break-after:always; do NOT force page-break-before on every .bp-section (short sections like Conclusion should share a page).
- Match the sample PDF/DOCX branding closely: centered logo letterhead, large cover hero image when present, Word-blue (#365F91) section headings, Calibri/Arial body, multicolor footer stripe when asset:footer exists, indigo/violet primary (~#5F62F1) and mint secondary (~#00E79F) when those appear in the sample.
- Corporate Word proposal look — not a SaaS marketing landing page. No heavy card shadows."""
    return f"""You design a branded {doc} document template for a CRM tenant.
Return ONLY valid JSON (no markdown fences) with this shape:
{{
  "sections": [
    {{"id": "sec-1", "key": "introduction", "title": "...", "body": "...", "sortOrder": 1}}
  ],
  "blueprint": {{
    "version": 1,
    "theme": {{"primary": "#hex", "secondary": "#hex", "fonts": "...", "background": "#hex"}},
    "slots": [{{"key": "introduction", "label": "Introduction"}}],
    "css": "CSS for .proposal-blueprint ...",
    "html": "HTML markup using data-slot attributes"
  }}
}}

CLONE FIDELITY (critical):
- Recreate the uploaded sample's visual structure as closely as possible
  (letterhead, columns, tables, spacing, footer). The CRM will later swap only
  merge tokens and product-specific content — layout must stay a clone.
- Do NOT invent a different document genre (e.g. never turn an invoice sample
  into a proposal cover, and never invent a product hero if the sample has none).
- Prefer sample colors, fonts, heading style, and table borders over generic chrome.

Rules:
- Prefer these stable section keys when they fit: {keys}
- Body text must be tenant-agnostic (no real customer names from the sample).
- Section bodies: real newlines for paragraphs, "- " for bullets, numbered lists as "1. ".
  Do NOT use **bold** or ## headings. Do NOT put literal \\n escape sequences in strings.
- When the sample has schedules, pricing, RACI, or other tabular data, emit GFM pipe tables
  in the body, e.g.:
  | Activity | Owner | Date |
  | --- | --- | --- |
  | Kick-off | {{{{vendorName}}}} | Week 1 |
- Preserve Commercials / Terms depth as multi-paragraph text (not a one-liner stub).
- Use ONLY these merge tokens: {tokens}
- Blueprint HTML must wrap content sections as:
  <section class="bp-section" data-slot="KEY"><h2 data-slot-title>...</h2><div class="bp-body" data-slot-body></div></section>
{layout_rules}
- If assets include logo, hero, or footer, reference them as src="asset:logo", src="asset:hero", src="asset:footer".
- Scope CSS under .proposal-blueprint.
- Prefer 5–8 sections for invoices/quotes; 8–12 for dense proposals; each body under ~4500 characters.
"""


async def prepare(state: TemplateState) -> TemplateState:
    kind = (state.get("kind") or "proposal").strip().lower()
    if kind not in ("proposal", "quote", "invoice"):
        kind = "proposal"
    brief = re.sub(r"\s+", " ", (state.get("brief") or "").strip())[:4000]
    sample = _clean_sample_text(state.get("sample_text") or "")
    warnings = list(state.get("warnings") or [])

    # Exact page-clone from an uploaded PDF/DOCX never needs the LLM.
    if _page_ids_from_assets(list(state.get("assets") or [])):
        return {
            **state,
            "kind": kind,
            "cleaned_brief": brief,
            "cleaned_sample": sample,
            "warnings": warnings,
            "status": "running",
        }

    if len(brief) < 8 and len(sample) < 40:
        return {
            **state,
            "kind": kind,
            "cleaned_brief": brief,
            "cleaned_sample": sample,
            "sections": _default_sections(kind),
            "warnings": warnings
            + ["Brief too short; returned standard skeleton."],
            "status": "skipped",
            "reason": "too_short",
        }

    if not is_ai_configured():
        return {
            **state,
            "kind": kind,
            "cleaned_brief": brief,
            "cleaned_sample": sample,
            "sections": _default_sections(kind),
            "warnings": warnings + ["AI not configured; returned standard skeleton."],
            "status": "failed",
            "reason": "llm_not_configured",
        }

    return {
        **state,
        "kind": kind,
        "cleaned_brief": brief,
        "cleaned_sample": sample,
        "warnings": warnings,
        "status": "running",
    }


async def generate(state: TemplateState) -> TemplateState:
    if state.get("status") != "running":
        return state

    kind = state.get("kind") or "proposal"
    org = (state.get("organization_name") or "").strip()
    existing = state.get("existing_sections") or []
    assets = list(state.get("assets") or [])
    sample = state.get("cleaned_sample") or ""
    sample_invoice_sections = (
        _sections_from_invoice_sample(sample) if kind == "invoice" else []
    )
    page_ids = _page_ids_from_assets(assets)
    # Exact visual clone from uploaded pages/images — do not invent a new layout.
    if page_ids:
        if kind == "invoice":
            sections = sample_invoice_sections or [
                {
                    "id": "sec-line-items",
                    "key": "line_items",
                    "title": "Line items",
                    "body": "",
                    "sortOrder": 1,
                }
            ]
        else:
            sections = existing if isinstance(existing, list) and existing else []
            if not sections:
                sections = [
                    {
                        "id": "sec-body",
                        "key": "body",
                        "title": "Document",
                        "body": "",
                        "sortOrder": 1,
                    }
                ]
        warnings = list(state.get("warnings") or [])
        warnings.append(
            "Saved an exact visual clone of your uploaded sample as the template."
        )
        return {
            **state,
            "sections": sections,
            "blueprint": _page_clone_blueprint(
                page_ids, sections, assets, sample_text=sample, kind=kind
            ),
            "assets": assets,
            "warnings": warnings,
            "status": "ok",
            "reason": None,
        }
    user_parts = [
        f"Document kind: {kind}",
        f"Organization (vendor): {org or 'the vendor'}",
        f"Admin brief:\n{state.get('cleaned_brief') or '(none)'}",
        f"Available assets (reference as asset:ID in HTML src): "
        + (", ".join(a.get("id", "") for a in assets) or "none"),
    ]
    if assets or sample:
        if kind == "invoice":
            user_parts.append(
                "STRICT CLONE RULES FOR INVOICE:\n"
                "- Reproduce ONLY the uploaded invoice sample. Do not borrow proposal/quote layouts.\n"
                "- No cover page, no 'Submitted to', no product hero, no rainbow footer stripe.\n"
                "- Keep letterhead, invoice meta, customer block, items table, tax/financial summary, "
                "bank details, and terms in the same order as the sample.\n"
                "- Use ONLY invoice section keys (introduction, customer, line_items, tax, payment, "
                "terms, payment_terms, delivery, footer). Never invent features/scope/commercials.\n"
                "- Do not invent sample product rows like 'Solution Description' / 'Additional Service' "
                "unless those exact labels appear as table headers in the sample."
            )
        else:
            user_parts.append(
                "CLONE the uploaded sample layout as closely as possible. Keep the same "
                "letterhead/cover structure, hero placement (only if the sample has one), "
                "section order, tables, and footer stripe. Later the CRM will swap only "
                "tokens and product-specific content — do not redesign the document."
            )
    if sample:
        user_parts.append(
            f"Sample document text (structure/tone/branding cues; do not copy customer PII):\n"
            f"{sample}"
        )
    if existing:
        user_parts.append(
            "Current template sections (improve or restructure as needed):\n"
            + json.dumps(existing[:20], ensure_ascii=False)[:3000]
        )

    text = await generate_ai_text(
        system=_system_prompt(kind),
        user="\n\n".join(user_parts),
        max_tokens=8000,
        timeout_ms=120_000,
    )
    payload = _extract_json_payload(text or "")
    warnings = list(state.get("warnings") or [])
    if not payload:
        sections = sample_invoice_sections or _default_sections(kind)
        return {
            **state,
            "sections": sections,
            "blueprint": _blueprint_for_assets(
                kind, sections, assets, sample_text=sample
            ),
            "assets": assets,
            "warnings": warnings
            + [
                "Model returned invalid JSON; used sample-derived invoice layout."
                if kind == "invoice" and sample_invoice_sections
                else "Model returned invalid JSON; used standard skeleton + default layout."
            ],
            "status": "failed",
            "reason": "bad_json",
        }

    raw_list = payload.get("sections")
    if not isinstance(raw_list, list):
        raw_list = []
    sections, sanitize_warns = _normalize_sections(raw_list, kind)
    warnings.extend(sanitize_warns)
    if kind == "invoice":
        before = list(sections)
        sections = _filter_invoice_sections(sections, sample_invoice_sections)
        if sections is sample_invoice_sections and before:
            warnings.append(
                "Dropped proposal-like sections; kept structure from the uploaded invoice sample."
            )
    if not sections:
        sections = sample_invoice_sections or _default_sections(kind)
        warnings.append("No usable sections; used standard skeleton.")

    ai_blueprint = _normalize_blueprint(payload.get("blueprint"), kind, sections)
    blueprint = _blueprint_for_assets(
        kind, sections, assets, ai_blueprint, sample_text=sample
    )

    return {
        **state,
        "sections": sections,
        "blueprint": blueprint,
        "assets": assets,
        "warnings": warnings,
        "status": "ok" if sections else "failed",
        "reason": None if sections else "empty_sections",
    }


_PIPELINE_STEPS = (
    prepare,
    generate,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    kind: str = "proposal",
    brief: str = "",
    sampleText: str = "",
    sample_text: str = "",
    organizationName: str = "",
    organization_name: str = "",
    existingSections: list[dict[str, Any]] | None = None,
    existing_sections: list[dict[str, Any]] | None = None,
    sampleFileBase64: str | None = None,
    sampleFilename: str | None = None,
    organization_id: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    del organization_id
    warnings: list[str] = []
    assets: list[dict[str, Any]] = []
    sample = (sampleText or sample_text or "").strip()
    had_sample_file = bool(sampleFileBase64 and sampleFilename)
    if sampleFileBase64 and sampleFilename:
        extracted, file_assets, extract_warns = extract_sample_bundle(
            sampleFilename,
            sampleFileBase64,
        )
        warnings.extend(extract_warns)
        assets.extend(file_assets)
        if extracted:
            sample = f"{sample}\n\n{extracted}".strip() if sample else extracted

    kind_norm = (kind or "proposal").strip().lower()
    if kind_norm not in ("proposal", "quote", "invoice"):
        kind_norm = "proposal"

    sample_name = (sampleFilename or "").lower()
    if (
        had_sample_file
        and kind_norm in ("quote", "invoice")
        and sample_name.endswith((".csv", ".xlsx", ".xls"))
    ):
        ss = build_quote_spreadsheet_template(sampleFilename or "", sampleFileBase64 or "")
        if not ss.get("ok"):
            return {
                "ok": False,
                "kind": kind_norm,
                "sections": [],
                "blueprint": None,
                "assets": [],
                "warnings": _user_facing_warnings(
                    list(warnings) + list(ss.get("warnings") or [])
                ),
                "status": "failed",
                "reason": ss.get("reason") or "spreadsheet_failed",
            }
        return {
            "ok": True,
            "kind": kind_norm,
            "sections": ss.get("sections") or _default_sections("quote"),
            "blueprint": ss.get("blueprint"),
            "assets": ss.get("assets") or [],
            "warnings": _user_facing_warnings(
                list(warnings) + list(ss.get("warnings") or [])
            ),
            "status": "ok",
        }

    page_ids_early = _page_ids_from_assets(assets)
    # PDF/DOCX sample requires exact page clone — never AI-redesign fallback.
    if had_sample_file and not page_ids_early:
        return {
            "ok": False,
            "kind": kind_norm,
            "sections": [],
            "blueprint": None,
            "assets": [],
            "warnings": _user_facing_warnings(warnings),
            "status": "failed",
            "reason": "clone_failed",
        }

    has_visual = bool(page_ids_early)
    result = await _run_pipeline(
        {
            "kind": kind_norm,
            "brief": brief or ("Build branded template from sample." if has_visual else ""),
            "sample_text": sample
            or ("[visual sample attached — exact page clone]" if has_visual else ""),
            "organization_name": organizationName or organization_name or "",
            "existing_sections": existingSections or existing_sections or [],
            "assets": assets,
            "warnings": warnings,
            "status": "running",
        }
    )
    sections = result.get("sections") or _default_sections(kind_norm)
    sample_for_bp = result.get("cleaned_sample") or sample
    out_assets = result.get("assets") if isinstance(result.get("assets"), list) else assets
    # Invoices must never carry proposal hero assets.
    if kind_norm == "invoice" and isinstance(out_assets, list):
        out_assets = [
            a
            for a in out_assets
            if not (
                isinstance(a, dict)
                and str(a.get("id") or "").lower() in {"hero", "cover"}
            )
        ]
    page_ids = _page_ids_from_assets(
        out_assets if isinstance(out_assets, list) else []
    )
    if had_sample_file and not page_ids:
        return {
            "ok": False,
            "kind": kind_norm,
            "sections": [],
            "blueprint": None,
            "assets": [],
            "warnings": _user_facing_warnings(
                list(result.get("warnings") or []) + warnings
            ),
            "status": "failed",
            "reason": "clone_failed",
        }
    if page_ids:
        blueprint = _page_clone_blueprint(
            page_ids,
            sections,
            out_assets if isinstance(out_assets, list) else [],
            sample_text=sample_for_bp,
            kind=kind_norm,
        )
        status = "ok"
    else:
        blueprint = result.get("blueprint") or _blueprint_for_assets(
            kind_norm, sections, out_assets if isinstance(out_assets, list) else [], sample_text=sample_for_bp
        )
        if kind_norm == "invoice" and isinstance(blueprint, dict):
            blueprint = _sanitize_invoice_blueprint(
                blueprint,
                sections,
                out_assets if isinstance(out_assets, list) else [],
                sample_text=sample_for_bp,
            )
        status = result.get("status")
    ok = bool(sections) and (
        status in ("ok", "skipped") or (page_ids and blueprint is not None)
    )
    return {
        "ok": ok,
        "kind": result.get("kind") or kind_norm,
        "sections": sections,
        "blueprint": blueprint,
        "assets": out_assets,
        "warnings": _user_facing_warnings(list(result.get("warnings") or [])),
        "status": status if page_ids else result.get("status"),
        "reason": None if ok else result.get("reason"),
    }
