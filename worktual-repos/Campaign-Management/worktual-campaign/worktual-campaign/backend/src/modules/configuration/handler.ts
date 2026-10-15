// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  requireAdmin,
  requireSession,
} from "../../middlewares/authendication.js";
import { requireInternalServiceKey } from "../../helpers/internal-service-auth.js";
import {
  getOrgApiKeyStatusDao,
  rotateOrgApiKeyDao,
  rotateOrgApiKeyForOrganizationDao,
} from "../../dao/org-api-key.js";
import {
  snapshotReadyGalleryChannels,
  syncGalleryChannelsAfterConfigChange,
} from "../../helpers/gallery-channel-sync.js";
import {
  assertKnownChannel,
  getChannelConfigDetailDao,
  listChannelProfilesDao,
} from "../../dao/configuration.js";
import {
  assertEmailSendPipelineReady,
  evaluateEmailSendPipelineReady,
} from "../../helpers/email-send-pipeline-ready.js";
import {
  addEmailSenderDao,
  confirmEmailSenderByTokenDao,
  deleteEmailSenderDao,
  exportEmailDomainDkimDao,
  getCampaignEmailStatusDao,
  getEmailConfigBundleDao,
  patchEmailDomainProviderDao,
  purgeWorktualTechEmailRows,
  resendEmailSenderVerifyDao,
  setActiveEmailSenderDao,
  upsertEmailCapsDao,
  upsertEmailDomainDao,
  upsertEmailOrgDao,
  upsertEmailReturnPathDao,
  verifyEmailDomainDao,
  verifyEmailReturnPathDao,
  verifyEmailSenderDao,
} from "../../dao/email-config.js";
import {
  assertPushConfigChannel,
  getCampaignPushStatusDao,
  getPushConfigBundleDao,
  savePushConfigDao,
} from "../../dao/push-config.js";
import {
  getCampaignSmsStatusDao,
  getSmsConfigBundleDao,
  saveSmsConfigDao,
} from "../../dao/sms-config.js";
import { resolveWhatsAppChannelConfigId } from "../../dao/whatsapp-channel-config.js";
import {
  getAccountsCampaignEmailMailboxDao,
  listAccountsCampaignEmailMailboxesDao,
  loadAccountsMailboxForSendDao,
} from "../../dao/accounts-email-mailbox.js";
import { sendAccountsMailboxTestEmail } from "../../services/accounts-email-send.js";
import { prisma } from "../../plugins/prisma.js";
import { resolvePushTestByEmailDao } from "../../dao/push-endpoints.js";
import { sendPushViaProvider } from "../../services/push-providers.js";
import {
  isAccountsCampaignChannelsConfigured,
  listAccountsPushChannel,
} from "../../services/accounts-campaign-channels.js";
import { normalizeAppPushPlatform } from "../../helpers/push-token.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import { env } from "../../config/env.js";
import { dbIdParam, zDbId } from "../../helpers/id-schema.js";
import { isWorktualTechEmail } from "../../helpers/worktual-tech-from.js";
import {
  applyWebTrackingParamsToUrl,
  buildWebTrackingToken,
  buildWebTrackingUtmLandingUrl,
} from "../../helpers/web-tracking-link.js";
import {
  emailTrackClickUrl,
  safeTrackRedirect,
} from "../../helpers/email-track.js";

const channelParam = z.object({ channel: z.string().min(1) });
const idParam = dbIdParam();

const orgBody = z.object({
  legal_name: z.string().min(1),
  street: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().nullable().optional(),
});

const senderBody = z.object({
  display_name: z.string().min(1),
  from_email: z.string().min(3),
  reply_to: z.string().nullable().optional(),
});

const domainBody = z.object({ domain: z.string().min(1) });
const domainProviderBody = z.object({
  provider_domain_id: z.string().min(1),
});
const returnPathBody = z.object({ domain: z.string().min(1) });
const capsBody = z.object({
  batch_size: z.number().int().positive().optional(),
  hourly_cap: z.number().int().positive().optional(),
  daily_cap: z.number().int().positive().optional(),
  warmup_stage: z.number().int().nonnegative().optional(),
});

const phase2TestBody = z.object({
  to: z.string().email(),
  channel_id: z.string().min(1).optional(),
  subject: z.string().max(200).optional(),
});

