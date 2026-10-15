import { pool, query } from "./db";
import { requireOrganizationHasTicketingProduct } from "./accountsSync";

export type DirectoryCustomer = {
  id: string;
  organizationId: string;
  cdpId: string;
  externalId: string;
  name: string;
  email: string;
  phone: string;
  defaultAddress: string;
  shopifyCustomerId: string;
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

/** CDP people Ticketing may show (MyAccount org already gated at call sites). */
const CDP_TYPE_SQL = `lower(COALESCE(p.contact_type, '')) IN ('lead', 'customer')`;

const CDP_FROM = `
  FROM cdp.customer_profile p
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = p.cdp_id
      AND ik.organization_id = p.organization_id
      AND ik.key_type = 'email'
    LIMIT 1
  ) e ON TRUE
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = p.cdp_id
      AND ik.organization_id = p.organization_id
      AND ik.key_type = 'phone'
    LIMIT 1
  ) ph ON TRUE
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = p.cdp_id
      AND ik.organization_id = p.organization_id
      AND ik.key_type = 'customer_id'
    LIMIT 1
  ) cid ON TRUE
`;

const CDP_SELECT = `
  SELECT p.cdp_id,
         p.organization_id::text AS organization_id,
         p.first_name,
         p.last_name,
         p.city,
         p.region,
         p.country,
         p.created_at,
         p.blocked,
         p.contact_type,
         p.custom_fields,
         e.key_value AS email,
         ph.key_value AS phone,
         cid.key_value AS source_customer_id
  ${CDP_FROM}
`;

function cdpJsonField(customFields: unknown, keys: string[]): string {
  if (!customFields || typeof customFields !== "object") return "";
  const blob = customFields as Record<string, unknown>;
  for (const key of keys) {
    const raw = blob[key];
    if (typeof raw === "string" && raw.trim() && raw.trim().toLowerCase() !== "disabled") {
      return raw.trim();
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    if (Array.isArray(raw)) {
      const parts = raw
        .map((item) =>
          typeof item === "string" || typeof item === "number" ? String(item).trim() : ""
        )
        .filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
    if (raw && typeof raw === "object") {
      const addr = raw as Record<string, unknown>;
      const parts = [
        "line1",
        "line2",
        "address1",
        "address2",
        "city",
        "province",
        "state",
        "zip",
        "postal_code",
        "country",
      ]
        .map((part) => String(addr[part] || "").trim())
        .filter((part) => part && part.toLowerCase() !== "disabled");
      if (parts.length) return parts.join(", ");
    }
  }
  return "";
}

function cdpDisplayName(row: {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
}): string {
  const joined = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return joined || String(row.name || "").trim();
}

async function setOrgRls(organizationId: string): Promise<void> {
  await query(`SELECT set_config('app.current_org_id', $1, true)`, [
    String(organizationId),
  ]);
}

/**
 * Each pool.query is its own transaction. RLS on cdp.orders needs
 * app.current_org_id on the same connection as the SELECT.
 */
async function queryWithOrgRls(
  organizationId: string,
  text: string,
  params?: unknown[]
) {
  const orgId = String(organizationId || "").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    const result = await client.query(text, params);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Resolve an existing CDP person only — Ticketing never inserts CDP rows. */
export async function ensureCdpPerson(input: {
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
}): Promise<string> {
  const found = await findCdpPersonInOrg({
    organizationId: input.organizationId,
    email: input.email,
    phone: input.phone,
  });
  if (!found) {
    throw new CustomerDirectoryError(
      "Customer not found in CDP for this email or phone. Ticketing cannot add customers.",
      422
    );
  }
  return found.cdpId;
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
  await setOrgRls(orgId);
  const blockedSql = input.activeOnly
    ? ` AND COALESCE(p.blocked, false) IS NOT TRUE`
    : "";

  let cdpId = customerId;
  if (customerId && /^\d+$/.test(customerId)) {
    const spoke = await query<{ cdp_id: string | null }>(
      `SELECT cdp_id FROM ticketing.contact_profile
       WHERE organization_id = $1 AND id = $2 LIMIT 1`,
      [orgId, customerId]
    );
    cdpId = spoke.rows[0]?.cdp_id ? String(spoke.rows[0].cdp_id) : "";
  }
  if (cdpId && !/^(hub:|portal-guest:)/i.test(cdpId)) {
    const r = await query(
      `${CDP_SELECT}
       WHERE p.organization_id = $1 AND p.cdp_id = $2
         AND ${CDP_TYPE_SQL}${blockedSql}
       LIMIT 1`,
      [orgId, cdpId]
    );
    if (r.rows[0]) return hydrateCustomer(r.rows[0]);
  }
  if (email) {
    const r = await query(
      `${CDP_SELECT}
       WHERE p.organization_id = $1
         AND ${CDP_TYPE_SQL}${blockedSql}
         AND EXISTS (
           SELECT 1 FROM cdp.identity_keys ik
           WHERE ik.cdp_id = p.cdp_id
             AND ik.organization_id = p.organization_id
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
      `${CDP_SELECT}
       WHERE p.organization_id = $1
         AND ${CDP_TYPE_SQL}${blockedSql}
         AND EXISTS (
           SELECT 1 FROM cdp.identity_keys ik
           WHERE ik.cdp_id = p.cdp_id
             AND ik.organization_id = p.organization_id
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

/** Load one CDP person by cdp_id. Does not treat a numeric id as a ticketing contact id. */
async function findDirectoryCustomerByCdpId(
  organizationId: string,
  cdpId: string,
  activeOnly = false
): Promise<DirectoryCustomer | null> {
  const orgId = String(organizationId || "").trim();
  const id = String(cdpId || "").trim();
  if (!orgId || !id || /^(hub:|portal-guest:)/i.test(id)) return null;
  await setOrgRls(orgId);
  const blockedSql = activeOnly
    ? ` AND COALESCE(p.blocked, false) IS NOT TRUE`
    : "";
  const r = await query(
    `${CDP_SELECT}
     WHERE p.organization_id = $1 AND p.cdp_id = $2
       AND ${CDP_TYPE_SQL}${blockedSql}
     LIMIT 1`,
    [orgId, id]
  );
  if (!r.rows[0]) return null;
  return hydrateCustomer(r.rows[0]);
}

/** Primary or any secondary email on one customer. Portal OTP is the caller. */
export async function findDirectoryCustomerByPortalEmail(
  organizationId: string,
  email: string
): Promise<DirectoryCustomer | null> {
  const orgId = String(organizationId || "").trim();
  const normalized = normalizeEmail(email);
  if (!orgId || !normalized) return null;
  const hit = await queryWithOrgRls(
    orgId,
    `SELECT cdp_id
       FROM cdp.identity_keys
      WHERE organization_id::text = $1
        AND key_type IN ('email', 'email_secondary')
        AND lower(key_value) = $2
      ORDER BY CASE WHEN key_type = 'email' THEN 0 ELSE 1 END
      LIMIT 1`,
    [orgId, normalized]
  );
  const cdpId = String(hit.rows[0]?.cdp_id || "").trim();
  if (!cdpId) return null;
  return findDirectoryCustomerByCdpId(orgId, cdpId, false);
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
       FROM cdp.customer_profile p
       WHERE p.organization_id = $1 AND p.cdp_id = $2
         AND ${CDP_TYPE_SQL}
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
         AND ${CDP_TYPE_SQL}
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
         AND ${CDP_TYPE_SQL}
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
 * Ticketing does not create spoke contacts. Resolve the CDP person only.
 */
export async function ensureSpokeContactForCdp(input: {
  organizationId: string;
  cdpId: string;
}): Promise<DirectoryCustomer> {
  const found = await findDirectoryCustomer({
    organizationId: input.organizationId,
    customerId: input.cdpId,
    activeOnly: true,
  });
  if (found) return found;
  throw new CustomerDirectoryError(
    "Customer not found in CDP for this organization.",
    422
  );
}

/**
 * Ticket-create gate:
 * 1) MyAccount: organization_id has product_id = 'ticketing'
 * 2) CDP: lead or customer exists for that organization_id
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

  const email = normalizeEmail(input.email || "");
  const phone = String(input.phone || "").trim();
  const checked = email || phone || "that contact";
  throw new CustomerDirectoryError(
    `No matching customer or lead was found in CDP for ${checked}. Tickets require an existing CDP customer or lead. Ticketing cannot add this person.`,
    422
  );
}

async function countTicketsRaised(
  organizationId: string,
  people: Array<{ cdpId: string; email: string; phone: string }>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const p of people) counts.set(p.cdpId, 0);
  const emails = [
    ...new Set(people.map((p) => normalizeEmail(p.email)).filter(Boolean)),
  ];
  if (emails.length) {
    const { rows } = await query<{ em: string; n: string }>(
      `SELECT lower(customer_email) AS em, count(*)::text AS n
       FROM ticketing.tickets
       WHERE organization_id = $1 AND lower(customer_email) = ANY($2::text[])
       GROUP BY 1`,
      [organizationId, emails]
    );
    const byEmail = new Map(people.map((p) => [normalizeEmail(p.email), p.cdpId]));
    for (const row of rows) {
      const id = byEmail.get(String(row.em || ""));
      if (id) counts.set(id, Number(row.n || 0));
    }
  }
  const phones = [
    ...new Set(
      people
        .map((p) => String(p.phone || "").replace(/\D/g, ""))
        .filter((d) => d.length >= 7)
    ),
  ];
  if (phones.length) {
    const { rows } = await query<{ digits: string; n: string }>(
      `SELECT regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g') AS digits,
              count(*)::text AS n
       FROM ticketing.tickets
       WHERE organization_id = $1
         AND regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g') = ANY($2::text[])
       GROUP BY 1`,
      [organizationId, phones]
    );
    const byPhone = new Map(
      people.map((p) => [String(p.phone || "").replace(/\D/g, ""), p.cdpId])
    );
    for (const row of rows) {
      const id = byPhone.get(String(row.digits || ""));
      if (!id) continue;
      const emailCount = counts.get(id) || 0;
      if (emailCount === 0) counts.set(id, Number(row.n || 0));
    }
  }
  return counts;
}

async function hydrateCustomer(
  row: Record<string, unknown>,
  opts?: { products?: boolean; ticketCount?: number }
): Promise<DirectoryCustomer> {
  const cdpId = String(row.cdp_id || row.id || "");
  const email = row.email ? normalizeEmail(String(row.email)) : "";
  const phone = row.phone ? normalizePhone(String(row.phone)) : "";
  let total = opts?.ticketCount;
  if (total === undefined) {
    const map = await countTicketsRaised(String(row.organization_id), [
      { cdpId, email, phone },
    ]);
    total = map.get(cdpId) || 0;
  }
  const blocked = Boolean(row.blocked);
  const addressFromJson = cdpJsonField(row.custom_fields, [
    "shipping_address",
    "billing_address",
    "default_address",
    "defaultAddress",
    "address",
  ]);
  const addressFromColumns = [row.city, row.region, row.country]
    .map((part) => String(part || "").trim())
    .filter((part) => part && part.toLowerCase() !== "disabled")
    .join(", ");
  return {
    id: cdpId,
    organizationId: String(row.organization_id),
    cdpId,
    externalId: cdpId,
    name: cdpDisplayName(row),
    email,
    phone,
    defaultAddress: addressFromJson || addressFromColumns,
    shopifyCustomerId:
      String(row.source_customer_id || "").trim() ||
      cdpJsonField(row.custom_fields, [
        "customer_source_id",
        "shopify_customer_id",
        "shopifyCustomerId",
        "customer_id",
        "customerId",
      ]),
    status: blocked ? "Inactive" : "Active",
    totalTickets: total,
    accountId: null,
    accountName: null,
    products: [],
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
    defaultAddress: c.defaultAddress || "",
    shopifyCustomerId: c.shopifyCustomerId || "",
    totalTickets: c.totalTickets,
    status: c.status,
    createdAt: c.createdAt.slice(0, 10),
    accountId: c.accountId,
    accountName: c.accountName,
    products: c.products,
  };
}

export type DirectoryCustomerPage = {
  customers: DirectoryCustomer[];
  hasMore: boolean;
  total: number;
  offset: number;
  limit: number;
};

export type DirectoryCustomerSort = "latest" | "name" | "name_desc";

function directoryOrderBy(sort: DirectoryCustomerSort): string {
  if (sort === "name") {
    return `ORDER BY lower(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name))) ASC NULLS LAST, p.cdp_id ASC`;
  }
  if (sort === "name_desc") {
    return `ORDER BY lower(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name))) DESC NULLS LAST, p.cdp_id DESC`;
  }
  return `ORDER BY p.created_at DESC NULLS LAST, p.cdp_id DESC`;
}

export async function listDirectoryCustomers(input: {
  organizationId: string;
  q?: string;
  status?: string;
  sort?: DirectoryCustomerSort | string;
  limit?: number;
  offset?: number;
}): Promise<DirectoryCustomerPage> {
  const q = String(input.q || "").trim();
  const status = String(input.status || "").trim();
  const rawLimit = Number(input.limit);
  const rawOffset = Number(input.offset);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 200, 1),
    500
  );
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  await requireOrganizationHasTicketingProduct(input.organizationId);
  const params: unknown[] = [input.organizationId];
  let where = `p.organization_id = $1 AND ${CDP_TYPE_SQL}`;
  if (status === "Active") {
    where += ` AND COALESCE(p.blocked, false) IS NOT TRUE`;
  } else if (status === "Inactive") {
    where += ` AND COALESCE(p.blocked, false) IS TRUE`;
  }
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where += ` AND (
      COALESCE(NULLIF(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)), ''), '') ILIKE $${i}
      OR COALESCE(e.key_value, '') ILIKE $${i}
      OR COALESCE(ph.key_value, '') ILIKE $${i}
      OR COALESCE(p.cdp_id, '') ILIKE $${i}`;
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
  const countSql = q
    ? `SELECT COUNT(DISTINCT p.cdp_id)::text AS n ${CDP_FROM} WHERE ${where}`
    : `SELECT COUNT(*)::text AS n FROM cdp.customer_profile p WHERE ${where}`;
  const sortRaw = String(input.sort || "").trim().toLowerCase();
  const sort: DirectoryCustomerSort =
    sortRaw === "name" || sortRaw === "name_desc" || sortRaw === "latest"
      ? sortRaw
      : "latest";
  const listParams = [...params, limit, offset];
  const [countResult, listResult] = await Promise.all([
    queryWithOrgRls(input.organizationId, countSql, params),
    queryWithOrgRls(
      input.organizationId,
      `${CDP_SELECT}
     WHERE ${where}
     ${directoryOrderBy(sort)}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
  ]);
  const total = Math.max(
    0,
    Number((countResult.rows[0] as { n?: string } | undefined)?.n || 0)
  );
  const pageRows = listResult.rows;
  const hasMore = offset + pageRows.length < total;
  const people = pageRows.map((row) => ({
    cdpId: String(row.cdp_id),
    email: row.email ? String(row.email) : "",
    phone: row.phone ? String(row.phone) : "",
  }));
  const counts = await countTicketsRaised(input.organizationId, people);
  const customers = await Promise.all(
    pageRows.map((row) => {
      const cdpId = String(row.cdp_id);
      return hydrateCustomer(row, {
        products: false,
        ticketCount: counts.get(cdpId) || 0,
      });
    })
  );
  return { customers, hasMore, total, offset, limit };
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

/** Org product catalog in CDP (not an order line). Null when missing or table unavailable. */
export async function findCdpCatalogProduct(input: {
  organizationId: string;
  productId: string;
}): Promise<{ id: string } | null> {
  const orgId = String(input.organizationId || "").trim();
  const raw = String(input.productId || "").trim();
  if (!orgId || !raw) return null;
  try {
    const { rows } = await queryWithOrgRls(
      orgId,
      `SELECT product_id::text AS product_id
         FROM cdp.products
        WHERE organization_id::text = $1
          AND (
            product_id::text = $2
            OR lower(trim(COALESCE(sku, ''))) = lower($2)
            OR lower(trim(COALESCE(product_name, ''))) = lower($2)
          )
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [orgId, raw]
    );
    const id = String(rows[0]?.product_id || "").trim();
    return id ? { id } : null;
  } catch {
    return null;
  }
}

/** @deprecated use findInventoryProduct */
export async function findOrCreateProduct(input: {
  organizationId: string;
  codeOrName: string;
}): Promise<{ id: string; code: string; name: string }> {
  return findInventoryProduct(input);
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
  _input: CreateCustomerInput
): Promise<DirectoryCustomer> {
  throw new CustomerDirectoryError(
    "Ticketing cannot add customers. People are owned by CDP (lead or customer).",
    403
  );
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
  if (!/^\d+$/.test(String(customerId || "").trim())) return;
  await query(
    `UPDATE ticketing.contact_profile
     SET total_tickets = total_tickets + 1, updated_at = NOW()
     WHERE id = $1`,
    [customerId]
  );
}

export type CustomerOrderHit = {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  customerId: string;
  cdpId: string;
  items: Array<{
    productId: string;
    quantity: number;
    name: string;
    sku: string;
    unitPrice: string;
    currency: string;
  }>;
};

type OrderLineItem = {
  productId: string;
  quantity: number;
  name: string;
  sku: string;
  unitPrice: string;
  currency: string;
};

function mapOrderLineItem(
  item: Record<string, unknown>,
  orderCurrency = ""
): OrderLineItem {
  const productId = String(item.product_id || "").trim();
  const sku = String(item.sku || "").trim();
  let name = String(item.name || "").trim();
  if (name === productId || name === sku) name = "";
  return {
    productId,
    quantity: Number(item.quantity || 0),
    name,
    sku,
    unitPrice: String(item.unit_price || item.catalog_price || "").trim(),
    currency: String(item.catalog_currency || item.currency || orderCurrency || "").trim(),
  };
}

/** Line product_id is inventory.products.id (e.g. q3fitrdxu5rnp5ook5uudbzq). */
async function hydrateLinesFromInventory(
  orgId: string,
  items: OrderLineItem[]
): Promise<OrderLineItem[]> {
  const keys = [
    ...new Set(
      items.flatMap((item) =>
        [item.productId, item.sku].map((v) => String(v || "").trim()).filter(Boolean)
      )
    ),
  ];
  if (!keys.length) return items;
  const lower = keys.map((k) => k.toLowerCase());
  const withMoney = `
    SELECT id::text AS id,
           COALESCE(sku, id::text) AS sku,
           name,
           COALESCE(price, list_price, unit_price)::text AS catalog_price,
           currency AS catalog_currency
      FROM inventory.products
     WHERE organization_id::text = $1
       AND (
         id::text = ANY($2::text[])
         OR lower(trim(COALESCE(sku, ''))) = ANY($3::text[])
       )`;
  const nameOnly = `
    SELECT id::text AS id,
           COALESCE(sku, id::text) AS sku,
           name,
           NULL::text AS catalog_price,
           NULL::text AS catalog_currency
      FROM inventory.products
     WHERE organization_id::text = $1
       AND (
         id::text = ANY($2::text[])
         OR lower(trim(COALESCE(sku, ''))) = ANY($3::text[])
       )`;
  let rows: Record<string, unknown>[] = [];
  try {
    rows = (await query(withMoney, [orgId, keys, lower])).rows;
  } catch {
    try {
      rows = (await query(nameOnly, [orgId, keys, lower])).rows;
    } catch {
      return items;
    }
  }
  const byKey = new Map<string, Record<string, unknown>>();
  const remember = (key: string, row: Record<string, unknown>) => {
    const token = String(key || "").trim();
    if (!token || byKey.has(token)) return;
    byKey.set(token, row);
    byKey.set(token.toLowerCase(), row);
  };
  for (const row of rows) {
    remember(String(row.id || ""), row);
    remember(String(row.sku || ""), row);
  }
  return items.map((item) => {
    const hit =
      byKey.get(item.productId) ||
      byKey.get(item.sku) ||
      byKey.get(item.sku.toLowerCase());
    if (!hit) return item;
    const name = String(hit.name || "").trim();
    const sku = String(hit.sku || "").trim();
    const catalogPrice = String(hit.catalog_price || "").trim();
    const catalogCurrency = String(hit.catalog_currency || "").trim();
    return {
      ...item,
      name: name || item.name,
      sku: sku && sku !== String(hit.id || "") ? sku : item.sku || sku,
      unitPrice: catalogPrice || item.unitPrice,
      currency: catalogCurrency || item.currency,
    };
  });
}

/** Hub CDP order for this org + this customer only. Never org-wide by order number. */
export async function findCustomerOrder(input: {
  organizationId: string;
  customerId: string;
  orderId: string;
}): Promise<CustomerOrderHit | null> {
  const orgId = String(input.organizationId || "").trim();
  const customerId = String(input.customerId || "").trim();
  const orderId = String(input.orderId || "").trim();
  if (!orgId || !customerId || !orderId) return null;
  const customer = await findActiveCustomer({ organizationId: orgId, customerId });
  if (!customer?.cdpId) return null;
  const { rows } = await queryWithOrgRls(
    orgId,
    `SELECT o.order_id::text AS order_id,
            o.order_number,
            o.status,
            o.payment_status,
            o.fulfillment_status,
            o.total_amount::text AS total_amount,
            o.currency,
            o.created_at
       FROM cdp.orders o
      WHERE o.organization_id::text = $1
        AND trim(o.cdp_id::text) = trim($2::text)
        AND (
          ($3 ~ '^[0-9]+$' AND o.order_id::text = $3)
          OR (o.order_number IS NOT NULL AND lower(trim(o.order_number)) = lower($3))
        )
      LIMIT 1`,
    [orgId, customer.cdpId, orderId]
  );
  const row = rows[0];
  if (!row) return null;
  const oid = String(row.order_id);
  const itemSqlInventory = `
    SELECT oi.product_id::text AS product_id,
           oi.quantity,
           oi.unit_price::text AS unit_price,
           COALESCE(ip.sku, oi.custom_fields->>'sku', '') AS sku,
           COALESCE(NULLIF(trim(ip.name), ''), '') AS name
      FROM cdp.order_items oi
      LEFT JOIN inventory.products ip
        ON ip.organization_id::text = oi.organization_id::text
       AND ip.id::text = oi.product_id::text
     WHERE oi.organization_id::text = $1
       AND oi.order_id::text = $2
     LIMIT 20`;
  const itemSqlFull = `
    SELECT oi.product_id::text AS product_id,
           oi.quantity,
           oi.unit_price::text AS unit_price,
           COALESCE(oi.custom_fields->>'sku', cp.sku, '') AS sku,
           COALESCE(
             NULLIF(trim(cp.product_name), ''),
             NULLIF(trim(oi.custom_fields->>'title'), ''),
             NULLIF(trim(oi.custom_fields->>'name'), ''),
             NULLIF(trim(oi.custom_fields->>'sku'), ''),
             ''
           ) AS name
      FROM cdp.order_items oi
      LEFT JOIN LATERAL (
        SELECT p.sku, p.product_name
          FROM cdp.products p
         WHERE p.organization_id::text = oi.organization_id::text
           AND (
             (
               COALESCE(oi.custom_fields->>'sku', '') <> ''
               AND lower(p.sku) = lower(oi.custom_fields->>'sku')
             )
             OR p.product_id::text = COALESCE(oi.custom_fields->>'source_product_id', '')
           )
         ORDER BY p.updated_at DESC NULLS LAST
         LIMIT 1
      ) cp ON TRUE
     WHERE oi.organization_id::text = $1
       AND oi.order_id::text = $2
     LIMIT 20`;
  const itemSqlBare = `
    SELECT i.product_id::text AS product_id, i.quantity
      FROM cdp.order_items i
     WHERE i.organization_id::text = $1
       AND i.order_id::text = $2
     LIMIT 20`;
  let itemRows: Record<string, unknown>[] = [];
  try {
    itemRows = (await query(itemSqlInventory, [orgId, oid])).rows;
  } catch {
    try {
      itemRows = (
        await queryFirst(orgId, [
          { text: itemSqlInventory, params: [orgId, oid] },
          { text: itemSqlFull, params: [orgId, oid] },
          { text: itemSqlBare, params: [orgId, oid] },
        ])
      ).rows;
    } catch {
      itemRows = [];
    }
  }
  const orderCurrency = String(row.currency || "").trim();
  const items = await hydrateLinesFromInventory(
    orgId,
    itemRows.map((item) => mapOrderLineItem(item, orderCurrency))
  );
  return {
    orderId: oid,
    orderNumber: String(row.order_number || row.order_id),
    status: String(row.status || ""),
    paymentStatus: String(row.payment_status || ""),
    fulfillmentStatus: String(row.fulfillment_status || ""),
    totalAmount: String(row.total_amount || ""),
    currency: orderCurrency,
    createdAt: row.created_at ? String(row.created_at) : "",
    customerId: customer.id,
    cdpId: customer.cdpId,
    items: items.map((item) => ({
      ...item,
      currency: item.currency || orderCurrency,
    })),
  };
}

type CustomerOrderListItem = {
  productId: string;
  quantity: number;
  name: string;
  sku: string;
  unitPrice: string;
  currency: string;
};

type CustomerOrderListRow = {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  trackingId: string;
  courier: string;
  deliveryStatus: string;
  expectedDelivery: string;
  address: string;
  orderUrl: string;
  items: CustomerOrderListItem[];
};

async function queryFirst(
  organizationId: string,
  attempts: Array<{ text: string; params: unknown[] }>
) {
  let last: unknown = null;
  for (const attempt of attempts) {
    try {
      return await queryWithOrgRls(organizationId, attempt.text, attempt.params);
    } catch (err) {
      last = err;
    }
  }
  if (last) throw last;
  return { rows: [] as Record<string, unknown>[] };
}

/** Purchases for this org + this customer's CDP id. Never invent rows. */
export async function listCustomerOrders(input: {
  organizationId: string;
  cdpId?: string;
  customerId?: string;
}): Promise<{ orders: CustomerOrderListRow[]; totalOrders: number }> {
  const empty = { orders: [] as CustomerOrderListRow[], totalOrders: 0 };
  const orgId = String(input.organizationId || "").trim();
  let cdpId = String(input.cdpId || "").trim();
  if (!cdpId && input.customerId) {
    const customer = await findActiveCustomer({
      organizationId: orgId,
      customerId: String(input.customerId).trim(),
    });
    cdpId = customer?.cdpId || "";
  }
  if (!orgId || !cdpId) return empty;

  // Live Hub DDL in this DB: cdp.orders.order_id is bigint, not UUID.
  const orderSql = (withProposed: boolean) =>
    `SELECT o.order_id::text AS order_id,
            o.order_number,
            o.status,
            o.payment_status,
            o.fulfillment_status,
            o.total_amount::text AS total_amount,
            o.currency,
            o.created_at,
            o.custom_fields,
            COUNT(*) OVER()::int AS total_orders
       FROM cdp.orders o
      WHERE o.organization_id::text = $1
        AND (
          trim(o.cdp_id::text) = trim($2::text)
          ${
            withProposed
              ? "OR trim(COALESCE(o.custom_fields->>'proposed_cdp_id', '')) = trim($2::text)"
              : ""
          }
        )
      ORDER BY o.created_at DESC NULLS LAST
      LIMIT 20`;

  let rows: Record<string, unknown>[] = [];
  try {
    // Same access path as customer_profile (plain query). RLS-GUC next if needed.
    rows = (await query(orderSql(false), [orgId, cdpId])).rows;
    if (!rows.length) {
      rows = (
        await queryFirst(orgId, [
          { text: orderSql(true), params: [orgId, cdpId] },
          { text: orderSql(false), params: [orgId, cdpId] },
        ])
      ).rows;
    }
  } catch {
    return empty;
  }
  if (!rows.length) return empty;

  const ids = rows.map((row) => String(row.order_id || "")).filter(Boolean);
  const itemSqlInventory = `
    SELECT oi.order_id::text AS order_id,
           oi.product_id::text AS product_id,
           oi.quantity,
           oi.unit_price::text AS unit_price,
           COALESCE(ip.sku, oi.custom_fields->>'sku', '') AS sku,
           COALESCE(NULLIF(trim(ip.name), ''), '') AS name
      FROM cdp.order_items oi
      LEFT JOIN inventory.products ip
        ON ip.organization_id::text = oi.organization_id::text
       AND ip.id::text = oi.product_id::text
     WHERE oi.organization_id::text = $1
       AND oi.order_id = ANY($2::bigint[])
     LIMIT 100`;
  const itemSqlFull = `
    SELECT oi.order_id::text AS order_id,
           oi.product_id::text AS product_id,
           oi.quantity,
           oi.unit_price::text AS unit_price,
           COALESCE(oi.custom_fields->>'sku', cp.sku, '') AS sku,
           COALESCE(
             NULLIF(trim(cp.product_name), ''),
             NULLIF(trim(oi.custom_fields->>'title'), ''),
             NULLIF(trim(oi.custom_fields->>'name'), ''),
             NULLIF(trim(oi.custom_fields->>'sku'), ''),
             ''
           ) AS name
      FROM cdp.order_items oi
      LEFT JOIN LATERAL (
        SELECT p.sku, p.product_name
          FROM cdp.products p
         WHERE p.organization_id::text = oi.organization_id::text
           AND (
             (
               COALESCE(oi.custom_fields->>'sku', '') <> ''
               AND lower(p.sku) = lower(oi.custom_fields->>'sku')
             )
             OR p.product_id::text = COALESCE(oi.custom_fields->>'source_product_id', '')
           )
         ORDER BY p.updated_at DESC NULLS LAST
         LIMIT 1
      ) cp ON TRUE
     WHERE oi.organization_id::text = $1
       AND oi.order_id = ANY($2::bigint[])
     LIMIT 100`;
  const itemSqlBare = `
    SELECT oi.order_id::text AS order_id,
           oi.product_id::text AS product_id,
           oi.quantity
      FROM cdp.order_items oi
     WHERE oi.organization_id::text = $1
       AND oi.order_id = ANY($2::bigint[])
     LIMIT 100`;
  const itemSqlText = `
    SELECT oi.order_id::text AS order_id,
           oi.product_id::text AS product_id,
           oi.quantity
      FROM cdp.order_items oi
     WHERE oi.organization_id::text = $1
       AND oi.order_id::text = ANY($2::text[])
     LIMIT 100`;

  let itemRows: Record<string, unknown>[] = [];
  try {
    itemRows = (await query(itemSqlInventory, [orgId, ids])).rows;
  } catch {
    try {
      itemRows = (
        await queryFirst(orgId, [
          { text: itemSqlInventory, params: [orgId, ids] },
          { text: itemSqlFull, params: [orgId, ids] },
          { text: itemSqlBare, params: [orgId, ids] },
          { text: itemSqlText, params: [orgId, ids] },
        ])
      ).rows;
    } catch {
      itemRows = [];
    }
  }

  const grouped = new Map<string, OrderLineItem[]>();
  for (const item of itemRows) {
    const oid = String(item.order_id || "");
    const list = grouped.get(oid) || [];
    list.push(mapOrderLineItem(item));
    grouped.set(oid, list);
  }
  const byOrder = new Map<string, CustomerOrderListItem[]>();
  for (const [oid, list] of grouped) {
    byOrder.set(oid, await hydrateLinesFromInventory(orgId, list));
  }

  const totalOrders = Number(rows[0]?.total_orders || 0);
  return {
    totalOrders,
    orders: rows.map((row) => ({
    orderId: String(row.order_id || ""),
    orderNumber: String(row.order_number || row.order_id || ""),
    status: String(row.status || ""),
    paymentStatus: String(row.payment_status || ""),
    fulfillmentStatus: String(row.fulfillment_status || ""),
    totalAmount: String(row.total_amount || ""),
    currency: String(row.currency || ""),
    createdAt: row.created_at ? String(row.created_at) : "",
    trackingId: cdpJsonField(row.custom_fields, [
      "tracking_numbers",
      "tracking_id",
      "trackingId",
      "awb",
      "tracking_number",
    ]),
    courier: cdpJsonField(row.custom_fields, ["courier", "carrier", "shipping_carrier"]),
    deliveryStatus: cdpJsonField(row.custom_fields, [
      "delivery_status",
      "deliveryStatus",
    ]),
    expectedDelivery: cdpJsonField(row.custom_fields, [
      "expected_delivery",
      "expectedDelivery",
      "estimated_delivery_at",
      "delivery_date",
      "deliveryDate",
      "delivered_at",
      "deliveredAt",
    ]),
    address: cdpJsonField(row.custom_fields, [
      "shipping_address",
      "shippingAddress",
      "delivery_address",
      "deliveryAddress",
      "billing_address",
      "billingAddress",
      "default_address",
      "defaultAddress",
      "address",
    ]),
    orderUrl: cdpJsonField(row.custom_fields, [
      "order_url",
      "orderUrl",
      "shopify_order_url",
      "admin_url",
    ]),
    items: (byOrder.get(String(row.order_id || "")) || []).map((item) => ({
      ...item,
      currency: item.currency || String(row.currency || "").trim(),
    })),
  })),
  };
}
