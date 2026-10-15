// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { randomUUID } from "node:crypto";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import {
  isFreeWebmailDomain,
  parseEmailParts,
} from "../helpers/config-channels.js";
import {
  decryptSecret,
  generatePlatformDkim,
  verifyDomainDns,
  type DomainDnsRecord,
} from "../helpers/dkim-crypto.js";
import { env } from "../config/env.js";
import type { ChannelConfigStatus, Prisma } from "@prisma/client";
import {
  getAccountsCampaignEmailMailboxDao,
  loadAccountsMailboxForSendDao,
} from "./accounts-email-mailbox.js";
import {
  isAccountsLaunchReady,
} from "../helpers/email-launch-transport.js";
import { sendAccountsMailboxCampaignEmail } from "../services/accounts-email-send.js";
import {
  isWorktualTechDomain,
  isWorktualTechEmail,
  WORKTUAL_TECH_FROM_BLOCKED,
} from "../helpers/worktual-tech-from.js";

/** From allowed when the company domain is DNS-authenticated (My Accounts send). */
async function isModeBApprovedFrom(
  organizationId: string,
  fromEmail: string,
): Promise<boolean> {
  const parts = parseEmailParts(fromEmail);
  if (!parts) return false;
  if (isWorktualTechDomain(parts.domain) || isWorktualTechEmail(fromEmail)) {
    return false;
  }
  const domain = await prisma.emailDomain.findUnique({
    where: { organizationId_domain: { organizationId, domain: parts.domain } },
  });
  return Boolean(domain && domain.status === "authenticated");
}

const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;

export type EmailChecklist = {
  postal: boolean;
  sender_verified: boolean;
  domain_authenticated: boolean;
  return_path_verified: boolean;
  compliance_defaults: boolean;
  forced_unsubscribe: true;
  doi_default_on: true;
};

function domainFromEmail(email: string): string | null {
  return parseEmailParts(email)?.domain ?? null;
}

function computeChecklist(input: {
  hasOrg: boolean;
  hasVerifiedSender: boolean;
  hasAuthenticatedDomain: boolean;
  hasReturnPath: boolean;
}): EmailChecklist {
  return {
    postal: input.hasOrg,
    sender_verified: input.hasVerifiedSender,
    domain_authenticated: input.hasAuthenticatedDomain,
    return_path_verified: input.hasReturnPath,
    compliance_defaults: true,
    forced_unsubscribe: true,
    doi_default_on: true,
  };
}

function readinessFromChecklist(c: EmailChecklist): ChannelConfigStatus {
  const core = [
    c.postal,
    c.sender_verified,
    c.domain_authenticated,
    c.return_path_verified,
  ];
  if (core.every(Boolean)) return "ready";
  if (core.some(Boolean)) return "in_progress";
  return "not_started";
}

function domainAuthFields(status: string) {
  return status === "authenticated"
    ? { status, spfOk: true, dkimOk: true, dmarcOk: true }
    : {
        status: "awaiting_dns",
        spfOk: false,
        dkimOk: false,
        dmarcOk: false,
      };
}

/** Drop shared Worktual From rows — launch uses My Accounts mailbox only. */
export async function purgeWorktualTechEmailRows(
  organizationId?: string,
): Promise<{ senders: number; domains: number }> {
  const senderWhere = organizationId ? { organizationId } : {};
  const senders = await prisma.emailSender.findMany({
    where: senderWhere,
    select: { id: true, fromEmail: true },
  });
  const senderIds = senders
    .filter((s) => isWorktualTechEmail(s.fromEmail))
    .map((s) => s.id);
  if (senderIds.length) {
    await prisma.emailSender.deleteMany({ where: { id: { in: senderIds } } });
  }

  const domainWhere = organizationId ? { organizationId } : {};
  const domains = await prisma.emailDomain.findMany({
    where: domainWhere,
    select: { id: true, domain: true },
  });
  const domainIds = domains
    .filter((d) => isWorktualTechDomain(d.domain))
    .map((d) => d.id);
  if (domainIds.length) {
    await prisma.emailDomain.deleteMany({ where: { id: { in: domainIds } } });
  }
  return { senders: senderIds.length, domains: domainIds.length };
}