export async function listConfigChannelsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const channels = await listChannelProfilesDao(session);
  const emailStatus = await getCampaignEmailStatusDao(session.organizationId);
  const [webPushStatus, appPushStatus, smsStatus, accountsApp, accountsWeb] =
    await Promise.all([
      getCampaignPushStatusDao(session.organizationId, "web_push"),
      getCampaignPushStatusDao(session.organizationId, "app_push"),
      getCampaignSmsStatusDao(session.organizationId).catch(
        () => "not_started" as const,
      ),
      isAccountsCampaignChannelsConfigured()
        ? listAccountsPushChannel(session.organizationId, "app_push").catch(
            () => null,
          )
        : Promise.resolve(null),
      isAccountsCampaignChannelsConfigured()
        ? listAccountsPushChannel(session.organizationId, "web_push").catch(
            () => null,
          )
        : Promise.resolve(null),
    ]);

  // WhatsApp unlocks when Accounts (or WHATSAPP_CHANNEL_CONFIG_ID fallback) resolves.
  let whatsappReady = false;
  try {
    await resolveWhatsAppChannelConfigId(session.organizationId);
    whatsappReady = true;
  } catch {
    whatsappReady = false;
  }

  const merged = channels.map((ch) => {
    if (ch.channel === "email") {
      return {
        ...ch,
        status: emailStatus,
        source:
          emailStatus === "ready" ? "accounts_mailbox" : "campaign_db",
        read_only: false,
        detail:
          emailStatus === "ready"
            ? "Sending via My Accounts mailbox"
            : undefined,
      };
    }
    if (ch.channel === "web_push") {
      const fromAccounts = Boolean(accountsWeb);
      return {
        ...ch,
        status: webPushStatus,
        source: fromAccounts ? "my_accounts" : "campaign_db",
        read_only: false,
        detail: fromAccounts
          ? "VAPID from My Accounts Channel Setup"
          : undefined,
      };
    }
    if (ch.channel === "app_push") {
      const fromAccounts = Boolean(accountsApp);
      return {
        ...ch,
        status: appPushStatus,
        source: fromAccounts ? "my_accounts" : "campaign_db",
        read_only: fromAccounts,
        detail: fromAccounts
          ? "FCM/APNs from My Accounts Channel Setup"
          : "FCM/APNs setup + generate company X-Api-Key",
      };
    }
    if (ch.channel === "sms") {
      return {
        ...ch,
        status: smsStatus,
        source: "campaign_db",
        read_only: false,
      };
    }
    if (ch.channel === "meta_whatsapp" && whatsappReady) {
      return {
        ...ch,
        status: "ready" as const,
        source: env.social.whatsappChannelConfigId
          ? "whatsapp_channel_config"
          : ch.source,
      };
    }
    return ch;
  });
  return sendSuccess(reply, RESPONSE.configChannelsSuccess, {
    channels: merged,
  });
}

export async function getChannelStubHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = channelParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  assertKnownChannel(params.data.channel);
  if (params.data.channel === "email") {
    const bundle = await getEmailConfigBundleDao(session);
    return sendSuccess(reply, RESPONSE.configEmailSuccess, bundle);
  }
  if (
    params.data.channel === "web_push" ||
    params.data.channel === "app_push"
  ) {
    const channel = assertPushConfigChannel(params.data.channel);
    const bundle = await getPushConfigBundleDao(session, channel);
    return sendSuccess(reply, RESPONSE.configPushSuccess, bundle);
  }
  if (params.data.channel === "sms") {
    const bundle = await getSmsConfigBundleDao(session);
    return sendSuccess(reply, RESPONSE.configSmsSuccess, bundle);
  }
  const detail = await getChannelConfigDetailDao(
    session,
    params.data.channel,
  );
  return sendSuccess(reply, RESPONSE.configChannelStub, detail);
}

export async function getPushConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = channelParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const channel = assertPushConfigChannel(params.data.channel);
  const bundle = await getPushConfigBundleDao(session, channel);
  return sendSuccess(reply, RESPONSE.configPushSuccess, {
    config: bundle,
    read_only: Boolean(bundle.read_only),
  });
}

