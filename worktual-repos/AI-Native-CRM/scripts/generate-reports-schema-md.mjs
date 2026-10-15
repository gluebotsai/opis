import fs from "node:fs";
import { describeColumn, usageTag } from "./reports-schema-column-docs.mjs";
import { enumerationsMarkdown } from "./reports-schema-enumerations.mjs";

const live = JSON.parse(
  fs.readFileSync(new URL("./reports-schema-live.json", import.meta.url), "utf8"),
);
const purposes = JSON.parse(
  fs.readFileSync(new URL("./schema-table-purposes.json", import.meta.url), "utf8"),
);

const SHARED = [
  "accounts.organizations",
  "accounts.setup_users",
  "accounts.setup_roles",
  "accounts.setup_user_product_access",
  "accounts.auth_sessions",
  "accounts.mail_oauth_connections",
  "accounts.a2a_spoke_clients",
  "cdp.customer_profile",
  "cdp.identity_keys",
  "inventory.products",
];

const SECRET = /token|secret|password|hash|refresh|encrypted|api_key|_enc$/i;

function typeLabel(col) {
  if (col.data_type === "USER-DEFINED") return col.udt_name;
  if (col.data_type === "timestamp with time zone") return "timestamptz";
  if (col.data_type === "character varying") return "varchar";
  return col.data_type;
}

function formatSample(sample) {
  if (!sample || sample._error) return null;
  const out = {};
  for (const [k, v] of Object.entries(sample)) {
    if (SECRET.test(k)) {
      out[k] = v == null ? null : "[redacted]";
      continue;
    }
    if (typeof v === "string" && v.length > 280) {
      out[k] = `${v.slice(0, 280)}…`;
      continue;
    }
    if (v && typeof v === "object") {
      const raw = JSON.stringify(v);
      if (raw.length > 400) {
        out[k] = `[json ${raw.length} chars omitted]`;
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

function tableSection(key, { shared }) {
  const meta = live[key];
  if (!meta || meta.missing) {
    return `### ${key}\n\nThis table was not found on the live Worktual database when the catalog was generated.\n`;
  }
  const purpose =
    purposes[key] ||
    (shared
      ? "Shared Worktual table. CRM may only use existing columns."
      : "");
  const sample = formatSample(meta.sample);
  const rows = meta.columns
    .map((c) => {
      const req = c.is_nullable === "NO" ? "yes" : "no";
      let desc = describeColumn(key, c.column_name, typeLabel(c));
      const tag = usageTag(key, c.column_name);
      if (tag) desc = `${desc} ${tag}`;
      if (SECRET.test(c.column_name)) {
        desc = `${desc} Never project this column into a report result.`;
      }
      return `| \`${c.column_name}\` | ${typeLabel(c)} | ${req} | ${desc} |`;
    })
    .join("\n");
  const sampleBlock = sample
    ? `\nLive example (Worktual org \`1003\` when the table has \`organization_id\`; otherwise the first matching row). Secrets are redacted.\n\n\`\`\`json\n${JSON.stringify(sample, null, 2)}\n\`\`\`\n`
    : `\nNo row was available to show a live example.\n`;
  return `### ${key}

${purpose}

Columns below are the live \`information_schema\` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
${rows}
${sampleBlock}`;
}

const crmKeys = Object.keys(live)
  .filter((k) => k.startsWith("crm."))
  .sort();

const md = `# B2B CRM database reference for the reports spoke

This file is the table and column contract for the reports domain agent. The SQL executor uses it to know which table answers a metric and which columns exist. The knowledge-graph executor uses the column meanings and the live example to explain a number.

Column lists for \`accounts\`, \`cdp\`, and \`inventory\` come from the live Worktual database (\`information_schema\`), not from a guessed subset. CRM must not \`CREATE\` / \`ALTER\` / \`DROP\` those schemas. If a column is listed, it exists. If the “CRM reads this” note is absent, the column is still real — do not invent a sales KPI from it.

CRM tables are listed with every live column on that table. Example JSON is a real row from organization \`1003\` (Worktual, \`business_type\` B2B) when the table is tenant-scoped. Secret columns are redacted. Allowed categorical values are at the end under **Enumerations**, each as \`schema.table.column\` — (values).

## Why CRM reads accounts, cdp, and inventory

### accounts

CRM does not store the login user or the tenant. \`accounts.organizations.id\` is \`organization_id\` on every CRM row. \`business_type\` decides B2B / B2C / B2B2C module gating. \`industry_type\` selects the CRM field pack. \`accounts.setup_users.id\` is stored on owners and assignees. Role comes from \`setup_user_product_access\` where \`product_id = 'crm'\` joined to \`setup_roles.name\`. \`auth_sessions\` is the live login. Mailbox OAuth and A2A spoke clients are shared connection rows. Reports join owners to \`setup_users\` for names and always filter \`organization_id\`.

### cdp

Person name, employer text, and most profile fields live on \`cdp.customer_profile\`. Email and phone live on \`cdp.identity_keys\`. \`crm.contact_profiles.account_contact_id\` equals \`cdp_id\`. Lead status, owner, BANT, and marketing opt-out stay on the CRM overlay. Soft-delete is \`crm.contact_profiles.crm_status\`, not a CDP delete. \`cdp.products\` is not the sellable catalog.

### inventory

The only product catalog is \`inventory.products\`. Commercial lines store \`product_id\` and join here. CRM may update existing catalog columns. It must not add columns.

## Shared tables (live columns)

${SHARED.map((k) => tableSection(k, { shared: true })).join("\n")}

## CRM tables (live columns)

${crmKeys.map((k) => tableSection(k, { shared: false })).join("\n")}

${enumerationsMarkdown()}
`;

const dest = new URL(
  "../docs/reports-analytics-spoke/01-database-schema.md",
  import.meta.url,
);
fs.writeFileSync(dest, md);
console.log("wrote", dest.pathname, "bytes", md.length);
