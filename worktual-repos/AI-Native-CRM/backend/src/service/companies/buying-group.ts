/**
 * Company buying group: roles, relationships, one activity feed, and
 * who on our side has talked to whom. Decision-maker text comes from the
 * Python agent. A confidence under 0.7 is stored as a suggestion.
 */

import { randomBytes } from "node:crypto";
import type { ActivityType, TaskStatus } from "@prisma/client";
import { deriveActivityStatus } from "@/dao/activities/activity-feed-service";
import { getPrismaClient } from "@/dao/db/prisma";
import { htmlToPlainText, isHtmlEmailBody } from "@/lib/email-body";
import { parseNoteBody } from "@/lib/note-body";
import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { getUserLabelsByIds } from "@/service/account/user-directory";
import {
  assertCompanyViewAccess,
  type RecordOwnerScope,
} from "@/service/auth/ownership-scope";
import { ForbiddenError, getCurrentOrganizationId } from "@/service/auth/require-role";

const ROLES = new Set([
  "decision_maker",
  "economic_buyer",
  "champion",
  "influencer",
  "technical_evaluator",
  "user",
  "procurement_legal",
  "blocker",
]);
const KINDS = new Set(["reports_to", "influences", "former_colleague", "introduced_by"]);
const INFLUENCE = new Set(["high", "medium", "low"]);
const ATTITUDE = new Set(["supporter", "neutral", "opponent"]);
const CONFIDENCE_GATE = 0.7;
const NEGLECTED_DAYS = 120;

export type BuyingRoleView = {
  id: string;
  contactId: string;
  contactName: string;
  title: string | null;
  dealId: string | null;
  role: string;
  influence: string | null;
  attitude: string | null;
  status: string;
  confidence: number | null;
  evidence: string | null;
  source: string;
};

export type RelationshipView = {
  id: string;
  fromContactId: string;
  toContactId: string;
  fromName: string;
  toName: string;
  kind: string;
  strength: string | null;
  status: string;
  evidence: string | null;
  source: string;
};

export type CompanyActivityView = {
  id: string;
  contactId: string;
  contactName: string;
  type: string;
  subject: string;
  bodyPreview: string | null;
  dueAt: string | null;
  createdAt: string;
  status: "upcoming" | "overdue" | "logged";
  taskStatus: string | null;
  source: "contact" | "deal";
  dealId: string | null;
};

export type CoverageView = {
  contactId: string;
  contactName: string;
  userId: string;
  userName: string;
  touchCount: number;
  lastAt: string | null;
};

export type BuyingGroupView = {
  contacts: Array<{ id: string; name: string; title: string | null }>;
  roles: BuyingRoleView[];
  relationships: RelationshipView[];
  activities: CompanyActivityView[];
  coverage: CoverageView[];
  neglected: Array<{ contactId: string; contactName: string; title: string | null; lastAt: string | null }>;
  warnings: string[];
};

function id(): string {
  return `bg_${randomBytes(12).toString("hex")}`;
}

const NOTE_PREFIX = "WT_NOTE_V1:";
const SECTION_LABEL =
  /^(reason|detail|proposed|summary|next step|outcome|change)$/i;

function clipWords(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const base = space > 40 ? cut.slice(0, space) : cut;
  return `${base.trim()}…`;
}

function recoverTruncatedNote(raw: string): string | null {
  const json = raw.slice(NOTE_PREFIX.length);
  const match = json.match(/"html"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match?.[1]) return null;
  try {
    const html = JSON.parse(`"${match[1]}"`) as string;
    const plain = htmlToPlainText(html).trim();
    return plain || null;
  } catch {
    return null;
  }
}

function plainActivityBody(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  if (raw.startsWith(NOTE_PREFIX)) {
    const parsed = parseNoteBody(raw);
    if (parsed.plain && !parsed.plain.includes(NOTE_PREFIX)) return parsed.plain;
    return recoverTruncatedNote(raw);
  }
  const text = isHtmlEmailBody(raw) || /<[a-z!/][^>]{0,200}>/i.test(raw) ? htmlToPlainText(raw) : raw;
  const plain = text.replace(/\s+/g, " ").trim();
  return plain || null;
}