export async function putPushConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = channelParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const channel = assertPushConfigChannel(params.data.channel);
  const body =
    typeof request.body === "object" && request.body
      ? (request.body as Record<string, unknown>)
      : {};
  const settings =
    body.settings && typeof body.settings === "object"
      ? (body.settings as Record<string, unknown>)
      : body;
  const prevChannels = await snapshotReadyGalleryChannels(session);
  const bundle = await savePushConfigDao(session, channel, settings);
  void syncGalleryChannelsAfterConfigChange(session, prevChannels).catch(() => {});
  return sendSuccess(reply, RESPONSE.configPushSaved, { config: bundle });
}

const pushTestBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  email: z.string().max(254).optional(),
  endpoint: z.string().min(1).optional(),
  endpoint_id: zDbId.optional(),
  platform: z.string().min(1).max(40).optional(),
});

/** Send one test push using saved Configuration credentials (does not create a campaign). */
export async function postPushTestSendHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = channelParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const channel = assertPushConfigChannel(params.data.channel);
  const isWeb = channel === "web_push";
  const endpointChannel = isWeb ? "web" : "push";
  const agentChannel = isWeb ? "web" : "push";

  const parsed = pushTestBody.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? "Provide title and body for the test.",
    );
  }

  let destination = parsed.data.endpoint?.trim() || "";
  let platform = parsed.data.platform?.trim() || (isWeb ? "browser" : "android");
  let authKeys: Record<string, unknown> | null = null;
  let contactEmail: string | null = null;
  const lookupEmail = parsed.data.email?.trim().toLowerCase() || "";

  if (lookupEmail) {
    const hit = await resolvePushTestByEmailDao(session, {
      email: lookupEmail,
      channel: endpointChannel,
    });
    destination = hit.destination;
    platform = hit.platform || platform;
    authKeys = hit.authKeys;
    contactEmail = hit.contactEmail;
  } else if (parsed.data.endpoint_id) {
    const row = await prisma.pushEndpoint.findFirst({
      where: {
        id: parsed.data.endpoint_id,
        organizationId: session.organizationId,
        channel: endpointChannel,
        active: true,
      },
    });
    if (!row) {
      throw new AppError(
        isWeb
          ? "Registered browser subscription not found or inactive."
          : "Registered device not found or inactive.",
        404,
      );
    }
    destination = row.endpoint;
    platform = row.platform || platform;
    if (row.authKeys && typeof row.authKeys === "object") {
      authKeys = row.authKeys as Record<string, unknown>;
    }
  }

  if (!destination) {
    const row = await prisma.pushEndpoint.findFirst({
      where: {
        organizationId: session.organizationId,
        channel: endpointChannel,
        active: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) {
      throw new AppError(
        isWeb
          ? "No browser subscription. Opt in on the site (Allow notifications) or register one in Step 2."
          : "No device token. Paste an FCM/APNs token or register a device in Step 2.",
        400,
      );
    }
    destination = row.endpoint;
    platform = row.platform || platform;
    if (row.authKeys && typeof row.authKeys === "object") {
      authKeys = row.authKeys as Record<string, unknown>;
    }
  }

  if (destination.startsWith("stub://")) {
    throw new AppError("Refuse to test-send to stub:// destinations.", 400);
  }

  if (isWeb && !authKeys) {
    const row = await prisma.pushEndpoint.findFirst({
      where: {
        organizationId: session.organizationId,
        channel: "web",
        active: true,
        endpoint: destination,
      },
    });
    if (row?.authKeys && typeof row.authKeys === "object") {
      authKeys = row.authKeys as Record<string, unknown>;
    }
  }

  if (isWeb) {
    const keys = authKeys || {};
    const p256dh = String(keys.p256dh || keys.p256DH || "");
    const auth = String(keys.auth || "");
    if (!p256dh || !auth) {
      throw new AppError(
        "Web push needs subscription keys (p256dh, auth). Pick a registered browser or opt in on the site first.",
        400,
      );
    }
  }

  if (!isWeb) {
    platform = normalizeAppPushPlatform(platform, destination) || platform;
  }

  try {
    const result = await sendPushViaProvider({
      organizationId: session.organizationId,
      agentChannel,
      destination,
      platform,
      authKeys,
      payload: {
        title: parsed.data.title.trim(),
        body: parsed.data.body.trim(),
        cta: "Test",
      },
    });
    return sendSuccess(reply, RESPONSE.configPushTestSent, {
      ok: true,
      provider: result.provider,
      message_id: result.messageId,
      platform,
      contact_email: contactEmail,
      destination_preview:
        destination.length > 24
          ? `${destination.slice(0, 12)}…${destination.slice(-8)}`
          : destination,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Test push send failed";
    throw new AppError(message.slice(0, 500), 400);
  }
}

export async function getSmsConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const bundle = await getSmsConfigBundleDao(session);
  return sendSuccess(reply, RESPONSE.configSmsSuccess, {
    config: bundle,
    read_only: false,
  });
}

export async function putSmsConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body =
    typeof request.body === "object" && request.body
      ? (request.body as Record<string, unknown>)
      : {};
  const settings =
    body.settings && typeof body.settings === "object"
      ? (body.settings as Record<string, unknown>)
      : body;
  const prevChannels = await snapshotReadyGalleryChannels(session);
  const bundle = await saveSmsConfigDao(session, settings);
  void syncGalleryChannelsAfterConfigChange(session, prevChannels).catch(() => {});
  return sendSuccess(reply, RESPONSE.configSmsSaved, { config: bundle });
}

export async function getEmailConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const bundle = await getEmailConfigBundleDao(session);
  return sendSuccess(reply, RESPONSE.configEmailSuccess, {
    config: bundle,
    read_only: false,
  });
}

