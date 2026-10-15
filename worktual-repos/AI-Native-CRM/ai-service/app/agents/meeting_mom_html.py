"""Customer-facing Minutes of Meeting HTML. Empty sections are omitted."""

from __future__ import annotations

from typing import Any

from app.agents import meeting_email_shell as shell
from app.agents.meeting_mom_postprocess import (
    dedupe_strings,
    normalize_action_items,
    postprocess_mom,
)

CUSTOMER_MOM_HTML_MAX = 80_000
INTERNAL_MOM_HTML_MAX = 80_000

INTERNAL_LIST_KEYS = (
    "discussionTopics",
    "keyDetails",
    "decisions",
    "actionItems",
    "commitments",
    "objections",
    "nextSteps",
    "openQuestions",
    "risks",
)


def _text(text: Any, limit: int = 2000) -> str:
    return shell.text(text, limit)


def _str_list(val: Any, max_n: int = 16, limit: int = 400) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        s = str(item).strip() if item is not None else ""
        if s:
            out.append(s[:limit])
        if len(out) >= max_n:
            break
    return out


def _participants(val: Any, max_n: int = 12) -> list[dict[str, str]]:
    if not isinstance(val, list):
        return []
    out: list[dict[str, str]] = []
    for item in val:
        if not isinstance(item, dict):
            continue
        name = _text(item.get("name"), 80)
        if not name:
            continue
        out.append(
            {
                "name": name,
                "role": _text(item.get("role"), 80),
                "organization": _text(item.get("organization"), 80),
            }
        )
        if len(out) >= max_n:
            break
    return out


def _sections(val: Any, max_n: int = 12) -> list[dict[str, Any]]:
    if not isinstance(val, list):
        return []
    out: list[dict[str, Any]] = []
    for item in val:
        if not isinstance(item, dict):
            continue
        heading = _text(item.get("heading"), 120)
        bullets = _str_list(item.get("bullets"), 12, 280)
        description = _text(item.get("description"), 400)
        if not heading or (not bullets and not description):
            continue
        out.append(
            {
                "heading": heading,
                "description": description,
                "bullets": bullets,
            }
        )
        if len(out) >= max_n:
            break
    return out


def _action_rows(val: Any, max_n: int = 12) -> list[dict[str, str]]:
    if not isinstance(val, list):
        return []
    out: list[dict[str, str]] = []
    for item in val:
        if not isinstance(item, dict):
            continue
        action = _text(item.get("action"), 280)
        if not action:
            continue
        due = _text(item.get("dueDate"), 40)
        if due.lower() in {"[date]", "tbd", "n/a", "na"}:
            due = ""
        out.append(
            {
                "action": action,
                "owner": _text(item.get("owner"), 80) or "—",
                "dueDate": due or "—",
            }
        )
        if len(out) >= max_n:
            break
    return out