/** Title plus the reason, without the stored note payload. */
function readableActivity(subject: string, body: string | null): {
  subject: string;
  bodyPreview: string | null;
} {
  const stored = subject.replace(/\s+/g, " ").trim();
  const plain = plainActivityBody(body);
  if (!plain || plain.includes(NOTE_PREFIX)) {
    return { subject: stored || "Activity", bodyPreview: null };
  }
  const lines = plain
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines[0] || stored;
  const rest: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (next && SECTION_LABEL.test(line)) {
      rest.push(`${line}: ${next}`);
      i += 1;
      continue;
    }
    rest.push(line);
  }
  const detail = rest.join(" ").replace(/\s+/g, " ").trim();
  const title =
    !stored ||
    stored.startsWith(heading.slice(0, 24)) ||
    heading.startsWith(stored.slice(0, 24))
      ? heading
      : stored;
  const previewSource =
    detail && detail !== title && !title.includes(detail)
      ? detail
      : heading !== title
        ? heading
        : "";
  return {
    subject: clipWords(title, 140),
    bodyPreview: previewSource ? clipWords(previewSource, 180) : null,
  };
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function choice(value: unknown, allowed: Set<string>): string | null {
  const s = text(value);
  return s && allowed.has(s) ? s : null;
}

async function rows(sql: string, params: unknown[]) {
  return getPrismaClient().$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
}

async function companyScope(companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: { id: true, ownerUserId: true, organizationId: true },
  });
  if (!company) return null;
  const scope = await assertCompanyViewAccess({
    id: company.id,
    ownerUserId: company.ownerUserId == null ? null : String(company.ownerUserId),
  });
  const organizationId = String(company.organizationId);
  const sessionOrg = await getCurrentOrganizationId();
  if (organizationId !== sessionOrg) {
    throw new ForbiddenError("You do not have access to this company.");
  }
  return { company, scope, organizationId };
}

function visibleContactSql(scope: RecordOwnerScope, companyId: string): { sql: string; userId: string | null } {
  if (scope.ownerUserId == null) return { sql: "", userId: null };
  if (scope.channelCompanyIds?.includes(companyId)) return { sql: "", userId: null };
  return {
    sql: " AND (cp.owner_user_id::text = $3 OR cp.created_by_user_id::text = $3)",
    userId: scope.userId,
  };
}

async function loadPeople(organizationId: string, companyId: string, scope: RecordOwnerScope) {
  const filter = visibleContactSql(scope, companyId);
  return rows(
    `
    SELECT cp.account_contact_id AS id,
           NULLIF(BTRIM(concat_ws(' ', p.first_name, p.last_name)), '') AS name,
           NULLIF(BTRIM(p.custom_fields->>'title'), '') AS title
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id = cp.account_contact_id
    WHERE cp.organization_id = $1::bigint
      AND cp.company_id = $2
      AND cp.crm_status = 'active'
      ${filter.sql}
    ORDER BY p.first_name NULLS LAST
    LIMIT 80
    `,
    filter.userId ? [organizationId, companyId, filter.userId] : [organizationId, companyId],
  );
}

