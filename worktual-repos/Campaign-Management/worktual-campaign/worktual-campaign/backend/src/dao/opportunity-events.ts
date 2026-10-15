// @ts-nocheck — Prisma BigInt ids; runtime coerced in plugins/prisma.ts
/**
 * Tenant-scoped opportunity / events (forms, etc.). JWT tenant wins.
 */

import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";

const MAX_EVENTS = 200;
const MAX_PAYLOAD_CHARS = 120_000;
const PUBLIC_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

let loggedMissingOpportunityTables = false;

function isMissingOpportunityTable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2021"
  );
}

function warnMissingOpportunityTablesOnce(): void {
  if (loggedMissingOpportunityTables) return;
  loggedMissingOpportunityTables = true;
  console.warn(
    "[opportunity-events] DB tables missing — run: npx prisma migrate deploy",
  );
}

export type OpportunityEventPayload = Record<string, unknown> & {
  id: string;
  kind: string;
  title: string;
  status: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function sanitizeEvent(raw: unknown): OpportunityEventPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const publicId = String(o.id || o.publicId || "").trim();
  if (!PUBLIC_ID_RE.test(publicId)) return null;
  const kind = String(o.kind || "form").trim().slice(0, 40);
  let status = String(o.status || "draft").trim();
  if (!["draft", "planned", "active", "ended"].includes(status)) {
    status = "draft";
  }
  const title = String(o.title || "Untitled event").trim().slice(0, 240);
  const payload: OpportunityEventPayload = {
    ...o,
    id: publicId,
    kind,
    status,
    title: title || "Untitled event",
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (serialized.length > MAX_PAYLOAD_CHARS) return null;
  return JSON.parse(serialized) as OpportunityEventPayload;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : new Date(ms);
}

function toEvent(row: {
  publicId: string;
  kind: string;
  status: string;
  title: string;
  publicSlug: string | null;
  launchedAt: Date | null;
  submissionCount: number;
  openCount: number;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): OpportunityEventPayload {
  const payload = asObject(row.payload);
  const createdAt = row.createdAt.toISOString();
  const updatedAt = row.updatedAt.toISOString();
  return {
    ...payload,
    id: row.publicId,
    kind: String(payload.kind || row.kind || "form"),
    title: String(payload.title || row.title || "Untitled event"),
    status: String(payload.status || row.status || "draft"),
    publicSlug: row.publicSlug ?? payload.publicSlug ?? null,
    launchedAt:
      row.launchedAt?.toISOString() ??
      (typeof payload.launchedAt === "string" ? payload.launchedAt : null),
    submissionCount: row.submissionCount ?? payload.submissionCount ?? 0,
    openCount: row.openCount ?? payload.openCount ?? 0,
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : createdAt,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : updatedAt,
  };
}

export async function listOpportunityEventsDao(
  session: CampaignSessionUser,
): Promise<OpportunityEventPayload[]> {
  try {
    const rows = await prisma.campaignOpportunityEvent.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { updatedAt: "desc" },
      take: MAX_EVENTS,
    });
    return rows.map(toEvent);
  } catch (err) {
    if (isMissingOpportunityTable(err)) {
      warnMissingOpportunityTablesOnce();
      return [];
    }
    throw err;
  }
}

export async function putOpportunityEventsDao(
  session: CampaignSessionUser,
  input: { events: unknown[] },
): Promise<OpportunityEventPayload[]> {
  const sanitized: OpportunityEventPayload[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(input.events) ? input.events : []) {
    if (sanitized.length >= MAX_EVENTS) break;
    const ev = sanitizeEvent(raw);
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    sanitized.push(ev);
  }

  await prisma.$transaction(async (tx) => {
    for (const ev of sanitized) {
      const slugRaw = ev.publicSlug;
      const publicSlug =
        typeof slugRaw === "string" && slugRaw.trim()
          ? slugRaw.trim().toLowerCase().slice(0, 80)
          : null;
      const launchedAt = parseDate(ev.launchedAt);
      const submissionCount = Number(ev.submissionCount) || 0;
      const openCount = Number(ev.openCount) || 0;
      await tx.campaignOpportunityEvent.upsert({
        where: {
          organizationId_publicId: {
            organizationId: session.organizationId,
            publicId: ev.id,
          },
        },
        create: {
          organizationId: session.organizationId,
          branchId: session.branchId,
          createdByUserId: session.id,
          publicId: ev.id,
          kind: String(ev.kind || "form"),
          status: String(ev.status || "draft"),
          title: String(ev.title || "Untitled event"),
          publicSlug,
          launchedAt,
          submissionCount,
          openCount,
          payload: ev,
        },
        update: {
          branchId: session.branchId,
          kind: String(ev.kind || "form"),
          status: String(ev.status || "draft"),
          title: String(ev.title || "Untitled event"),
          publicSlug,
          launchedAt,
          submissionCount,
          openCount,
          payload: ev,
        },
      });
    }
  });

  return listOpportunityEventsDao(session);
}

