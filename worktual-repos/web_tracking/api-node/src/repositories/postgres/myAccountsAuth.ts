/**
 * Read-only My Accounts auth (worktual_bigint / accounts schema).
 * Analytics dashboard login uses Setup People (setup_users), not customer_users.
 * See WEB_TRACKING_REFERENCE.md sections 2, 5, 9, 12.
 */

import { Prisma } from "@prisma/client";
import type { AppPrismaClient } from "../../plugins/prisma.js";
import type { AuthUser, WebsiteRow } from "./authTypes.js";

const DEFAULT_SITE_TYPE = "ecommerce";
const WEB_TRACKING_PRODUCT_ID = "web-tracking";

type SetupUserRow = {
  id: bigint | number;
  email: string;
  password_hash: string;
  organization_id: bigint | number | null;
  status: string | null;
  invite_status: string | null;
  password_set_at: Date | null;
  company_name: string | null;
  role_name: string | null;
};

type WebsiteSlotRow = {
  website_id: string;
  website_url: string | null;
  label: string | null;
};

function toNumber(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === "bigint" ? Number(value) : value;
}

function isLoginEligible(row: SetupUserRow): boolean {
  if (!row.password_hash || !row.password_set_at) return false;
  const status = (row.status ?? "").trim().toLowerCase();
  if (status && !["active", "enabled"].includes(status)) return false;
  const invite = (row.invite_status ?? "").trim().toLowerCase();
  if (invite && ["pending", "expired", "revoked"].includes(invite)) return false;
  return true;
}

function displayName(row: SetupUserRow): string {
  return row.company_name?.trim() || row.role_name?.trim() || row.email.split("@")[0] || "User";
}

function parseWebsiteRows(rows: WebsiteSlotRow[]): WebsiteRow[] {
  const out: WebsiteRow[] = [];
  for (const row of rows) {
    const websiteId = Number.parseInt(row.website_id, 10);
    const websiteUrl = (row.website_url ?? "").trim();
    if (!Number.isFinite(websiteId) || websiteId <= 0 || !websiteUrl) continue;
    out.push({
      websiteId,
      websiteUrl,
      siteType: DEFAULT_SITE_TYPE,
      label: row.label,
    });
  }
  out.sort((a, b) => a.websiteUrl.localeCompare(b.websiteUrl));
  return out;
}

const setupUserSelect = Prisma.sql`
  SELECT
    u.id,
    u.work_email AS email,
    u.password_hash,
    u.organization_id,
    u.status,
    u.invite_status,
    u.password_set_at,
    o.company_name,
    r.name AS role_name
  FROM accounts.setup_users u
  LEFT JOIN accounts.organizations o ON o.id = u.organization_id
  LEFT JOIN accounts.setup_user_product_access pa
    ON pa.user_id = u.id AND pa.product_id = ${WEB_TRACKING_PRODUCT_ID}
  LEFT JOIN accounts.setup_roles r ON r.id = pa.role_id
`;

function mapSetupUser(row: SetupUserRow): Omit<AuthUser, "websiteId" | "websiteUrl" | "siteType"> | null {
  if (!isLoginEligible(row)) return null;
  return {
    id: toNumber(row.id) ?? 0,
    email: row.email,
    passwordHash: row.password_hash,
    adminName: displayName(row),
    organizationId: toNumber(row.organization_id),
    createdAt: null,
  };
}

export async function findCustomerByEmail(
  prisma: AppPrismaClient,
  email: string,
): Promise<Omit<AuthUser, "websiteId" | "websiteUrl" | "siteType"> | null> {
  const rows = await prisma.$queryRaw<SetupUserRow[]>(Prisma.sql`
    ${setupUserSelect}
    WHERE lower(u.work_email) = lower(${email})
    LIMIT 1
  `);
  return mapSetupUser(rows[0]);
}

export async function findCustomerById(
  prisma: AppPrismaClient,
  id: number,
): Promise<Omit<AuthUser, "websiteId" | "websiteUrl" | "siteType"> | null> {
  const rows = await prisma.$queryRaw<SetupUserRow[]>(Prisma.sql`
    ${setupUserSelect}
    WHERE u.id = ${id}
    LIMIT 1
  `);
  return mapSetupUser(rows[0]);
}

export async function hasWebTrackingAccess(prisma: AppPrismaClient, userId: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ found: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM accounts.setup_user_product_access pa
      WHERE pa.user_id = ${userId}
        AND pa.product_id = ${WEB_TRACKING_PRODUCT_ID}
    ) AS found
  `);
  return Boolean(rows[0]?.found);
}

/** Websites from subscriptions (live) or active_products + product_go_live (pre-live). */
export async function findWebsitesForOrganization(
  prisma: AppPrismaClient,
  organizationId: number,
): Promise<WebsiteRow[]> {
  const rows = await prisma.$queryRaw<WebsiteSlotRow[]>(Prisma.sql`
    WITH live AS (
      SELECT entitlement_config AS config
      FROM accounts.subscriptions
      WHERE organization_id = ${organizationId}
        AND product_id = ${WEB_TRACKING_PRODUCT_ID}
        AND status <> 'cancelled'
      ORDER BY id DESC
      LIMIT 1
    ),
    prelive AS (
      SELECT ap.config
      FROM accounts.active_products ap
      JOIN accounts.product_go_live pgl
        ON pgl.lead_id = ap.lead_id
       AND pgl.product_id = ap.product_id
       AND pgl.branch_id = ap.branch_id
      WHERE pgl.organization_id = ${organizationId}
        AND ap.product_id = ${WEB_TRACKING_PRODUCT_ID}
      LIMIT 1
    ),
    chosen AS (
      SELECT COALESCE(
        (SELECT config FROM live),
        (SELECT config FROM prelive)
      ) AS config
    )
    SELECT
      slot.key AS website_id,
      slot.value->>'url' AS website_url,
      slot.value->>'label' AS label
    FROM chosen,
    LATERAL jsonb_each(
      CASE
        WHEN jsonb_typeof(chosen.config->'visitorAllowanceBySlot') = 'object'
        THEN chosen.config->'visitorAllowanceBySlot'
        ELSE '{}'::jsonb
      END
    ) AS slot(key, value)
    WHERE slot.key ~ '^[0-9]+$'
  `);
  return parseWebsiteRows(rows);
}

export function attachDefaultWebsite(
  user: Omit<AuthUser, "websiteId" | "websiteUrl" | "siteType">,
  websites: WebsiteRow[],
  preferredWebsiteId?: number,
): AuthUser | null {
  if (!websites.length) return null;
  const active =
    (preferredWebsiteId != null
      ? websites.find((w) => w.websiteId === preferredWebsiteId)
      : undefined) ?? websites[0];
  return {
    ...user,
    websiteId: active.websiteId,
    websiteUrl: active.websiteUrl,
    siteType: active.siteType,
  };
}
