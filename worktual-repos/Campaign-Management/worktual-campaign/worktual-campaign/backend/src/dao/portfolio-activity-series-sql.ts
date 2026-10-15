// @ts-nocheck
/**
 * SQL aggregation for activity series (scalable vs recipient scan).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import {
  campaignTenantWhere,
  resolveCampaignDataScope,
} from "../helpers/campaign-visibility.js";

type DayRow = { day: string; n: bigint };

export async function fetchActivitySeriesSql(input: {
  session: CampaignSessionUser;
  start: Date;
  end: Date;
  allowedChannels: Set<string> | null;
}): Promise<{
  sentFailedByDay: Map<string, { sent: number; failed: number }>;
  opensByDay: Map<string, number>;
  clicksByDay: Map<string, number>;
}> {
  const tenant = campaignTenantWhere(input.session);
  const scope = resolveCampaignDataScope(input.session);
  const orgId = BigInt(String(tenant.organizationId));
  const branchId = BigInt(String(tenant.branchId));
  const channels =
    input.allowedChannels?.size ? [...input.allowedChannels] : null;

  const scopeSql =
    scope === "mine" && tenant.createdByUserId
      ? Prisma.sql`AND c.created_by_user_id = ${BigInt(String(tenant.createdByUserId))}`
      : Prisma.sql``;

  const channelSql = channels?.length
    ? Prisma.sql`AND b.channel IN (${Prisma.join(channels)})`
    : Prisma.sql``;

  const sentFailed = await prisma.$queryRaw<DayRow[]>`
    SELECT
      to_char(timezone('Asia/Kolkata', r.updated_at), 'YYYY-MM-DD') AS day,
      COUNT(*)::bigint AS n
    FROM campaign_send_recipients r
    INNER JOIN campaign_send_batches b ON b.id = r.batch_id
    INNER JOIN campaigns c ON c.id = r.campaign_id
    WHERE c.organization_id = ${orgId}
      AND c.branch_id = ${branchId}
      ${scopeSql}
      ${channelSql}
      AND r.updated_at >= ${input.start}
      AND r.updated_at <= ${input.end}
      AND LOWER(r.status) IN ('sent', 'delivered')
      AND (
        r.provider_message_id IS NULL
        OR LOWER(r.provider_message_id) NOT LIKE 'stub%'
      )
    GROUP BY 1
  `;

  const failedRows = await prisma.$queryRaw<DayRow[]>`
    SELECT
      to_char(timezone('Asia/Kolkata', r.updated_at), 'YYYY-MM-DD') AS day,
      COUNT(*)::bigint AS n
    FROM campaign_send_recipients r
    INNER JOIN campaign_send_batches b ON b.id = r.batch_id
    INNER JOIN campaigns c ON c.id = r.campaign_id
    WHERE c.organization_id = ${orgId}
      AND c.branch_id = ${branchId}
      ${scopeSql}
      ${channelSql}
      AND r.updated_at >= ${input.start}
      AND r.updated_at <= ${input.end}
      AND LOWER(r.status) IN ('failed', 'cancelled')
    GROUP BY 1
  `;

  const openRows = await prisma.$queryRaw<DayRow[]>`
    SELECT
      to_char(timezone('Asia/Kolkata', r.opened_at), 'YYYY-MM-DD') AS day,
      COUNT(*)::bigint AS n
    FROM campaign_send_recipients r
    INNER JOIN campaign_send_batches b ON b.id = r.batch_id
    INNER JOIN campaigns c ON c.id = r.campaign_id
    WHERE c.organization_id = ${orgId}
      AND c.branch_id = ${branchId}
      ${scopeSql}
      ${channelSql}
      AND r.opened_at IS NOT NULL
      AND r.opened_at >= ${input.start}
      AND r.opened_at <= ${input.end}
    GROUP BY 1
  `;

  const clickRows = await prisma.$queryRaw<DayRow[]>`
    SELECT
      to_char(timezone('Asia/Kolkata', r.clicked_at), 'YYYY-MM-DD') AS day,
      COUNT(*)::bigint AS n
    FROM campaign_send_recipients r
    INNER JOIN campaign_send_batches b ON b.id = r.batch_id
    INNER JOIN campaigns c ON c.id = r.campaign_id
    WHERE c.organization_id = ${orgId}
      AND c.branch_id = ${branchId}
      ${scopeSql}
      ${channelSql}
      AND r.clicked_at IS NOT NULL
      AND r.clicked_at >= ${input.start}
      AND r.clicked_at <= ${input.end}
    GROUP BY 1
  `;

  const sentFailedByDay = new Map<string, { sent: number; failed: number }>();
  for (const row of sentFailed) {
    const day = String(row.day);
    const prev = sentFailedByDay.get(day) || { sent: 0, failed: 0 };
    prev.sent += Number(row.n);
    sentFailedByDay.set(day, prev);
  }
  for (const row of failedRows) {
    const day = String(row.day);
    const prev = sentFailedByDay.get(day) || { sent: 0, failed: 0 };
    prev.failed += Number(row.n);
    sentFailedByDay.set(day, prev);
  }
  const opensByDay = new Map<string, number>();
  for (const row of openRows) {
    opensByDay.set(String(row.day), Number(row.n));
  }
  const clicksByDay = new Map<string, number>();
  for (const row of clickRows) {
    clicksByDay.set(String(row.day), Number(row.n));
  }
  return { sentFailedByDay, opensByDay, clicksByDay };
}
