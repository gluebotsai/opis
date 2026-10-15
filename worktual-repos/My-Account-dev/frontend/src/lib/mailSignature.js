import brandLogoUrl from "../assets/worktual-ui-logo.png";
import { fetchJson } from "./http.js";
import { getAuthToken } from "./auth.js";
import { getCustomerToken } from "./customerAuth.js";

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

export function buildDefaultSignatureHtml({
  displayName = "",
  email = "",
  jobTitle = "",
  phone = "",
  extension = "",
  location = "Chennai, TN",
  website = "www.worktual.com",
} = {}) {
  const name = displayName || "Your Name";
  const role = jobTitle || "Your Role";
  const mail = email || "you@worktual.com";
  const phoneValue = phone || "";
  const extValue = extension || "";
  const siteHref = /^https?:\/\//i.test(website) ? website : `https://${website}`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333;line-height:1.45;">
  <p style="margin:0 0 14px;font-size:14px;color:#111;">Thanks &amp; Regards</p>
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
    <tr>
      <td style="padding:0 16px 0 0;vertical-align:middle;">
        <img src="${brandLogoUrl}" alt="Worktual" width="72" height="72" style="display:block;border:0;border-radius:12px;width:72px;height:72px;object-fit:cover;" />
      </td>
      <td style="width:1px;padding:0;background:#d0d0d0;"></td>
      <td style="padding:0 0 0 16px;vertical-align:middle;">
        <div style="font-size:16px;font-weight:700;color:#111;margin:0 0 2px;">${name}</div>
        <div style="color:#666;margin:0 0 10px;">${role}</div>
        <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:360px;color:#666;font-size:13px;">
          <tr>
            <td style="padding:0 12px 4px 0;"><a href="mailto:${mail}" style="color:#1869d3;text-decoration:underline;">${mail}</a></td>
            <td style="padding:0 0 4px;white-space:nowrap;">${extValue ? `Extn: ${extValue}` : ""}</td>
          </tr>
          <tr>
            <td style="padding:0 12px 4px 0;">${phoneValue}</td>
            <td style="padding:0 0 4px;white-space:nowrap;">${location}</td>
          </tr>
        </table>
        <div style="margin-top:6px;">
          <a href="${siteHref}" style="color:#1869d3;text-decoration:underline;" target="_blank" rel="noreferrer">${website.replace(/^https?:\/\//i, "")}</a>
        </div>
      </td>
    </tr>
  </table>
</div>`;
}
export async function fetchMailSignature(mailbox = "finance") {
  const params = mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : "";
  return fetchJson(`/api/mail/signature${params}`, mailFetchOptions());
}

export async function saveMailSignature(htmlBody, mailbox = "finance") {
  return fetchJson(
    "/api/mail/signature",
    mailFetchOptions({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ htmlBody, mailbox }),
    }),
  );
}

export function wrapSignatureHtml(signatureHtml = "") {
  const signature = String(signatureHtml || "").trim();
  if (!signature) {
    return "";
  }
  return `<div data-mail-signature="1" class="mail-signature-block">${signature}</div>`;
}

export function bodyAlreadyHasSignature(bodyHtml = "", signatureHtml = "") {
  const body = String(bodyHtml || "");
  const signature = String(signatureHtml || "").trim();
  if (!signature) {
    return true;
  }
  if (/data-mail-signature\s*=\s*["']?1["']?/i.test(body) || body.includes("mail-signature-block")) {
    return true;
  }
  const sample = signature.replace(/\s+/g, " ").trim().slice(0, 96);
  if (!sample) {
    return false;
  }
  return body.replace(/\s+/g, " ").includes(sample);
}

export function appendSignatureToHtml(bodyHtml = "", signatureHtml = "") {
  const body = String(bodyHtml || "").trim();
  const signature = String(signatureHtml || "").trim();

  if (!signature) {
    return body;
  }

  if (bodyAlreadyHasSignature(body, signature)) {
    return body || wrapSignatureHtml(signature);
  }

  const wrapped = wrapSignatureHtml(signature);
  if (!body) {
    return wrapped;
  }

  return `${body}<br/><br/>${wrapped}`;
}

export function htmlToPlainText(html = "") {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
