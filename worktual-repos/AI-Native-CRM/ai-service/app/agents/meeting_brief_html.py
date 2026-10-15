"""Table-based HTML for owner pre-brief emails. Empty sections are omitted."""

from __future__ import annotations

from typing import Any

from app.agents import meeting_email_shell as shell

OWNER_HTML_MAX = 80_000


def header_pill(reminder_window: str | None, suggested: str | None = None) -> str:
    if reminder_window == "24h":
        return "REMINDER · 24 HOURS"
    if reminder_window == "1h":
        return "STARTING SOON"
    pill = (suggested or "").strip()
    return pill[:48] if pill else "NEW LEAD · FIRST CALL"


def pill_bg(reminder_window: str | None) -> str:
    if reminder_window == "24h":
        return "#866300"
    if reminder_window == "1h":
        return "#C73E32"
    return "#7423D7"


def _text(text: Any, limit: int = 2000) -> str:
    return shell.text(text, limit)


def _nonempty_str_list(val: Any, max_n: int = 12) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        s = str(item).strip() if item is not None else ""
        if s and "battlecard" not in s.lower():
            out.append(s[:400])
        if len(out) >= max_n:
            break
    return out


def _kv_rows(val: Any, max_n: int = 8) -> list[dict[str, Any]]:
    if not isinstance(val, list):
        return []
    out: list[dict[str, Any]] = []
    for item in val:
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label"), 80)
        value = _text(item.get("value"), 400)
        if not label or not value:
            continue
        out.append(
            {
                "label": label,
                "value": value,
                "muted": bool(item.get("muted")),
            }
        )
        if len(out) >= max_n:
            break
    return out


def _history_rows(val: Any, max_n: int = 12) -> list[dict[str, str]]:
    if not isinstance(val, list):
        return []
    out: list[dict[str, str]] = []
    for item in val:
        if not isinstance(item, dict):
            continue
        when = _text(item.get("when"), 120)
        detail = _text(item.get("detail"), 500)
        if not when and not detail:
            continue
        out.append({"when": when or "Update", "detail": detail})
        if len(out) >= max_n:
            break
    return out


def _objections(val: Any, max_n: int = 8) -> list[dict[str, str]]:
    if not isinstance(val, list):
        return []
    out: list[dict[str, str]] = []
    for item in val:
        if not isinstance(item, dict):
            continue
        objection = _text(item.get("objection"), 280)
        response = _text(item.get("response"), 400)
        if not objection or not response:
            continue
        if "battlecard" in response.lower() or "battlecard" in objection.lower():
            continue
        out.append({"objection": objection, "response": response})
        if len(out) >= max_n:
            break
    return out


def normalize_brief_doc(
    parsed: dict[str, Any] | None,
    ctx: dict[str, Any],
    reminder_window: str | None,
) -> dict[str, Any]:
    data = parsed if isinstance(parsed, dict) else {}
    name = _text(ctx.get("contactName") or data.get("headerTitle"), 120) or "Lead"
    company = _text(ctx.get("companyName"), 120)
    title = _text(data.get("headerTitle"), 160)
    if not title:
        title = f"{name} — {company}" if company else name

    subtitle = _text(data.get("headerSubtitle"), 280)
    if not subtitle:
        topic = _text(ctx.get("topic"), 80) or "Meeting"
        subtitle = f"{topic} · Be ready to qualify and capture a next step"

    subject = _text(data.get("subject"), 180)
    if not subject:
        when = _text(ctx.get("whenLabel"), 80) or "upcoming"
        if reminder_window == "24h":
            subject = f"Meeting reminder (24h): {name}"
        elif reminder_window == "1h":
            subject = f"Meeting reminder (1h): {name}"
        else:
            subject = f"Meeting brief: {name}"
        if company:
            subject += f" @ {company}"
        subject += f" — {when}"
        subject = subject[:180]

    return {
        "subject": subject,
        "importanceTier": _text(data.get("importanceTier") or data.get("importance_tier"), 16)
        .lower()
        or "normal",
        "headerTitle": title,
        "headerSubtitle": subtitle,
        "headerPill": header_pill(reminder_window, _text(data.get("headerPill"), 48)),
        "inShort": _text(data.get("inShort"), 1200),
        "attendeeRolePill": _text(data.get("attendeeRolePill"), 80),
        "attendeeNote": _text(data.get("attendeeNote"), 800),
        "accountSnapshot": _kv_rows(data.get("accountSnapshot")),
        "dealState": _kv_rows(data.get("dealState")),
        "qualificationNote": _text(data.get("qualificationNote"), 400),
        "crossChannelHistory": _history_rows(data.get("crossChannelHistory")),
        "carryOver": _nonempty_str_list(data.get("carryOver")),
        "customerQuote": _text(data.get("customerQuote"), 600),
        "weOwe": _text(data.get("weOwe"), 400),
        "theyOwe": _text(data.get("theyOwe"), 400),
        "risks": _nonempty_str_list(data.get("risks")),
        "agenda": _nonempty_str_list(data.get("agenda"), 8),
        "whyThisOrder": _text(data.get("whyThisOrder"), 500),
        "objections": _objections(data.get("objections")),
        "assets": _nonempty_str_list(data.get("assets"), 8),
    }


