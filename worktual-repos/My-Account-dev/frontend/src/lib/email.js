import brandLogoUrl from "../assets/worktual-ui-logo.png";
import { fetchJson } from "./http.js";
import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";
import { formatPaymentAmount, resolveQuoteSessionPaymentTotals } from "./paymentAmount.js";

export const WORKTUAL_BRAND_LOGO_CID = "worktual-brand-logo";

const SIDEBAR_DARK = "#0B0B10";

let cachedBrandLogoAttachment = null;

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatQuoteTotal(amount, currency = "INR") {
  const value = Number(amount) || 0;
  if (Number.isInteger(value) || value % 1 === 0) {
    return `${currency} ${Math.round(value).toLocaleString("en-IN")}`;
  }

  return formatPaymentAmount(value, currency);
}

function resolveAssignmentImplementationAmount(config = {}) {
  if (config.implementationPurchased === true) {
    return 0;
  }
  if (config.implementationEnabled !== true) {
    return 0;
  }
  return Number(config.implementationFee || config.implementationCost || 0) || 0;
}

/**
 * One-time implementation / setup lines for the finance review email.
 * Matched to productSummary by index (same order as assignments).
 */
function resolveImplementationLines(quoteSession) {
  const assignments = quoteSession?.assignments || [];
  const productSummary = quoteSession?.productSummary || [];
  const lines = [];

  for (const [index, assignment] of assignments.entries()) {
    const config = assignment?.config || {};
    const amount = resolveAssignmentImplementationAmount(config);
    if (amount <= 0) {
      continue;
    }

    const summary = productSummary[index] || {};
    const currency = config.currency || "INR";
    lines.push({
      name: `${summary.name || assignment.productId || "Product"} — Implementation`,
      location: summary.branchLabel || summary.billingLabel || "—",
      amount: formatQuoteTotal(amount, currency),
      amountValue: amount,
      currency,
    });
  }

  return lines;
}

