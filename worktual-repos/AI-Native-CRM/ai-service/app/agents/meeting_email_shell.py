"""Shared table-based HTML shell for enterprise meeting emails."""

from __future__ import annotations

from html import escape
from typing import Any

# Worktual brand tokens — aligned with frontend/src/styles/tokens.css & brandguidelines
HEADER_BG = "#0B0B10"
HEADER_TEXT_MUTED = "#A7A7AF"
PAGE_BG = "#F4F4F6"
CARD_WHITE = "#FFFFFF"
CARD_BORDER = "#E5E5E5"
LINE = "#C9C9CF"
TEXT = "#0B0B10"
TEXT_SECONDARY = "#3F3F49"
MUTED = "#5E5E69"
LABEL = "#7E7E88"
VIOLET = "#7423D7"
VIOLET_DARK = "#431A7E"
VIOLET_BG = "#F5EEFF"
VIOLET_BORDER = "#E6D8FF"
CTA_BG = "#0B0B10"
LINK = "#7423D7"
INFO_BG = "#F9FBFE"
INFO_BORDER = "#D1B9FF"
SUCCESS = "#0E8F50"
SUCCESS_BG = "#F6FBF9"
SUCCESS_BORDER = "#0F9D58"
CAUTION = "#874400"
CAUTION_BG = "#FEFBF9"
CAUTION_BORDER = "#F57C00"
WARNING = "#866300"
DANGER = "#C73E32"
FOOTER_BG = "#F4F4F6"

FONT = "'Inter', Arial, Helvetica, sans-serif"

# Back-compat aliases used by template renderers
NAVY = HEADER_BG
NAVY_SUB = HEADER_TEXT_MUTED
BLUE = LINK
BLUE_BG = VIOLET_BG
BLUE_BORDER = VIOLET_BORDER
GREEN = SUCCESS
GREEN_BG = SUCCESS_BG
GREEN_BORDER = SUCCESS_BORDER
ORANGE = CAUTION
ORANGE_BG = CAUTION_BG
ORANGE_BORDER = CAUTION_BORDER
PURPLE = VIOLET
PURPLE_BG = VIOLET_BG
PURPLE_BORDER = VIOLET_BORDER


def esc(text: Any) -> str:
    return escape(str(text or ""), quote=True)


def text(val: Any, limit: int = 2000) -> str:
    return str(val or "").strip()[:limit]


def safe_http_url(url: Any) -> str | None:
    raw = str(url or "").strip()
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw.split()[0]
    return None


def _icon_dot(color: str) -> str:
    return (
        f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;'
        f"background:{color};margin-right:8px;vertical-align:middle;"
        f'font-size:0;line-height:0;">&nbsp;</span>'
    )


def section_title(label: str, *, accent: str = NAVY) -> str:
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        f"<tr><td style=\"padding:0 0 10px;font-size:11px;letter-spacing:0.1em;"
        f"color:{LABEL};font-weight:700;font-family:{FONT};\">"
        f'{_icon_dot(accent)}{esc(label)}</td></tr></table>'
    )