def heuristic_brief_doc(
    ctx: dict[str, Any],
    reminder_window: str | None,
    lead_summary: str | None,
) -> dict[str, Any]:
    """Fact-only fallback when the LLM is unavailable. No invented coaching."""
    name = _text(ctx.get("contactName"), 120) or "Lead"
    company = _text(ctx.get("companyName"), 120)
    snapshot: list[dict[str, Any]] = []
    if company:
        industry = _text(ctx.get("industry"), 80)
        snapshot.append(
            {
                "label": "Company",
                "value": f"{company} — {industry}" if industry else company,
                "muted": False,
            }
        )
    if ctx.get("employeeCount") is not None:
        snapshot.append(
            {
                "label": "Company size",
                "value": str(ctx.get("employeeCount")),
                "muted": False,
            }
        )
    source = _text(ctx.get("leadSource"), 120)
    if source:
        snapshot.append({"label": "Source", "value": source, "muted": False})

    deal: list[dict[str, Any]] = []
    if ctx.get("pipelineStage"):
        title = _text(ctx.get("pipelineDealTitle"), 80) or "Deal"
        amount = _text(ctx.get("pipelineAmount"), 40)
        value = f"{title} — {ctx.get('pipelineStage')}"
        if amount:
            value += f" ({amount})"
        deal.append({"label": "Stage", "value": value, "muted": False})
    days = ctx.get("daysSinceInquiry")
    if days is not None:
        deal.append(
            {
                "label": "Days since inquiry",
                "value": f"{days} day" if days == 1 else f"{days} days",
                "muted": False,
            }
        )

    history: list[dict[str, str]] = []
    activities = ctx.get("recentActivities")
    if isinstance(activities, list):
        for item in reversed(activities[-8:]):
            if not isinstance(item, dict):
                continue
            kind = _text(item.get("type"), 40) or "activity"
            direction = _text(item.get("direction"), 20)
            subject = _text(item.get("subject"), 120) or "Untitled"
            when = _text(item.get("occurredAt"), 40)
            label = f"{when} — {kind}" + (f" ({direction})" if direction else "")
            detail = _text(item.get("detail"), 280) or subject
            history.append({"when": label, "detail": detail})

    in_short = _text(lead_summary, 800)
    attendee_note = _text(ctx.get("authority"), 400)
    return normalize_brief_doc(
        {
            "subject": None,
            "headerTitle": f"{name} — {company}" if company else name,
            "headerSubtitle": None,
            "headerPill": None,
            "inShort": in_short,
            "attendeeRolePill": _text(ctx.get("contactTitle"), 80)
            or _text(ctx.get("authority"), 80),
            "attendeeNote": attendee_note,
            "accountSnapshot": snapshot,
            "dealState": deal,
            "crossChannelHistory": history,
            "carryOver": [],
            "customerQuote": "",
            "weOwe": "",
            "theyOwe": "",
            "risks": [],
            "agenda": [],
            "whyThisOrder": "",
            "objections": [],
            "assets": [],
        },
        ctx,
        reminder_window,
    )


def _kv_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    parts = [
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
    ]
    for row in rows:
        color = shell.MUTED if row.get("muted") else shell.TEXT
        parts.append(
            "<tr>"
            f'<td style="padding:4px 0;width:38%;font-size:13px;color:{shell.MUTED};'
            f'vertical-align:top;font-family:{shell.FONT};">'
            f"<strong>{shell.esc(row['label'])}</strong></td>"
            f'<td style="padding:4px 0;font-size:13px;color:{color};'
            f'font-family:{shell.FONT};">{shell.esc(row["value"])}</td>'
            "</tr>"
        )
    parts.append("</table>")
    return "".join(parts)


def _history_as_html(rows: list[dict[str, str]]) -> str:
    if not rows:
        return ""
    parts = []
    for row in rows:
        parts.append(
            f'<div style="padding:0 0 12px 0;font-family:{shell.FONT};">'
            f'<div style="font-size:13px;font-weight:700;color:{shell.TEXT};">'
            f'{shell.esc(row["when"])}</div>'
            f'<div style="font-size:13px;color:{shell.TEXT};padding-top:2px;line-height:1.5;">'
            f'{shell.esc(row["detail"])}</div></div>'
        )
    return "".join(parts)


