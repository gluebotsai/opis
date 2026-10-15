import { fetchJson } from "./http.js";
import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";
import { formatPaymentAmount, resolveQuoteSessionPaymentTotals } from "./paymentAmount.js";

function mailAuthHeaders() {
  const internalToken = getAuthToken();
  if (internalToken) {
    return { Authorization: `Bearer ${internalToken}` };
  }

  const customerToken = getCustomerToken();
  if (customerToken) {
    return { Authorization: `Bearer ${customerToken}` };
  }

  return {};
}

function mailFetchOptions(options = {}) {
  return {
    ...options,
    headers: {
      ...mailAuthHeaders(),
      ...(options.headers || {}),
    },
  };
}

function formatMarkdownTable(headers, rows, rightAlignedColumns = []) {
  if (!headers.length) {
    return "";
  }

  const columnWidths = headers.map((header, columnIndex) => {
    const cellLengths = rows.map((row) => String(row[columnIndex] ?? "").length);
    return Math.max(header.length, ...cellLengths);
  });

  const formatCell = (value, columnIndex) => {
    const text = String(value ?? "");
    return rightAlignedColumns.includes(columnIndex)
      ? text.padStart(columnWidths[columnIndex])
      : text.padEnd(columnWidths[columnIndex]);
  };

  const headerLine = `| ${headers.map((header, index) => formatCell(header, index)).join(" | ")} |`;
  const separatorLine = `| ${headers
    .map((header, index) => {
      const dashes = "-".repeat(columnWidths[index]);
      return rightAlignedColumns.includes(index) ? dashes.padStart(columnWidths[index]) : dashes;
    })
    .join(" | ")} |`;
  const rowLines = rows.map(
    (row) => `| ${row.map((cell, index) => formatCell(cell, index)).join(" | ")} |`,
  );

  return [headerLine, separatorLine, ...rowLines].join("\n");
}

function formatQuoteTotal(amount, currency = "INR") {
  const value = Number(amount) || 0;
  if (Number.isInteger(value) || value % 1 === 0) {
    return `${currency} ${Math.round(value).toLocaleString("en-IN")}`;
  }

  return formatPaymentAmount(value, currency);
}

function resolveFinancePortalUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/finance/queue`;
  }

  const appUrl = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "");
  return appUrl ? `${appUrl}/finance/queue` : "/finance/queue";
}

function resolveAttachmentNames(fileName, quoteSession) {
  if (quoteSession?.invoices?.length > 1) {
    return quoteSession.invoices.map((entry) => entry.fileName).filter(Boolean);
  }

  return [fileName].filter(Boolean);
}

export function buildDefaultEmailDraft(lead, fileName, financeTeamEmail = "", quoteSession = null) {
  const companyName = lead.companyName || "Unknown company";
  const contactName = lead.contactName || "—";
  const workEmail = lead.workEmail || "—";
  const domainId = lead.domainId || "—";
  const industryType = lead.industryType || "—";
  const financePortalUrl = resolveFinancePortalUrl();
  const branchSummary = quoteSession?.branchSummary || null;
  const productSummary = quoteSession?.productSummary || [];
  const paymentTotals = quoteSession ? resolveQuoteSessionPaymentTotals(quoteSession) : null;
  const attachmentNames = resolveAttachmentNames(fileName, quoteSession);

  const quotationSummaryTable = formatMarkdownTable(
    ["Description", "Value"],
    [
      ["Products", String(branchSummary?.productCount ?? productSummary.length ?? "—")],
      ["Branches", String(branchSummary?.branchCount ?? "—")],
      ["Billing Groups", String(branchSummary?.billingGroupCount ?? "—")],
      [
        "Total Quotation Value",
        `**${formatQuoteTotal(paymentTotals?.grandTotal ?? 0, paymentTotals?.currency || "INR")}**`,
      ],
    ],
    [1],
  );

  const productsTable = productSummary.length
    ? formatMarkdownTable(
        ["Product", "Location", "Amount"],
        productSummary.map((item) => [
          item.name || "—",
          item.branchLabel || item.billingLabel || "—",
          item.priceLabel || "—",
        ]),
        [2],
      )
    : "_No products listed._";

  const attachmentBlock =
    attachmentNames.length > 1
      ? attachmentNames.map((name) => `📄 **${name}**`).join("\n")
      : `📄 **${attachmentNames[0] || fileName || "Quotation.pdf"}**`;

  const body = `Dear Finance Team,

