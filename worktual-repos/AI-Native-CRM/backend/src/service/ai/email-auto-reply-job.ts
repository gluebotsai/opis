/**
 * Autonomous inbound email agent.
 *
 * Paths:
 * - Safe reply (Python agent) for routine product/help/tools questions
 *   (sales KB + product catalog names)
 * - Demo booking (demo_ask_slot / demo_check_slot / demo_confirm_slot) on the
 *   assigned rep's connected mailbox only — never on CRM bot nurture mail
 * - Sensitive escalate only for pricing/quote/invoice, legal/contract,
 *   payment disputes, confidential data, or serious complaints/security —
 *   thread tagged "Manual response needed" and notified to the owner/admins
 *
 * Intent: latest inbound subject+body is primary; thread history is supporting
 * context for compose (and for LLM classify pronouns/short replies). Auto-reply
 * and manual escalation share the same decision path.
 */

import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { getContactProfileByAccountId } from "@/dao/contacts/contact-profile-repository";
import {
  crmBotMailboxEmail,
  emailHeadersMention,
} from "@/dao/inbox/email-activity-user";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { sendConnectedEmailForUser } from "@/service/email/send-connected-email";
import { sendCrmBotEmail } from "@/service/email/send-crm-bot-email";
import {
  crmBotEmailThreadingFromInbound,
  loadInboundEmailThreadHeaders,
} from "@/service/email/inbound-thread-headers";
import {
  notifyOwnerOrAdmins,
  notifyUsers,
} from "@/dao/notifications/notify-users";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { triggerCompliancePrivacyAssess } from "@/service/ai/compliance-privacy-assess";
import { htmlToPlainText, isHtmlEmailBody } from "@/lib/email-body";
import {
  bookDemoMeeting,
  demoAskSlotBody,
  demoProposeAltsBody,
  DEMO_DURATION_MINUTES,
  DEMO_TIMEZONE,
  findFreeSlots,
  findOpenDemoStateForThread,
  closeAwaitingDemoJobs,
  formatSlotOption,
  isDemoCategory,
  normalizeDemoCategory,
  isSlotFree,
  mailboxHasGoogleCalendar,
  parsePreferredDateTime,
  latestOutboundDemoOfferIso,
  SLOT_CONFIRM_RE,
  threadOfferedDemo,
  resolveDemoCalendarUser,
  type DemoState,
} from "@/service/ai/demo-booking";
import { getSetupUserById, resolveSetupUserDeliveryEmail } from "@/service/account/setup-users";
import {
  evaluateScheduleLoyaltyGate,
  loadContactEngagement,
  resolveScheduleIntentForThread,
  type ContactEngagement,
} from "@/service/ai/schedule-loyalty";
import {
  claimAutoReplyJob,
  findAutoReplyJobByActivity,
  findAutoReplyJobById,
  listDueAutoReplyJobs,
  requeueUnsentAutoReplyJob,
  updateAutoReplyJob,
  upsertAutoReplyJob,
  type AutoReplyJobRow,
} from "@/dao/ai/email-auto-reply-store";
import { clearManualResponseNeededForThread } from "@/dao/inbox/inbox-service";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { parseAllEmailAddresses } from "@/service/google/gmail";
import { resolveCrmBotMailbox } from "@/dao/account/crm-bot-mailbox";
import { effectiveContactType } from "@/lib/contact-lifecycle";
import {
  BOT_DEMO_HANDOFF_CATEGORY,
  DEMO_INTENT_RE,
  detectDemoIntentOnInbound,
  handOffBotMailDemoRequest,
  isBotMailboxContext,
} from "@/service/ai/bot-demo-handoff";

const JOB_BUDGET_MS = AI_SERVICE_JOB_TIMEOUT_MS + 30_000;
const FAIL_RETRY_MS = 15 * 60_000;
const MAX_BODY_CHARS = 4_000;

export type AutoReplyDecision =
  | "safe_auto_reply"
  | "sensitive_escalate"
  | "skip";

export type AutoReplyThreadMessage = {
  id: string;
  direction: "inbound" | "outbound" | null;
  subject: string;
  body: string;
  createdAt: string;
};

export type AutoReplyEnrichment = {
  companyName: string | null;
  industry: string | null;
  companySize: string | null;
  geography: string | null;
  seniorityTier: string | null;
  revenueBand: string | null;
  companyDescription: string | null;
  products: string | null;
};

export type AutoReplyContext = {
  organizationId: string;
  activityId: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactTitle: string | null;
  companyName: string | null;
  companyIndustry: string | null;
  contactType: string | null;
  leadStatus: string | null;
  ownerUserId: string | null;
  mailboxUserId: string | null;
  mailboxEmail: string | null;
  /** Tenant org name (sender) — never the customer's company. */
  senderOrganizationName: string;
  mailProvider: "google" | "microsoft" | null;
  threadId: string | null;
  subject: string;
  body: string;
  receivedAt: string;
  thread: AutoReplyThreadMessage[];
  /** This inbound already produced a sent auto-reply or an open demo booking. */
  alreadyHandled: boolean;
  humanRepliedAfter: boolean;
  demoState: DemoState | null;
  timezone: string;
  /** Additive loyalty signals for schedule/reschedule escalation. */
  engagement: ContactEngagement;
  /** Active product names only (no prices) for general auto-replies. */
  productCatalog?: string;
  /** Stored lead summary from enrichment + scoring (understand who they are). */
  leadSummary?: string | null;
  leadHeadline?: string | null;
  leadIntent?: string | null;
  recommendedAction?: string | null;
  enrichment?: AutoReplyEnrichment | null;
};

export type AutoReplyAgentDecision = {
  decision: AutoReplyDecision;
  sensitivity: "safe" | "sensitive" | "unknown";
  category?: string | null;
  reason?: string | null;
  replySubject?: string | null;
  replyBody?: string | null;
  requestedStartIso?: string | null;
  chosenSlotIso?: string | null;
  timeZone?: string | null;
};

export type AutoReplyApplyResult = {
  status: "replied" | "awaiting_demo" | "escalated" | "skipped" | "failed";
  decision: AutoReplyDecision;
  sensitivity: string;
  category: string | null;
  reason: string | null;
  replyActivityId: string | null;
  escalatedToUserId: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  demoState?: DemoState | null;
};

const PERSIST_STATUSES = new Set([
  "replied",
  "awaiting_demo",
  "escalated",
  "skipped",
  "failed",
]);

