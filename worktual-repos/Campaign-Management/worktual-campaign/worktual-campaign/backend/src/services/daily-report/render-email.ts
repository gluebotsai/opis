import { env } from "../../config/env.js";
import type { DailyCampaignReport, ReportSection } from "./types.js";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return String(value);
}

function sectionError(section: ReportSection<unknown>): string {
  if (section.available) return "";
  return `<p style="margin:8px 0 0;color:#b45309;font-size:13px;">Data unavailable: ${esc(section.error)}</p>`;
}

function emptyNote(text: string): string {
  return `<p style="margin:0;color:#64748b;font-size:13px;font-style:italic;">${esc(text)}</p>`;
}

function card(title: string, inner: string, errorHtml = ""): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
  <tr><td style="padding:16px 20px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#0f172a;">${esc(title)}</td></tr>
  <tr><td style="padding:0 20px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#334155;line-height:1.5;">${inner}${errorHtml}</td></tr>
</table>`;
}

function statGrid(cells: Array<{ label: string; value: string }>): string {
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const a = cells[i];
    const b = cells[i + 1];
    rows.push(`<tr>
      <td width="50%" style="padding:8px 8px 8px 0;vertical-align:top;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">${esc(a.label)}</div>
        <div style="font-size:22px;font-weight:700;color:#0f172a;">${esc(a.value)}</div>
      </td>
      ${b ? `<td width="50%" style="padding:8px 0 8px 8px;vertical-align:top;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">${esc(b.label)}</div>
        <div style="font-size:22px;font-weight:700;color:#0f172a;">${esc(b.value)}</div>
      </td>` : `<td width="50%"></td>`}
    </tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>`;
}

function dataTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return emptyNote("No records for this period.");
  const head = headers
    .map(
      (h) =>
        `<th align="left" style="padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;">${esc(h)}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">${cell}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${`<tr>${head}</tr>`}${body}</table>`;
}