export async function getCompanyBuyingGroup(companyId: string): Promise<BuyingGroupView | null> {
  const scoped = await companyScope(companyId);
  if (!scoped) return null;
  const { organizationId, scope } = scoped;
  const people = await loadPeople(organizationId, companyId, scope);
  const nameById = new Map(people.map((row) => [String(row.id), text(row.name) || "Contact"]));
  const titleById = new Map(people.map((row) => [String(row.id), text(row.title)]));
  const ids = [...nameById.keys()];

  const roleRows = ids.length
    ? await rows(
        `
        SELECT id, contact_id, deal_id, role, influence, attitude, status,
               confidence, evidence, source
        FROM crm.contact_buying_roles
        WHERE organization_id = $1::bigint AND company_id = $2
          AND contact_id = ANY($3::text[])
          AND status <> 'rejected'
        ORDER BY updated_at DESC
        `,
        [organizationId, companyId, ids],
      )
    : [];
  const linkRows = ids.length
    ? await rows(
        `
        SELECT id, from_contact_id, to_contact_id, kind, strength, status, evidence, source
        FROM crm.contact_relationships
        WHERE organization_id = $1::bigint AND company_id = $2
          AND status <> 'rejected'
          AND from_contact_id = ANY($3::text[])
          AND to_contact_id = ANY($3::text[])
        ORDER BY updated_at DESC
        LIMIT 40
        `,
        [organizationId, companyId, ids],
      )
    : [];

  const activityRows = ids.length
    ? await rows(
        `
        SELECT * FROM (
          SELECT id, contact_id, type::text AS type, subject,
                 CASE
                   WHEN body LIKE 'WT_NOTE_V1:%' THEN LEFT(body, 6000)
                   ELSE LEFT(COALESCE(body, ''), 1200)
                 END AS body,
                 due_at, task_status::text AS task_status, created_at,
                 'contact' AS source, NULL::text AS deal_id
          FROM crm.contact_activities
          WHERE organization_id = $1::bigint
            AND contact_id = ANY($2::text[])
            AND folder <> 'trash'
          UNION ALL
          SELECT da.id, d.contact_id, da.type::text, da.subject,
                 LEFT(COALESCE(da.body, ''), 1200), da.due_at,
                 NULL::text, da.created_at, 'deal', da.deal_id
          FROM crm.deal_activities da
          JOIN crm.deals d ON d.id = da.deal_id
          WHERE da.organization_id = $1::bigint
            AND d.company_id = $3
            AND d.contact_id = ANY($2::text[])
        ) feed
        ORDER BY created_at DESC
        LIMIT 40
        `,
        [organizationId, ids, companyId],
      )
    : [];

  const coverageRows = ids.length
    ? await rows(
        `
        SELECT contact_id, created_by_user_id::text AS user_id,
               count(*)::int AS touch_count, max(created_at) AS last_at
        FROM crm.contact_activities
        WHERE organization_id = $1::bigint
          AND contact_id = ANY($2::text[])
          AND folder <> 'trash'
          AND type IN ('email', 'call', 'meeting', 'sms')
          AND created_by_user_id IS NOT NULL
        GROUP BY contact_id, created_by_user_id
        ORDER BY max(created_at) DESC
        LIMIT 40
        `,
        [organizationId, ids],
      )
    : [];

  const labels = await getUserLabelsByIds(
    coverageRows.map((row) => text(row.user_id)).filter((value): value is string => Boolean(value)),
  );

  const lastRows = ids.length
    ? await rows(
        `
        SELECT contact_id, max(created_at) AS last_at
        FROM (
          SELECT contact_id, created_at
          FROM crm.contact_activities
          WHERE organization_id = $1::bigint
            AND contact_id = ANY($2::text[])
            AND folder <> 'trash'
          UNION ALL
          SELECT d.contact_id, da.created_at
          FROM crm.deal_activities da
          JOIN crm.deals d ON d.id = da.deal_id
          WHERE da.organization_id = $1::bigint
            AND d.company_id = $3
            AND d.contact_id = ANY($2::text[])
        ) touches
        GROUP BY contact_id
        `,
        [organizationId, ids, companyId],
      )
    : [];
  const lastTouch = new Map<string, string | null>();
  for (const row of lastRows) {
    lastTouch.set(
      String(row.contact_id),
      row.last_at ? new Date(String(row.last_at)).toISOString() : null,
    );
  }
  const cutoff = Date.now() - NEGLECTED_DAYS * 24 * 60 * 60 * 1000;
  const roleContactIds = new Set(roleRows.map((row) => String(row.contact_id)));
  const neglected = [...roleContactIds].flatMap((contactId) => {
    const lastAt = lastTouch.get(contactId) ?? null;
    if (lastAt && new Date(lastAt).getTime() >= cutoff) return [];
    return [{
      contactId,
      contactName: nameById.get(contactId) || "Contact",
      title: titleById.get(contactId) ?? null,
      lastAt,
    }];
  });

  return {
    contacts: people.map((row) => ({
      id: String(row.id),
      name: nameById.get(String(row.id)) || "Contact",
      title: titleById.get(String(row.id)) ?? null,
    })),
    roles: roleRows.map((row) => ({
      id: String(row.id),
      contactId: String(row.contact_id),
      contactName: nameById.get(String(row.contact_id)) || "Contact",
      title: titleById.get(String(row.contact_id)) ?? null,
      dealId: text(row.deal_id),
      role: String(row.role),
      influence: text(row.influence),
      attitude: text(row.attitude),
      status: String(row.status),
      confidence: row.confidence == null ? null : Number(row.confidence),
      evidence: text(row.evidence),
      source: String(row.source),
    })),
    relationships: linkRows.map((row) => ({
      id: String(row.id),
      fromContactId: String(row.from_contact_id),
      toContactId: String(row.to_contact_id),
      fromName: nameById.get(String(row.from_contact_id)) || "Contact",
      toName: nameById.get(String(row.to_contact_id)) || "Contact",
      kind: String(row.kind),
      strength: text(row.strength),
      status: String(row.status),
      evidence: text(row.evidence),
      source: String(row.source),
    })),
    activities: activityRows.flatMap((row) => {
      const contactId = text(row.contact_id);
      if (!contactId || !nameById.has(contactId)) return [];
      const dueAt = row.due_at ? new Date(String(row.due_at)) : null;
      const taskStatus = text(row.task_status);
      const readable = readableActivity(
        text(row.subject) || String(row.type),
        text(row.body),
      );
      return [{
        id: String(row.id),
        contactId,
        contactName: nameById.get(contactId) || "Contact",
        type: String(row.type),
        subject: readable.subject,
        bodyPreview: readable.bodyPreview,
        dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.toISOString() : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
        status: deriveActivityStatus(
          dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
          new Date(),
          {
            type: String(row.type) as ActivityType,
            taskStatus: (taskStatus as TaskStatus | null) ?? null,
          },
        ),
        taskStatus,
        source: row.source === "deal" ? "deal" as const : "contact" as const,
        dealId: text(row.deal_id),
      }];
    }),
    coverage: coverageRows.flatMap((row) => {
      const contactId = text(row.contact_id);
      const userId = text(row.user_id);
      if (!contactId || !userId) return [];
      return [{
        contactId,
        contactName: nameById.get(contactId) || "Contact",
        userId,
        userName: labels.get(userId) || "Teammate",
        touchCount: Number(row.touch_count) || 0,
        lastAt: row.last_at ? new Date(String(row.last_at)).toISOString() : null,
      }];
    }),
    neglected,
    warnings: [],
  };
}

