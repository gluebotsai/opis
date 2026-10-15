/**
 * Sales assignment — region + business type, then:
 * 1. Existing relationship (company / location / contact owner)
 * 2. Capacity (accepting leads, not on PTO, under max open deals)
 * 3. Seniority / tier vs deal size
 * 4. Workload (open deal count, then open pipeline amount)
 *
 * Capacity/seniority/country: CRM DB via assignment-settings DAO.
 */

import type { DealStage } from "@prisma/client";
import { accountQuery } from "@/dao/db/account-pool";
import { prisma } from "@/dao/db/prisma";
import { normalizeRole, type AppRole } from "@/service/auth/rbac";
import type { BusinessType } from "@/config/modules";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import {
  getSalesAssignmentConfig,
  isOnPto,
  type SeniorityTier,
} from "@/dao/sales/assignment-settings";
import { loadBusinessHoursSummaries } from "@/service/ai/owner-business-hours";
import {
  emailDomain,
  isFreeMailDomain,
} from "@/service/ai/lead-enrichment-types";

/** Reps carry deals; managers back them up; admins are the last resort. */
const ROLE_PREFERENCE: AppRole[] = ["sales_rep", "sales_manager", "admin"];

type SalesUserRow = {
  id: string;
  role: string | null;
  display_name: string | null;
  email: string;
  business_type: string | null;
  skills: unknown;
  primary_language: string | null;
  secondary_language: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  business_hours_id: string | null;
};

export type AssignmentCandidate = {
  id: string;
  role: AppRole;
  displayName: string;
  email: string;
  country: string | null;
  businessType: string | null;
  openDealCount: number;
  openPipelineAmount: number;
  /** Closed-won deals (maturity / win-rate cold-start). */
  closedWonCount: number;
  acceptingLeads: boolean;
  maxOpenDeals: number | null;
  onPto: boolean;
  seniorityTier: SeniorityTier;
  skills: string[];
  primaryLanguage: string | null;
  secondaryLanguage: string | null;
  city: string | null;
  state: string | null;
  businessHours: string | null;
};

export type RepMaturity = "new" | "ramping" | "established";

export function repMaturityFromClosedWon(closedWonCount: number): RepMaturity {
  if (closedWonCount >= 50) return "established";
  if (closedWonCount >= 20) return "ramping";
  return "new";
}

/** Win-rate weight applied in ranking (spec §5). */
export function maturityWinRateWeight(maturity: RepMaturity): number {
  if (maturity === "established") return 1;
  if (maturity === "ramping") return 0.3;
  return 0;
}

export type RegionalOwner = {
  userId: string;
  role: AppRole;
  name: string;
  matchedRegion: boolean;
  reason: string;
  /** Best-first sales reps from the assignment agent. The first id is userId. */
  rankedUserIds?: string[];
};

function skillLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 24);
}

function displayName(row: SalesUserRow): string {
  return (
    row.display_name?.trim() ||
    row.email.split("@")[0]?.replace(/[._-]+/g, " ") ||
    row.email
  );
}

function tierFromRole(role: AppRole): SeniorityTier {
  if (role === "sales_manager") return "senior";
  if (role === "admin") return "mid";
  return "junior";
}

async function loadSalesUsers(organizationId: string): Promise<SalesUserRow[]> {
  try {
    const res = await accountQuery<SalesUserRow>(
      `SELECT u.id::text AS id,
              lower(r.name) AS role,
              trim(both FROM coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS display_name,
              lower(u.work_email) AS email,
              o.business_type,
              u.skills,
              u.primary_language,
              u.secondary_language,
              u.city,
              u.state,
              u.country,
              u.business_hours_id::text AS business_hours_id
       FROM accounts.setup_users u
       LEFT JOIN accounts.organizations o ON o.id = u.organization_id
       LEFT JOIN accounts.setup_user_product_access a
         ON a.user_id = u.id AND a.product_id = 'crm'
       LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
       WHERE u.status = 'active'
         AND u.organization_id = $1::bigint
         AND lower(coalesce(r.name, '')) IN ('admin', 'manager', 'sales rep', 'sales_manager', 'sales_rep')`,
      [organizationId],
    );
    return res.rows;
  } catch (err) {
    console.error("loadSalesUsers failed", err);
    return [];
  }
}

