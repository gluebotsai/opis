/**
 * Semrush MCP sync → crm.seo_projects / seo_tool_snapshots.
 * Weekly Monday 04:00 IST: first Semrush project only, top-5 rows per tool.
 */

import {
  getSemrushAppConnection,
  listOrgIdsWithSemrushConnections,
  updateSetupAppConnectionTokens,
} from "@/dao/account/setup-app-connections";
import {
  upsertSeoProject,
  upsertSeoToolSnapshot,
} from "@/dao/seo/seo-store";
import { getPrismaClient } from "@/dao/db/prisma";

const AI_BASE =
  process.env.AI_SERVICE_BASE_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

/** Hard kill switch — default OFF. Only `true`/`1`/`on` allows Semrush MCP calls. */
export function isSemrushMcpEnabled(): boolean {
  const raw = process.env.SEMRUSH_MCP_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
}

const SEMRUSH_DISABLED_MSG =
  "Semrush MCP is disconnected. Live Semrush calls are disabled until explicitly re-enabled (SEMRUSH_MCP_ENABLED) with owner permission.";

/** Live Semrush tools we persist. `projects` is ingest/list only. */
const ALLOWED_SNAPSHOT_TOOLS = new Set([
  "projects",
  "keyword_research",
  "organic_research",
  "competitors_research",
  "position_tracking",
  "audience_research",
  "site_audit",
  "backlinks_research",
  "traffic_overview",
  "paid_search_research",
  "domain_overview",
]);

function internalHeaders(): Record<string, string> {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) headers["x-internal-secret"] = secret;
  return headers;
}

export type SemrushSyncOrgResult = {
  organizationId: string;
  ok: boolean;
  error?: string | null;
  projectCount: number;
  snapshotCount: number;
  mcpError?: boolean;
};

async function callAiSemrushSync(input: {
  organizationId: string;
  connection: {
    mcpUrl: string | null;
    oauthClientId: string | null;
    scopes: string | null;
    accessToken: string | null;
    refreshToken: string | null;
  };
}): Promise<{
  ok: boolean;
  error?: string | null;
  mcpError?: boolean;
  projects?: Array<{
    externalProjectId: string;
    domain?: string | null;
    market?: string | null;
    raw?: unknown;
  }>;
  snapshots?: Array<{
    externalProjectId: string;
    toolName: string;
    payload?: unknown;
    error?: string | null;
  }>;
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
    mcpUrl?: string;
  } | null;
  mcpUrl?: string;
  apiUnitsRequired?: boolean;
}> {
  const res = await fetch(`${AI_BASE}/ai/v1/internal/semrush/sync`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      organizationId: input.organizationId,
      connection: input.connection,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error:
        typeof data.error === "string"
          ? data.error
          : `Semrush sync failed (HTTP ${res.status})`,
      mcpError: true,
    };
  }
  return data as ReturnType<typeof callAiSemrushSync> extends Promise<infer R>
    ? R
    : never;
}