/** Python persist + sendSuccess envelope both flatten `status` onto the payload. */
export function unwrapPersistResult(
  py: {
    persistResult?: AutoReplyApplyResult & { statusCode?: number };
    persist_result?: AutoReplyApplyResult;
    status?: string;
    decision?: AutoReplyDecision;
  } | null,
): AutoReplyApplyResult | null {
  if (!py) return null;
  const candidate = py.persistResult ?? py.persist_result ?? null;
  if (
    candidate &&
    typeof candidate.status === "string" &&
    PERSIST_STATUSES.has(candidate.status)
  ) {
    return candidate;
  }
  if (
    typeof py.status === "string" &&
    PERSIST_STATUSES.has(py.status) &&
    py.decision
  ) {
    return py as AutoReplyApplyResult;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Context                                                            */
/* ------------------------------------------------------------------ */

function plainBody(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  const plain = isHtmlEmailBody(text) ? htmlToPlainText(text) : text;
  return plain.replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY_CHARS);
}

/** Customer-written part of an inbound body — ignore Gmail quote history. */
const SYNC_HEADER_RE =
  /^From:\s*.+\nTo:\s*.+(?:\nCc:\s*.+)?\n+/im;

function stripInboundSyncHeaders(text: string): string {
  const stripped = text.replace(SYNC_HEADER_RE, "").trim();
  return stripped || text.trim();
}

export function latestInboundPlain(body: string | null | undefined): string {
  let text = (body ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  if (isHtmlEmailBody(text)) {
    const htmlCut = text.search(
      /<div[^>]*\bclass="[^"]*\bgmail_quote\b[^"]*"[^>]*>|<div[^>]*\bid="divRplyFwdMsg"[^>]*>|<blockquote\b/i,
    );
    if (htmlCut > 8) {
      text = stripInboundSyncHeaders(
        htmlToPlainText(text.slice(0, htmlCut)).trim(),
      );
      if (text) return text;
    }
    text = stripInboundSyncHeaders(htmlToPlainText(text));
  }
  if (
    /^On\b[\s\S]{5,320}?\bwrote:\s*/i.test(text) &&
    (/\n>/.test(text) || />/.test(text))
  ) {
    return "";
  }
  const quoteAt = text.search(
    /\n[ \t\u00A0\u202F]*>?[ \t]*On[\s\S]{5,320}?\bwrote:\s*/i,
  );
  if (quoteAt > 0) return stripInboundSyncHeaders(text.slice(0, quoteAt).trim());
  const fwdAt = text.search(/\n(?:From:\s.+\n(?:Sent|Date):|-{2,}\s*Original Message)/i);
  if (fwdAt > 20) return stripInboundSyncHeaders(text.slice(0, fwdAt).trim());
  return stripInboundSyncHeaders(text);
}

async function loadProductCatalogNames(organizationId: string): Promise<string> {
  try {
    const { listProducts } = await import("@/dao/products/product-crm-service");
    const page = await listProducts({
      page: 1,
      pageSize: 12,
      status: "active",
      organizationId,
    });
    return (page.items ?? [])
      .map((p) => String(p.name || "").trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

export async function buildAutoReplyContext(
  activityId: string,
  organizationId?: string | null,
): Promise<AutoReplyContext | null> {
  // Raw SQL so a Turbopack-stale Prisma client (missing mail_provider /
  // needs_manual_response) cannot break the agent after a schema add.
  const activityRows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      contact_id: string;
      subject: string;
      body: string | null;
      thread_id: string | null;
      folder: string;
      email_direction: string | null;
      mail_provider: string | null;
      created_by_user_id: string | null;
      created_at: Date;
      needs_manual_response: boolean;
    }>
  >(
    `
    SELECT id, contact_id::text AS contact_id, subject, body, thread_id,
           folder::text AS folder, email_direction::text AS email_direction,
           mail_provider::text AS mail_provider,
           created_by_user_id::text AS created_by_user_id,
           created_at, COALESCE(needs_manual_response, false) AS needs_manual_response
    FROM contact_activities
    WHERE id = $1
    LIMIT 1
    `,
    activityId,
  );
  const activity = activityRows[0];
  if (!activity) return null;
  const inbound =
    activity.email_direction === "inbound" ||
    (!activity.email_direction && activity.folder === "inbox");
  if (!inbound) return null;

  const contact = await getContact(activity.contact_id);
  const overlay = contact
    ? null
    : await getContactProfileByAccountId(activity.contact_id);
  const botEmail = await crmBotMailboxEmail(
    organizationId ?? contact?.person.organizationId ?? overlay?.organizationId,
  );

  const threadKey = activity.thread_id ?? activity.id;
  const threadRows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      subject: string;
      body: string | null;
      email_direction: string | null;
      created_at: Date;
      created_by_user_id: string | null;
    }>
  >(
    `
    SELECT id, subject, body, email_direction::text AS email_direction,
           created_at, created_by_user_id::text AS created_by_user_id
    FROM contact_activities
    WHERE type = 'email'
      AND (thread_id = $1 OR id = $1)
    ORDER BY created_at ASC
    LIMIT 20
    `,
    threadKey,
  );

  // A human (or a prior auto-reply on this same inbound) already sent after it.
  // Rep-mailbox inbounds share a CRM thread_id with nurture bot mail. Bot mail
  // is stored under the contact owner, so detect it from the CRM bot address
  // in the headers instead of a missing user id.
  const inboundIsBot =
    !activity.created_by_user_id ||
    emailHeadersMention(activity.body, botEmail);
  const humanRepliedAfter = threadRows.some((m) => {
    if (m.email_direction !== "outbound") return false;
    if (
      new Date(m.created_at).getTime() <=
      new Date(activity.created_at).getTime()
    ) {
      return false;
    }
    const outboundIsBot =
      !m.created_by_user_id || emailHeadersMention(m.body, botEmail);
    if (!inboundIsBot && outboundIsBot) return false;
    return inboundIsBot ? !outboundIsBot : m.created_by_user_id != null;
  });

  // Only this inbound — a prior escalate/reply on the thread must not block
  // a new customer message (or a retry after a false escalate).
  const selfJobs = await prisma.$queryRawUnsafe<
    Array<{ count: number | bigint }>
  >(
    `
    SELECT COUNT(*)::int AS count
    FROM email_auto_reply_jobs
    WHERE inbound_activity_id = $1
      AND (
        status = 'awaiting_demo'
        OR (status = 'replied' AND reply_activity_id IS NOT NULL)
      )
    `,
    activity.id,
  );
  const alreadyHandled = Number(selfJobs[0]?.count ?? 0) > 0;

  const openDemo = await findOpenDemoStateForThread({
    threadId: activity.thread_id,
    contactId: activity.contact_id,
    activityIds: threadRows.map((m) => m.id),
  });
  const demoState = openDemo?.state ?? null;

  let mailboxEmail: string | null = null;
  let senderOrganizationName = "Worktual";
  if (activity.created_by_user_id) {
    const [connRows, setupUser] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ account_email: string | null }>>(
        `
        SELECT account_email
        FROM user_integration_connections
        WHERE user_id = $1::bigint
          AND ($2::text IS NULL OR provider::text = $2)
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        activity.created_by_user_id,
        activity.mail_provider,
      ),
      getSetupUserById(activity.created_by_user_id).catch(() => null),
    ]);
    mailboxEmail = connRows[0]?.account_email ?? null;
    senderOrganizationName = setupUser?.org_name?.trim() || "Worktual";
  }

  // The stored user is the contact owner. When the headers name the CRM bot
  // address, replies still go out from that mailbox, and that address is
  // excluded when picking the customer's email from the headers.
  const integrationEmail = mailboxEmail;
  const onBotChannel =
    Boolean(botEmail) &&
    emailHeadersMention(activity.body, botEmail) &&
    !emailHeadersMention(activity.body, integrationEmail);
  if (onBotChannel) {
    mailboxEmail = botEmail;
  } else if (!mailboxEmail && !activity.created_by_user_id) {
    mailboxEmail = botEmail ?? mailboxEmail;
  }
  const replyMailboxUserId = onBotChannel
    ? null
    : activity.created_by_user_id?.trim() || null;

  const person = contact?.person;
  const crm = contact?.crm ?? {
    ownerUserId: overlay?.ownerUserId ?? null,
    createdByUserId: overlay?.createdByUserId ?? null,
    leadSource: overlay?.leadSource ?? null,
    tags: overlay?.tags ?? [],
    status: overlay?.status ?? null,
    notes: overlay?.notes ?? null,
  };
  const displayName = contact?.displayName ?? "Contact";
  const mailProvider =
    activity.mail_provider === "google" || activity.mail_provider === "microsoft"
      ? activity.mail_provider
      : null;

  // Auto-replies need a reply-to address. Prefer the linked CDP primary
  // `email` identity; if missing, extract from synced Gmail headers that
  // `sync-gmail-inbox` persists into the activity body.
  let contactEmail = person?.email ?? null;
  if (!contactEmail?.includes("@")) {
    const candidates = parseAllEmailAddresses(activity.body);
    const mailboxLower = mailboxEmail?.toLowerCase() ?? null;
    const candidate =
      candidates.find((e) => !mailboxLower || e.toLowerCase() !== mailboxLower) ??
      candidates[0] ??
      null;
    contactEmail = candidate;
  }

  const engagement = await loadContactEngagement({
    contactId: activity.contact_id,
    activityIds: threadRows.map((m) => m.id),
    contactType: effectiveContactType(person?.contactType),
  });

  const orgId = await resolveRequestOrganizationId(
    organizationId ?? person?.organizationId ?? overlay?.organizationId,
  );
  const productCatalog = await loadProductCatalogNames(orgId);

  let leadSummary: string | null = null;
  let leadHeadline: string | null = null;
  let leadIntent: string | null = null;
  let recommendedAction: string | null = null;
  let enrichment: AutoReplyEnrichment | null = null;
  try {
    const [{ findLeadSummary }, { findLeadEnrichmentSnapshot }] = await Promise.all([
      import("@/dao/ai/lead-summary-store"),
      import("@/dao/ai/lead-enrichment-snapshot"),
    ]);
    const [summaryRow, snap] = await Promise.all([
      findLeadSummary(orgId, activity.contact_id),
      findLeadEnrichmentSnapshot(orgId, activity.contact_id),
    ]);
    if (summaryRow) {
      leadSummary = summaryRow.summary?.trim() || null;
      leadHeadline = summaryRow.headline?.trim() || null;
      leadIntent = summaryRow.intent?.trim() || null;
      recommendedAction = summaryRow.recommendedAction?.trim() || null;
    }
    if (snap) {
      const str = (key: string) => {
        const v = snap[key];
        return v == null || String(v).trim() === "" ? null : String(v).trim();
      };
      enrichment = {
        companyName: str("company_name"),
        industry: str("industry"),
        companySize: str("company_size"),
        geography: str("geography"),
        seniorityTier: str("seniority_tier"),
        revenueBand: str("revenue_band"),
        companyDescription: str("company_description"),
        products: str("products"),
      };
    }
  } catch {
    // best-effort — still reply without enrichment
  }

  return {
    organizationId: orgId,
    activityId: activity.id,
    contactId: activity.contact_id,
    contactName: displayName,
    contactEmail,
    contactTitle: person?.title ?? null,
    companyName: person?.company?.name ?? null,
    companyIndustry: person?.company?.industry ?? null,
    contactType: effectiveContactType(person?.contactType),
    leadStatus: person?.leadStatus ?? overlay?.leadStatus ?? null,
    ownerUserId: crm.ownerUserId ?? person?.ownerUserId ?? overlay?.ownerUserId ?? null,
    mailboxUserId: replyMailboxUserId,
    mailboxEmail,
    senderOrganizationName,
    mailProvider,
    threadId: activity.thread_id,
    subject: activity.subject,
    body: plainBody(activity.body),
    receivedAt: new Date(activity.created_at).toISOString(),
    thread: threadRows.map((m) => ({
      id: m.id,
      direction:
        m.email_direction === "inbound" || m.email_direction === "outbound"
          ? m.email_direction
          : null,
      subject: m.subject,
      body: plainBody(m.body),
      createdAt: new Date(m.created_at).toISOString(),
    })),
    alreadyHandled,
    humanRepliedAfter,
    demoState,
    timezone: DEMO_TIMEZONE,
    engagement,
    productCatalog,
    leadSummary,
    leadHeadline,
    leadIntent,
    recommendedAction,
    enrichment,
  };
}

/* ------------------------------------------------------------------ */
/* Heuristic classify (routing guardrails when ai-service is down)   */
/* ------------------------------------------------------------------ */

const SENSITIVE_PATTERNS: Array<{ re: RegExp; category: string }> = [
  {
    re: /\b(lawsuit|litigation|attorney|solicitor|legal counsel|cease and desist|subpoena|court order|breach of contract|indemnif\w*|liabilit\w*)\b/i,
    category: "legal",
  },
  {
    re: /\b(nda|non-?disclosure|msa|master service agreement|contract (?:review|amendment|termination)|terms and conditions|dpa|data processing agreement|legal (?:review|counsel|terms)|compliance (?:review|audit))\b/i,
    category: "contract",
  },
  {
    re: /\b(gdpr|ccpa|hipaa|soc ?2|data (?:breach|deletion) request|right to be forgotten|privacy complaint|compliance audit)\b/i,
    category: "compliance",
  },
  {
    re: /\b(refund|chargeback|dispute|overcharged|billing error|unauthori[sz]ed (?:charge|payment)|invoice discrepanc\w*|billing dispute)\b/i,
    category: "billing_dispute",
  },
  {
    re: /(?:send\s+(?:me\s+)?(?:a\s+)?(?:quote|quotation|proposal|invoice)|\bhow much (?:does|do|is|are|would)\b|\bpricing\b|\bprice list\b|\bunit price\b|\bprice per\b|\bquotation\b|\brfq\b|we want to buy|proceed with purchase|start (?:a )?contract)/i,
    category: "pricing",
  },
  {
    re: /\b(api[_ ]?key|password|credentials|access token|(?:send|share|export|leak|dump)\w*\s+(?:me\s+)?(?:the\s+)?(?:customer|client|internal)\s+data|financial report|delete account|change ownership)\b/i,
    category: "confidential",
  },
  {
    re: /\b(complaint|escalat\w+|unacceptable|extremely disappointed|report you to|take (?:this|it) further)\b/i,
    category: "complaint",
  },
  {
    re: /\b(security (?:incident|vulnerability)|penetration test|pen ?test|breach notification)\b/i,
    category: "security",
  },
];

const NO_REPLY_PATTERNS =
  /\b(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|automated message|out of office|auto(?:matic)? reply|delivery status notification|undeliverable)\b/i;

/**
 * Newsletters, product alerts, and transactional mail. These reach the same
 * inbox as customer replies but nobody wants an assistant answering them.
 */
const BULK_MAIL_PATTERNS =
  /(unsubscribe|manage (?:your )?(?:email )?preferences|update your preferences|view (?:this email )?in (?:your )?browser|you(?:'re| are) receiving this (?:email|message)|verification code|security code|one-?time (?:password|code)|\botp\b|\d-digit code|password reset|reset your (?:\w+ ){0,3}password|confirm your email|weekly (?:summary|digest|report)|your receipt|payment (?:successful|received)|do not share this code|usage (?:limit|alert)|bandwidth limit)/i;

const INTEREST_RE =
  /^\s*(?:yes[,.]?\s+)?(?:i(?:['’]?m| am)\s+)?interested\b|^\s*yes[,.]?\s+(?:please|i(?:['’]?m| am) interested)\b|^\s*count me in\b/i;

/** Proposal/quote acceptance — not a demo scheduling turn. */
const PROPOSAL_ACCEPT_RE =
  /\b(?:i\s+)?(?:accept(?:ed|ance)?|approve(?:d)?)\s+(?:the\s+)?(?:proposal|quote|quotation)\b/i;

/**
 * Intent from latest inbound body only. Open demoState is the sole thread-level
 * exception (continue an in-flight booking). Routing guardrails only — never
 * invent reply text (LLM compose required for general category).
 */
export function heuristicClassify(ctx: AutoReplyContext): AutoReplyAgentDecision {
  const latest = latestInboundPlain(ctx.body);
  const haystack = `${ctx.subject}\n${latest}`;
  const timeZone = ctx.timezone || DEMO_TIMEZONE;

  if (
    isBotMailboxContext(ctx.mailboxUserId) &&
    detectDemoIntentOnInbound({
      subject: ctx.subject,
      latestInboundBody: latest,
      timezone: timeZone,
      openDemoPhase: ctx.demoState?.phase ?? null,
    })
  ) {
    return {
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: BOT_DEMO_HANDOFF_CATEGORY,
      reason: "Demo on CRM bot mail — assign rep and hand off (no bot booking).",
    };
  }

  if (!ctx.body || ctx.body.length < 8) {
    return { decision: "skip", sensitivity: "unknown", reason: "empty_body" };
  }
  if (
    !latest.trim() &&
    !(ctx.demoState && ctx.demoState.phase && ctx.demoState.phase !== "booked")
  ) {
    return { decision: "skip", sensitivity: "unknown", reason: "quote_only_body" };
  }
  if (NO_REPLY_PATTERNS.test(haystack) || NO_REPLY_PATTERNS.test(ctx.contactEmail ?? "")) {
    return {
      decision: "skip",
      sensitivity: "unknown",
      reason: "automated_sender",
    };
  }
  if (BULK_MAIL_PATTERNS.test(haystack)) {
    return {
      decision: "skip",
      sensitivity: "unknown",
      reason: "bulk_or_transactional_mail",
    };
  }

  for (const { re, category } of SENSITIVE_PATTERNS) {
    if (re.test(latest)) {
      return {
        decision: "sensitive_escalate",
        sensitivity: "sensitive",
        category,
        reason: `Detected ${category.replace(/_/g, " ")} language that needs a human response.`,
      };
    }
  }

  const outboundOfferIso = latestOutboundDemoOfferIso(
    ctx.thread,
    new Date(),
    timeZone,
  );
  const parsedLatest = parsePreferredDateTime(latest, new Date(), timeZone);
  const threadDemo = threadOfferedDemo(ctx.thread);
  if (
    outboundOfferIso &&
    (SLOT_CONFIRM_RE.test(latest.trim()) || INTEREST_RE.test(latest.trim()))
  ) {
    return {
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_confirm_slot",
      reason: "Lead confirmed the proposed demo time.",
      chosenSlotIso: outboundOfferIso,
      timeZone,
    };
  }

  if (INTEREST_RE.test(latest.trim())) {
    return {
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "general",
      reason: "Customer confirmed interest — LLM compose required.",
    };
  }

  if (PROPOSAL_ACCEPT_RE.test(latest.trim())) {
    return {
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "general",
      reason: "Customer accepted the proposal — LLM compose required.",
    };
  }

  const openDemoOnThread =
    Boolean(ctx.demoState?.phase) &&
    ctx.demoState?.phase !== "booked" &&
    threadOfferedDemo(ctx.thread);

  const repThreadActive =
    Boolean(ctx.mailboxUserId) &&
    ctx.thread.some((m) => m.direction === "outbound");

  if (
    parsedLatest &&
    (DEMO_INTENT_RE.test(latest) ||
      threadDemo ||
      openDemoOnThread ||
      repThreadActive)
  ) {
    return {
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_check_slot",
      reason: "Lead shared a preferred demo date/time.",
      requestedStartIso: parsedLatest.toISOString(),
      timeZone,
    };
  }

  // Multi-turn demo booking on an open thread (same thread only).
  if (openDemoOnThread) {
    const parsed = parsePreferredDateTime(haystack, new Date(), timeZone);
    if (ctx.demoState.phase === "propose_alts" && ctx.demoState.proposedSlots?.length) {
      const num = haystack.match(/\b([1-3])\b/);
      if (num) {
        const idx = Number(num[1]) - 1;
        const chosen = ctx.demoState.proposedSlots[idx];
        if (chosen) {
          return {
            decision: "safe_auto_reply",
            sensitivity: "safe",
            category: "demo_confirm_slot",
            reason: "Lead confirmed a proposed demo slot.",
            chosenSlotIso: chosen,
            timeZone,
          };
        }
      }
      // Match a proposed slot by approximate time text.
      for (const slot of ctx.demoState.proposedSlots) {
        const slotDate = new Date(slot);
        if (Number.isNaN(slotDate.getTime())) continue;
        if (
          parsed &&
          Math.abs(parsed.getTime() - slotDate.getTime()) < 20 * 60_000
        ) {
          return {
            decision: "safe_auto_reply",
            sensitivity: "safe",
            category: "demo_confirm_slot",
            reason: "Lead confirmed a proposed demo slot.",
            chosenSlotIso: slot,
            timeZone,
          };
        }
      }
    }
    if (parsed) {
      return {
        decision: "safe_auto_reply",
        sensitivity: "safe",
        category: "demo_check_slot",
        reason: "Lead shared a preferred demo date/time.",
        requestedStartIso: parsed.toISOString(),
        timeZone,
      };
    }
    return {
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_ask_slot",
      reason: "Still waiting for a preferred demo date/time.",
      replySubject: heuristicReplySubject(ctx.subject),
      replyBody: demoAskSlotBody(ctx.contactName, ctx.senderOrganizationName),
      timeZone,
    };
  }

  if (DEMO_INTENT_RE.test(latest)) {
    const parsed = parsePreferredDateTime(haystack, new Date(), timeZone);
    if (parsed) {
      return {
        decision: "safe_auto_reply",
        sensitivity: "safe",
        category: "demo_check_slot",
        reason: "Demo request includes a preferred date/time.",
        requestedStartIso: parsed.toISOString(),
        timeZone,
      };
    }
    return {
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_ask_slot",
      reason: "Demo request — ask for preferred date and time.",
      replySubject: heuristicReplySubject(ctx.subject),
      replyBody: demoAskSlotBody(ctx.contactName, ctx.senderOrganizationName),
      timeZone,
    };
  }

  return {
    decision: "safe_auto_reply",
    sensitivity: "safe",
    category: "general",
    reason: "Routine inbound — LLM compose required.",
  };
}

/**
 * When the LLM (or agent) skips a short slot reply on an active demo thread,
 * recover using deterministic heuristics so booking still proceeds.
 */
export function recoverSkippedDemoDecision(
  ctx: AutoReplyContext,
  input: AutoReplyAgentDecision,
): AutoReplyAgentDecision | null {
  if (input.decision !== "skip") return null;

  const openDemo =
    Boolean(ctx.demoState?.phase) && ctx.demoState?.phase !== "booked";
  const threadDemo = threadOfferedDemo(ctx.thread);
  const openDemoOnThread = openDemo && threadDemo;
  const latest = latestInboundPlain(ctx.body);
  const parsedLatest = parsePreferredDateTime(
    latest,
    new Date(),
    ctx.timezone || DEMO_TIMEZONE,
    { allowPast: openDemoOnThread || threadDemo },
  );
  const schedulingActive =
    openDemoOnThread ||
    threadDemo ||
    Boolean(parsedLatest && latest.trim()) ||
    (Boolean(ctx.mailboxUserId) &&
      ctx.thread.some((m) => m.direction === "outbound"));

  if (!schedulingActive) return null;

  const guard = heuristicClassify(ctx);
  if (
    guard.decision !== "safe_auto_reply" ||
    !String(guard.category || "").startsWith("demo_")
  ) {
    return null;
  }

  return {
    ...guard,
    reason:
      guard.reason ||
      input.reason ||
      "Recovered demo scheduling reply after agent skip.",
  };
}

function heuristicReplySubject(subject: string): string {
  const clean = subject.trim() || "your message";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

/* ------------------------------------------------------------------ */
/* Apply                                                              */
/* ------------------------------------------------------------------ */

function skipResult(
  decision: AutoReplyAgentDecision,
  reason: string,
): AutoReplyApplyResult {
  return {
    status: "skipped",
    decision: "skip",
    sensitivity: decision.sensitivity ?? "unknown",
    category: decision.category ?? null,
    reason,
    replyActivityId: null,
    escalatedToUserId: null,
    lastError: null,
    nextRetryAt: null,
  };
}

async function repRepliedOnContactSince(args: {
  contactId: string;
  ownerUserId: string;
  organizationId: string;
  since: Date;
}): Promise<boolean> {
  const botEmail = await crmBotMailboxEmail(args.organizationId);
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `
    SELECT COUNT(*)::int AS count
    FROM contact_activities
    WHERE contact_id = $1::text
      AND email_direction = 'outbound'
      AND created_by_user_id = $2::bigint
      AND created_at >= $3
      AND (
        $4::text IS NULL
        OR position(lower($4) in lower(left(coalesce(body, ''), 1500))) = 0
      )
    `,
    args.contactId,
    args.ownerUserId,
    args.since,
    botEmail,
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function tryBotMailDemoHandoff(
  ctx: AutoReplyContext,
  input: AutoReplyAgentDecision,
): Promise<AutoReplyApplyResult | null> {
  if (!isBotMailboxContext(ctx.mailboxUserId)) return null;
  if (ctx.ownerUserId?.trim()) return null;

  const latest = latestInboundPlain(ctx.body);
  const result = await handOffBotMailDemoRequest({
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    activityId: ctx.activityId,
    contactName: ctx.contactName,
    contactEmail: ctx.contactEmail,
    subject: ctx.subject,
    threadId: ctx.threadId,
    timezone: ctx.timezone,
    latestInboundBody: latest,
    openDemoPhase: ctx.demoState?.phase ?? null,
  });
  if (!result) return null;

  return {
    status: result.status,
    decision: result.decision,
    sensitivity: result.sensitivity,
    category: result.category,
    reason: result.reason,
    replyActivityId: result.replyActivityId,
    escalatedToUserId: result.escalatedToUserId,
    lastError: result.lastError,
    nextRetryAt: result.nextRetryAt,
  };
}

/** Assigned sales rep owns outreach — bot must not reply on nurture threads. */
async function handOffOwnedLeadToSales(
  ctx: AutoReplyContext,
  input: AutoReplyAgentDecision,
): Promise<AutoReplyApplyResult | null> {
  const ownerId = ctx.ownerUserId?.trim();
  if (!ownerId) return null;

  // Rep-owned mailbox threads keep normal auto-reply / demo booking.
  if (ctx.mailboxUserId) return null;

  const latest = latestInboundPlain(ctx.body);
  const haystack = `${ctx.subject}\n${latest}`;
  const demoIntent = DEMO_INTENT_RE.test(haystack);

  const inboundAt = new Date(ctx.receivedAt);
  const repReplied = await repRepliedOnContactSince({
    contactId: ctx.contactId,
    ownerUserId: ownerId,
    organizationId: ctx.organizationId,
    since: inboundAt,
  });
  if (repReplied && !demoIntent) {
    return skipResult(input, "assigned_rep_already_replied");
  }

  const ownerDelivery = await resolveSetupUserDeliveryEmail(
    ownerId,
    ctx.organizationId,
  );
  const ownerName =
    ownerDelivery?.displayName?.trim() || "your dedicated sales representative";

  if (
    demoIntent &&
    ctx.contactEmail?.includes("@") &&
    !ctx.alreadyHandled
  ) {
    const firstName =
      ctx.contactName.trim().split(/\s+/)[0] || "there";
    const subject = /^re:/i.test(ctx.subject.trim())
      ? ctx.subject.trim()
      : `Re: ${ctx.subject.trim()}`;
    const body = [
      `Hi ${firstName},`,
      "",
      `Thank you for your interest in a demo.`,
      `${ownerName} from our team has been assigned to you and will reach out shortly to schedule a time that works.`,
      "",
      "Best regards,",
      "Worktual",
    ].join("\n");

    const inbound = await loadInboundEmailThreadHeaders(ctx.activityId);

    const sent = await sendCrmBotEmail({
      organizationId: ctx.organizationId,
      to: ctx.contactEmail,
      subject,
      body,
      ...crmBotEmailThreadingFromInbound(inbound),
    });

    if (sent.ok) {
      const botEmail = await crmBotMailboxEmail(ctx.organizationId);
      const storedBody =
        botEmail && !emailHeadersMention(body, botEmail)
          ? `From: ${botEmail}\n\n${body}`
          : body;
      const replyActivity = await createContactActivity(ctx.contactId, {
        type: "email",
        subject,
        body: storedBody,
        folder: "sent",
        emailDirection: "outbound",
        createdByUserId: ownerId,
        threadId: ctx.threadId ?? ctx.activityId,
        gmailMessageId: sent.messageId ?? null,
        gmailThreadId: sent.threadId ?? inbound?.gmail_thread_id ?? null,
        rfcMessageId: sent.rfcMessageId ?? null,
      }).catch(() => null);

      await notifyOwnerOrAdmins({
        organizationId: ctx.organizationId,
        ownerUserId: ownerId,
        kind: "email_manual_response_needed",
        title: `Demo requested — follow up: ${ctx.contactName}`,
        body:
          "The lead asked to schedule a demo on a nurture thread. We acknowledged that you will contact them — please schedule the demo personally.",
        href: `/inbox?thread=${ctx.threadId ?? ctx.activityId}`,
        entityType: "contact_activity",
        entityId: ctx.activityId,
        contactId: ctx.contactId,
      });

      return {
        status: "replied",
        decision: "safe_auto_reply",
        sensitivity: input.sensitivity ?? "unknown",
        category: "assigned_owner_handoff",
        reason:
          "Acknowledged demo request; assigned rep will schedule personally.",
        replyActivityId: replyActivity?.id ?? null,
        escalatedToUserId: ownerId,
        lastError: null,
        nextRetryAt: null,
      };
    }
  }

  if (!ctx.mailboxUserId) {
    await prisma.$executeRawUnsafe(
      `UPDATE contact_activities
       SET needs_manual_response = true, updated_at = NOW()
       WHERE id = $1`,
      ctx.activityId,
    );
    await notifyOwnerOrAdmins({
      organizationId: ctx.organizationId,
      ownerUserId: ownerId,
      kind: "email_manual_response_needed",
      title: `Lead replied — your follow-up: ${ctx.contactName}`,
      body:
        "This contact is assigned to you. The CRM bot will not auto-reply on nurture threads — please respond or schedule the demo personally.",
      href: `/inbox?thread=${ctx.threadId ?? ctx.activityId}`,
      entityType: "contact_activity",
      entityId: ctx.activityId,
      contactId: ctx.contactId,
    });
    return skipResult(input, "assigned_owner_handles_outreach");
  }

  return null;
}

async function sendOutboundReply(args: {
  ctx: AutoReplyContext;
  subject: string;
  body: string;
}): Promise<
  | { ok: true; replyId: string }
  | { ok: false; error: string }
> {
  const inbound = await loadInboundEmailThreadHeaders(args.ctx.activityId);

  const sent = args.ctx.mailboxUserId
    ? await sendConnectedEmailForUser({
        userId: args.ctx.mailboxUserId,
        to: args.ctx.contactEmail!,
        subject: args.subject,
        body: args.body,
        preferredProvider: args.ctx.mailProvider ?? null,
        gmailThreadId: inbound?.gmail_thread_id ?? null,
        inReplyToRfcMessageId: inbound?.rfc_message_id ?? null,
        inReplyToGmailMessageId: inbound?.gmail_message_id ?? null,
        references: inbound?.rfc_message_id ?? null,
      })
    : await sendCrmBotEmail({
        organizationId: args.ctx.organizationId,
        to: args.ctx.contactEmail!,
        subject: args.subject,
        body: args.body,
        ...crmBotEmailThreadingFromInbound(inbound),
      });

  if (!sent.ok) return { ok: false, error: sent.error };

  await clearManualResponseNeededForThread({
    contactId: args.ctx.contactId,
    threadId: args.ctx.threadId ?? args.ctx.activityId,
    gmailThreadId: inbound?.gmail_thread_id ?? null,
    providerThreadId: inbound?.provider_thread_id ?? sent.threadId ?? null,
  });

  const botEmail = args.ctx.mailboxUserId
    ? null
    : await crmBotMailboxEmail(args.ctx.organizationId);
  const storedBody =
    botEmail && !emailHeadersMention(args.body, botEmail)
      ? `From: ${botEmail}\n\n${args.body}`
      : args.body;
  const reply = await createContactActivity(args.ctx.contactId, {
    type: "email",
    subject: args.subject,
    body: storedBody,
    folder: "sent",
    emailDirection: "outbound",
    createdByUserId: args.ctx.mailboxUserId ?? args.ctx.ownerUserId ?? null,
    threadId: args.ctx.threadId ?? args.ctx.activityId,
    gmailMessageId: sent.messageId ?? null,
    gmailThreadId: sent.threadId ?? inbound?.gmail_thread_id ?? null,
    rfcMessageId: sent.rfcMessageId ?? null,
  });

  await prisma.$executeRawUnsafe(
    `
    UPDATE contact_activities SET
      provider_message_id = COALESCE($2, provider_message_id),
      provider_thread_id = COALESCE($3, provider_thread_id),
      mail_provider = COALESCE($4::"MailProvider", mail_provider),
      updated_at = NOW()
    WHERE id = $1
    `,
    reply.id,
    sent.messageId ?? null,
    sent.threadId ?? inbound?.provider_thread_id ?? null,
    sent.via,
  );

  return { ok: true, replyId: reply.id };
}

async function applyDemoDecision(
  ctx: AutoReplyContext,
  input: AutoReplyAgentDecision,
): Promise<AutoReplyApplyResult> {
  if (!ctx.contactEmail?.includes("@")) {
    return skipResult(input, "no_reply_address");
  }

  const timeZone =
    input.timeZone?.trim() || ctx.timezone || DEMO_TIMEZONE;
  const category = input.category ?? "demo_ask_slot";
  // Demo booking requires a rep connected mailbox — never the CRM bot channel.
  if (!ctx.mailboxUserId) {
    const handoff = await tryBotMailDemoHandoff(ctx, input);
    if (handoff) return handoff;
    return skipResult(input, "bot_mail_no_demo_booking");
  }

  const calendarMailboxUserId = resolveDemoCalendarUser(ctx.mailboxUserId);
  const mailboxUserId = calendarMailboxUserId;
  const demoThreadId = ctx.threadId ?? ctx.activityId;
  const withDemoThread = (state: Omit<DemoState, "threadId">): DemoState => ({
    ...state,
    threadId: demoThreadId,
  });

  if (!mailboxUserId) {
    return skipResult(input, "no_mailbox_owner");
  }

  const escalateNoCalendar = async (
    reason: string,
  ): Promise<AutoReplyApplyResult> => {
    await prisma.$executeRawUnsafe(
      `UPDATE contact_activities
       SET needs_manual_response = true, updated_at = NOW()
       WHERE id = $1`,
      ctx.activityId,
    );
    await notifyUsers({
      organizationId: ctx.organizationId,
      recipientUserIds: [mailboxUserId],
      kind: "demo_scheduling_needed",
      title: `Demo request needs scheduling: ${ctx.contactName}`,
      body:
        reason ||
        "A lead asked for a demo but Google Calendar is not connected for this mailbox.",
      href: `/inbox?thread=${ctx.threadId ?? ctx.activityId}`,
      entityType: "contact_activity",
      entityId: ctx.activityId,
      contactId: ctx.contactId,
      metadata: { agent: "email_auto_reply", category },
    });
    return {
      status: "escalated",
      decision: "sensitive_escalate",
      sensitivity: "sensitive",
      category: "demo_needs_calendar",
      reason,
      replyActivityId: null,
      escalatedToUserId: mailboxUserId,
      lastError: null,
      nextRetryAt: null,
    };
  };

  const hasCal = mailboxUserId
    ? await mailboxHasGoogleCalendar(mailboxUserId)
    : false;
  if (!hasCal && category !== "demo_ask_slot") {
    return escalateNoCalendar(
      "Connect Google Calendar in Configuration → Email to auto-book demos on this mailbox.",
    );
  }

  // --- ask for preferred time ---
  if (category === "demo_ask_slot") {
    if (!hasCal) {
      // Still acknowledge and ask, but also notify so they connect calendar.
      if (mailboxUserId) {
        await notifyUsers({
          organizationId: ctx.organizationId,
          recipientUserIds: [mailboxUserId],
          kind: "demo_scheduling_needed",
          title: `Demo interest from ${ctx.contactName}`,
          body: "Lead asked for a demo. Connect Google Calendar to let the agent book on your calendar.",
          href: `/inbox?thread=${ctx.threadId ?? ctx.activityId}`,
          entityType: "contact_activity",
          entityId: ctx.activityId,
          contactId: ctx.contactId,
        });
      }
    }
    const subject =
      input.replySubject?.trim() || heuristicReplySubject(ctx.subject);
    const body =
      input.replyBody?.trim() ||
      demoAskSlotBody(ctx.contactName, ctx.senderOrganizationName);
    const sent = await sendOutboundReply({ ctx, subject, body });
    if (!sent.ok) {
      return {
        status: "failed",
        decision: "safe_auto_reply",
        sensitivity: "safe",
        category,
        reason: input.reason ?? null,
        replyActivityId: null,
        escalatedToUserId: null,
        lastError: sent.error,
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
      };
    }
    const demoState: DemoState = withDemoThread({
      phase: "ask_slot",
      mailboxUserId,
      timezone: timeZone,
      proposedSlots: [],
    });
    await closeAwaitingDemoJobs({
      contactId: ctx.contactId,
      threadId: demoThreadId,
    });
    return {
      status: "awaiting_demo",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category,
      reason: input.reason ?? "Asked for preferred demo date/time.",
      replyActivityId: sent.replyId,
      escalatedToUserId: null,
      lastError: null,
      nextRetryAt: null,
      demoState,
    };
  }

  // Resolve the slot to book / check.
  let start: Date | null = null;
  if (category === "demo_confirm_slot" && input.chosenSlotIso) {
    start = new Date(input.chosenSlotIso);
  } else if (input.requestedStartIso) {
    start = new Date(input.requestedStartIso);
  } else {
    start = parsePreferredDateTime(
      `${ctx.subject}\n${ctx.body}`,
      new Date(),
      timeZone,
    );
  }

  if (!start || Number.isNaN(start.getTime())) {
    const subject =
      input.replySubject?.trim() || heuristicReplySubject(ctx.subject);
    const body = demoAskSlotBody(ctx.contactName, ctx.senderOrganizationName);
    const sent = await sendOutboundReply({ ctx, subject, body });
    if (!sent.ok) {
      return {
        status: "failed",
        decision: "safe_auto_reply",
        sensitivity: "safe",
        category: "demo_ask_slot",
        reason: "Could not parse preferred time.",
        replyActivityId: null,
        escalatedToUserId: null,
        lastError: sent.error,
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
      };
    }
    return {
      status: "awaiting_demo",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_ask_slot",
      reason: "Could not parse preferred time — asked again.",
      replyActivityId: sent.replyId,
      escalatedToUserId: null,
      lastError: null,
      nextRetryAt: null,
      demoState: withDemoThread({
        phase: "ask_slot",
        mailboxUserId,
        timezone: timeZone,
        proposedSlots: ctx.demoState?.proposedSlots ?? [],
      }),
    };
  }

  const end = new Date(start.getTime() + DEMO_DURATION_MINUTES * 60_000);
  if (start.getTime() < Date.now() - 60_000 && category !== "demo_confirm_slot") {
    const alts = await findFreeSlots({
      mailboxUserId,
      around: new Date(Date.now() + 30 * 60_000),
      durationMinutes: DEMO_DURATION_MINUTES,
      limit: 3,
      timeZone,
    });
    if (alts.length === 0) {
      return escalateNoCalendar(
        `Requested time ${formatSlotOption(start, timeZone)} has passed. Please schedule manually.`,
      );
    }
    const requestedLabel = formatSlotOption(start, timeZone);
    const subject = heuristicReplySubject(ctx.subject);
    const body = demoProposeAltsBody(
      ctx.contactName,
      requestedLabel,
      alts,
      timeZone,
      ctx.senderOrganizationName,
    );
    const sent = await sendOutboundReply({ ctx, subject, body });
    if (!sent.ok) {
      return {
        status: "failed",
        decision: "safe_auto_reply",
        sensitivity: "safe",
        category: "demo_check_slot",
        reason: input.reason ?? null,
        replyActivityId: null,
        escalatedToUserId: null,
        lastError: sent.error,
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
      };
    }
    const demoState: DemoState = withDemoThread({
      phase: "propose_alts",
      mailboxUserId,
      timezone: timeZone,
      requestedStartIso: start.toISOString(),
      proposedSlots: alts.map((d) => d.toISOString()),
    });
    await closeAwaitingDemoJobs({
      contactId: ctx.contactId,
      threadId: demoThreadId,
    });
    return {
      status: "awaiting_demo",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_check_slot",
      reason: "Requested slot is in the past — proposed alternatives.",
      replyActivityId: sent.replyId,
      escalatedToUserId: null,
      lastError: null,
      nextRetryAt: null,
      demoState,
    };
  }

  const free = await isSlotFree({ mailboxUserId, start, end });

  if (!free && category !== "demo_confirm_slot") {
    const alts = await findFreeSlots({
      mailboxUserId,
      around: start,
      durationMinutes: DEMO_DURATION_MINUTES,
      limit: 3,
      timeZone,
    });
    if (alts.length === 0) {
      return escalateNoCalendar(
        `No free slots near ${formatSlotOption(start, timeZone)}. Please schedule manually.`,
      );
    }
    const requestedLabel = formatSlotOption(start, timeZone);
    const subject = heuristicReplySubject(ctx.subject);
    const body = demoProposeAltsBody(
      ctx.contactName,
      requestedLabel,
      alts,
      timeZone,
      ctx.senderOrganizationName,
    );
    const sent = await sendOutboundReply({ ctx, subject, body });
    if (!sent.ok) {
      return {
        status: "failed",
        decision: "safe_auto_reply",
        sensitivity: "safe",
        category: "demo_check_slot",
        reason: input.reason ?? null,
        replyActivityId: null,
        escalatedToUserId: null,
        lastError: sent.error,
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
      };
    }
    const demoState: DemoState = withDemoThread({
      phase: "propose_alts",
      mailboxUserId,
      timezone: timeZone,
      requestedStartIso: start.toISOString(),
      proposedSlots: alts.map((d) => d.toISOString()),
    });
    await closeAwaitingDemoJobs({
      contactId: ctx.contactId,
      threadId: demoThreadId,
    });
    return {
      status: "awaiting_demo",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_check_slot",
      reason: "Requested slot busy — proposed alternatives.",
      replyActivityId: sent.replyId,
      escalatedToUserId: null,
      lastError: null,
      nextRetryAt: null,
      demoState,
    };
  }

  if (!free) {
    // Confirm path but still busy — re-propose.
    const alts = await findFreeSlots({
      mailboxUserId,
      around: start,
      limit: 3,
      timeZone,
    });
    if (alts.length === 0) {
      return escalateNoCalendar(
        "Chosen slot is no longer free and no alternatives were found.",
      );
    }
    const subject = heuristicReplySubject(ctx.subject);
    const body = demoProposeAltsBody(
      ctx.contactName,
      formatSlotOption(start, timeZone),
      alts,
      timeZone,
      ctx.senderOrganizationName,
    );
    const sent = await sendOutboundReply({ ctx, subject, body });
    if (!sent.ok) {
      return {
        status: "failed",
        decision: "safe_auto_reply",
        sensitivity: "safe",
        category: "demo_confirm_slot",
        reason: input.reason ?? null,
        replyActivityId: null,
        escalatedToUserId: null,
        lastError: sent.error,
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
      };
    }
    await closeAwaitingDemoJobs({
      contactId: ctx.contactId,
      threadId: demoThreadId,
    });
    return {
      status: "awaiting_demo",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "demo_check_slot",
      reason: "Chosen slot became busy — proposed new alternatives.",
      replyActivityId: sent.replyId,
      escalatedToUserId: null,
      lastError: null,
      nextRetryAt: null,
      demoState: withDemoThread({
        phase: "propose_alts",
        mailboxUserId,
        timezone: timeZone,
        requestedStartIso: start.toISOString(),
        proposedSlots: alts.map((d) => d.toISOString()),
      }),
    };
  }

  const booked = await bookDemoMeeting({
    mailboxUserId,
    contactId: ctx.contactId,
    start,
    timeZone,
    organizationId: ctx.organizationId,
  });
  if (!booked.ok) {
    if (booked.needsConnect) {
      return escalateNoCalendar(booked.error);
    }
    return {
      status: "failed",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category,
      reason: booked.error,
      replyActivityId: null,
      escalatedToUserId: null,
      lastError: booked.error,
      nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
    };
  }

  // Google Calendar already emailed attendees via sendUpdates=all — do not send
  // a second CRM confirmation (that was producing duplicate invites). Log the
  // invite onto the Inbox thread so the conversation stays complete.
  const subject = heuristicReplySubject(
    booked.confirmationSubject || ctx.subject,
  );
  const body = [
    "Calendar invite sent via Google Calendar (Google Meet).",
    "",
    booked.confirmationBody,
  ].join("\n");
  const reply = await createContactActivity(ctx.contactId, {
    type: "email",
    subject,
    body,
    folder: "sent",
    emailDirection: "outbound",
    createdByUserId: mailboxUserId,
    threadId: ctx.threadId ?? ctx.activityId,
  });

  await clearManualResponseNeededForThread({
    contactId: ctx.contactId,
    threadId: ctx.threadId ?? ctx.activityId,
  });

  await closeAwaitingDemoJobs({
    contactId: ctx.contactId,
    allThreads: true,
  });

  return {
    status: "replied",
    decision: "safe_auto_reply",
    sensitivity: "safe",
    category:
      category === "demo_confirm_slot" ? "demo_confirm_slot" : "demo_check_slot",
    reason: `Demo booked for ${booked.whenLabel}.`,
    replyActivityId: reply.id,
    escalatedToUserId: null,
    lastError: null,
    nextRetryAt: null,
    demoState: withDemoThread({
      phase: "booked",
      mailboxUserId,
      timezone: timeZone,
      requestedStartIso: start.toISOString(),
      meetingActivityId: booked.meetingActivityId,
      meetLink: booked.meetLink,
    }),
  };
}

/**
 * Turn an agent decision into CRM state. Called by the job runner and by the
 * internal route the Python agent posts to, so both paths share guardrails.
 */
export async function applyAutoReplyDecision(
  activityId: string,
  input: AutoReplyAgentDecision & { organizationId?: string | null },
): Promise<AutoReplyApplyResult> {
  const ctx = await buildAutoReplyContext(activityId, input.organizationId);
  if (!ctx) {
    return skipResult(input, "activity_not_found");
  }

  const ownedHandoff = await handOffOwnedLeadToSales(ctx, input);
  if (ownedHandoff) return ownedHandoff;

  const botDemoHandoff = await tryBotMailDemoHandoff(ctx, input);
  if (botDemoHandoff) return botDemoHandoff;

  const latest = latestInboundPlain(ctx.body);
  const textHasSchedule = DEMO_INTENT_RE.test(latest);
  const threadDemo = threadOfferedDemo(ctx.thread);
  const openDemoOnThread =
    Boolean(ctx.demoState?.phase) &&
    ctx.demoState?.phase !== "booked" &&
    threadDemo;
  const outboundOfferIso = latestOutboundDemoOfferIso(
    ctx.thread,
    new Date(),
    ctx.timezone || DEMO_TIMEZONE,
  );
  const repThreadActive =
    Boolean(ctx.mailboxUserId) &&
    ctx.thread.some((m) => m.direction === "outbound");
  const schedulingThreadActive =
    openDemoOnThread ||
    threadDemo ||
    Boolean(outboundOfferIso) ||
    repThreadActive;
  const parsedLatest = parsePreferredDateTime(
    latest,
    new Date(),
    ctx.timezone || DEMO_TIMEZONE,
    { allowPast: schedulingThreadActive },
  );
  if (
    input.decision === "safe_auto_reply" &&
    outboundOfferIso &&
    (SLOT_CONFIRM_RE.test(latest.trim()) || INTEREST_RE.test(latest.trim())) &&
    !String(input.category || "").toLowerCase().startsWith("demo_")
  ) {
    input = {
      ...input,
      category: "demo_confirm_slot",
      chosenSlotIso: outboundOfferIso,
      timeZone: input.timeZone || ctx.timezone || DEMO_TIMEZONE,
    };
  }
  if (
    input.decision === "safe_auto_reply" &&
    parsedLatest &&
    schedulingThreadActive &&
    !String(input.category || "").toLowerCase().startsWith("demo_")
  ) {
    input = {
      ...input,
      category: "demo_check_slot",
      requestedStartIso:
        input.requestedStartIso || parsedLatest.toISOString(),
      timeZone: input.timeZone || ctx.timezone || DEMO_TIMEZONE,
    };
  }
  // Loyalty / demo intent from the latest customer lines only — never the
  // Re: subject or quoted outbound pitch ("could we book a demo?").
  let scheduleIntent = resolveScheduleIntentForThread({
    text: latest,
    category:
      textHasSchedule || openDemoOnThread || (parsedLatest && schedulingThreadActive)
        ? input.category?.toLowerCase().startsWith("demo_")
          ? input.category
          : "demo_check_slot"
        : "general",
    hasUpcomingMeeting: ctx.engagement.hasUpcomingMeeting,
  });
  if (
    !scheduleIntent &&
    parsedLatest &&
    schedulingThreadActive &&
    ctx.engagement.threadHadBookedDemo
  ) {
    scheduleIntent = ctx.engagement.hasUpcomingMeeting
      ? "reschedule"
      : "schedule";
  }
  const loyaltyGate = evaluateScheduleLoyaltyGate({
    tier: ctx.engagement.tier,
    intent: scheduleIntent,
    autoRescheduleCount: ctx.engagement.autoRescheduleCount,
    hasUpcomingMeeting: ctx.engagement.hasUpcomingMeeting,
  });

  // After a prior booked demo on this thread, allow another schedule request
  // (follow-up meeting) instead of permanently silencing the thread.
  const allowFollowUpSchedule =
    scheduleIntent != null && ctx.engagement.threadHadBookedDemo;

  if (ctx.alreadyHandled && !allowFollowUpSchedule) {
    return skipResult(input, "thread_already_handled");
  }
  if (ctx.humanRepliedAfter) {
    return skipResult(input, "human_already_replied");
  }

  if (input.decision === "skip") {
    const recovered = recoverSkippedDemoDecision(ctx, input);
    if (recovered) {
      input = recovered;
    } else {
      return skipResult(input, input.reason || "agent_skip");
    }
  }

  // Additive loyalty layer — escalate before booking for new/unverified contacts.
  if (
    loyaltyGate?.action === "escalate" &&
    input.decision !== "sensitive_escalate" &&
    (input.decision === "safe_auto_reply" ||
      scheduleIntent != null ||
      allowFollowUpSchedule)
  ) {
    input = {
      ...input,
      decision: "sensitive_escalate",
      sensitivity: "sensitive",
      category: loyaltyGate.category,
      reason: loyaltyGate.reason,
    };
  }

  if (input.decision === "sensitive_escalate") {
    await prisma.$executeRawUnsafe(
      `UPDATE contact_activities
       SET needs_manual_response = true, updated_at = NOW()
       WHERE id = $1`,
      ctx.activityId,
    );

    const category = input.category ?? "sensitive";

    // Additive judgment layer on top of the keyword-match escalation above —
    // never a replacement. Even if this misclassifies or the LLM is down,
    // the notifyOwnerOrAdmins call below still fires regardless.
    if (category === "compliance") {
      triggerCompliancePrivacyAssess({
        activityId: ctx.activityId,
        contactId: ctx.contactId,
      });
    }

    const { recipients, targetedOwner } = await notifyOwnerOrAdmins({
      organizationId: ctx.organizationId,
      ownerUserId: ctx.ownerUserId,
      kind: "email_manual_response_needed",
      title: `Manual response needed: ${ctx.contactName}`,
      body:
        input.reason?.trim() ||
        `An inbound email needs a human reply (${category.replace(/_/g, " ")}).`,
      href: `/inbox?thread=${ctx.threadId ?? ctx.activityId}`,
      entityType: "contact_activity",
      entityId: ctx.activityId,
      contactId: ctx.contactId,
      metadata: {
        agent: "email_auto_reply",
        category,
        subject: ctx.subject,
        threadId: ctx.threadId,
        contactName: ctx.contactName,
        companyName: ctx.companyName,
      },
    });

    return {
      status: "escalated",
      decision: "sensitive_escalate",
      sensitivity: "sensitive",
      category,
      reason: input.reason ?? null,
      replyActivityId: null,
      escalatedToUserId: targetedOwner ? ctx.ownerUserId : null,
      lastError: recipients.length === 0 ? "no_notification_recipient" : null,
      nextRetryAt: null,
    };
  }

  // Demo multi-turn path — rep mailbox only (never book on CRM bot nurture mail).
  if (
    (input.decision === "safe_auto_reply" || allowFollowUpSchedule) &&
    ctx.mailboxUserId
  ) {
    const demoHaystack = latest;
    const parsed =
      (input.requestedStartIso && new Date(input.requestedStartIso)) ||
      (input.chosenSlotIso && new Date(input.chosenSlotIso)) ||
      parsePreferredDateTime(
        demoHaystack,
        new Date(),
        ctx.timezone || DEMO_TIMEZONE,
      );
    const hasDatetime = Boolean(
      parsed && !Number.isNaN(parsed.getTime()),
    );
    const repThreadActive =
      ctx.thread.some((m) => m.direction === "outbound");
    const normalized =
      normalizeDemoCategory(input.category, { hasDatetime }) ||
      (ctx.demoState &&
      ctx.demoState.phase !== "booked" &&
      threadDemo
        ? hasDatetime
          ? "demo_check_slot"
          : "demo_ask_slot"
        : null) ||
      (allowFollowUpSchedule ||
      DEMO_INTENT_RE.test(demoHaystack) ||
      (hasDatetime && (threadDemo || outboundOfferIso || repThreadActive))
        ? hasDatetime
          ? "demo_check_slot"
          : "demo_ask_slot"
        : null);

    if (normalized) {
      const result = await applyDemoDecision(ctx, {
        ...input,
        decision: "safe_auto_reply",
        category: normalized,
        requestedStartIso:
          input.requestedStartIso ||
          (hasDatetime && parsed ? parsed.toISOString() : null),
      });
      // Tag first auto-reschedule so the next one escalates for new contacts.
      if (
        result.demoState &&
        result.demoState.phase === "booked" &&
        loyaltyGate?.reason === "new_user_first_reschedule"
      ) {
        result.demoState = { ...result.demoState, autoReschedule: true };
        result.category = "demo_reschedule";
      } else if (
        result.demoState &&
        result.demoState.phase === "booked" &&
        scheduleIntent === "reschedule" &&
        ctx.engagement.hasUpcomingMeeting
      ) {
        result.demoState = { ...result.demoState, autoReschedule: true };
        result.category = result.category || "demo_reschedule";
      }
      return result;
    }
  }

  // safe_auto_reply from here on (sendOutboundReply uses CRM bot when mailboxUserId is null).
  if (!ctx.contactEmail?.includes("@")) {
    return skipResult(input, "no_reply_address");
  }

  const subject = (input.replySubject?.trim() ||
    heuristicReplySubject(ctx.subject)) as string;
  const body = input.replyBody?.trim() || "";
  if (!body) {
    // No grounded reply available — escalate rather than inventing filler.
    return applyAutoReplyDecision(activityId, {
      ...input,
      decision: "sensitive_escalate",
      sensitivity: "sensitive",
      category: input.category || "compose_failed",
      reason:
        input.reason ||
        "No grounded reply body — escalating to a human.",
      replySubject: null,
      replyBody: null,
    });
  }

  const sent = await sendOutboundReply({ ctx, subject, body });
  if (!sent.ok) {
    return {
      status: "failed",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: input.category ?? null,
      reason: input.reason ?? null,
      replyActivityId: null,
      escalatedToUserId: null,
      lastError: sent.error,
      nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
    };
  }

  return {
    status: "replied",
    decision: "safe_auto_reply",
    sensitivity: "safe",
    category: input.category ?? "general",
    reason: input.reason ?? null,
    replyActivityId: sent.replyId,
    escalatedToUserId: null,
    lastError: null,
    nextRetryAt: null,
  };
}

/* ------------------------------------------------------------------ */
/* Job lifecycle                                                      */
/* ------------------------------------------------------------------ */

/**
 * Grace period before a freshly arrived inbound mail becomes eligible for an
 * auto-reply. Default is 0 while testing; set EMAIL_AUTO_REPLY_GRACE_MS (e.g.
 * 120000) when you want a human-first delay in production.
 */
/** Synthetic contacts are parked with a nurture retry more than a year out. */
async function contactAutoReplyHeld(
  organizationId: string,
  contactId: string,
): Promise<boolean> {
  const orgId = organizationId.trim();
  const contact = contactId.trim();
  if (!orgId || !contact) return false;
  const rows = await prisma.$queryRawUnsafe<Array<{ held: boolean }>>(
    `
    SELECT EXISTS (
      SELECT 1 FROM lead_nurture_jobs
      WHERE organization_id = $1::bigint
        AND contact_id = $2::text
        AND next_retry_at > NOW() + INTERVAL '1 year'
    ) AS held
    `,
    orgId,
    contact,
  );
  return rows[0]?.held === true;
}

export const AUTO_REPLY_GRACE_MS = (() => {
  const raw = Number(process.env.EMAIL_AUTO_REPLY_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 0;
})();

export async function enqueueEmailAutoReply(input: {
  activityId: string;
  contactId: string;
  mailboxUserId?: string | null;
  organizationId?: string | null;
  processImmediately?: boolean;
}): Promise<AutoReplyJobRow | null> {
  let orgHint = input.organizationId?.trim() || null;
  if (!orgHint) {
    try {
      const activity = await prisma.contactActivity.findUnique({
        where: { id: input.activityId },
        select: { organizationId: true },
      });
      const raw = activity?.organizationId;
      orgHint = raw != null ? String(raw).trim() || null : null;
    } catch {
      orgHint = null;
    }
  }
  if (!orgHint && input.contactId) {
    try {
      const { getContact } = await import("@/dao/contacts/contact-service");
      const contact = await getContact(input.contactId);
      orgHint = contact?.person.organizationId?.trim() || null;
    } catch {
      /* ignore */
    }
  }
  const organizationId = await resolveRequestOrganizationId(orgHint);
  const existing = await findAutoReplyJobByActivity(input.activityId);
  if (existing?.status === "replied" || existing?.status === "awaiting_demo") {
    return existing;
  }
  if (await contactAutoReplyHeld(organizationId, input.contactId)) {
    return existing ?? null;
  }

  let job =
    existing && existing.status !== "pending"
      ? await requeueUnsentAutoReplyJob(existing.id)
      : existing;
  if (!job) {
    // Immediate processing bypasses the grace window (explicit manual trigger);
    // the normal inbound path defers so a human can respond first.
    job = await upsertAutoReplyJob({
      organizationId,
      contactId: input.contactId,
      inboundActivityId: input.activityId,
      mailboxUserId: input.mailboxUserId ?? null,
      graceMs: input.processImmediately === true ? 0 : AUTO_REPLY_GRACE_MS,
    });
  }

  if (input.processImmediately === true) {
    void processEmailAutoReplyJob(job).catch((err) => {
      console.error("processEmailAutoReplyJob failed", job.id, err);
    });
  }
  return job;
}

/**
 * Create pending auto-reply jobs for recent inbound inbox mail that never got
 * one (e.g. imported before the agent shipped, or when a fire-and-forget died).
 */
/** Inbound CRM-bot mail — legacy rows have no user; newer rows use the contact owner. */
export async function enqueueMissingAutoReplyJobsForBotInbox(
  organizationId: string,
  limit = 15,
): Promise<number> {
  const orgId = organizationId.trim();
  if (!orgId) return 0;
  const botEmail = await crmBotMailboxEmail(orgId);

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      contact_id: string;
      organization_id: string | null;
    }>
  >(
    `
    SELECT ca.id,
           ca.contact_id::text AS contact_id,
           ca.organization_id::text AS organization_id
    FROM contact_activities ca
    LEFT JOIN email_auto_reply_jobs j
      ON j.inbound_activity_id = ca.id
    WHERE ca.organization_id = $1::bigint
      AND ca.type = 'email'
      AND ca.email_direction = 'inbound'
      AND ca.folder = 'inbox'
      AND j.id IS NULL
      AND ca.created_at > NOW() - INTERVAL '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM lead_nurture_jobs nj
        WHERE nj.organization_id = ca.organization_id
          AND nj.contact_id = ca.contact_id
          AND nj.next_retry_at > NOW() + INTERVAL '1 year'
      )
      AND (
        ca.created_by_user_id IS NULL
        OR (
          $2::text IS NOT NULL
          AND position(lower($2) in lower(left(coalesce(ca.body, ''), 1500))) > 0
        )
      )
    ORDER BY ca.created_at DESC
    LIMIT $3
    `,
    orgId,
    botEmail,
    limit,
  );

  let enqueued = 0;
  for (const row of rows) {
    try {
      await enqueueEmailAutoReply({
        activityId: row.id,
        contactId: row.contact_id,
        mailboxUserId: null,
        organizationId: row.organization_id,
        processImmediately: false,
      });
      enqueued += 1;
    } catch (err) {
      console.error("enqueueMissingAutoReplyJobsForBotInbox failed", row.id, err);
    }
  }
  return enqueued;
}

export async function enqueueMissingAutoReplyJobsForMailbox(
  mailboxUserId: string,
  limit = 15,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      contact_id: string;
      organization_id: string | null;
    }>
  >(
    `
    SELECT ca.id,
           ca.contact_id::text AS contact_id,
           ca.organization_id::text AS organization_id
    FROM contact_activities ca
    LEFT JOIN email_auto_reply_jobs j
      ON j.inbound_activity_id = ca.id
    WHERE ca.created_by_user_id = $1::bigint
      AND ca.type = 'email'
      AND ca.email_direction = 'inbound'
      AND ca.folder = 'inbox'
      AND j.id IS NULL
      AND ca.created_at > NOW() - INTERVAL '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM lead_nurture_jobs nj
        WHERE nj.organization_id = ca.organization_id
          AND nj.contact_id = ca.contact_id
          AND nj.next_retry_at > NOW() + INTERVAL '1 year'
      )
    ORDER BY ca.created_at DESC
    LIMIT $2
    `,
    mailboxUserId,
    limit,
  );

  let enqueued = 0;
  for (const row of rows) {
    try {
      await enqueueEmailAutoReply({
        activityId: row.id,
        contactId: row.contact_id,
        mailboxUserId,
        organizationId: row.organization_id,
        processImmediately: false,
      });
      enqueued += 1;
    } catch (err) {
      console.error("enqueueMissingAutoReplyJobsForMailbox failed", row.id, err);
    }
  }
  return enqueued;
}

export async function processEmailAutoReplyJob(
  job: AutoReplyJobRow,
): Promise<AutoReplyJobRow | null> {
  const claimed = await claimAutoReplyJob(job.id);
  if (!claimed) return findAutoReplyJobById(job.id);

  const finish = (result: AutoReplyApplyResult) =>
    updateAutoReplyJob(job.id, {
      status: result.status,
      decision: result.decision,
      sensitivity: result.sensitivity,
      category: result.category,
      reason: result.reason,
      replyActivityId: result.replyActivityId,
      escalatedToUserId: result.escalatedToUserId,
      lastError: result.lastError,
      nextRetryAt: result.nextRetryAt ? new Date(result.nextRetryAt) : null,
      completedAt:
        result.status === "failed" || result.status === "awaiting_demo"
          ? null
          : new Date(),
      resultSummary: {
        decision: result.decision,
        sensitivity: result.sensitivity,
        category: result.category,
        reason: result.reason,
        ...(result.demoState
          ? {
              phase: result.demoState.phase,
              mailboxUserId: result.demoState.mailboxUserId,
              timezone: result.demoState.timezone,
              requestedStartIso: result.demoState.requestedStartIso ?? null,
              proposedSlots: result.demoState.proposedSlots ?? [],
              meetingActivityId: result.demoState.meetingActivityId ?? null,
              meetLink: result.demoState.meetLink ?? null,
              ...(result.demoState.autoReschedule
                ? { autoReschedule: "true" }
                : {}),
            }
          : {}),
      },
    });

  try {
    const run = async (): Promise<AutoReplyJobRow> => {
      const ctx = await buildAutoReplyContext(
        job.inboundActivityId,
        job.organizationId,
      );
      if (!ctx) {
        return finish(
          skipResult(
            { decision: "skip", sensitivity: "unknown" },
            "activity_not_found",
          ),
        );
      }

      const ownedHandoff = await handOffOwnedLeadToSales(ctx, {
        decision: "skip",
        sensitivity: "unknown",
      });
      if (ownedHandoff) {
        return finish(ownedHandoff);
      }

      const scheduleIntent = resolveScheduleIntentForThread({
        text: latestInboundPlain(ctx.body),
        hasUpcomingMeeting: ctx.engagement.hasUpcomingMeeting,
      });
      const allowFollowUpSchedule =
        scheduleIntent != null && ctx.engagement.threadHadBookedDemo;

      if (ctx.humanRepliedAfter) {
        return finish(
          skipResult(
            { decision: "skip", sensitivity: "unknown" },
            "human_already_replied",
          ),
        );
      }
      if (ctx.alreadyHandled && !allowFollowUpSchedule) {
        return finish(
          skipResult(
            { decision: "skip", sensitivity: "unknown" },
            "thread_already_handled",
          ),
        );
      }

      // Deterministic demo slot booking — never let the LLM skip short replies
      // like "today 8 pm" on an active scheduling thread.
      const slotGuard = heuristicClassify(ctx);
      const slotCategory = String(slotGuard.category || "");
      const repSchedulingActive =
        Boolean(ctx.mailboxUserId) &&
        ctx.thread.some((m) => m.direction === "outbound");
      if (
        slotGuard.decision === "safe_auto_reply" &&
        (slotCategory === "demo_check_slot" ||
          slotCategory === "demo_confirm_slot") &&
        (threadOfferedDemo(ctx.thread) || repSchedulingActive)
      ) {
        return finish(
          await applyAutoReplyDecision(ctx.activityId, {
            ...slotGuard,
            organizationId: ctx.organizationId,
          }),
        );
      }

      // Prefer the Python LangGraph agent (own-server LLM). It classifies,
      // composes, and posts the decision back to the internal route, which
      // performs the send / escalation through applyAutoReplyDecision.
      const py = await callAiServiceAgent<{
        decision?: AutoReplyDecision;
        sensitivity?: string;
        category?: string | null;
        reason?: string | null;
        persistResult?: AutoReplyApplyResult & { statusCode?: number };
        persist_result?: AutoReplyApplyResult;
      }>(
        "auto-reply-email",
        {
          activityId: ctx.activityId,
          contactId: ctx.contactId,
          organizationId: ctx.organizationId,
        },
        { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
      );

      const persisted = unwrapPersistResult(py);
      if (persisted) {
        if (persisted.status === "skipped") {
          const recovered = recoverSkippedDemoDecision(ctx, {
            decision: persisted.decision ?? "skip",
            sensitivity:
              persisted.sensitivity === "safe" ||
              persisted.sensitivity === "sensitive"
                ? persisted.sensitivity
                : "unknown",
            category: persisted.category,
            reason: persisted.reason,
          });
          if (recovered) {
            return finish(
              await applyAutoReplyDecision(ctx.activityId, {
                ...recovered,
                organizationId: ctx.organizationId,
              }),
            );
          }
        }
        return finish(persisted);
      }

      // Do not invent auto-replies in TypeScript — retry later; keep thread untouched.
      console.warn(
        "auto-reply-email agent unavailable; scheduling retry",
        job.id,
        py?.reason ?? py?.decision ?? "empty",
      );
      return finish({
        status: "failed",
        decision: "skip",
        sensitivity: "unknown",
        category: null,
        reason: "ai_service_unavailable",
        replyActivityId: null,
        escalatedToUserId: null,
        lastError: "ai_service_unavailable",
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS).toISOString(),
      });
    };

    const raced = await Promise.race([
      run().then((row) => ({ kind: "ok" as const, row })),
      new Promise<{ kind: "budget" }>((resolve) => {
        setTimeout(() => resolve({ kind: "budget" }), JOB_BUDGET_MS);
      }),
    ]);

    if (raced.kind === "budget") {
      return updateAutoReplyJob(job.id, {
        status: "failed",
        lastError: "job_budget_exceeded",
        nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS),
      });
    }
    return raced.row;
  } catch (err) {
    console.error("email auto-reply job failed", job.id, err);
    return updateAutoReplyJob(job.id, {
      status: "failed",
      lastError: err instanceof Error ? err.message : "auto_reply_failed",
      nextRetryAt: new Date(Date.now() + FAIL_RETRY_MS),
    });
  }
}

export async function processDueEmailAutoReplyJobs(
  limit = 10,
): Promise<{ processed: number }> {
  const jobs = await listDueAutoReplyJobs(limit);
  let processed = 0;
  for (const job of jobs) {
    try {
      await processEmailAutoReplyJob(job);
      processed += 1;
    } catch (err) {
      console.error("processDueEmailAutoReplyJobs item failed", job.id, err);
    }
  }
  return { processed };
}