def _seed_participants(meta: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    owner = _text(meta.get("ownerName"), 80)
    seller = _text(meta.get("sellerName"), 80) or "Worktual"
    if owner:
        out.append(
            {
                "name": owner,
                "role": "Sales Representative",
                "organization": seller,
            }
        )
    contact = _text(meta.get("contactName"), 80)
    company = _text(meta.get("companyName"), 80)
    if contact:
        out.append(
            {
                "name": contact,
                "role": "",
                "organization": company,
            }
        )
    return out


def normalize_customer_mom(
    parsed: dict[str, Any] | None,
    meta: dict[str, Any],
) -> dict[str, Any]:
    data = parsed if isinstance(parsed, dict) else {}
    ce = data.get("customerEmail") if isinstance(data.get("customerEmail"), dict) else {}
    seller = _text(meta.get("sellerName"), 80) or "Worktual"
    company = _text(meta.get("companyName"), 80) or "Client"
    topic = _text(ce.get("title") or meta.get("topic"), 120) or "Meeting"
    if not topic.lower().startswith("minutes of meeting"):
        title = f"Minutes of Meeting — {topic}"
    else:
        title = topic[:160]

    when = _text(ce.get("subtitle") or meta.get("whenLabel"), 160)
    if when and "·" not in when:
        subtitle = f"{when} · {seller} & {company} Discovery Session"
    elif when:
        subtitle = when
    else:
        subtitle = f"{seller} & {company} Discovery Session"

    subject = _text(ce.get("subject"), 180)
    if not subject:
        subject = title[:180]

    sections = _sections(ce.get("sections"))
    if not sections:
        bullets = _str_list(data.get("discussionTopics")) or _str_list(
            data.get("keyDetails")
        )
        if bullets:
            sections = [
                {
                    "heading": "Discussion",
                    "description": "",
                    "bullets": bullets,
                }
            ]

    participants = _participants(ce.get("participants"))
    if not participants:
        participants = _seed_participants(meta)

    actions = _action_rows(ce.get("actionItems"))
    if not actions:
        legacy = _str_list(data.get("actionItems"), 8)
        for line in legacy:
            actions.append({"action": line, "owner": "—", "dueDate": "—"})

    closing = _text(ce.get("closing"), 500)
    if not closing:
        closing = (
            "Thank you for your time today. Please let us know if we've missed "
            "anything from the discussion, and we look forward to the follow-up session."
        )

    return {
        "subject": subject,
        "title": title,
        "subtitle": subtitle,
        "participants": participants,
        "objective": _text(ce.get("objective") or data.get("executiveSummary"), 800),
        "sections": sections,
        "nextStepsWorktual": _str_list(ce.get("nextStepsWorktual")),
        "nextStepsClient": _str_list(ce.get("nextStepsClient")),
        "actionItems": actions,
        "closing": closing,
        "sellerName": seller,
        "orgLogoUrl": _text(meta.get("orgLogoUrl"), 500),
        "followUpBy": _text(data.get("followUpBy"), 80),
    }


def _participant_line(row: dict[str, str]) -> str:
    name = row["name"]
    role = row.get("role") or ""
    org = row.get("organization") or ""
    tail = ", ".join([p for p in (role, org) if p])
    if tail:
        return f"{name} — {tail}"
    return name


def _section_block(label: str, inner: str, *, accent: str = shell.NAVY) -> str:
    if not inner.strip():
        return ""
    return (
        f'<tr><td style="padding:0 28px 18px;">'
        f"{shell.section_title(label, accent=accent)}{inner}</td></tr>"
    )


def _discussion_sections_html(sections: list[dict[str, Any]]) -> str:
    if not sections:
        return ""
    blocks: list[str] = []
    for i, section in enumerate(sections, start=1):
        heading = _text(section.get("heading"), 120)
        description = _text(section.get("description"), 400)
        bullets = section.get("bullets") or []
        block = (
            f'<div style="font-size:15px;font-weight:700;color:{shell.TEXT};'
            f'font-family:{shell.FONT};padding-bottom:6px;">'
            f"{i}. {shell.esc(heading)}</div>"
        )
        if description:
            block += (
                f'<div style="font-size:13px;font-style:italic;color:{shell.MUTED};'
                f'font-family:{shell.FONT};padding-bottom:8px;">'
                f"{shell.esc(description)}</div>"
            )
            if bullets:
                block += (
                    f'<div style="font-size:11px;letter-spacing:0.06em;color:{shell.MUTED};'
                    f'font-weight:700;font-family:{shell.FONT};padding:4px 0 8px;">'
                    f"KEY FEATURES</div>"
                )
        if bullets:
            block += shell.bullets(bullets)
        blocks.append(block)
    return "".join(blocks)


def render_customer_mom_html(doc: dict[str, Any]) -> str:
    seller = _text(doc.get("sellerName"), 80) or "Worktual"
    topic = _text(doc.get("title"), 160).replace("Minutes of Meeting — ", "")
    participants = doc.get("participants") or []
    attendee_names = ", ".join(_participant_line(row) for row in participants[:4])
    objective = _text(doc.get("objective"), 800)

    greeting = (
        f"Hi Team,<br><br>Please find below the summary of the meeting regarding "
        f"<strong>{shell.esc(topic)}</strong>."
    )
    if attendee_names:
        greeting += f" Attendees: {shell.esc(attendee_names)}."

    overview_rows: list[tuple[str, str]] = [("Topic", topic)]
    subtitle = _text(doc.get("subtitle"), 160)
    if subtitle:
        overview_rows.append(("Date & Time", subtitle.split("·")[0].strip()))
    if attendee_names:
        overview_rows.append(("Attendees", attendee_names))
    overview_rows.append(("Prepared by", seller))

    overview_html = shell.overview_table(
        [(label, shell.esc(value)) for label, value in overview_rows]
    )

    highlights = shell.highlight_card(
        objective,
        tone="Professional",
        outcome=_text(doc.get("closing"), 120) or "Follow-up as agreed",
    )

    sections = doc.get("sections") or []
    discussion_bullets: list[str] = []
    for section in sections:
        heading = _text(section.get("heading"), 120)
        for bullet in section.get("bullets") or []:
            discussion_bullets.append(f"{heading}: {bullet}" if heading else str(bullet))
        if not section.get("bullets") and _text(section.get("description"), 400):
            discussion_bullets.append(
                f"{heading}: {_text(section.get('description'), 400)}"
            )

    decisions = doc.get("nextStepsClient") or doc.get("nextStepsWorktual") or []
    if not decisions and doc.get("actionItems"):
        decisions = [
            row["action"]
            for row in doc.get("actionItems") or []
            if row.get("action")
        ][:3]

    discussion_card = shell.two_column_cards(
        "DISCUSSION",
        shell.bullets(discussion_bullets[:8]),
        "DECISIONS",
        shell.bullets(decisions[:6]),
        left_heading_color=shell.GREEN,
        right_heading_color=shell.GREEN,
        bg=shell.GREEN_BG,
        border=shell.GREEN_BORDER,
    )

    worktual_steps = doc.get("nextStepsWorktual") or []
    client_steps = doc.get("nextStepsClient") or []
    actions_card = shell.two_column_cards(
        "ACTIONS",
        shell.bullets(worktual_steps),
        "COMMITMENTS",
        shell.bullets(client_steps),
        left_heading_color=shell.ORANGE,
        right_heading_color=shell.ORANGE,
        bg=shell.ORANGE_BG,
        border=shell.ORANGE_BORDER,
    )

    actions = doc.get("actionItems") or []
    action_table = ""
    if actions:
        rows = "".join(
            "<tr>"
            f'<td style="padding:10px 12px;border:1px solid {shell.LINE};font-size:13px;'
            f'color:{shell.TEXT};font-family:{shell.FONT};">{shell.esc(row["action"])}</td>'
            f'<td style="padding:10px 12px;border:1px solid {shell.LINE};font-size:13px;'
            f'color:{shell.TEXT};font-family:{shell.FONT};">{shell.esc(row["owner"])}</td>'
            f'<td style="padding:10px 12px;border:1px solid {shell.LINE};font-size:13px;'
            f'color:{shell.TEXT};font-family:{shell.FONT};">{shell.esc(row["dueDate"])}</td>'
            "</tr>"
            for row in actions
        )
        action_table = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="border-collapse:collapse;margin-top:12px;">'
            f'<tr style="background:#F4F7FA;">'
            f'<th align="left" style="padding:8px 12px;border:1px solid {shell.LINE};'
            f'font-size:11px;color:{shell.MUTED};font-family:{shell.FONT};">ACTION</th>'
            f'<th align="left" style="padding:8px 12px;border:1px solid {shell.LINE};'
            f'font-size:11px;color:{shell.MUTED};font-family:{shell.FONT};">OWNER</th>'
            f'<th align="left" style="padding:8px 12px;border:1px solid {shell.LINE};'
            f'font-size:11px;color:{shell.MUTED};font-family:{shell.FONT};">DUE DATE</th>'
            f"</tr>{rows}</table>"
        )

    participants_html = ""
    if participants:
        participants_html = shell.bullets([_participant_line(row) for row in participants])

    detailed_sections = _discussion_sections_html(sections)

    body_rows = "".join(
        [
            (
                f'<tr><td style="padding:8px 28px 18px;">'
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="width:50%;vertical-align:top;padding:0 10px 0 0;">'
                f'{shell.section_title("MEETING OVERVIEW")}{overview_html}</td>'
                f'<td style="width:50%;vertical-align:top;padding:0 0 0 10px;">'
                f'{shell.section_title("MEETING HIGHLIGHTS", accent=shell.BLUE)}{highlights}</td>'
                f"</tr></table></td></tr>"
            ),
            _section_block("KEY PARTICIPANTS", participants_html),
            _section_block("KEY DISCUSSION POINTS", discussion_card, accent=shell.GREEN),
            _section_block("DETAILED NOTES", detailed_sections),
            _section_block("ACTIONS & NEXT STEPS", actions_card + action_table, accent=shell.ORANGE),
        ]
    )

    next_left = worktual_steps[0] if worktual_steps else (
        client_steps[0] if client_steps else _text(doc.get("closing"), 200)
    )
    next_right = _text(doc.get("followUpBy"), 80) or "As agreed in the meeting"

    closing = _text(doc.get("closing"), 500)
    if closing:
        body_rows += (
            f'<tr><td style="padding:0 28px 18px;font-size:14px;color:{shell.TEXT};'
            f'line-height:1.6;font-family:{shell.FONT};">{shell.esc(closing)}</td></tr>'
        )

    html = shell.render_document(
        brand=seller.upper(),
        title="Meeting Summary",
        subtitle=_text(doc.get("title"), 160),
        pill="MINUTES OF MEETING",
        pill_bg="#7423D7",
        greeting=greeting,
        body_rows=body_rows,
        footer_bar_html=shell.footer_bar("NEXT STEPS", next_left or "Confirm follow-up actions.", "FOLLOW-UP", next_right),
        system_footer_html=shell.system_footer(
            left=f"{seller} · Minutes of Meeting · Automated summary.",
            right="Need help? Contact your CRM admin.",
        ),
        logo_url=_text(doc.get("orgLogoUrl"), 500) or None,
        org_name=seller,
    )
    return html[:CUSTOMER_MOM_HTML_MAX]


