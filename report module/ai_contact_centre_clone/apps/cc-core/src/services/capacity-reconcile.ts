import type { PrismaClient } from "@ai-contact-center/db-cc";

import { withOrganizationContext } from "../lib/rls.js";

let capacityTimer: NodeJS.Timeout | null = null;

type CapacityDriftRow = {
  organization_id: string;
  agent_id: string;
  channel: string;
  reserved_count: number;
  active_count: number;
  actual_reserved: number;
  actual_active: number;
};

/**
 * Recompute reserved/active capacity from open assignments and repair drift.
 */
export async function reconcileAgentCapacity(prisma: PrismaClient): Promise<number> {
  const drifts = await prisma.$queryRaw<CapacityDriftRow[]>`
    WITH actuals AS (
      SELECT
        ca.organization_id,
        ca.agent_id,
        CASE
          WHEN c.channel = 'email' THEN 'email'
          WHEN c.channel = 'whatsapp' THEN 'whatsapp'
          WHEN c.channel = 'instagram' THEN 'instagram'
          WHEN c.channel = 'facebook' THEN 'facebook'
          ELSE 'chat'
        END AS channel,
        COUNT(*) FILTER (WHERE ca.state = 'offered')::int AS actual_reserved,
        COUNT(*) FILTER (WHERE ca.state = 'accepted')::int AS actual_active
      FROM ccass.conversation_assignments ca
      INNER JOIN ccass.conversations c ON c.id = ca.conversation_id
      WHERE ca.state IN ('offered', 'accepted')
      GROUP BY 1, 2, 3
    )
    SELECT
      ac.organization_id,
      ac.agent_id,
      ac.channel,
      ac.reserved_count,
      ac.active_count,
      COALESCE(a.actual_reserved, 0) AS actual_reserved,
      COALESCE(a.actual_active, 0) AS actual_active
    FROM ccass.agent_capacity ac
    LEFT JOIN actuals a
      ON a.organization_id = ac.organization_id
     AND a.agent_id = ac.agent_id
     AND a.channel = ac.channel
    WHERE ac.reserved_count <> COALESCE(a.actual_reserved, 0)
       OR ac.active_count <> COALESCE(a.actual_active, 0)
    LIMIT 200
  `;

  let repaired = 0;
  for (const row of drifts) {
    await withOrganizationContext(prisma, row.organization_id, async (db) => {
      await db.$executeRaw`
        UPDATE ccass.agent_capacity
        SET
          reserved_count = ${row.actual_reserved},
          active_count = ${row.actual_active},
          updated_at = NOW()
        WHERE agent_id = ${row.agent_id}::bigint
          AND channel = ${row.channel}
      `;
    });
    repaired += 1;
  }
  return repaired;
}

export function startCapacityReconciler(
  getPrisma: () => PrismaClient,
  log?: { error: (obj: unknown, msg: string) => void },
): void {
  if (capacityTimer) return;
  const intervalMs = Number(process.env.CAPACITY_RECONCILE_INTERVAL_MS ?? 30_000);
  const run = () => {
    void reconcileAgentCapacity(getPrisma()).catch((error) => {
      log?.error({ err: error }, "capacity reconcile failed");
    });
  };
  run();
  capacityTimer = setInterval(run, Math.max(5_000, intervalMs));
  capacityTimer.unref();
}