def _objections_html(objs: list[dict[str, str]]) -> str:
    if not objs:
        return ""
    return "".join(
        f'<div style="padding:0 0 12px 0;font-size:14px;color:{shell.TEXT};'
        f'line-height:1.55;font-family:{shell.FONT};">'
        f'<strong>“{shell.esc(item["objection"])}”</strong> → {shell.esc(item["response"])}'
        f"</div>"
        for item in objs
    )


def _panel_row(label: str, inner: str, *, accent: str = shell.NAVY) -> str:
    if not inner.strip():
        return ""
    return (
        f'<tr><td style="padding:0 28px 18px;">'
        f"{shell.section_title(label, accent=accent)}"
        f"{inner}</td></tr>"
    )


def render_prebrief_html(
    doc: dict[str, Any],
    ctx: dict[str, Any],
    reminder_window: str | None,
) -> str:
    pill = header_pill(reminder_window, doc.get("headerPill"))
    when = _text(ctx.get("whenLabel"), 160)
    join = shell.safe_http_url(ctx.get("meetingLink"))
    name = _text(ctx.get("contactName"), 120) or _text(doc.get("headerTitle"), 120)
    company = _text(ctx.get("companyName"), 120)
    topic = _text(ctx.get("topic"), 120) or "Meeting"
    organizer = _text(ctx.get("ownerName") or ctx.get("organizerName"), 80) or "Your team"

    if reminder_window == "24h":
        doc_title = "Meeting Reminder"
        greeting = (
            f"Hi Team,<br><br>Your meeting with <strong>{shell.esc(name)}</strong>"
            f"{f' ({shell.esc(company)})' if company else ''} is in about 24 hours. "
            f"Use this briefing to walk in prepared."
        )
    elif reminder_window == "1h":
        doc_title = "Starting Soon"
        greeting = (
            f"Hi Team,<br><br>Your meeting with <strong>{shell.esc(name)}</strong>"
            f"{f' ({shell.esc(company)})' if company else ''} starts in about one hour. "
            f"Quick prep below."
        )
    else:
        doc_title = "Meeting Brief"
        greeting = (
            f"Hi Team,<br><br>Please find your pre-call briefing for the meeting with "
            f"<strong>{shell.esc(name)}</strong>"
            f"{f' ({shell.esc(company)})' if company else ''} regarding "
            f"<strong>{shell.esc(topic)}</strong>."
        )

    overview_rows: list[tuple[str, str]] = [("Topic", topic)]
    if when:
        overview_rows.append(("Date & Time", when))
    attendee_line = f"{name} — {company}" if company else name
    overview_rows.append(("Attendee", attendee_line))
    overview_rows.append(("Organized by", organizer))
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

    tone = _text(doc.get("attendeeRolePill"), 80)
    outcome = _text(doc.get("qualificationNote"), 400) or _text(doc.get("headerSubtitle"), 280)
    highlights_html = shell.highlight_card(
        _text(doc.get("inShort"), 1200),
        tone=tone,
        outcome=outcome[:200] if outcome else "",
    )

    overview_block = ""
    if overview_html.strip() or highlights_html.strip():
        left = overview_html or ""
        right = highlights_html or ""
        overview_block = (
            f'<tr><td style="padding:8px 28px 18px;">'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="width:50%;vertical-align:top;padding:0 10px 0 0;">'
            f'{shell.section_title("MEETING OVERVIEW")}{left}</td>'
            f'<td style="width:50%;vertical-align:top;padding:0 0 0 10px;">'
            f'{shell.section_title("MEETING HIGHLIGHTS", accent=shell.BLUE)}{right}</td>'
            f"</tr></table></td></tr>"
        )

    attendee_inner = ""
    if attendee_line:
        attendee_inner += (
            f'<div style="font-size:15px;font-weight:700;color:{shell.TEXT};'
            f'font-family:{shell.FONT};">{shell.esc(attendee_line)}</div>'
        )
    if _text(doc.get("attendeeNote"), 800):
        attendee_inner += (
            f'<div style="padding-top:10px;font-size:14px;color:{shell.TEXT};'
            f'line-height:1.55;font-family:{shell.FONT};">'
            f'{shell.esc(doc["attendeeNote"])}</div>'
        )

    history = doc.get("crossChannelHistory") or []
    carry = doc.get("carryOver") or []
    discussion_card = shell.two_column_cards(
        "RECENT TOUCHPOINTS",
        _history_as_html(history),
        "CONTEXT TO CARRY FORWARD",
        shell.bullets(carry),
        left_heading_color=shell.GREEN,
        right_heading_color=shell.GREEN,
        bg=shell.GREEN_BG,
        border=shell.GREEN_BORDER,
    )

    agenda = doc.get("agenda") or []
    why = _text(doc.get("whyThisOrder"), 500)
    agenda_html = shell.numbered(agenda)
    if agenda_html and why:
        agenda_html += (
            f'<div style="padding-top:10px;font-size:13px;color:{shell.MUTED};'
            f'font-family:{shell.FONT};"><strong>Why this order:</strong> '
            f"{shell.esc(why)}</div>"
        )
    risks = doc.get("risks") or []
    prep_card = shell.two_column_cards(
        "RECOMMENDED AGENDA",
        agenda_html,
        "RISKS & WATCH-OUTS",
        shell.bullets(risks),
        left_heading_color=shell.ORANGE,
        right_heading_color=shell.ORANGE,
        bg=shell.ORANGE_BG,
        border=shell.ORANGE_BORDER,
    )

    we_owe = _text(doc.get("weOwe"), 400)
    they_owe = _text(doc.get("theyOwe"), 400)
    assets = doc.get("assets") or []
    commitments_left = ""
    if we_owe:
        commitments_left += (
            f'<div style="font-size:13px;color:{shell.TEXT};line-height:1.55;'
            f'font-family:{shell.FONT};"><strong>We owe:</strong> {shell.esc(we_owe)}</div>'
        )
    if assets:
        commitments_left += (
            f'<div style="padding-top:10px;">{shell.bullets(assets)}</div>'
        )
    commitments_right = ""
    if they_owe:
        commitments_right = (
            f'<div style="font-size:13px;color:{shell.TEXT};line-height:1.55;'
            f'font-family:{shell.FONT};"><strong>They owe:</strong> {shell.esc(they_owe)}</div>'
        )
    commitments_card = shell.two_column_cards(
        "OPEN COMMITMENTS · US",
        commitments_left,
        "OPEN COMMITMENTS · THEM",
        commitments_right,
        left_heading_color=shell.ORANGE,
        right_heading_color=shell.ORANGE,
        bg=shell.ORANGE_BG,
        border=shell.ORANGE_BORDER,
    )

    quote_html = ""
    if _text(doc.get("customerQuote"), 600):
        quote_html = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="background:{shell.BLUE_BG};border-left:4px solid {shell.BLUE};border-radius:8px;">'
            f'<tr><td style="padding:14px 16px;font-size:14px;font-style:italic;color:{shell.TEXT};'
            f'line-height:1.55;font-family:{shell.FONT};">“{shell.esc(doc["customerQuote"])}”</td></tr>'
            f"</table>"
        )

    snapshot = _kv_table(doc.get("accountSnapshot") or [])
    deal = _kv_table(doc.get("dealState") or [])
    intelligence = shell.two_column_cards(
        "ACCOUNT SNAPSHOT",
        snapshot,
        "DEAL STATE",
        deal,
        left_heading_color=shell.NAVY,
        right_heading_color=shell.NAVY,
        bg=shell.CARD_WHITE,
        border=shell.LINE,
    )

    objections = _objections_html(doc.get("objections") or [])

    body_rows = "".join(
        [
            overview_block,
            _panel_row("ATTENDEE INTELLIGENCE", attendee_inner),
            _panel_row("ACCOUNT & DEAL INTELLIGENCE", intelligence),
            _panel_row("KEY DISCUSSION POINTS", discussion_card, accent=shell.GREEN),
            _panel_row("CUSTOMER QUOTE", quote_html, accent=shell.BLUE),
            _panel_row("PREP & RISKS", prep_card, accent=shell.ORANGE),
            _panel_row("OPEN COMMITMENTS", commitments_card, accent=shell.ORANGE),
            _panel_row(
                "ANTICIPATED OBJECTIONS & SUGGESTED RESPONSES",
                objections,
                accent=shell.NAVY,
            ),
        ]
    )

    next_step = agenda[0] if agenda else _text(doc.get("inShort"), 200) or "Confirm a clear next step before you hang up."
    if reminder_window == "1h":
        follow_up = "Meeting starts in ~1 hour"
    elif reminder_window == "24h":
        follow_up = "Review 30 minutes before the call"
    else:
        follow_up = "Before the scheduled meeting"

    html = shell.render_document(
        brand="WORKTUAL",
        title=doc_title,
        subtitle=_text(doc.get("headerTitle"), 160),
        pill=pill,
        pill_bg=pill_bg(reminder_window),
        greeting=greeting,
        body_rows=body_rows,
        footer_bar_html=shell.footer_bar("NEXT STEPS", next_step, "PREP BY", follow_up),
        system_footer_html=shell.system_footer(
            left="Internal briefing · Prepared by your WORKTUAL AI assistant.",
            right="Reply to flag anything before the call.",
        ),
        logo_url=_text(ctx.get("orgLogoUrl"), 500) or None,
        org_name=_text(ctx.get("sellerName"), 80),
    )
    return html[:OWNER_HTML_MAX]
