/**
 * Enterprise HTML templates for calendar meeting notifications (confirmation, reminder).
 * Worktual brand tokens — see frontend/src/styles/tokens.css
 */

import { escapeHtml } from "@/lib/outbound-email";

const HEADER_BG = "#0B0B10";
const HEADER_TEXT_MUTED = "#A7A7AF";
const PAGE_BG = "#F4F4F6";
const CARD = "#FFFFFF";
const BORDER = "#E5E5E5";
const LINE = "#C9C9CF";
const TEXT = "#0B0B10";
const MUTED = "#5E5E69";
const VIOLET = "#7423D7";
const VIOLET_BG = "#F5EEFF";
const VIOLET_BORDER = "#E6D8FF";
const CTA_BG = "#0B0B10";
const LINK = "#7423D7";
const SUCCESS_BG = "#F6FBF9";
const SUCCESS_BORDER = "#0F9D58";
const CAUTION_BG = "#FEFBF9";
const CAUTION_BORDER = "#F57C00";
const WARNING = "#866300";
const DANGER = "#C73E32";
const FONT = "'Inter', Arial, Helvetica, sans-serif";

function overviewRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};width:34%;font-size:12px;color:${MUTED};font-weight:600;font-family:${FONT};vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${TEXT};line-height:1.5;font-family:${FONT};vertical-align:top;">${value}</td>
  </tr>`;
}

function overviewTable(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">${rows}</table>`;
}

