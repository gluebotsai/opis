import { randomUUID } from "crypto";
import { query } from "./db";
import { requireOrganizationHasTicketingProduct } from "./accountsSync";

export type DirectoryCustomer = {
  id: string;
  organizationId: string;
  cdpId: string;
  externalId: string;
  name: string;
  email: string;
  phone: string;
  status: "Active" | "Inactive";
  totalTickets: number;
  accountId: string | null;
  accountName: string | null;
  products: Array<{ id: string; code: string; name: string }>;
  createdAt: string;
};

export class CustomerDirectoryError extends Error {
  status: number;
  existing?: DirectoryCustomer;
  conflict?: "email" | "phone";
  constructor(
    message: string,
    status = 400,
    extra?: { existing?: DirectoryCustomer; conflict?: "email" | "phone" }
  ) {
    super(message);
    this.status = status;
    this.existing = extra?.existing;
    this.conflict = extra?.conflict;
  }
}

export function normalizePhone(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

/** contact_profile + CDP person/identity (name/email/phone from hub). */
const CONTACT_FROM = `
  FROM ticketing.contact_profile c
  LEFT JOIN ticketing.ticketing_accounts a ON a.id = c.account_id
  LEFT JOIN cdp.customer_profile p
    ON p.cdp_id = c.cdp_id AND p.organization_id = c.organization_id
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = c.cdp_id
      AND ik.organization_id = c.organization_id
      AND ik.key_type = 'email'
    LIMIT 1
  ) e ON TRUE
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = c.cdp_id
      AND ik.organization_id = c.organization_id
      AND ik.key_type = 'phone'
    LIMIT 1
  ) ph ON TRUE
`;

const CONTACT_SELECT = `
  SELECT c.*,
         a.name AS account_name,
         NULLIF(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)), '') AS name,
         e.key_value AS email,
         ph.key_value AS phone
  ${CONTACT_FROM}
`;

async function setOrgRls(organizationId: string): Promise<void> {
  await query(`SELECT set_config('app.current_org_id', $1, true)`, [
    String(organizationId),
  ]);
}

/** Ensure CDP person + identity keys; returns cdp_id. */
export async function ensureCdpPerson(input: {
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
}): Promise<string> {
  const orgId = String(input.organizationId);
  const email = normalizeEmail(input.email || "");
  const phone = normalizePhone(input.phone || "");
  const name = String(input.name || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

  await setOrgRls(orgId);

  let cdpId: string | null = null;
  if (email) {
    const hit = await query(
      `SELECT cdp_id FROM cdp.identity_keys
       WHERE organization_id = $1 AND key_type = 'email' AND lower(key_value) = $2
       LIMIT 1`,
      [orgId, email]
    );
    if (hit.rows[0]) cdpId = String(hit.rows[0].cdp_id);
  }
  if (!cdpId && phone) {
    const digits = phone.replace(/\D/g, "");
    const hit = await query(
      `SELECT cdp_id FROM cdp.identity_keys
       WHERE organization_id = $1 AND key_type = 'phone'
         AND (
           regexp_replace(key_value, '[^0-9]', '', 'g') = $2
           OR (
             length(regexp_replace(key_value, '[^0-9]', '', 'g')) >= 10
             AND length($2) >= 10
             AND right(regexp_replace(key_value, '[^0-9]', '', 'g'), 10) = right($2, 10)
           )
         )
       LIMIT 1`,
      [orgId, digits]
    );
    if (hit.rows[0]) cdpId = String(hit.rows[0].cdp_id);
  }

  if (!cdpId) {
    cdpId = randomUUID();
    await query(
      `INSERT INTO cdp.customer_profile (
         cdp_id, first_name, last_name, organization_id, tenant_id,
         custom_fields, preferences_json, consent_json, traits_json
       ) VALUES ($1,$2,$3,$4,'default',$5::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb)`,
      [
        cdpId,
        firstName,
        lastName,
        orgId,
        JSON.stringify({ source: "ticketing" }),
      ]
    );
  } else {
    await query(
      `UPDATE cdp.customer_profile
       SET first_name = COALESCE(NULLIF($2, ''), first_name),
           last_name = COALESCE(NULLIF($3, ''), last_name),
           updated_at = NOW()
       WHERE cdp_id = $1 AND organization_id = $4`,
      [cdpId, firstName, lastName, orgId]
    );
  }

  if (email) {
    const hasEmail = await query(
      `SELECT 1 FROM cdp.identity_keys
       WHERE organization_id = $1 AND key_type = 'email' AND lower(key_value) = $2
       LIMIT 1`,
      [orgId, email]
    );
    if (!hasEmail.rows[0]) {
      await query(
        `INSERT INTO cdp.identity_keys (
           identity_id, cdp_id, key_type, key_value, source_system,
           verified, organization_id, custom_fields
         ) VALUES ($1,$2,'email',$3,'ticketing',false,$4,'{}'::jsonb)`,
        [randomUUID(), cdpId, email, orgId]
      );
    }
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    const hasPhone = await query(
      `SELECT 1 FROM cdp.identity_keys
       WHERE organization_id = $1 AND key_type = 'phone'
         AND (
           regexp_replace(key_value, '[^0-9]', '', 'g') = $2
           OR (
             length(regexp_replace(key_value, '[^0-9]', '', 'g')) >= 10
             AND length($2) >= 10
             AND right(regexp_replace(key_value, '[^0-9]', '', 'g'), 10) = right($2, 10)
           )
         )
       LIMIT 1`,
      [orgId, digits]
    );
    if (!hasPhone.rows[0]) {
      await query(
        `INSERT INTO cdp.identity_keys (
           identity_id, cdp_id, key_type, key_value, source_system,
           verified, organization_id, custom_fields
         ) VALUES ($1,$2,'phone',$3,'ticketing',false,$4,'{}'::jsonb)`,
        [randomUUID(), cdpId, phone, orgId]
      );
    }
  }

  return cdpId;
}

export async function findDirectoryCustomer(input: {
  organizationId: string;
  customerId?: string;
  email?: string;
  phone?: string;
  activeOnly?: boolean;
}): Promise<DirectoryCustomer | null> {
  const orgId = String(input.organizationId || "").trim();
  const customerId = String(input.customerId || "").trim();
  const email = normalizeEmail(input.email || "");
  const phoneDigits = String(input.phone || "").replace(/\D/g, "");
  if (!orgId) return null;
  const statusSql = input.activeOnly ? ` AND c.status = 'Active'` : "";

  if (customerId && /^\d+$/.test(customerId)) {
    // contacts.id is bigint — skip opaque service keys (hub:, portal-guest:, …).
    const r = await query(
      `${CONTACT_SELECT}
       WHERE c.organization_id = $1 AND c.id = $2${statusSql}
       LIMIT 1`,
      [orgId, customerId]
    );
    if (r.rows[0]) return hydrateCustomer(r.rows[0]);
  }
  if (email) {
    const r = await query(
      `${CONTACT_SELECT}
       WHERE c.organization_id = $1${statusSql}
         AND EXISTS (
           SELECT 1 FROM cdp.identity_keys ik
           WHERE ik.cdp_id = c.cdp_id
             AND ik.organization_id = c.organization_id
             AND ik.key_type = 'email'
             AND lower(ik.key_value) = $2
         )
       LIMIT 1`,
      [orgId, email]
    );
    if (r.rows[0]) return hydrateCustomer(r.rows[0]);
  }
  if (phoneDigits.length >= 7) {
    const r = await query(
      `${CONTACT_SELECT}
       WHERE c.organization_id = $1${statusSql}
         AND EXISTS (
           SELECT 1 FROM cdp.identity_keys ik
           WHERE ik.cdp_id = c.cdp_id
             AND ik.organization_id = c.organization_id
             AND ik.key_type = 'phone'
             AND (
               regexp_replace(ik.key_value, '[^0-9]', '', 'g') = $2
               OR (
                 length(regexp_replace(ik.key_value, '[^0-9]', '', 'g')) >= 10
                 AND length($2) >= 10
                 AND right(regexp_replace(ik.key_value, '[^0-9]', '', 'g'), 10) = right($2, 10)
               )
             )
         )
       LIMIT 1`,
      [orgId, phoneDigits]
    );
    if (r.rows[0]) return hydrateCustomer(r.rows[0]);
  }
  return null;
}

export async function findActiveCustomer(input: {
  organizationId: string;
  customerId?: string;
  email?: string;
  phone?: string;
}): Promise<DirectoryCustomer | null> {
  return findDirectoryCustomer({ ...input, activeOnly: true });
}

/**
 * MyAccount-imported contacts live in CDP (customer_profile + identity_keys)
 * with organization_id. Resolve by email/phone within that org.
 */
export async function findCdpPersonInOrg(input: {
  organizationId: string;
  email?: string;
  phone?: string;
  cdpId?: string;
}): Promise<{
  cdpId: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string;
} | null> {
  const orgId = String(input.organizationId || "").trim();
  if (!orgId) return null;
  const email = normalizeEmail(input.email || "");
  const phoneDigits = String(input.phone || "").replace(/\D/g, "");
  const cdpIdIn = String(input.cdpId || "").trim();

  await setOrgRls(orgId);

  if (cdpIdIn) {
    const r = await query<{
      cdp_id: string;
      organization_id: string;
      first_name: string | null;
      last_name: string | null;
    }>(
      `SELECT cdp_id, organization_id::text AS organization_id, first_name, last_name
       FROM cdp.customer_profile
       WHERE organization_id = $1 AND cdp_id = $2
       LIMIT 1`,
      [orgId, cdpIdIn]
    );
    if (r.rows[0]) {
      const row = r.rows[0];
      const keys = await query<{ key_type: string; key_value: string }>(
        `SELECT key_type, key_value FROM cdp.identity_keys
         WHERE organization_id = $1 AND cdp_id = $2`,
        [orgId, row.cdp_id]
      );
      const emailKey =
        keys.rows.find((k) => k.key_type === "email")?.key_value || "";
      const phoneKey =
        keys.rows.find((k) => k.key_type === "phone")?.key_value || "";
      return {
        cdpId: String(row.cdp_id),
        organizationId: String(row.organization_id),
        name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
        email: normalizeEmail(emailKey),
        phone: normalizePhone(phoneKey),
      };
    }
  }

  if (email) {
    const r = await query<{
      cdp_id: string;
      organization_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>(
      `SELECT p.cdp_id,
              p.organization_id::text AS organization_id,
              p.first_name,
              p.last_name,
              e.key_value AS email,
              ph.key_value AS phone
       FROM cdp.customer_profile p
       JOIN cdp.identity_keys e
         ON e.cdp_id = p.cdp_id
        AND e.organization_id = p.organization_id
        AND e.key_type = 'email'
        AND lower(e.key_value) = $2
       LEFT JOIN LATERAL (
         SELECT ik.key_value
         FROM cdp.identity_keys ik
         WHERE ik.cdp_id = p.cdp_id
           AND ik.organization_id = p.organization_id
           AND ik.key_type = 'phone'
         LIMIT 1
       ) ph ON TRUE
       WHERE p.organization_id = $1
       LIMIT 1`,
      [orgId, email]
    );
    if (r.rows[0]) {
      const row = r.rows[0];
      return {
        cdpId: String(row.cdp_id),
        organizationId: String(row.organization_id),
        name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
        email: normalizeEmail(row.email || email),
        phone: normalizePhone(row.phone || ""),
      };
    }
  }

  if (phoneDigits.length >= 7) {
    const r = await query<{
      cdp_id: string;
      organization_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>(
      `SELECT p.cdp_id,
              p.organization_id::text AS organization_id,
              p.first_name,
              p.last_name,
              e.key_value AS email,
              ph.key_value AS phone
       FROM cdp.customer_profile p
       JOIN cdp.identity_keys ph
         ON ph.cdp_id = p.cdp_id
        AND ph.organization_id = p.organization_id
        AND ph.key_type = 'phone'
        AND (
          regexp_replace(ph.key_value, '[^0-9]', '', 'g') = $2
          OR (
            length(regexp_replace(ph.key_value, '[^0-9]', '', 'g')) >= 10
            AND length($2) >= 10
            AND right(regexp_replace(ph.key_value, '[^0-9]', '', 'g'), 10) = right($2, 10)
          )
        )
       LEFT JOIN LATERAL (
         SELECT ik.key_value
         FROM cdp.identity_keys ik
         WHERE ik.cdp_id = p.cdp_id
           AND ik.organization_id = p.organization_id
           AND ik.key_type = 'email'
         LIMIT 1
       ) e ON TRUE
       WHERE p.organization_id = $1
       LIMIT 1`,
      [orgId, phoneDigits]
    );
    if (r.rows[0]) {
      const row = r.rows[0];
      return {
        cdpId: String(row.cdp_id),
        organizationId: String(row.organization_id),
        name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
        email: normalizeEmail(row.email || ""),
        phone: normalizePhone(row.phone || input.phone || ""),
      };
    }
  }

  return null;
}

/**
 * Ensure spoke contact_profile for a CDP person (MyAccount import may only write CDP).
 * Never invents CDP rows — only links an existing cdp_id.
 */
export async function ensureSpokeContactForCdp(input: {
  organizationId: string;
  cdpId: string;
}): Promise<DirectoryCustomer> {
  const orgId = String(input.organizationId || "").trim();
  const cdpId = String(input.cdpId || "").trim();
  if (!orgId || !cdpId) {
    throw new CustomerDirectoryError(
      "Customer not found. Add the customer first, then create a ticket.",
      422
    );
  }

  const existing = await query<{ id: string; status: string }>(
    `SELECT id::text AS id, status
     FROM ticketing.contact_profile
     WHERE organization_id = $1 AND cdp_id = $2
     LIMIT 1`,
    [orgId, cdpId]
  );
  if (existing.rows[0]) {
    if (String(existing.rows[0].status) === "Inactive") {
      throw new CustomerDirectoryError(
        "This customer account is inactive. Contact support if you need access.",
        403
      );
    }
    const active = await findActiveCustomer({
      organizationId: orgId,
      customerId: existing.rows[0].id,
    });
    if (active) return active;
  }

  const cdp = await findCdpPersonInOrg({ organizationId: orgId, cdpId });
  if (!cdp || cdp.organizationId !== orgId) {
    throw new CustomerDirectoryError(
      "Customer not found in CDP for this organization.",
      422
    );
  }

  try {
    const ins = await query(
      `INSERT INTO ticketing.contact_profile (
         organization_id, external_id, cdp_id, status, total_tickets, account_id
       ) VALUES ($1,$2,$3,'Active',0,NULL)
       RETURNING id::text AS id`,
      [orgId, nextExternalId(), cdpId]
    );
    const created = await findActiveCustomer({
      organizationId: orgId,
      customerId: String(ins.rows[0].id),
    });
    if (!created) {
      throw new CustomerDirectoryError(
        "Customer not found. Add the customer first, then create a ticket.",
        422
      );
    }
    return created;
  } catch (err) {
    if (err instanceof CustomerDirectoryError) throw err;
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      const again = await findActiveCustomer({
        organizationId: orgId,
        email: cdp.email || undefined,
        phone: cdp.phone || undefined,
      });
      if (again) return again;
      const byCdp = await query<{ id: string }>(
        `SELECT id::text AS id FROM ticketing.contact_profile
         WHERE organization_id = $1 AND cdp_id = $2 LIMIT 1`,
        [orgId, cdpId]
      );
      if (byCdp.rows[0]) {
        const linked = await findActiveCustomer({
          organizationId: orgId,
          customerId: byCdp.rows[0].id,
        });
        if (linked) return linked;
      }
    }
    throw err;
  }
}

/**
 * Ticket-create gate:
 * 1) MyAccount: organization_id has product_id = 'ticketing'
 * 2) CDP: person exists for that organization_id (identity_keys + customer_profile)
 * 3) Spoke: Active contact_profile linked to cdp_id (lazy-create if CDP-only import)
 */
export async function requireExistingCustomer(input: {
  organizationId: string;
  customerId?: string;
  email?: string;
  phone?: string;
}): Promise<DirectoryCustomer> {
  await requireOrganizationHasTicketingProduct(input.organizationId);

  const found = await findActiveCustomer(input);
  if (found) return found;

  const inactive = await findDirectoryCustomer({
    ...input,
    activeOnly: false,
  });
  if (inactive && inactive.status === "Inactive") {
    throw new CustomerDirectoryError(
      "This customer account is inactive. Contact support if you need access.",
      403
    );
  }

  // Directory miss: MyAccount may have imported the contact into CDP only.
  let cdpIdFromDir = "";
  if (input.customerId) {
    const row = await query<{ cdp_id: string | null }>(
      `SELECT cdp_id FROM ticketing.contact_profile
       WHERE organization_id = $1 AND id = $2
       LIMIT 1`,
      [input.organizationId, input.customerId]
    );
    cdpIdFromDir = row.rows[0]?.cdp_id ? String(row.rows[0].cdp_id) : "";
  }
  const cdp = await findCdpPersonInOrg({
    organizationId: input.organizationId,
    email: input.email,
    phone: input.phone,
    cdpId: cdpIdFromDir || undefined,
  });
  if (cdp) {
    return ensureSpokeContactForCdp({
      organizationId: input.organizationId,
      cdpId: cdp.cdpId,
    });
  }

  throw new CustomerDirectoryError(
    "Customer not found in CDP. Add them with name, email, and phone in chat or Customers (or import in MyAccount), then create the ticket.",
    422
  );
}

async function hydrateCustomer(
  row: Record<string, unknown>,
  opts?: { products?: boolean }
): Promise<DirectoryCustomer> {
  const id = String(row.id);
  const products =
    opts?.products === false
      ? []
      : await listCustomerProducts(
          String(row.organization_id),
          id,
          row.account_id ? String(row.account_id) : null
        );
  return {
    id,
    organizationId: String(row.organization_id),
    cdpId: row.cdp_id ? String(row.cdp_id) : "",
    externalId: row.external_id ? String(row.external_id) : "",
    name: String(row.name || ""),
    email: row.email ? String(row.email) : "",
    phone: row.phone ? String(row.phone) : "",
    status: (row.status === "Inactive" ? "Inactive" : "Active") as
      | "Active"
      | "Inactive",
    totalTickets: Number(row.total_tickets || 0),
    accountId: row.account_id ? String(row.account_id) : null,
    accountName: row.account_name ? String(row.account_name) : null,
    products,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at || ""),
  };
}

export async function listCustomerProducts(
  organizationId: string,
  customerId: string,
  accountId: string | null
): Promise<Array<{ id: string; code: string; name: string }>> {
  // contact_products / account_products dropped — entitlements live in inventory/CDP.
  void organizationId;
  void customerId;
  void accountId;
  return [];
}

export function mapDirectoryCustomer(c: DirectoryCustomer) {
  return {
    id: c.id,
    cdpId: c.cdpId,
    externalId: c.externalId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    totalTickets: c.totalTickets,
    status: c.status,
    createdAt: c.createdAt.slice(0, 10),
    accountId: c.accountId,
    accountName: c.accountName,
    products: c.products,
  };
}

export async function listDirectoryCustomers(input: {
  organizationId: string;
  q?: string;
  status?: string;
  limit?: number;
}): Promise<DirectoryCustomer[]> {
  const q = String(input.q || "").trim();
  const status = String(input.status || "").trim();
  const limit = Math.min(Math.max(Number(input.limit) || 200, 1), 500);
  const params: unknown[] = [input.organizationId];
  let where = `c.organization_id = $1`;
  if (status === "Active" || status === "Inactive") {
    params.push(status);
    where += ` AND c.status = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where += ` AND (
      COALESCE(NULLIF(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)), ''), '') ILIKE $${i}
      OR COALESCE(e.key_value, '') ILIKE $${i}
      OR COALESCE(ph.key_value, '') ILIKE $${i}
      OR COALESCE(c.external_id, '') ILIKE $${i}
      OR COALESCE(c.cdp_id, '') ILIKE $${i}
      OR COALESCE(a.name, '') ILIKE $${i}`;
    const qDigits = q.replace(/\D/g, "");
    if (qDigits.length >= 7) {
      params.push(qDigits);
      const d = params.length;
      where += `
      OR regexp_replace(COALESCE(ph.key_value, ''), '[^0-9]', '', 'g') = $${d}
      OR (
        length(regexp_replace(COALESCE(ph.key_value, ''), '[^0-9]', '', 'g')) >= 10
        AND length($${d}) >= 10
        AND right(regexp_replace(COALESCE(ph.key_value, ''), '[^0-9]', '', 'g'), 10) = right($${d}, 10)
      )`;
    }
    where += `
    )`;
  }
  params.push(limit);
  const { rows } = await query(
    `${CONTACT_SELECT}
     WHERE ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  const out: DirectoryCustomer[] = [];
  for (const row of rows) {
    out.push(await hydrateCustomer(row, { products: false }));
  }
  return out;
}

export async function findOrCreateAccount(input: {
  organizationId: string;
  name: string;
}): Promise<{ id: string; name: string }> {
  const name = String(input.name || "").trim();
  if (!name) throw new CustomerDirectoryError("Account name is required");
  const existing = await query(
    `SELECT id, name FROM ticketing.ticketing_accounts
     WHERE organization_id = $1 AND lower(name) = lower($2)
     LIMIT 1`,
    [input.organizationId, name]
  );
  if (existing.rows[0]) {
    return { id: String(existing.rows[0].id), name: String(existing.rows[0].name) };
  }
  const ins = await query(
    `INSERT INTO ticketing.ticketing_accounts (organization_id, name, status)
     VALUES ($1, $2, 'Active')
     RETURNING id, name`,
    [input.organizationId, name]
  );
  return { id: String(ins.rows[0].id), name: String(ins.rows[0].name) };
}

/** Resolve tenant product from inventory only (no local catalog create). */
export async function findInventoryProduct(input: {
  organizationId: string;
  codeOrName: string;
}): Promise<{ id: string; code: string; name: string }> {
  const raw = String(input.codeOrName || "").trim();
  if (!raw) throw new CustomerDirectoryError("Product is required");
  const existing = await query(
    `SELECT id, COALESCE(sku, id) AS code, name
     FROM inventory.products
     WHERE organization_id = $1
       AND (
         lower(COALESCE(sku, '')) = lower($2)
         OR lower(name) = lower($2)
         OR id = $2
       )
     LIMIT 1`,
    [input.organizationId, raw]
  );
  if (!existing.rows[0]) {
    throw new CustomerDirectoryError(
      `Product not found in inventory: ${raw}`,
      404
    );
  }
  return {
    id: String(existing.rows[0].id),
    code: String(existing.rows[0].code),
    name: String(existing.rows[0].name),
  };
}

/** @deprecated use findInventoryProduct */
export async function findOrCreateProduct(input: {
  organizationId: string;
  codeOrName: string;
}): Promise<{ id: string; code: string; name: string }> {
  return findInventoryProduct(input);
}

async function attachProducts(input: {
  organizationId: string;
  customerId: string;
  accountId: string | null;
  productCodes: string[];
}): Promise<void> {
  // Spoke no longer stores product link rows; validate codes exist in inventory only.
  for (const raw of input.productCodes) {
    const code = String(raw || "").trim();
    if (!code) continue;
    await findInventoryProduct({
      organizationId: input.organizationId,
      codeOrName: code,
    });
  }
}

function nextExternalId(): string {
  return `CUST-${Date.now().toString(36).toUpperCase()}-${Math.floor(
    Math.random() * 1e6
  )
    .toString(36)
    .toUpperCase()}`;
}

export type CreateCustomerInput = {
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  externalId?: string;
  accountName?: string;
  productCodes?: string[];
};

export async function createDirectoryCustomer(
  input: CreateCustomerInput
): Promise<DirectoryCustomer> {
  const name = String(input.name || "").trim();
  const email = normalizeEmail(input.email || "");
  const phone = normalizePhone(input.phone || "");
  if (!name) throw new CustomerDirectoryError("Customer name is required");
  if (!email && !phone) {
    throw new CustomerDirectoryError("Email or phone is required");
  }

  const byEmail = email
    ? await findDirectoryCustomer({
        organizationId: input.organizationId,
        email,
        activeOnly: false,
      })
    : null;
  if (byEmail) {
    throw new CustomerDirectoryError(
      byEmail.status === "Inactive"
        ? "This email is already on an Inactive directory customer. Search the directory to open their record."
        : "A customer with this email already exists. Search the directory to open their record.",
      409,
      { existing: byEmail, conflict: "email" }
    );
  }
  const byPhone = phone
    ? await findDirectoryCustomer({
        organizationId: input.organizationId,
        phone,
        activeOnly: false,
      })
    : null;
  if (byPhone) {
    throw new CustomerDirectoryError(
      byPhone.status === "Inactive"
        ? "This phone is already on an Inactive directory customer. Search the directory to open their record."
        : "A customer with this phone already exists. Search the number to open their record.",
      409,
      { existing: byPhone, conflict: "phone" }
    );
  }

  let accountId: string | null = null;
  const accountName = String(input.accountName || "").trim();
  if (accountName) {
    accountId = (
      await findOrCreateAccount({
        organizationId: input.organizationId,
        name: accountName,
      })
    ).id;
  }

  const cdpId = await ensureCdpPerson({
    organizationId: input.organizationId,
    name,
    email,
    phone,
  });

  // Existing spoke row for this cdp_id (e.g. CDP person already linked)
  const existingByCdp = await query(
    `SELECT id FROM ticketing.contact_profile
     WHERE organization_id = $1 AND cdp_id = $2
     LIMIT 1`,
    [input.organizationId, cdpId]
  );
  if (existingByCdp.rows[0]) {
    throw new CustomerDirectoryError(
      "A support contact already exists for this person. Search the directory to open their record.",
      409
    );
  }

  const externalId = String(input.externalId || "").trim() || nextExternalId();
  let inserted: Record<string, unknown>;
  try {
    const ins = await query(
      `INSERT INTO ticketing.contact_profile (
         organization_id, external_id, cdp_id, status, total_tickets, account_id
       ) VALUES ($1,$2,$3,'Active',0,$4)
       RETURNING *`,
      [input.organizationId, externalId, cdpId, accountId]
    );
    inserted = ins.rows[0];
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      throw new CustomerDirectoryError(
        "A customer with this external id or cdp link already exists.",
        409
      );
    }
    throw err;
  }

  await attachProducts({
    organizationId: input.organizationId,
    customerId: String(inserted.id),
    accountId,
    productCodes: input.productCodes || [],
  });

  const created = await findActiveCustomer({
    organizationId: input.organizationId,
    customerId: String(inserted.id),
  });
  if (!created) throw new CustomerDirectoryError("Failed to load created customer", 500);
  return created;
}