export async function deleteOpportunityEventDao(
  session: CampaignSessionUser,
  publicId: string,
): Promise<boolean> {
  const id = String(publicId || "").trim();
  if (!PUBLIC_ID_RE.test(id)) return false;
  const row = await prisma.campaignOpportunityEvent.findFirst({
    where: { organizationId: session.organizationId, publicId: id },
  });
  if (!row) return false;
  await prisma.campaignOpportunityEvent.delete({ where: { id: row.id } });
  return true;
}

export async function getOpportunityEventBySlugDao(
  slug: string,
): Promise<(OpportunityEventPayload & { organizationId?: string }) | null> {
  const key = String(slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  if (!key) return null;
  const row = await prisma.campaignOpportunityEvent.findFirst({
    where: { publicSlug: key, status: { not: "ended" } },
  });
  if (!row) return null;
  return {
    ...toEvent(row),
    organizationId: String(row.organizationId),
  };
}

export async function upsertPublicFormFromPublishDao(
  session: CampaignSessionUser,
  record: {
    id: string;
    slug: string;
    title: string;
    description: string;
    thankYouMessage: string;
    status: string;
    formFields: unknown[];
    theme: Record<string, unknown>;
    publishedAt: string;
    updatedAt: string;
  },
): Promise<void> {
  const slug = record.slug.trim().toLowerCase();
  const payload: OpportunityEventPayload = {
    id: record.id,
    kind: "form",
    title: record.title,
    description: record.description,
    status: record.status === "ended" ? "ended" : "active",
    startsAt: record.publishedAt,
    endsAt: null,
    publicSlug: slug,
    formFields: record.formFields,
    thankYouMessage: record.thankYouMessage,
    theme: record.theme,
    launchedAt: record.publishedAt,
    submissionCount: 0,
    openCount: 0,
    createdAt: record.publishedAt,
    updatedAt: record.updatedAt,
  };
  const existing = await prisma.campaignOpportunityEvent.findFirst({
    where: {
      organizationId: session.organizationId,
      publicId: record.id,
    },
  });
  const launchedAt = parseDate(record.publishedAt);
  if (existing) {
    await prisma.campaignOpportunityEvent.update({
      where: { id: existing.id },
      data: {
        publicSlug: slug,
        status: payload.status as string,
        title: payload.title as string,
        launchedAt,
        payload,
      },
    });
    return;
  }
  await prisma.campaignOpportunityEvent.create({
    data: {
      organizationId: session.organizationId,
      branchId: session.branchId,
      createdByUserId: session.id,
      publicId: record.id,
      kind: "form",
      status: String(payload.status),
      title: String(payload.title),
      publicSlug: slug,
      launchedAt,
      payload,
    },
  });
}

export async function bumpOpportunityOpenBySlugDao(slug: string): Promise<void> {
  const key = String(slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  if (!key) return;
  const row = await prisma.campaignOpportunityEvent.findFirst({
    where: { publicSlug: key },
  });
  if (!row) return;
  await prisma.campaignOpportunityEvent.update({
    where: { id: row.id },
    data: { openCount: { increment: 1 } },
  });
}

export async function bumpOpportunitySubmissionByEventIdDao(
  eventPublicId: string,
): Promise<void> {
  const id = String(eventPublicId || "").trim();
  if (!PUBLIC_ID_RE.test(id)) return;
  const row = await prisma.campaignOpportunityEvent.findFirst({
    where: { publicId: id },
  });
  if (!row) return;
  await prisma.campaignOpportunityEvent.update({
    where: { id: row.id },
    data: { submissionCount: { increment: 1 } },
  });
}

export type FormSubmissionRecord = {
  id: string;
  formId: string;
  formSlug: string;
  answers: Record<string, string>;
  fields: Record<string, string>;
  createdAt: string;
};

function mapSubmissionRow(row: {
  publicReplyId: string;
  eventPublicId: string;
  formSlug: string;
  answers: unknown;
  fields: unknown;
  createdAt: Date;
}): FormSubmissionRecord {
  const answers =
    row.answers && typeof row.answers === "object" && !Array.isArray(row.answers)
      ? (row.answers as Record<string, string>)
      : {};
  const fields =
    row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)
      ? (row.fields as Record<string, string>)
      : {};
  return {
    id: row.publicReplyId,
    formId: row.eventPublicId,
    formSlug: row.formSlug,
    answers,
    fields,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function addFormSubmissionDao(input: {
  organizationId: bigint;
  eventPublicId: string;
  formSlug: string;
  reply: {
    id: string;
    answers: Record<string, string>;
    fields: Record<string, string>;
    createdAt: string;
  };
}): Promise<FormSubmissionRecord> {
  const slug = input.formSlug.trim().toLowerCase().slice(0, 80);
  const replyId = String(input.reply.id || "").trim();
  if (!PUBLIC_ID_RE.test(input.eventPublicId) || !replyId) {
    throw new Error("Invalid form submission");
  }
  try {
    await prisma.campaignFormSubmission.create({
      data: {
        organizationId: input.organizationId,
        eventPublicId: input.eventPublicId,
        formSlug: slug,
        publicReplyId: replyId,
        answers: input.reply.answers,
        fields: input.reply.fields,
        createdAt: new Date(input.reply.createdAt),
      },
    });
  } catch (err: unknown) {
    const code =
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code;
    if (code !== "P2002") throw err;
    const existing = await prisma.campaignFormSubmission.findUnique({
      where: { publicReplyId: replyId },
    });
    if (!existing) throw err;
    return mapSubmissionRow(existing);
  }
  await bumpOpportunitySubmissionByEventIdDao(input.eventPublicId);
  const row = await prisma.campaignFormSubmission.findUnique({
    where: { publicReplyId: replyId },
  });
  if (!row) {
    return {
      id: replyId,
      formId: input.eventPublicId,
      formSlug: slug,
      answers: input.reply.answers,
      fields: input.reply.fields,
      createdAt: input.reply.createdAt,
    };
  }
  return mapSubmissionRow(row);
}

const AGENT_SNAPSHOT_SUBMISSION_LIMIT = 500;

function isLaunchedEvent(ev: OpportunityEventPayload): boolean {
  const launchedAt =
    typeof ev.launchedAt === "string" ? ev.launchedAt.trim() : "";
  const status = String(ev.status || "").trim();
  return Boolean(launchedAt) || status === "active" || status === "ended";
}

function isDraftEvent(ev: OpportunityEventPayload): boolean {
  const launchedAt =
    typeof ev.launchedAt === "string" ? ev.launchedAt.trim() : "";
  const status = String(ev.status || "").trim();
  return !launchedAt && (status === "draft" || status === "planned");
}

export async function listFormSubmissionsForOrgDao(
  session: CampaignSessionUser,
  limit = AGENT_SNAPSHOT_SUBMISSION_LIMIT,
): Promise<FormSubmissionRecord[]> {
  try {
    const rows = await prisma.campaignFormSubmission.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(mapSubmissionRow);
  } catch (err) {
    if (isMissingOpportunityTable(err)) {
      warnMissingOpportunityTablesOnce();
      return [];
    }
    throw err;
  }
}

/** Agent join payload — tenant DB (parity with SPA events snapshot). */
export async function getAgentEventsSnapshotDao(
  session: CampaignSessionUser,
): Promise<Record<string, unknown>> {
  const all = await listOpportunityEventsDao(session);
  const launched = all.filter(isLaunchedEvent);
  const drafts = all.filter(isDraftEvent);
  const submissions = await listFormSubmissionsForOrgDao(session);
  return {
    launched,
    drafts,
    submissions: submissions.map((s) => ({
      id: s.id,
      formId: s.formId,
      formSlug: s.formSlug,
      answers: s.answers,
      createdAt: s.createdAt,
    })),
    captured_at: new Date().toISOString(),
    source: "server",
  };
}

export async function listFormSubmissionsBySlugDao(
  slug: string,
  limit = 500,
): Promise<FormSubmissionRecord[]> {
  const key = String(slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  if (!key) return [];
  const rows = await prisma.campaignFormSubmission.findMany({
    where: { formSlug: key },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapSubmissionRow);
}
