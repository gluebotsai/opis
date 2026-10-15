import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { upsertIdentityKey, type IdentityKeyType } from "../src/services/cdp-customer-profile.js";
import { consolidateDuplicateOpenCallbacks } from "../src/services/callback-task-dedupe.js";

const organizationId = process.env.ORGANIZATION_ID ?? "1000";
const apply = process.argv.includes("--apply");
const targetRoot = process.argv
  .find((argument) => argument.startsWith("--contact="))
  ?.slice("--contact=".length);

type Edge = { loser_id: string; winner_id: string; occurred_at: Date };
type Profile = { cdp_id: string; merged_into: string | null; is_active: boolean };
type RepairGroup = { winnerId: string; loserIds: string[] };

function resolveRoot(edges: Map<string, string>, start: string): string | null {
  const visited = new Set<string>();
  let current = start;
  while (edges.has(current)) {
    if (visited.has(current)) return null;
    visited.add(current);
    current = edges.get(current)!;
  }
  return current;
}

async function buildRepairGroups(): Promise<RepairGroup[]> {
  const profiles = await ccPrisma.$queryRaw<Profile[]>`
    SELECT
      cdp_id,
      NULLIF(custom_fields->>'mergedInto', '') AS merged_into,
      COALESCE((custom_fields->>'isActive')::boolean, TRUE) AS is_active
    FROM cdp.customer_profile
    WHERE organization_id = ${organizationId}::bigint
  `;
  const profileById = new Map(profiles.map((profile) => [profile.cdp_id, profile]));

  const eventEdges = await ccPrisma.$queryRaw<Edge[]>`
    SELECT DISTINCT ON (metadata->>'loserId')
      metadata->>'loserId' AS loser_id,
      metadata->>'winnerId' AS winner_id,
      occurred_at
    FROM cdp.interaction_events
    WHERE organization_id = ${organizationId}::bigint
      AND event_type = 'contact.merged'
      AND NULLIF(metadata->>'loserId', '') IS NOT NULL
      AND NULLIF(metadata->>'winnerId', '') IS NOT NULL
    ORDER BY metadata->>'loserId', occurred_at DESC
  `;

  const edges = new Map<string, string>();
  for (const edge of eventEdges) edges.set(edge.loser_id, edge.winner_id);
  // Profile state is authoritative when present; immutable events repair
  // profiles whose mergedInto field was accidentally overwritten.
  for (const profile of profiles) {
    if (profile.merged_into) edges.set(profile.cdp_id, profile.merged_into);
  }

  const byWinner = new Map<string, Set<string>>();
  for (const loserId of edges.keys()) {
    const winnerId = resolveRoot(edges, loserId);
    if (!winnerId || winnerId === loserId) continue;
    const winner = profileById.get(winnerId);
    if (!winner || !winner.is_active) continue;
    if (targetRoot && winnerId !== targetRoot) continue;
    const bucket = byWinner.get(winnerId) ?? new Set<string>();
    bucket.add(loserId);
    byWinner.set(winnerId, bucket);
  }

  return [...byWinner.entries()]
    .map(([winnerId, loserIds]) => ({ winnerId, loserIds: [...loserIds].sort() }))
    .sort((left, right) => left.winnerId.localeCompare(right.winnerId));
}

async function preview(groups: RepairGroup[]): Promise<void> {
  console.log(
    JSON.stringify(
      {
        organizationId,
        mode: apply ? "apply" : "dry-run",
        groups,
      },
      null,
      2,
    ),
  );
}

async function applyGroup(group: RepairGroup): Promise<Record<string, number>> {
  const numericLosers = group.loserIds.filter((id) => /^\d+$/.test(id));

  return ccPrisma.$transaction(
    async (db) => {
      await db.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`repair-contact-lineage:${organizationId}:${group.winnerId}`}, 0)
        )
      `;

      const identityKeys = await db.$queryRaw<
        Array<{
          key_type: IdentityKeyType;
          key_value: string;
          source_system: string | null;
        }>
      >`
        SELECT key_type, key_value, source_system
        FROM cdp.identity_keys
        WHERE organization_id = ${organizationId}::bigint
          AND cdp_id = ANY(${group.loserIds}::text[])
      `;
      for (const key of identityKeys) {
        await upsertIdentityKey(
          db,
          organizationId,
          group.winnerId,
          key.key_type,
          key.key_value,
          key.source_system,
        );
      }

      const conversations = numericLosers.length === 0 ? 0 : await db.$executeRaw`
        UPDATE ccass.conversations
        SET contact_id = ${group.winnerId}::bigint, updated_at = NOW()
        WHERE organization_id = ${organizationId}::bigint
          AND contact_id = ANY(${numericLosers}::bigint[])
      `;
      const interactions = numericLosers.length === 0 ? 0 : await db.$executeRaw`
        UPDATE cdp.interactions
        SET contact_id = ${group.winnerId}::bigint, updated_at = NOW()
        WHERE organization_id = ${organizationId}::bigint
          AND contact_id = ANY(${numericLosers}::bigint[])
      `;
      const missedContacts = numericLosers.length === 0 ? 0 : await db.$executeRaw`
        UPDATE ccass.agent_missed_contacts
        SET contact_id = ${group.winnerId}::bigint
        WHERE organization_id = ${organizationId}::bigint
          AND contact_id = ANY(${numericLosers}::bigint[])
      `;
      const tasks = numericLosers.length === 0 ? 0 : await db.$executeRaw`
        UPDATE ccass.agent_tasks
        SET contact_id = ${group.winnerId}::bigint, updated_at = NOW()
        WHERE organization_id = ${organizationId}::bigint
          AND contact_id = ANY(${numericLosers}::bigint[])
      `;
      const attempts = numericLosers.length === 0 ? 0 : await db.$executeRaw`
        UPDATE ccass.proactive_callback_attempts
        SET contact_id = ${group.winnerId}::bigint, updated_at = NOW()
        WHERE organization_id = ${organizationId}::bigint
          AND contact_id = ANY(${numericLosers}::bigint[])
      `;
      const profiles = await db.$executeRaw`
        UPDATE cdp.customer_profile
        SET custom_fields =
              COALESCE(custom_fields, '{}'::jsonb)
              || jsonb_build_object(
                'isActive', false,
                'mergedInto', ${group.winnerId}::text,
                'mergeRepairAt', ${new Date().toISOString()}::text,
                'mergeRepairReason', 'event_lineage_reconciliation'
              ),
            updated_at = NOW()
        WHERE organization_id = ${organizationId}::bigint
          AND cdp_id = ANY(${group.loserIds}::text[])
      `;

      return {
        conversations: Number(conversations),
        interactions: Number(interactions),
        missedContacts: Number(missedContacts),
        tasks: Number(tasks),
        proactiveAttempts: Number(attempts),
        profiles: Number(profiles),
        identityKeys: identityKeys.length,
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

async function main(): Promise<void> {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', false)`;
  await ccPrisma.$executeRaw`
    SELECT set_config('app.organization_id', ${organizationId}, false)
  `;

  const groups = await buildRepairGroups();
  await preview(groups);
  if (!apply) {
    console.log("Dry-run only. Re-run with --apply after reviewing the event-derived mappings.");
    return;
  }

  const results: Array<RepairGroup & { updated: Record<string, number> }> = [];
  for (const group of groups) {
    results.push({ ...group, updated: await applyGroup(group) });
  }
  const duplicateCallbacksDismissed = await consolidateDuplicateOpenCallbacks(
    ccPrisma,
    organizationId,
  );
  console.log(JSON.stringify({ results, duplicateCallbacksDismissed }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
