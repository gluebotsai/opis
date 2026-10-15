/**
 * Batches conversation-summary refreshes.
 * A new email, call, meeting, message, transcript, or CCaaS paragraph
 * waits about a minute so arrivals in that window are summarized together.
 * The stored summary is replaced only after the model returns cited lines.
 */

import { getPrismaClient } from "@/dao/db/prisma";

const BATCH_SECONDS = 60;
const INTERACTION_TYPES = new Set(["email", "call", "meeting", "sms"]);

export function isConversationActivity(type: string | null | undefined): boolean {
  return INTERACTION_TYPES.has(String(type || ""));
}

export async function isLeadSummaryRefreshQueued(
  organizationId: string,
  contactId: string,
): Promise<boolean> {
  try {
    const prisma = getPrismaClient();
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>(
      `
      SELECT 1 AS ok
      FROM crm.lead_summary_refresh_queue
      WHERE organization_id = $1::bigint AND contact_id = $2::text
      LIMIT 1
      `,
      organizationId,
      contactId,
    );
    return rows.length > 0;
  } catch (err) {
    console.error("lead summary queue read failed", err);
    return false;
  }
}

export async function scheduleLeadSummaryRefresh(input: {
  organizationId: string;
  contactId: string;
}): Promise<void> {
  const organizationId = input.organizationId.trim();
  const contactId = input.contactId.trim();
  if (!organizationId || !contactId) return;
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO crm.lead_summary_refresh_queue (
      organization_id, contact_id, run_after, created_at
    ) VALUES (
      $1::bigint, $2::text, NOW() + ($3::int * INTERVAL '1 second'), NOW()
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      run_after = NOW() + ($3::int * INTERVAL '1 second')
    `,
    organizationId,
    contactId,
    BATCH_SECONDS,
  );
}

async function enqueueChangedOmniSummaries(): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<
    Array<{ organization_id: string; contact_id: string }>
  >(
    `
    SELECT cp.organization_id::text AS organization_id,
           cp.account_contact_id AS contact_id
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    LEFT JOIN crm.lead_summaries ls
      ON ls.organization_id = cp.organization_id
     AND ls.contact_id = cp.account_contact_id
    WHERE BTRIM(COALESCE(p.custom_fields->>'omniChannelSummary', '')) <> ''
      AND p.updated_at > NOW() - INTERVAL '24 hours'
      AND (
        ls.id IS NULL
        OR ls.flags->>'omniHash' IS DISTINCT FROM md5(BTRIM(p.custom_fields->>'omniChannelSummary'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM crm.lead_summary_refresh_queue q
        WHERE q.organization_id = cp.organization_id
          AND q.contact_id = cp.account_contact_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM crm.lead_nurture_jobs nj
        WHERE nj.organization_id = cp.organization_id
          AND nj.contact_id = cp.account_contact_id
          AND nj.next_retry_at > NOW() + INTERVAL '1 year'
      )
    ORDER BY p.updated_at DESC
    LIMIT 40
    `,
  );
  for (const row of rows) {
    await scheduleLeadSummaryRefresh({
      organizationId: row.organization_id,
      contactId: row.contact_id,
    });
  }
  return rows.length;
}

export async function processLeadSummaryRefreshes(): Promise<{
  queued: number;
  refreshed: number;
  failed: number;
}> {
  let queued = 0;
  try {
    queued = await enqueueChangedOmniSummaries();
  } catch (err) {
    console.error("lead summary omni enqueue failed", err);
  }

  const prisma = getPrismaClient();
  const due = await prisma.$queryRawUnsafe<
    Array<{ organization_id: string; contact_id: string }>
  >(
    `
    WITH due AS (
      SELECT q.organization_id, q.contact_id
      FROM crm.lead_summary_refresh_queue q
      WHERE q.run_after <= NOW()
        AND NOT EXISTS (
          SELECT 1 FROM crm.lead_nurture_jobs nj
          WHERE nj.organization_id = q.organization_id
            AND nj.contact_id = q.contact_id
            AND nj.next_retry_at > NOW() + INTERVAL '1 year'
        )
      ORDER BY q.run_after
      LIMIT 5
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM crm.lead_summary_refresh_queue q
    USING due
    WHERE q.organization_id = due.organization_id
      AND q.contact_id = due.contact_id
    RETURNING q.organization_id::text AS organization_id, q.contact_id
    `,
  );

  const { getOrRefreshLeadSummary } = await import("@/service/ai/lead-summary-agent");
  let refreshed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const view = await getOrRefreshLeadSummary(row.contact_id, {
        organizationId: row.organization_id,
        fromQueue: true,
      });
      if (!view?.summary) {
        failed += 1;
        continue;
      }

      refreshed += 1;
      const { enqueueLeadScoring } = await import(
        "@/service/ai/lead-scoring-job"
      );
      await enqueueLeadScoring({
        contactId: row.contact_id,
        organizationId: row.organization_id,
        // The revision makes two summary completions distinguishable while a
        // score job is in flight, so the newer evidence always gets a pass.
        triggerReason: `summary_refreshed:${view.updatedAt}`,
        processImmediately: true,
      });
    } catch (err) {
      failed += 1;
      console.error("lead summary refresh failed", row.contact_id, err);
    }
  }
  return { queued, refreshed, failed };
}
