import { createHash } from "node:crypto";
import { z } from "zod";

import type { DbClient } from "../lib/rls.js";

export const upsertA2AOauthTokenSchema = z.object({
  organizationId: z.union([z.string(), z.number()]).transform(String),
  clientId: z.string().min(1).max(128),
  subject: z.string().min(1).max(256),
  jti: z.string().min(8).max(128),
  scopes: z.string().max(4_096).default(""),
  accessToken: z.string().min(16),
  expiresAt: z.string().datetime(),
});

function orgIdBigInt(organizationId: string): bigint {
  return BigInt(organizationId);
}

function tokenHash(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

export async function upsertA2AOauthToken(
  db: DbClient,
  input: z.infer<typeof upsertA2AOauthTokenSchema>,
) {
  const hash = tokenHash(input.accessToken);
  await db.$executeRawUnsafe(
    `INSERT INTO ccass.a2a_oauth_tokens (
       organization_id, client_id, subject, jti, scopes, token_hash, expires_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, NOW())
     ON CONFLICT (client_id, organization_id)
     DO UPDATE SET
       subject = EXCLUDED.subject,
       jti = EXCLUDED.jti,
       scopes = EXCLUDED.scopes,
       token_hash = EXCLUDED.token_hash,
       expires_at = EXCLUDED.expires_at,
       revoked_at = NULL,
       updated_at = NOW()`,
    orgIdBigInt(input.organizationId),
    input.clientId,
    input.subject,
    input.jti,
    input.scopes,
    hash,
    input.expiresAt,
  );

  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    subject: input.subject,
    jti: input.jti,
    scopes: input.scopes,
    expiresAt: input.expiresAt,
    updated: true,
  };
}

export async function getActiveA2AOauthToken(
  db: DbClient,
  organizationId: string,
  clientId: string,
) {
  const rows = await db.$queryRawUnsafe<
    Array<{
      client_id: string;
      subject: string;
      jti: string;
      scopes: string;
      expires_at: Date;
      updated_at: Date;
    }>
  >(
    `SELECT client_id, subject, jti, scopes, expires_at, updated_at
     FROM ccass.a2a_oauth_tokens
     WHERE organization_id = $1
       AND client_id = $2
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    orgIdBigInt(organizationId),
    clientId,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    clientId: row.client_id,
    subject: row.subject,
    jti: row.jti,
    scopes: row.scopes,
    expiresAt: row.expires_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