export function warningsForDeal(roles: BuyingRoleView[], dealId: string): string[] {
  const relevant = roles.filter((role) => role.status === "confirmed" && (role.dealId === dealId || role.dealId == null));
  const dealSpecific = relevant.filter((role) => role.dealId === dealId);
  const used = dealSpecific.length ? dealSpecific : relevant.filter((role) => role.dealId == null);
  const names = new Set(used.map((role) => role.role));
  const people = new Set(used.map((role) => role.contactId));
  const warnings: string[] = [];
  if (!names.has("economic_buyer")) warnings.push("No economic buyer is confirmed on this deal.");
  if (!names.has("champion")) warnings.push("No champion is confirmed on this deal.");
  if (people.size === 1) warnings.push("This deal depends on one person.");
  return warnings;
}

export async function getDealBuyingGroup(dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId },
    select: { id: true, companyId: true, organizationId: true },
  });
  if (!deal?.companyId) return null;
  const group = await getCompanyBuyingGroup(deal.companyId);
  if (!group) return null;
  return {
    ...group,
    roles: group.roles.filter((role) => role.dealId == null || role.dealId === deal.id),
    warnings: warningsForDeal(group.roles, deal.id),
  };
}

async function upsertRole(input: {
  organizationId: string;
  companyId: string;
  contactId: string;
  dealId: string | null;
  role: string;
  influence: string | null;
  attitude: string | null;
  status: string;
  confidence: number | null;
  evidence: string | null;
  source: string;
}) {
  const dealClause = input.dealId
    ? "deal_id = $4"
    : "deal_id IS NULL";
  const existing = await rows(
    `
    SELECT id, status FROM crm.contact_buying_roles
    WHERE organization_id = $1::bigint AND company_id = $2 AND contact_id = $3 AND ${dealClause}
    LIMIT 1
    `,
    input.dealId
      ? [input.organizationId, input.companyId, input.contactId, input.dealId]
      : [input.organizationId, input.companyId, input.contactId],
  );
  if (existing[0]?.id && String(existing[0].status ?? "") === "rejected" && input.source === "ai") {
    return;
  }
  if (existing[0]?.id) {
    await getPrismaClient().$executeRawUnsafe(
      `
      UPDATE crm.contact_buying_roles
      SET role = $2, influence = $3, attitude = $4, status = $5, confidence = $6,
          evidence = $7, source = $8, deal_id = $9, updated_at = NOW()
      WHERE id = $1
      `,
      String(existing[0].id),
      input.role,
      input.influence,
      input.attitude,
      input.status,
      input.confidence,
      input.evidence,
      input.source,
      input.dealId,
    );
    return;
  }
  await getPrismaClient().$executeRawUnsafe(
    `
    INSERT INTO crm.contact_buying_roles (
      id, organization_id, contact_id, company_id, deal_id, role, influence, attitude,
      status, confidence, evidence, source, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
    )
    `,
    id(),
    input.organizationId,
    input.contactId,
    input.companyId,
    input.dealId,
    input.role,
    input.influence,
    input.attitude,
    input.status,
    input.confidence,
    input.evidence,
    input.source,
  );
}