export async function putEmailOrgHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = orgBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const org = await upsertEmailOrgDao(session, body.data);
  return sendSuccess(reply, RESPONSE.configEmailOrgSaved, { org });
}

export async function postEmailSenderHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = senderBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await addEmailSenderDao(session, body.data);
  return sendSuccess(reply, RESPONSE.configEmailSenderAdded, result);
}

export async function postEmailSenderVerifyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const sender = await verifyEmailSenderDao(session, params.data.id);
  const prevChannels = await snapshotReadyGalleryChannels(session);
  void syncGalleryChannelsAfterConfigChange(session, prevChannels).catch(() => {});
  return sendSuccess(reply, RESPONSE.configEmailSenderVerified, { sender });
}

export async function postEmailSenderResendHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await resendEmailSenderVerifyDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.configEmailSenderAdded, result);
}

export async function postEmailSenderActivateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const sender = await setActiveEmailSenderDao(session, params.data.id);
  const prevChannels = await snapshotReadyGalleryChannels(session);
  void syncGalleryChannelsAfterConfigChange(session, prevChannels).catch(() => {});
  return sendSuccess(reply, RESPONSE.configEmailSenderActivated, { sender });
}

export async function deleteEmailSenderHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await deleteEmailSenderDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.configEmailSenderDeleted, result);
}

export async function putEmailDomainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = domainBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const domain = await upsertEmailDomainDao(session, body.data);
  return sendSuccess(reply, RESPONSE.configEmailDomainSaved, { domain });
}

export async function postEmailDomainVerifyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const domain = await verifyEmailDomainDao(session, params.data.id);
  const prevChannels = await snapshotReadyGalleryChannels(session);
  void syncGalleryChannelsAfterConfigChange(session, prevChannels).catch(() => {});
  return sendSuccess(reply, RESPONSE.configEmailDomainVerified, { domain });
}

export async function putEmailDomainProviderHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = domainProviderBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const domain = await patchEmailDomainProviderDao(
    session,
    params.data.id,
    body.data,
  );
  return sendSuccess(reply, "Postfix domainId saved for Mode B sends", {
    domain,
  });
}

/** Ops-only DKIM private key export (requires x-internal-service-key). */
export async function postEmailDomainDkimExportHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = idParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const keyHeader =
    (request.headers["x-internal-service-key"] as string | undefined)?.trim() ||
    "";
  const exported = await exportEmailDomainDkimDao({
    organizationId: session.organizationId,
    domainRowId: params.data.id,
    internalKey: keyHeader,
  });
  return sendSuccess(reply, "DKIM private key exported for OpenDKIM install", {
    dkim: exported,
  });
}

export async function putEmailReturnPathHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = returnPathBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const return_path = await upsertEmailReturnPathDao(session, body.data);
  return sendSuccess(reply, RESPONSE.configEmailReturnPathSaved, {
    return_path,
  });
}

export async function postEmailReturnPathVerifyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const return_path = await verifyEmailReturnPathDao(session);
  return sendSuccess(reply, RESPONSE.configEmailReturnPathVerified, {
    return_path,
  });
}

