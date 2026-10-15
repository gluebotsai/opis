// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import {
  personalizeEmailContent,
  renderCampaignEmail,
  ensureHeaderImageInHtml,
} from "../helpers/email-render.js";
import {
  canonicalizeEmailTemplateFields,
  compiledHtmlIsMeaningful,
  emailHtmlVisibleTextLength,
  MIN_EMAIL_BODY_VISIBLE_CHARS,
} from "../helpers/email-template-canonical.js";
import {
  assertOutboundEmailImagesPublic,
  rewriteEmailHtmlMediaForDelivery,
} from "../helpers/media-public-url.js";
import { recordEmailHealthEventDao } from "../dao/email-send-runner.js";
import { listContactEmailsByIdsDao } from "../dao/contact.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { env, reloadBackendEnv } from "../config/env.js";
import { evaluateEmailSendPipelineForMailbox } from "../helpers/email-send-pipeline-ready.js";
import { greetingFirstName } from "../helpers/contact-validation.js";
import {
  EMAIL_BATCH_QUEUED,
  MAX_EMAIL_SEND_ATTEMPTS,
} from "../helpers/email-send-constants.js";
import { EMAIL_MAILBOX_NOT_READY } from "../helpers/email-launch-transport.js";
import { loadAccountsMailboxForSendDao } from "../dao/accounts-email-mailbox.js";
import {
  accountsEmailSendIntervalMs,
  isPermanentAccountsEmailError,
  sendAccountsMailboxCampaignEmail,
} from "./accounts-email-send.js";
import {
  abortBatchIfCampaignStopped,
  backfillCampaignSendLifecycles,
  promoteDueCampaignLifecycles,
  reconcileCampaignSendLifecycle,
} from "./campaign-send-lifecycle.js";
import {
  buildMergeMapsForContacts,
  isDynamicOfferEnabled,
} from "./personalization/index.js";
import {
  emailFieldsForVariant,
  readEmailAbPlan,
  type AbLetter,
} from "../helpers/email-ab.js";
import {
  maybeAutoResolveEmailAbWinner,
  scanPendingEmailAbWinners,
} from "../dao/email-ab-run.js";
import { logCampaignId } from "../helpers/send-log-id.js";
import {
  attachEmailTracking,
  emailHtmlHasOutboundCtaHref,
  emailUnsubscribeUrl,
  ensureEmailUnsubscribeText,
  extractTrackClickHref,
} from "../helpers/email-track.js";
import {
  applyWebTrackingParamsToUrl,
  buildWebTrackingToken,
} from "../helpers/web-tracking-link.js";
import { isStubProviderMessageId } from "../helpers/send-status.js";
import { orgPostalFooterText } from "../helpers/email-org-postal.js";
import { bypassEmailSuppressionForLaunch } from "../helpers/launch-send-plan.js";

/** Bake leftover merge-tag CTAs only — never overwrite real https destinations. */
function withResolvedCampaignClickUrl(
  fields: Record<string, unknown>,
  clickUrl: string,
): Record<string, unknown> {
  const dest = String(clickUrl || "").trim();
  if (!dest) return { ...fields };
  const isPlaceholder = (raw: unknown) => {
    const url = String(raw ?? "").trim();
    return (
      !url ||
      /\{\{\s*campaign_url\s*\}\}/i.test(url) ||
      url === "#" ||
      url === "/"
    );
  };
  const out: Record<string, unknown> = { ...fields };
  if (isPlaceholder(out.cta_url) && dest) out.cta_url = dest;
  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map((section) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        return section;
      }
      const row = { ...(section as Record<string, unknown>) };
      const kind = String(row.type || "").trim();
      if (kind === "cta" || kind === "secondary_link") {
        if (isPlaceholder(row.url)) row.url = dest;
      }
      return row;
    });
  }
  for (const key of ["variant_a", "variant_b"] as const) {
    const variant = out[key];
    if (variant && typeof variant === "object" && !Array.isArray(variant)) {
      out[key] = withResolvedCampaignClickUrl(
        variant as Record<string, unknown>,
        dest,
      );
    }
  }
  return out;
}

