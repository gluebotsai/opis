// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import {
  isPushAgentChannel,
  toAgentChannel,
  type AgentPushChannel,
} from "../helpers/channel-ids.js";
import {
  isStubPushDestination,
  normalizeAppPushPlatform,
} from "../helpers/push-token.js";
import type { Prisma } from "@prisma/client";
import {
  createContactForIntegrationDao,
  findContactsByIdentityDao,
  getContactByIdDao,
  listContactSummariesByIdsDao,
} from "./contact.js";
import { findWebsiteWebPushDestinationsDao } from "./website-contacts.js";
import { contactIdForCampaign, toStableDbId } from "../helpers/id-schema.js";

export type PushEndpointInput = {
  contactId?: string | null;
  channel: string;
  endpoint: string;
  platform?: string | null;
  authKeys?: Record<string, unknown> | null;
  label?: string | null;
  active?: boolean;
};

export type RegisterAppPushInput = {
  endpoint: string;
  contactId?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  platform?: string | null;
  label?: string | null;
  active?: boolean;
};

export type RegisterWebPushInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  contactId?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  platform?: string | null;
  label?: string | null;
  active?: boolean;
};

function campaignOrganizationId(session: CampaignSessionUser): string {
  return toStableDbId(session.organizationId);
}

function campaignContactId(id: string | null | undefined): string | null {
  const s = String(id || "").trim();
  return s ? contactIdForCampaign(s) : null;
}

function prismaPushError(err: unknown, fallback: string): AppError {
  const raw = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";
  if (code === "P2021" || /does not exist/i.test(raw)) {
    return new AppError(
      "Push endpoints table is missing. Run campaign database migrations, then retry.",
      500,
    );
  }
  const first = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return new AppError(first && first.length < 220 ? first : fallback, 500);
}