function normalizeHeaderCell(h: string): string {
  return String(h || "")
    .trim()
    .toLowerCase()
    .split("")
    .filter((ch) => ch !== " " && ch !== "_" && ch !== "-")
    .join("");
}

function splitProductCodes(raw: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of String(raw || "")) {
    if (ch === ";" || ch === "," || ch === "|") {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
    } else {
      cur += ch;
    }
  }
  const last = cur.trim();
  if (last) out.push(last);
  return out;
}

function rowsFromHeaderAndMatrix(
  headerRaw: string[],
  dataRows: string[][]
): CreateCustomerInput[] {
  const header = headerRaw.map(normalizeHeaderCell);
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const nameI = idx(["name", "fullname", "customername", "clientname"]);
  const emailI = idx(["email", "emailaddress"]);
  const phoneI = idx(["phone", "phonenumber", "mobile"]);
  const extI = idx(["externalid", "id"]);
  const acctI = idx(["account", "accountname", "company", "companyname"]);
  const prodI = idx(["products", "product", "productcodes", "skus"]);
  if (nameI < 0) {
    throw new CustomerDirectoryError(
      "Import file must include a name column.",
      400
    );
  }
  const rows: CreateCustomerInput[] = [];
  for (const cols of dataRows) {
    const name = String(cols[nameI] || "").trim();
    if (!name) continue;
    const productsRaw = prodI >= 0 ? String(cols[prodI] || "") : "";
    rows.push({
      organizationId: "",
      name,
      email: emailI >= 0 ? String(cols[emailI] || "") : "",
      phone: phoneI >= 0 ? String(cols[phoneI] || "") : "",
      externalId: extI >= 0 ? String(cols[extI] || "") : "",
      accountName: acctI >= 0 ? String(cols[acctI] || "") : "",
      productCodes: splitProductCodes(productsRaw),
    });
  }
  return rows;
}

