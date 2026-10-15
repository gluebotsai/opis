import type { PrismaClient } from "@ai-contact-center/db-cc";

import { parseEntityId, serializeEntityId } from "../lib/id-schema.js";
import { getRedisClient } from "../lib/redis-client.js";
import { withStaffContext } from "../lib/rls.js";

const DEFAULT_SIP_DOMAIN = "call.worktual.com";
const SIP_SIGNALING_PORT = 5060;

type SipUserRow = {
  ext: number | null;
  sip_login_id: string | null;
  sip_password: string | null;
  first_name: string;
  last_name: string;
  organization_id: bigint;
};

export type OutboundCallerOption = {
  id: string;
  kind: "agent" | "queue";
  phoneNumber: string;
  label: string;
};

export type SipCredentialSession = {
  ext: string;
  organizationId: string;
  sipLoginId: string;
  sipPassword: string;
  callerName: string;
  redisKey: string;
  redisRegistered: boolean;
  sipUri: string;
  registrarUri: string;
  realm: string;
  outboundCallerId: string | null;
  outboundOptions: OutboundCallerOption[];
};

export type VoiceDidCandidate = {
  phone_number: string;
  routing_user_id: bigint | null;
  routing_queue_id: bigint | null;
};

export function listOutboundCallerOptions(input: {
  dids: VoiceDidCandidate[];
  userId: bigint;
  queueIds: readonly bigint[];
  callerName: string;
  queueNames?: ReadonlyMap<string, string>;
}): OutboundCallerOption[] {
  const options: OutboundCallerOption[] = [];
  const userDid = input.dids.find((did) => did.routing_user_id === input.userId && did.phone_number.trim());
  if (userDid) {
    options.push({
      id: "agent",
      kind: "agent",
      phoneNumber: userDid.phone_number.trim(),
      label: input.callerName.trim() || "Agent",
    });
  }

  const seenNumbers = new Set(options.map((option) => option.phoneNumber));
  const allowedQueues = new Set(input.queueIds);
  for (const did of input.dids) {
    if (did.routing_queue_id == null || !allowedQueues.has(did.routing_queue_id)) continue;
    const phoneNumber = did.phone_number.trim();
    if (!phoneNumber || seenNumbers.has(phoneNumber)) continue;
    const queueKey = did.routing_queue_id.toString();
    seenNumbers.add(phoneNumber);
    options.push({
      id: `queue:${queueKey}:${phoneNumber}`,
      kind: "queue",
      phoneNumber,
      label: input.queueNames?.get(queueKey)?.trim() || "Queue",
    });
  }
  return options;
}

export function selectOutboundCallerId(
  dids: VoiceDidCandidate[],
  userId: bigint,
  queueIds: readonly bigint[] = [],
): string | null {
  return listOutboundCallerOptions({
    dids,
    userId,
    queueIds,
    callerName: "Agent",
  })[0]?.phoneNumber ?? null;
}

export function sipRegistrationDomain(): string {
  return process.env.SIP_REGISTRATION_DOMAIN?.trim() || DEFAULT_SIP_DOMAIN;
}

export function sipHostFor(organizationId: string, sipDomainName?: string | null): string {
  const named = sipDomainName?.trim();
  if (named) return named;
  return `${organizationId}.${sipRegistrationDomain()}`;
}

export function sipRegistrationKey(
  ext: string,
  organizationId: string,
  sipDomainName?: string | null,
): string {
  return `${ext}@${sipHostFor(organizationId, sipDomainName)}`;
}

export function sipUriFor(
  ext: string,
  organizationId: string,
  sipDomainName?: string | null,
): string {
  return `sip:${ext}@${sipHostFor(organizationId, sipDomainName)}:${SIP_SIGNALING_PORT}`;
}

export function sipRegistrarUriFor(
  organizationId: string,
  sipDomainName?: string | null,
): string {
  return `sip:${sipHostFor(organizationId, sipDomainName)}:${SIP_SIGNALING_PORT}`;
}

export function sipRealmFor(organizationId: string, sipDomainName?: string | null): string {
  return sipHostFor(organizationId, sipDomainName);
}

export function sipRegistrationPayload(input: {
  ext: string;
  organizationId: string;
  sipPassword: string;
  callerName: string;
  sipLoginId: string;
}): string {
  return JSON.stringify({
    user_id: input.ext,
    domain_id: input.organizationId,
    password: input.sipPassword,
    callerName: input.callerName,
    sip_login_id: input.sipLoginId,
  });
}

export function isFullSipRegistrarPayload(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (
      typeof parsed.user_id === "string" &&
      parsed.user_id.length > 0 &&
      typeof parsed.domain_id === "string" &&
      parsed.domain_id.length > 0 &&
      typeof parsed.password === "string" &&
      parsed.password.length > 0 &&
      typeof parsed.callerName === "string" &&
      typeof parsed.sip_login_id === "string" &&
      parsed.sip_login_id.length > 0
    );
  } catch {
    return false;
  }
}

