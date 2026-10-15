/**
 * Nightly org funnel snapshot sweep — same payload as manual refresh on dashboard.
 */

import { prisma } from "@/dao/db/prisma";
import { generateFunnelSnapshot } from "@/dao/reports/report-service";

const HOUR_MS = 60 * 60_000;

function sweepIntervalHours(): number {
  const raw = process.env.FUNNEL_SNAPSHOT_CRON_HOURS?.trim();
  const n = raw ? Number.parseFloat(raw) : 24;
  return Number.isFinite(n) && n > 0 ? n : 24;
}

async function listTenantOrganizationIds(): Promise<string[]> {
  const rows = await prisma.contactProfile.findMany({
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  return rows
    .map((r) => r.organizationId)
    .filter((id): id is string => Boolean(id?.trim()));
}

export function funnelSnapshotSweepIntervalMs(): number {
  return sweepIntervalHours() * HOUR_MS;
}

export async function processFunnelSnapshotSweep(options?: {
  organizationId?: string | null;
}): Promise<{ organizations: number; snapshots: number }> {
  const orgIds = options?.organizationId
    ? [options.organizationId]
    : await listTenantOrganizationIds();

  let snapshots = 0;
  for (const organizationId of orgIds) {
    await generateFunnelSnapshot(organizationId);
    snapshots += 1;
  }

  return { organizations: orgIds.length, snapshots };
}
