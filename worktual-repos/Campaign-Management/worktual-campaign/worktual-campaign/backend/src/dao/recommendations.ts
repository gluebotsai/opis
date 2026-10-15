// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Tenant-scoped recommendation cards. JWT tenant wins; body never sets tenant.
 */

import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";

const MAX_CARDS = 100;
const MAX_PAYLOAD_CHARS = 180_000;
const PUBLIC_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const STATUSES = new Set([
  "creating",
  "active",
  "dismissed",
  "used",
  "expired",
  "deleted",
]);

export type RecommendationCard = Record<string, unknown> & {
  id: string;
  title: string;
  status: string;
};

type SanitizedCard = {
  publicId: string;
  title: string;
  status: string;
  payload: RecommendationCard;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function capArray<T>(rows: T[] | undefined, max: number): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.length > max ? rows.slice(-max) : rows;
}

function sanitizeCard(raw: unknown): SanitizedCard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const publicId = String(o.id || o.publicId || "").trim();
  if (!PUBLIC_ID_RE.test(publicId)) return null;
  const title = String(o.title || "Untitled recommendation").trim().slice(0, 240);
  let status = String(o.status || "active").trim();
  if (!STATUSES.has(status)) status = "active";

  const payload: RecommendationCard = {
    ...o,
    id: publicId,
    title: title || "Untitled recommendation",
    status,
  };
  delete payload.contactIds;
  delete payload.contacts;
  delete payload.emails;
  delete payload.phones;
  delete payload.cdpIds;
  payload.chatMessages = capArray(
    payload.chatMessages as unknown[] | undefined,
    80,
  );
  payload.editLog = capArray(payload.editLog as unknown[] | undefined, 40);

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    payload.chatMessages = capArray(
      payload.chatMessages as unknown[] | undefined,
      20,
    );
    serialized = JSON.stringify(payload);
    if (serialized.length > MAX_PAYLOAD_CHARS) return null;
  }

  return {
    publicId,
    title: payload.title,
    status,
    payload: JSON.parse(serialized) as RecommendationCard,
  };
}

function toCard(row: {
  publicId: string;
  title: string;
  status: string;
  payload: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}): RecommendationCard {
  const payload = asObject(row.payload);
  const createdAt =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : payload.createdAt || new Date().toISOString();
  const updatedAt =
    row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : payload.updatedAt || new Date().toISOString();
  return {
    ...payload,
    id: row.publicId,
    title: String(payload.title || row.title || "Untitled recommendation"),
    status: String(payload.status || row.status || "active"),
    createdAt,
    updatedAt,
  };
}

function suggestedLaunchMs(payload: Record<string, unknown>): number | null {
  const at = payload.suggestedLaunchAt || payload.suggested_launch_at;
  if (!at) return null;
  const ms = Date.parse(String(at));
  return Number.isNaN(ms) ? null : ms;
}

async function expireDueRows(
  session: CampaignSessionUser,
  rows: Array<{
    id: string;
    publicId: string;
    title: string;
    status: string;
    payload: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>,
) {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const out = [];
  for (const row of rows) {
    const payload = asObject(row.payload);
    const status = String(row.status || payload.status || "active");
    if (status === "used" || status === "deleted") {
      out.push(row);
      continue;
    }
    const launchMs = suggestedLaunchMs(payload);
    if (launchMs == null || launchMs > now) {
      out.push(row);
      continue;
    }
    const nextPayload = { ...payload, status: "deleted", updatedAt: iso };
    try {
      const updated = await prisma.campaignRecommendation.update({
        where: { id: row.id },
        data: { status: "deleted", payload: nextPayload },
      });
      out.push(updated);
    } catch {
      out.push({ ...row, status: "deleted", payload: nextPayload });
    }
  }
  return out;
}

export async function listRecommendationsDao(
  session: CampaignSessionUser,
): Promise<RecommendationCard[]> {
  const rows = await prisma.campaignRecommendation.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { updatedAt: "desc" },
    take: MAX_CARDS * 2,
  });
  const next = await expireDueRows(session, rows);
  return next.map(toCard);
}

export async function putRecommendationsDao(
  session: CampaignSessionUser,
  input: { cards: unknown[]; replaceActive?: boolean },
): Promise<RecommendationCard[]> {
  const sanitized: SanitizedCard[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(input.cards) ? input.cards : []) {
    if (sanitized.length >= MAX_CARDS) break;
    const card = sanitizeCard(raw);
    if (!card || seen.has(card.publicId)) continue;
    seen.add(card.publicId);
    sanitized.push(card);
  }

  const replaceActive = Boolean(input.replaceActive) && sanitized.length > 0;
  const nowIso = new Date().toISOString();

  await prisma.$transaction(async (tx) => {
    for (const card of sanitized) {
      await tx.campaignRecommendation.upsert({
        where: {
          organizationId_publicId: {
            organizationId: session.organizationId,
            publicId: card.publicId,
          },
        },
        create: {
          organizationId: session.organizationId,
          branchId: session.branchId,
          createdByUserId: session.id,
          publicId: card.publicId,
          status: card.status,
          title: card.title,
          payload: card.payload,
        },
        update: {
          branchId: session.branchId,
          status: card.status,
          title: card.title,
          payload: card.payload,
        },
      });
    }

    if (!replaceActive) return;
    const keep = sanitized.map((c) => c.publicId);
    const others = await tx.campaignRecommendation.findMany({
      where: {
        organizationId: session.organizationId,
        status: { in: ["active", "creating"] },
        publicId: { notIn: keep },
      },
    });
    for (const row of others) {
      const payload = {
        ...asObject(row.payload),
        status: "deleted",
        updatedAt: nowIso,
      };
      await tx.campaignRecommendation.update({
        where: { id: row.id },
        data: { status: "deleted", payload },
      });
    }
  });

  return listRecommendationsDao(session);
}