function callerName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim() || "User";
}

async function loadSipUser(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<SipUserRow | null> {
  return withStaffContext(prisma, async (db) =>
    db.setup_users.findFirst({
      where: {
        id: parseEntityId(userId),
        organization_id: parseEntityId(organizationId),
      },
      select: {
        ext: true,
        sip_login_id: true,
        sip_password: true,
        first_name: true,
        last_name: true,
        organization_id: true,
      },
    }),
  );
}

async function loadSipDomainName(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string | null> {
  const org = await withStaffContext(prisma, async (db) =>
    db.organizations.findFirst({
      where: { id: parseEntityId(organizationId) },
      select: { sip_domain_name: true },
    }),
  );
  return org?.sip_domain_name?.trim() || null;
}

async function loadOutboundOptions(
  prisma: PrismaClient,
  organizationId: bigint,
  userId: string,
  callerName: string,
): Promise<OutboundCallerOption[]> {
  const userIdBig = parseEntityId(userId);
  return withStaffContext(prisma, async (db) => {
    const [dids, memberships] = await Promise.all([
      db.setup_voice_dids.findMany({
        where: { organization_id: organizationId, status: "active" },
        select: { phone_number: true, routing_user_id: true, routing_queue_id: true },
        orderBy: { id: "asc" },
      }),
      db.setup_ccaas_queue_agents.findMany({
        where: { user_id: userIdBig },
        select: { queue_id: true },
      }),
    ]);
    const queueIds = memberships.map((row) => row.queue_id);
    const queues =
      queueIds.length === 0
        ? []
        : await db.setup_ccaas_queues.findMany({
            where: { id: { in: queueIds } },
            select: { id: true, name: true },
          });
    return listOutboundCallerOptions({
      dids,
      userId: userIdBig,
      queueIds,
      callerName,
      queueNames: new Map(queues.map((queue) => [queue.id.toString(), queue.name])),
    });
  });
}

export async function registerSipOnLogin(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const user = await loadSipUser(prisma, organizationId, userId);
  if (!user) return;

  const ext = user.ext == null ? "" : String(user.ext);
  const sipLoginId = user.sip_login_id?.trim() ?? "";
  const sipPassword = user.sip_password?.trim() ?? "";
  if (!ext || !sipLoginId || !sipPassword) return;

  const orgId = serializeEntityId(user.organization_id);
  const sipDomainName = await loadSipDomainName(prisma, orgId);
  const redisKey = sipRegistrationKey(ext, orgId, sipDomainName);
  const payload = sipRegistrationPayload({
    ext,
    organizationId: orgId,
    sipPassword,
    callerName: callerName(user.first_name, user.last_name),
    sipLoginId,
  });
  await redis.set(redisKey, payload);
}

export async function unregisterSipOnLogout(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const user = await loadSipUser(prisma, organizationId, userId);
  if (user?.ext == null) return;

  const orgId = serializeEntityId(user.organization_id);
  const sipDomainName = await loadSipDomainName(prisma, orgId);
  await redis.del(sipRegistrationKey(String(user.ext), orgId, sipDomainName));
}

export async function restoreSipRegistrarPayload(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  await registerSipOnLogin(prisma, organizationId, userId);
}

export async function getSipCredentialSession(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<SipCredentialSession | null> {
  const user = await loadSipUser(prisma, organizationId, userId);
  if (!user) return null;

  const ext = user.ext == null ? "" : String(user.ext);
  const sipLoginId = user.sip_login_id?.trim() ?? "";
  const sipPassword = user.sip_password?.trim() ?? "";
  if (!ext || !sipLoginId || !sipPassword) return null;

  const orgId = serializeEntityId(user.organization_id);
  const sipDomainName = await loadSipDomainName(prisma, orgId);
  const redisKey = sipRegistrationKey(ext, orgId, sipDomainName);
  const redis = getRedisClient();
  let redisRegistered = false;
  if (redis) {
    const current = await redis.get(redisKey);
    if (!isFullSipRegistrarPayload(current)) {
      await registerSipOnLogin(prisma, organizationId, userId);
    }
    redisRegistered = isFullSipRegistrarPayload(await redis.get(redisKey));
  }

  const displayName = callerName(user.first_name, user.last_name);
  const outboundOptions = await loadOutboundOptions(
    prisma,
    user.organization_id,
    userId,
    displayName,
  );

  return {
    ext,
    organizationId: orgId,
    sipLoginId,
    sipPassword,
    callerName: displayName,
    redisKey,
    redisRegistered,
    sipUri: sipUriFor(ext, orgId, sipDomainName),
    registrarUri: sipRegistrarUriFor(orgId, sipDomainName),
    realm: sipRealmFor(orgId, sipDomainName),
    outboundCallerId: outboundOptions[0]?.phoneNumber ?? null,
    outboundOptions,
  };
}