async function refreshEmailProfile(organizationId: string) {
  await purgeWorktualTechEmailRows(organizationId);
  const [org, senders, domains, returnPath] = await Promise.all([
    prisma.emailOrgProfile.findUnique({ where: { organizationId } }),
    prisma.emailSender.findMany({ where: { organizationId } }),
    prisma.emailDomain.findMany({ where: { organizationId } }),
    prisma.emailReturnPath.findUnique({ where: { organizationId } }),
  ]);

  const verifiedSenders = senders.filter((s) => s.status === "verified");
  const hasVerifiedSender = verifiedSenders.length > 0;
  const senderDomains = new Set(
    verifiedSenders
      .map((s) => domainFromEmail(s.fromEmail))
      .filter((d): d is string => Boolean(d)),
  );
  const hasAuthenticatedDomain = domains.some(
    (d) =>
      senderDomains.has(d.domain.toLowerCase()) &&
      d.spfOk &&
      d.dkimOk &&
      d.dmarcOk &&
      d.status === "authenticated",
  );
  const hasReturnPath = returnPath?.status === "verified";

  const checklist = computeChecklist({
    hasOrg: Boolean(org),
    hasVerifiedSender,
    hasAuthenticatedDomain,
    hasReturnPath,
  });
  const status = readinessFromChecklist(checklist);

  await prisma.channelSendingProfile.upsert({
    where: { organizationId_channel: { organizationId, channel: "email" } },
    create: { organizationId,
      channel: "email",
      status,
      checklist: checklist as unknown as Prisma.InputJsonValue,
    },
    update: {
      status,
      checklist: checklist as unknown as Prisma.InputJsonValue,
    },
  });

  return { status, checklist };
}

