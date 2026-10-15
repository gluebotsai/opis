/**
 * Sales guide for one lead. The model writes the questions, disposition,
 * next action, follow-up, and objection reply. This file loads the CRM
 * facts, clamps the answer, and writes only when a person accepts.
 */

import { isModuleEnabledForAccess, isModuleEnabledForType } from "@/config/modules";
import { listContactActivities } from "@/dao/contacts/contact-activity-service";
import { prisma } from "@/dao/db/prisma";
import { findScoringJobByContactId } from "@/dao/ai/lead-scoring-store";
import { getContact, type ContactView } from "@/dao/contacts/contact-service";
import { listDealsForContact } from "@/dao/sales/deal-service";
import { showConvertLeadCta } from "@/lib/business-type-copy";
import { getServerUserId } from "@/service/account/session-cookie";
import type { LeadStatus } from "@/service/account/types";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { loadOmniChannelSummary } from "@/service/ai/lead-summary-agent";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import {
  ForbiddenError,
  getCurrentBusinessType,
  getCurrentUserRole,
  requireRole,
} from "@/service/auth/require-role";
import { canEditContacts } from "@/service/auth/rbac";
import { createActivityCommand } from "@/service/contacts/contact-commands";

const DISPOSITIONS = new Set<LeadStatus>([
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "disqualified",
]);
const ACTIONS = new Set([
  "email",
  "call",
  "meeting",
  "sms",
  "task",
  "note",
  "quote",
  "proposal",
  "deal",
  "view_deal",
  "order",
]);
const NEEDS_MESSAGE = new Set(["email", "sms", "note"]);
const CHANNELS = new Set(["email", "call", "meeting", "sms"]);
const OBJECTION_KINDS = new Set(["price", "timing", "competitor", "authority"]);

export type SalesObjection = {
  kind: "price" | "timing" | "competitor" | "authority";
  customerLine: string;
  reply: string;
  proofPoint: string | null;
  question: string | null;
};

type GuideAction = { title: string; detail: string; dueInDays: number };
type GuideCta = {
  kind: string;
  subject: string;
  message: string;
  dueInDays: number;
  dealId: string | null;
};

function text(value: unknown, limit: number): string {
  return String(value ?? "").trim().slice(0, limit);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function loadLead(contactId: string) {
  const contact = await getContact(contactId);
  if (!contact) return { ok: false as const, error: "Contact not found.", status: 404 };
  try {
    await assertRecordAccess(
      contact.crm.ownerUserId,
      undefined,
      contact.person.companyId,
      contact.crm.createdByUserId,
    );
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false as const, error: err.message, status: 403 };
    }
    throw err;
  }
  return { ok: true as const, contact };
}