async function dealStatsByOwner(
  organizationId: string,
  ownerIds: string[],
): Promise<
  Map<string, { openCount: number; openAmount: number; closedWonCount: number }>
> {
  const out = new Map<
    string,
    { openCount: number; openAmount: number; closedWonCount: number }
  >();
  if (ownerIds.length === 0) return out;
  try {
    const rows = await prisma.deal.findMany({
      where: {
        organizationId,
        ownerUserId: { in: ownerIds },
      },
      select: { ownerUserId: true, amount: true, stage: true },
    });
    for (const row of rows) {
      if (!row.ownerUserId) continue;
      const cur = out.get(row.ownerUserId) ?? {
        openCount: 0,
        openAmount: 0,
        closedWonCount: 0,
      };
      if (row.stage === "closed_won") {
        cur.closedWonCount += 1;
      } else if (row.stage !== "closed_lost") {
        cur.openCount += 1;
        const amt =
          row.amount != null && Number.isFinite(Number(row.amount))
            ? Number(row.amount)
            : 0;
        cur.openAmount += amt;
      }
      out.set(row.ownerUserId, cur);
    }
  } catch (err) {
    console.error("dealStatsByOwner failed", err);
  }
  return out;
}

export async function listAssignmentCandidates(input: {
  organizationId?: string | null;
}): Promise<{
  organizationId: string;
  seniorAmountThreshold: number;
  candidates: AssignmentCandidate[];
}> {
  const organizationId = await resolveRequestOrganizationId(input.organizationId);
  const rows = await loadSalesUsers(organizationId);
  const config = await getSalesAssignmentConfig(organizationId);
  const stats = await dealStatsByOwner(
    organizationId,
    rows.map((r) => r.id),
  );
  const hours = await loadBusinessHoursSummaries(
    organizationId,
    rows.map((r) => r.business_hours_id),
  );

  const candidates: AssignmentCandidate[] = rows.map((row) => {
    const role = normalizeRole(row.role);
    const repCfg = config.reps[row.id];
    const load = stats.get(row.id) ?? {
      openCount: 0,
      openAmount: 0,
      closedWonCount: 0,
    };
    return {
      id: row.id,
      role,
      displayName: displayName(row),
      email: row.email,
      country: row.country?.trim() || repCfg?.country || null,
      businessType: row.business_type,
      openDealCount: load.openCount,
      openPipelineAmount: load.openAmount,
      closedWonCount: load.closedWonCount,
      acceptingLeads: repCfg?.acceptingLeads !== false,
      maxOpenDeals:
        typeof repCfg?.maxOpenDeals === "number" ? repCfg.maxOpenDeals : null,
      onPto: isOnPto(repCfg?.onPtoUntil ?? null),
      seniorityTier: repCfg?.seniorityTier ?? tierFromRole(role),
      skills: skillLabels(row.skills),
      primaryLanguage: row.primary_language?.trim() || null,
      secondaryLanguage: row.secondary_language?.trim() || null,
      city: row.city?.trim() || null,
      state: row.state?.trim() || null,
      businessHours: row.business_hours_id
        ? (hours.get(row.business_hours_id) ?? null)
        : null,
    };
  });

  return {
    organizationId,
    seniorAmountThreshold: config.seniorAmountThreshold,
    candidates,
  };
}

