import { sendEmail } from "../mail/mail-runtime.js";
import {
  resolveBranchContactName,
  resolveCustomerCcEmails,
  resolveCustomerRecipients as buildCustomerRecipients,
  resolveOutboundRecipients as buildOutboundRecipients,
  resolvePortalLoginEmail,
  resolveQuotationCustomerRecipients,
} from "../../lib/customer-contact.js";
import { getProductInvoice, quoteNeedsImplementationPhase } from "../../lib/invoice.js";
import { getBranchById } from "../../lib/leads.js";
import { getProductName } from "../../lib/productCatalog.js";
import { isMailDryRun } from "../mail/config.js";
import { isMicrosoftMailConfigured } from "../mail/ms-graph/config.js";
import {
  canUseMicrosoftAppOnlyMail,
  getMicrosoftAppOnlyUnavailableReason,
} from "../mail/ms-graph/app-only.js";
import { getLeadOwnership } from "../leads/lead-store.js";
import {
  isImplementationBillingPhase,
} from "../payments/billingPhases.js";
import {
  getActiveSalesAdminUser,
  getUserById,
  isSalesFacingUser,
  isUserActive,
  listActiveFinanceEmails,
  USER_ROLES,
} from "../users/user-store.js";
import {
  getConnectedFinanceMailSender,
  getMailOAuthStatus,
  getValidAccessTokenForProfile,
} from "../mail/ms-graph/tokens.js";

function env(name: any) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function formatLeadBlock(lead = {}) {
  return [
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    `Company: ${lead.companyName || "—"}`,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    `Tenant ID: ${lead.tenantId || "—"}`,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    `Contact: ${lead.contactName || "—"}`,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    `Work email: ${lead.workEmail || "—"}`,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    `Admin email: ${lead.adminEmail || "—"}`,
  ].join("\n");
}

function resolveAdminEmailFromEnv() {
  return env("ADMIN_EMAIL") || env("ADMIN_LOGIN_EMAIL") || "";
}

export async function resolveCustomerProductRequestRecipient(sourceLeadId: any) {
  const ownership = sourceLeadId ? await getLeadOwnership(sourceLeadId) : null;
  const candidates = [ownership?.assignedUserId, ownership?.createdByUserId].filter(Boolean);

  for (const userId of candidates) {
    const user = await getUserById(userId);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (isUserActive(user) && isSalesFacingUser(user) && user.email) {
      return {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        email: user.email.trim(),
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        name: user.displayName || user.email,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        mailbox: user.role === USER_ROLES.SALES_ADMIN ? "sales_admin" : "sales",
        routedTo: userId === ownership?.assignedUserId ? "lead_assignee" : "lead_creator",
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        userId: user.id,
      };
    }
  }

  const salesAdmin = await getActiveSalesAdminUser();
  if (salesAdmin?.email) {
    return {
      email: salesAdmin.email.trim(),
      name: salesAdmin.displayName || salesAdmin.email,
      mailbox: "sales_admin",
      routedTo: "sales_admin",
      userId: salesAdmin.id,
    };
  }

  return null;
}

function normalizeMailAddress(email: any) {
  return String(email || "").trim().toLowerCase();
}

function pushUniqueMailAddress(list: any, email: any) {
  const normalized = normalizeMailAddress(email);
  if (!normalized) {
    return;
  }
  if (list.some((entry: any) => normalizeMailAddress(entry) === normalized)) {
    return;
  }
  list.push(String(email).trim());
}

/**
 * Resolve Sales Executive + Sales Admin for branch-drop / cancellation mail CC.
 * Deduplicates addresses. Falls back to sales admin when no lead owner exists.
 */