function resolveAttachmentNames(fileName, quoteSession) {
  if (quoteSession?.invoices?.length > 1) {
    return quoteSession.invoices.map((entry) => entry.fileName).filter(Boolean);
  }

  return [fileName].filter(Boolean);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function loadWorktualBrandLogoAttachment() {
  if (cachedBrandLogoAttachment) {
    return cachedBrandLogoAttachment;
  }

  const response = await fetch(brandLogoUrl);
  if (!response.ok) {
    throw new Error("Could not load Worktual brand logo for email.");
  }

  const contentBase64 = arrayBufferToBase64(await response.arrayBuffer());
  cachedBrandLogoAttachment = {
    fileName: "worktual-ui-logo.png",
    contentType: "image/png",
    contentBase64,
    contentId: WORKTUAL_BRAND_LOGO_CID,
    isInline: true,
  };
  return cachedBrandLogoAttachment;
}

export function resolveCidPreviewHtml(htmlBody = "", inlineAttachments = []) {
  if (!htmlBody?.trim() || !inlineAttachments.length) {
    return htmlBody;
  }

  let resolved = htmlBody;
  for (const attachment of inlineAttachments) {
    const contentId = String(attachment.contentId || "")
      .replace(/^<|>$/g, "")
      .trim();
    const contentBase64 = attachment.contentBase64;
    if (!contentId || !contentBase64) {
      continue;
    }
    const contentType = attachment.contentType || "image/png";
    const dataUrl = `data:${contentType};base64,${contentBase64}`;
    const pattern = new RegExp(`cid:<?${contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>?`, "gi");
    resolved = resolved.replace(pattern, dataUrl);
  }
  return resolved;
}

function buildFinanceReviewHtml({
  companyName,
  contactName,
  workEmail,
  tenantId,
  industryType,
  totalLabel,
  productLines,
  implementationLines = [],
  implementationTotalLabel = "",
  attachmentNames,
}) {
  const productRowsHtml = productLines.length
    ? productLines
        .map(
          (line) =>
            `<div style="margin:0 0 8px;"><strong>${escapeHtml(line.name)}</strong><br /><span style="color:#64748b;">${escapeHtml(line.location)}</span> — ${escapeHtml(line.amount)}</div>`,
        )
        .join("")
    : `<div style="color:#64748b;">No products listed.</div>`;

  const implementationRowsHtml = implementationLines.length
    ? implementationLines
        .map(
          (line) =>
            `<div style="margin:0 0 8px;"><strong>${escapeHtml(line.name)}</strong><br /><span style="color:#64748b;">${escapeHtml(line.location)}</span> — ${escapeHtml(line.amount)}</div>`,
        )
        .join("")
    : "";

  const implementationSectionHtml = implementationLines.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:16px 18px;font-size:14px;line-height:1.55;color:#1a2332;">
                    <div style="margin:0 0 10px;font-weight:700;">Implementation cost</div>
                    ${implementationRowsHtml}
                    ${
                      implementationTotalLabel
                        ? `<div style="margin:12px 0 0;padding-top:10px;border-top:1px solid #e2e8f0;"><strong>Implementation total:</strong> ${escapeHtml(implementationTotalLabel)}</div>`
                        : ""
                    }
                  </td>
                </tr>
              </table>`
    : "";

  const attachmentLabel =
    attachmentNames.length > 1
      ? attachmentNames.map((name) => escapeHtml(name)).join(", ")
      : escapeHtml(attachmentNames[0] || "Invoice.pdf");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ready for review</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a2332;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:${SIDEBAR_DARK};padding:20px 28px;">
              <img src="cid:${WORKTUAL_BRAND_LOGO_CID}" alt="Worktual" width="160" style="display:block;height:auto;max-width:160px;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Dear Finance Team,</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#334155;">
                Sales has submitted a new invoice for your review.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px;">
                <tr>
                  <td style="padding:16px 18px;font-size:14px;line-height:1.7;color:#1a2332;">
                    <div><strong>Company:</strong> ${escapeHtml(companyName)}</div>
                    <div><strong>Tenant ID:</strong> ${escapeHtml(tenantId)}</div>
                    <div><strong>Contact:</strong> ${escapeHtml(contactName)}</div>
                    <div><strong>Email:</strong> ${escapeHtml(workEmail)}</div>
                    <div><strong>Industry:</strong> ${escapeHtml(industryType)}</div>
                    ${
                      implementationTotalLabel
                        ? `<div><strong>Implementation cost:</strong> ${escapeHtml(implementationTotalLabel)}</div>`
                        : ""
                    }
                    <div><strong>Total value:</strong> ${escapeHtml(totalLabel)}</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:16px 18px;font-size:14px;line-height:1.55;color:#1a2332;">
                    <div style="margin:0 0 10px;font-weight:700;">Products</div>
                    ${productRowsHtml}
                  </td>
                </tr>
              </table>
              ${implementationSectionHtml}
              <p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#64748b;">
                Attached: ${attachmentLabel}
              </p>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#64748b;">
                Please review the attached invoice and approve or reject it in the Finance queue.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
              Regards,<br />Worktual Sales Team
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildDefaultEmailDraft(lead, fileName, financeTeamEmails = "", quoteSession = null) {
  const companyName = lead.companyName || "Unknown company";
  const contactName = lead.contactName || "—";
  const workEmail = lead.workEmail || "—";
  const tenantId = lead.tenantId || "—";
  const industryType = lead.industryType || "—";
  const productSummary = quoteSession?.productSummary || [];
  const paymentTotals = quoteSession ? resolveQuoteSessionPaymentTotals(quoteSession) : null;
  const attachmentNames = resolveAttachmentNames(fileName, quoteSession);
  const financeTo = Array.isArray(financeTeamEmails)
    ? financeTeamEmails.filter(Boolean).join(", ")
    : String(financeTeamEmails || "").trim();
  const currency = paymentTotals?.currency || "INR";
  const totalLabel = formatQuoteTotal(paymentTotals?.grandTotal ?? 0, currency);
  const isOtcPhase =
    quoteSession?.billingPhase === "implementation" ||
    paymentTotals?.billingPhase === "implementation" ||
    (quoteSession?.assignments || []).some((entry) => {
      const config = entry?.config || {};
      if (config.implementationPurchased === true || config.implementationEnabled === false) {
        return false;
      }
      return Number(config.implementationFee ?? config.implementationCost ?? 0) > 0;
    });
  const productLines = productSummary.map((item) => ({
    name: item.name || "—",
    location: item.branchLabel || item.billingLabel || "—",
    amount: item.priceLabel || "—",
  }));
  // When product lines already carry OTC/implementation amounts, skip the duplicate section.
  const productSummaryLooksOtc = productSummary.some((item) =>
    String(item.name || "").toLowerCase().includes("implementation"),
  );
  const implementationLines =
    isOtcPhase && productSummaryLooksOtc ? [] : resolveImplementationLines(quoteSession);
  const implementationTotal = implementationLines.reduce(
    (sum, line) => sum + (Number(line.amountValue) || 0),
    0,
  );
  const implementationTotalLabel =
    isOtcPhase && productSummaryLooksOtc
      ? paymentTotals?.subtotal != null && Number(paymentTotals.subtotal) > 0
        ? formatQuoteTotal(paymentTotals.subtotal, currency)
        : ""
      : implementationTotal > 0
        ? formatQuoteTotal(implementationTotal, currency)
        : "";

  const productPlain = productLines.length
    ? productLines
        .map((line) => `- ${line.name} — ${line.location} — ${line.amount}`)
        .join("\n")
    : "- No products listed.";

  const implementationPlain = implementationLines.length
    ? [
        "",
        "Implementation cost",
        "-------------------",
        ...implementationLines.map(
          (line) => `- ${line.name} — ${line.location} — ${line.amount}`,
        ),
        `Implementation total: ${implementationTotalLabel}`,
      ].join("\n")
    : "";

  const attachmentPlain =
    attachmentNames.length > 1
      ? attachmentNames.join(", ")
      : attachmentNames[0] || fileName || "Invoice.pdf";

  const body = `Dear Finance Team,

Sales has submitted a new invoice for your review.

Invoice details
---------------
Company: ${companyName}
Tenant ID: ${tenantId}
Contact: ${contactName}
Email: ${workEmail}
Industry: ${industryType}
${implementationTotalLabel ? `Implementation cost: ${implementationTotalLabel}\n` : ""}Total value: ${totalLabel}

Products
--------
${productPlain}
${implementationPlain}

Attached: ${attachmentPlain}

Please review the attached invoice and approve or reject it in the Finance queue.

Regards,
Worktual Sales Team`;

  const htmlBody = buildFinanceReviewHtml({
    companyName,
    contactName,
    workEmail,
    tenantId,
    industryType,
    totalLabel,
    productLines,
    implementationLines,
    implementationTotalLabel,
    attachmentNames,
  });

  return {
    to: financeTo,
    cc: "",
    bcc: "",
    subject: `Invoice ready for review — ${companyName} (${tenantId})`,
    body,
    htmlBody,
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

export const MAIL_OAUTH_MESSAGE_TYPE = "worktual-mail-oauth";
export const MAIL_OAUTH_POPUP_NAME = "worktual_outlook_oauth";
const MAIL_OAUTH_CHANNEL = "worktual-mail-oauth";
const MAIL_OAUTH_PENDING_KEY = "worktual-mail-oauth-pending";

/** Internal staff roles that use the Outlook mail workspace. */
const MAIL_ACCESS_ROLES = new Set([
  "sales",
  "sales_admin",
  "finance",
  "admin",
  "number_management",
]);

export function roleHasMailAccess(role) {
  return MAIL_ACCESS_ROLES.has(String(role || "").trim());
}

export function mailConfigNeedsOutlookConnect(config) {
  if (!config?.microsoftConfigured) {
    return false;
  }
  return Boolean(config.needsOutlookConnect || config.needsReauth);
}

export function buildMailOAuthReturnTo(originPath = "/mail", { popup = true } = {}) {
  const origin = originPath || "/mail";
  if (!popup) {
    return origin;
  }

  const params = new URLSearchParams({ redirect: origin });
  return `/mail/oauth-callback?${params.toString()}`;
}

export function markMailOAuthPopupPending() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(MAIL_OAUTH_PENDING_KEY, String(Date.now()));
  } catch {
    // Storage may be blocked.
  }
}

export function clearMailOAuthPopupPending() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(MAIL_OAUTH_PENDING_KEY);
  } catch {
    // Storage may be blocked.
  }
}

/** True when a popup OAuth flow was started recently (e.g. from Sign in). */
export function isMailOAuthPopupPending() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const pendingAt = Number(localStorage.getItem(MAIL_OAUTH_PENDING_KEY));
    return Boolean(pendingAt) && Date.now() - pendingAt < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

function isMailOAuthPopupWindow() {
  if (typeof window === "undefined") {
    return false;
  }

  // Only treat this window as the OAuth popup when it actually is one.
  // Do not use the pending localStorage flag — that is shared with the opener
  // tab and incorrectly makes the main Mail page behave like a popup.
  if (window.name === MAIL_OAUTH_POPUP_NAME) {
    return true;
  }

  if (window.opener && !window.opener.closed) {
    return true;
  }

  if (window.location.pathname === "/mail/oauth-callback") {
    return true;
  }

  return false;
}

function broadcastMailOAuthResult(payload) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const channel = new BroadcastChannel(MAIL_OAUTH_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // BroadcastChannel may be unavailable.
  }

  try {
    localStorage.setItem(MAIL_OAUTH_CHANNEL, JSON.stringify({ ...payload, ts: Date.now() }));
    localStorage.removeItem(MAIL_OAUTH_CHANNEL);
  } catch {
    // Storage may be blocked in private mode.
  }
}

/**
 * Open Microsoft OAuth in a named popup/tab.
 * Prefer navigating an existing blank tab from a user gesture; otherwise open
 * the Microsoft URL directly (avoids a blank-tab flash). Falls back to
 * same-tab navigation if the popup is blocked.
 */
export function openMailOAuthPopup(url, { popup = null } = {}) {
  if (typeof window === "undefined" || !url) {
    return { opened: false, fallbackUsed: false };
  }

  if (popup && !popup.closed) {
    try {
      popup.location.href = url;
      popup.focus?.();
      return { opened: true, fallbackUsed: false, popup };
    } catch {
      window.location.href = url;
      return { opened: false, fallbackUsed: true };
    }
  }

  const target = window.open(url, MAIL_OAUTH_POPUP_NAME);
  if (target && !target.closed) {
    try {
      target.focus?.();
    } catch {
      // Ignore focus errors.
    }
    return { opened: true, fallbackUsed: false, popup: target };
  }

  window.location.href = url;
  return { opened: false, fallbackUsed: true };
}

/**
 * Same-tab Microsoft Outlook OAuth redirect (login + auto-connect flows).
 * Returns { redirected: true } after navigation is triggered.
 */
export async function startMailOAuthRedirect(returnTo = "/mail") {
  const data = await fetchMailOAuthConnectUrl(returnTo || "/mail");
  if (!data?.url || typeof window === "undefined") {
    return { redirected: false, url: null, state: data?.state || null };
  }

  window.location.assign(data.url);
  return { redirected: true, url: data.url, state: data.state };
}

/**
 * Fetch the Outlook connect URL and open Microsoft sign-in.
 * @param {string} originPath Return path after OAuth
 * @param {{ mode?: "popup" | "redirect", popup?: Window | null }} [options]
 *   - popup (default): named popup/tab with same-tab fallback
 *   - redirect: force same-tab navigation
 *   - popup window: reuse a blank tab opened during a user gesture (e.g. Sign in)
 */
export async function startMailOAuthConnect(
  originPath = "/mail",
  { mode = "popup", popup: existingPopup = null } = {},
) {
  if (mode === "redirect") {
    const result = await startMailOAuthRedirect(originPath);
    return {
      opened: false,
      fallbackUsed: result.redirected,
      redirected: result.redirected,
      url: result.url,
      state: result.state,
    };
  }

  const popup = existingPopup && !existingPopup.closed ? existingPopup : null;
  // Assume a popup/tab when we already have a gesture-opened window, or when we
  // will try window.open after the URL is ready. Callback returnTo uses popup=true
  // so the OAuth tab can close itself after success.
  const preferPopup = Boolean(popup) || typeof window !== "undefined";
  if (preferPopup) {
    markMailOAuthPopupPending();
  }

  const returnTo = buildMailOAuthReturnTo(originPath, { popup: preferPopup });

  try {
    const data = await fetchMailOAuthConnectUrl(returnTo);
    if (!data?.url) {
      if (popup && !popup.closed) {
        popup.close();
      }
      clearMailOAuthPopupPending();
      return { opened: false, fallbackUsed: false, url: null };
    }

    const result = openMailOAuthPopup(data.url, { popup });
    if (result.fallbackUsed) {
      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch {
          // Ignore.
        }
      }
      clearMailOAuthPopupPending();
    }
    return { ...result, url: data.url, state: data.state };
  } catch (error) {
    if (popup && !popup.closed) {
      popup.close();
    }
    clearMailOAuthPopupPending();
    throw error;
  }
}

function focusMailOAuthOpener() {
  if (typeof window === "undefined" || !window.opener || window.opener.closed) {
    return;
  }

  try {
    window.opener.focus?.();
  } catch {
    // Opener may be unavailable.
  }
}

function scheduleClosePopupTab() {
  for (const delay of [0, 120, 400, 1000]) {
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // Browsers may ignore close() if this tab was not script-opened.
      }
    }, delay);
  }
}

/** Notify the opener tab that OAuth finished, then close this popup tab. */
export function notifyMailOAuthOpener({ status, email = "", message = "" } = {}) {
  if (typeof window === "undefined") {
    return false;
  }

  const payload = {
    type: MAIL_OAUTH_MESSAGE_TYPE,
    status,
    email,
    message,
  };

  let notified = false;
  focusMailOAuthOpener();
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin);
      notified = true;
    } catch {
      // Opener may be cross-origin or gone.
    }
  }

  broadcastMailOAuthResult(payload);
  scheduleClosePopupTab();

  return notified || true;
}

export function finishMailOAuthPopup(result = {}) {
  notifyMailOAuthOpener(result);
}

export { isMailOAuthPopupWindow };

/** Subscribe to mail OAuth completion messages from the popup tab. */
export function subscribeMailOAuthResult(handler) {
  if (typeof window === "undefined" || typeof handler !== "function") {
    return () => {};
  }

  function deliver(data) {
    if (!data || data.type !== MAIL_OAUTH_MESSAGE_TYPE) {
      return;
    }
    handler(data);
  }

  function onMessage(event) {
    if (event.origin !== window.location.origin) {
      return;
    }
    deliver(event.data);
  }

  function onStorage(event) {
    if (event.key !== MAIL_OAUTH_CHANNEL || !event.newValue) {
      return;
    }
    try {
      deliver(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed storage payloads.
    }
  }

  let channel = null;
  try {
    channel = new BroadcastChannel(MAIL_OAUTH_CHANNEL);
    channel.onmessage = (event) => deliver(event.data);
  } catch {
    // BroadcastChannel may be unavailable.
  }

  window.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
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
  { forceRefresh = false, view = null } = {},
) {
  return fetchJson(
    `/api/mail/workspace${mailboxQuery(mailbox, {
      folder,
      limit,
      refresh: forceRefresh ? "true" : undefined,
      view: view || undefined,
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
  { forceRefresh = false, view = null } = {},
) {
  return fetchJson(
    `/api/mail/messages${mailboxQuery(mailbox, {
      folder,
      limit,
      refresh: forceRefresh ? "true" : undefined,
      view: view || undefined,
    })}`,
    mailFetchOptions(),
  );
}

/**
 * Message ids (esp. Microsoft Graph) may contain `/`. Prefer query `uid=` so
 * proxies that decode `%2F` cannot break Fastify `:uid` path matching.
 */
export async function fetchMailMessage(uid, folder = "inbox", mailbox = "finance") {
  return fetchJson(
    `/api/mail/messages/item${mailboxQuery(mailbox, { folder, uid })}`,
    mailFetchOptions(),
  );
}

/**
 * Graph attachment ids are frequently 150+ chars (and may contain `/`), which
 * exceeds Fastify's default `maxParamLength` (100) if placed in the URL path.
 * Send it as a query param against the fixed `/item` route instead.
 */
export async function fetchMailAttachment(uid, attachmentId, folder = "inbox", mailbox = "finance") {
  return fetchJson(
    `/api/mail/messages/item/attachments/item${mailboxQuery(mailbox, { folder, uid, attachmentId })}`,
    mailFetchOptions(),
  );
}

export async function moveMailMessage(uid, folder, destinationFolder, mailbox = "finance") {
  return fetchJson(
    `/api/mail/messages/item/move${mailboxQuery(mailbox, { folder, uid })}`,
    mailFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinationFolder, folder }),
    }),
  );
}

export async function flagMailMessage(uid, folder, flagged, mailbox = "finance") {
  return fetchJson(
    `/api/mail/messages/item/flag${mailboxQuery(mailbox, { folder, uid })}`,
    mailFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flagged, folder }),
    }),
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