export async function resolveExistingRelationshipOwner(input: {
  organizationId: string;
  contactId?: string | null;
  companyId?: string | null;
  locationId?: string | null;
}): Promise<{ userId: string; source: string } | null> {
  const organizationId = input.organizationId;

  if (input.contactId) {
    try {
      const profile = await prisma.contactProfile.findFirst({
        where: { accountContactId: input.contactId, organizationId },
        select: { ownerUserId: true, companyId: true, locationId: true },
      });
      if (profile?.ownerUserId) {
        return { userId: profile.ownerUserId, source: "contact owner" };
      }
      // Prefer linked company/location when contact itself is unowned.
      if (!input.companyId && profile?.companyId) {
        input = { ...input, companyId: profile.companyId };
      }
      if (!input.locationId && profile?.locationId) {
        input = { ...input, locationId: profile.locationId };
      }
    } catch (err) {
      console.error("resolveExistingRelationshipOwner contact failed", err);
    }
  }

  if (input.locationId) {
    try {
      const loc = await prisma.companyLocation.findFirst({
        where: { id: input.locationId, organizationId },
        select: { ownerUserId: true, companyId: true },
      });
      if (loc?.ownerUserId) {
        return { userId: loc.ownerUserId, source: "location owner" };
      }
      if (!input.companyId && loc?.companyId) {
        input = { ...input, companyId: loc.companyId };
      }
    } catch (err) {
      console.error("resolveExistingRelationshipOwner location failed", err);
    }
  }

  if (input.companyId) {
    try {
      const company = await prisma.company.findFirst({
        where: { id: input.companyId, organizationId },
        select: { ownerUserId: true },
      });
      if (company?.ownerUserId) {
        return { userId: company.ownerUserId, source: "company owner" };
      }
    } catch (err) {
      console.error("resolveExistingRelationshipOwner company failed", err);
    }
  }

  return null;
}

const SALES_REP_ROLE_NAMES = new Set([
  "sales_rep",
  "sales rep",
  "sales",
  "rep",
]);

export function isSalesRepRoleName(role: string | null | undefined): boolean {
  return SALES_REP_ROLE_NAMES.has((role ?? "").trim().toLowerCase());
}

export type RelationshipPerson = {
  userId: string;
  name: string | null;
  role: string | null;
};

export type LeadRelationshipEvidence = {
  openDealOwner: (RelationshipPerson & { dealTitle: string | null }) | null;
  companyOwner: RelationshipPerson | null;
  contactOwner: RelationshipPerson | null;
  recentRep: (RelationshipPerson & { lastTouchedAt: string }) | null;
};

export type LeadAssignmentFacts = {
  language: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  companyName: string | null;
  industry: string | null;
  employeeCount: number | null;
  leadSource: string | null;
  title: string | null;
  band: string | null;
  score: number | null;
};

async function personByIds(
  userIds: string[],
): Promise<Map<string, RelationshipPerson>> {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, RelationshipPerson>();
  if (ids.length === 0) return out;
  try {
    const { rows } = await accountQuery<{
      id: string;
      name: string | null;
      role: string | null;
    }>(
      `SELECT u.id::text AS id,
              trim(both FROM coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS name,
              lower(r.name) AS role
       FROM accounts.setup_users u
       LEFT JOIN accounts.setup_user_product_access a
         ON a.user_id = u.id AND a.product_id = 'crm'
       LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
       WHERE u.id = ANY($1::bigint[])`,
      [ids],
    );
    for (const row of rows) {
      out.set(row.id, {
        userId: row.id,
        name: row.name?.trim() || null,
        role: row.role,
      });
    }
  } catch (err) {
    console.error("personByIds failed", err);
  }
  return out;
}