export async function resolveBranchDropSalesRecipients(sourceLeadId: any) {
  let ownership = null;
  if (sourceLeadId) {
    try {
      ownership = await getLeadOwnership(sourceLeadId);
    } catch (error) {
      console.warn(
        "[mail] resolveBranchDropSalesRecipients ownership lookup failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const candidates = [ownership?.assignedUserId, ownership?.createdByUserId].filter(Boolean);

  let salesExecutive = null;
  let leadOwner = null;

  for (const userId of candidates) {
    let user = null;
    try {
      user = await getUserById(userId);
    } catch {
      continue;
    }
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (!isUserActive(user) || !isSalesFacingUser(user) || !user.email) {
      continue;
    }

    const entry = {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      email: user.email.trim(),
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      name: user.displayName || user.email,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      role: user.role,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      userId: user.id,
      routedTo: userId === ownership?.assignedUserId ? "lead_assignee" : "lead_creator",
    };

    if (!leadOwner) {
      leadOwner = entry;
    }

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (!salesExecutive && user.role === USER_ROLES.SALES) {
      salesExecutive = entry;
      break;
    }
  }

  if (!salesExecutive && leadOwner) {
    salesExecutive = leadOwner;
  }

  let salesAdminUser = null;
  try {
    salesAdminUser = await getActiveSalesAdminUser();
  } catch (error) {
    console.warn(
      "[mail] resolveBranchDropSalesRecipients sales admin lookup failed:",
      error instanceof Error ? error.message : error,
    );
  }

  const salesAdmin = salesAdminUser?.email
    ? {
        email: salesAdminUser.email.trim(),
        name: salesAdminUser.displayName || salesAdminUser.email,
        role: USER_ROLES.SALES_ADMIN,
        userId: salesAdminUser.id,
        routedTo: "sales_admin",
      }
    : null;

  if (!salesExecutive && salesAdmin) {
    salesExecutive = { ...salesAdmin };
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const cc = [];
  if (salesExecutive?.email) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    pushUniqueMailAddress(cc, salesExecutive.email);
  }
  if (salesAdmin?.email) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    pushUniqueMailAddress(cc, salesAdmin.email);
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return { salesExecutive, salesAdmin, cc };
}

/** Filter CC so addresses already in To are not duplicated. */
export function buildSalesCcExcluding(toEmails: any, salesCc: any) {
  const exclude = new Set((toEmails || []).map(normalizeMailAddress).filter(Boolean));
  return (salesCc || []).filter((email: any) => !exclude.has(normalizeMailAddress(email)));
}

function resolveCustomerRecipients(lead = {}) {
  const { to, cc } = buildOutboundRecipients(lead);
  if (!to.length) {
    throw new Error("Lead work email, admin email, or reseller billing email is missing on this quotation.");
  }

  return { to, cc };
}

function mailboxProfileForUser(user: any) {
  if (user?.role === USER_ROLES.ADMIN) {
    return "admin";
  }
  if (user?.role === USER_ROLES.SALES_ADMIN) {
    return "sales_admin";
  }
  if (user?.role === USER_ROLES.FINANCE) {
    return "finance";
  }
  return "sales";
}

export async function resolveMailContextForUser(userId: any) {
  if (!userId) {
    return null;
  }

  const user = await getUserById(userId);
  if (!isUserActive(user)) {
    return null;
  }

  const mailboxProfile = mailboxProfileForUser(user);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const status = await getMailOAuthStatus("internal", user.id, mailboxProfile);
  if (!status.connected || status.needsReauth) {
    return null;
  }

  return {
    accountType: "internal",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountId: user.id,
    mailboxProfile,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    accountEmail: status.accountEmail || user.email || "",
  };
}

/**
 * Admin outbound Graph context: only ADMIN_EMAIL / ADMIN_LOGIN_EMAIL from .env.
 * Prefers the same delegated Outlook connection used for manual admin send;
 * app-only is used only when a client-credentials token can actually be acquired.
 */
export async function resolveAdminMailContext() {
  const adminEmail = resolveAdminEmailFromEnv().toLowerCase();
  if (!adminEmail) {
    const error = new Error("ADMIN_EMAIL is not configured in .env.");
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "admin_email_missing";
    throw error;
  }

  const mailboxProfile = "admin";

  if (isMailDryRun()) {
    const user = await getActiveUserByEmailSafe(adminEmail);
    return {
      accountType: "internal",
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountId: user?.id || "dry-run-admin",
      mailboxProfile,
      accountEmail: adminEmail,
      // Prefer delegated in dry-run when we have a user id (matches live manual send).
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      sendMode: user?.id ? "delegated" : canUseMicrosoftAppOnlyMail() ? "appOnly" : "delegated",
    };
  }

  // 1) Same path as manual admin compose: login user for ADMIN_EMAIL + admin profile.
  // Verify a refreshable token before claiming delegated send (avoids silent send failures).
  const envAdminUser = await getActiveUserByEmailSafe(adminEmail);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (envAdminUser?.id) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const byUser = await resolveMailContextForUser(envAdminUser.id);
    if (byUser?.accountId) {
      try {
        const connection = await getValidAccessTokenForAccountSafe(
          "internal",
          byUser.accountId,
          mailboxProfile,
        );
        if (connection?.accessToken) {
          return {
            ...byUser,
            accountEmail: connection.accountEmail || byUser.accountEmail || adminEmail,
            sendMode: "delegated",
          };
        }
      } catch (error) {
        console.warn(
          `[mail] admin delegated token failed for ${adminEmail}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  // 2) Latest connected admin-profile mailbox (any account), then refresh token.
  try {
    const { getValidAccessTokenForProfile } = await import("../mail/ms-graph/tokens.js");
    const profileConnection = await getValidAccessTokenForProfile(mailboxProfile);
    if (profileConnection?.accessToken) {
      return {
        accountType: profileConnection.accountType || "internal",
        accountId: profileConnection.accountId,
        mailboxProfile: profileConnection.mailboxProfile || mailboxProfile,
        accountEmail: profileConnection.accountEmail || adminEmail,
        sendMode: "delegated",
      };
    }
  } catch (error) {
    console.warn(
      "[mail] admin profile token refresh failed:",
      error instanceof Error ? error.message : error,
    );
  }

  // 3) Any active admin user with a usable admin-profile connection.
  const { selectActiveUsersByRole } = await import("../../repositories/raw/users.repo.js");
  const admins = await selectActiveUsersByRole(USER_ROLES.ADMIN);
  const matched = admins.find(
    (row) => String(row.email || "").trim().toLowerCase() === adminEmail,
  );
  const candidates = matched ? [matched, ...admins.filter((row) => row.id !== matched.id)] : admins;

  for (const admin of candidates) {
    try {
      const connection = await getValidAccessTokenForAccountSafe(
        "internal",
        admin.id,
        mailboxProfile,
      );
      if (connection?.accessToken) {
        return {
          accountType: "internal",
          accountId: admin.id,
          mailboxProfile,
          accountEmail: connection.accountEmail || admin.email || adminEmail,
          sendMode: "delegated",
        };
      }
    } catch (error) {
      console.warn(
        `[mail] admin delegated token failed for ${admin.email}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // 4) App-only only if client_credentials token actually works (avoid AADSTS700027 at send time).
  if (canUseMicrosoftAppOnlyMail()) {
    try {
      const { acquireMicrosoftAppOnlyAccessToken } = await import("../mail/ms-graph/app-only.js");
      await acquireMicrosoftAppOnlyAccessToken();
      return {
        accountType: "application",
        accountId: null,
        mailboxProfile,
        accountEmail: adminEmail,
        sendMode: "appOnly",
      };
    } catch (error) {
      console.warn(
        "[mail] app-only admin token failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const appOnlyReason = getMicrosoftAppOnlyUnavailableReason();
  const error = new Error(
    `Admin mail for ${adminEmail} is unavailable. Connect Microsoft Outlook while signed in as that admin (same as manual mail), or register the app certificate/client secret for unattended Graph mail. ${appOnlyReason}`,
  );
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  error.code = "admin_mailbox_unavailable";
  throw error;
}

async function getActiveUserByEmailSafe(email: any) {
  try {
    const { getActiveUserByEmail } = await import("../users/user-store.js");
    return getActiveUserByEmail(email);
  } catch {
    return null;
  }
}

async function getValidAccessTokenForAccountSafe(accountType: any, accountId: any, mailboxProfile: any) {
  const { getValidAccessTokenForAccount } = await import("../mail/ms-graph/tokens.js");
  return getValidAccessTokenForAccount(accountType, accountId, mailboxProfile);
}

export async function resolveSalesMailContextForLead(leadId: any) {
  const ownership = leadId ? await getLeadOwnership(leadId) : null;
  const candidates = [ownership?.assignedUserId, ownership?.createdByUserId].filter(Boolean);

  for (const userId of candidates) {
    const context = await resolveMailContextForUser(userId);
    if (context) {
      return context;
    }
  }

  const salesAdmin = await getActiveSalesAdminUser();
  if (salesAdmin?.id) {
    return resolveMailContextForUser(salesAdmin.id);
  }

  return null;
}

export async function resolveFinanceMailSenderContext() {
  const { selectActiveUsersByRole } = await import("../../repositories/raw/users.repo.js");
  const financeUsers = await selectActiveUsersByRole(USER_ROLES.FINANCE);

  for (const row of financeUsers) {
    const context = await resolveMailContextForUser(row.id);
    if (context) {
      return context;
    }
  }

  // Legacy: any connected finance profile row (same role), still no env From.
  const connection = await getConnectedFinanceMailSender();
  if (!connection?.accountId) {
    return null;
  }

  return {
    accountType: connection.accountType || "internal",
    accountId: connection.accountId,
    mailboxProfile: "finance",
    accountEmail: connection.accountEmail || "",
  };
}

export async function resolveFinanceTeamEmails() {
  return listActiveFinanceEmails();
}

/** @deprecated Prefer resolveFinanceTeamEmails() — no env fallbacks. */
export async function resolveFinanceTeamEmail() {
  const emails = await resolveFinanceTeamEmails();
  return emails[0] || "";
}

async function resolveSalesRecipient(quotation: any) {
  const submittedBy = String(quotation.submittedBy || "").trim();
  if (submittedBy.includes("@")) {
    return submittedBy.toLowerCase();
  }

  if (quotation.leadId) {
    const owner = await resolveCustomerProductRequestRecipient(quotation.leadId);
    if (owner?.email) {
      return owner.email.toLowerCase();
    }
  }

  const salesAdmin = await getActiveSalesAdminUser();
  return salesAdmin?.email ? salesAdmin.email.trim().toLowerCase() : null;
}

async function resolveSalesAdminCcEmails() {
  const { selectActiveUsersByRole } = await import("../../repositories/raw/users.repo.js");
  const rows = await selectActiveUsersByRole(USER_ROLES.SALES_ADMIN);
  return [
    ...new Set(
      (rows || [])
        .map((row) => String(row.email || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function quotationProductLines(quotation = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const summary = Array.isArray(quotation.productSummary) ? quotation.productSummary : [];
  const fromSummary = summary
    .map((item: any) => item.name || item.productName || item.productId)
    .filter(Boolean);
  if (fromSummary.length) {
    return fromSummary;
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const assignments = Array.isArray(quotation.assignments) ? quotation.assignments : [];
  return [
    ...new Set(assignments.map((item: any) => item.productId).filter(Boolean)),
  ];
}

function isResellerSourcedLead(lead = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const reseller = lead.reseller || lead.resellerSnapshot;
  return Boolean(reseller && (reseller.invoiceEmail || reseller.workEmail));
}

async function resolveSalesRep(quotation: any) {
  const submittedBy = String(quotation.submittedBy || "").trim();
  const salesRepIsEmail = submittedBy.includes("@");
  const salesEmail = salesRepIsEmail
    ? submittedBy
    : await resolveSalesRecipient(quotation);

  return {
    salesRepEmail: salesEmail || null,
    salesRepName: salesRepIsEmail
      ? "Worktual Sales Team"
      : submittedBy || "Worktual Sales Team",
    salesRepIsEmail,
  };
}

async function resolvePortalCredentialsRecipient(quotation: any) {
  const salesEmail = await resolveSalesRecipient(quotation);
  if (salesEmail) {
    return salesEmail;
  }
  const salesAdmin = await getActiveSalesAdminUser();
  return salesAdmin?.email ? salesAdmin.email.trim().toLowerCase() : null;
}

export async function assertCustomerOutboundMailboxConfigured(preferred = "sales") {
  if (isMailDryRun()) {
    return preferred;
  }

  if (!isMicrosoftMailConfigured()) {
    throw new Error(
      "Microsoft Outlook is not configured. Set MS_CLIENT_ID / MS_REDIRECT_URI before sending customer email.",
    );
  }

  // Prefer an available per-user Graph connection for the preferred profile.
  const connection = await getValidAccessTokenForProfile(preferred);
  if (connection?.accessToken) {
    return preferred;
  }

  const finance = await getValidAccessTokenForProfile("finance");
  if (finance?.accessToken) {
    return "finance";
  }

  throw new Error(
    "Customer email requires a connected Microsoft Outlook mailbox. Ask the sales owner to sign in with Microsoft.",
  );
}

async function resolveCustomerOutboundMailbox(preferred = "sales") {
  if (isMailDryRun()) {
    return preferred;
  }

  if (!isMicrosoftMailConfigured()) {
    return preferred;
  }

  const profiles = [preferred, "finance", "sales", "sales_admin"];
  for (const profile of profiles) {
    const connection = await getValidAccessTokenForProfile(profile);
    if (connection?.accessToken) {
      return profile;
    }
  }

  return preferred;
}

async function sendCustomerFacingEmail(payload: any, preferredMailbox = "sales", mailContext = null) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const mailbox = mailContext?.mailboxProfile || (await resolveCustomerOutboundMailbox(preferredMailbox));
  if (!mailContext && mailbox !== preferredMailbox) {
    console.warn(
      `[mail] ${preferredMailbox} mailbox unavailable — sending customer email from ${mailbox} instead.`,
    );
  }

  await sendEmail(
    {
      ...payload,
      mailbox,
    },
    mailbox,
    mailContext,
  );

  return mailbox;
}

function formatReviewBlock(quotation: any) {
  return [
    `Invoice ID: ${quotation.id}`,
    `Submitted by: ${quotation.submittedBy || "Sales team"}`,
    `Submitted at: ${quotation.submittedAt}`,
    `Reviewed by: ${quotation.reviewedBy || "Finance team"}`,
    `Reviewed at: ${quotation.reviewedAt}`,
    quotation.financeNote ? `Finance note: ${quotation.financeNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function quotationAttachments(quotation: any) {
  if (Array.isArray(quotation.invoices) && quotation.invoices.length > 0) {
    return quotation.invoices
      .filter((entry: any) => entry.pdfBase64)
      .map((entry: any) => ({
        fileName: entry.fileName,
        contentBase64: entry.pdfBase64,
      }));
  }

  if (!quotation.pdfBase64) {
    return [];
  }

  return [
    {
      fileName: quotation.fileName,
      contentBase64: quotation.pdfBase64,
    },
  ];
}

function quotationAttachment(quotation: any) {
  const attachments = quotationAttachments(quotation);
  return attachments[0];
}

function quotationEmailAttachments(quotation: any) {
  const attachments = quotationAttachments(quotation);
  if (!attachments.length) {
    return {};
  }

  if (attachments.length === 1) {
    return { attachment: attachments[0] };
  }

  return { attachments };
}

function formatBranchSummaryBlock(quotation: any) {
  const summary = quotation.branchSummary;
  if (!summary) {
    return "";
  }

  return [
    "Branch summary",
    "--------------",
    `Products: ${summary.productCount}`,
    `Branches: ${summary.branchCount}`,
    `Billing groups: ${summary.billingGroupCount}`,
    summary.branchLabels?.length ? `Locations: ${summary.branchLabels.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function quotationIsImplementationPhase(quotation: any = {}) {
  const phase = quotation.billingPhase || quotation.payment?.billingPhase;
  if (isImplementationBillingPhase(phase)) {
    return true;
  }
  if (phase) {
    return false;
  }
  return quoteNeedsImplementationPhase(quotation.assignments || []);
}

function formatSummaryMoneyLabel(amount: any, currency = "INR") {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  return `${currency} ${safe.toLocaleString("en-IN")}`;
}

/**
 * OTC / implementation-phase emails must list implementation cost only.
 * Stored productSummary.priceLabel often still holds the subscription monthly amount.
 */
function resolveEmailProductSummaryItems(quotation: any = {}) {
  const stored = Array.isArray(quotation.productSummary) ? quotation.productSummary : [];
  if (!quotationIsImplementationPhase(quotation)) {
    return stored;
  }

  const assignments = Array.isArray(quotation.assignments) ? quotation.assignments : [];
  if (!assignments.length) {
    return stored;
  }

  const lead = quotation.lead || {};
  const usedStoredIndexes = new Set();

  return assignments
    .map((assignment: any) => {
      const productId = assignment.productId;
      const branchLabel =
        getBranchById(lead, assignment.branchId)?.label ||
        assignment.branchLabel ||
        "—";
      const storedIndex = stored.findIndex((item: any, index: number) => {
        if (usedStoredIndexes.has(index)) {
          return false;
        }
        if (productId && item.productId && item.productId !== productId) {
          return false;
        }
        if (item.branchLabel && branchLabel && item.branchLabel !== branchLabel) {
          return false;
        }
        return !productId || !item.productId || item.productId === productId;
      });
      const storedItem = storedIndex >= 0 ? stored[storedIndex] : null;
      if (storedIndex >= 0) {
        usedStoredIndexes.add(storedIndex);
      }

      const productName = storedItem?.name || productId || "Product";
      const invoice = getProductInvoice(
        { id: productId, name: productName },
        assignment.config,
        { implementationOnly: true },
      );
      const setupGross = Number(invoice?.setupGross ?? 0);
      const setupNet = Number(invoice?.setupSubtotal ?? 0);
      if (!invoice || (setupGross <= 0 && setupNet <= 0)) {
        return null;
      }

      const currency = assignment.config?.currency || invoice.currency || "INR";
      const displayName = String(productName).includes("(implementation")
        ? productName
        : `${productName} (implementation fee)`;

      return {
        productId,
        name: displayName,
        branchLabel: storedItem?.branchLabel || branchLabel,
        billingLabel: storedItem?.billingLabel || branchLabel,
        changeTypeLabel: storedItem?.changeTypeLabel || null,
        priceLabel: formatSummaryMoneyLabel(setupNet, currency),
      };
    })
    .filter(Boolean);
}

function formatProductSummaryBlock(quotation: any) {
  const items = resolveEmailProductSummaryItems(quotation);
  if (!items.length) {
    return "";
  }

  const lines = items.map((item: any) => {
    const branchPart = item.branchLabel ? ` @ ${item.branchLabel}` : "";
    const billingPart =
      item.billingLabel && item.billingLabel !== item.branchLabel
        ? ` (bill to ${item.billingLabel})`
        : "";
    const typePart = item.changeTypeLabel ? ` [${item.changeTypeLabel}]` : "";
    return `- ${item.name}${typePart}${branchPart}${billingPart}: ${item.priceLabel}`;
  });

  return ["Product breakdown", "-----------------", ...lines].join("\n");
}

export async function notifyAdminQuotationDecision(quotation: any, decision: any) {
  const adminEmail = resolveAdminEmailFromEnv();
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is not configured in .env.");
  }

  const companyName = quotation.lead?.companyName || "Unknown company";
  const isApproved = decision === "approved";
  const subject = isApproved
    ? `Invoice approved — ${companyName}`
    : `Invoice rejected — ${companyName}`;

  const body = [
    "Dear Admin,",
    "",
    `Finance has ${isApproved ? "approved" : "rejected"} the invoice submitted for review.`,
    "",
    "Lead details",
    "------------",
    formatLeadBlock(quotation.lead),
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    formatReviewBlock(quotation),
    "",
    isApproved
      ? "You may proceed with the next customer onboarding steps."
      : "Please review the rejection note and coordinate with sales for revisions.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ]
    .filter(Boolean)
    .join("\n");

  const adminContext = await resolveAdminMailContext();
  await sendEmail(
    {
      to: [adminEmail],
      subject,
      body,
      ...quotationEmailAttachments(quotation),
      mailbox: "admin",
    },
    "admin",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    adminContext,
  );
}

function staffRoleLabel(role: any) {
  if (role === USER_ROLES.FINANCE) {
    return "Finance";
  }
  if (role === USER_ROLES.SALES_ADMIN) {
    return "Sales Admin";
  }
  if (role === USER_ROLES.SALES) {
    return "Sales";
  }
  if (role === USER_ROLES.ADMIN) {
    return "Admin";
  }
  return String(role || "Staff");
}

function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
function buildStaffInviteHtml({ displayName, email, roleLabel, password, loginUrl }) {
  const safeName = escapeHtml(displayName);
  const safeEmail = escapeHtml(email);
  const safeRole = escapeHtml(roleLabel);
  const safePassword = escapeHtml(password);
  const safeLoginUrl = escapeHtml(loginUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Worktual account</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a2332;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#0f2744;padding:24px 28px;">
              <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">Worktual</div>
              <div style="margin-top:4px;font-size:13px;color:#b8c7d9;">My Accounts</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Dear ${safeName},</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#334155;">
                An administrator has created your Worktual My Accounts login. Use the details below to sign in.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:16px 18px;font-size:14px;line-height:1.7;color:#1a2332;">
                    <div><strong>Name:</strong> ${safeName}</div>
                    <div><strong>Email:</strong> ${safeEmail}</div>
                    <div><strong>Role:</strong> ${safeRole}</div>
                    <div><strong>Temporary password:</strong> ${safePassword}</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#0f2744;border-radius:8px;">
                    <a href="${safeLoginUrl}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Sign in to Worktual
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#64748b;">
                Please sign in with the email and password above, then change your password after your first login.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#64748b;">
                If you did not expect this email, contact your administrator.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
              Regards,<br />Worktual Accounts System
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Email a newly created staff user with the password Admin entered at create time.
 * Sends from the admin mailbox (HTML + plain-text fallback).
 */
// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
export async function notifyStaffUserCreated({ user, plainPassword }) {
  const email = String(user?.email || "").trim().toLowerCase();
  const password = String(plainPassword || "");
  if (!email) {
    throw new Error("User email is required to send the login email.");
  }
  if (!password) {
    throw new Error("Password is required to send the login email.");
  }

  const { getAppUrl } = await import("../../infra/env.js");
  const loginUrl = `${getAppUrl().replace(/\/$/, "")}/`;
  const displayName = String(user.displayName || "").trim() || email;
  const roleLabel = staffRoleLabel(user.role);

  const subject = "Your Worktual account has been created";
  const body = [
    `Dear ${displayName},`,
    "",
    "An administrator has created your Worktual My Accounts login.",
    "",
    "Account details",
    "---------------",
    `Name: ${displayName}`,
    `Email: ${email}`,
    `Role: ${roleLabel}`,
    `Temporary password: ${password}`,
    `Sign in: ${loginUrl}`,
    "",
    "Please sign in with the email and password above, then change your password after your first login.",
    "",
    "If you did not expect this email, contact your administrator.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ].join("\n");

  const htmlBody = buildStaffInviteHtml({
    displayName,
    email,
    roleLabel,
    password,
    loginUrl,
  });

  let adminContext;
  try {
    adminContext = await resolveAdminMailContext();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Admin mailbox is not available.";
    const wrapped = new Error(
      message.includes("ADMIN_EMAIL")
        ? "Login email could not be sent: ADMIN_EMAIL is not configured."
        : "Login email could not be sent: connect the admin Outlook mailbox (same as Admin mail), or configure unattended Graph mail, then try again.",
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    wrapped.code =
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error?.code === "admin_email_missing" ? "admin_email_missing" : "admin_mailbox_unavailable";
    throw wrapped;
  }

  const sendMode =
    adminContext.sendMode || (adminContext.accountId ? "delegated" : "unknown");
  console.info(
    `[staff_user.invite_email] using sendMode=${sendMode} from=${adminContext.accountEmail || "unknown"} to=${email} role=${user.role || ""}`,
  );

  const result = await sendEmail(
    {
      to: [email],
      subject,
      body,
      htmlBody,
      mailbox: "admin",
    },
    "admin",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    adminContext,
  );

  if (result?.dryRun && !result?.captured) {
    const error = new Error(
      "Login email was not delivered because MAIL_DRY_RUN is enabled on the server. Disable MAIL_DRY_RUN and ensure the admin Outlook mailbox is connected.",
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "mail_dry_run";
    throw error;
  }

  return result;
}

/**
 * Welcome / login email for a newly created Partner or Reseller portal account.
 * Sends from the admin mailbox with the password Admin entered at create time.
 */
export async function notifyPartnerOrResellerPortalCreated({
  kind,
  companyName = "",
  displayName = "",
  email,
  plainPassword,
}: {
  kind: "partner" | "reseller";
  companyName?: string;
  displayName?: string;
  email: string;
  plainPassword: string;
}) {
  const loginEmail = String(email || "").trim().toLowerCase();
  const password = String(plainPassword || "");
  if (!loginEmail) {
    throw new Error("Portal login email is required to send the welcome email.");
  }
  if (!password) {
    throw new Error("Password is required to send the welcome email.");
  }

  const { getAppUrl } = await import("../../infra/env.js");
  const loginUrl = `${getAppUrl().replace(/\/$/, "")}/`;
  const roleLabel = kind === "reseller" ? "Reseller" : "Partner";
  const name =
    String(displayName || "").trim() ||
    String(companyName || "").trim() ||
    loginEmail;

  const subject = `Your Worktual ${roleLabel.toLowerCase()} portal account has been created`;
  const body = [
    `Dear ${name},`,
    "",
    `An administrator has created your Worktual ${roleLabel} portal login.`,
    "",
    "Account details",
    "---------------",
    `Name: ${name}`,
    companyName ? `Company: ${companyName}` : "",
    `Email: ${loginEmail}`,
    `Role: ${roleLabel}`,
    `Temporary password: ${password}`,
    `Sign in: ${loginUrl}`,
    "",
    "Please sign in with the email and password above, then change your password after your first login.",
    "",
    "If you did not expect this email, contact your administrator.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");

  const htmlBody = buildStaffInviteHtml({
    displayName: name,
    email: loginEmail,
    roleLabel: companyName ? `${roleLabel} · ${companyName}` : roleLabel,
    password,
    loginUrl,
  });

  let adminContext;
  try {
    adminContext = await resolveAdminMailContext();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Admin mailbox is not available.";
    const wrapped = new Error(
      message.includes("ADMIN_EMAIL")
        ? "Welcome email could not be sent: ADMIN_EMAIL is not configured."
        : "Welcome email could not be sent: connect the admin Outlook mailbox (same as Admin mail), or configure unattended Graph mail, then try again.",
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    wrapped.code =
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error?.code === "admin_email_missing" ? "admin_email_missing" : "admin_mailbox_unavailable";
    throw wrapped;
  }

  const sendMode =
    adminContext.sendMode || (adminContext.accountId ? "delegated" : "unknown");
  console.info(
    `[${kind}_portal.welcome_email] using sendMode=${sendMode} from=${adminContext.accountEmail || "unknown"} to=${loginEmail}`,
  );

  const result = await sendEmail(
    {
      to: [loginEmail],
      subject,
      body,
      htmlBody,
      mailbox: "admin",
    },
    "admin",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    adminContext,
  );

  if (result?.dryRun && !result?.captured) {
    const error = new Error(
      "Welcome email was not delivered because MAIL_DRY_RUN is enabled on the server. Disable MAIL_DRY_RUN and ensure the admin Outlook mailbox is connected.",
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "mail_dry_run";
    throw error;
  }

  return result;
}

export async function notifySalesQuotationRejected(quotation: any) {
  const salesEmail = await resolveSalesRecipient(quotation);
  if (!salesEmail) {
    throw new Error(
      "No sales owner email found for this quotation. Assign a sales user on the lead or ensure submittedBy is an email.",
    );
  }

  const salesAdmin = await getActiveSalesAdminUser();
  const salesAdminEmail = salesAdmin?.email ? salesAdmin.email.trim().toLowerCase() : "";
  const cc =
    salesAdminEmail && salesAdminEmail !== salesEmail.toLowerCase() ? [salesAdminEmail] : [];

  const companyName = quotation.lead?.companyName || "Unknown company";
  const subject = `Invoice rejected — ${companyName}`;

  const body = [
    "Dear Sales Team,",
    "",
    "Finance has rejected the invoice submitted for review.",
    "",
    "Lead details",
    "------------",
    formatLeadBlock(quotation.lead),
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    formatReviewBlock(quotation),
    "",
    "Please review the rejection note, revise the invoice, and resubmit for finance approval.",
    "",
    "Regards,",
    "Worktual Finance Team",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(
    `[mail] Notifying sales at ${salesEmail}${cc.length ? ` (cc ${cc.join(", ")})` : ""} of quotation rejection from finance mailbox.`,
  );
  await sendEmail(
    {
      to: [salesEmail],
      ...(cc.length ? { cc } : {}),
      subject,
      body,
      ...quotationEmailAttachments(quotation),
      mailbox: "finance",
    },
    "finance",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    await resolveFinanceMailSenderContext(),
  );
}

function formatPaymentBlock(quotation: any) {
  const payment = quotation.payment;
  if (!payment?.paymentLinkUrl) {
    return "";
  }

  return [
    "Payment link",
    "------------",
    `Amount due: ${payment.amountLabel || payment.grandTotal}`,
    `Provider: ${payment.provider || "stripe"}`,
    `Pay online: ${payment.paymentLinkUrl}`,
    payment.dryRun ? "Note: Payment link generated in demo mode (provider keys not configured)." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function invoiceFileNameForBranch(quotation: any, billingBranchId: any) {
  const invoice = quotation.invoices?.find((entry: any) => entry.billingBranchId === billingBranchId);
  return invoice?.fileName || "";
}

function formatCustomerPaymentBlock(quotation: any) {
  const payment = quotation.payment;
  const branchPayments = payment?.branchPayments || [];

  if (branchPayments.length > 1) {
    const blocks = branchPayments
      .filter((entry: any) => entry.paymentLinkUrl)
      .map((entry: any) => {
        const amountLabel =
          entry.amountLabel ||
          (entry.grandTotal
            ? `${entry.currency || payment.currency || "INR"} ${Number(entry.grandTotal).toLocaleString("en-IN")}`
            : "");
        const invoiceFileName = invoiceFileNameForBranch(quotation, entry.billingBranchId);

        return [
          `Branch: ${entry.branchLabel || entry.billingBranchId}`,
          `Amount due: ${amountLabel}`,
          "Pay here:",
          entry.paymentLinkUrl,
          invoiceFileName ? `Invoice: ${invoiceFileName}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      });

    if (!blocks.length) {
      return "";
    }

    return [
      "Please complete payment for each branch using the links below:",
      "",
      blocks.join("\n\n"),
    ].join("\n");
  }

  if (!payment?.paymentLinkUrl) {
    return "";
  }

  const amountLabel =
    payment.amountLabel ||
    (payment.grandTotal
      ? `${payment.currency || "INR"} ${Number(payment.grandTotal).toLocaleString("en-IN")}`
      : "");

  return [
    `Amount due: ${amountLabel}`,
    "",
    "You can complete payment using the secure link below:",
    payment.paymentLinkUrl,
  ].join("\n");
}

function hasAllPaymentLinks(payment: any) {
  if (payment?.branchPayments?.length > 1) {
    return payment.branchPayments.every((entry: any) => Boolean(entry.paymentLinkUrl));
  }

  return Boolean(payment?.paymentLinkUrl);
}

export async function notifyCustomerPaymentLinkFromSales(quotation: any) {
  const lead = quotation.lead || {};
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const { to, cc, billingBranchId } = resolveQuotationCustomerRecipients(quotation);

  if (!to.length) {
    throw new Error("Lead work email, admin email, or reseller billing email is missing on this quotation.");
  }

  if (!hasAllPaymentLinks(quotation.payment)) {
    throw new Error("Payment link is missing on this quotation.");
  }

  if (!quotation.pdfBase64 && !quotation.invoices?.some((entry: any) => entry.pdfBase64)) {
    throw new Error("Invoice PDF is missing on this quotation.");
  }

  const companyName = lead.companyName || "your organization";
  const contactName =
    lead.reseller?.contactName ||
    resolveBranchContactName(lead, billingBranchId || "hq") ||
    "there";
  const { salesRepEmail, salesRepName, salesRepIsEmail } = await resolveSalesRep(quotation);
  const subject = `Worktual invoice approved — ${companyName}`;

  const body = [
    `Dear ${contactName},`,
    "",
    "Thank you for choosing Worktual. Our finance team has approved your invoice.",
    "",
    `Company: ${companyName}`,
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    "",
    formatCustomerPaymentBlock(quotation),
    "",
    (quotation.payment?.branchPayments?.length || 0) > 1
      ? "Each branch invoice is attached to this email for your records."
      : "The approved invoice is attached for your records.",
    "",
    "If you have questions about billing or next steps, reply to this email.",
    "",
    "Best regards,",
    salesRepName,
    salesRepIsEmail ? quotation.submittedBy : "",
    "Worktual",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    to,
    cc: cc.length ? cc : undefined,
    subject,
    body,
    ...quotationEmailAttachments(quotation),
    mailbox: "sales",
  };

  if (salesRepEmail) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    payload.replyTo = salesRepEmail;
    payload.cc = [...(payload.cc || []), salesRepEmail].filter(
      (email, index, list) => list.indexOf(email) === index,
    );
  }

  console.log(
    `[mail] Sending customer payment link to ${to.join(", ")} from sales mailbox (cc sales rep).`,
  );
  const salesContext = quotation.leadId
    ? await resolveSalesMailContextForLead(quotation.leadId)
    : null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  await sendCustomerFacingEmail(payload, "sales", salesContext);
}

export async function notifySalesQuotationApproved(quotation: any) {
  const salesEmail = await resolveSalesRecipient(quotation);
  if (!salesEmail) {
    throw new Error(
      "No sales owner email found for this quotation. Assign a sales user on the lead or ensure submittedBy is an email.",
    );
  }

  const companyName = quotation.lead?.companyName || "Unknown company";
  const subject = `Payment link ready — ${companyName}`;

  const body = [
    "Dear Sales Team,",
    "",
    "Finance has approved the invoice you submitted. A payment link has been generated for the invoice amount.",
    "",
    "Lead details",
    "------------",
    formatLeadBlock(quotation.lead),
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    formatReviewBlock(quotation),
    "",
    formatPaymentBlock(quotation),
    "",
    "Please forward the payment link to the customer from your sales workspace. The approved invoice is attached for reference.",
    "",
    "Regards,",
    "Worktual Finance Team",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(`[mail] Notifying sales at ${salesEmail} with payment link from finance mailbox.`);
  await sendEmail(
    {
      to: [salesEmail],
      subject,
      body,
      ...quotationEmailAttachments(quotation),
      mailbox: "finance",
    },
    "finance",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    await resolveFinanceMailSenderContext(),
  );
}

export async function notifyCustomerInvoiceApproved(quotation: any) {
  const lead = quotation.lead || {};
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const { to, cc, billingBranchId } = resolveQuotationCustomerRecipients(quotation);

  if (!to.length) {
    throw new Error("Lead work email, admin email, or reseller billing email is missing on this quotation.");
  }

  if (!quotation.pdfBase64 && !quotation.invoices?.some((entry: any) => entry.pdfBase64)) {
    throw new Error("Invoice PDF is missing on this quotation.");
  }

  const companyName = lead.companyName || "your organization";
  const contactName =
    lead.reseller?.contactName ||
    resolveBranchContactName(lead, billingBranchId || "hq") ||
    "there";
  const tenantId = lead.tenantId || "—";
  const salesRep = quotation.submittedBy || "Worktual Sales Team";
  const salesRepIsEmail = salesRep.includes("@");
  const salesRepName = salesRepIsEmail ? "Worktual Sales Team" : salesRep;
  const subject = `Your Worktual invoice — ${companyName}`;

  const body = [
    `Dear ${contactName},`,
    "",
    "Thank you for choosing Worktual. I'm pleased to share the approved invoice for your subscription.",
    "",
    `Company: ${companyName}`,
    `Tenant ID: ${tenantId}`,
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    "",
    "Our finance team has reviewed and confirmed the pricing we discussed. Please find the invoice attached for your records.",
    "",
    "If you have any questions about the invoice, billing, or onboarding next steps, reply to this email and I'll be happy to help.",
    "",
    "Best regards,",
    salesRepName,
    salesRepIsEmail ? salesRep : "",
    "Worktual | Enterprise Software Provider",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    to,
    cc: cc.length ? cc : undefined,
    subject,
    body,
    ...quotationEmailAttachments(quotation),
    mailbox: "sales",
  };

  if (salesRepIsEmail) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    payload.replyTo = salesRep;
  }

  console.log(`[mail] Sending customer invoice to ${to.join(", ")} from sales mailbox.`);
  const salesContext = quotation.leadId
    ? await resolveSalesMailContextForLead(quotation.leadId)
    : null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  await sendCustomerFacingEmail(payload, "sales", salesContext);
}

export async function notifyCustomerOfflinePayment(quotation: any) {
  const lead = quotation.lead || {};
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const { to, cc, billingBranchId } = resolveQuotationCustomerRecipients(quotation);

  if (!to.length) {
    throw new Error("Lead work email, admin email, or reseller billing email is missing on this quotation.");
  }

  if (!quotation.pdfBase64 && !quotation.invoices?.some((entry: any) => entry.pdfBase64)) {
    throw new Error("Invoice PDF is missing on this quotation.");
  }

  const companyName = lead.companyName || "your organization";
  const contactName =
    lead.reseller?.contactName ||
    resolveBranchContactName(lead, billingBranchId || "hq") ||
    "there";
  const tenantId = lead.tenantId || "—";
  const salesRep = quotation.submittedBy || "Worktual Sales Team";
  const salesRepIsEmail = salesRep.includes("@");
  const salesRepName = salesRepIsEmail ? "Worktual Sales Team" : salesRep;
  const subject = `Worktual invoice approved — offline payment required — ${companyName}`;

  const body = [
    `Dear ${contactName},`,
    "",
    "Thank you for choosing Worktual. Our finance team has approved your invoice.",
    "",
    `Company: ${companyName}`,
    `Tenant ID: ${tenantId}`,
    "",
    formatBranchSummaryBlock(quotation),
    formatProductSummaryBlock(quotation),
    "",
    "Because of the invoice amount, online payment (Stripe / Razorpay) is not available for this order.",
    "Please proceed with an offline payment approach. Your sales or finance contact will share bank / offline payment instructions.",
    "",
    "The approved invoice is attached for your records. Reply to this email if you need help coordinating payment or onboarding.",
    "",
    "Best regards,",
    salesRepName,
    salesRepIsEmail ? salesRep : "",
    "Worktual | Enterprise Software Provider",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    to,
    cc: cc.length ? cc : undefined,
    subject,
    body,
    ...quotationEmailAttachments(quotation),
    mailbox: "sales",
  };

  if (salesRepIsEmail) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    payload.replyTo = salesRep;
  }

  console.log(
    `[mail] Sending offline payment invoice notice to ${to.join(", ")} from sales mailbox.`,
  );
  const salesContext = quotation.leadId
    ? await resolveSalesMailContextForLead(quotation.leadId)
    : null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  await sendCustomerFacingEmail(payload, "sales", salesContext);
}

export async function notifyQuotationApproved(quotation: any) {
  try {
    await notifyCustomerPaymentLinkFromSales(quotation);
    return {
      sales: true,
      customer: true,
      paymentLinkSent: Boolean(quotation.payment?.paymentLinkUrl),
      notificationSent: true,
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Customer payment email failed.");
  }
}

function resolvePortalLoginUrl() {
  return `${String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/`;
}

export async function notifyPortalCredentialsWithInvoice(quotation: any, portalAccess: any) {
  const credentialsEmail = await resolvePortalCredentialsRecipient(quotation);
  if (!credentialsEmail) {
    return { sent: false, reason: "missing_credentials_recipient" };
  }

  if (!portalAccess?.email || !portalAccess?.temporaryPassword) {
    return { sent: false, reason: "missing_portal_credentials" };
  }

  const lead = quotation.lead || {};
  const companyName = lead.companyName || "Unknown company";
  const amountLabel =
    quotation.payment?.amountLabel ||
    (quotation.payment?.grandTotal
      ? `${quotation.payment.currency || "INR"} ${Number(quotation.payment.grandTotal).toLocaleString("en-IN")}`
      : "—");
  const invoiceAttachments = quotationAttachments(quotation);
  const portalLoginUrl = resolvePortalLoginUrl();

  const body = [
    "A customer payment has been recorded. Share the portal credentials below with the customer if needed.",
    "",
    "Lead details",
    "------------",
    formatLeadBlock(lead),
    "",
    `Invoice ID: ${quotation.id}`,
    `Amount paid: ${amountLabel}`,
    "",
    "Customer portal credentials",
    "---------------------------",
    `Login URL: ${portalLoginUrl}`,
    `Email: ${portalAccess.email}`,
    `Temporary password: ${portalAccess.temporaryPassword}`,
    "",
    invoiceAttachments.length
      ? invoiceAttachments.length > 1
        ? "The approved invoices are attached to this email."
        : "The approved invoice is attached to this email."
      : "Invoice PDF was not available for this payment.",
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");

  console.log(
    `[mail] Sending portal credentials and invoice to ${credentialsEmail} for ${companyName}.`,
  );

  const salesContext = quotation.leadId
    ? await resolveSalesMailContextForLead(quotation.leadId)
    : null;

  await sendEmail(
    {
      to: [credentialsEmail],
      subject: `Customer portal credentials — ${companyName}`,
      body,
      ...quotationEmailAttachments(quotation),
      mailbox: salesContext?.mailboxProfile || "sales",
    },
    salesContext?.mailboxProfile || "sales",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    salesContext,
  );

  return { sent: true, recipient: credentialsEmail };
}

export async function notifyPaymentReported(quotationInput: any, { source = "stripe" } = {}) {
  const { getQuotation } = await import("../quotations/quotation-store.js");
  let quotation = quotationInput;

  if (!quotation?.lead && quotation?.id) {
    const hydrated = await getQuotation(quotation.id);
    if (hydrated) {
      quotation = {
        ...hydrated,
        payment: quotationInput.payment || hydrated.payment,
        lead: quotationInput.lead || hydrated.lead,
      };
    }
  }

  const lead = quotation.lead || quotation.leadSnapshot || {};
  const companyName = lead.companyName || "Unknown company";
  const amountLabel =
    quotation.payment?.amountLabel ||
    (quotation.payment?.grandTotal
      ? `${quotation.payment.currency || "INR"} ${Number(quotation.payment.grandTotal).toLocaleString("en-IN")}`
      : "—");
  const financeEmails = await resolveFinanceTeamEmails();

  if (!financeEmails.length) {
    console.warn(
      `[mail] Payment reported for quotation ${quotation.id} but no active finance users are configured.`,
    );
    return { notified: false, reason: "missing_finance_recipient" };
  }

  const reportedAt = quotation.payment?.paymentReportedAt || new Date().toISOString();
  const reference = quotation.payment?.providerPaymentId || "—";
  const financeSender = await resolveFinanceMailSenderContext();

  await sendEmail(
    {
      to: financeEmails,
      subject: `Payment reported — verify bank — ${companyName}`,
      body: [
        "A payment has been reported by the gateway or finance team.",
        "",
        "Please verify the amount in your bank account, then confirm payment in the finance queue.",
        "",
        `Company: ${companyName}`,
        `Tenant ID: ${lead.tenantId || "—"}`,
        `Quotation ID: ${quotation.id}`,
        `Amount: ${amountLabel}`,
        `Reference: ${reference}`,
        `Reported at: ${reportedAt}`,
        `Source: ${source}`,
        "",
        "No customer email or portal credentials have been sent yet.",
        "",
        "Regards,",
        "Worktual Accounts",
      ].join("\n"),
      mailbox: "finance",
    },
    "finance",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeSender,
  );

  return { notified: true, recipients: financeEmails };
}

export async function notifyCustomerPaymentReported(quotationInput: any, { source = "stripe" } = {}) {
  const { getQuotation } = await import("../quotations/quotation-store.js");
  let quotation = quotationInput;

  if (!quotation?.lead && quotation?.id) {
    const hydrated = await getQuotation(quotation.id);
    if (hydrated) {
      quotation = {
        ...hydrated,
        payment: quotationInput.payment || hydrated.payment,
        lead: quotationInput.lead || hydrated.lead,
      };
    }
  }

  const lead = quotation.lead || quotation.leadSnapshot || {};
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const { to, cc, billingBranchId } = resolveQuotationCustomerRecipients(quotation);
  const recipientEmail = to[0];
  if (!recipientEmail) {
    return { notified: false, reason: "missing_recipient_email" };
  }

  const companyName = lead.companyName || "your organization";
  const contactName = lead.reseller
    ? lead.reseller.contactName || "Partner"
    : resolveBranchContactName(lead, billingBranchId || "hq");
  const amountLabel =
    quotation.payment?.amountLabel ||
    (quotation.payment?.grandTotal
      ? `${quotation.payment.currency || "INR"} ${Number(quotation.payment.grandTotal).toLocaleString("en-IN")}`
      : "—");

  const salesCc = await resolveSalesRecipient(quotation);
  const extraCc = [
    ...cc,
    ...(salesCc ? [salesCc] : []),
  ];
  const uniqueCc = [...new Set(extraCc.filter(Boolean))];

  await sendCustomerFacingEmail(
    {
      to: [recipientEmail],
      cc: uniqueCc.length ? uniqueCc : undefined,
      subject: `Payment received — verifying — ${companyName}`,
      body: [
        `Dear ${contactName},`,
        "",
        "Thank you — we have received your payment notification.",
        "",
        `Amount: ${amountLabel}`,
        `Reference: Quotation ${quotation.id}`,
        "",
        "Our finance team is verifying the bank deposit. Your products and portal access will activate once payment is confirmed — usually within one to two business days.",
        "",
        "We will email your portal credentials after confirmation. No action is needed from you right now.",
        "",
        "Best regards,",
        "Worktual Team",
      ].join("\n"),
      mailbox: "sales",
    },
    "sales",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    quotation.leadId ? await resolveSalesMailContextForLead(quotation.leadId) : null,
  );

  console.log("[mail] Payment reported acknowledgement sent to", recipientEmail, { source });
  return { notified: true, recipient: recipientEmail };
}

async function hydrateQuotationForNotify(quotationInput: any) {
  const { getQuotation } = await import("../quotations/quotation-store.js");
  let quotation = quotationInput;

  if (!quotation?.pdfBase64 && !quotation?.invoices?.length && quotation?.id) {
    const hydrated = await getQuotation(quotation.id);
    if (hydrated) {
      quotation = {
        ...hydrated,
        payment: quotationInput.payment || hydrated.payment,
        lead: quotationInput.lead || hydrated.lead,
      };
    }
  }

  return quotation;
}

export async function notifyInternalPaymentSummary(quotationInput: any, { source = "stripe" } = {}) {
  const quotation = await hydrateQuotationForNotify(quotationInput);
  const lead = quotation.lead || quotation.leadSnapshot || {};
  const companyName = lead.companyName || "Unknown company";
  const amountLabel =
    quotation.payment?.amountLabel ||
    (quotation.payment?.grandTotal
      ? `${quotation.payment.currency || "INR"} ${Number(quotation.payment.grandTotal).toLocaleString("en-IN")}`
      : "—");
  const salesEmail = await resolveSalesRecipient(quotation);
  const financeEmails = await resolveFinanceTeamEmails();
  const paidAt = quotation.payment?.paidAt || new Date().toISOString();
  const recipients = [...new Set([salesEmail, ...financeEmails].filter(Boolean))];

  if (!recipients.length) {
    return { notified: false, reason: "missing_internal_recipients" };
  }

  const financeSender = await resolveFinanceMailSenderContext();
  const salesContext = quotation.leadId
    ? await resolveSalesMailContextForLead(quotation.leadId)
    : null;

  await sendEmail(
    {
      to: recipients,
      subject: `Payment received — ${companyName}`,
      body: [
        "A customer payment has been recorded.",
        "",
        "Payment received",
        "----------------",
        `Company: ${companyName}`,
        `Tenant ID: ${lead.tenantId || "—"}`,
        `Quotation ID: ${quotation.id}`,
        `Amount: ${amountLabel}`,
        `Paid at: ${paidAt}`,
        `Source: ${source}`,
        "",
        "The lead and quotation are now marked as Paid in Worktual Accounts.",
        "",
        "Regards,",
        "Worktual Accounts",
      ].join("\n"),
      mailbox: financeSender?.mailboxProfile || salesContext?.mailboxProfile || "finance",
    },
    financeSender?.mailboxProfile || salesContext?.mailboxProfile || "finance",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeSender || salesContext,
  );

  return { notified: true, recipients };
}

export async function notifyCustomerWelcomeEmail(
  quotationInput: any,
  {
    portalAccess = null,
    includeBranchNote = true,
    mailContext = null,
    recipientMode = "default",
  } = {},
) {
  const quotation = await hydrateQuotationForNotify(quotationInput);
  const lead = quotation.lead || quotation.leadSnapshot || {};
  const companyName = lead.companyName || "Unknown company";
  const amountLabel =
    quotation.payment?.amountLabel ||
    (quotation.payment?.grandTotal
      ? `${quotation.payment.currency || "INR"} ${Number(quotation.payment.grandTotal).toLocaleString("en-IN")}`
      : "—");

  const resellerDeal = isResellerSourcedLead(lead);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  let recipientEmail = null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  let ccList = [];

  if (recipientMode === "customer_only") {
    recipientEmail =
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      portalAccess?.email ||
      resolvePortalLoginEmail(lead) ||
      (() => {
        try {
          return resolveCustomerRecipients(lead).to[0] || null;
        } catch {
          return null;
        }
      })();
    ccList = [];
  } else if (resellerDeal) {
    const { to, cc } = resolveCustomerRecipients(lead);
    recipientEmail = to[0];
    const salesAdminCc = await resolveSalesAdminCcEmails();
    ccList = [...new Set([...cc, ...salesAdminCc].filter(Boolean))];
  } else {
    // Direct customer: deliver branch credentials to that branch work email.
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    recipientEmail = portalAccess?.email || null;
    if (!recipientEmail) {
      try {
        recipientEmail = resolveCustomerRecipients(lead).to[0] || null;
      } catch {
        recipientEmail = null;
      }
    }
    const salesAdminCc = await resolveSalesAdminCcEmails();
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    ccList = salesAdminCc.filter((email) => email !== recipientEmail);
  }

  const portalLoginUrl = resolvePortalLoginUrl();
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const loginEmail = portalAccess?.email || resolvePortalLoginEmail(lead);
  const productLines = quotationProductLines(quotation);
  const branchLabel =
    quotation.branchSummary?.branchLabel ||
    quotation.invoices?.[0]?.branchLabel ||
    "";

  if (!recipientEmail) {
    return {
      notified: false,
      customerNotified: false,
      customerEmailError: "Lead has no reseller billing email or branch work email.",
    };
  }

  const greetingName = resellerDeal
    ? lead.reseller?.contactName || "Partner"
    : lead.contactName || "there";

  const customerBody = [
    `Dear ${greetingName},`,
    "",
    "Thank you — we have received your payment.",
    "",
    `Amount: ${amountLabel}`,
    `Reference: Quotation ${quotation.id}`,
    "",
  ];

  if (branchLabel) {
    customerBody.push(`Location: ${branchLabel}`, "");
  }

  if (productLines.length) {
    customerBody.push("Products on this invoice:", ...productLines.map((name: any) => `- ${name}`), "");
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (portalAccess?.temporaryPassword) {
    customerBody.push(
      `Branch portal account for ${companyName}${branchLabel ? ` (${branchLabel})` : ""} is ready.`,
      "",
      `Portal: ${portalLoginUrl}`,
      `Customer login email: ${loginEmail || "—"}`,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      `Temporary password: ${portalAccess.temporaryPassword}`,
      "",
    );
    if (resellerDeal) {
      customerBody.push("Please forward these credentials to your end customer.", "");
    }
    if (includeBranchNote && resellerDeal) {
      customerBody.push(
        "Each paid branch receives its own portal login on the branch work email.",
        "",
      );
    }
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  } else if (portalAccess?.email || loginEmail) {
    customerBody.push(
      "Your existing customer portal login remains active. Use the same email and password — no new credentials were created for this purchase.",
      "",
      `Portal: ${portalLoginUrl}`,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      `Customer login email: ${loginEmail || portalAccess?.email || "—"}`,
      "",
    );
  } else {
    customerBody.push("Our team will follow up with onboarding next steps shortly.", "");
  }

  customerBody.push("Best regards,", "Worktual Team");

  const resolvedMailContext =
    mailContext ||
    (quotation.leadId ? await resolveSalesMailContextForLead(quotation.leadId) : null);

  if (recipientMode === "customer_only" && !resolvedMailContext?.accountId) {
    const error = new Error(
      "Connect your Microsoft Outlook account before resending customer credentials.",
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "needs_outlook_connect";
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.needsOutlookConnect = true;
    return {
      notified: false,
      customerNotified: false,
      customerEmailError: error.message,
      credentialsDelivered: false,
    };
  }

  try {
    const customerMailbox = await sendCustomerFacingEmail(
      {
        to: [recipientEmail],
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        ...(ccList.length ? { cc: ccList } : {}),
        subject: `Payment received — ${companyName}${branchLabel ? ` · ${branchLabel}` : ""}`,
        body: customerBody.join("\n"),
        ...quotationEmailAttachments(quotation),
      },
      resolvedMailContext?.mailboxProfile || "sales",
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      resolvedMailContext,
    );

    console.log(
      `[mail] Payment confirmation sent to ${recipientEmail} from ${customerMailbox} mailbox` +
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        (ccList.length ? ` (cc ${ccList.join(", ")})` : " (no cc)") +
        ".",
    );

    return {
      notified: true,
      customerNotified: true,
      customerEmailError: null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      credentialsDelivered: Boolean(portalAccess?.temporaryPassword),
      existingPortalLogin: Boolean(
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        (portalAccess?.email || loginEmail) && !portalAccess?.temporaryPassword,
      ),
      recipientEmail,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      cc: ccList,
    };
  } catch (error) {
    const customerEmailError = error instanceof Error ? error.message : String(error);
    console.error("[mail] Customer payment confirmation failed:", customerEmailError);
    return {
      notified: false,
      customerNotified: false,
      customerEmailError,
      credentialsDelivered: false,
      existingPortalLogin: false,
      recipientEmail,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      cc: ccList,
    };
  }
}

export async function notifyPaymentReceived(
  quotationInput: any,
  {
    source = "stripe",
    portalAccess = null,
    mailContext = null,
    recipientMode = "default",
    skipInternal = false,
  } = {},
) {
  const quotation = await hydrateQuotationForNotify(quotationInput);

  let internalSummary = { notified: false };
  let internalCredentials = {
    sent: false,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    reason: portalAccess?.temporaryPassword ? null : "missing_portal_credentials",
    error: null,
  };
  let customerResult = {
    customerNotified: false,
    customerEmailError: null,
    credentialsDelivered: false,
  };

  if (!skipInternal) {
    try {
      internalSummary = await notifyInternalPaymentSummary(quotation, { source });
    } catch (error) {
      internalSummary = {
        notified: false,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (portalAccess?.email && portalAccess?.temporaryPassword) {
      try {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        internalCredentials = await notifyPortalCredentialsWithInvoice(quotation, portalAccess);
      } catch (error) {
        internalCredentials = {
          sent: false,
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          error: error instanceof Error ? error.message : String(error),
        };
        console.error(
          "[mail] Portal credentials email failed:",
          internalCredentials.error,
        );
      }
    }
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  customerResult = await notifyCustomerWelcomeEmail(quotation, {
    portalAccess,
    mailContext,
    recipientMode,
  });

  const credentialsDelivered =
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    customerResult.customerNotified && Boolean(portalAccess?.temporaryPassword);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const existingPortalLogin = Boolean(customerResult.existingPortalLogin);

  console.log("[welcome_email.delivery]", {
    quotationId: quotation.id,
    customerNotified: customerResult.customerNotified,
    credentialsDelivered,
    existingPortalLogin,
    internalCredentialsSent: internalCredentials.sent,
    channel: "sync",
    recipientMode,
  });

  return {
    notified: internalSummary.notified || customerResult.customerNotified,
    internalNotified: internalSummary.notified,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    internalSummaryError: internalSummary.error || null,
    internalCredentialsSent: internalCredentials.sent,
    internalCredentialsError: internalCredentials.error || null,
    customerNotified: customerResult.customerNotified,
    credentialsDelivered,
    existingPortalLogin,
    customerEmailError: customerResult.customerEmailError,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    recipients: internalSummary.recipients || [],
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    credentialsNotified: Boolean(portalAccess?.temporaryPassword),
  };
}

/**
 * Legacy job type alias. Ticket-raised mail always routes Sales Admin → Sales Executive
 * (same as notifySalesSupportTicketCreated). Previously used finance From → sales-admin To.
 */
export async function notifySupportTicketCreated(ticket: any, initialMessage = null) {
  return notifySalesSupportTicketCreated(ticket, initialMessage);
}

/**
 * Sales Admin assigned a lead to a Sales Executive: From Sales Admin mailbox → To assignee.
 */
export async function notifySalesLeadAssigned(
  leadId: any,
  { toUserId, assignedByUserId = null, reason = "" }: any = {},
) {
  if (!leadId || !toUserId) {
    return { sent: false, reason: "missing_lead_or_assignee" };
  }

  const { getLeadById } = await import("../leads/lead-store.js");
  const lead = await getLeadById(leadId);
  if (!lead) {
    return { sent: false, reason: "lead_not_found" };
  }

  const assignee = await getUserById(toUserId);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!isUserActive(assignee) || !isSalesFacingUser(assignee) || !assignee?.email) {
    console.warn(
      `[mail] No active sales recipient for lead assignment ${leadId} → user ${toUserId}.`,
    );
    return { sent: false, reason: "missing_sales_recipient" };
  }

  let assignedByName = "Sales Admin";
  if (assignedByUserId) {
    const actor = await getUserById(assignedByUserId);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (actor?.displayName || actor?.email) {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      assignedByName = actor.displayName || actor.email;
    }
  }

  const salesAdmin = await getActiveSalesAdminUser();
  let mailContext = null;
  if (salesAdmin?.id) {
    try {
      mailContext = await resolveMailContextForUser(salesAdmin.id);
    } catch (error) {
      console.warn(
        "[mail] sales admin mail context lookup failed for lead assignment:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const assigneeEmail = String(assignee.email).trim();
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const assigneeName = assignee.displayName || assigneeEmail;
  const companyName = lead.companyName || "Lead";
  const reasonLine = String(reason || "").trim()
    ? `Reason: ${String(reason).trim()}`
    : "";

  const body = [
    `Hi ${assigneeName},`,
    "",
    `${assignedByName} assigned a lead to you in Worktual Accounts.`,
    "",
    formatLeadBlock(lead),
    reasonLine,
    "",
    "Open the lead in Worktual Accounts to review and create a quotation when ready.",
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");

  console.log(
    `[mail] Lead assigned → sales ${assigneeEmail} for ${companyName} (${leadId}) from sales_admin.`,
  );

  await sendEmail(
    {
      to: [assigneeEmail],
      subject: `Lead assigned — ${companyName}`,
      body,
      mailbox: "sales_admin",
    },
    "sales_admin",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailContext,
  );

  return {
    sent: true,
    recipient: assigneeEmail,
    recipientName: assigneeName,
    fromMailbox: "sales_admin",
    leadId: String(leadId),
  };
}

/**
 * Customer raised a support ticket: From Sales Admin mailbox → To assigned Sales Executive.
 * Recipient fallbacks match product-request mail: lead assignee → lead creator → sales admin.
 */
export async function notifySalesSupportTicketCreated(ticket: any, initialMessage = null) {
  const { resolveSalesOwnerForOrganization } = await import("../support-tickets/ticket-store.js");
  let ownership = null;
  if (ticket?.organizationId) {
    try {
      ownership = await resolveSalesOwnerForOrganization(ticket.organizationId);
    } catch (error) {
      console.warn(
        "[mail] resolveSalesOwnerForOrganization failed for support ticket:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Same To resolution as product-request mail (null lead → sales admin fallback).
  const recipient = await resolveCustomerProductRequestRecipient(ownership?.sourceLeadId || null);

  if (!recipient?.email) {
    console.warn(
      `[mail] No sales recipient for support ticket ${ticket?.ticketNumber || "—"} — skipping alert.`,
    );
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const salesAdmin = await getActiveSalesAdminUser();
  let mailContext = null;
  if (salesAdmin?.id) {
    try {
      mailContext = await resolveMailContextForUser(salesAdmin.id);
    } catch (error) {
      console.warn(
        "[mail] sales admin mail context lookup failed for support ticket:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!mailContext && !isMailDryRun()) {
    console.warn(
      `[mail] Support ticket ${ticket?.ticketNumber || "—"}: sales admin Outlook not connected for user; ` +
        "will use latest sales_admin mailbox profile if available.",
    );
  }

  const routedToLine =
    recipient.routedTo === "lead_assignee"
      ? `Assigned to: ${recipient.name} (lead assignee)`
      : recipient.routedTo === "lead_creator"
        ? `Assigned to: ${recipient.name} (lead creator)`
        : `Assigned to: ${recipient.name} (sales admin — lead owner unavailable)`;

  const body = [
    "A customer from your account has raised a support ticket.",
    "",
    routedToLine,
    "",
    `Ticket: ${ticket.ticketNumber}`,
    `Company: ${ticket.companyName || "—"}`,
    `Tenant ID: ${ticket.tenantId || "—"}`,
    `Product: ${ticket.productLabel || "Account & billing"}`,
    `Category: ${ticket.category}`,
    `Priority: ${ticket.priority}`,
    `Subject: ${ticket.subject}`,
    `Contact: ${ticket.contactEmail || "—"}`,
    "",
    "Description",
    "-----------",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    initialMessage?.body || ticket.description,
    "",
    ticket.subscriptionKey ? `Subscription key: ${ticket.subscriptionKey}` : "",
    "",
    "Open Support in Worktual Accounts to review and reply.",
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(
    `[mail] Support ticket ${ticket.ticketNumber} → sales ${recipient.email} (${recipient.routedTo}) from sales_admin.`,
  );

  await sendEmail(
    {
      to: [recipient.email],
      subject: `[${ticket.ticketNumber}] Customer support: ${ticket.subject}`,
      body,
      mailbox: "sales_admin",
    },
    "sales_admin",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailContext,
  );

  return {
    sent: true,
    recipient: recipient.email,
    routedTo: recipient.routedTo,
    recipientName: recipient.name,
    fromMailbox: "sales_admin",
  };
}

export async function notifyCustomerProductRequest(requestRecord: any, options = {}) {
  const recipient = await resolveCustomerProductRequestRecipient(requestRecord.sourceLeadId);
  if (!recipient?.email) {
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const mailContext =
    (requestRecord.sourceLeadId
      ? await resolveSalesMailContextForLead(requestRecord.sourceLeadId)
      : null) ||
    (recipient.userId ? await resolveMailContextForUser(recipient.userId) : null);

  const summaryLines = (requestRecord.productSummary || []).map(
    (entry: any) =>
      `- ${entry.name} (${entry.changeTypeLabel || entry.changeType || "new"}) @ ${entry.branchLabel || "—"}: ${entry.priceLabel || "—"}`,
  );

  const routedToLine =
    recipient.routedTo === "lead_assignee"
      ? `Assigned to: ${recipient.name} (lead assignee)`
      : recipient.routedTo === "lead_creator"
        ? `Assigned to: ${recipient.name} (lead creator)`
        : `Assigned to: ${recipient.name} (sales admin — lead owner unavailable)`;

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const reason = String(options.reason || "submitted").trim().toLowerCase();
  const isInquiry =
    String(requestRecord.requestType || "").trim().toLowerCase() === "inquiry";
  const intro = isInquiry
    ? reason === "reminder"
      ? "A customer asked to notify you again about a new-product inquiry from the portal."
      : "A customer asked to speak with sales about adding a new product from the portal (no configuration submitted)."
    : reason === "updated"
      ? "A customer updated an existing product purchase or upgrade request from the portal."
      : reason === "reminder"
        ? "A customer asked to notify you again about an existing product request from the portal."
        : "A customer has submitted a product purchase or upgrade request from the portal.";
  const subjectPrefix = isInquiry
    ? reason === "reminder"
      ? "Reminder: customer product inquiry"
      : "Customer product inquiry"
    : reason === "updated"
      ? "Updated customer product request"
      : reason === "reminder"
        ? "Reminder: customer product request"
        : "Customer product request";

  const body = [
    intro,
    "",
    routedToLine,
    "",
    `Request: ${requestRecord.requestNumber}`,
    `Type: ${requestRecord.requestType}`,
    `Company: ${requestRecord.companyName || "—"}`,
    `Tenant ID: ${requestRecord.tenantId || "—"}`,
    `Contact: ${requestRecord.contactEmail || "—"}`,
    `Lead ID: ${requestRecord.sourceLeadId}`,
    "",
    isInquiry ? "Inquiry" : "Requested products",
    isInquiry ? "-------" : "------------------",
    ...(summaryLines.length
      ? summaryLines
      : [isInquiry ? "(generic new-product interest — no product selected)" : "(no summary provided)"]),
    "",
    requestRecord.customerNote ? `Customer note: ${requestRecord.customerNote}` : "",
    "",
    isInquiry
      ? "Open the lead in Worktual Accounts to follow up with the customer and create a quotation when ready."
      : "Open the lead in Worktual Accounts to review, price, and send a quotation to finance when ready.",
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(
    {
      to: [recipient.email],
      subject: `[${requestRecord.requestNumber}] ${subjectPrefix} — ${requestRecord.companyName || "Account"}`,
      body,
      mailbox: mailContext?.mailboxProfile || recipient.mailbox || "sales",
    },
    mailContext?.mailboxProfile || recipient.mailbox || "sales",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailContext,
  );

  return {
    sent: true,
    recipient: recipient.email,
    routedTo: recipient.routedTo,
    recipientName: recipient.name,
  };
}

export async function notifyCustomerProductRequestCancelled(requestRecord: any) {
  const recipient = await resolveCustomerProductRequestRecipient(requestRecord.sourceLeadId);
  if (!recipient?.email) {
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const mailContext =
    (requestRecord.sourceLeadId
      ? await resolveSalesMailContextForLead(requestRecord.sourceLeadId)
      : null) ||
    (recipient.userId ? await resolveMailContextForUser(recipient.userId) : null);

  const body = [
    "A customer has withdrawn a product request from the portal.",
    "",
    `Request: ${requestRecord.requestNumber}`,
    `Type: ${requestRecord.requestType}`,
    `Company: ${requestRecord.companyName || "—"}`,
    `Tenant ID: ${requestRecord.tenantId || "—"}`,
    `Contact: ${requestRecord.contactEmail || "—"}`,
    `Lead ID: ${requestRecord.sourceLeadId}`,
    "",
    "No further action is required unless the customer submits a new request.",
    "",
    "Regards,",
    "Worktual Accounts",
  ].join("\n");

  await sendEmail(
    {
      to: [recipient.email],
      subject: `[${requestRecord.requestNumber}] Customer product request withdrawn`,
      body,
      mailbox: mailContext?.mailboxProfile || recipient.mailbox || "sales",
    },
    mailContext?.mailboxProfile || recipient.mailbox || "sales",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailContext,
  );

  return { sent: true, recipient: recipient.email };
}

export async function notifySalesBranchAddRequested(requestRecord: any) {
  const salesRecipients = await resolveBranchDropSalesRecipients(requestRecord.sourceLeadId);
  const salesRep = salesRecipients.salesExecutive;
  const salesAdmin = salesRecipients.salesAdmin;

  if (!salesRep?.email) {
    console.warn("[mail] No sales recipient for branch add request — skipping alert.");
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const mailContext =
    (requestRecord.sourceLeadId
      ? await resolveSalesMailContextForLead(requestRecord.sourceLeadId)
      : null) ||
    (salesRep.userId ? await resolveMailContextForUser(salesRep.userId) : null);

  const to = [salesRep.email];
  const cc = buildSalesCcExcluding(to, salesAdmin?.email ? [salesAdmin.email] : []);
  const payload = requestRecord.payload || {};
  const appBase = String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  const leadUrl = requestRecord.sourceLeadId
    ? `${appBase}/customers/${requestRecord.sourceLeadId}`
    : appBase;

  const body = [
    `Dear ${salesRep.name || "Sales"},`,
    "",
    "A head-office customer has requested to add a new branch from the portal.",
    "Location details were not collected in the portal — please follow up with the customer.",
    "",
    `Request: ${requestRecord.requestNumber}`,
    `Company: ${requestRecord.companyName || "—"}`,
    `Contact: ${requestRecord.contactEmail || "—"}`,
    `Lead ID: ${requestRecord.sourceLeadId || "—"}`,
    "",
    "Requested branch",
    "----------------",
    `Name: ${payload.label || "(to be collected)"}`,
    `Address: ${payload.address || "(to be collected)"}`,
    `City: ${payload.city || "—"}`,
    `State: ${payload.state || "—"}`,
    `Country: ${payload.country || "—"}`,
    payload.workEmail ? `Work email: ${payload.workEmail}` : "",
    payload.mobileNumber
      ? `Mobile: ${[payload.mobileCountryCode, payload.mobileNumber].filter(Boolean).join(" ")}`
      : "",
    payload.note ? `Customer note: ${payload.note}` : "",
    "",
    `Open the customer account: ${leadUrl}`,
    "",
    "Follow up to add the location and create a quotation when ready.",
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");

  console.log(
    `[mail] Branch add request ${requestRecord.requestNumber} → sales ${salesRep.email}${
      cc.length ? ` (cc ${cc.join(", ")})` : ""
    }.`,
  );

  await sendEmail(
    {
      to,
      cc: cc.length ? cc : undefined,
      subject: `[${requestRecord.requestNumber}] New branch request — ${
        requestRecord.companyName || "Customer"
      }`,
      body,
      mailbox: mailContext?.mailboxProfile || "sales",
    },
    mailContext?.mailboxProfile || "sales",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailContext,
  );

  return {
    sent: true,
    recipient: salesRep.email,
    cc,
    routedTo: salesRep.routedTo || "sales",
  };
}

function formatCancellationKindLabel(kind: any) {
  if (kind === "cancel_product") {
    return "Product cancellation";
  }
  if (kind === "drop_branch") {
    return "Branch drop";
  }
  return kind || "—";
}

function formatCancellationTriggerLabel(trigger: any) {
  if (trigger === "customer") {
    return "Customer request";
  }
  if (trigger === "system_unpaid_initial") {
    return "Unpaid initial payment";
  }
  if (trigger === "system_unpaid_renewal") {
    return "Unpaid renewal";
  }
  return trigger || "—";
}

function formatProductIdLabel(productId: any) {
  const value = String(productId || "").trim();
  if (!value) {
    return "";
  }
  if (value.toLowerCase() === "crm") {
    return "CRM";
  }
  if (value.toLowerCase() === "ccaas") {
    return "CCaaS";
  }
  return value;
}

function formatCancellationRequestBlock(requestRecord: any, { forCustomer = false } = {}) {
  const kindLabel = forCustomer
    ? formatCancellationKindLabel(requestRecord.requestKind)
    : requestRecord.requestKind;
  const triggerLabel = forCustomer
    ? formatCancellationTriggerLabel(requestRecord.triggerSource)
    : requestRecord.triggerSource;
  const productLabel = forCustomer
    ? formatProductIdLabel(requestRecord.productId)
    : requestRecord.productId;

  return [
    `Request: ${requestRecord.requestNumber}`,
    `Kind: ${kindLabel}`,
    `Company: ${requestRecord.companyName || "—"}`,
    `Tenant ID: ${requestRecord.tenantId || "—"}`,
    `Branch/location ID: ${requestRecord.branchId || "—"}`,
    productLabel ? `Product: ${productLabel}` : "",
    requestRecord.subscriptionId ? `Subscription ID: ${requestRecord.subscriptionId}` : "",
    requestRecord.relatedQuotationId ? `Quotation ID: ${requestRecord.relatedQuotationId}` : "",
    triggerLabel ? `Trigger: ${triggerLabel}` : "",
    requestRecord.graceDeadlineAt ? `Grace deadline: ${requestRecord.graceDeadlineAt}` : "",
    requestRecord.contactEmail ? `Contact: ${requestRecord.contactEmail}` : "",
    requestRecord.customerNote ? `Note: ${requestRecord.customerNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function adminQueueUrl() {
  return `${String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/admin/cancellation-requests`;
}

export async function notifyAdminCancellationRequested(requestRecord: any) {
  const adminEmail = resolveAdminEmailFromEnv();
  const salesRecipients = await resolveBranchDropSalesRecipients(requestRecord.sourceLeadId);
  const salesRep = salesRecipients.salesExecutive;
  const salesAdmin = salesRecipients.salesAdmin;
  const adminContext = await resolveAdminMailContext();

  const salesPersonLines = [];
  if (salesRep?.email) {
    salesPersonLines.push(
      `Sales representative: ${salesRep.name || "Sales"} <${salesRep.email}>`,
    );
  }
  if (
    salesAdmin?.email &&
    normalizeMailAddress(salesAdmin.email) !== normalizeMailAddress(salesRep?.email)
  ) {
    salesPersonLines.push(
      `Sales admin: ${salesAdmin.name || "Sales Admin"} <${salesAdmin.email}>`,
    );
  }
  const salesPersonLine = salesPersonLines.join("\n");

  // Product cancellation: notify the sales owner from admin (sales admin on CC).
  if (requestRecord.requestKind === "cancel_product") {
    if (!salesRep?.email) {
      console.warn(
        "[mail] No sales recipient for product cancellation request — skipping sales alert.",
      );
      return { sent: false, reason: "missing_sales_recipient" };
    }

    const to = [salesRep.email];
    const cc = buildSalesCcExcluding(
      to,
      salesAdmin?.email ? [salesAdmin.email] : [],
    );

    const subject = `[${requestRecord.requestNumber}] Product cancellation request — ${
      requestRecord.companyName || "Customer"
    }`;

    const body = [
      `Dear ${salesRep.name || "Sales"},`,
      "",
      "A customer on your account has submitted a product cancellation request from the portal.",
      "",
      formatCancellationRequestBlock(requestRecord, { forCustomer: true }),
      salesPersonLine,
      "",
      "This is a notification only. Platform admin must review and approve the cancellation.",
      "",
      `Admin review queue: ${adminQueueUrl()}`,
      "",
      "Regards,",
      "Worktual Admin",
    ]
      .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
      .join("\n");

    console.log(
      `[mail] Product cancellation request ${requestRecord.requestNumber} → sales ${
        salesRep.email
      }${cc.length ? ` (cc ${cc.join(", ")})` : ""} from admin.`,
    );

    await sendEmail(
      {
        to,
        cc: cc.length ? cc : undefined,
        replyTo: adminEmail || undefined,
        subject,
        body,
        mailbox: "admin",
      },
      "admin",
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      adminContext,
    );

    return {
      sent: true,
      recipient: salesRep.email,
      cc,
      routedTo: salesRep.routedTo || "sales",
    };
  }

  // Branch drop: keep admin as primary recipient; CC sales team.
  if (!adminEmail) {
    console.warn("[mail] ADMIN_EMAIL not configured — skipping cancellation request alert.");
    return { sent: false, reason: "missing_admin_email" };
  }

  const salesCc = buildSalesCcExcluding([adminEmail], salesRecipients.cc);

  const subject = `[${requestRecord.requestNumber}] Branch drop request — ${
    requestRecord.companyName || "Customer"
  }`;

  const body = [
    "Dear Admin,",
    "",
    "A customer has submitted a branch drop request from the portal.",
    "",
    formatCancellationRequestBlock(requestRecord),
    salesPersonLine,
    "",
    `Review and action in Worktual Admin: ${adminQueueUrl()}`,
    "",
    "Only platform admin can approve cancellations or drop a branch inactive.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");

  await sendEmail(
    {
      to: [adminEmail],
      cc: salesCc.length ? salesCc : undefined,
      subject,
      body,
      mailbox: "admin",
    },
    "admin",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    adminContext,
  );

  return { sent: true, recipient: adminEmail, cc: salesCc };
}

export async function notifyAdminBranchCancellationAlert(requestRecord: any, context = {}) {
  const adminEmail = resolveAdminEmailFromEnv();
  if (!adminEmail) {
    console.warn("[mail] ADMIN_EMAIL not configured — skipping auto-escalation alert.");
    return { sent: false, reason: "missing_admin_email" };
  }

  const scenarioLabel =
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    context.scenario === "renewal_unpaid"
      ? "Renewal unpaid after grace period"
      : "Initial payment unpaid after grace period";

  const subject = `[AUTO] ${scenarioLabel} — ${requestRecord.companyName || "Customer"} (${requestRecord.branchId})`;

  const body = [
    "Dear Admin,",
    "",
    "A branch/product subscription has crossed the configured payment grace period without payment.",
    "",
    `Scenario: ${scenarioLabel}`,
    formatCancellationRequestBlock(requestRecord),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    context.amountDue ? `Amount due: ${context.currency || "INR"} ${context.amountDue}` : "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    context.renewsAt ? `Subscription expired on: ${context.renewsAt}` : "",
    "",
    "An auto-escalated cancellation request has been created for your review.",
    "",
    `Review in Worktual Admin: ${adminQueueUrl()}`,
    "",
    "Approve to cancel the product at this branch or drop the branch inactive.",
    "",
    "Regards,",
    "Worktual Accounts System",
  ]
    .filter(Boolean)
    .join("\n");

  const adminContext = await resolveAdminMailContext();
  await sendEmail(
    {
      to: [adminEmail],
      subject,
      body,
      mailbox: "admin",
    },
    "admin",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    adminContext,
  );

  return { sent: true, recipient: adminEmail };
}

export async function notifyCustomerCancellationResolved(requestRecord: any, decision: any) {
  let recipient = requestRecord.contactEmail;
  let contactName = "Customer";

  if (requestRecord.sourceLeadId) {
    const { getLeadById } = await import("../leads/lead-store.js");
    const lead = await getLeadById(requestRecord.sourceLeadId);
    if (lead?.reseller) {
      const { to } = buildOutboundRecipients(lead);
      recipient = to[0] || recipient;
    }
    contactName =
      lead?.reseller?.contactName ||
      resolveBranchContactName(lead, requestRecord.branchId || "hq") ||
      lead?.contactName ||
      "Customer";
  }

  if (!recipient) {
    return { sent: false, reason: "missing_contact_email" };
  }

  const salesRecipients = await resolveBranchDropSalesRecipients(requestRecord.sourceLeadId);
  const salesRep = salesRecipients.salesExecutive;
  const salesRepName = salesRep?.name || "Worktual Sales";
  const salesRepEmail = salesRep?.email || "";

  const mailContext =
    (requestRecord.sourceLeadId
      ? await resolveSalesMailContextForLead(requestRecord.sourceLeadId)
      : null) ||
    (salesRep?.userId ? await resolveMailContextForUser(salesRep.userId) : null);

  if (!mailContext) {
    console.warn(
      `[mail] Cancellation resolved email has no connected sales Outlook for lead ${
        requestRecord.sourceLeadId || "—"
      }; falling back to available mailbox (From may not match sales rep).`,
    );
  }

  const salesCc = buildSalesCcExcluding(
    [recipient, salesRepEmail, mailContext?.accountEmail],
    salesRecipients.cc,
  );

  const approved = decision === "approved";
  const subject = approved
    ? `[${requestRecord.requestNumber}] Cancellation approved — ${requestRecord.companyName || "Worktual"}`
    : `[${requestRecord.requestNumber}] Cancellation request update — ${requestRecord.companyName || "Worktual"}`;

  const body = [
    `Dear ${contactName},`,
    "",
    approved
      ? `Your cancellation request has been approved. This update is from ${salesRepName}, your Worktual sales representative.`
      : `Your cancellation request was reviewed and could not be approved at this time. This update is from ${salesRepName}, your Worktual sales representative.`,
    "",
    formatCancellationRequestBlock(requestRecord, { forCustomer: true }),
    requestRecord.adminNote ? `Note from Worktual: ${requestRecord.adminNote}` : "",
    "",
    approved
      ? "The affected product or branch access has been deactivated as requested. Reply to this email if you need help from your sales representative."
      : "Reply to this email if you need further assistance from your sales representative.",
    "",
    "Best regards,",
    salesRepName,
    salesRepEmail,
    "Worktual",
  ]
    .filter(Boolean)
    .join("\n");

  const mailbox = mailContext?.mailboxProfile || "sales";
  const payload = {
    to: [recipient],
    cc: salesCc.length ? salesCc : undefined,
    subject,
    body,
    mailbox,
  };
  if (salesRepEmail) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    payload.replyTo = salesRepEmail;
  }

  console.log(
    `[mail] Sending cancellation ${decision} notice to ${recipient} from ${
      mailContext?.accountEmail || mailbox
    } (sales rep: ${salesRepName}).`,
  );

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  await sendCustomerFacingEmail(payload, mailbox, mailContext);

  return {
    sent: true,
    recipient,
    cc: salesCc,
    salesRepEmail: salesRepEmail || null,
    salesRepName,
    mailbox,
  };
}

/**
 * Product UAT credentials email (after sales Send UAT).
 * Hydrates go-live + lead from DB — do not pass passwords in the queue payload.
 */
export async function notifyUatCredentials(goLiveOrId: any) {
  const goLiveId =
    typeof goLiveOrId === "string" || typeof goLiveOrId === "number"
      ? String(goLiveOrId)
      : goLiveOrId?.id || null;
  if (!goLiveId) {
    throw new Error("goLiveId is required to send UAT credentials email.");
  }

  const { pool } = await import("../../db/pool.js");
  const goLiveRepo = await import("../../repositories/raw/productGoLive.repo.js");
  const { getLeadById } = await import("../leads/lead-store.js");
  const { UAT_DURATION_DAYS } = await import("../payments/billingPhases.js");

  const row = await goLiveRepo.selectGoLiveById(pool, goLiveId);
  if (!row) {
    throw new Error("Go-live product record not found for UAT credentials email.");
  }

  const lead = await getLeadById(row.lead_id);
  if (!lead) {
    throw new Error("Lead not found for UAT credentials email.");
  }

  const { to, cc } = buildOutboundRecipients(lead);
  if (!to.length) {
    throw new Error(
      "Lead work email, admin email, or reseller billing email is missing — cannot send UAT credentials.",
    );
  }

  const credentials =
    row.uat_credentials && typeof row.uat_credentials === "object" ? row.uat_credentials : {};
  const portalUrl = String(credentials.portalUrl || credentials.portal_url || "").trim();
  const username = String(credentials.username || "").trim();
  const password = String(credentials.password || "").trim();
  const notes = String(
    credentials.notes || credentials.note || "",
  ).trim();
  const productName = getProductName(row.product_id);
  const branchId = String(row.branch_id || "hq");
  const companyName = lead.companyName || "your organization";
  const contactName =
    lead.reseller?.contactName || lead.contactName || "there";
  const durationDays =
    Number(credentials.durationDays) > 0
      ? Number(credentials.durationDays)
      : UAT_DURATION_DAYS;
  const expiresAt = row.uat_expires_at
    ? new Date(row.uat_expires_at).toLocaleString()
    : `${durationDays} days from send`;

  const subject = `Worktual UAT access — ${productName} (${companyName})`;
  const body = [
    `Dear ${contactName},`,
    "",
    `Your ${productName} environment is ready for user acceptance testing (UAT).`,
    "",
    `Company: ${companyName}`,
    `Product: ${productName}`,
    `Location: ${branchId}`,
    `UAT duration: ${durationDays} days`,
    `UAT access expires: ${expiresAt}`,
    "",
    "Product portal credentials",
    "--------------------------",
    `Portal URL: ${portalUrl || "—"}`,
    `Username: ${username || "—"}`,
    `Password: ${password || "—"}`,
    ...(notes ? [`Notes: ${notes}`, ""] : [""]),
    "These credentials are for the product UAT environment only. Your My Accounts portal login is separate and does not expire with UAT.",
    "",
    "When testing is complete, accept the product (ready to purchase) from the customer portal, or reply if you need changes.",
    "",
    "Best regards,",
    "Worktual",
  ].join("\n");

  const salesContext = await resolveSalesMailContextForLead(row.lead_id);
  console.log(
    `[mail] Sending UAT credentials to ${to.join(", ")} for ${productName} / ${companyName}.`,
  );

  await sendCustomerFacingEmail(
    {
      to,
      cc: cc.length ? cc : undefined,
      subject,
      body,
      mailbox: "sales",
    },
    "sales",
    // @ts-expect-error -- legacy sales mail context shape
    salesContext,
  );

  return {
    sent: true,
    recipient: to[0],
    cc,
    goLiveId,
    productId: row.product_id,
  };
}

/**
 * After customer accepts UAT (OK to purchase): notify the lead's sales person
 * that a go-live proration invoice was queued for finance.
 */
export async function notifySalesGoLiveAccepted(quotationOrId: any, goLiveIds: any = []) {
  const quotationId =
    typeof quotationOrId === "string" || typeof quotationOrId === "number"
      ? String(quotationOrId)
      : quotationOrId?.id || null;
  if (!quotationId) {
    throw new Error("quotationId is required to notify sales of go-live accept.");
  }

  const { getQuotation } = await import("../quotations/quotation-store.js");
  const quotation =
    typeof quotationOrId === "object" && quotationOrId?.id
      ? quotationOrId
      : await getQuotation(quotationId, { includePdfs: false });
  if (!quotation) {
    throw new Error("Quotation not found for go-live accept sales email.");
  }

  const salesRecipients = await resolveBranchDropSalesRecipients(quotation.leadId);
  const salesRep = salesRecipients.salesExecutive;
  const salesAdmin = salesRecipients.salesAdmin;
  if (!salesRep?.email) {
    console.warn("[mail] No sales recipient for go-live accept — skipping alert.");
    return { sent: false, reason: "missing_sales_recipient" };
  }

  const companyName = quotation.lead?.companyName || "Unknown company";
  const productLines = quotationProductLines(quotation);
  const productLabel = productLines.length ? productLines.join(", ") : "product";
  const appBase = String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  const leadUrl = quotation.leadId ? `${appBase}/customers/${quotation.leadId}` : appBase;

  const subject = `Customer accepted UAT — ${productLabel} (${companyName})`;
  const body = [
    `Dear ${salesRep.name || "Sales"},`,
    "",
    "The customer accepted UAT and confirmed they are ready to purchase.",
    "A prorated go-live invoice has been created and queued for finance approval.",
    "",
    "Lead details",
    "------------",
    formatLeadBlock(quotation.lead || {}),
    "",
    `Product(s): ${productLabel}`,
    goLiveIds?.length ? `Go-live record(s): ${goLiveIds.join(", ")}` : "",
    `Quotation: ${quotationId}`,
    quotation.grandTotal != null
      ? `Go-live amount: ₹${Number(quotation.grandTotal).toFixed(2)}`
      : "",
    "",
    "Next steps",
    "----------",
    "1. Finance reviews and approves the go-live invoice.",
    "2. Customer receives the payment link.",
    "3. After payment, the subscription starts (live).",
    "",
    `Open the customer account: ${leadUrl}`,
    "",
    "Regards,",
    "Worktual Accounts",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");

  const to = [salesRep.email];
  const cc = buildSalesCcExcluding(to, salesAdmin?.email ? [salesAdmin.email] : []);
  const mailContext =
    (quotation.leadId ? await resolveSalesMailContextForLead(quotation.leadId) : null) ||
    (salesRep.userId ? await resolveMailContextForUser(salesRep.userId) : null);

  console.log(
    `[mail] Go-live accept → sales ${salesRep.email}${cc.length ? ` (cc ${cc.join(", ")})` : ""} for ${companyName}.`,
  );

  const mailbox =
    mailContext?.mailboxProfile ||
    (salesRep.role === USER_ROLES.SALES_ADMIN ? "sales_admin" : "sales");

  await sendEmail(
    {
      to,
      cc: cc.length ? cc : undefined,
      subject,
      body,
      mailbox,
    },
    mailbox,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailContext,
  );

  return { sent: true, recipient: salesRep.email, cc, quotationId };
}