export function renderDailyCampaignReportEmail(report: DailyCampaignReport): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = env.appUrl.replace(/\/$/, "");
  const subject = `Daily Campaign Report — ${report.reportDateLabel}`;

  const o = report.overall.data;
  const overallInner =
    o.noActivity && report.overall.available
      ? `${emptyNote("No campaign activity was recorded for this reporting day.")}${statGrid([
          { label: "Active now", value: num(o.campaignsRunning) },
          { label: "Scheduled", value: num(o.campaignsScheduled) },
          { label: "Messages sent", value: num(o.messagesSent) },
          { label: "Delivery rate", value: pct(o.deliveryRate) },
        ])}`
      : statGrid([
          { label: "Launched", value: num(o.campaignsLaunched) },
          { label: "Completed", value: num(o.campaignsCompleted) },
          { label: "Running", value: num(o.campaignsRunning) },
          { label: "Scheduled", value: num(o.campaignsScheduled) },
          { label: "Failed", value: num(o.campaignsFailed) },
          { label: "Paused", value: num(o.campaignsPaused) },
          { label: "Messages sent", value: num(o.messagesSent) },
          { label: "Delivered", value: num(o.messagesDelivered) },
          { label: "Failed msgs", value: num(o.messagesFailed) },
          { label: "Delivery rate", value: pct(o.deliveryRate) },
          { label: "Click rate", value: pct(o.clickRate) },
          { label: "Contacts reached", value: num(o.contactsReached) },
        ]);

  const activityRows = report.campaignActivity.data.map((r) => [
    esc(r.name),
    esc(r.channels.join(", ")),
    esc(r.status),
    num(r.messagesSent),
    num(r.delivered),
    num(r.failed),
  ]);

  const status = report.currentStatus.data;
  const statusInner = [
    status.active.length
      ? `<p style="margin:0 0 8px;"><strong>Active (${status.active.length})</strong><br/>${status.active
          .slice(0, 8)
          .map((c) => esc(c.name))
          .join("<br/>")}</p>`
      : emptyNote("There are currently no active campaigns."),
    status.scheduled.length
      ? `<p style="margin:12px 0 8px;"><strong>Scheduled (${status.scheduled.length})</strong><br/>${status.scheduled
          .slice(0, 8)
          .map((c) => `${esc(c.name)} — ${esc(c.launchLabel)}`)
          .join("<br/>")}</p>`
      : `<p style="margin:12px 0 0;">${emptyNote("No scheduled campaigns.")}</p>`,
    status.paused.length
      ? `<p style="margin:12px 0 0;"><strong>Paused (${status.paused.length})</strong><br/>${status.paused
          .slice(0, 5)
          .map((c) => `${esc(c.name)} — ${esc(c.reason || "Paused")}`)
          .join("<br/>")}</p>`
      : "",
  ].join("");

  const channelRows = report.channelPerformance.data.map((ch) => [
    esc(ch.label),
    num(ch.sent),
    num(ch.delivered),
    num(ch.failed),
    pct(ch.deliveryRate),
    ch.opens != null ? num(ch.opens) : "—",
    ch.openRate != null ? pct(ch.openRate) : "—",
    ch.clicks != null ? num(ch.clicks) : "—",
    ch.clickRate != null ? pct(ch.clickRate) : "—",
  ]);

  const ca = report.contactActivity.data;
  const contactInner = ca.noActivity && report.contactActivity.available
    ? emptyNote("No contact activity during this reporting period.")
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${[
        ["Created", ca.created],
        ["Updated", ca.updated],
        ["Added to campaigns", ca.addedToCampaigns],
        ["Reached", ca.reached],
        ["Failed", ca.failed],
        ["Unsubscribed", ca.unsubscribed],
      ]
        .map(
          ([label, val]) =>
            `<tr><td style="padding:4px 0;color:#64748b;">${esc(label)}</td><td align="right" style="padding:4px 0;font-weight:600;">${num(val as number)}</td></tr>`,
        )
        .join("")}
    </table>`;

  const wa = report.whatsappTemplates.data;
  const waInner =
    wa.noActivity && report.whatsappTemplates.available
      ? emptyNote("No WhatsApp template activity during this reporting period.")
      : `<p style="margin:0 0 8px;">Submitted ${num(wa.submitted)} · Pending ${num(wa.pending)} · Approved ${num(wa.approved)} · Rejected ${num(wa.rejected)}</p>${
          wa.rejectedDetails.length
            ? `<p style="margin:0;color:#b45309;">Rejected: ${wa.rejectedDetails
                .map((r) => `${esc(r.name)}${r.reason ? ` (${esc(r.reason)})` : ""}`)
                .join("; ")}</p>`
            : ""
        }`;

  const schedRows = report.scheduledCampaigns.data.map((r) => [
    esc(r.name),
    esc(r.channels.join(", ")),
    esc(r.scheduledAt),
    num(r.expectedContacts),
  ]);

  const attention = report.attentionRequired.data;
  const attentionInner = attention.length
    ? `<ul style="margin:0;padding-left:18px;">${attention
        .map(
          (a) =>
            `<li style="margin:0 0 8px;"><strong>${esc(a.title)}</strong> — ${esc(a.detail)}${
              a.href
                ? ` <a href="${esc(appUrl + a.href)}" style="color:#2563eb;">View</a>`
                : ""
            }</li>`,
        )
        .join("")}</ul>`
    : emptyNote("No actionable issues require attention.");

  const upcoming = report.upcomingActivity.data;
  const upcomingInner = upcoming.noUpcoming
    ? emptyNote("No upcoming campaign activity scheduled.")
    : dataTable(
        ["Campaign", "Channel", "Scheduled", "Contacts"],
        upcoming.scheduledCampaigns.map((r) => [
          esc(r.name),
          esc(r.channels.join(", ")),
          esc(r.scheduledAt),
          num(r.expectedContacts),
        ]),
      );

  let comparisonInner = emptyNote("Comparison unavailable — insufficient historical data.");
  if (report.comparison.data?.available) {
    comparisonInner = dataTable(
      ["Metric", "Yesterday", "Previous day", "Change"],
      report.comparison.data.metrics.map((m) => [
        esc(m.label),
        m.current != null && m.label.includes("rate") ? pct(m.current as number) : num(m.current),
        m.previous != null && m.label.includes("rate") ? pct(m.previous as number) : num(m.previous),
        m.deltaPct != null ? `${m.deltaPct >= 0 ? "+" : ""}${(m.deltaPct * 100).toFixed(1)}%` : m.delta != null ? String(m.delta) : "—",
      ]),
    );
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
        <tr><td style="padding:0 0 16px;font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:12px;font-weight:700;color:#2563eb;letter-spacing:.08em;text-transform:uppercase;">Campaign Manager</div>
          <div style="font-size:26px;font-weight:700;color:#0f172a;margin-top:4px;">Daily Campaign Report</div>
          <div style="font-size:14px;color:#475569;margin-top:6px;">${esc(report.reportDateLabel)} · ${esc(report.timezone)}</div>
          <div style="font-size:14px;color:#475569;margin-top:4px;">Prepared for ${esc(report.userName)}${
            report.organizationName ? ` · ${esc(report.organizationName)}` : ""
          }</div>
        </td></tr>
        <tr><td>
          ${card("Overall summary", overallInner, sectionError(report.overall))}
          ${card("Campaign activity (reporting day)", dataTable(["Campaign", "Channel", "Status", "Sent", "Delivered", "Failed"], activityRows), sectionError(report.campaignActivity))}
          ${card("Current campaign status", statusInner, sectionError(report.currentStatus))}
          ${card("Channel performance", channelRows.length ? dataTable(["Channel", "Sent", "Delivered", "Failed", "Del. rate", "Opens", "Open rate", "Clicks", "Click rate"], channelRows) : emptyNote("No channel sends recorded for this reporting day."), sectionError(report.channelPerformance))}
          ${card("Contact activity", contactInner, sectionError(report.contactActivity))}
          ${card("WhatsApp template activity", waInner, sectionError(report.whatsappTemplates))}
          ${card("Scheduled campaigns", schedRows.length ? dataTable(["Campaign", "Channel", "Scheduled", "Contacts"], schedRows) : emptyNote("No campaigns are currently scheduled."), sectionError(report.scheduledCampaigns))}
          ${card("Attention required", attentionInner, sectionError(report.attentionRequired))}
          ${card("Upcoming activity", upcomingInner, sectionError(report.upcomingActivity))}
          ${card("Performance comparison", comparisonInner, sectionError(report.comparison))}
        </td></tr>
        <tr><td style="padding:16px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;line-height:1.6;">
          <a href="${esc(appUrl)}/campaigns" style="color:#2563eb;">Open Campaign Manager</a> ·
          <a href="${esc(appUrl)}/campaigns/create" style="color:#2563eb;">Create campaign</a> ·
          <a href="${esc(appUrl)}/reports" style="color:#2563eb;">Reports</a>
          <br/><br/>
          This is an automated daily summary from Worktual Campaign Manager.
          Reporting period covers today's activity (calendar day in your timezone),
          sent automatically Mon–Fri between 5:00–6:00 PM local time.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Daily Campaign Report — ${report.reportDateLabel}`,
    `Prepared for ${report.userName}`,
    "",
    `Messages sent: ${o.messagesSent}`,
    `Delivered: ${o.messagesDelivered}`,
    `Active campaigns: ${o.campaignsRunning}`,
    "",
    `Open Campaign Manager: ${appUrl}/campaigns`,
  ].join("\n");

  return { subject, html, text };
}