def _mom_str_list(mom: dict[str, Any], key: str, max_n: int = 16) -> list[str]:
    return _str_list(mom.get(key), max_n)


def _internal_action_rows(
    mom: dict[str, Any],
    meta: dict[str, Any],
    max_n: int = 12,
) -> list[dict[str, str]]:
    structured = mom.get("actionItemsStructured")
    if isinstance(structured, list) and structured:
        out: list[dict[str, str]] = []
        for row in structured:
            if not isinstance(row, dict):
                continue
            action = _text(row.get("action"), 280)
            if not action:
                continue
            due = _text(row.get("dueDate"), 40)
            if due.lower() in {"[date]", "tbd", "n/a", "na"}:
                due = ""
            out.append(
                {
                    "action": action,
                    "owner": _text(row.get("owner"), 80) or "—",
                    "dueDate": due or "—",
                }
            )
            if len(out) >= max_n:
                break
        return out
    return normalize_action_items(mom.get("actionItems"), meta, max_n=max_n)


def normalize_internal_mom(
    mom: dict[str, Any],
    meta: dict[str, Any],
    *,
    transcript_excerpt: str = "",
    contact_href: str = "",
    meet_link: str = "",
) -> dict[str, Any]:
    raw = mom if isinstance(mom, dict) else {}
    data = (
        raw
        if raw.get("actionItemsStructured") is not None
        else postprocess_mom(raw, meta)
    )
    seller = _text(meta.get("sellerName"), 80) or "Worktual"
    contact = _text(meta.get("contactName"), 80) or "Contact"
    company = _text(meta.get("companyName"), 80)
    topic = _text(meta.get("topic"), 120) or "Meeting"
    when = _text(meta.get("whenLabel"), 160)
    owner = _text(meta.get("ownerName"), 80)
    title = f"Minutes of Meeting — {topic}"
    subtitle = when or f"{seller} · Internal sales recap"

    participants = _participants(meta.get("participants"))
    if not participants:
        participants = _seed_participants(meta)

    buying_signals = _str_list(data.get("buyingSignalLines"))
    if not buying_signals:
        if data.get("proposalRequested"):
            buying_signals.append("Customer requested a proposal or formal quote.")
        intent = _text(data.get("buyingIntent"), 240)
        if intent:
            buying_signals.append(f"Buying intent: {intent}")
        current = _text(data.get("currentSolution"), 240)
        if current:
            buying_signals.append(f"Current solution: {current}")
        for pt in _mom_str_list(data, "painPoints"):
            buying_signals.append(f"Pain point: {pt}")
        for crit in _mom_str_list(data, "evaluationCriteria"):
            buying_signals.append(f"Evaluation criteria: {crit}")
        buying_signals = dedupe_strings(buying_signals, max_n=10)

    next_best = _text(data.get("nextBestAction"), 280)
    follow_up = _text(data.get("followUpBy"), 80)
    next_steps = _mom_str_list(data, "nextSteps")
    if not next_steps and next_best:
        next_steps = [next_best]

    return {
        "subject": f"Minutes of Meeting: {topic} — {contact}"[:180],
        "title": title,
        "subtitle": subtitle,
        "topic": topic,
        "whenLabel": when,
        "contactName": contact,
        "companyName": company,
        "ownerName": owner,
        "sentiment": _text(data.get("sentiment"), 80),
        "executiveSummary": _text(data.get("executiveSummary"), 1200),
        "discussionTopics": _mom_str_list(data, "discussionTopics"),
        "keyDetails": _mom_str_list(data, "keyDetails"),
        "decisions": _mom_str_list(data, "decisions"),
        "commitments": _mom_str_list(data, "commitments"),
        "objections": _mom_str_list(data, "objections"),
        "nextSteps": next_steps,
        "nextBestAction": next_best,
        "followUpBy": follow_up,
        "buyingSignals": buying_signals,
        "openQuestions": _mom_str_list(data, "openQuestions"),
        "risks": _mom_str_list(data, "risks"),
        "actionItems": _internal_action_rows(data, meta),
        "transcriptExcerpt": _text(transcript_excerpt, 2500),
        "contactHref": _text(contact_href, 500),
        "meetLink": _text(meet_link, 500),
        "sellerName": seller,
        "orgLogoUrl": _text(meta.get("orgLogoUrl"), 500),
        "participants": participants,
    }


