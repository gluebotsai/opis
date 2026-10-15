/**
 * Stall detection — quiet leads / stuck deals / missing meetings / propose without proposal.
 * High-risk stage changes stay confirm-gated elsewhere; this only flags + notifies
 * with coworker seed tools (compose / schedule / draft proposal).
 */

import { prisma } from "@/dao/db/prisma";
import { notifyOwnerOrAdmins } from "@/dao/notifications/notify-users";
import { hasActionableContactIdentity } from "@/lib/contact-name";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

const DAY_MS = 24 * 60 * 60_000;

async function listTenantOrganizationIds(): Promise<string[]> {
  const rows = await prisma.contactProfile.findMany({
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  return rows
    .map((r) => r.organizationId)
    .filter((id): id is string => Boolean(id?.trim()));
}

export async function processLifecycleStallFlags(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ flagged: number }> {
  if (options?.organizationId === undefined) {
    const orgIds = await listTenantOrganizationIds();
    let flagged = 0;
    for (const organizationId of orgIds) {
      const result = await flagStallsForOrganization(
        organizationId,
        options?.limit,
      );
      flagged += result.flagged;
    }
    return { flagged };
  }
  const organizationId = await resolveRequestOrganizationId(
    options.organizationId,
  );
  return flagStallsForOrganization(organizationId, options?.limit);
}

async function clearReviewFlag(contactId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
    UPDATE contact_profiles SET
      flagged_for_review = false,
      flag_reason = NULL,
      updated_at = NOW()
    WHERE account_contact_id = $1::text
      AND COALESCE(flagged_for_review, false) = true
    `,
    contactId,
  );
}

async function clearIncompleteReviewFlags(
  organizationId: string,
): Promise<void> {
  const flagged = await prisma.contactProfile.findMany({
    where: {
      organizationId,
      flaggedForReview: true,
    },
    select: { accountContactId: true },
    take: 200,
  });
  if (flagged.length === 0) return;

  const { getPeopleByIds } = await import("@/dao/account/account-repository");
  const people = await getPeopleByIds(flagged.map((row) => row.accountContactId));
  const byId = new Map(people.map((person) => [person.id, person]));

  for (const row of flagged) {
    const person = byId.get(row.accountContactId);
    if (!person) continue;
    if (
      hasActionableContactIdentity(
        person.firstName,
        person.lastName,
        person.email,
        person.phone,
      )
    ) {
      continue;
    }
    await clearReviewFlag(row.accountContactId).catch(() => null);
  }
}

async function flagContact(
  contactId: string,
  reason: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
    UPDATE contact_profiles SET
      flagged_for_review = true,
      flag_reason = $2,
      lifecycle_last_action = 'flag_for_review',
      lifecycle_last_reason = $2,
      lifecycle_last_run_at = NOW(),
      updated_at = NOW()
    WHERE account_contact_id = $1::text
    `,
    contactId,
    reason,
  );
}

async function flagStallsForOrganization(
  organizationId: string,
  limitOption?: number,
): Promise<{ flagged: number }> {
  const limit = Math.min(200, Math.max(1, limitOption ?? 50));
  let flagged = 0;

  await clearIncompleteReviewFlags(organizationId);

  // Leads with no activity in 14+ days.
  const quiet = await prisma.$queryRawUnsafe<
    Array<{
      account_contact_id: string;
      owner_user_id: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>
  >(
    `
    SELECT cp.account_contact_id::text, cp.owner_user_id::text,
           p.first_name, p.last_name,
           (
             SELECT k.key_value FROM cdp.identity_keys k
             WHERE k.cdp_id = p.cdp_id AND k.key_type = 'email'
             ORDER BY k.created_at ASC NULLS LAST
             LIMIT 1
           ) AS email,
           (
             SELECT k.key_value FROM cdp.identity_keys k
             WHERE k.cdp_id = p.cdp_id AND k.key_type = 'phone'
             ORDER BY k.created_at ASC NULLS LAST
             LIMIT 1
           ) AS phone
    FROM contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    WHERE cp.organization_id = $1::bigint
      AND cp.crm_status = 'active'
      AND COALESCE(cp.flagged_for_review, false) = false
      AND cp.lead_status NOT IN ('converted', 'disqualified')
      AND NOT EXISTS (
        SELECT 1 FROM contact_activities a
        WHERE a.contact_id = cp.account_contact_id
          AND a.created_at > NOW() - INTERVAL '14 days'
      )
    LIMIT $2
    `,
    organizationId,
    limit,
  );

  for (const row of quiet) {
    if (
      !hasActionableContactIdentity(
        row.first_name,
        row.last_name,
        row.email,
        row.phone,
      )
    ) {
      continue;
    }
    await flagContact(
      row.account_contact_id,
      "No activity for 14+ days — lead gone quiet",
    );
    if (row.owner_user_id) {
      notifyOwnerOrAdmins({
        organizationId,
        ownerUserId: row.owner_user_id,
        kind: "lifecycle_stall",
        title: "Lead gone quiet",
        body: "No activity for 14+ days — check in or schedule a meeting.",
        href: `/contact/${row.account_contact_id}?coworker=compose`,
        contactId: row.account_contact_id,
        metadata: {
          seedTools: [
            {
              name: "navigate",
              args: {
                href: `/inbox?compose=1&contactId=${row.account_contact_id}`,
                seedPrompt: "Draft a check-in email for this quiet lead",
              },
            },
            {
              name: "navigate",
              args: {
                href: `/contact/${row.account_contact_id}`,
                seedPrompt: "Schedule a follow-up meeting",
              },
            },
          ],
          risk: "low",
        },
      }).catch(() => null);
    }
    flagged += 1;
  }

  // Deals stuck in same stage 21+ days (open stages only).
  const stuck = await prisma.deal.findMany({
    where: {
      organizationId,
      stage: { in: ["qualification", "discover", "propose", "negotiate"] },
      updatedAt: { lt: new Date(Date.now() - 21 * DAY_MS) },
    },
    take: limit,
    select: {
      id: true,
      title: true,
      stage: true,
      ownerUserId: true,
      contactId: true,
    },
  });

  for (const deal of stuck) {
    if (deal.contactId) {
      await flagContact(
        deal.contactId,
        `Deal stuck in ${deal.stage} for 21+ days`,
      );
    }
    if (deal.ownerUserId) {
      const seedTools =
        deal.stage === "propose"
          ? [
              {
                name: "propose_create_proposal",
                args: { dealId: deal.id, label: "Draft proposal" },
              },
            ]
          : [
              {
                name: "navigate",
                args: {
                  href: `/sales/${deal.id}`,
                  seedPrompt: "Suggest next step and schedule a meeting",
                },
              },
            ];
      notifyOwnerOrAdmins({
        organizationId,
        ownerUserId: deal.ownerUserId,
        kind: "lifecycle_stall",
        title: "Deal not moving",
        body: `"${deal.title}" has been in ${deal.stage} for 21+ days.`,
        href: `/sales/${deal.id}`,
        entityType: "deal",
        entityId: deal.id,
        contactId: deal.contactId,
        metadata: { seedTools, risk: "low", confirmForStageChange: true },
      }).catch(() => null);
    }
    flagged += 1;
  }

  // Propose-stage deals with no proposal document.
  const proposeNoDoc = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      title: string;
      owner_user_id: string | null;
      contact_id: string | null;
    }>
  >(
    `
    SELECT d.id, d.title, d.owner_user_id::text, d.contact_id::text
    FROM deals d
    WHERE d.organization_id = $1::bigint
      AND d.stage = 'propose'
      AND d.updated_at < NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM proposals p WHERE p.deal_id = d.id
      )
    LIMIT $2
    `,
    organizationId,
    limit,
  );

  for (const deal of proposeNoDoc) {
    if (deal.contact_id) {
      await flagContact(
        deal.contact_id,
        "Propose stage with no proposal document",
      );
    }
    if (deal.owner_user_id) {
      notifyOwnerOrAdmins({
        organizationId,
        ownerUserId: deal.owner_user_id,
        kind: "lifecycle_stall",
        title: "Proposal missing",
        body: `"${deal.title}" is in propose but has no proposal yet.`,
        href: `/sales/${deal.id}`,
        entityType: "deal",
        entityId: deal.id,
        contactId: deal.contact_id,
        metadata: {
          seedTools: [
            {
              name: "propose_create_proposal",
              args: {
                dealId: deal.id,
                label: "Create proposal",
                confirmed: false,
              },
            },
          ],
          risk: "high",
          confirmRequired: true,
        },
      }).catch(() => null);
    }
    flagged += 1;
  }

  // Open deals with no upcoming meeting on the contact timeline.
  const noMeeting = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      title: string;
      owner_user_id: string | null;
      contact_id: string;
    }>
  >(
    `
    SELECT d.id, d.title, d.owner_user_id::text, d.contact_id::text
    FROM deals d
    WHERE d.organization_id = $1::bigint
      AND d.stage IN ('qualification', 'discover', 'propose', 'negotiate')
      AND d.contact_id IS NOT NULL
      AND d.updated_at < NOW() - INTERVAL '10 days'
      AND NOT EXISTS (
        SELECT 1 FROM contact_activities a
        WHERE a.contact_id = d.contact_id
          AND a.type = 'meeting'
          AND a.due_at IS NOT NULL
          AND a.due_at > NOW()
      )
    LIMIT $2
    `,
    organizationId,
    limit,
  );

  for (const deal of noMeeting) {
    await flagContact(
      deal.contact_id,
      "Open deal with no upcoming meeting scheduled",
    );
    if (deal.owner_user_id) {
      notifyOwnerOrAdmins({
        organizationId,
        ownerUserId: deal.owner_user_id,
        kind: "lifecycle_stall",
        title: "No next meeting",
        body: `"${deal.title}" has no upcoming meeting — schedule one.`,
        href: `/sales/${deal.id}`,
        entityType: "deal",
        entityId: deal.id,
        contactId: deal.contact_id,
        metadata: {
          seedTools: [
            {
              name: "navigate",
              args: {
                href: `/contact/${deal.contact_id}`,
                seedPrompt: "Log or schedule the next meeting for this deal",
              },
            },
          ],
          risk: "low",
        },
      }).catch(() => null);
    }
    flagged += 1;
  }

  return { flagged };
}
