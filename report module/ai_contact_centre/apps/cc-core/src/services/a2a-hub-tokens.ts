import { z } from "zod";

import type { DbClient } from "../lib/rls.js";

export const HUB_A2A_SERVER_NAME = "worktual-hub";
export const CCAAS_HUB_CLIENT_ID = "worktual-ccaas-hub";

export const upsertHubOutboundTokenSchema = z.object({
  organizationId: z.union([z.string(), z.number()]).transform(String),
  a2aServerName: z.string().min(1).max(128).default(HUB_A2A_SERVER_NAME),
  clientId: z.string().min(1).max(128).default(CCAAS_HUB_CLIENT_ID),
  accessToken: z.string().min(16),
  accessExpiresAt: z.string().datetime(),
  refreshToken: z.string().min(16).optional(),
  refreshExpiresAt: z.string().datetime().optional(),
  skillVersion: z.string().max(64).optional(),
});

function orgIdBigInt(organizationId: string): bigint {
  return BigInt(organizationId);
}

function mapRow(row: {
  a2a_server_name: string;
  client_id: string;
  organization_id: bigint;
  access_token: string | null;
  access_expires_at: Date | null;
  refresh_token: string | null;
  refresh_expires_at: Date | null;
  skill_version: string | null;
  updated_at: Date;
}) {
  return {
    a2aServerName: row.a2a_server_name,
    clientId: row.client_id,
    organizationId: String(row.organization_id),
    accessToken: row.access_token ?? "",
    accessExpiresAt: row.access_expires_at?.toISOString() ?? null,
    refreshToken: row.refresh_token ?? null,
    refreshExpiresAt: row.refresh_expires_at?.toISOString() ?? null,
    skillVersion: row.skill_version ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getHubOutboundToken(
  db: DbClient,
  organizationId: string,
  options?: { a2aServerName?: string; clientId?: string },
) {
  const a2aServerName = options?.a2aServerName ?? HUB_A2A_SERVER_NAME;
  const clientId = options?.clientId ?? CCAAS_HUB_CLIENT_ID;
  const rows = await db.$queryRawUnsafe<
    Array<{
      a2a_server_name: string;
      client_id: string;
      organization_id: bigint;
      access_token: string | null;
      access_expires_at: Date | null;
      refresh_token: string | null;
      refresh_expires_at: Date | null;
      skill_version: string | null;
      updated_at: Date;
    }>
  >(
    `SELECT a2a_server_name, client_id, organization_id,
            access_token, access_expires_at, refresh_token, refresh_expires_at,
            skill_version, updated_at
     FROM accounts.a2a_spoke_clients
     WHERE organization_id = $1
       AND a2a_server_name = $2
       AND client_id = $3
     LIMIT 1`,
    orgIdBigInt(organizationId),
    a2aServerName,
    clientId,
  );
  const row = rows[0];
  if (!row || !row.access_token) return null;
  return mapRow(row);
}

export async function upsertHubOutboundToken(
  db: DbClient,
  input: z.infer<typeof upsertHubOutboundTokenSchema>,
) {
  await db.$executeRawUnsafe(
    `INSERT INTO accounts.a2a_spoke_clients (
       a2a_server_name, client_id, organization_id,
       access_token, access_expires_at, refresh_token, refresh_expires_at,
       skill_version, updated_at
     ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7::timestamptz, $8, NOW())
     ON CONFLICT (a2a_server_name, client_id)
     DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       access_token = EXCLUDED.access_token,
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_token = COALESCE(EXCLUDED.refresh_token, accounts.a2a_spoke_clients.refresh_token),
       refresh_expires_at = COALESCE(
         EXCLUDED.refresh_expires_at,
         accounts.a2a_spoke_clients.refresh_expires_at
       ),
       skill_version = COALESCE(EXCLUDED.skill_version, accounts.a2a_spoke_clients.skill_version),
       updated_at = NOW()`,
    input.a2aServerName,
    input.clientId,
    orgIdBigInt(input.organizationId),
    input.accessToken,
    input.accessExpiresAt,
    input.refreshToken ?? null,
    input.refreshExpiresAt ?? null,
    input.skillVersion ?? null,
  );

  return {
    organizationId: input.organizationId,
    a2aServerName: input.a2aServerName,
    clientId: input.clientId,
    accessExpiresAt: input.accessExpiresAt,
    updated: true,
  };
}
