"""Customer-facing meeting reminder HTML."""

from __future__ import annotations

from typing import Any

from app.agents import meeting_email_shell as shell

PARTICIPANT_HTML_MAX = 40_000


def _text(val: Any, limit: int = 2000) -> str:
    return shell.text(val, limit)


def _str_list(val: Any, max_n: int = 8) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        s = str(item).strip() if item is not None else ""
        if s:
            out.append(s[:280])
        if len(out) >= max_n:
            break
    return out


def normalize_participant_doc(
    parsed: dict[str, Any] | None,
    ctx: dict[str, Any],
    *,
    reminder_window: str | None,
    participant_first_name: str | None,
    organizer_name: str | None,
) -> dict[str, Any]:
    data = parsed if isinstance(parsed, dict) else {}
    first = _text(participant_first_name or ctx.get("contactName"), 80) or "there"
    first = first.split()[0] if first else "there"
    topic = _text(ctx.get("topic"), 120) or "Meeting"
    company = _text(ctx.get("companyName"), 120)
    organizer = _text(organizer_name or ctx.get("ownerName"), 80) or "Your host"

    subject = _text(data.get("subject"), 180)
    if not subject:
        if reminder_window == "24h":
            subject = f"Reminder: {topic} in 24 hours"
        elif reminder_window == "1h":
            subject = f"Starting soon: {topic}"
        else:
            subject = f"Meeting reminder: {topic}"
        subject = subject[:180]

    intro = _text(data.get("intro"), 600)
    if not intro:
        if reminder_window == "24h":
            intro = (
                f"This is a friendly reminder about your upcoming meeting"
                f"{f' with {organizer}' if organizer else ''}."
            )
        elif reminder_window == "1h":
            intro = "Your meeting starts in about one hour — details below."
        else:
            intro = f"Looking forward to connecting with you about {topic}."

    value_line = _text(data.get("valueLine"), 400)
    what_to_expect = _str_list(data.get("whatToExpect"))
    closing = _text(data.get("closing"), 300)
    if not closing:
        closing = f"See you soon,<br>{shell.esc(organizer)}"

    return {
        "subject": subject,
        "importanceTier": _text(data.get("importanceTier"), 16).lower() or "normal",
        "firstName": first,
        "intro": intro,
        "valueLine": value_line,
        "whatToExpect": what_to_expect,
        "closing": closing,
        "topic": topic,
        "company": company,
        "organizer": organizer,
    }


def render_participant_html(
    doc: dict[str, Any],
    ctx: dict[str, Any],
    *,
    reminder_window: str | None,
) -> str:
    when = _text(ctx.get("whenLabel"), 160)
    join = shell.safe_http_url(ctx.get("meetingLink"))
    topic = doc.get("topic") or "Meeting"
    organizer = doc.get("organizer") or "Your host"
    company = doc.get("company") or ""

    if reminder_window == "24h":
        title = "Meeting Reminder"
        pill = "24 HOURS AWAY"
        pill_color = "#866300"
    elif reminder_window == "1h":
        title = "Starting Soon"
        pill = "IN 1 HOUR"
        pill_color = "#C73E32"
    else:
        title = "Meeting Reminder"
        pill = "UPCOMING"
        pill_color = "#7423D7"

    greeting = (
        f"Hi {shell.esc(doc.get('firstName') or 'there')},<br><br>"
        f"{shell.esc(doc.get('intro') or '')}"
    )

    overview_rows: list[tuple[str, str]] = [("Topic", topic)]
    if when:
        overview_rows.append(("Date & Time", when))
    overview_rows.append(("Organizer", organizer))
    if company:
        overview_rows.append(("Company", company))
    if join:
        overview_rows.append(("Meeting Link", "__link__"))

    overview_html = shell.overview_table(
        [
            (
                label,
                shell.link_cell(join, "Join video call")
                if value == "__link__" and join
                else shell.esc(value),
            )
            for label, value in overview_rows
        ]
    )
    if join:
        overview_html += (
            f'<div style="padding-top:14px;">{shell.join_button(join)}</div>'
        )

    highlights = shell.highlight_card(
        doc.get("valueLine") or "",
        tone="Professional",
        outcome=f"Meet with {organizer}",
    )

    expect = shell.bullets(doc.get("whatToExpect") or [])

    actions_card = shell.two_column_cards(
        "WHAT TO EXPECT",
        expect,
        "BEFORE YOU JOIN",
        shell.bullets(
            [
                "Test your audio and video",
                "Join 2–3 minutes early",
                "Have your questions ready",
            ]
        ),
        left_heading_color=shell.GREEN,
        right_heading_color=shell.GREEN,
        bg=shell.GREEN_BG,
        border=shell.GREEN_BORDER,
    )

    body_rows = ""
    if overview_html.strip() or highlights.strip():
        body_rows += (
            f'<tr><td style="padding:8px 28px 18px;">'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="width:50%;vertical-align:top;padding:0 10px 0 0;">'
            f'{shell.section_title("MEETING OVERVIEW")}{overview_html}</td>'
            f'<td style="width:50%;vertical-align:top;padding:0 0 0 10px;">'
            f'{shell.section_title("MEETING HIGHLIGHTS", accent=shell.BLUE)}{highlights}</td>'
            f"</tr></table></td></tr>"
        )
    if expect.strip():
        body_rows += (
            f'<tr><td style="padding:0 28px 18px;">'
            f'{shell.section_title("GET READY", accent=shell.GREEN)}{actions_card}'
            f"</td></tr>"
        )
    if doc.get("closing"):
        body_rows += (
            f'<tr><td style="padding:0 28px 18px;font-size:15px;color:{shell.TEXT};'
            f'line-height:1.6;font-family:{shell.FONT};">{doc["closing"]}</td></tr>'
        )

    seller = _text(ctx.get("sellerName"), 80) or "Worktual"
    html = shell.render_document(
        brand=seller.upper() if seller else "WORKTUAL",
        title=title,
        subtitle=f"{topic}{f' · {company}' if company else ''}",
        pill=pill,
        pill_bg=pill_color,
        greeting=greeting,
        body_rows=body_rows,
        footer_bar_html=shell.footer_bar(
            "JOIN ON TIME",
            f"Use the meeting link above to join at {when or 'the scheduled time'}.",
            "QUESTIONS",
            f"Reply to this email and {organizer} will get back to you.",
        ),
        system_footer_html=shell.system_footer(
            left="Meeting reminder · Please do not reply to automated system addresses.",
            right="Need to reschedule? Reply to your host directly.",
        ),
        logo_url=_text(ctx.get("orgLogoUrl"), 500) or None,
        org_name=seller,
    )
    return html[:PARTICIPANT_HTML_MAX]