def bullets(items: list[str], *, color: str = TEXT) -> str:
    if not items:
        return ""
    rows = "".join(
        f'<tr><td style="padding:0 0 8px 0;font-size:14px;color:{color};'
        f'line-height:1.55;font-family:{FONT};">'
        f'<span style="color:{MUTED};padding-right:8px;">•</span>{esc(item)}</td></tr>'
        for item in items
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def numbered(items: list[str]) -> str:
    if not items:
        return ""
    rows = "".join(
        f'<tr><td style="padding:0 8px 8px 0;width:22px;vertical-align:top;'
        f'font-size:14px;color:{TEXT};font-family:{FONT};">{i}.</td>'
        f'<td style="padding:0 0 8px 0;font-size:14px;color:{TEXT};'
        f'line-height:1.55;font-family:{FONT};">{esc(item)}</td></tr>'
        for i, item in enumerate(items, start=1)
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def overview_table(rows: list[tuple[str, str]]) -> str:
    """Label/value rows for meeting overview panels."""
    if not rows:
        return ""
    body = ""
    for label, value in rows:
        if not label or not value:
            continue
        body += (
            "<tr>"
            f'<td style="padding:10px 12px;border-bottom:1px solid {LINE};width:34%;'
            f'font-size:12px;color:{MUTED};font-weight:600;font-family:{FONT};'
            f'vertical-align:top;">{esc(label)}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid {LINE};font-size:14px;'
            f'color:{TEXT};line-height:1.5;font-family:{FONT};vertical-align:top;">'
            f"{value}</td>"
            "</tr>"
        )
    if not body:
        return ""
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border:1px solid {LINE};border-radius:12px;overflow:hidden;">'
        f"{body}</table>"
    )


def join_button(url: str, label: str = "Join Meeting") -> str:
    safe = safe_http_url(url)
    if not safe:
        return ""
    return (
        f'<a href="{esc(safe)}" style="display:inline-block;background:{CTA_BG};'
        f"color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;"
        f'font-size:14px;font-weight:600;font-family:{FONT};">{esc(label)}</a>'
    )


def link_cell(url: str, label: str | None = None) -> str:
    safe = safe_http_url(url)
    if not safe:
        return esc(label or url)
    display = label or safe
    return (
        f'<a href="{esc(safe)}" style="color:{LINK};text-decoration:none;'
        f'font-weight:600;font-family:{FONT};">{esc(display)}</a>'
    )


def two_column_cards(
    left_title: str,
    left_html: str,
    right_title: str,
    right_html: str,
    *,
    left_heading_color: str,
    right_heading_color: str,
    bg: str,
    border: str,
) -> str:
    if not left_html.strip() and not right_html.strip():
        return ""
    left_block = ""
    if left_html.strip():
        left_block = (
            f'<td style="width:50%;vertical-align:top;padding:0 8px 0 0;">'
            f'<div style="font-size:12px;font-weight:700;letter-spacing:0.06em;'
            f"color:{left_heading_color};font-family:{FONT};padding-bottom:8px;"
            f'">{esc(left_title)}</div>{left_html}</td>'
        )
    right_block = ""
    if right_html.strip():
        right_block = (
            f'<td style="width:50%;vertical-align:top;padding:0 0 0 8px;">'
            f'<div style="font-size:12px;font-weight:700;letter-spacing:0.06em;'
            f"color:{right_heading_color};font-family:{FONT};padding-bottom:8px;"
            f'">{esc(right_title)}</div>{right_html}</td>'
        )
    if not left_block:
        left_block = '<td style="width:50%;"></td>'
    if not right_block:
        right_block = '<td style="width:50%;"></td>'
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{bg};border:1px solid {border};border-radius:12px;">'
        f'<tr><td style="padding:16px 18px;">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        f"<tr>{left_block}{right_block}</tr></table></td></tr></table>"
    )


def highlight_card(
    summary: str,
    *,
    tone: str = "",
    outcome: str = "",
    bg: str = VIOLET_BG,
    border: str = VIOLET_BORDER,
) -> str:
    if not summary and not tone and not outcome:
        return ""
    inner = ""
    if summary:
        inner += (
            f'<div style="font-size:14px;color:{TEXT};line-height:1.6;'
            f'font-family:{FONT};padding-bottom:12px;">{esc(summary)}</div>'
        )
    meta = ""
    if tone:
        meta += (
            f'<td style="width:50%;vertical-align:top;padding:8px 12px 0 0;">'
            f'<div style="font-size:11px;color:{MUTED};font-weight:700;'
            f'letter-spacing:0.06em;font-family:{FONT};padding-bottom:4px;">TONE</div>'
            f'<div style="font-size:14px;color:{TEXT};font-family:{FONT};">'
            f"{esc(tone)}</div></td>"
        )
    if outcome:
        meta += (
            f'<td style="width:50%;vertical-align:top;padding:8px 0 0 12px;">'
            f'<div style="font-size:11px;color:{MUTED};font-weight:700;'
            f'letter-spacing:0.06em;font-family:{FONT};padding-bottom:4px;">OUTCOME</div>'
            f'<div style="font-size:14px;color:{TEXT};font-family:{FONT};">'
            f"{esc(outcome)}</div></td>"
        )
    if meta:
        inner += (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="border-top:1px solid {border};"><tr>{meta}</tr></table>'
        )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{bg};border:1px solid {border};border-radius:12px;">'
        f'<tr><td style="padding:16px 18px;">{inner}</td></tr></table>'
    )


def footer_bar(left_title: str, left_body: str, right_title: str, right_body: str) -> str:
    if not left_body.strip() and not right_body.strip():
        return ""
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{PURPLE_BG};border:1px solid {PURPLE_BORDER};border-radius:10px;">'
        f"<tr>"
        f'<td style="width:50%;vertical-align:top;padding:18px 20px;border-right:1px solid {PURPLE_BORDER};">'
        f'<div style="font-size:11px;letter-spacing:0.1em;color:{PURPLE};font-weight:700;'
        f'font-family:{FONT};padding-bottom:6px;">{esc(left_title)}</div>'
        f'<div style="font-size:14px;color:{TEXT};line-height:1.55;font-family:{FONT};">'
        f"{esc(left_body)}</div></td>"
        f'<td style="width:50%;vertical-align:top;padding:18px 20px;">'
        f'<div style="font-size:11px;letter-spacing:0.1em;color:{PURPLE};font-weight:700;'
        f'font-family:{FONT};padding-bottom:6px;">{esc(right_title)}</div>'
        f'<div style="font-size:14px;color:{TEXT};line-height:1.55;font-family:{FONT};">'
        f"{esc(right_body)}</div></td>"
        f"</tr></table>"
    )


