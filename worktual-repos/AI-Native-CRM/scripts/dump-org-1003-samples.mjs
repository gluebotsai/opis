import fs from "node:fs";
import pg from "../backend/node_modules/pg/lib/index.js";

const SECRET = /token|secret|password|hash|refresh|access_token|client_secret|encrypted|api_key|private|sip_password/i;
const ORG = "1003";
const src = JSON.parse(
  fs.readFileSync(new URL("./reports-schema-live.json", import.meta.url), "utf8"),
);

function jsonSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  return value;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

for (const [key, meta] of Object.entries(src)) {
  if (meta.missing || !meta.columns?.length) continue;
  const [schema, table] = key.split(".");
  const names = meta.columns.map((c) => c.column_name);
  const hasOrg = names.includes("organization_id");
  const selectList = names
    .map((n) => (SECRET.test(n) ? `NULL::text AS "${n}"` : `"${n}"`))
    .join(", ");
  let sql = `SELECT ${selectList} FROM ${schema}."${table}"`;
  const params = [];
  if (key === "accounts.organizations") {
    sql += ` WHERE id = $1::bigint`;
    params.push(ORG);
  } else if (hasOrg) {
    sql += ` WHERE organization_id = $1::bigint`;
    params.push(ORG);
  }
  if (key === "cdp.identity_keys") {
    sql += hasOrg
      ? ` AND key_type = 'email' AND source_system = 'crm'`
      : ` WHERE key_type = 'email' AND source_system = 'crm'`;
  }
  if (key === "cdp.customer_profile") {
    sql += ` AND cdp_id IN (SELECT account_contact_id FROM crm.contact_profiles WHERE organization_id = $1::bigint)
             AND first_name IS NOT NULL`;
  }
  if (key === "accounts.setup_roles") {
    sql = `SELECT ${selectList} FROM accounts.setup_roles
           WHERE id IN (
             SELECT role_id FROM accounts.setup_user_product_access
             WHERE organization_id = $1::bigint AND product_id = 'crm'
           )`;
    params.length = 0;
    params.push(ORG);
  }
  if (key === "accounts.setup_user_product_access") {
    sql += ` AND product_id = 'crm'`;
  }
  if (key === "accounts.auth_sessions") {
    sql = `SELECT ${selectList} FROM accounts.auth_sessions
           WHERE product_id = 'crm'
             AND user_id IN (SELECT id FROM accounts.setup_users WHERE organization_id = $1::bigint)`;
    params.length = 0;
    params.push(ORG);
  }
  if (key === "accounts.mail_oauth_connections") {
    sql = `SELECT ${selectList} FROM accounts.mail_oauth_connections LIMIT 1`;
    params.length = 0;
  }
  if (key === "accounts.a2a_spoke_clients") {
    sql += hasOrg ? `` : ``;
  }
  if (key === "crm.deals") sql += ` AND amount IS NOT NULL`;
  if (key === "inventory.products") sql += ` AND status = 'active'`;
  sql += ` LIMIT 1`;
  try {
    let { rows } = await client.query(sql, params);
    if (!rows[0] && key === "cdp.identity_keys") {
      const fallback = `SELECT ${selectList} FROM cdp.identity_keys
        WHERE organization_id = $1::bigint AND key_type = 'email' LIMIT 1`;
      rows = (await client.query(fallback, [ORG])).rows;
    }
    if (!rows[0] && key === "cdp.customer_profile") {
      const fallback = `SELECT ${selectList} FROM cdp.customer_profile
        WHERE organization_id = $1::bigint
          AND cdp_id IN (SELECT account_contact_id FROM crm.contact_profiles WHERE organization_id = $1::bigint)
        LIMIT 1`;
      rows = (await client.query(fallback, [ORG])).rows;
    }
    if (rows[0]) {
      const sample = {};
      for (const [k, v] of Object.entries(rows[0])) sample[k] = jsonSafe(v);
      meta.sample = sample;
      meta.sampleOrg = ORG;
    }
  } catch (err) {
    meta.sampleError = err.message;
  }
}

await client.end();
fs.writeFileSync(
  new URL("./reports-schema-live.json", import.meta.url),
  JSON.stringify(src, null, 2),
);
console.log("updated samples for org", ORG);