export async function putEmailCapsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = capsBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const caps = await upsertEmailCapsDao(session, body.data);
  return sendSuccess(reply, RESPONSE.configEmailCapsSaved, { caps });
}

/** Public: mailbox verification link target (no session). */
export async function getEmailSenderConfirmHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const tokenRaw =
    typeof request.query === "object" &&
    request.query &&
    "token" in request.query
      ? String((request.query as { token?: string }).token ?? "")
      : "";
  try {
    await confirmEmailSenderByTokenDao(tokenRaw);
    return reply.redirect(
      `${env.appUrl}/configuration/email?verified=1`,
    );
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : "Verification failed. Try resending from Configuration.";
    return reply.redirect(
      `${env.appUrl}/configuration/email?verified=0&error=${encodeURIComponent(message)}`,
    );
  }
}

/** Unified email send gate — mailbox + backend OAuth/crypto env (all launch paths). */
export async function getEmailSendReadinessHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const snap = await evaluateEmailSendPipelineReady(session);
  return sendSuccess(reply, "Email send readiness", {
    ready: snap.ready,
    code: snap.code,
    message: snap.message,
    remedy: snap.remedy || null,
    google_oauth_configured: snap.google_oauth_configured,
    microsoft_oauth_configured: snap.microsoft_oauth_configured,
    ms_token_encryption_configured: snap.ms_token_encryption_configured,
    mailbox_send_ready: snap.mailbox_send_ready,
    oauth_provider: snap.oauth_provider,
    transport: snap.transport,
  });
}

/** Phase 2 — My Accounts campaign mailbox summary (read-only, no Worktual API). */
export async function getEmailPhase2ConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  try {
    await purgeWorktualTechEmailRows(session.organizationId);
    const mailboxes = (
      await listAccountsCampaignEmailMailboxesDao(session)
    ).filter(
      (m) =>
        !isWorktualTechEmail(m.display_from) &&
        !isWorktualTechEmail(m.sender_email) &&
        !isWorktualTechEmail(m.oauth_account_email),
    );
    const selectedRaw = await getAccountsCampaignEmailMailboxDao(session);
    const selected =
      selectedRaw &&
      !isWorktualTechEmail(selectedRaw.display_from) &&
      !isWorktualTechEmail(selectedRaw.sender_email) &&
      !isWorktualTechEmail(selectedRaw.oauth_account_email)
        ? selectedRaw
        : mailboxes.find((m) => m.send_ready) || mailboxes[0] || null;
    return sendSuccess(reply, "Phase 2 Accounts email mailbox", {
      phase2: true,
      worktual_api: false,
      selected,
      mailboxes,
      setup_hint:
        "Configure the campaign mailbox in My Accounts Setup Workspace (product: campaign).",
    });
  } catch (err) {
    request.log.error({ err }, "Phase 2 email config lookup failed");
    return sendSuccess(reply, "Phase 2 Accounts email mailbox", {
      phase2: true,
      worktual_api: false,
      selected: null,
      mailboxes: [],
      setup_hint:
        "Configure the campaign mailbox in My Accounts Setup Workspace (product: campaign).",
      lookup_error:
        err instanceof Error
          ? err.message
          : "Could not read Accounts mailbox tables.",
    });
  }
}

export async function postEmailPhase2TestSendHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = phase2TestBody.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? "Enter a valid test recipient.",
    );
  }
  await assertEmailSendPipelineReady(session);
  const loaded = await loadAccountsMailboxForSendDao(
    session,
    parsed.data.channel_id,
  );
  if (!loaded) {
    throw new AppError(
      "No campaign email mailbox found in My Accounts for this organization.",
      404,
    );
  }
  const result = await sendAccountsMailboxTestEmail(
    loaded,
    loaded.public,
    {
      to: parsed.data.to,
      subject: parsed.data.subject,
    },
  );
  return sendSuccess(reply, "Phase 2 test email sent", result);
}

/** Fixed recipient id for Configuration track-link lab (click log only). */
const TRACK_LINK_PREVIEW_RECIPIENT_ID =
  "00000000-0000-4000-8000-000000000099";