def system_footer(*, left: str, right: str = "Need help? Contact your CRM admin.") -> str:
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-top:1px solid {LINE};">'
        f"<tr>"
        f'<td style="padding:14px 0 0;font-size:11px;color:{MUTED};font-family:{FONT};">'
        f"{esc(left)}</td>"
        f'<td align="right" style="padding:14px 0 0;font-size:11px;color:{MUTED};'
        f'font-family:{FONT};">{esc(right)}</td>'
        f"</tr></table>"
    )


def pill_badge(label: str, *, bg: str) -> str:
    return (
        f'<span style="display:inline-block;background:{bg};color:#ffffff;font-size:11px;'
        f"font-weight:700;padding:5px 12px;border-radius:999px;letter-spacing:0.04em;"
        f'font-family:{FONT};">{esc(label)}</span>'
    )


def logo_header_html(logo_url: str | None, org_name: str = "") -> str:
    safe = safe_http_url(logo_url)
    if safe:
        return (
            f'<img src="{esc(safe)}" alt="{esc(org_name or "Organization")}" width="72" height="72" '
            f'style="display:block;width:72px;height:72px;max-width:72px;max-height:72px;'
            f"object-fit:contain;border-radius:8px;background:#ffffff;padding:6px;"
            f'font-family:{FONT};" />'
        )
    label = (org_name or "ORG").strip()[:3].upper() or "ORG"
    return (
        f'<div style="width:72px;height:72px;border-radius:8px;background:rgba(255,255,255,0.12);'
        f"display:inline-block;text-align:center;line-height:72px;font-size:16px;font-weight:700;"
        f'letter-spacing:0.04em;color:#ffffff;font-family:{FONT};">{esc(label)}</div>'
    )


def render_document(
    *,
    brand: str,
    title: str,
    subtitle: str,
    pill: str = "",
    pill_bg: str = VIOLET,
    greeting: str = "",
    body_rows: str,
    footer_bar_html: str = "",
    system_footer_html: str = "",
    logo_url: str | None = None,
    org_name: str = "",
    width: int = 640,
) -> str:
    pill_row = ""
    if pill:
        pill_row = (
            f'<td align="right" valign="top">{pill_badge(pill, bg=pill_bg)}</td>'
        )
    greeting_row = ""
    if greeting.strip():
        greeting_row = (
            f'<tr><td style="padding:20px 28px 8px;font-size:15px;color:{TEXT};'
            f'line-height:1.6;font-family:{FONT};">{greeting}</td></tr>'
        )
    footer_bar_row = ""
    if footer_bar_html.strip():
        footer_bar_row = (
            f'<tr><td style="padding:8px 28px 20px;">{footer_bar_html}</td></tr>'
        )
    system_row = ""
    if system_footer_html.strip():
        system_row = (
            f'<tr><td style="padding:0 28px 24px;">{system_footer_html}</td></tr>'
        )

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:{PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE_BG};">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="{width}" cellpadding="0" cellspacing="0" style="width:{width}px;max-width:100%;background:{CARD_WHITE};border-radius:12px;overflow:hidden;border:1px solid {CARD_BORDER};">
<tr><td style="background:{HEADER_BG};padding:0;border-bottom:3px solid {VIOLET};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:22px 28px 24px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;letter-spacing:0.14em;color:{HEADER_TEXT_MUTED};font-weight:600;font-family:{FONT};">{esc(brand)}</td>
            {pill_row}
          </tr>
        </table>
        <div style="padding-top:12px;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;font-family:{FONT};">{esc(title)}</div>
        <div style="padding-top:8px;font-size:13px;color:{HEADER_TEXT_MUTED};line-height:1.5;font-family:{FONT};">{esc(subtitle)}</div>
      </td>
      <td align="right" valign="middle" style="padding:22px 28px 24px 0;width:96px;">
        {logo_header_html(logo_url, org_name or brand)}
      </td>
    </tr>
  </table>
</td></tr>
{greeting_row}
{body_rows}
{footer_bar_row}
{system_row}
</table>
</td></tr>
</table>
</body>
</html>"""