function joinButton(url: string, label: string): string {
  const safe = url.trim();
  if (!/^https?:\/\//i.test(safe)) return "";
  return `<a href="${escapeHtml(safe)}" style="display:inline-block;background:${CTA_BG};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;font-family:${FONT};">${escapeHtml(label)}</a>`;
}

function linkCell(url: string, label: string): string {
  const safe = url.trim();
  if (!/^https?:\/\//i.test(safe)) return escapeHtml(label);
  return `<a href="${escapeHtml(safe)}" style="color:${LINK};text-decoration:none;font-weight:600;font-family:${FONT};">${escapeHtml(label)}</a>`;
}

function logoHeaderHtml(logoUrl: string | null | undefined, orgName: string): string {
  const safe = (logoUrl ?? "").trim();
  if (/^https?:\/\//i.test(safe)) {
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(orgName)}" width="72" height="72" style="display:block;width:72px;height:72px;max-width:72px;max-height:72px;object-fit:contain;border-radius:8px;background:#ffffff;padding:6px;" />`;
  }
  const label = (orgName || "ORG").trim().slice(0, 3).toUpperCase() || "ORG";
  return `<div style="width:72px;height:72px;border-radius:8px;background:rgba(255,255,255,0.12);display:inline-block;text-align:center;line-height:72px;font-size:16px;font-weight:700;color:#ffffff;font-family:${FONT};">${escapeHtml(label)}</div>`;
}

function renderShell(args: {
  brand: string;
  title: string;
  subtitle: string;
  pill?: string;
  pillBg?: string;
  greeting: string;
  body: string;
  footerLeft: string;
  footerRight: string;
  logoUrl?: string | null;
  orgName?: string;
}): string {
  const pill = args.pill
    ? `<td align="right" valign="top"><span style="display:inline-block;background:${args.pillBg ?? VIOLET};color:#ffffff;font-size:11px;font-weight:600;padding:5px 12px;border-radius:999px;font-family:${FONT};">${escapeHtml(args.pill)}</span></td>`
    : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:${CARD};border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
<tr><td style="background:${HEADER_BG};padding:0;border-bottom:3px solid ${VIOLET};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:22px 28px 24px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:11px;letter-spacing:0.14em;color:${HEADER_TEXT_MUTED};font-weight:600;font-family:${FONT};">${escapeHtml(args.brand)}</td>
          ${pill}
        </tr></table>
        <div style="padding-top:12px;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;font-family:${FONT};">${escapeHtml(args.title)}</div>
        <div style="padding-top:8px;font-size:13px;color:${HEADER_TEXT_MUTED};line-height:1.5;font-family:${FONT};">${escapeHtml(args.subtitle)}</div>
      </td>
      <td align="right" valign="middle" style="padding:22px 28px 24px 0;width:96px;">
        ${logoHeaderHtml(args.logoUrl, args.orgName ?? args.brand)}
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 28px 8px;font-size:15px;color:${TEXT};line-height:1.6;font-family:${FONT};">${args.greeting}</td></tr>
${args.body}
<tr><td style="padding:8px 28px 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${VIOLET_BG};border:1px solid ${VIOLET_BORDER};border-radius:12px;">
    <tr>
      <td style="width:50%;vertical-align:top;padding:18px 20px;border-right:1px solid ${VIOLET_BORDER};">
        <div style="font-size:11px;letter-spacing:0.1em;color:${VIOLET};font-weight:700;font-family:${FONT};padding-bottom:6px;">CALENDAR</div>
        <div style="font-size:14px;color:${TEXT};line-height:1.55;font-family:${FONT};">${escapeHtml(args.footerLeft)}</div>
      </td>
      <td style="width:50%;vertical-align:top;padding:18px 20px;">
        <div style="font-size:11px;letter-spacing:0.1em;color:${VIOLET};font-weight:700;font-family:${FONT};padding-bottom:6px;">QUESTIONS</div>
        <div style="font-size:14px;color:${TEXT};line-height:1.55;font-family:${FONT};">${escapeHtml(args.footerRight)}</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:0 28px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
    <tr>
      <td style="padding:14px 0 0;font-size:11px;color:${MUTED};font-family:${FONT};">Meeting notification · Add the invite to your calendar.</td>
      <td align="right" style="padding:14px 0 0;font-size:11px;color:${MUTED};font-family:${FONT};">Need to reschedule? Reply to your host.</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildMeetingConfirmationEmailHtml(args: {
  contactFirstName: string;
  organizerName: string;
  organizerEmail: string;
  topic: string;
  whenLabel: string;
  meetLink?: string | null;
  guestEmails?: string[];
  rescheduled?: boolean;
  previousWhenLabel?: string | null;
  joinLabel?: string;
  logoUrl?: string | null;
  sellerName?: string;
}): string {
  const guests = args.guestEmails ?? [];
  const intro = args.rescheduled
    ? `${escapeHtml(args.organizerName)} rescheduled your meeting.`
    : `${escapeHtml(args.organizerName)} invited you to a meeting.`;
  const greeting = `Hi ${escapeHtml(args.contactFirstName)},<br><br>${intro}`;

  let rows = overviewRow("Topic", escapeHtml(args.topic));
  rows += overviewRow("Date & Time", escapeHtml(args.whenLabel));
  if (args.rescheduled && args.previousWhenLabel) {
    rows += overviewRow("Previous time", escapeHtml(args.previousWhenLabel));
  }
  rows += overviewRow(
    "Organizer",
    `${escapeHtml(args.organizerName)} (${escapeHtml(args.organizerEmail)})`,
  );
  if (guests.length > 0) {
    rows += overviewRow("Guests", escapeHtml(guests.join(", ")));
  }
  if (args.meetLink) {
    rows += overviewRow("Meeting Link", linkCell(args.meetLink, "Join video call"));
  }

  const join = args.meetLink
    ? `<div style="padding-top:14px;">${joinButton(args.meetLink, args.joinLabel ?? "Join Meeting")}</div>`
    : "";

  const body = `<tr><td style="padding:8px 28px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:50%;vertical-align:top;padding:0 10px 0 0;">
        <div style="font-size:11px;letter-spacing:0.1em;color:${MUTED};font-weight:700;font-family:${FONT};padding-bottom:10px;">MEETING OVERVIEW</div>
        ${overviewTable(rows)}${join}
      </td>
      <td style="width:50%;vertical-align:top;padding:0 0 0 10px;">
        <div style="font-size:11px;letter-spacing:0.1em;color:${MUTED};font-weight:700;font-family:${FONT};padding-bottom:10px;">WHAT TO EXPECT</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${VIOLET_BG};border:1px solid ${VIOLET_BORDER};border-radius:12px;">
          <tr><td style="padding:16px 18px;font-size:14px;color:${TEXT};line-height:1.6;font-family:${FONT};">
            A focused session on <strong>${escapeHtml(args.topic)}</strong>. Please join on time and come prepared with your questions.
          </td></tr>
        </table>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 28px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SUCCESS_BG};border:1px solid ${SUCCESS_BORDER};border-radius:12px;">
      <tr><td style="padding:16px 18px;font-size:14px;color:${TEXT};line-height:1.55;font-family:${FONT};">
        <strong>Before you join:</strong> test your audio/video, join 2–3 minutes early, and have your calendar updated with this time slot.
      </td></tr>
    </table>
  </td></tr>`;

  return renderShell({
    brand: (args.sellerName ?? "Worktual").toUpperCase(),
    title: args.rescheduled ? "Meeting Updated" : "Meeting Invitation",
    subtitle: args.topic,
    pill: args.rescheduled ? "UPDATED" : "CONFIRMED",
    pillBg: args.rescheduled ? WARNING : VIOLET,
    greeting,
    body,
    footerLeft: "Open the attached calendar invite (.ics) if provided, or use the meeting link above.",
    footerRight: `Contact ${args.organizerName} if you need to reschedule.`,
    logoUrl: args.logoUrl,
    orgName: args.sellerName ?? "Worktual",
  });
}

export function buildMeetingReminderEmailHtml(args: {
  contactFirstName: string;
  organizerName: string;
  topic: string;
  whenLabel: string;
  meetLink?: string | null;
  window?: "24h" | "1h";
  logoUrl?: string | null;
  sellerName?: string;
}): string {
  const window = args.window ?? "1h";
  const lead =
    window === "24h"
      ? "Friendly reminder — your meeting is tomorrow."
      : "Your meeting starts in about one hour.";
  const greeting = `Hi ${escapeHtml(args.contactFirstName)},<br><br>${escapeHtml(lead)}`;

  let rows = overviewRow("Topic", escapeHtml(args.topic));
  rows += overviewRow("Date & Time", escapeHtml(args.whenLabel));
  rows += overviewRow("Organizer", escapeHtml(args.organizerName));
  if (args.meetLink) {
    rows += overviewRow("Meeting Link", linkCell(args.meetLink, "Join video call"));
  }
  const join = args.meetLink
    ? `<div style="padding-top:14px;">${joinButton(args.meetLink, "Join Meeting")}</div>`
    : "";

  const body = `<tr><td style="padding:8px 28px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:50%;vertical-align:top;padding:0 10px 0 0;">
        <div style="font-size:11px;letter-spacing:0.1em;color:${MUTED};font-weight:700;font-family:${FONT};padding-bottom:10px;">MEETING OVERVIEW</div>
        ${overviewTable(rows)}${join}
      </td>
      <td style="width:50%;vertical-align:top;padding:0 0 0 10px;">
        <div style="font-size:11px;letter-spacing:0.1em;color:${MUTED};font-weight:700;font-family:${FONT};padding-bottom:10px;">REMINDER</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CAUTION_BG};border:1px solid ${CAUTION_BORDER};border-radius:12px;">
          <tr><td style="padding:16px 18px;font-size:14px;color:${TEXT};line-height:1.6;font-family:${FONT};">
            We look forward to discussing <strong>${escapeHtml(args.topic)}</strong>. Please join on time using the link above.
          </td></tr>
        </table>
      </td>
    </tr></table>
  </td></tr>`;

  return renderShell({
    brand: (args.sellerName ?? "Worktual").toUpperCase(),
    title: window === "24h" ? "Meeting Reminder" : "Starting Soon",
    subtitle: args.topic,
    pill: window === "24h" ? "24 HOURS AWAY" : "IN 1 HOUR",
    pillBg: window === "24h" ? WARNING : DANGER,
    greeting,
    body,
    footerLeft: `Join at ${args.whenLabel}.`,
    footerRight: `Reply to ${args.organizerName} if you need help.`,
    logoUrl: args.logoUrl,
    orgName: args.sellerName ?? "Worktual",
  });
}