A new customer quotation has been submitted by the Sales Team and requires your review.

---

### Customer Information

**Company:** ${companyName}
**Domain ID:** ${domainId}
**Primary Contact:** ${contactName}
**Email:** ${workEmail}
**Industry:** ${industryType}

---

### Quotation Summary

${quotationSummaryTable}

---

### Products Included

${productsTable}

---

### Action Required

Please review the attached quotation and record your decision in the Finance Portal.

**Approve / Reject Quotation**
${financePortalUrl}

---

### Attached Document

${attachmentBlock}

The attachment contains the complete quotation, including the selected products, package configuration, pricing, taxes, and billing information.

After your approval, the Sales Team will be notified automatically and can proceed with sending the customer invoice.

Thank you for your prompt review.

Kind regards,

**Worktual Sales Team**
*Worktual Platform*`;

  return {
    to: financeTeamEmail,
    cc: "",
    bcc: "",
    subject: `New quotation submitted for finance review — ${companyName} (${domainId})`,
    body,
    attachmentName: fileName,
  };
}

function mailboxQuery(mailbox, extraParams = {}) {
  const params = new URLSearchParams();

  if (mailbox) {
    params.set("mailbox", mailbox);
  }

  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchMailOAuthConnectUrl(returnTo = "/mail") {
  const params = new URLSearchParams({ returnTo });
  return fetchJson(`/api/mail/oauth/connect?${params.toString()}`, mailFetchOptions());
}

export async function fetchMailOAuthStatus() {
  return fetchJson("/api/mail/oauth/status", mailFetchOptions());
}

export async function disconnectMailOAuth() {
  return fetchJson(
    "/api/mail/oauth/disconnect",
    mailFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
}

export async function fetchMailConfigStatus(mailbox = "finance") {
  return fetchJson(`/api/mail/config${mailboxQuery(mailbox)}`, mailFetchOptions());
}

export async function fetchMailWorkspace(
  folder = "inbox",
  limit = 30,
  mailbox = "finance",
  { forceRefresh = false } = {},
) {
  return fetchJson(
    `/api/mail/workspace${mailboxQuery(mailbox, {
      folder,
      limit,
      refresh: forceRefresh ? "true" : undefined,
    })}`,
    mailFetchOptions(),
  );
}

export async function sendMail(payload, mailbox = "finance") {
  return fetchJson(
    "/api/mail/send",
    mailFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, mailbox }),
    }),
  );
}

export function queueMailSend(payload, mailbox = "finance") {
  void sendMail(payload, mailbox).catch((error) => {
    console.error("Background mail send failed:", error);
  });
}

export async function fetchInbox(limit = 20, mailbox = "finance") {
  return fetchJson(`/api/mail/inbox${mailboxQuery(mailbox, { limit })}`, mailFetchOptions());
}

export async function fetchMailMessages(
  folder = "inbox",
  limit = 30,
  mailbox = "finance",
  { forceRefresh = false } = {},
) {
  return fetchJson(
    `/api/mail/messages${mailboxQuery(mailbox, {
      folder,
      limit,
      refresh: forceRefresh ? "true" : undefined,
    })}`,
    mailFetchOptions(),
  );
}

export async function fetchMailMessage(uid, folder = "inbox", mailbox = "finance") {
  return fetchJson(
    `/api/mail/messages/${encodeURIComponent(uid)}${mailboxQuery(mailbox, { folder })}`,
    mailFetchOptions(),
  );
}

export async function fetchMailAttachment(uid, attachmentId, folder = "inbox", mailbox = "finance") {
  return fetchJson(
    `/api/mail/messages/${encodeURIComponent(uid)}/attachments/${encodeURIComponent(attachmentId)}${mailboxQuery(mailbox, { folder })}`,
    mailFetchOptions(),
  );
}

export function buildReplyDraft(message) {
  const replyTo = message.fromEmail || extractEmailAddress(message.from);
  const subject = message.subject || "";
  const normalizedSubject = /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;

  return {
    to: replyTo,
    subject: normalizedSubject,
    body: `\n\n---\nOn ${message.date ? new Date(message.date).toLocaleString() : "earlier"}, ${message.from || "sender"} wrote:\n\n${message.body || message.preview || ""}`,
  };
}

function extractEmailAddress(value) {
  const raw = String(value || "").trim();
  const named = raw.match(/<([^>]+)>/);
  if (named) {
    return named[1].trim();
  }

  if (raw.includes("@")) {
    return raw;
  }

  return "";
}