export async function syncSemrushForOrganization(
  organizationId: string,
  _opts?: { adHocDomain?: string | null },
): Promise<SemrushSyncOrgResult> {
  if (!isSemrushMcpEnabled()) {
    return {
      organizationId,
      ok: false,
      error: SEMRUSH_DISABLED_MSG,
      projectCount: 0,
      snapshotCount: 0,
      mcpError: true,
    };
  }

  const conn = await getSemrushAppConnection(organizationId);
  if (!conn) {
    return {
      organizationId,
      ok: false,
      error:
        "No Semrush connection found for this organization. Connect Semrush in Accounts first.",
      projectCount: 0,
      snapshotCount: 0,
    };
  }

  const result = await callAiSemrushSync({
    organizationId,
    connection: {
      mcpUrl: conn.mcpUrl,
      oauthClientId: conn.oauthClientId,
      scopes: conn.scopes,
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
    },
  });

  if (result.tokens?.accessToken) {
    try {
      await updateSetupAppConnectionTokens({
        connectionId: conn.id,
        organizationId,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken ?? null,
        mcpUrl: result.tokens.mcpUrl ?? result.mcpUrl ?? null,
      });
    } catch (err) {
      console.error(
        "[seo-semrush-sync] token writeback failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!result.ok) {
    return {
      organizationId,
      ok: false,
      error: result.error || "Semrush sync failed",
      projectCount: 0,
      snapshotCount: 0,
      mcpError: Boolean(result.mcpError),
    };
  }

  // When Semrush reports insufficient API units mid-run, keep existing CRM cache
  // instead of overwriting good snapshots with unit-limit error payloads.
  if (result.apiUnitsRequired) {
    return {
      organizationId,
      ok: false,
      error:
        result.error ||
        "Semrush MCP needs more API units. Visit https://www.semrush.com/mcp-access",
      projectCount: 0,
      snapshotCount: 0,
      mcpError: true,
    };
  }

  let projectCount = 0;
  const firstProject = (result.projects || [])[0] ?? null;
  if (firstProject) {
    await upsertSeoProject({
      organizationId,
      externalProjectId: firstProject.externalProjectId,
      domain: firstProject.domain ?? null,
      market: firstProject.market ?? null,
      raw: (firstProject.raw as object) ?? {},
    });
    projectCount = 1;
  }

  const keepIds = new Set<string>(["_org_"]);
  if (firstProject?.externalProjectId) {
    keepIds.add(firstProject.externalProjectId);
  }

  let snapshotCount = 0;
  for (const s of result.snapshots || []) {
    if (!ALLOWED_SNAPSHOT_TOOLS.has(s.toolName)) continue;
    if (!keepIds.has(s.externalProjectId)) continue;
    await upsertSeoToolSnapshot({
      organizationId,
      externalProjectId: s.externalProjectId,
      toolName: s.toolName,
      payload: (s.payload as object) ?? null,
      error: s.error ?? null,
    });
    snapshotCount += 1;
  }

  await markSeoSyncWeek(organizationId);

  return {
    organizationId,
    ok: true,
    error: null,
    projectCount,
    snapshotCount,
  };
}

function istWallClock(now = new Date()): {
  weekday: string;
  hour: number;
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

/** ISO week key for the IST calendar date, e.g. 2026-W36. */
function istIsoWeekKey(now = new Date()): string {
  const { year, month, day } = istWallClock(now);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const isoYear = utc.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((utc.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Once-per-ISO-week marker in CRM (Asia/Kolkata week key). */
async function markSeoSyncWeek(organizationId: string): Promise<void> {
  const prisma = getPrismaClient();
  const weekKey = istIsoWeekKey();
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO crm.seo_tool_snapshots (
      id, organization_id, external_project_id, tool_name, payload, error, fetched_at, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, '_meta_', 'sync_day_marker', $3::jsonb, NULL, NOW(), NOW(), NOW()
    )
    ON CONFLICT (organization_id, external_project_id, tool_name) DO UPDATE SET
      payload = EXCLUDED.payload,
      fetched_at = NOW(),
      updated_at = NOW()
    `,
    `seom_${organizationId}_${weekKey}`.slice(0, 60),
    organizationId,
    JSON.stringify({ weekKey, timezone: "Asia/Kolkata" }),
  );
}

async function alreadySyncedThisWeek(organizationId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const weekKey = istIsoWeekKey();
  const rows = await prisma.$queryRawUnsafe<{ payload: { weekKey?: string } }[]>(
    `SELECT payload FROM crm.seo_tool_snapshots
     WHERE organization_id = $1::bigint
       AND external_project_id = '_meta_'
       AND tool_name = 'sync_day_marker'
     LIMIT 1`,
    organizationId,
  );
  const payload = rows[0]?.payload;
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as { weekKey?: string }).weekKey === weekKey,
  );
}

/**
 * Hourly sweep: only runs when Asia/Kolkata is Monday 04:00 and this ISO week
 * has not been synced yet. Bootstrap ignores the hour gate but still syncs
 * the first Semrush project only (no other-website fetch).
 */
export async function processSeoSemrushWeeklySweep(): Promise<{
  skipped: boolean;
  reason?: string;
  results: SemrushSyncOrgResult[];
}> {
  if (!isSemrushMcpEnabled()) {
    return { skipped: true, reason: "semrush_mcp_disabled", results: [] };
  }

  const { weekday, hour } = istWallClock();
  if (weekday !== "Mon" || hour !== 4) {
    return { skipped: true, reason: "not_monday_04_ist", results: [] };
  }

  const orgIds = await listOrgIdsWithSemrushConnections(200);
  const results: SemrushSyncOrgResult[] = [];
  for (const organizationId of orgIds) {
    if (await alreadySyncedThisWeek(organizationId)) {
      results.push({
        organizationId,
        ok: true,
        error: "already_synced_this_week",
        projectCount: 0,
        snapshotCount: 0,
      });
      continue;
    }
    results.push(await syncSemrushForOrganization(organizationId));
  }
  return { skipped: false, results };
}

/** @deprecated Use processSeoSemrushWeeklySweep */
export const processSeoSemrushDailySweep = processSeoSemrushWeeklySweep;

/** Bootstrap / ops: sync one org or all Semrush-connected orgs (ignores hour gate). */
export async function processSeoSemrushBootstrap(opts?: {
  organizationId?: string | null;
  adHocDomain?: string | null;
}): Promise<{ results: SemrushSyncOrgResult[] }> {
  if (opts?.organizationId?.trim()) {
    return {
      results: [
        await syncSemrushForOrganization(opts.organizationId.trim(), {
          adHocDomain: opts.adHocDomain,
        }),
      ],
    };
  }
  const orgIds = await listOrgIdsWithSemrushConnections(200);
  const results: SemrushSyncOrgResult[] = [];
  for (const organizationId of orgIds) {
    results.push(
      await syncSemrushForOrganization(organizationId, {
        adHocDomain: opts?.adHocDomain,
      }),
    );
  }
  return { results };
}
