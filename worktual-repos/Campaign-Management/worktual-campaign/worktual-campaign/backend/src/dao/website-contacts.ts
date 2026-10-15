// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { randomUUID } from "node:crypto";
import { prisma } from "../plugins/prisma.js";
import { AppError } from "../helpers/response-builders.js";
import { toStableDbId } from "../helpers/id-schema.js";
import type { Prisma } from "@prisma/client";
import { emailsMatch, phonesMatch, titleCasePersonName } from "../helpers/contact-validation.js";
import { normalizeSiteOrigin } from "./push-config.js";

export type WebsiteContactView = {
  id: string;
  visitor_id: string;
  contact_id: string | null;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  origin: string;
  path: string | null;
  subscribed: boolean;
  visit_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  subscribed_at: string | null;
};

function clip(raw: string | null | undefined, max: number): string {
  return String(raw || "").trim().slice(0, max);
}

export function normalizeVisitorId(raw: string | null | undefined): string {
  const id = clip(raw, 80);
  return id || randomUUID();
}

function toView(row: {
  id: unknown;
  visitorId: string;
  contactId: unknown;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  origin: string;
  path: string | null;
  subscribed: boolean;
  visitCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  subscribedAt: Date | null;
}): WebsiteContactView {
  return {
    id: String(row.id),
    visitor_id: row.visitorId,
    contact_id: row.contactId == null ? null : String(row.contactId),
    email: row.email,
    phone: row.phone,
    first_name: row.firstName ? titleCasePersonName(row.firstName) : row.firstName,
    last_name: row.lastName ? titleCasePersonName(row.lastName) : row.lastName,
    origin: row.origin,
    path: row.path,
    subscribed: row.subscribed,
    visit_count: row.visitCount,
    first_seen_at: row.firstSeenAt?.toISOString() ?? null,
    last_seen_at: row.lastSeenAt?.toISOString() ?? null,
    subscribed_at: row.subscribedAt?.toISOString() ?? null,
  };
}

export async function recordWebsiteVisitDao(input: {
  organizationId: string;
  visitorId?: string | null;
  origin?: string | null;
  path?: string | null;
  userAgent?: string | null;
}): Promise<WebsiteContactView> {
  const organizationId = toStableDbId(input.organizationId);
  const visitorId = normalizeVisitorId(input.visitorId);
  const origin = normalizeSiteOrigin(input.origin);
  const path = clip(input.path, 500) || "/";
  const userAgent = clip(input.userAgent, 512) || null;
  const now = new Date();

  const row = await prisma.websiteContact.upsert({
    where: { organizationId_visitorId: { organizationId, visitorId } },
    create: { organizationId,
      visitorId,
      origin,
      path,
      userAgent,
      visitCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      visitCount: { increment: 1 },
      lastSeenAt: now,
      ...(origin ? { origin } : {}),
      path,
      ...(userAgent ? { userAgent } : {}),
    },
  });
  return toView(row);
}