function stripBom(text: string): string {
  const raw = String(text || "");
  if (raw.charCodeAt(0) === 0xfeff) return raw.slice(1);
  return raw;
}

function splitTextLines(text: string): string[] {
  const raw = stripBom(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}

function detectDelimiter(headerLine: string, filename?: string): string {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".tsv")) return "\t";
  const tabs = countChar(headerLine, "\t");
  const commas = countChar(headerLine, ",");
  const semis = countChar(headerLine, ";");
  if (tabs > commas && tabs >= semis) return "\t";
  if (commas === 0 && semis > 0) return ";";
  return ",";
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDelimitedCustomerText(
  text: string,
  filename?: string
): CreateCustomerInput[] {
  const lines = splitTextLines(text);
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0], filename);
  const header = splitDelimitedLine(lines[0], delimiter);
  const dataRows = lines.slice(1).map((line) => splitDelimitedLine(line, delimiter));
  return rowsFromHeaderAndMatrix(header, dataRows);
}

async function parseExcelCustomerBuffer(
  buffer: Buffer
): Promise<CreateCustomerInput[]> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  // exceljs supports xlsx; legacy .xls may fail — surface a clear error.
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new CustomerDirectoryError(
      "Could not read Excel file. Use .xlsx, or export as CSV/TSV.",
      400
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values;
    // exceljs row.values is 1-indexed
    const cells: string[] = [];
    if (Array.isArray(values)) {
      for (let i = 1; i < values.length; i++) {
        const v = values[i];
        if (v == null) {
          cells.push("");
        } else if (typeof v === "object" && v !== null && "text" in v) {
          cells.push(String((v as { text?: string }).text || "").trim());
        } else if (typeof v === "object" && v !== null && "result" in v) {
          cells.push(String((v as { result?: unknown }).result ?? "").trim());
        } else {
          cells.push(String(v).trim());
        }
      }
    }
    if (cells.some((c) => c)) matrix.push(cells);
  });
  if (matrix.length < 2) return [];
  return rowsFromHeaderAndMatrix(matrix[0], matrix.slice(1));
}