def render_internal_mom_html(doc: dict[str, Any]) -> str:
    seller = _text(doc.get("sellerName"), 80) or "Worktual"
    topic = _text(doc.get("topic"), 120)
    contact = _text(doc.get("contactName"), 80)
    company = _text(doc.get("companyName"), 80)
    owner = _text(doc.get("ownerName"), 80)
    when = _text(doc.get("whenLabel"), 160)
    sentiment = _text(doc.get("sentiment"), 80)
    summary = _text(doc.get("executiveSummary"), 1200)

    greeting = (
        f"Hi team,<br><br>This is the <strong>internal</strong> minutes of meeting recap for "
        f"<strong>{shell.esc(contact)}</strong>"
    )
    if company:
        greeting += f" at <strong>{shell.esc(company)}</strong>"
    greeting += f" regarding <strong>{shell.esc(topic)}</strong>."

    overview_rows: list[tuple[str, str]] = [("Topic", topic)]
    if when:
        overview_rows.append(("When", when))
    overview_rows.append(("Contact", contact))
    if company:
        overview_rows.append(("Company", company))
    if owner:
        overview_rows.append(("Sales owner", owner))
    if sentiment:
        overview_rows.append(("Overall tone", sentiment))
    meet_link = _text(doc.get("meetLink"), 500)
    if meet_link:
        overview_rows.append(("Join link", shell.link_cell(meet_link, "Open meeting link")))

    overview_html = shell.overview_table(
        [(label, value if label == "Join link" else shell.esc(value)) for label, value in overview_rows]
    )

    next_best = _text(doc.get("nextBestAction"), 280)
    next_step_preview = next_best or (
        (doc.get("nextSteps") or ["Review action items in CRM"])[0][:120]
    )
    highlights = shell.highlight_card(
        summary,
        tone=sentiment or "Not assessed",
        outcome=next_step_preview[:120],
    )

    discussion = _mom_str_list(doc, "discussionTopics") + _mom_str_list(doc, "keyDetails")
    decisions = _mom_str_list(doc, "decisions")
    discussion_card = shell.two_column_cards(
        "DISCUSSION",
        shell.bullets(discussion[:10]),
        "DECISIONS",
        shell.bullets(decisions[:8]),
        left_heading_color=shell.GREEN,
        right_heading_color=shell.GREEN,
        bg=shell.GREEN_BG,
        border=shell.GREEN_BORDER,
    )

    actions_card = shell.two_column_cards(
        "ACTION ITEMS",
        shell.bullets([row["action"] for row in doc.get("actionItems") or []][:8]),
        "COMMITMENTS",
        shell.bullets(_mom_str_list(doc, "commitments")),
        left_heading_color=shell.ORANGE,
        right_heading_color=shell.ORANGE,
        bg=shell.ORANGE_BG,
        border=shell.ORANGE_BORDER,
    )

    actions = doc.get("actionItems") or []
    action_table = ""
    if actions:
        rows = "".join(
            "<tr>"
            f'<td style="padding:10px 12px;border:1px solid {shell.LINE};font-size:13px;'
            f'color:{shell.TEXT};font-family:{shell.FONT};">{shell.esc(row["action"])}</td>'
            f'<td style="padding:10px 12px;border:1px solid {shell.LINE};font-size:13px;'
            f'color:{shell.TEXT};font-family:{shell.FONT};">{shell.esc(row["owner"])}</td>'
            f'<td style="padding:10px 12px;border:1px solid {shell.LINE};font-size:13px;'
            f'color:{shell.TEXT};font-family:{shell.FONT};">{shell.esc(row["dueDate"])}</td>'
            "</tr>"
            for row in actions
        )
        action_table = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="border-collapse:collapse;margin-top:12px;">'
            f'<tr style="background:#F4F7FA;">'
            f'<th align="left" style="padding:8px 12px;border:1px solid {shell.LINE};'
            f'font-size:11px;color:{shell.MUTED};font-family:{shell.FONT};">ACTION</th>'
            f'<th align="left" style="padding:8px 12px;border:1px solid {shell.LINE};'
            f'font-size:11px;color:{shell.MUTED};font-family:{shell.FONT};">OWNER</th>'
            f'<th align="left" style="padding:8px 12px;border:1px solid {shell.LINE};'
            f'font-size:11px;color:{shell.MUTED};font-family:{shell.FONT};">DUE DATE</th>'
            f"</tr>{rows}</table>"
        )

    participants = doc.get("participants") or []
    participants_html = ""
    if participants:
        participants_html = shell.bullets([_participant_line(row) for row in participants])

    body_rows = "".join(
        [
            (
                f'<tr><td style="padding:8px 28px 18px;">'
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="width:50%;vertical-align:top;padding:0 10px 0 0;">'
                f'{shell.section_title("MEETING OVERVIEW")}{overview_html}</td>'
                f'<td style="width:50%;vertical-align:top;padding:0 0 0 10px;">'
                f'{shell.section_title("MEETING HIGHLIGHTS", accent=shell.BLUE)}{highlights}</td>'
                f"</tr></table></td></tr>"
            ),
            _section_block("KEY PARTICIPANTS", participants_html),
            _section_block("KEY DISCUSSION POINTS", discussion_card, accent=shell.GREEN),
            _section_block("ACTIONS & COMMITMENTS", actions_card + action_table, accent=shell.ORANGE),
        ]
    )

    buying_signals = _mom_str_list(doc, "buyingSignals")
    objections = _mom_str_list(doc, "objections")
    open_questions = _mom_str_list(doc, "openQuestions")
    risks = _mom_str_list(doc, "risks")
    next_steps = _mom_str_list(doc, "nextSteps")

    if buying_signals:
        body_rows += _section_block(
            "DEAL SIGNALS",
            shell.two_column_cards(
                "BUYING SIGNALS",
                shell.bullets(buying_signals),
                "OBJECTIONS / CONCERNS",
                shell.bullets(objections),
                left_heading_color=shell.GREEN,
                right_heading_color=shell.ORANGE,
                bg=shell.GREEN_BG,
                border=shell.GREEN_BORDER,
            ),
            accent=shell.GREEN,
        )
        if open_questions:
            body_rows += _section_block(
                "OPEN QUESTIONS",
                shell.bullets(open_questions),
                accent=shell.ORANGE,
            )
    else:
        concerns_card = shell.two_column_cards(
            "OBJECTIONS / CONCERNS",
            shell.bullets(objections),
            "OPEN QUESTIONS",
            shell.bullets(open_questions),
            left_heading_color=shell.ORANGE,
            right_heading_color=shell.ORANGE,
            bg=shell.CAUTION_BG,
            border=shell.CAUTION_BORDER,
        )
        if objections or open_questions:
            body_rows += _section_block("DEAL SIGNALS", concerns_card, accent=shell.ORANGE)

    if risks:
        body_rows += _section_block("RISKS / BLOCKERS", shell.bullets(risks), accent=shell.DANGER)

    if next_steps:
        body_rows += _section_block("NEXT STEPS", shell.bullets(next_steps), accent=shell.VIOLET)

    excerpt = _text(doc.get("transcriptExcerpt"), 2500)
    if excerpt:
        body_rows += _section_block(
            "TRANSCRIPT EXCERPT",
            (
                f'<div style="font-size:13px;color:{shell.TEXT_SECONDARY};line-height:1.65;'
                f'font-family:{shell.FONT};white-space:pre-wrap;">{shell.esc(excerpt)}</div>'
            ),
        )

    contact_href = _text(doc.get("contactHref"), 500)
    footer_left = next_best or (
        next_steps[0] if next_steps else "Review transcript and confirm follow-ups in CRM."
    )
    footer_right = _text(doc.get("followUpBy"), 80) or "Confirm timeline in CRM"
    if contact_href:
        body_rows += (
            f'<tr><td style="padding:0 28px 18px;text-align:center;">'
            f'{shell.join_button(contact_href, "Open contact in CRM")}</td></tr>'
        )

    html = shell.render_document(
        brand=seller.upper(),
        title="Meeting Summary",
        subtitle=_text(doc.get("title"), 160),
        pill="INTERNAL · MINUTES OF MEETING",
        pill_bg="#431A7E",
        greeting=greeting,
        body_rows=body_rows,
        footer_bar_html=shell.footer_bar(
            "NEXT BEST ACTION",
            footer_left,
            "FOLLOW-UP",
            footer_right,
        ),
        system_footer_html=shell.system_footer(
            left=f"{seller} · Internal Minutes of Meeting · For sales team only.",
            right="Confidential — do not forward externally.",
        ),
        logo_url=_text(doc.get("orgLogoUrl"), 500) or None,
        org_name=seller,
    )
    return html[:INTERNAL_MOM_HTML_MAX]