function templateDestinationUrl(fields: Record<string, unknown>): string {
  const keys = ["destination_url", "cta_url", "landing_url", "product_url"];
  for (const key of keys) {
    const url = String(fields[key] ?? "").trim();
    if (/^https?:\/\//i.test(url) && !/\{\{/.test(url)) return url;
  }
  if (Array.isArray(fields.sections)) {
    for (const section of fields.sections) {
      if (!section || typeof section !== "object") continue;
      const row = section as Record<string, unknown>;
      const kind = String(row.type || "").trim().toLowerCase();
      if (kind === "cta" || kind === "secondary_link") {
        const url = String(row.url || row.href || "").trim();
        if (/^https?:\/\//i.test(url) && !/\{\{/.test(url)) return url;
      }
    }
  }
  const html = String(fields.compiled_html || fields.html || "");
  const re = /href=(["'])(https?:\/\/[^"']+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[2] || "";
    if (/unsubscribe/i.test(href)) continue;
    if (/\/api\/campaigns\/track\//i.test(href)) continue;
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(href)) continue;
    return href;
  }
  return "";
}

export { MAX_EMAIL_SEND_ATTEMPTS };
export const reconcileEmailCampaignLifecycle = reconcileCampaignSendLifecycle;
export const backfillEmailCampaignLifecycles = backfillCampaignSendLifecycles;

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readMaxAttempts(launchPlan: unknown): number {
  if (!launchPlan || typeof launchPlan !== "object") {
    return MAX_EMAIL_SEND_ATTEMPTS;
  }
  const plan = launchPlan as Record<string, unknown>;
  const n = plan.max_send_attempts;
  if (typeof n === "number" && n >= 1 && n <= 10) return Math.floor(n);
  return MAX_EMAIL_SEND_ATTEMPTS;
}

function sessionForTenant(
  organizationId: string,
  branchId: string,
): CampaignSessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    organizationId,
    branchId,
    email: "worker@local",
    name: "Email worker",
    role: "system",
    initials: "EW",
    orgName: "system",
  };
}

async function loadEmailTemplateFields(campaignId: string, organizationId: string) {
  const channels = await prisma.campaignChannel.findMany({
    where: { campaignId, organizationId },
  });
  const emailChannel = channels.find((c) => c.channel.toLowerCase() === "email");
  if (!emailChannel?.templateId) return {};
  const template = await prisma.campaignChannelTemplate.findFirst({
    where: { id: emailChannel.templateId, organizationId },
  });
  return template?.fields && typeof template.fields === "object"
    ? (template.fields as Record<string, unknown>)
    : {};
}

type SendOnceArgs = {
  personalized: { subject: string; html: string; text: string };
  recipient: { id: string; email: string; contactId: string | null };
  accountsMailbox: NonNullable<
    Awaited<ReturnType<typeof loadAccountsMailboxForSendDao>>
  >;
};

async function sendOnce(args: SendOnceArgs): Promise<string> {
  const { personalized, recipient, accountsMailbox } = args;
  const result = await sendAccountsMailboxCampaignEmail(
    accountsMailbox,
    accountsMailbox.public,
    {
      to: recipient.email,
      subject: personalized.subject,
      html: personalized.html,
    },
  );
  return result.message_id;
}

export async function processBatch(batchId: string, log: Logger) {
  const claimed = await prisma.campaignSendBatch.updateMany({
    where: { id: batchId, status: EMAIL_BATCH_QUEUED, channel: "email" },
    data: { status: "sending" },
  });
  if (claimed.count === 0) return;

  const batch = await prisma.campaignSendBatch.findUnique({
    where: { id: batchId },
    include: {
      recipients: { where: { status: "pending" } },
      campaign: true,
    },
  });
  if (!batch) return;
  if (batch.channel && batch.channel !== "email") return;
  reloadBackendEnv();
  const campaignId = logCampaignId(batch.campaignId);
  if (await abortBatchIfCampaignStopped(batch.id, batch.campaignId, log)) {
    return;
  }

  const caps = await prisma.emailSendingCaps.findUnique({
    where: { organizationId: batch.organizationId },
  });
  if (caps?.healthStatus === "blocked_sending") {
    await prisma.campaignSendBatch.update({
      where: { id: batch.id },
      data: { status: "cancelled" },
    });
    return;
  }

  const plan =
    batch.campaign.launchPlan && typeof batch.campaign.launchPlan === "object"
      ? (batch.campaign.launchPlan as Record<string, unknown>)
      : {};
  const maxAttempts = readMaxAttempts(plan);
  const runMap =
    plan.channel_run && typeof plan.channel_run === "object"
      ? (plan.channel_run as Record<string, unknown>)
      : {};
  const emailRun =
    runMap.email && typeof runMap.email === "object"
      ? (runMap.email as Record<string, unknown>)
      : {};
  if (emailRun.paused === true) {
    log.info(
      { event: "email_launch_skipped", campaignId, batchId, channel: "email" },
      "[email-launch] skip batch — channel paused",
    );
    return;
  }

  await reconcileEmailCampaignLifecycle(batch.campaignId, log);

  const templateFields = canonicalizeEmailTemplateFields(
    await loadEmailTemplateFields(batch.campaignId, batch.organizationId),
  );
  const templateDest = templateDestinationUrl(templateFields);
  const compiledRaw = String(
    templateFields.compiled_html ?? templateFields.html ?? "",
  ).trim();
  const compiledHtmlLen = compiledRaw.length;
  const sectionCount = Array.isArray(templateFields.sections)
    ? templateFields.sections.length
    : 0;
  const subjectPreview = String(templateFields.subject ?? "").trim().slice(0, 120);
  const probe = renderCampaignEmail(templateFields);
  const renderedBodyLen = Math.max(
    emailHtmlVisibleTextLength(probe.html),
    String(probe.text || "").trim().length,
  );
  const hasEmailBody = renderedBodyLen >= MIN_EMAIL_BODY_VISIBLE_CHARS;
  log.info(
    {
      event: "email_launch_batch_start",
      batchId,
      campaignId,
      organizationId: batch.organizationId,
      recipientCount: batch.recipients.length,
      subject: subjectPreview || "(empty)",
      compiledHtmlLen,
      compiledHtmlMeaningful: compiledHtmlIsMeaningful(compiledRaw),
      sectionCount,
      renderedBodyLen,
      hasEmailBody,
    },
    "[email-launch] batch start — template snapshot",
  );
  if (!hasEmailBody) {
    const emptyReason =
      compiledRaw && !compiledHtmlIsMeaningful(compiledRaw)
        ? "email_template_empty_body"
        : "email_template_missing";
    log.error(
      {
        event: "email_launch_aborted",
        reason: emptyReason,
        batchId,
        campaignId,
        organizationId: batch.organizationId,
        subject: subjectPreview || "(empty)",
        compiledHtmlLen,
        sectionCount,
        renderedBodyLen,
      },
      "[email-launch] ABORTED — template missing or empty body (subject may still exist)",
    );
    for (const recipient of batch.recipients) {
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: emptyReason,
        },
      });
    }
    await prisma.campaignSendBatch.update({
      where: { id: batch.id },
      data: { status: "failed" },
    });
    return;
  }

  try {
    const htmlProbe = await rewriteEmailHtmlMediaForDelivery(
      ensureHeaderImageInHtml(probe.html, templateFields),
      String(batch.organizationId),
    );
    await assertOutboundEmailImagesPublic(
      htmlProbe,
      String(batch.organizationId),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "email_images_not_public";
    log.error(
      {
        event: "email_launch_aborted",
        reason: "email_images_not_public",
        detail: reason,
        batchId,
        campaignId,
        organizationId: batch.organizationId,
      },
      "[email-launch] ABORTED — campaign images are not on the public media host",
    );
    for (const recipient of batch.recipients) {
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: "email_images_not_public",
        },
      });
    }
    await prisma.campaignSendBatch.update({
      where: { id: batch.id },
      data: { status: "failed" },
    });
    return;
  }
  const abPlan = readEmailAbPlan(plan);
  const org = await prisma.emailOrgProfile.findUnique({
    where: { organizationId: batch.organizationId },
  });
  const postalFooter = orgPostalFooterText(org);

  const renderForVariant = (
    letter: AbLetter | null,
    destUrl: string,
  ) => {
    const base = letter
      ? emailFieldsForVariant(templateFields, letter)
      : templateFields;
    const fields = destUrl
      ? withResolvedCampaignClickUrl(base, destUrl)
      : base;
    const content = renderCampaignEmail(fields);
    let html =
      content.html +
      (postalFooter
        ? `<p style="margin-top:24px;font-size:11px;color:#888">${postalFooter}</p>`
        : "");
    html = ensureHeaderImageInHtml(html, fields);
    return { subject: content.subject, html, text: content.text };
  };

  const workerSession = sessionForTenant(
    batch.organizationId,
    batch.campaign.branchId,
  );

  let accountsMailbox: Awaited<
    ReturnType<typeof loadAccountsMailboxForSendDao>
  > = null;
  try {
    accountsMailbox = await loadAccountsMailboxForSendDao(workerSession);
  } catch (err) {
    log.error(
      { err, event: "email_launch_aborted", campaignId, batchId },
      "[email-launch] ABORTED — Accounts mailbox lookup failed",
    );
  }
  const pipeline = evaluateEmailSendPipelineForMailbox(accountsMailbox);
  if (!pipeline.ready) {
    const reason =
      pipeline.skip_fail_reason ||
      pipeline.message ||
      `${EMAIL_MAILBOX_NOT_READY}: Email send pipeline not ready`;
    log.error(
      {
        event: "email_launch_aborted",
        reason: pipeline.code || "email_send_pipeline_not_ready",
        batchId,
        campaignId,
        from: accountsMailbox?.public?.display_from ?? null,
        detail: pipeline.message,
        googleOAuthConfigured: pipeline.google_oauth_configured,
        msTokenEncryptionConfigured: pipeline.ms_token_encryption_configured,
      },
      "[email-launch] ABORTED — send pipeline not ready (mailbox + backend env)",
    );
    for (const recipient of batch.recipients) {
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: reason.slice(0, 500),
        },
      });
    }
    await prisma.campaignSendBatch.update({
      where: { id: batch.id },
      data: { status: "failed" },
    });
    return;
  }

  log.info(
    {
      event: "email_launch_mailbox",
      batchId,
      campaignId,
      transport: accountsMailbox.public.transport,
      from: accountsMailbox.public.display_from,
      subject: subjectPreview || "(empty)",
      compiledHtmlLen,
      sectionCount,
      recipientCount: batch.recipients.length,
    },
    "[email-launch] mailbox ready — sending via My Accounts",
  );

  const contactIds = batch.recipients
    .map((r) => r.contactId)
    .filter((id): id is string => Boolean(id));
  const identityById = new Map<
    string,
    { email?: string; firstName?: string; company?: string; city?: string }
  >();
  if (contactIds.length) {
    try {
      const rows = await listContactEmailsByIdsDao(workerSession, contactIds);
      for (const row of rows) {
        identityById.set(row.contactId, {
          email: row.email || "",
          firstName: row.firstName || "",
          company: row.company || "",
          city: row.city || "",
        });
      }
    } catch (err) {
      log.warn(
        { err, campaignId, batchId },
        "[email-launch] could not load contact merge fields",
      );
    }
  }

  const dynamicOffer = isDynamicOfferEnabled(plan);
  let mergeByContactId = new Map<string, Record<string, string>>();
  const webTrackingSecret = env.webTracking.hmacSecret;
  try {
    mergeByContactId = await buildMergeMapsForContacts(
      contactIds,
      identityById,
      {
        dynamicOffer,
        // Placeholder only — per-recipient UTM+wt overwrites campaign_url before send.
        defaultCampaignUrl: templateDest || "",
      },
    );
  } catch (err) {
    log.warn(
      { err, campaignId, batchId },
      "[email-launch] personalization adapter failed — identity only",
    );
    for (const [id, idn] of identityById) {
      mergeByContactId.set(id, {
        first_name: greetingFirstName(idn.firstName),
        firstname: greetingFirstName(idn.firstName),
        company: idn.company || "",
        city: idn.city || "",
      });
    }
  }

  const intervalMs = accountsEmailSendIntervalMs();
  let sent = 0;
  let failed = 0;
  let loggedTrackedCta = false;

  const hasWt = (url: string | null | undefined) =>
    !!url && (/[?&]wt=/i.test(url) || /wt%3D/i.test(url));

  if (!webTrackingSecret) {
    log.error(
      { batchId, hasSecret: false },
      "WEB_TRACKING_HMAC_SECRET required — refusing CTAs without wt=",
    );
  }

  const bypassSuppression = bypassEmailSuppressionForLaunch(plan);
  const suppressedRows = bypassSuppression
    ? []
    : await prisma.emailSuppression.findMany({
        where: { organizationId: batch.organizationId },
        select: { email: true },
      });
  const suppressedEmails = new Set(
    suppressedRows.map((s) => s.email.toLowerCase()),
  );

  for (let i = 0; i < batch.recipients.length; i += 1) {
    if (await abortBatchIfCampaignStopped(batch.id, batch.campaignId, log)) {
      return;
    }
    const recipient = batch.recipients[i]!;
    const emailAddr =
      recipient.email || recipient.destination || "";
    if (!emailAddr) {
      failed += 1;
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: "missing_email",
        },
      });
      continue;
    }
    const emailNorm = emailAddr.trim().toLowerCase();
    if (!bypassSuppression && suppressedEmails.has(emailNorm)) {
      failed += 1;
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: "email_suppressed",
        },
      });
      continue;
    }
    const merge = recipient.contactId
      ? mergeByContactId.get(recipient.contactId)
      : undefined;
    const campaignName =
      String(batch.campaign.name || "").trim() ||
      `campaign-${String(recipient.campaignId)}`;
    const trackingIds = {
      organizationId: String(recipient.organizationId),
      campaignId: String(recipient.campaignId),
      contactId:
        recipient.contactId != null ? String(recipient.contactId) : null,
    };
    let trackedFallback: string | null = null;
    let trackFailReason: string | null = null;
    if (templateDest) {
      if (!webTrackingSecret) {
        trackFailReason = "WEB_TRACKING_HMAC_SECRET is not set";
      } else {
        try {
          trackedFallback = applyWebTrackingParamsToUrl(
            templateDest,
            trackingIds,
            webTrackingSecret,
            { campaignName, utmMedium: "email" },
          );
          if (!trackedFallback) {
            trackFailReason = "applyWebTrackingParamsToUrl returned null";
          } else if (!hasWt(trackedFallback)) {
            trackFailReason = "built click URL missing wt= token";
            trackedFallback = null;
          } else {
            buildWebTrackingToken(trackingIds, webTrackingSecret);
          }
        } catch (err) {
          trackFailReason =
            err instanceof Error ? err.message : "web tracking token encode failed";
          trackedFallback = null;
        }
      }
      if (!trackedFallback || trackFailReason) {
        failed += 1;
        await prisma.campaignSendRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "failed",
            attemptCount: maxAttempts,
            skipFailReason: (
              trackFailReason || "missing_wt_tracking_token"
            ).slice(0, 500),
          },
        });
        log.error(
          {
            batchId,
            recipientId: recipient.id,
            organizationId: String(recipient.organizationId),
            campaignId: String(recipient.campaignId),
            contactId:
              recipient.contactId != null ? String(recipient.contactId) : null,
            reason: trackFailReason || "missing_wt_tracking_token",
          },
          "Email send aborted — CTA must include UTM + wt= for contact attribution",
        );
        continue;
      }
    }
    const clickTarget = trackedFallback || templateDest;
    const unsubUrl = emailUnsubscribeUrl(env.apiPublicUrl, recipient.id);
    const mergeWithClick = {
      ...(merge || {
        first_name: "there",
      }),
      campaign_url: clickTarget,
      url: clickTarget,
      unsubscribe_url: unsubUrl,
    };
    const variantRaw = String(recipient.abVariant || "").toLowerCase();
    let letter: AbLetter | null = null;
    if (variantRaw === "a" || variantRaw === "b") letter = variantRaw;
    else if (variantRaw === "winner" && abPlan.winner) letter = abPlan.winner;
    const rendered = renderForVariant(letter, templateDest);
    rendered.html = await rewriteEmailHtmlMediaForDelivery(
      rendered.html,
      String(batch.organizationId),
    );
    const personalized = personalizeEmailContent(
      {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      mergeWithClick,
    );
    personalized.html = attachEmailTracking(personalized.html, {
      apiBase: env.apiPublicUrl,
      recipientId: recipient.id,
      trackingIds,
      hmacSecret: webTrackingSecret,
      campaignName,
      utmMedium: "email",
      fallbackDest: trackedFallback,
    });
    personalized.text = ensureEmailUnsubscribeText(personalized.text, unsubUrl);
    const outboundClickHref = extractTrackClickHref(personalized.html);
    const htmlHasWt =
      hasWt(personalized.html) ||
      (outboundClickHref != null && hasWt(outboundClickHref));
    if (!htmlHasWt && emailHtmlHasOutboundCtaHref(personalized.html)) {
      failed += 1;
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: "email_html_missing_wt_token",
        },
      });
      log.error(
        {
          batchId,
          recipientId: recipient.id,
          clickTargetPreview: String(clickTarget || templateDest || "").slice(0, 160),
        },
        "Email send aborted — HTML missing wt= after personalize/attachEmailTracking",
      );
      continue;
    }
    if (!htmlHasWt) {
      log.info(
        {
          event: "email_launch_no_cta",
          batchId,
          campaignId,
          recipientId: recipient.id,
          to: emailAddr,
          htmlLen: personalized.html.length,
        },
        "[email-launch] no outbound CTA — sending copy-only (Unsubscribe only is OK)",
      );
    } else if (!loggedTrackedCta) {
      loggedTrackedCta = true;
      log.info(
        {
          event: "email_launch_cta_tracked",
          batchId,
          campaignId,
          recipientId: recipient.id,
          sampleClickTarget: clickTarget.slice(0, 220),
          htmlLen: personalized.html.length,
        },
        "[email-launch] CTA wrapped with UTM + wt tracking",
      );
    }

    let attempt = recipient.attemptCount;
    let lastError: unknown = null;
    let delivered = false;
    let messageId = "";

    if (outboundClickHref) {
      log.info(
        {
          event: "email_launch_cta_href",
          batchId,
          campaignId,
          recipientId: recipient.id,
          to: emailAddr,
          outboundClickHref: outboundClickHref.slice(0, 512),
          outboundHasWt:
            /wt%3D/i.test(outboundClickHref) || /[?&]wt=/i.test(outboundClickHref),
        },
        "[email-launch] outbound CTA href before mailbox send",
      );
    }

    while (attempt < maxAttempts && !delivered) {
      attempt += 1;
      try {
        messageId = await sendOnce({
          personalized,
          recipient: {
            id: recipient.id,
            email: emailAddr,
            contactId: recipient.contactId,
          },
          accountsMailbox,
        });
        delivered = true;
      } catch (err) {
        lastError = err;
        const permanent = isPermanentAccountsEmailError(err);
        if (permanent) attempt = maxAttempts;
        await prisma.campaignSendRecipient.update({
          where: { id: recipient.id },
          data: {
            attemptCount: attempt,
            skipFailReason:
              err instanceof Error ? err.message.slice(0, 500) : "send_failed",
            status: attempt >= maxAttempts ? "failed" : "pending",
          },
        });
        log.warn(
          {
            event:
              attempt >= maxAttempts
                ? "email_launch_recipient_failed"
                : "email_launch_recipient_retry",
            err,
            campaignId,
            email: emailAddr,
            batchId,
            attempt,
            maxAttempts,
            permanent,
          },
          attempt >= maxAttempts
            ? "[email-launch] recipient permanently failed after max attempts"
            : "[email-launch] recipient failed — will retry",
        );
        if (attempt < maxAttempts) {
          await sleep(Math.min(2000 * attempt, 5000));
        }
      }
    }

    if (delivered) {
      const stub = isStubProviderMessageId(messageId);
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: stub ? "stub_sent" : "sent",
          attemptCount: attempt,
          providerMessageId: messageId,
          skipFailReason: stub ? "stub_not_delivered" : null,
        },
      });
      if (!stub) sent += 1;
      log.info(
        {
          event: stub ? "email_launch_stub" : "email_launch_sent",
          batchId,
          campaignId,
          recipientId: recipient.id,
          to: emailAddr,
          from: accountsMailbox.public.display_from,
          subject: personalized.subject.slice(0, 120),
          htmlLen: personalized.html.length,
          hasCta: Boolean(outboundClickHref),
          messageId: String(messageId || "").slice(0, 64),
          attempt,
        },
        stub
          ? "[email-launch] STUB sent (not a real delivery)"
          : "[email-launch] SENT via Accounts mailbox",
      );
    } else {
      failed += 1;
      log.error(
        {
          event: "email_launch_failed",
          batchId,
          campaignId,
          recipientId: recipient.id,
          to: emailAddr,
          from: accountsMailbox.public.display_from,
          subject: personalized.subject.slice(0, 120),
          htmlLen: personalized.html.length,
          attempt,
          detail:
            lastError instanceof Error
              ? lastError.message.slice(0, 300)
              : "send_failed",
        },
        "[email-launch] FAILED — recipient not delivered",
      );
      if (attempt < maxAttempts) {
        // Should not happen; ensure terminal failed
        await prisma.campaignSendRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "failed",
            attemptCount: Math.max(attempt, maxAttempts),
            skipFailReason:
              lastError instanceof Error
                ? lastError.message.slice(0, 500)
                : "send_failed",
          },
        });
      }
    }

    // Rate gap: Accounts mailbox (~8/min).
    if (intervalMs > 0 && i < batch.recipients.length - 1) {
      await sleep(intervalMs);
    }
  }

  await prisma.campaignSendBatch.update({
    where: { id: batch.id },
    data: { status: failed && !sent ? "failed" : "sent" },
  });

  if (sent > 0) {
    await recordEmailHealthEventDao(workerSession, {
      campaignId,
      kind: "sent",
      count: sent,
    });
  }

  const nextPlan = { ...plan };
  const nextRun = { ...runMap };
  const prevEmail =
    nextRun.email && typeof nextRun.email === "object"
      ? (nextRun.email as Record<string, unknown>)
      : {};
  const totalOutcomes = sent + failed;
  const failRate = totalOutcomes > 0 ? failed / totalOutcomes : 0;
  const failPause =
    Boolean(accountsMailbox) &&
    totalOutcomes >= 5 &&
    failRate >= env.accountsEmailLaunch.failRatePause;
  nextRun.email = {
    ...prevEmail,
    sent: (typeof prevEmail.sent === "number" ? prevEmail.sent : 0) + sent,
    failed:
      (typeof prevEmail.failed === "number" ? prevEmail.failed : 0) + failed,
    max_send_attempts: maxAttempts,
    last_batch_at: new Date().toISOString(),
    transport: "accounts_mailbox",
    ...(failPause
      ? {
          paused: true,
          reason: `auto_fail_rate:${(failRate * 100).toFixed(1)}%`,
          paused_at: new Date().toISOString(),
        }
      : {}),
  };
  nextPlan.channel_run = nextRun;
  nextPlan.max_send_attempts = maxAttempts;
  await prisma.campaign.update({
    where: { id: batch.campaignId },
    data: {
      launchPlan: nextPlan as Prisma.InputJsonValue,
    },
  });
  await reconcileEmailCampaignLifecycle(batch.campaignId, log);
  try {
    await maybeAutoResolveEmailAbWinner(
      batch.campaignId,
      batch.organizationId,
      batch.campaign.branchId,
    );
  } catch (err) {
    log.warn(
      { err, event: "email_launch_ab_skipped", campaignId },
      "[email-launch] A/B auto-winner skipped",
    );
  }

  if (failPause) {
    await prisma.campaignSendBatch.updateMany({
      where: {
        campaignId,
        organizationId: batch.organizationId,
        channel: "email",
        status: EMAIL_BATCH_QUEUED,
      },
      data: { status: "cancelled" },
    });
    log.warn(
      {
        event: "email_launch_paused",
        campaignId,
        batchId,
        sent,
        failed,
        failRate,
      },
      "[email-launch] paused — Accounts fail rate over threshold",
    );
  }

  log.info(
    {
      event: "email_launch_batch_done",
      batchId,
      campaignId,
      sent,
      failed,
      intervalMs,
      maxAttempts,
      from: accountsMailbox.public.display_from,
      subject: subjectPreview || "(empty)",
      compiledHtmlLen,
      failRate,
    },
    "[email-launch] batch done",
  );
}