export async function loadLeadAssignmentContext(input: {
  organizationId: string;
  contactId?: string | null;
  companyId?: string | null;
  locationId?: string | null;
}): Promise<{
  relationship: LeadRelationshipEvidence;
  lead: LeadAssignmentFacts;
}> {
  const organizationId = input.organizationId;
  const orgId = BigInt(organizationId);
  let companyId = input.companyId?.trim() || null;
  let contactOwnerId: string | null = null;
  let leadSource: string | null = null;
  let email: string | null = null;

  const emptyLead: LeadAssignmentFacts = {
    language: null,
    city: null,
    region: null,
    country: null,
    companyName: null,
    industry: null,
    employeeCount: null,
    leadSource: null,
    title: null,
    band: null,
    score: null,
  };

  if (input.contactId) {
    const profile = await prisma.contactProfile.findFirst({
      where: { accountContactId: input.contactId, organizationId: orgId },
      select: {
        ownerUserId: true,
        companyId: true,
        leadSource: true,
      },
    });
    contactOwnerId = profile?.ownerUserId ? String(profile.ownerUserId) : null;
    if (!companyId && profile?.companyId) companyId = profile.companyId;
    leadSource = profile?.leadSource ?? null;

    const score = await prisma.leadScoringJob.findFirst({
      where: { organizationId: orgId, contactId: input.contactId },
      select: { band: true, score: true },
    });
    emptyLead.band = score?.band ?? null;
    emptyLead.score = score?.score ?? null;
    emptyLead.leadSource = leadSource;

    try {
      const { rows } = await accountQuery<{
        language: string | null;
        city: string | null;
        region: string | null;
        country: string | null;
        title: string | null;
        email: string | null;
      }>(
        `SELECT p.language, p.city, p.region, p.country,
                p.custom_fields->>'title' AS title,
                (
                  SELECT k.key_value
                  FROM cdp.identity_keys k
                  WHERE k.cdp_id = p.cdp_id
                    AND k.key_type = 'email'
                  ORDER BY k.created_at
                  LIMIT 1
                ) AS email
         FROM cdp.customer_profile p
         WHERE p.cdp_id = $1
           AND p.organization_id = $2::bigint
         LIMIT 1`,
        [input.contactId, organizationId],
      );
      const person = rows[0];
      if (person) {
        emptyLead.language = person.language;
        emptyLead.city = person.city;
        emptyLead.region = person.region;
        emptyLead.country = person.country;
        emptyLead.title = person.title;
        email = person.email;
      }
    } catch (err) {
      console.error("loadLeadAssignmentContext person failed", err);
    }
  }

  if (!companyId && email) {
    const domain = emailDomain(email);
    if (domain && !isFreeMailDomain(domain)) {
      const company = await prisma.company.findFirst({
        where: {
          organizationId: orgId,
          domain: { equals: domain, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (company) companyId = company.id;
    }
  }

  let companyOwnerId: string | null = null;
  if (companyId) {
    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: {
        ownerUserId: true,
        name: true,
        industry: true,
        employeeCount: true,
      },
    });
    companyOwnerId = company?.ownerUserId ? String(company.ownerUserId) : null;
    emptyLead.companyName = company?.name ?? null;
    emptyLead.industry = company?.industry ?? null;
    emptyLead.employeeCount =
      company?.employeeCount != null ? Number(company.employeeCount) : null;
  }

  let openDealOwnerId: string | null = null;
  let dealTitle: string | null = null;
  const openStages: DealStage[] = [
    "qualification",
    "discover",
    "propose",
    "negotiate",
  ];
  const dealWhere = {
    organizationId: orgId,
    stage: { in: openStages },
  };
  const openDeal = input.contactId
    ? await prisma.deal.findFirst({
        where: { ...dealWhere, contactId: input.contactId },
        orderBy: { updatedAt: "desc" },
        select: { ownerUserId: true, title: true },
      })
    : null;
  const companyDeal =
    !openDeal?.ownerUserId && companyId
      ? await prisma.deal.findFirst({
          where: { ...dealWhere, companyId },
          orderBy: { updatedAt: "desc" },
          select: { ownerUserId: true, title: true },
        })
      : null;
  const deal = openDeal?.ownerUserId ? openDeal : companyDeal;
  if (deal?.ownerUserId) {
    openDealOwnerId = String(deal.ownerUserId);
    dealTitle = deal.title;
  }

  let recentUserId: string | null = null;
  let recentAt: Date | null = null;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60_000);
  const contactIds = new Set<string>();
  if (input.contactId) contactIds.add(input.contactId);
  if (companyId) {
    const siblings = await prisma.contactProfile.findMany({
      where: { organizationId: orgId, companyId },
      select: { accountContactId: true },
      take: 40,
    });
    for (const row of siblings) contactIds.add(row.accountContactId);
  }
  if (contactIds.size > 0) {
    const activity = await prisma.contactActivity.findFirst({
      where: {
        organizationId: orgId,
        contactId: { in: [...contactIds] },
        createdAt: { gte: since },
        createdByUserId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { createdByUserId: true, createdAt: true },
    });
    if (activity?.createdByUserId) {
      recentUserId = String(activity.createdByUserId);
      recentAt = activity.createdAt;
    }
  }

  const people = await personByIds(
    [openDealOwnerId, companyOwnerId, contactOwnerId, recentUserId].filter(
      (id): id is string => Boolean(id),
    ),
  );
  const person = (id: string | null) => (id ? (people.get(id) ?? { userId: id, name: null, role: null }) : null);

  return {
    lead: emptyLead,
    relationship: {
      openDealOwner: openDealOwnerId
        ? { ...person(openDealOwnerId)!, dealTitle }
        : null,
      companyOwner: person(companyOwnerId),
      contactOwner: person(contactOwnerId),
      recentRep:
        recentUserId && recentAt
          ? { ...person(recentUserId)!, lastTouchedAt: recentAt.toISOString() }
          : null,
    },
  };
}

function pickFromPool(
  pool: AssignmentCandidate[],
  opts: {
    estimatedAmount: number | null;
    seniorAmountThreshold: number;
    matchedRegion: boolean;
    country: string | null;
  },
): RegionalOwner | null {
  if (pool.length === 0) return null;

  const amount =
    opts.estimatedAmount != null && Number.isFinite(opts.estimatedAmount)
      ? opts.estimatedAmount
      : null;
  const wantsSenior =
    amount != null && amount >= opts.seniorAmountThreshold;
  const wantsJunior =
    amount != null &&
    amount > 0 &&
    amount < opts.seniorAmountThreshold * 0.25;

  let ranked = [...pool];
  if (wantsSenior) {
    const seniors = ranked.filter((c) => c.seniorityTier === "senior");
    if (seniors.length) ranked = seniors;
  } else if (wantsJunior) {
    const juniors = ranked.filter((c) => c.seniorityTier === "junior");
    if (juniors.length) ranked = juniors;
  }

  ranked.sort((a, b) => {
    // Lower open load first (capacity).
    if (a.openDealCount !== b.openDealCount) {
      return a.openDealCount - b.openDealCount;
    }
    if (a.openPipelineAmount !== b.openPipelineAmount) {
      return a.openPipelineAmount - b.openPipelineAmount;
    }
    // Maturity: established reps with more closed-won preferred when weight > 0;
    // new reps (weight 0) stay tied on win-rate and fall through to role/name.
    const wa = maturityWinRateWeight(repMaturityFromClosedWon(a.closedWonCount));
    const wb = maturityWinRateWeight(repMaturityFromClosedWon(b.closedWonCount));
    const scoreA = wa * a.closedWonCount;
    const scoreB = wb * b.closedWonCount;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const ra = ROLE_PREFERENCE.indexOf(a.role);
    const rb = ROLE_PREFERENCE.indexOf(b.role);
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName);
  });

  const chosen = ranked[0]!;
  const maturity = repMaturityFromClosedWon(chosen.closedWonCount);
  const loadNote = `open deals=${chosen.openDealCount}; maturity=${maturity}`;
  let reason: string;
  if (opts.matchedRegion) {
    reason = `matched to the ${opts.country} sales territory (${loadNote})`;
  } else if (opts.country) {
    reason = `no sales rep covers ${opts.country} yet, assigned by workload (${loadNote})`;
  } else {
    reason = `assigned by workload (${loadNote})`;
  }
  if (wantsSenior) reason += "; preferred senior tier for deal size";
  if (wantsJunior) reason += "; preferred junior tier for deal size";

  return {
    userId: chosen.id,
    role: chosen.role,
    name: chosen.displayName,
    matchedRegion: opts.matchedRegion,
    reason,
  };
}

export type SalesOwnerDecision =
  | { status: "assigned"; owner: RegionalOwner }
  | { status: "unassigned"; reason: string };

/**
 * Resolve the best sales owner for a contact/deal.
 * The Python assignment agent decides. A failed model call throws so the
 * caller can retry instead of assigning with local rules.
 */
export async function resolveRegionalSalesOwner(input: {
  organizationId?: string | null;
  businessType?: BusinessType | null;
  country?: string | null;
  city?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  estimatedAmount?: number | null;
}): Promise<SalesOwnerDecision> {
  const organizationId = await resolveRequestOrganizationId(input.organizationId);

  const { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } = await import(
    "@/service/ai/ai-service-client"
  );
  const py = await callAiServiceAgent<{
    status?: string;
    reason?: string | null;
    owner?: {
      userId?: string;
      role?: string;
      name?: string;
      matchedRegion?: boolean;
      reason?: string;
      rankedUserIds?: string[];
    } | null;
  }>(
    "assign-sales",
    {
      organizationId,
      businessType: input.businessType,
      country: input.country,
      city: input.city,
      contactId: input.contactId,
      companyId: input.companyId,
      locationId: input.locationId,
      estimatedAmount: input.estimatedAmount,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  if (!py || py.status === "failed") {
    throw new Error(
      py?.reason || "Sales assignment agent did not return a decision.",
    );
  }

  if (
    py?.owner?.userId &&
    py.owner.name &&
    normalizeRole(py.owner.role) === "sales_rep"
  ) {
    return {
      status: "assigned",
      owner: {
        userId: py.owner.userId,
        role: "sales_rep",
        name: py.owner.name,
        matchedRegion: Boolean(py.owner.matchedRegion),
        reason: py.owner.reason || "Assigned by sales assignment agent",
        rankedUserIds: [
          py.owner.userId,
          ...(Array.isArray(py.owner.rankedUserIds) ? py.owner.rankedUserIds : []),
        ]
          .map((id) => id.trim())
          .filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index),
      },
    };
  }

  return {
    status: "unassigned",
    reason: py.reason || "No sales rep fit this lead.",
  };
}

export async function resolveRegionalSalesOwnerLocal(input: {
  organizationId?: string | null;
  businessType?: BusinessType | null;
  country?: string | null;
  city?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  estimatedAmount?: number | null;
}): Promise<RegionalOwner | null> {
  const { organizationId, candidates, seniorAmountThreshold } =
    await listAssignmentCandidates({
      organizationId: input.organizationId,
    });
  if (candidates.length === 0) return null;

  // 0) Existing relationship wins when that user is still an active candidate.
  const related = await resolveExistingRelationshipOwner({
    organizationId,
    contactId: input.contactId,
    companyId: input.companyId,
    locationId: input.locationId,
  });
  if (related) {
    const hit = candidates.find((c) => c.id === related.userId);
    if (hit && hit.acceptingLeads && !hit.onPto) {
      return {
        userId: hit.id,
        role: hit.role,
        name: hit.displayName,
        matchedRegion: false,
        reason: `existing relationship (${related.source})`,
      };
    }
  }

  let pool = [...candidates];

  const businessType = input.businessType ?? null;
  if (businessType) {
    const typed = pool.filter(
      (r) => (r.businessType ?? "").trim().toLowerCase() === businessType,
    );
    if (typed.length > 0) pool = typed;
  }

  const country = input.country?.trim().toLowerCase() || null;
  let matchedRegion = false;
  if (country) {
    const regional = pool.filter(
      (r) => (r.country ?? "").trim().toLowerCase() === country,
    );
    if (regional.length > 0) {
      pool = regional;
      matchedRegion = true;
    }
  }

  const nonAdmin = pool.filter((r) => r.role !== "admin");
  if (nonAdmin.length > 0) pool = nonAdmin;

  // Capacity: accepting leads, not on PTO, under max open deals.
  // If nobody is eligible, return null so Assignment Agent can escalate
  // (never silently assign overloaded / PTO / not-accepting reps).
  const available = pool.filter((c) => {
    if (!c.acceptingLeads || c.onPto) return false;
    if (c.maxOpenDeals != null && c.openDealCount >= c.maxOpenDeals) return false;
    return true;
  });
  if (available.length === 0) return null;
  pool = available;

  return pickFromPool(pool, {
    estimatedAmount: input.estimatedAmount ?? null,
    seniorAmountThreshold,
    matchedRegion,
    country: input.country?.trim() || null,
  });
}