const trackLinkPreviewBody = z.object({
  organization_id: z.union([z.string(), z.number()]).transform(String),
  campaign_id: z.union([z.string(), z.number()]).transform(String),
  contact_id: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null || String(v).trim() === "" ? "0" : String(v))),
  campaign_name: z.string().optional(),
  destination_url: z.string().optional(),
  channel: z.string().optional().default("email"),
});

/**
 * Temporary QA — homepage UTM + wt={token} landing + email click wrapper.
 * Agreed with Web Tracking: SDK reads wt + UTMs; homepage still opens if absent.
 */
export async function postEmailTrackLinkPreviewHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  requireSession(request);
  const parsed = trackLinkPreviewBody.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? "Invalid track link preview input.",
    );
  }

  const secret = env.webTracking.hmacSecret;
  if (!secret) {
    throw new AppError(
      "WEB_TRACKING_HMAC_SECRET is not set on the API. Share the same secret with Web Tracking (see docs/WEB_TRACKING_LINK_DECODE.md).",
      503,
    );
  }

  const landing = env.webTracking.landingUrl;
  const ids = {
    organizationId: parsed.data.organization_id,
    campaignId: parsed.data.campaign_id,
    contactId: parsed.data.contact_id,
  };
  const campaignName =
    String(parsed.data.campaign_name || "").trim() ||
    `qa-campaign-${parsed.data.campaign_id}`;
  const utmMedium =
    String(parsed.data.channel || "email").trim().toLowerCase() || "email";

  let token: string;
  try {
    token = buildWebTrackingToken(ids, secret);
  } catch (err) {
    throw new AppError(
      err instanceof Error ? err.message : "Could not encode ids into token.",
      400,
    );
  }

  const futureDest = safeTrackRedirect(parsed.data.destination_url);
  const destBase = futureDest || landing;
  const webTrackingUrl = destBase
    ? applyWebTrackingParamsToUrl(destBase, ids, secret, {
        campaignName,
        utmMedium,
      }) ||
      (landing
        ? buildWebTrackingUtmLandingUrl(ids, landing, secret, {
            campaignName,
            utmMedium,
          })
        : null)
    : null;
  if (!webTrackingUrl) {
    throw new AppError(
      "Could not build web tracking URL. Provide destination_url (or WEB_TRACKING_LANDING_URL for the lab).",
      400,
    );
  }
  const apiBase = env.apiPublicUrl.replace(/\/$/, "");
  const emailClickUrl = emailTrackClickUrl(
    apiBase,
    TRACK_LINK_PREVIEW_RECIPIENT_ID,
    webTrackingUrl,
  );

  return sendSuccess(reply, "Track link preview", {
    token,
    organization_id: parsed.data.organization_id,
    campaign_id: parsed.data.campaign_id,
    contact_id: parsed.data.contact_id,
    campaign_name: campaignName,
    channel: parsed.data.channel,
    landing_base: landing,
    web_tracking_url: webTrackingUrl,
    email_click_url: emailClickUrl,
    destination_url: futureDest,
    note:
      "Temporary lab only. email_click_url = Campaign click log → destination " +
      "with utm_source=worktual_campaign, utm_medium, utm_campaign, wt= HMAC token. " +
      "Production send stamps the same params onto the template destination URL.",
  });
}

export async function getAppPushIntegrationApiKeyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireAdmin(requireSession(request));
  const status = await getOrgApiKeyStatusDao(session);
  return sendSuccess(reply, "App push integration key status", {
    ...status,
    register_url: "POST /api/app-push/endpoints",
    auth_header: "X-Api-Key",
  });
}

export async function postAppPushIntegrationApiKeyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireAdmin(requireSession(request));
  const rotated = await rotateOrgApiKeyDao(session);
  return sendSuccess(reply, "App push integration key minted", rotated, 201);
}

const internalOrgAppPushKeyBody = z.object({
  organizationId: z.string().min(1),
  purpose: z.string().optional(),
});

/** Onboarding team — mint/rotate app push key for a tenant (no Campaign login). */
export async function postInternalOrgAppPushApiKeyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  requireInternalServiceKey(request);
  const parsed = internalOrgAppPushKeyBody.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const rotated = await rotateOrgApiKeyForOrganizationDao(
    parsed.data.organizationId,
    parsed.data.purpose,
  );
  return sendSuccess(reply, "App push integration key minted", rotated, 201);
}