export type CustomerImportSource = {
  text?: string;
  buffer?: Buffer;
  filename?: string;
};

/** Multi-format customer import: CSV, TSV, semicolon CSV, XLSX. */
export async function parseCustomerImport(
  source: CustomerImportSource
): Promise<CreateCustomerInput[]> {
  const filename = String(source.filename || "").trim().toLowerCase();
  const wantsExcel =
    filename.endsWith(".xlsx") || filename.endsWith(".xls");

  if (source.buffer && wantsExcel) {
    return parseExcelCustomerBuffer(source.buffer);
  }

  if (source.text != null && String(source.text).trim()) {
    return parseDelimitedCustomerText(String(source.text), filename || undefined);
  }

  if (source.buffer && source.buffer.length) {
    // No filename: try Excel, then UTF-8 text.
    try {
      return await parseExcelCustomerBuffer(source.buffer);
    } catch (err) {
      if (err instanceof CustomerDirectoryError && err.status === 400) {
        return parseDelimitedCustomerText(
          source.buffer.toString("utf8"),
          filename || undefined
        );
      }
      throw err;
    }
  }

  throw new CustomerDirectoryError("No import content provided.", 400);
}

/** Compat wrapper: plain CSV/TSV/semicolon text. */
export function parseCustomerCsv(text: string): CreateCustomerInput[] {
  return parseDelimitedCustomerText(text);
}

export async function incrementCustomerTickets(customerId: string): Promise<void> {
  await query(
    `UPDATE ticketing.contact_profile
     SET total_tickets = total_tickets + 1, updated_at = NOW()
     WHERE id = $1`,
    [customerId]
  );
}