function interactionSnippet(raw: string | null | undefined, limit = 360): string {
  return String(raw ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

async function guideFacts(contactId: string, contact: ContactView) {
  const person = contact.person;
  const [activities, deals, scoreJob, omni, businessType, role] = await Promise.all([
    listContactActivities(contactId, 20).catch(() => []),
    listDealsForContact(contactId, person.convertedDealId).catch(() => []),
    findScoringJobByContactId(contactId).catch(() => null),
    loadOmniChannelSummary(contactId).catch(() => null),
    getCurrentBusinessType().catch(() => "b2b" as const),
    getCurrentUserRole().catch(() => null),
  ]);
  const openDeals = deals
    .filter((deal) => !/closed|won|lost|cancel/i.test(deal.stage))
    .slice(0, 3);
  const dealLine = openDeals
    .map((deal) => `${deal.title} (${deal.stage})`)
    .join("; ");
  const recent = activities
    .filter((row) =>
      row.type === "email" ||
      row.type === "call" ||
      row.type === "meeting" ||
      row.type === "sms" ||
      row.type === "note",
    )
    .slice(0, 8)
    .map((row) => {
      const direction = row.emailDirection ? ` ${row.emailDirection}` : "";
      const said = interactionSnippet(row.transcriptText || row.body);
      const subject = interactionSnippet(row.subject, 160);
      return [
        `${row.type}${direction} · ${row.createdAt.slice(0, 10)} · ${subject || "no subject"}`,
        said ? `Said: ${said}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const tasks = activities
    .filter((row) => row.type === "task")
    .slice(0, 5)
    .map((row) => `${row.subject} · ${row.taskStatus ?? "open"}`)
    .join("; ");
  const hasEmail = Boolean(person.email?.trim());
  const hasPhone = Boolean(person.phone?.trim());
  const showSales = role ? isModuleEnabledForAccess("sales", businessType, role) : false;
  const showCommerce = isModuleEnabledForType("commerce", businessType);
  const primaryDeal = openDeals[0] ?? null;
  const canConvert =
    showConvertLeadCta(businessType) &&
    person.contactType === "lead" &&
    person.leadStatus === "qualified" &&
    !primaryDeal;
  const availableActions = [
    hasEmail ? "email" : "",
    hasPhone ? "call" : "",
    "meeting",
    hasPhone ? "sms" : "",
    "task",
    "note",
    showSales && primaryDeal ? "quote" : "",
    showSales && primaryDeal ? "proposal" : "",
    canConvert ? "deal" : "",
    primaryDeal ? "view_deal" : "",
    showCommerce ? "order" : "",
  ].filter(Boolean);
  return {
    displayName: [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email,
    title: person.title ?? null,
    companyName: person.company?.name ?? null,
    industry: person.company?.industry ?? null,
    country: person.country ?? null,
    leadStatus: person.leadStatus,
    score: scoreJob?.score ?? null,
    deals: dealLine || "none",
    dealId: primaryDeal?.id ?? null,
    activities: recent || "none",
    omniChannelSummary: interactionSnippet(omni, 900) || null,
    tasks: tasks || "none",
    availableActions,
    ownerUserId: person.ownerUserId ?? null,
  };
}

function clampGuide(raw: Record<string, unknown>, allowed: Set<string>, dealId: string | null) {
  const suggestions: string[] = [];
  for (const item of Array.isArray(raw.suggestions) ? raw.suggestions : []) {
    const line = text(item, 400);
    if (line.length < 8) continue;
    suggestions.push(line);
    if (suggestions.length === 4) break;
  }
  const actionRow = asRecord(raw.nextBestAction);
  const title = text(actionRow?.title, 160);
  const detail = text(actionRow?.detail, 800);
  const due = Number(actionRow?.dueInDays);
  const nextBestAction: GuideAction | null =
    title && detail
      ? { title, detail, dueInDays: Number.isFinite(due) ? Math.max(1, Math.min(14, Math.trunc(due))) : 2 }
      : null;
  const chosen = asRecord(raw.action);
  let kind = text(chosen?.kind, 32);
  const subject = text(chosen?.subject, 160);
  const message = text(chosen?.message, 1200);
  if (kind === "email" && !subject) kind = "";
  if (NEEDS_MESSAGE.has(kind) && !message) kind = "";
  const actionDue = Number(chosen?.dueInDays);
  const action: GuideCta | null =
    ACTIONS.has(kind) && allowed.has(kind)
      ? {
          kind,
          subject,
          message,
          dueInDays: Number.isFinite(actionDue) ? Math.max(1, Math.min(21, Math.trunc(actionDue))) : 2,
          dealId,
        }
      : null;
  return { suggestions, nextBestAction, action };
}

async function existingGuideActivity(
  contactId: string,
  type: "task" | "note" | "email" | "call" | "meeting" | "sms",
  subject: string,
) {
  return prisma.contactActivity.findFirst({
    where: {
      contactId,
      type,
      subject,
      ...(type === "task"
        ? { OR: [{ taskStatus: null }, { taskStatus: { not: "completed" } }] }
        : {}),
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
}

function clampObjection(raw: Record<string, unknown>): SalesObjection | null {
  const kind = text(raw.kind, 32);
  const reply = text(raw.reply, 800);
  if (!OBJECTION_KINDS.has(kind) || !reply) return null;
  return {
    kind: kind as SalesObjection["kind"],
    customerLine: text(raw.customerLine, 400),
    reply,
    proofPoint: text(raw.proofPoint, 400) || null,
    question: text(raw.question, 300) || null,
  };
}

function dueFromDays(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(17, 0, 0, 0);
  return at.toISOString();
}

export async function getSalesGuideCommand(contactId: string) {
  const loaded = await loadLead(contactId);
  if (!loaded.ok) return loaded;
  const facts = await guideFacts(contactId, loaded.contact);
  const agent = await callAiServiceAgent<Record<string, unknown>>(
    "sales-guide",
    { mode: "guide", ...facts },
    { timeoutMs: 90_000 },
  );
  if (!agent || agent.status !== "ok") {
    return { ok: false as const, error: "Sales guide is unavailable right now.", status: 503 };
  }
  const guide = clampGuide(agent, new Set(facts.availableActions), facts.dealId);
  if (!guide.suggestions.length || !guide.nextBestAction || !guide.action) {
    return { ok: false as const, error: "Sales guide is unavailable right now.", status: 503 };
  }
  const openTask =
    guide.action.kind === "task"
      ? await existingGuideActivity(contactId, "task", guide.nextBestAction.title)
      : null;
  const noteSubject = guide.action.subject.trim();
  const openNote =
    guide.action.kind === "note" && noteSubject
      ? await existingGuideActivity(contactId, "note", noteSubject)
      : null;
  return {
    ok: true as const,
    suggestions: guide.suggestions,
    nextBestAction: guide.nextBestAction,
    action: guide.action,
    accepted: {
      task: Boolean(openTask),
      note: Boolean(openNote),
    },
  };
}

export async function applySalesDispositionCommand(
  contactId: string,
  status: string,
  reason?: string,
) {
  const loaded = await loadLead(contactId);
  if (!loaded.ok) return loaded;
  try {
    await requireRole(canEditContacts, "You do not have permission to edit contacts.");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false as const, error: err.message, status: 403 };
    }
    throw err;
  }
  const next = text(status, 32) as LeadStatus;
  if (!DISPOSITIONS.has(next)) {
    return { ok: false as const, error: "That disposition is not a lead status.", status: 400 };
  }
  if (loaded.contact.person.leadStatus === "converted") {
    return { ok: false as const, error: "This lead is already converted.", status: 409 };
  }
  if (loaded.contact.person.leadStatus === next) {
    return { ok: true as const, leadStatus: next };
  }
  await prisma.contactProfile.update({
    where: { accountContactId: contactId },
    data: {
      leadStatus: next,
      ...(next === "disqualified"
        ? { disqualifyReason: text(reason, 64) || "disqualified" }
        : {}),
    },
  });
  return { ok: true as const, leadStatus: next };
}

export async function acceptSalesTaskCommand(
  contactId: string,
  input: { title?: string; detail?: string; dueInDays?: number },
) {
  const title = text(input.title, 160);
  const detail = text(input.detail, 800);
  if (!title || !detail) {
    return { ok: false as const, error: "A task title and detail are required.", status: 400 };
  }
  const due = Number(input.dueInDays);
  const dueInDays = Number.isFinite(due) ? Math.max(1, Math.min(14, Math.trunc(due))) : 2;
  const loaded = await loadLead(contactId);
  if (!loaded.ok) return loaded;
  const existing = await existingGuideActivity(contactId, "task", title);
  if (existing) return { ok: true as const, id: existing.id };
  const actor = await getServerUserId();
  const assignee = loaded.contact.person.ownerUserId || actor;
  const created = await createActivityCommand(contactId, {
    type: "task",
    subject: title,
    body: detail,
    dueAt: dueFromDays(dueInDays),
    assigneeUserId: assignee,
  });
  if (!created.ok) return { ok: false as const, error: created.error, status: 400 };
  return { ok: true as const, id: created.id };
}

export async function acceptSalesFollowUpCommand(
  contactId: string,
  input: { channel?: string; subject?: string; message?: string; dueInDays?: number },
) {
  const channel = text(input.channel, 16);
  const subject = text(input.subject, 160);
  const message = text(input.message, 1200);
  if (!CHANNELS.has(channel) || !subject || !message) {
    return { ok: false as const, error: "A channel, subject, and message are required.", status: 400 };
  }
  const due = Number(input.dueInDays);
  const dueInDays = Number.isFinite(due) ? Math.max(1, Math.min(21, Math.trunc(due))) : 3;
  const existing = await existingGuideActivity(
    contactId,
    channel as "email" | "call" | "meeting" | "sms",
    subject,
  );
  if (existing) return { ok: true as const, id: existing.id };
  const created = await createActivityCommand(contactId, {
    type: channel,
    subject,
    body: message,
    dueAt: dueFromDays(dueInDays),
    folder: channel === "email" ? "draft" : undefined,
  });
  if (!created.ok) return { ok: false as const, error: created.error, status: 400 };
  return { ok: true as const, id: created.id };
}

export async function suggestSalesObjectionCommand(contactId: string, objection: string) {
  const line = text(objection, 800);
  if (!line) return { ok: false as const, error: "Enter the objection first.", status: 400 };
  const loaded = await loadLead(contactId);
  if (!loaded.ok) return loaded;
  const facts = await guideFacts(contactId, loaded.contact);
  const agent = await callAiServiceAgent<Record<string, unknown>>(
    "sales-guide",
    { mode: "objection", objection: line, ...facts },
    { timeoutMs: 60_000 },
  );
  const row = asRecord(agent?.objection) ?? agent;
  const clamped = row ? clampObjection(row) : null;
  if (!agent || agent.status !== "ok" || !clamped) {
    return { ok: false as const, error: "Sales guide is unavailable right now.", status: 503 };
  }
  return { ok: true as const, objection: clamped };
}

export async function recordSalesObjection(activityId: string, raw: unknown): Promise<void> {
  const row = asRecord(raw);
  if (!row) return;
  const objection = clampObjection(row);
  if (!objection) return;
  const existing = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: { transcriptInsights: true },
  });
  if (!existing) return;
  const prior = asRecord(existing.transcriptInsights) ?? {};
  const history = Array.isArray(prior.salesObjections) ? prior.salesObjections : [];
  await prisma.contactActivity.update({
    where: { id: activityId },
    data: {
      transcriptInsights: {
        ...prior,
        salesObjection: objection,
        salesObjections: [...history, objection].slice(-8),
      },
    },
  });
}
