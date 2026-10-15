/**
 * Organization API keys for public integrations (intake, webhooks later).
 * Plaintext key is shown once at creation; only sha256 hash is stored.
 */
import { createHash, randomBytes } from "crypto";
import { ensureColumn, query } from "./db";

const KEY_PREFIX = "wt_live_";

export async function ensureOrgApiKeysTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.org_api_keys (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      key_prefix       TEXT NOT NULL,
      key_hash         TEXT NOT NULL UNIQUE,
      created_by_id    BIGINT,
      created_by_name  TEXT,
      last_used_at     TIMESTAMPTZ,
      revoked_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_org_api_keys_org
     ON ticketing.org_api_keys(organization_id, created_at DESC)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_org_api_keys_prefix
     ON ticketing.org_api_keys(key_prefix)`
  );
  await ensureColumn("ticketing", "org_api_keys", "key_secret", "TEXT");
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function generateRawKey(): { raw: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  const raw = `${KEY_PREFIX}${secret}`;
  const prefix = raw.slice(0, 16);
  return { raw, prefix, hash: hashKey(raw) };
}

export type OrgApiKeyRow = {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  secret?: string | null;
  createdById: string | null;
  createdByName: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function mapKeyRow(r: Record<string, unknown>): OrgApiKeyRow {
  const secret = r.key_secret ? String(r.key_secret) : "";
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    name: String(r.name),
    keyPrefix: String(r.key_prefix),
    secret: secret || null,
    createdById: r.created_by_id ? String(r.created_by_id) : null,
    createdByName: r.created_by_name ? String(r.created_by_name) : null,
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    revokedAt: r.revoked_at ? String(r.revoked_at) : null,
    createdAt: String(r.created_at),
  };
}

export async function listOrgApiKeys(
  organizationId: string
): Promise<OrgApiKeyRow[]> {
  const { rows } = await query(
    `SELECT id, organization_id, name, key_prefix, key_secret, created_by_id, created_by_name,
            last_used_at, revoked_at, created_at
     FROM ticketing.org_api_keys
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId]
  );
  return rows.map((r) => mapKeyRow(r as Record<string, unknown>));
}

export async function createOrgApiKey(input: {
  organizationId: string;
  name: string;
  createdById?: string | null;
  createdByName?: string | null;
}): Promise<{ key: OrgApiKeyRow; secret: string }> {
  const name = String(input.name || "").trim() || "Integration key";
  const { raw, prefix, hash } = generateRawKey();
  const { rows } = await query(
    `INSERT INTO ticketing.org_api_keys (
       organization_id, name, key_prefix, key_hash, key_secret,
       created_by_id, created_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, organization_id, name, key_prefix, key_secret, created_by_id, created_by_name,
               last_used_at, revoked_at, created_at`,
    [
      input.organizationId,
      name,
      prefix,
      hash,
      raw,
      input.createdById || null,
      input.createdByName || null,
    ]
  );
  return {
    key: mapKeyRow(rows[0] as Record<string, unknown>),
    secret: raw,
  };
}

export async function revokeOrgApiKey(
  organizationId: string,
  keyId: string
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE ticketing.org_api_keys
     SET revoked_at = NOW()
     WHERE organization_id = $1 AND id = $2 AND revoked_at IS NULL`,
    [organizationId, keyId]
  );
  return (rowCount || 0) > 0;
}

export type AuthenticatedApiKey = {
  keyId: string;
  organizationId: string;
  keyName: string;
};

/** Resolve raw API key from Authorization Bearer or X-Api-Key. */
export function extractApiKeyFromRequest(req: {
  headers: Record<string, unknown>;
}): string | null {
  const xKey = String(req.headers["x-api-key"] || "").trim();
  if (xKey) return xKey;
  const auth = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  return null;
}

export async function authenticateOrgApiKey(
  rawKey: string
): Promise<AuthenticatedApiKey | null> {
  const raw = String(rawKey || "").trim();
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
  const hash = hashKey(raw);
  const { rows } = await query(
    `SELECT id, organization_id, name
     FROM ticketing.org_api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL
     LIMIT 1`,
    [hash]
  );
  if (!rows[0]) return null;
  const id = String(rows[0].id);
  await query(
    `UPDATE ticketing.org_api_keys SET last_used_at = NOW() WHERE id = $1`,
    [id]
  ).catch(() => undefined);
  return {
    keyId: id,
    organizationId: String(rows[0].organization_id),
    keyName: String(rows[0].name),
  };
}