function mapOrg(
  row: {
    id: string;
    legalName: string;
    street: string;
    city: string;
    country: string;
    phone: string | null;
    updatedAt: Date;
  } | null,
) {
  if (!row) return null;
  return {
    id: row.id,
    legal_name: row.legalName,
    street: row.street,
    city: row.city,
    country: row.country,
    phone: row.phone,
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapSender(row: {
  id: string;
  displayName: string;
  fromEmail: string;
  replyTo: string | null;
  status: string;
  isActive?: boolean;
  verifyExpiresAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    display_name: row.displayName,
    from_email: row.fromEmail,
    reply_to: row.replyTo,
    status: row.status,
    is_active: Boolean(row.isActive),
    verify_expires_at: row.verifyExpiresAt?.toISOString() ?? null,
    verified_at: row.verifiedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/** Ensure exactly one verified sender is marked active for the tenant. */
async function ensureActiveSender(organizationId: string, preferId?: string | null) {
  const active = await prisma.emailSender.findFirst({
    where: { organizationId, isActive: true, status: "verified" },
  });
  if (active && isWorktualTechEmail(active.fromEmail)) {
    await prisma.emailSender.update({
      where: { id: active.id },
      data: { isActive: false },
    });
  } else if (active && (!preferId || active.id === preferId)) {
    return active;
  }

  if (preferId) {
    const prefer = await prisma.emailSender.findFirst({
      where: { id: preferId, organizationId, status: "verified" },
    });
    if (prefer && !isWorktualTechEmail(prefer.fromEmail)) {
      await prisma.$transaction([
        prisma.emailSender.updateMany({
          where: { organizationId, isActive: true },
          data: { isActive: false },
        }),
        prisma.emailSender.update({
          where: { id: prefer.id },
          data: { isActive: true },
        }),
      ]);
      return prefer;
    }
  }

  if (active && !isWorktualTechEmail(active.fromEmail)) return active;

  const fallback = await prisma.emailSender.findFirst({
    where: {
      organizationId,
      status: "verified",
    },
    orderBy: [{ verifiedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!fallback || isWorktualTechEmail(fallback.fromEmail)) return null;

  await prisma.emailSender.update({
    where: { id: fallback.id },
    data: { isActive: true },
  });
  return fallback;
}

function dnsHintsFromRecords(
  domain: string,
  records: DomainDnsRecord[] | null | undefined,
) {
  if (!records?.length) {
    return {
      spf: "v=spf1 ~all",
      dkim_host: `s1._domainkey.${domain}`,
      dkim_value: "(Save domain to generate DKIM keys)",
      dmarc_host: `_dmarc.${domain}`,
      dmarc_value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    };
  }

  const txtSpf = records.find(
    (r) =>
      r.type?.toUpperCase() === "TXT" &&
      (/spf/i.test(r.record || "") || /v=spf1/i.test(r.value || "")),
  );
  const dkim = records.find(
    (r) =>
      /dkim/i.test(r.record || "") ||
      /_domainkey/i.test(r.name || ""),
  );
  const dmarc = records.find(
    (r) =>
      /dmarc/i.test(r.record || "") ||
      /_dmarc/i.test(r.name || ""),
  );
  const mx = records.find((r) => r.type?.toUpperCase() === "MX");

  return {
    spf: txtSpf?.value || records.find((r) => /v=spf1/i.test(r.value || ""))?.value || "",
    dkim_host: dkim?.name || `s1._domainkey.${domain}`,
    dkim_value: dkim?.value || "",
    dmarc_host: dmarc?.name || `_dmarc.${domain}`,
    dmarc_value:
      dmarc?.value || `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    mx_host: mx?.name,
    mx_value: mx?.value,
  };
}

function mapDomain(row: {
  id: string;
  domain: string;
  spfOk: boolean;
  dkimOk: boolean;
  dmarcOk: boolean;
  status: string;
  providerDomainId?: string | null;
  dnsRecords?: unknown;
  updatedAt: Date;
}) {
  const records = Array.isArray(row.dnsRecords)
    ? (row.dnsRecords as DomainDnsRecord[])
    : null;
  return {
    id: row.id,
    domain: row.domain,
    spf_ok: row.spfOk,
    dkim_ok: row.dkimOk,
    dmarc_ok: row.dmarcOk,
    status: row.status,
    provider_domain_id: row.providerDomainId ?? null,
    updated_at: row.updatedAt.toISOString(),
    dns_records: records,
    dns_hints: dnsHintsFromRecords(row.domain, records),
  };
}

async function sendSenderVerificationEmail(
  session: CampaignSessionUser,
  input: {
    to: string;
    displayName: string;
    token: string;
  },
): Promise<{ mode: "live" | "stub"; message: string; token?: string }> {
  const confirmUrl = `${env.apiPublicUrl}/api/configuration/email/senders/confirm?token=${encodeURIComponent(input.token)}`;
  const html = `<p>Hi ${input.displayName},</p>
<p>Confirm <strong>${input.to}</strong> as a campaign From address.</p>
<p><a href="${confirmUrl}">Verify sender</a></p>
<p>This link expires in 48 hours.</p>`;

  const mailbox = await loadAccountsMailboxForSendDao(session);
  if (!isAccountsLaunchReady(mailbox)) {
    return {
      mode: "stub",
      message: `My Accounts mailbox is not send-ready. Open this verify link: ${confirmUrl}`,
      token: input.token,
    };
  }

  try {
    await sendAccountsMailboxCampaignEmail(mailbox, mailbox.public, {
      to: input.to,
      subject: "Verify your campaign sender address",
      html,
    });
  } catch (err) {
    return {
      mode: "stub",
      message: `Could not send from My Accounts mailbox (${err instanceof Error ? err.message : "unknown error"}). Open this verify link: ${confirmUrl}`,
      token: input.token,
    };
  }

  return {
    mode: "live",
    message: `Verification email sent to ${input.to} from your My Accounts mailbox.`,
  };
}

type PlatformDomainMeta = {
  providerDomainId: string | null;
  dnsRecords: DomainDnsRecord[] | null;
  status: string;
  dkimSelector: string | null;
  dkimPublicKey: string | null;
  dkimPrivateKeyEncrypted: string | null;
};

function ensurePlatformDomainMeta(
  domain: string,
  existing: {
    status: string;
    providerDomainId?: string | null;
    dnsRecords?: unknown;
    dkimSelector?: string | null;
    dkimPublicKey?: string | null;
    dkimPrivateKeyEncrypted?: string | null;
  } | null,
): PlatformDomainMeta {
  if (isWorktualTechDomain(domain)) {
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }

  const existingRecords = Array.isArray(existing?.dnsRecords)
    ? (existing.dnsRecords as DomainDnsRecord[])
    : null;

  if (existing?.status === "authenticated") {
    return {
      providerDomainId: existing.providerDomainId || null,
      dnsRecords: existingRecords,
      status: "authenticated",
      dkimSelector: existing.dkimSelector ?? null,
      dkimPublicKey: existing.dkimPublicKey ?? null,
      dkimPrivateKeyEncrypted: existing.dkimPrivateKeyEncrypted ?? null,
    };
  }

  if (existing?.dkimPublicKey && existing?.dkimSelector) {
    const generated = generatePlatformDkim(domain);
    return {
      providerDomainId: existing.providerDomainId || null,
      dnsRecords:
        existingRecords?.length
          ? existingRecords
          : generated.dnsRecords.map((r) =>
              r.record === "DKIM"
                ? {
                    ...r,
                    name: `${existing.dkimSelector}._domainkey.${domain}`,
                    value: `v=DKIM1; k=rsa; p=${existing.dkimPublicKey}`,
                  }
                : r,
            ),
      status: "awaiting_dns",
      dkimSelector: existing.dkimSelector,
      dkimPublicKey: existing.dkimPublicKey,
      dkimPrivateKeyEncrypted: existing.dkimPrivateKeyEncrypted ?? null,
    };
  }

  const generated = generatePlatformDkim(domain);
  return {
    providerDomainId: existing?.providerDomainId || null,
    dnsRecords: generated.dnsRecords,
    status: "awaiting_dns",
    dkimSelector: generated.selector,
    dkimPublicKey: generated.publicKeyP,
    dkimPrivateKeyEncrypted: generated.privateKeyEncrypted,
  };
}

export async function getEmailConfigBundleDao(session: CampaignSessionUser) {
  const organizationId = session.organizationId;
  await purgeWorktualTechEmailRows(organizationId);
  await ensureActiveSender(organizationId);
  const [org, senders, domains, returnPath, caps, profile] = await Promise.all([
    prisma.emailOrgProfile.findUnique({ where: { organizationId } }),
    prisma.emailSender.findMany({
      where: { organizationId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    }),
    prisma.emailDomain.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.emailReturnPath.findUnique({ where: { organizationId } }),
    prisma.emailSendingCaps.findUnique({ where: { organizationId } }),
    prisma.channelSendingProfile.findUnique({
      where: { organizationId_channel: { organizationId, channel: "email" } },
    }),
  ]);

  const readiness = await refreshEmailProfile(organizationId);
  const capsRow =
    caps ||
    (await prisma.emailSendingCaps.create({
      data: { organizationId,
        batchSize: 200,
        hourlyCap: 500,
        dailyCap: 1000,
        warmupStage: 0,
        healthStatus: "healthy",
      },
    }));

  return {
    read_only: false,
    source: "campaign_db",
    transport: "accounts_mailbox",
    status: readiness.status,
    checklist: readiness.checklist,
    org: mapOrg(org),
    senders: senders
      .filter((s) => !isWorktualTechEmail(s.fromEmail))
      .map(mapSender),
    domains: domains
      .filter((d) => !isWorktualTechDomain(d.domain))
      .map(mapDomain),
    return_path: returnPath
      ? {
          id: returnPath.id,
          domain: returnPath.domain,
          status: returnPath.status,
          updated_at: returnPath.updatedAt.toISOString(),
        }
      : null,
    caps: {
      batch_size: capsRow.batchSize,
      hourly_cap: capsRow.hourlyCap,
      daily_cap: capsRow.dailyCap,
      warmup_stage: capsRow.warmupStage,
      health_status: capsRow.healthStatus,
      health_stats: capsRow.healthStats ?? null,
    },
    profile_updated_at: profile?.updatedAt.toISOString() ?? null,
  };
}

/** Campaign email ready is My Accounts mailbox send_ready — never an ESP env flag. */
export function isWorktualApiEmailReady(): boolean {
  return false;
}

export async function getCampaignEmailStatusDao(
  organizationId: string,
): Promise<ChannelConfigStatus> {
  await purgeWorktualTechEmailRows(organizationId);
  try {
    const mailbox = await getAccountsCampaignEmailMailboxDao({
      id: "00000000-0000-4000-8000-000000000097",
      organizationId,
      branchId: "",
      email: "status@local",
      name: "status",
      role: "system",
      initials: "ST",
      orgName: "system",
      mode: "b2b",
      industry: "generic-b2b",
      businessType: "",
      industryType: null,
    } as CampaignSessionUser);
    if (mailbox?.send_ready === true) return "ready";
    if (mailbox?.status === "blocked") return "blocked";
    if (mailbox) return "in_progress";
  } catch {
    /* no Accounts mailbox */
  }
  return "not_started";
}

export async function upsertEmailOrgDao(
  session: CampaignSessionUser,
  body: {
    legal_name: string;
    street: string;
    city: string;
    country: string;
    phone?: string | null;
  },
) {
  const legalName = body.legal_name.trim();
  const street = body.street.trim();
  const city = body.city.trim();
  const country = body.country.trim();
  if (!legalName || !street || !city || !country) {
    throw new AppError("Legal name, street, city, and country are required.");
  }
  const row = await prisma.emailOrgProfile.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      legalName,
      street,
      city,
      country,
      phone: body.phone?.trim() || null,
    },
    update: {
      legalName,
      street,
      city,
      country,
      phone: body.phone?.trim() || null,
    },
  });
  await refreshEmailProfile(session.organizationId);
  return mapOrg(row);
}

export async function addEmailSenderDao(
  session: CampaignSessionUser,
  body: {
    display_name: string;
    from_email: string;
    reply_to?: string | null;
  },
) {
  const displayName = body.display_name.trim();
  const fromEmail = body.from_email.trim().toLowerCase();
  const replyTo = body.reply_to?.trim().toLowerCase() || null;
  if (!displayName) throw new AppError("Display name is required.");
  const parts = parseEmailParts(fromEmail);
  if (!parts) throw new AppError("Enter a valid email address.");
  if (isWorktualTechEmail(fromEmail) || isWorktualTechDomain(parts.domain)) {
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }
  if (isFreeWebmailDomain(parts.domain)) {
    throw new AppError(
      "Campaigns require a company domain (e.g. hello@mail.yourcompany.com). Personal inboxes cannot be used as From.",
    );
  }
  if (replyTo && !parseEmailParts(replyTo)) {
    throw new AppError("Reply-To must be a valid email address.");
  }

  const existing = await prisma.emailSender.findUnique({
    where: {
      organizationId_fromEmail: { organizationId: session.organizationId, fromEmail },
    },
  });
  if (existing) {
    throw new AppError("This sender is already added.");
  }

  const token = randomUUID();
  const modeBOk = await isModeBApprovedFrom(session.organizationId, fromEmail);

  const existingActive = await prisma.emailSender.findFirst({
    where: { organizationId: session.organizationId, isActive: true },
  });
  const makeActive = modeBOk && !existingActive;

  const row = await prisma.emailSender.create({
    data: {
      organizationId: session.organizationId,
      displayName,
      fromEmail,
      replyTo,
      status: modeBOk ? "verified" : "pending_verification",
      isActive: makeActive,
      verifiedAt: modeBOk ? new Date() : null,
      verifyToken: modeBOk ? null : token,
      verifyExpiresAt: modeBOk
        ? null
        : new Date(Date.now() + VERIFY_TTL_MS),
    },
  });

  if (modeBOk) {
    await ensureActiveSender(session.organizationId, row.id);
  }

  const existingDomain = await prisma.emailDomain.findUnique({
    where: {
      organizationId_domain: {
        organizationId: session.organizationId,
        domain: parts.domain,
      },
    },
  });

  let domainMeta: PlatformDomainMeta;
  try {
    domainMeta = ensurePlatformDomainMeta(parts.domain, existingDomain);
  } catch (err) {
    if (err instanceof AppError) throw err;
    domainMeta = {
      providerDomainId: existingDomain?.providerDomainId || null,
      dnsRecords: null,
      status: "awaiting_dns",
      dkimSelector: existingDomain?.dkimSelector ?? null,
      dkimPublicKey: existingDomain?.dkimPublicKey ?? null,
      dkimPrivateKeyEncrypted: existingDomain?.dkimPrivateKeyEncrypted ?? null,
    };
  }

  await prisma.emailDomain.upsert({
    where: {
      organizationId_domain: {
        organizationId: session.organizationId,
        domain: parts.domain,
      },
    },
    create: {
      organizationId: session.organizationId,
      domain: parts.domain,
      providerDomainId: domainMeta.providerDomainId,
      dnsRecords: (domainMeta.dnsRecords || undefined) as
        | Prisma.InputJsonValue
        | undefined,
      dkimSelector: domainMeta.dkimSelector,
      dkimPublicKey: domainMeta.dkimPublicKey,
      dkimPrivateKeyEncrypted: domainMeta.dkimPrivateKeyEncrypted,
      ...domainAuthFields(domainMeta.status),
    },
    update: {
      ...domainAuthFields(domainMeta.status),
      ...(domainMeta.providerDomainId
        ? { providerDomainId: domainMeta.providerDomainId }
        : {}),
      ...(domainMeta.dnsRecords
        ? { dnsRecords: domainMeta.dnsRecords as Prisma.InputJsonValue }
        : {}),
      ...(domainMeta.dkimSelector ? { dkimSelector: domainMeta.dkimSelector } : {}),
      ...(domainMeta.dkimPublicKey ? { dkimPublicKey: domainMeta.dkimPublicKey } : {}),
      ...(domainMeta.dkimPrivateKeyEncrypted
        ? { dkimPrivateKeyEncrypted: domainMeta.dkimPrivateKeyEncrypted }
        : {}),
    },
  });

  await refreshEmailProfile(session.organizationId);

  if (modeBOk) {
    return {
      sender: mapSender(row),
      verification: {
        mode: "stub" as const,
        message: `Sender ${fromEmail} is verified for the authenticated company domain.`,
      },
    };
  }

  let verification: Awaited<ReturnType<typeof sendSenderVerificationEmail>>;
  try {
    verification = await sendSenderVerificationEmail(session, {
      to: fromEmail,
      displayName,
      token,
    });
  } catch (err) {
    verification = {
      mode: "stub",
      message: `Sender saved, but verification email failed: ${err instanceof Error ? err.message : "unknown error"}`,
      token,
    };
  }

  return {
    sender: mapSender(row),
    verification,
  };
}

/** Manual verify (UI button) when mailbox mail was not used. */
export async function verifyEmailSenderDao(
  session: CampaignSessionUser,
  senderId: string,
) {
  const row = await prisma.emailSender.findFirst({
    where: { id: senderId, organizationId: session.organizationId },
  });
  if (!row) throw new AppError("Sender not found.", 404);
  if (isWorktualTechEmail(row.fromEmail)) {
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }
  if (row.status === "verified") {
    await ensureActiveSender(session.organizationId, row.id);
    const fresh = await prisma.emailSender.findUniqueOrThrow({
      where: { id: row.id },
    });
    return mapSender(fresh);
  }
  if (row.verifyExpiresAt && row.verifyExpiresAt.getTime() < Date.now()) {
    throw new AppError("Verification link expired. Resend verification.");
  }
  const updated = await prisma.emailSender.update({
    where: { id: row.id },
    data: {
      status: "verified",
      verifiedAt: new Date(),
      verifyToken: null,
      verifyExpiresAt: null,
    },
  });
  await ensureActiveSender(session.organizationId, updated.id);
  await refreshEmailProfile(session.organizationId);
  const fresh = await prisma.emailSender.findUniqueOrThrow({
    where: { id: updated.id },
  });
  return mapSender(fresh);
}

/** Public mailbox confirm via token in email link. */
export async function confirmEmailSenderByTokenDao(token: string) {
  const clean = token.trim();
  if (!clean) throw new AppError("Missing verification token.", 400);
  const row = await prisma.emailSender.findFirst({
    where: { verifyToken: clean },
  });
  if (!row) throw new AppError("Invalid or already used verification link.", 404);
  if (isWorktualTechEmail(row.fromEmail)) {
    await prisma.emailSender.delete({ where: { id: row.id } });
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }
  if (row.verifyExpiresAt && row.verifyExpiresAt.getTime() < Date.now()) {
    throw new AppError("Verification link expired. Resend from Configuration.", 400);
  }
  const updated = await prisma.emailSender.update({
    where: { id: row.id },
    data: {
      status: "verified",
      verifiedAt: new Date(),
      verifyToken: null,
      verifyExpiresAt: null,
    },
  });
  await ensureActiveSender(row.organizationId, updated.id);
  await refreshEmailProfile(row.organizationId);
  const fresh = await prisma.emailSender.findUniqueOrThrow({
    where: { id: updated.id },
  });
  return mapSender(fresh);
}

export async function setActiveEmailSenderDao(
  session: CampaignSessionUser,
  senderId: string,
) {
  const row = await prisma.emailSender.findFirst({
    where: { id: senderId, organizationId: session.organizationId },
  });
  if (!row) throw new AppError("Sender not found.", 404);
  if (isWorktualTechEmail(row.fromEmail)) {
    await prisma.emailSender.delete({ where: { id: row.id } });
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }
  if (row.status !== "verified") {
    throw new AppError("Only a verified sender can be set as active.", 400);
  }
  await prisma.$transaction([
    prisma.emailSender.updateMany({
      where: { organizationId: session.organizationId, isActive: true },
      data: { isActive: false },
    }),
    prisma.emailSender.update({
      where: { id: row.id },
      data: { isActive: true },
    }),
  ]);
  const fresh = await prisma.emailSender.findUniqueOrThrow({
    where: { id: row.id },
  });
  return mapSender(fresh);
}

export async function deleteEmailSenderDao(
  session: CampaignSessionUser,
  senderId: string,
) {
  const row = await prisma.emailSender.findFirst({
    where: { id: senderId, organizationId: session.organizationId },
  });
  if (!row) throw new AppError("Sender not found.", 404);

  const wasActive = row.isActive;
  await prisma.emailSender.delete({ where: { id: row.id } });

  if (wasActive) {
    await ensureActiveSender(session.organizationId);
  }
  await refreshEmailProfile(session.organizationId);
  return { deleted: true, id: senderId };
}

export async function resendEmailSenderVerifyDao(
  session: CampaignSessionUser,
  senderId: string,
) {
  const row = await prisma.emailSender.findFirst({
    where: { id: senderId, organizationId: session.organizationId },
  });
  if (!row) throw new AppError("Sender not found.", 404);
  if (isWorktualTechEmail(row.fromEmail)) {
    await prisma.emailSender.delete({ where: { id: row.id } });
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }
  if (row.status === "verified") {
    throw new AppError("Sender is already verified.");
  }
  const token = randomUUID();
  const updated = await prisma.emailSender.update({
    where: { id: row.id },
    data: {
      status: "pending_verification",
      verifyToken: token,
      verifyExpiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });

  let verification: Awaited<ReturnType<typeof sendSenderVerificationEmail>>;
  try {
    verification = await sendSenderVerificationEmail(session, {
      to: updated.fromEmail,
      displayName: updated.displayName,
      token,
    });
  } catch (err) {
    verification = {
      mode: "stub",
      message: `Could not send verification email: ${err instanceof Error ? err.message : "unknown error"}`,
      token,
    };
  }

  return {
    sender: mapSender(updated),
    verification,
  };
}

export async function upsertEmailDomainDao(
  session: CampaignSessionUser,
  body: { domain: string },
) {
  const domain = body.domain.trim().toLowerCase();
  if (!domain || domain.includes("@") || isFreeWebmailDomain(domain)) {
    throw new AppError("Enter a company domain (not a free webmail domain).");
  }
  if (isWorktualTechDomain(domain)) {
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }

  const existing = await prisma.emailDomain.findUnique({
    where: { organizationId_domain: { organizationId: session.organizationId, domain } },
  });

  const domainMeta = ensurePlatformDomainMeta(domain, existing);

  const row = await prisma.emailDomain.upsert({
    where: {
      organizationId_domain: { organizationId: session.organizationId, domain },
    },
    create: {
      organizationId: session.organizationId,
      domain,
      providerDomainId: domainMeta.providerDomainId,
      dnsRecords: (domainMeta.dnsRecords || undefined) as Prisma.InputJsonValue | undefined,
      dkimSelector: domainMeta.dkimSelector,
      dkimPublicKey: domainMeta.dkimPublicKey,
      dkimPrivateKeyEncrypted: domainMeta.dkimPrivateKeyEncrypted,
      ...domainAuthFields(domainMeta.status),
    },
    update: {
      ...domainAuthFields(
        domainMeta.status === "authenticated" ? "authenticated" : "awaiting_dns",
      ),
      providerDomainId: domainMeta.providerDomainId,
      dnsRecords: (domainMeta.dnsRecords || undefined) as Prisma.InputJsonValue | undefined,
      ...(domainMeta.dkimSelector ? { dkimSelector: domainMeta.dkimSelector } : {}),
      ...(domainMeta.dkimPublicKey ? { dkimPublicKey: domainMeta.dkimPublicKey } : {}),
      ...(domainMeta.dkimPrivateKeyEncrypted
        ? { dkimPrivateKeyEncrypted: domainMeta.dkimPrivateKeyEncrypted }
        : {}),
    },
  });
  await refreshEmailProfile(session.organizationId);
  return mapDomain(row);
}

export async function verifyEmailDomainDao(
  session: CampaignSessionUser,
  domainId: string,
) {
  const row = await prisma.emailDomain.findFirst({
    where: { id: domainId, organizationId: session.organizationId },
  });
  if (!row) throw new AppError("Domain not found.", 404);
  if (isWorktualTechDomain(row.domain)) {
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }

  // Platform-generated DKIM — live DNS match against stored public key.
  if (row.dkimPublicKey && row.dkimSelector) {
    const check = await verifyDomainDns({
      domain: row.domain,
      selector: row.dkimSelector,
      expectedPublicP: row.dkimPublicKey,
    });

    const updated = await prisma.emailDomain.update({
      where: { id: row.id },
      data: {
        spfOk: check.spfOk,
        dkimOk: check.dkimOk,
        dmarcOk: check.dmarcOk,
        status:
          check.dkimOk && check.spfOk ? "authenticated" : "awaiting_dns",
      },
    });

    if (!(check.dkimOk && check.spfOk)) {
      await refreshEmailProfile(session.organizationId);
      throw new AppError(
        [
          "DNS not verified yet.",
          check.dkimDetail,
          check.spfDetail,
          check.dmarcDetail,
          "Add the TXT records shown for this domain, wait for propagation, then Verify again.",
          "After DKIM is OK, mail ops must install the private key in OpenDKIM if branded From is used.",
        ].join(" "),
        400,
      );
    }

    await prisma.emailReturnPath.upsert({
      where: { organizationId: session.organizationId },
      create: {
        organizationId: session.organizationId,
        domain: row.domain,
        status: "verified",
      },
      update: { domain: row.domain, status: "verified" },
    });
    await refreshEmailProfile(session.organizationId);
    return mapDomain(updated);
  }

  const updated = await prisma.emailDomain.update({
    where: { id: row.id },
    data: {
      spfOk: true,
      dkimOk: true,
      dmarcOk: true,
      status: "authenticated",
    },
  });
  await prisma.emailReturnPath.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      domain: row.domain,
      status: "verified",
    },
    update: { domain: row.domain, status: "verified" },
  });
  await refreshEmailProfile(session.organizationId);
  return mapDomain(updated);
}

export async function upsertEmailReturnPathDao(
  session: CampaignSessionUser,
  body: { domain: string },
) {
  const domain = body.domain.trim().toLowerCase();
  if (!domain || isFreeWebmailDomain(domain)) {
    throw new AppError("Enter a valid return-path / bounce domain.");
  }
  const row = await prisma.emailReturnPath.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      domain,
      status: "awaiting_dns",
    },
    update: { domain, status: "awaiting_dns" },
  });
  await refreshEmailProfile(session.organizationId);
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function verifyEmailReturnPathDao(session: CampaignSessionUser) {
  const row = await prisma.emailReturnPath.findUnique({
    where: { organizationId: session.organizationId },
  });
  if (!row) throw new AppError("Add a return-path domain first.");

  const anyAuth = await prisma.emailDomain.findFirst({
    where: { organizationId: session.organizationId, status: "authenticated" },
  });
  if (!anyAuth) {
    throw new AppError(
      "Authenticate a sending domain first; return-path follows that domain.",
      400,
    );
  }

  const updated = await prisma.emailReturnPath.update({
    where: { id: row.id },
    data: { status: "verified" },
  });
  await refreshEmailProfile(session.organizationId);
  return {
    id: updated.id,
    domain: updated.domain,
    status: updated.status,
    updated_at: updated.updatedAt.toISOString(),
  };
}

export async function upsertEmailCapsDao(
  session: CampaignSessionUser,
  body: {
    batch_size?: number;
    hourly_cap?: number;
    daily_cap?: number;
    warmup_stage?: number;
  },
) {
  const data = {
    batchSize:
      typeof body.batch_size === "number" && body.batch_size > 0
        ? Math.min(body.batch_size, 5000)
        : undefined,
    hourlyCap:
      typeof body.hourly_cap === "number" && body.hourly_cap > 0
        ? body.hourly_cap
        : undefined,
    dailyCap:
      typeof body.daily_cap === "number" && body.daily_cap > 0
        ? body.daily_cap
        : undefined,
    warmupStage:
      typeof body.warmup_stage === "number" && body.warmup_stage >= 0
        ? body.warmup_stage
        : undefined,
  };
  const row = await prisma.emailSendingCaps.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      batchSize: data.batchSize ?? 200,
      hourlyCap: data.hourlyCap ?? 500,
      dailyCap: data.dailyCap ?? 1000,
      warmupStage: data.warmupStage ?? 0,
      healthStatus: "healthy",
    },
    update: {
      ...(data.batchSize != null ? { batchSize: data.batchSize } : {}),
      ...(data.hourlyCap != null ? { hourlyCap: data.hourlyCap } : {}),
      ...(data.dailyCap != null ? { dailyCap: data.dailyCap } : {}),
      ...(data.warmupStage != null ? { warmupStage: data.warmupStage } : {}),
    },
  });
  return {
    batch_size: row.batchSize,
    hourly_cap: row.hourlyCap,
    daily_cap: row.dailyCap,
    warmup_stage: row.warmupStage,
    health_status: row.healthStatus,
    health_stats: row.healthStats ?? null,
  };
}

/** After OpenDKIM + Postfix assign a new domainId, ops/admin saves it here. */
export async function patchEmailDomainProviderDao(
  session: CampaignSessionUser,
  domainRowId: string,
  body: { provider_domain_id: string },
) {
  const row = await prisma.emailDomain.findFirst({
    where: { id: domainRowId, organizationId: session.organizationId },
  });
  if (!row) throw new AppError("Domain not found.", 404);
  if (isWorktualTechDomain(row.domain)) {
    throw new AppError(WORKTUAL_TECH_FROM_BLOCKED);
  }
  if (row.status !== "authenticated") {
    throw new AppError(
      "Verify DNS (SPF/DKIM) before saving a Postfix domainId.",
    );
  }

  const pid = String(body.provider_domain_id || "").trim();
  if (!/^\d+$/.test(pid)) {
    throw new AppError("provider_domain_id must be a numeric Postfix domainId.");
  }

  const updated = await prisma.emailDomain.update({
    where: { id: row.id },
    data: { providerDomainId: pid },
  });
  await refreshEmailProfile(session.organizationId);
  return mapDomain(updated);
}

/**
 * Ops-only: decrypt DKIM private PEM for OpenDKIM install.
 * Requires x-internal-service-key — never expose via normal FE flows.
 */
export async function exportEmailDomainDkimDao(input: {
  organizationId: string;
  domainRowId: string;
  internalKey: string;
}) {
  const expected = env.social.internalServiceKey;
  if (!expected || input.internalKey !== expected) {
    throw new AppError("Unauthorized DKIM export.", 401, "DKIM_EXPORT_DENIED");
  }

  const row = await prisma.emailDomain.findFirst({
    where: { id: input.domainRowId, organizationId: input.organizationId },
  });
  if (!row) throw new AppError("Domain not found.", 404);
  if (!row.dkimPrivateKeyEncrypted || !row.dkimSelector || !row.dkimPublicKey) {
    throw new AppError(
      "No platform DKIM key stored for this domain. Connect domain again to generate.",
      400,
    );
  }

  let privateKeyPem: string;
  try {
    privateKeyPem = decryptSecret(row.dkimPrivateKeyEncrypted);
  } catch {
    throw new AppError(
      "Could not decrypt DKIM private key. Check DKIM_ENCRYPTION_KEY / JWT_SECRET matches the key used at generation.",
      500,
    );
  }

  return {
    domain: row.domain,
    selector: row.dkimSelector,
    public_key_p: row.dkimPublicKey,
    private_key_pem: privateKeyPem,
    dns_name: `${row.dkimSelector}._domainkey.${row.domain}`,
    instructions: [
      `Write private_key_pem to OpenDKIM keys dir (e.g. /etc/opendkim/keys/${row.domain}/${row.dkimSelector}.private).`,
      `KeyTable: ${row.dkimSelector}._domainkey.${row.domain} ${row.domain}:${row.dkimSelector}:/path/to/${row.dkimSelector}.private`,
      `SigningTable: *@${row.domain} ${row.dkimSelector}._domainkey.${row.domain}`,
      "Restart OpenDKIM / milter, then ask Postfix team for a NEW domainId.",
      "Save that domainId via PUT /configuration/email/domains/:id/provider.",
    ],
  };
}
