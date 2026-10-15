import type { DbClient } from "../lib/rls.js";
import { readCustomFieldString } from "./cdp-customer-profile.js";

export const PREFERRED_CHANNEL_FIELD = "preferredChannel";
export const PREFERRED_CHANNEL_SOURCE_FIELD = "preferredChannelSource";
export const PREFERRED_CHANNEL_UPDATED_AT_FIELD = "preferredChannelUpdatedAt";

/** Outreach priority when profile has no explicit preferred channel. */
export const CALLBACK_OUTREACH_CHANNELS = [
  "whatsapp",
  "instagram",
  "facebook",
  "email",
] as const;

export type CallbackOutreachChannel = (typeof CALLBACK_OUTREACH_CHANNELS)[number];

type ChannelActivity = {
  channel: string;
  count: number;
  lastAt: Date;
};

function readNestedProfilePreferred(
  customFields: Record<string, unknown> | null | undefined,
): string | null {
  const profileAttributes = customFields?.profileAttributes;
  if (!profileAttributes || typeof profileAttributes !== "object" || Array.isArray(profileAttributes)) {
    return null;
  }
  const value = (profileAttributes as Record<string, unknown>).preferredChannel;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isCallbackOutreachChannel(value: string): value is CallbackOutreachChannel {
  return (CALLBACK_OUTREACH_CHANNELS as readonly string[]).includes(value);
}

export function outreachChannelRank(channel: string): number {
  const index = CALLBACK_OUTREACH_CHANNELS.indexOf(channel as CallbackOutreachChannel);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function pickBestOutreachChannel(input: {
  activityChannels: string[];
  reachableChannels: Set<string>;
  hintChannel?: string | null;
}): CallbackOutreachChannel | null {
  // Candidates must be reachable via identity keys. Activity and hint only
  // rank among reachable channels — they must never invent WhatsApp/email/etc.
  const candidates = new Set<string>();
  for (const channel of input.reachableChannels) {
    if (isCallbackOutreachChannel(channel)) candidates.add(channel);
  }

  if (candidates.size === 0) {
    return null;
  }

  const ranked = [...candidates].sort((left, right) => {
    const rankDiff = outreachChannelRank(left) - outreachChannelRank(right);
    if (rankDiff !== 0) return rankDiff;
    const leftRecent = input.activityChannels.indexOf(left);
    const rightRecent = input.activityChannels.indexOf(right);
    if (leftRecent !== -1 || rightRecent !== -1) {
      if (leftRecent === -1) return 1;
      if (rightRecent === -1) return -1;
      return leftRecent - rightRecent;
    }
    // Prefer an explicit reachable hint when ranks tie.
    if (input.hintChannel === left && input.hintChannel !== right) return -1;
    if (input.hintChannel === right && input.hintChannel !== left) return 1;
    return left.localeCompare(right);
  });

  return ranked[0] as CallbackOutreachChannel;
}

function isStoredPreferredUsable(
  storedPreferred: string | null | undefined,
  _activityChannels: string[],
  reachableChannels: Set<string>,
): storedPreferred is CallbackOutreachChannel {
  return Boolean(
    storedPreferred &&
      isCallbackOutreachChannel(storedPreferred) &&
      reachableChannels.has(storedPreferred),
  );
}

async function loadCustomFields(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<Record<string, unknown>> {
  const rows = await db.$queryRaw<Array<{ custom_fields: Record<string, unknown> | null }>>`
    SELECT custom_fields
    FROM cdp.customer_profile
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${contactId}::text
    LIMIT 1
  `;
  return rows[0]?.custom_fields ?? {};
}

export async function readPreferredChannel(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<string | null> {
  const customFields = await loadCustomFields(db, organizationId, contactId);
  return (
    readCustomFieldString(customFields, PREFERRED_CHANNEL_FIELD) ??
    readNestedProfilePreferred(customFields)
  );
}

export async function getContactChannelActivity(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<ChannelActivity[]> {
  const rows = await db.$queryRawUnsafe<ChannelActivity[]>(
    `
    WITH activity AS (
      SELECT c.channel, c.updated_at AS last_at
      FROM ccass.conversations c
      WHERE c.organization_id = $1::bigint
        AND c.contact_id = $2
      UNION ALL
      SELECT mc.channel, mc.missed_at AS last_at
      FROM ccass.agent_missed_contacts mc
      WHERE mc.organization_id = $1::bigint
        AND mc.contact_id = $2
    )
    SELECT
      channel,
      COUNT(*)::int AS count,
      MAX(last_at) AS "lastAt"
    FROM activity
    WHERE channel IS NOT NULL
      AND channel <> ''
    GROUP BY channel
    ORDER BY MAX(last_at) DESC
    `,
    organizationId,
    contactId,
  );
  return rows;
}

export async function getContactReachableChannels(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<Set<string>> {
  const rows = await db.$queryRaw<Array<{ channel: string }>>`
    SELECT DISTINCT
      CASE
        WHEN key_type IN ('whatsapp_phone', 'phone', 'phone_secondary') THEN 'whatsapp'
        WHEN key_type = 'instagram_user' THEN 'instagram'
        WHEN key_type = 'facebook_user' THEN 'facebook'
        WHEN key_type IN ('email', 'email_secondary') THEN 'email'
        ELSE NULL
      END AS channel
    FROM cdp.identity_keys
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${contactId}::text
  `;

  const reachable = new Set<string>();
  for (const row of rows) {
    if (row.channel && isCallbackOutreachChannel(row.channel)) {
      reachable.add(row.channel);
    }
  }
  return reachable;
}

export async function refreshPreferredChannel(
  db: DbClient,
  organizationId: string,
  contactId: string,
  hintChannel?: string | null,
): Promise<CallbackOutreachChannel | null> {
  const customFields = await loadCustomFields(db, organizationId, contactId);
  const storedPreferred =
    readCustomFieldString(customFields, PREFERRED_CHANNEL_FIELD) ??
    readNestedProfilePreferred(customFields);
  const source = readCustomFieldString(customFields, PREFERRED_CHANNEL_SOURCE_FIELD);

  const [activity, reachable] = await Promise.all([
    getContactChannelActivity(db, organizationId, contactId),
    getContactReachableChannels(db, organizationId, contactId),
  ]);
  const activityChannels = activity.map((row) => row.channel);

  if (isStoredPreferredUsable(storedPreferred, activityChannels, reachable)) {
    return storedPreferred;
  }

  const resolved = pickBestOutreachChannel({
    activityChannels,
    reachableChannels: reachable,
    hintChannel,
  });

  if (!resolved) {
    return null;
  }

  if (resolved === storedPreferred && source === "inferred") {
    return resolved;
  }

  const nextCustomFields = {
    ...customFields,
    [PREFERRED_CHANNEL_FIELD]: resolved,
    [PREFERRED_CHANNEL_SOURCE_FIELD]: source === "explicit" ? "explicit" : "inferred",
    [PREFERRED_CHANNEL_UPDATED_AT_FIELD]: new Date().toISOString(),
  };

  await db.$executeRawUnsafe(
    `
    UPDATE cdp.customer_profile
    SET custom_fields = $3::jsonb,
        updated_at = NOW()
    WHERE organization_id = $1::bigint
      AND cdp_id = $2::text
    `,
    organizationId,
    contactId,
    JSON.stringify(nextCustomFields),
  );

  return resolved;
}

export async function resolveCallbackOutreachChannel(
  db: DbClient,
  organizationId: string,
  contactId: string,
  options: {
    requestedChannel?: string | null;
    hintChannel?: string | null;
  } = {},
): Promise<CallbackOutreachChannel> {
  const reachable = await getContactReachableChannels(db, organizationId, contactId);

  // Only honor an explicit request when the contact actually has that identity.
  // Never invent WhatsApp (or other) outreach for webchat-only visitors.
  if (
    options.requestedChannel &&
    isCallbackOutreachChannel(options.requestedChannel) &&
    reachable.has(options.requestedChannel)
  ) {
    return options.requestedChannel;
  }

  const preferred = await refreshPreferredChannel(
    db,
    organizationId,
    contactId,
    // Never pass an unreachable request/hint into preference inference.
    options.hintChannel &&
      isCallbackOutreachChannel(options.hintChannel) &&
      reachable.has(options.hintChannel)
      ? options.hintChannel
      : options.requestedChannel &&
          isCallbackOutreachChannel(options.requestedChannel) &&
          reachable.has(options.requestedChannel)
        ? options.requestedChannel
        : null,
  );
  if (preferred) {
    return preferred;
  }

  if (
    options.hintChannel &&
    isCallbackOutreachChannel(options.hintChannel) &&
    reachable.has(options.hintChannel)
  ) {
    return options.hintChannel;
  }

  throw Object.assign(
    new Error(
      "No reachable callback channel for this contact. Add WhatsApp, Instagram, Facebook, or email identity.",
    ),
    { status: 400 },
  );
}

export type ContactCallbackChannelOptions = {
  preferredChannel: CallbackOutreachChannel | null;
  availableChannels: CallbackOutreachChannel[];
  source: "explicit" | "inferred" | "hint" | null;
};

/** Read-only options for assign-callback UI (identity + activity + stored preference). */
export async function getContactCallbackChannelOptions(
  db: DbClient,
  organizationId: string,
  contactId: string,
  hintChannel?: string | null,
): Promise<ContactCallbackChannelOptions> {
  const customFields = await loadCustomFields(db, organizationId, contactId);
  const storedPreferred =
    readCustomFieldString(customFields, PREFERRED_CHANNEL_FIELD) ??
    readNestedProfilePreferred(customFields);
  const storedSource = readCustomFieldString(customFields, PREFERRED_CHANNEL_SOURCE_FIELD);

  const [activity, reachable] = await Promise.all([
    getContactChannelActivity(db, organizationId, contactId),
    getContactReachableChannels(db, organizationId, contactId),
  ]);
  const activityChannels = activity.map((row) => row.channel);

  const available = new Set<CallbackOutreachChannel>();
  for (const channel of reachable) {
    if (isCallbackOutreachChannel(channel)) available.add(channel);
  }

  const availableChannels = CALLBACK_OUTREACH_CHANNELS.filter((channel) =>
    available.has(channel),
  );

  if (isStoredPreferredUsable(storedPreferred, activityChannels, reachable)) {
    return {
      preferredChannel: storedPreferred,
      availableChannels,
      source: storedSource === "explicit" ? "explicit" : "inferred",
    };
  }

  const inferred = pickBestOutreachChannel({
    activityChannels,
    reachableChannels: reachable,
    hintChannel,
  });

  return {
    preferredChannel: inferred,
    availableChannels,
    source: inferred
      ? hintChannel && inferred === hintChannel
        ? "hint"
        : "inferred"
      : null,
  };
}
