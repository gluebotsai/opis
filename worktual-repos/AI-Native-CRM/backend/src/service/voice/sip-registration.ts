/**
 * SIP registrar written on CRM login.
 * Port of ai_contact_centre/apps/cc-core/src/services/sip-registration.ts.
 * The audio gateway reads this Redis key; missing ext/password does not fail login.
 */

import Redis from "ioredis";
import { accountQuery } from "@/dao/db/account-pool";

const DEFAULT_SIP_DOMAIN = "call.worktual.com";
const SIP_SIGNALING_PORT = 5060;

type SipUserRow = {
  ext: string | null;
  sip_login_id: string | null;
  sip_password: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_id: string;
  sip_domain_name: string | null;
};

export type VoiceDidCandidate = {
  phoneNumber: string;
  routingUserId: string | null;
  routingQueueId: string | null;
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
};

/** Agent DID first, then the first active DID for a queue this user belongs to. */
export function selectOutboundCallerId(
  dids: VoiceDidCandidate[],
  userId: string,
  queueIds: readonly string[],
): string | null {
  const userDid = dids.find((did) => did.routingUserId === userId && did.phoneNumber.trim());
  if (userDid) return userDid.phoneNumber.trim();

  const allowed = new Set(queueIds);
  for (const did of dids) {
    if (!did.routingQueueId || !allowed.has(did.routingQueueId)) continue;
    const phoneNumber = did.phoneNumber.trim();
    if (phoneNumber) return phoneNumber;
  }
  return null;
}

let sipRedis: Redis | null = null;
let sipRedisUrl = "";

/**
 * The audio gateway authenticates REGISTER from this Redis.
 * QA keeps CRM cache on REDIS_URL (redis:6379) and the gateway on
 * TRANSCRIPT_REDIS_URL. Writing the SIP password to the cache Redis
 * makes the gateway answer 403.
 */
export function sipRegistrarRedisUrl(): string {
  return (
    process.env.TRANSCRIPT_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    ""
  );
}

function redisUrl(): string {
  return sipRegistrarRedisUrl();
}

function getSipRedis(): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  if (sipRedis && sipRedisUrl === url) return sipRedis;
  if (sipRedis) {
    sipRedis.disconnect();
    sipRedis = null;
  }
  sipRedisUrl = url;
  sipRedis = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  sipRedis.on("error", (err) => {
    console.warn("SIP registrar Redis error", err.message);
  });
  return sipRedis;
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

function callerName(firstName: string | null, lastName: string | null): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim() || "User";
}

async function loadSipUser(userId: string): Promise<SipUserRow | null> {
  const id = userId.trim();
  if (!id) return null;
  const { rows } = await accountQuery<SipUserRow>(
    `SELECT u.ext::text AS ext,
            u.sip_login_id,
            u.sip_password,
            u.first_name,
            u.last_name,
            u.organization_id::text AS organization_id,
            o.sip_domain_name
     FROM accounts.setup_users u
     LEFT JOIN accounts.organizations o ON o.id = u.organization_id
     WHERE u.id = $1::bigint
     LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

function sipFields(user: SipUserRow): {
  ext: string;
  sipLoginId: string;
  sipPassword: string;
} | null {
  const ext = user.ext?.trim() ?? "";
  const sipLoginId = user.sip_login_id?.trim() ?? "";
  const sipPassword = user.sip_password?.trim() ?? "";
  if (!ext || !sipLoginId || !sipPassword) return null;
  return { ext, sipLoginId, sipPassword };
}

export async function registerSipOnLogin(userId: string): Promise<void> {
  const redis = getSipRedis();
  if (!redis) return;

  const user = await loadSipUser(userId);
  if (!user) return;
  const fields = sipFields(user);
  if (!fields) return;

  const payload = sipRegistrationPayload({
    ext: fields.ext,
    organizationId: user.organization_id,
    sipPassword: fields.sipPassword,
    callerName: callerName(user.first_name, user.last_name),
    sipLoginId: fields.sipLoginId,
  });
  await redis.set(
    sipRegistrationKey(fields.ext, user.organization_id, user.sip_domain_name),
    payload,
  );
}

export async function unregisterSipOnLogout(userId: string): Promise<void> {
  const redis = getSipRedis();
  if (!redis) return;

  const user = await loadSipUser(userId);
  const ext = user?.ext?.trim() ?? "";
  if (!user || !ext) return;

  await redis.del(sipRegistrationKey(ext, user.organization_id, user.sip_domain_name));
}

export async function restoreSipRegistrarPayload(userId: string): Promise<void> {
  await registerSipOnLogin(userId);
}

async function loadOutboundCallerId(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  try {
    const [dids, queues] = await Promise.all([
      accountQuery<{
        phone_number: string | null;
        routing_user_id: string | null;
        routing_queue_id: string | null;
      }>(
        `SELECT phone_number,
                routing_user_id::text AS routing_user_id,
                routing_queue_id::text AS routing_queue_id
         FROM accounts.setup_voice_dids
         WHERE organization_id = $1::bigint AND status = 'active'
         ORDER BY id ASC`,
        [organizationId],
      ),
      accountQuery<{ queue_id: string }>(
        `SELECT DISTINCT queue_id::text AS queue_id
         FROM accounts.setup_ccaas_queue_agents
         WHERE user_id = $1::bigint`,
        [userId],
      ),
    ]);
    return selectOutboundCallerId(
      dids.rows.map((row) => ({
        phoneNumber: row.phone_number ?? "",
        routingUserId: row.routing_user_id,
        routingQueueId: row.routing_queue_id,
      })),
      userId,
      queues.rows.map((row) => row.queue_id),
    );
  } catch (error) {
    console.warn(
      "[voice][sip] outbound caller id lookup skipped",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function getSipCredentialSession(
  userId: string,
): Promise<SipCredentialSession | null> {
  const user = await loadSipUser(userId);
  if (!user) return null;
  const fields = sipFields(user);
  if (!fields) return null;

  const redisKey = sipRegistrationKey(
    fields.ext,
    user.organization_id,
    user.sip_domain_name,
  );
  const redis = getSipRedis();
  let redisRegistered = false;
  if (redis) {
    // The audio gateway overwrites this key after REGISTER. Always put the CRM
    // password back before the browser authenticates, or the next REGISTER is 403.
    await registerSipOnLogin(userId);
    redisRegistered = isFullSipRegistrarPayload(await redis.get(redisKey));
  }

  return {
    ext: fields.ext,
    organizationId: user.organization_id,
    sipLoginId: fields.sipLoginId,
    sipPassword: fields.sipPassword,
    callerName: callerName(user.first_name, user.last_name),
    redisKey,
    redisRegistered,
    sipUri: sipUriFor(fields.ext, user.organization_id, user.sip_domain_name),
    registrarUri: sipRegistrarUriFor(user.organization_id, user.sip_domain_name),
    realm: sipHostFor(user.organization_id, user.sip_domain_name),
    outboundCallerId: await loadOutboundCallerId(user.organization_id, userId),
  };
}