export async function setBuyingRole(input: {
  companyId: string;
  contactId: string;
  dealId?: string | null;
  role: string;
  influence?: string | null;
  attitude?: string | null;
}) {
  const role = choice(input.role, ROLES);
  if (!role) throw new ForbiddenError("Choose a buying role from the list.");
  const scoped = await companyScope(input.companyId);
  if (!scoped) return null;
  await upsertRole({
    organizationId: scoped.organizationId,
    companyId: input.companyId,
    contactId: input.contactId,
    dealId: text(input.dealId),
    role,
    influence: choice(input.influence, INFLUENCE),
    attitude: choice(input.attitude, ATTITUDE),
    status: "confirmed",
    confidence: null,
    evidence: null,
    source: "user",
  });
  return getCompanyBuyingGroup(input.companyId);
}

export async function reviewBuyingRole(roleId: string, status: "confirmed" | "rejected") {
  const found = await rows(
    `SELECT company_id FROM crm.contact_buying_roles WHERE id = $1 LIMIT 1`,
    [roleId],
  );
  const companyId = text(found[0]?.company_id);
  if (!companyId) return null;
  const scoped = await companyScope(companyId);
  if (!scoped) return null;
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE crm.contact_buying_roles SET status = $2, source = 'user', updated_at = NOW() WHERE id = $1 AND organization_id = $3::bigint`,
    roleId,
    status,
    scoped.organizationId,
  );
  return getCompanyBuyingGroup(companyId);
}

export async function reviewRelationship(linkId: string, status: "confirmed" | "rejected") {
  const found = await rows(
    `SELECT company_id FROM crm.contact_relationships WHERE id = $1 LIMIT 1`,
    [linkId],
  );
  const companyId = text(found[0]?.company_id);
  if (!companyId) return null;
  const scoped = await companyScope(companyId);
  if (!scoped) return null;
  await getPrismaClient().$executeRawUnsafe(
    `UPDATE crm.contact_relationships SET status = $2, source = 'user', updated_at = NOW() WHERE id = $1 AND organization_id = $3::bigint`,
    linkId,
    status,
    scoped.organizationId,
  );
  return getCompanyBuyingGroup(companyId);
}

export async function suggestBuyingGroup(companyId: string) {
  const scoped = await companyScope(companyId);
  if (!scoped) return null;
  const group = await getCompanyBuyingGroup(companyId);
  if (!group) return null;
  const rejected = await rows(
    `
    SELECT contact_id, role FROM crm.contact_buying_roles
    WHERE organization_id = $1::bigint AND company_id = $2 AND status = 'rejected'
    `,
    [scoped.organizationId, companyId],
  );
  const rejectedByContact = new Map<string, string[]>();
  for (const row of rejected) {
    const contactId = String(row.contact_id);
    const list = rejectedByContact.get(contactId) ?? [];
    list.push(String(row.role));
    rejectedByContact.set(contactId, list);
  }
  const covered = new Set(
    group.roles.filter((role) => role.dealId == null).map((role) => role.contactId),
  );
  const contacts = group.contacts
    .filter((person) => !covered.has(person.id))
    .slice(0, 12)
    .map((person) => ({
      id: person.id,
      name: person.name,
      title: person.title,
      rejectedRoles: rejectedByContact.get(person.id) ?? [],
      activities: group.activities
        .filter((activity) => activity.contactId === person.id)
        .slice(0, 4)
        .map((activity) => `${activity.type}: ${activity.subject}`)
        .join(" | "),
    }));
  if (!contacts.length) return group;

  const py = await callAiServiceAgent<{
    status?: string;
    people?: Array<Record<string, unknown>>;
    relationships?: Array<Record<string, unknown>>;
  }>("identify-decision-makers", {
    organizationId: scoped.organizationId,
    companyId,
    contacts,
  }, { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS });

  if (py?.status !== "ok") return group;
  const allowed = new Set(group.contacts.map((person) => person.id));
  for (const person of py.people ?? []) {
    const contactId = text(person.contactId);
    const role = choice(person.role, ROLES);
    const confidence = Number(person.confidence);
    const evidence = text(person.evidence);
    if (!contactId || !allowed.has(contactId) || !role || !evidence || !Number.isFinite(confidence)) continue;
    if ((rejectedByContact.get(contactId) ?? []).includes(role)) continue;
    await upsertRole({
      organizationId: scoped.organizationId,
      companyId,
      contactId,
      dealId: null,
      role,
      influence: choice(person.influence, INFLUENCE),
      attitude: choice(person.attitude, ATTITUDE),
      status: confidence >= CONFIDENCE_GATE ? "confirmed" : "suggested",
      confidence,
      evidence,
      source: "ai",
    });
  }
  for (const link of py.relationships ?? []) {
    const fromContactId = text(link.fromContactId);
    const toContactId = text(link.toContactId);
    const kind = choice(link.kind, KINDS);
    const evidence = text(link.evidence);
    if (!fromContactId || !toContactId || !kind || !evidence) continue;
    if (!allowed.has(fromContactId) || !allowed.has(toContactId) || fromContactId === toContactId) continue;
    await getPrismaClient().$executeRawUnsafe(
      `
      INSERT INTO crm.contact_relationships (
        id, organization_id, company_id, from_contact_id, to_contact_id,
        kind, strength, status, evidence, source, created_at, updated_at
      ) VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, 'suggested', $8, 'ai', NOW(), NOW())
      ON CONFLICT (organization_id, company_id, from_contact_id, to_contact_id, kind)
      DO NOTHING
      `,
      id(),
      scoped.organizationId,
      companyId,
      fromContactId,
      toContactId,
      kind,
      choice(link.strength, new Set(["strong", "medium", "weak"])),
      evidence,
    );
  }
  return getCompanyBuyingGroup(companyId);
}