export async function recordWebsiteSubscribeDao(input: {
  organizationId: string;
  visitorId?: string | null;
  origin?: string | null;
  path?: string | null;
  userAgent?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform?: string | null;
}): Promise<{ created: boolean; contact: WebsiteContactView }> {
  const organizationId = toStableDbId(input.organizationId);
  const visitorId = normalizeVisitorId(input.visitorId);
  const origin = normalizeSiteOrigin(input.origin);
  const path = clip(input.path, 500) || "/";
  const userAgent = clip(input.userAgent, 512) || null;
  const email = clip(input.email, 254).toLowerCase() || null;
  const phone = clip(input.phone, 32) || null;
  const firstName = titleCasePersonName(clip(input.firstName, 80)) || null;
  const lastName = titleCasePersonName(clip(input.lastName, 80)) || null;
  const endpoint = String(input.endpoint || "").trim();
  const p256dh = String(input.keys?.p256dh || "").trim();
  const auth = String(input.keys?.auth || "").trim();

  if (!endpoint) {
    throw new AppError("endpoint (PushSubscription.endpoint) is required.", 400);
  }
  if (endpoint.startsWith("stub://")) {
    throw new AppError("Refuse to register stub:// destinations.", 400);
  }
  if (!/^https:\/\//i.test(endpoint)) {
    throw new AppError("Web push endpoint must be an https:// URL.", 400);
  }
  if (!p256dh || !auth) {
    throw new AppError(
      "keys.p256dh and keys.auth are required (from PushSubscription.getKey).",
      400,
    );
  }

  const now = new Date();
  const authKeys = { p256dh, auth } as Prisma.InputJsonValue;
  const existing = await prisma.websiteContact.findUnique({
    where: { organizationId_visitorId: { organizationId, visitorId } },
  });

  if (existing) {
    const row = await prisma.websiteContact.update({
      where: { id: existing.id },
      data: {
        email: email || existing.email,
        phone: phone || existing.phone,
        firstName: firstName || existing.firstName,
        lastName: lastName || existing.lastName,
        origin: origin || existing.origin,
        path,
        ...(userAgent ? { userAgent } : {}),
        subscribed: true,
        subscribedAt: existing.subscribedAt || now,
        endpoint,
        authKeys,
        platform: clip(input.platform, 40) || "browser",
        lastSeenAt: now,
      },
    });
    return { created: false, contact: toView(row) };
  }

  const row = await prisma.websiteContact.create({
    data: { organizationId,
      visitorId,
      email,
      phone,
      firstName,
      lastName,
      origin,
      path,
      userAgent,
      subscribed: true,
      subscribedAt: now,
      endpoint,
      authKeys,
      platform: clip(input.platform, 40) || "browser",
      visitCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
  return { created: true, contact: toView(row) };
}

export async function stampWebsiteContactAudienceIdDao(
  websiteContactId: string,
  audienceContactId: string,
): Promise<void> {
  const id = toStableDbId(String(websiteContactId || "").trim());
  const contactId = toStableDbId(String(audienceContactId || "").trim());
  if (!id || !contactId) return;
  await prisma.websiteContact.update({
    where: { id },
    data: { contactId },
  });
}

export type WebsitePushDest = {
  contactId: string;
  destination: string;
  platform: string | null;
  authKeys: Record<string, unknown> | null;
};

/**
 * Match Audience contacts to website opt-ins by email or phone.
 * Does not create CDP contacts. Stamps contact_id on a match.
 */
export async function findWebsiteWebPushDestinationsDao(
  organizationIdRaw: string,
  contacts: Array<{
    contactId: string;
    email: string | null;
    phone: string | null;
  }>,
): Promise<WebsitePushDest[]> {
  const organizationId = toStableDbId(organizationIdRaw);
  const needed = contacts.filter((c) => c.contactId && (c.email || c.phone));
  if (!needed.length) return [];

  const rows = await prisma.websiteContact.findMany({
    where: { organizationId,
      subscribed: true,
      endpoint: { startsWith: "https://" },
    },
    orderBy: { subscribedAt: "desc" },
    take: 5000,
  });

  const usedEndpoints = new Set<string>();
  const usedRowIds = new Set<string>();
  const out: WebsitePushDest[] = [];

  for (const contact of needed) {
    const hit = rows.find((r) => {
      const id = String(r.id);
      const endpoint = String(r.endpoint || "").trim();
      if (usedRowIds.has(id) || usedEndpoints.has(endpoint)) return false;
      if (!endpoint || !/^https:\/\//i.test(endpoint)) return false;
      const keys =
        r.authKeys && typeof r.authKeys === "object"
          ? (r.authKeys as Record<string, unknown>)
          : {};
      if (!keys.p256dh || !keys.auth) return false;
      const emailOk = Boolean(contact.email && r.email && emailsMatch(contact.email, r.email));
      const phoneOk = Boolean(contact.phone && r.phone && phonesMatch(contact.phone, r.phone));
      return emailOk || phoneOk;
    });
    if (!hit) continue;
    const endpoint = String(hit.endpoint || "").trim();
    usedRowIds.add(String(hit.id));
    usedEndpoints.add(endpoint);
    const keys =
      hit.authKeys && typeof hit.authKeys === "object"
        ? (hit.authKeys as Record<string, unknown>)
        : {};
    out.push({
      contactId: contact.contactId,
      destination: endpoint,
      platform: hit.platform || "browser",
      authKeys: keys,
    });
    if (!hit.contactId) {
      try {
        await prisma.websiteContact.update({
          where: { id: hit.id },
          data: { contactId: contact.contactId },
        });
      } catch {
        /* lookup still works by email/phone */
      }
    }
  }

  return out;
}

export async function loadWebsiteWebPushAuthKeysDao(
  organizationIdRaw: string,
  endpoint: string,
): Promise<Record<string, unknown> | null> {
  const dest = String(endpoint || "").trim();
  if (!dest) return null;
  const row = await prisma.websiteContact.findFirst({
    where: {
      organizationId: toStableDbId(organizationIdRaw),
      subscribed: true,
      endpoint: dest,
    },
    select: { authKeys: true },
  });
  if (row?.authKeys && typeof row.authKeys === "object") {
    return row.authKeys as Record<string, unknown>;
  }
  return null;
}