export async function upsertPushEndpointDao(
  session: CampaignSessionUser,
  input: PushEndpointInput,
) {
  const channel = toAgentChannel(input.channel);
  if (!isPushAgentChannel(channel)) {
    throw new AppError("channel must be push (app) or web.", 400);
  }
  const endpoint = String(input.endpoint || "").trim();
  if (!endpoint) throw new AppError("endpoint is required.", 400);

  const organizationId = campaignOrganizationId(session);
  const contactId = campaignContactId(input.contactId);

  try {
    const row = await prisma.pushEndpoint.upsert({
      where: {
        organizationId_channel_endpoint: { organizationId,
          channel,
          endpoint,
        },
      },
      create: { organizationId,
        contactId,
        channel,
        platform: input.platform?.trim() || null,
        endpoint,
        authKeys: (input.authKeys ?? undefined) as Prisma.InputJsonValue | undefined,
        label: input.label?.trim() || null,
        active: input.active !== false,
      },
      update: {
        ...(contactId ? { contactId } : {}),
        platform: input.platform?.trim() || null,
        authKeys: (input.authKeys ?? undefined) as Prisma.InputJsonValue | undefined,
        label: input.label?.trim() || null,
        active: input.active !== false,
      },
    });

    return {
      id: row.id,
      channel: row.channel,
      platform: row.platform,
      endpoint: row.endpoint,
      contact_id: row.contactId,
      active: row.active,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw prismaPushError(err, "Could not save the push token.");
  }
}

export async function listPushEndpointsDao(
  session: CampaignSessionUser,
  opts: { channel?: string; contactIds?: string[]; activeOnly?: boolean } = {},
) {
  const channel = opts.channel ? toAgentChannel(opts.channel) : undefined;
  const contactIds = (opts.contactIds || [])
    .map((id) => campaignContactId(id))
    .filter((id): id is string => Boolean(id));
  try {
    const rows = await prisma.pushEndpoint.findMany({
      where: {
        organizationId: campaignOrganizationId(session),
        ...(channel ? { channel } : {}),
        ...(opts.activeOnly !== false ? { active: true } : {}),
        ...(contactIds.length ? { contactId: { in: contactIds } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel as AgentPushChannel,
      platform: r.platform,
      endpoint: r.endpoint,
      contact_id: r.contactId,
      auth_keys: r.authKeys,
      label: r.label,
      active: r.active,
      updated_at: r.updatedAt.toISOString(),
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw prismaPushError(err, "Could not load push endpoints.");
  }
}

export type ContactPushChannelView = {
  id: string;
  channel: AgentPushChannel;
  platform: string | null;
  endpoint: string;
  label: string | null;
  active: boolean;
  updated_at: string;
};

/** Push tokens/subscriptions linked to one contact (never throws). */
export async function listContactPushChannelsDao(
  session: CampaignSessionUser,
  contactId: string,
): Promise<{
  app_push: ContactPushChannelView[];
  web_push: ContactPushChannelView[];
}> {
  const batch = await listContactPushChannelsBatchDao(session, [contactId]);
  return batch.get(contactId) ?? { app_push: [], web_push: [] };
}

/** Batch push lookup — one query for many contacts (Audience list). */
export async function listContactPushChannelsBatchDao(
  session: CampaignSessionUser,
  contactIds: string[],
): Promise<
  Map<string, { app_push: ContactPushChannelView[]; web_push: ContactPushChannelView[] }>
> {
  const empty = (): {
    app_push: ContactPushChannelView[];
    web_push: ContactPushChannelView[];
  } => ({ app_push: [], web_push: [] });

  const map = new Map<
    string,
    { app_push: ContactPushChannelView[]; web_push: ContactPushChannelView[] }
  >();
  const ids = [...new Set(contactIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return map;

  /**
   * pushEndpoint.contact_id is stored as campaign bigint (e.g. "1832…").
   * Audience contacts use CDP ids (e.g. "CDP-campaign-org1001-1832…").
   * Index both so rows attach back to the requested key.
   */
  const requestIdsByCampaignId = new Map<string, string[]>();
  for (const id of ids) {
    map.set(id, empty());
    const campaignId = campaignContactId(id);
    if (!campaignId) continue;
    const list = requestIdsByCampaignId.get(campaignId) || [];
    list.push(id);
    requestIdsByCampaignId.set(campaignId, list);
  }

  try {
    const rows = await listPushEndpointsDao(session, {
      contactIds: ids,
      activeOnly: false,
    });
    for (const r of rows) {
      const stored = r.contact_id ? String(r.contact_id) : "";
      if (!stored) continue;
      const campaignId = campaignContactId(stored) || stored;
      const targetIds = requestIdsByCampaignId.get(campaignId) || [];
      // Fallback if caller requested the raw stored id and alias map missed it.
      const keys =
        targetIds.length > 0
          ? targetIds
          : map.has(stored)
            ? [stored]
            : map.has(campaignId)
              ? [campaignId]
              : [];
      if (!keys.length) continue;

      const view: ContactPushChannelView = {
        id: r.id,
        channel: r.channel,
        platform: r.platform,
        endpoint: r.endpoint,
        label: r.label,
        active: r.active,
        updated_at: r.updated_at,
      };

      for (const key of keys) {
        let bucket = map.get(key);
        if (!bucket) {
          bucket = empty();
          map.set(key, bucket);
        }
        if (r.channel === "push") bucket.app_push.push(view);
        else if (r.channel === "web") bucket.web_push.push(view);
      }
    }
  } catch {
    /* callers treat missing keys as empty */
  }

  return map;
}

/** List endpoints with contact name/email/phone for Configuration UI. */
export async function listPushEndpointsWithContactsDao(
  session: CampaignSessionUser,
  opts: { channel?: string; contactIds?: string[]; activeOnly?: boolean } = {},
) {
  const rows = await listPushEndpointsDao(session, opts);
  const contactIds = [
    ...new Set(rows.map((r) => r.contact_id).filter(Boolean) as string[]),
  ];
  const contactById = new Map<
    string,
    {
      id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      phone: string | null;
    }
  >();

  if (contactIds.length) {
    await Promise.all(
      contactIds.map(async (id) => {
        const c = await getContactByIdDao(session, id);
        if (c) {
          contactById.set(id, {
            id: c.id,
            first_name: c.first_name || "",
            last_name: c.last_name || "",
            email: c.email,
            phone: c.phone,
          });
        }
      }),
    );
  }

  return rows.map((r) => ({
    ...r,
    contact: r.contact_id ? contactById.get(r.contact_id) ?? null : null,
  }));
}

/** Soft-deactivate an app/web push endpoint for this tenant. */
export async function deactivatePushEndpointDao(
  session: CampaignSessionUser,
  endpointId: string,
) {
  const row = await prisma.pushEndpoint.findFirst({
    where: { id: endpointId, organizationId: campaignOrganizationId(session) },
  });
  if (!row) throw new AppError("Push endpoint not found.", 404);
  const updated = await prisma.pushEndpoint.update({
    where: { id: row.id },
    data: { active: false },
  });
  return {
    id: updated.id,
    active: updated.active,
    contact_id: updated.contactId,
  };
}

/**
 * Resolve contact (by id, or find/create from email/phone), then save device token.
 * Permanent mobile-app registration entry point.
 */
export async function registerAppPushDeviceDao(
  session: CampaignSessionUser,
  input: RegisterAppPushInput,
) {
  const endpoint = String(input.endpoint || "").trim();
  if (!endpoint) {
    throw new AppError("endpoint (device token) is required.", 400);
  }
  if (endpoint.startsWith("stub://")) {
    throw new AppError("Refuse to register stub:// destinations.", 400);
  }

  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  let contactId =
    typeof input.contactId === "string" && input.contactId.trim()
      ? input.contactId.trim()
      : null;
  let contactCreated = false;

  if (contactId) {
    const existing = await getContactByIdDao(session, contactId);
    if (!existing) {
      throw new AppError("contactId not found in Contacts.", 404);
    }
  } else {
    if (!email && !phone) {
      throw new AppError(
        "Provide email and/or phone to identify the contact.",
        400,
      );
    }
    const byEmail = email
      ? await findContactsByIdentityDao(session, { email })
      : [];
    const byPhone =
      !byEmail.length && phone
        ? await findContactsByIdentityDao(session, { phone })
        : [];
    const matches = byEmail.length ? byEmail : byPhone;
    if (matches.length) {
      contactId = matches[0]!.id;
    } else {
      try {
        const created = await createContactForIntegrationDao(session, {
          firstName: input.firstName?.trim() || "App",
          lastName: input.lastName?.trim() || "User",
          email,
          phone,
        });
        contactId = created.id;
        contactCreated = true;
      } catch (err) {
        const againEmail = email
          ? await findContactsByIdentityDao(session, { email })
          : [];
        const againPhone =
          !againEmail.length && phone
            ? await findContactsByIdentityDao(session, { phone })
            : [];
        const again = againEmail.length ? againEmail : againPhone;
        if (!again.length) throw err;
        contactId = again[0]!.id;
      }
    }
  }

  const row = await upsertPushEndpointDao(session, {
    channel: "push",
    endpoint,
    contactId,
    platform: input.platform?.trim() || "android",
    label: input.label?.trim() || null,
    active: input.active !== false,
  });

  const contact = await getContactByIdDao(session, contactId!);

  return {
    ...row,
    contact_created: contactCreated,
    contact: contact
      ? {
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          phone: contact.phone,
        }
      : { id: contactId },
    integration: {
      next: "Include this contact in a campaign audience, then launch App push.",
      register_path: "POST /api/app-push/endpoints",
    },
  };
}

/**
 * Resolve contact (by id, or find/create from email/phone), then save browser
 * PushSubscription (endpoint + p256dh/auth keys) for web push.
 */
export async function registerWebPushSubscriptionDao(
  session: CampaignSessionUser,
  input: RegisterWebPushInput,
) {
  const endpoint = String(input.endpoint || "").trim();
  if (!endpoint) {
    throw new AppError("endpoint (PushSubscription.endpoint) is required.", 400);
  }
  if (endpoint.startsWith("stub://")) {
    throw new AppError("Refuse to register stub:// destinations.", 400);
  }
  if (!/^https:\/\//i.test(endpoint)) {
    throw new AppError("Web push endpoint must be an https:// URL.", 400);
  }

  const p256dh = String(input.keys?.p256dh || "").trim();
  const auth = String(input.keys?.auth || "").trim();
  if (!p256dh || !auth) {
    throw new AppError(
      "keys.p256dh and keys.auth are required (from PushSubscription.getKey).",
      400,
    );
  }

  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  let contactId =
    typeof input.contactId === "string" && input.contactId.trim()
      ? input.contactId.trim()
      : null;
  let contactCreated = false;

  if (contactId) {
    const existing = await getContactByIdDao(session, contactId);
    if (!existing) {
      throw new AppError("contactId not found in Contacts.", 404);
    }
  } else {
    if (!email && !phone) {
      throw new AppError(
        "Provide email and/or phone to identify the contact.",
        400,
      );
    }
    const byEmail = email
      ? await findContactsByIdentityDao(session, { email })
      : [];
    const byPhone =
      !byEmail.length && phone
        ? await findContactsByIdentityDao(session, { phone })
        : [];
    const matches = byEmail.length ? byEmail : byPhone;
    if (matches.length) {
      contactId = matches[0]!.id;
    } else {
      try {
        const created = await createContactDao(session, {
          firstName: input.firstName?.trim() || "Web",
          lastName: input.lastName?.trim() || "Subscriber",
          email,
          phone,
        });
        contactId = created.id;
        contactCreated = true;
      } catch (err) {
        const againEmail = email
          ? await findContactsByIdentityDao(session, { email })
          : [];
        const againPhone =
          !againEmail.length && phone
            ? await findContactsByIdentityDao(session, { phone })
            : [];
        const again = againEmail.length ? againEmail : againPhone;
        if (!again.length) throw err;
        contactId = again[0]!.id;
      }
    }
  }

  const row = await upsertPushEndpointDao(session, {
    channel: "web",
    endpoint,
    contactId,
    platform: input.platform?.trim() || "browser",
    authKeys: { p256dh, auth },
    label: input.label?.trim() || null,
    active: input.active !== false,
  });

  const contact = await getContactByIdDao(session, contactId!);

  return {
    ...row,
    contact_created: contactCreated,
    contact: contact
      ? {
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          phone: contact.phone,
        }
      : { id: contactId },
    integration: {
      next: "Include this contact in a campaign audience, then launch Web push.",
      register_path: "POST /api/web-push/subscriptions",
    },
  };
}

/**
 * Website opt-in: copy the browser subscription onto an existing Audience
 * contact (email or phone). Does not create a new campaign contact.
 */
export async function attachWebPushToMatchingContactDao(
  session: CampaignSessionUser,
  input: {
    email?: string | null;
    phone?: string | null;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    platform?: string | null;
  },
): Promise<string | null> {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  if (!email && !phone) return null;

  let matches = email
    ? await findContactsByIdentityDao(session, { email })
    : [];
  if (!matches.length && phone) {
    matches = await findContactsByIdentityDao(session, { phone });
  }
  const contactId = matches[0]?.id;
  if (!contactId) return null;

  await upsertPushEndpointDao(session, {
    channel: "web",
    endpoint: input.endpoint,
    contactId,
    platform: input.platform?.trim() || "browser",
    authKeys: {
      p256dh: String(input.keys.p256dh || "").trim(),
      auth: String(input.keys.auth || "").trim(),
    },
    label: "website_subscribe",
    active: true,
  });
  return contactId;
}

/**
 * Destinations for audience: real (non-stub) endpoints only, matching
 * Configuration → Run test. Stub:// is invented only when allowStubAudience
 * is explicitly true (PUSH_FORCE_STUB for campaign launch).
 */
export async function resolvePushDestinationsDao(
  session: CampaignSessionUser,
  channel: AgentPushChannel,
  contactIds: string[],
  opts: { allowStubAudience: boolean },
) {
  const unique = [...new Set(contactIds.filter(Boolean))];
  if (!unique.length) return [];
  const existing = await listPushEndpointsDao(session, {
    channel,
    contactIds: unique.length ? unique : undefined,
    activeOnly: true,
  });

  const dests = existing
    .filter((e) => e.endpoint && !isStubPushDestination(e.endpoint))
    .map((e) => ({
      contactId: e.contact_id,
      destination: e.endpoint,
      platform: normalizeAppPushPlatform(e.platform, e.endpoint),
      authKeys: e.auth_keys,
    }));

  const covered = new Set(
    dests.map((d) => d.contactId).filter((id): id is string => Boolean(id)),
  );
  const missing = unique.filter((id) => !covered.has(id));

  if (channel === "web" && missing.length) {
    const summaries = await listContactSummariesByIdsDao(session, missing);
    const fromSite = await findWebsiteWebPushDestinationsDao(
      session.organizationId,
      summaries,
    );
    for (const d of fromSite) {
      dests.push(d);
    }
  }

  if (dests.length) return dests;

  if (!opts.allowStubAudience || !unique.length) {
    return [];
  }

  return unique.map((contactId) => ({
    contactId,
    destination: `stub://${channel}/${contactId}`,
    platform: channel === "push" ? "stub_app" : "stub_web",
    authKeys: null as unknown,
  }));
}

export type PushTestByEmailDest = {
  contactId: string;
  contactEmail: string;
  destination: string;
  platform: string | null;
  authKeys: Record<string, unknown> | null;
};

/**
 * Config Run test: look up a contact by email, then the same destination
 * path as a campaign (push_endpoints, then website opt-in for web).
 */
export async function resolvePushTestByEmailDao(
  session: CampaignSessionUser,
  args: { email: string; channel: AgentPushChannel },
): Promise<PushTestByEmailDest> {
  const email = String(args.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new AppError("Enter a valid contact email.", 400);
  }

  const matches = await findContactsByIdentityDao(session, { email });
  const contact = matches[0];
  if (!contact) {
    throw new AppError(
      `No contact with email ${email} in this organization.`,
      404,
    );
  }

  const dests = await resolvePushDestinationsDao(
    session,
    args.channel,
    [contact.id],
    { allowStubAudience: false },
  );
  const dest = dests.find((d) => d.destination && !isStubPushDestination(d.destination));
  if (!dest) {
    throw new AppError(
      args.channel === "web"
        ? `Contact ${email} has no Web push subscription. Opt in on the site with this email, then retry.`
        : `Contact ${email} has no App push device token.`,
      400,
    );
  }

  const authKeys =
    dest.authKeys && typeof dest.authKeys === "object"
      ? (dest.authKeys as Record<string, unknown>)
      : null;

  return {
    contactId: dest.contactId || contact.id,
    contactEmail: (contact.email || email).trim().toLowerCase(),
    destination: dest.destination,
    platform: dest.platform || null,
    authKeys,
  };
}