export async function processDueEmailBatches(log: Logger) {
  const staleSendingBefore = new Date(Date.now() - 3 * 60_000);
  const stuck = await prisma.campaignSendBatch.findMany({
    where: {
      status: "sending",
      channel: "email",
      updatedAt: { lt: staleSendingBefore },
    },
    select: { id: true, campaignId: true },
    take: 5,
  });
  for (const row of stuck) {
    const pending = await prisma.campaignSendRecipient.count({
      where: { batchId: row.id, status: "pending" },
    });
    if (pending === 0) continue;
    await prisma.campaignSendBatch.update({
      where: { id: row.id },
      data: { status: EMAIL_BATCH_QUEUED },
    });
    log.warn(
      {
        event: "email_launch_batch_requeued",
        batchId: row.id,
        campaignId: logCampaignId(row.campaignId),
        pendingRecipients: pending,
      },
      "[email-launch] re-queued batch stuck in sending",
    );
  }

  const due = await prisma.campaignSendBatch.findMany({
    where: {
      status: EMAIL_BATCH_QUEUED,
      channel: "email",
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: 5,
    select: { id: true },
  });

  for (const row of due) {
    try {
      await processBatch(row.id, log);
    } catch (err) {
      const failedBatch = await prisma.campaignSendBatch.findUnique({
        where: { id: row.id },
        select: { campaignId: true, channel: true },
      });
      log.error(
        {
          err,
          event: "email_launch_batch_error",
          batchId: row.id,
          campaignId: logCampaignId(failedBatch?.campaignId),
          channel: failedBatch?.channel ?? "email",
        },
        "[email-launch] batch processing error",
      );
      await prisma.campaignSendBatch
        .update({
          where: { id: row.id },
          data: { status: "failed" },
        })
        .catch(() => undefined);
    }
  }

  return due.length;
}

export function startEmailSendWorker(log: Logger) {
  const interval = Math.max(5_000, env.emailWorkerIntervalMs);
  log.info(
    {
      intervalMs: interval,
      maxSendAttempts: MAX_EMAIL_SEND_ATTEMPTS,
      transport: "accounts_mailbox",
      accountsEmailRatePerMinute: env.accountsEmailLaunch.ratePerMinute,
    },
    "Email send worker started",
  );

  const tick = async () => {
    try {
      const promoted = await promoteDueCampaignLifecycles(log);
      if (promoted > 0) {
        log.info({ promoted }, "Promoted due campaign lifecycles");
      }
      try {
        const { syncLiveCampaignActivityNotifications } = await import(
          "./app-notifications.js"
        );
        await syncLiveCampaignActivityNotifications();
      } catch {
        /* never block sends on notifications */
      }
      await processDueEmailBatches(log);
      try {
        const abResolved = await scanPendingEmailAbWinners(log);
        if (abResolved > 0) {
          log.info({ abResolved }, "Email A/B auto-winners resolved");
        }
      } catch (err) {
        log.warn({ err }, "Email A/B auto-winner scan failed");
      }
    } catch (err) {
      log.error({ err }, "Email worker tick failed");
    }
  };

  void tick();
  return setInterval(() => void tick(), interval);
}
