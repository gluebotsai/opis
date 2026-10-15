/**
 * Enterprise HTML for CRM operational notifications (proposal, quote, invoice, finance).
 * Matches meeting-mail-html brand tokens.
 */

import { escapeHtml } from "@/lib/outbound-email";

const HEADER_BG = "#0B0B10";
const HEADER_TEXT_MUTED = "#A7A7AF";
const PAGE_BG = "#F4F4F6";
const CARD = "#FFFFFF";
const BORDER = "#E5E5E5";
const TEXT = "#0B0B10";
const MUTED = "#5E5E69";
const VIOLET = "#7423D7";
const VIOLET_BG = "#F5EEFF";
const VIOLET_BORDER = "#E6D8FF";
const BLUE = "#2563EB";
const BLUE_BG = "#EFF6FF";
const BLUE_BORDER = "#BFDBFE";
const GREEN = "#0F9D58";
const GREEN_BG = "#F6FBF9";
const GREEN_BORDER = "#B7E4C7";
const ORANGE = "#F57C00";
const ORANGE_BG = "#FEFBF9";
const ORANGE_BORDER = "#FFD8B2";
const CTA_BG = "#0B0B10";
const LINK = "#7423D7";
const FONT = "'Inter', Arial, Helvetica, sans-serif";

export type NotificationEmailContext = {
  kind: string;
  title: string;
  message: string;
  href?: string | null;
  sellerName?: string;
  logoUrl?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  dealTitle?: string | null;
  documentLabel?: string | null;
  actorLabel?: string | null;
  nextStep?: string | null;
};

type KindVisual = {
  pill: string;
  pillBg: string;
  accent: string;
  summaryBg: string;
  summaryBorder: string;
};

function kindVisual(kind: string): KindVisual {
  const k = kind.toLowerCase();
  if (k.includes("invoice") || k.includes("finance")) {
    return {
      pill: "FINANCE",
      pillBg: ORANGE,
      accent: ORANGE,
      summaryBg: ORANGE_BG,
      summaryBorder: ORANGE_BORDER,
    };
  }
  if (k.includes("quote")) {
    return {
      pill: "QUOTE",
      pillBg: BLUE,
      accent: BLUE,
      summaryBg: BLUE_BG,
      summaryBorder: BLUE_BORDER,
    };
  }
  if (k.includes("proposal")) {
    return {
      pill: "PROPOSAL",
      pillBg: VIOLET,
      accent: VIOLET,
      summaryBg: VIOLET_BG,
      summaryBorder: VIOLET_BORDER,
    };
  }
  if (k.includes("order")) {
    return {
      pill: "ORDER",
      pillBg: GREEN,
      accent: GREEN,
      summaryBg: GREEN_BG,
      summaryBorder: GREEN_BORDER,
    };
  }
  if (k.includes("meeting")) {
    return {
      pill: "MEETING",
      pillBg: ORANGE,
      accent: ORANGE,
      summaryBg: ORANGE_BG,
      summaryBorder: ORANGE_BORDER,
    };
  }
  if (k.includes("coaching") || k.includes("performance")) {
    return {
      pill: "COACHING",
      pillBg: BLUE,
      accent: BLUE,
      summaryBg: BLUE_BG,
      summaryBorder: BLUE_BORDER,
    };
  }
  return {
    pill: "CRM UPDATE",
    pillBg: VIOLET,
    accent: VIOLET,
    summaryBg: VIOLET_BG,
    summaryBorder: VIOLET_BORDER,
  };
}

function logoHeaderHtml(logoUrl: string | null | undefined, orgName: string): string {
  const safe = (logoUrl ?? "").trim();
  if (/^https?:\/\//i.test(safe)) {
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(orgName)}" width="72" height="72" style="display:block;width:72px;height:72px;max-width:72px;max-height:72px;object-fit:contain;border-radius:8px;background:#ffffff;padding:6px;" />`;
  }
  const label = (orgName || "ORG").trim().slice(0, 3).toUpperCase() || "ORG";
  return `<div style="width:72px;height:72px;border-radius:8px;background:rgba(255,255,255,0.12);display:inline-block;text-align:center;line-height:72px;font-size:16px;font-weight:700;color:#ffffff;font-family:${FONT};">${escapeHtml(label)}</div>`;
}

function overviewRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};width:34%;font-size:12px;color:${MUTED};font-weight:600;font-family:${FONT};vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${TEXT};line-height:1.5;font-family:${FONT};vertical-align:top;">${value}</td>
  </tr>`;
}

function ctaButton(url: string, label: string): string {
  const safe = url.trim();
  if (!/^https?:\/\//i.test(safe)) return "";
  return `<a href="${escapeHtml(safe)}" style="display:inline-block;background:${CTA_BG};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;font-family:${FONT};">${escapeHtml(label)}</a>`;
}

function linkCell(url: string, label: string): string {
  const safe = url.trim();
  if (!/^https?:\/\//i.test(safe)) return escapeHtml(label);
  return `<a href="${escapeHtml(safe)}" style="color:${LINK};text-decoration:none;font-weight:600;font-family:${FONT};">${escapeHtml(label)}</a>`;
}

export function buildNotificationEmailHtml(ctx: NotificationEmailContext): string {
  const seller = (ctx.sellerName || "Worktual").trim() || "Worktual";
  const visual = kindVisual(ctx.kind);
  const subtitle = ctx.documentLabel?.trim() || ctx.dealTitle?.trim() || "CRM notification";

  const overviewRows: string[] = [];
  if (ctx.documentLabel?.trim()) {
    overviewRows.push(overviewRow("Document", escapeHtml(ctx.documentLabel.trim())));
  }
  if (ctx.dealTitle?.trim()) {
    overviewRows.push(overviewRow("Deal", escapeHtml(ctx.dealTitle.trim())));
  }
  if (ctx.contactName?.trim()) {
    const contact = ctx.contactName.trim();
    const company = ctx.companyName?.trim();
    overviewRows.push(
      overviewRow(
        "Contact",
        company
          ? `${escapeHtml(contact)} · ${escapeHtml(company)}`
          : escapeHtml(contact),
      ),
    );
  }
  if (ctx.actorLabel?.trim()) {
    overviewRows.push(overviewRow("Updated by", escapeHtml(ctx.actorLabel.trim())));
  }

  const overviewHtml =
    overviewRows.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;margin-top:12px;">${overviewRows.join("")}</table>`
      : "";

  const summaryHtml = `<div style="background:${visual.summaryBg};border:1px solid ${visual.summaryBorder};border-radius:12px;padding:16px 18px;margin-top:4px;">
    <div style="font-size:11px;letter-spacing:0.1em;color:${visual.accent};font-weight:700;font-family:${FONT};padding-bottom:8px;">SUMMARY</div>
    <div style="font-size:15px;color:${TEXT};line-height:1.6;font-family:${FONT};">${escapeHtml(ctx.message.trim())}</div>
  </div>`;

  const nextStep = ctx.nextStep?.trim();
  const footerLeft = nextStep || "Review this update in CRM and take the next step.";
  const footerRight = "Open the record for full details and history.";

  const crmLink = ctx.href?.trim() || "";
  const cta = crmLink ? ctaButton(crmLink, "Open in CRM") : "";
  const ctaRow = cta
    ? `<tr><td style="padding:8px 28px 20px;text-align:center;">${cta}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:${CARD};border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
<tr><td style="background:${HEADER_BG};padding:0;border-bottom:3px solid ${visual.accent};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:22px 28px 24px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:11px;letter-spacing:0.14em;color:${HEADER_TEXT_MUTED};font-weight:600;font-family:${FONT};">${escapeHtml(seller.toUpperCase())}</td>
          <td align="right" valign="top"><span style="display:inline-block;background:${visual.pillBg};color:#ffffff;font-size:11px;font-weight:600;padding:5px 12px;border-radius:999px;font-family:${FONT};">${escapeHtml(visual.pill)}</span></td>
        </tr></table>
        <div style="padding-top:12px;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;font-family:${FONT};">${escapeHtml(ctx.title.trim())}</div>
        <div style="padding-top:8px;font-size:13px;color:${HEADER_TEXT_MUTED};line-height:1.5;font-family:${FONT};">${escapeHtml(subtitle)}</div>
      </td>
      <td align="right" valign="middle" style="padding:22px 28px 24px 0;width:96px;">
        ${logoHeaderHtml(ctx.logoUrl, seller)}
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:20px 28px 8px;font-size:15px;color:${TEXT};line-height:1.6;font-family:${FONT};">
  Hi team,<br><br>You have a new CRM notification.
</td></tr>
<tr><td style="padding:0 28px 8px;">
  <div style="font-size:11px;letter-spacing:0.1em;color:${visual.accent};font-weight:700;font-family:${FONT};padding-bottom:8px;">DETAILS</div>
  ${summaryHtml}
  ${overviewHtml}
</td></tr>
${ctaRow}
<tr><td style="padding:8px 28px 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${visual.summaryBg};border:1px solid ${visual.summaryBorder};border-radius:12px;">
    <tr>
      <td style="width:50%;vertical-align:top;padding:18px 20px;border-right:1px solid ${visual.summaryBorder};">
        <div style="font-size:11px;letter-spacing:0.1em;color:${visual.accent};font-weight:700;font-family:${FONT};padding-bottom:6px;">NEXT STEP</div>
        <div style="font-size:14px;color:${TEXT};line-height:1.55;font-family:${FONT};">${escapeHtml(footerLeft)}</div>
      </td>
      <td style="width:50%;vertical-align:top;padding:18px 20px;">
        <div style="font-size:11px;letter-spacing:0.1em;color:${visual.accent};font-weight:700;font-family:${FONT};padding-bottom:6px;">IN CRM</div>
        <div style="font-size:14px;color:${TEXT};line-height:1.55;font-family:${FONT};">${
          crmLink
            ? linkCell(crmLink, "View record")
            : escapeHtml(footerRight)
        }</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:0 28px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
    <tr>
      <td style="padding:14px 0 0;font-size:11px;color:${MUTED};font-family:${FONT};">${escapeHtml(seller)} · CRM notification</td>
      <td align="right" style="padding:14px 0 0;font-size:11px;color:${MUTED};font-family:${FONT};">Automated — do not reply to this mailbox.</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
