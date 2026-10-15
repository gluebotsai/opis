/**
 * Read-only dump of live columns + one sample row per reports-schema table.
 * Usage: node --env-file=.env scripts/dump-reports-schema-live.mjs
 */
import fs from "node:fs";
import pg from "../backend/node_modules/pg/lib/index.js";

const url = process.env.DATABASE_URL || process.env.ACCOUNT_DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const tables = [
  ["accounts", "organizations"],
  ["accounts", "setup_users"],
  ["accounts", "setup_roles"],
  ["accounts", "setup_user_product_access"],
  ["accounts", "auth_sessions"],
  ["accounts", "mail_oauth_connections"],
  ["accounts", "a2a_spoke_clients"],
  ["cdp", "customer_profile"],
  ["cdp", "identity_keys"],
  ["inventory", "products"],
  ["crm", "companies"],
  ["crm", "company_locations"],
  ["crm", "contact_profiles"],
  ["crm", "organization_profiles"],
  ["crm", "deals"],
  ["crm", "deal_activities"],
  ["crm", "contact_activities"],
  ["crm", "user_integration_connections"],
  ["crm", "org_assignment_settings"],
  ["crm", "org_finance_settings"],
  ["crm", "payment_gateway_events"],
  ["crm", "sales_user_assignment_profiles"],
  ["crm", "product_offers"],
  ["crm", "price_books"],
  ["crm", "price_book_entries"],
  ["crm", "product_addons"],
  ["crm", "product_addon_tiers"],
  ["crm", "proposal_templates"],
  ["crm", "proposals"],
  ["crm", "quote_templates"],
  ["crm", "quotes"],
  ["crm", "quote_lines"],
  ["crm", "sales_orders"],
  ["crm", "order_lines"],
  ["crm", "invoice_templates"],
  ["crm", "invoices"],
  ["crm", "invoice_lines"],
  ["crm", "contracts"],
  ["crm", "contract_billing_schedules"],
  ["crm", "audit_logs"],
  ["crm", "report_snapshots"],
  ["crm", "domain_enrichment_cache"],
  ["crm", "lead_enrichment_snapshots"],
  ["crm", "lead_enrichment_jobs"],
  ["crm", "agent_step_events"],
  ["crm", "agent_input_fingerprints"],
  ["crm", "lead_summaries"],
  ["crm", "notifications"],
  ["crm", "meeting_analyses"],
  ["crm", "coaching_insights"],
  ["crm", "daily_briefings"],
  ["crm", "privacy_requests"],
  ["crm", "lead_nurture_jobs"],
  ["crm", "lead_lifecycle_jobs"],
  ["crm", "email_auto_reply_jobs"],
  ["crm", "gmail_push_watches"],
  ["crm", "google_calendar_watches"],
  ["crm", "calendar_meet_captures"],
  ["crm", "lead_scoring_jobs"],
  ["crm", "meeting_assist_sessions"],
  ["crm", "meeting_transcript_chunks"],
  ["crm", "process_confirmations"],
  ["crm", "agent_memories"],
  ["crm", "a2a_spoke_tasks"],
  ["crm", "appointments"],
  ["crm", "api_keys"],
  ["crm", "org_research_provider_configs"],
  ["crm", "prospect_pull_jobs"],
  ["crm", "prospect_pull_candidates"],
  ["crm", "prospect_provider_cache"],
  ["crm", "proposal_corpus_batches"],
  ["crm", "proposal_corpus_items"],
  ["crm", "proposal_corpus_pairs"],
  ["crm", "proposal_corpus_case_studies"],
  ["crm", "proposal_content_playbooks"],
  ["crm", "proposal_corpus_jobs"],
  ["crm", "proposal_playbooks"],
  ["crm", "seo_projects"],
  ["crm", "seo_tool_snapshots"],
  ["crm", "seo_generated_content"],
  ["crm", "seo_keyword_queries"],
  ["crm", "seo_saved_keywords"],
  ["crm", "seo_social_posts"],
];

const SECRET = /token|secret|password|hash|refresh|access_token|client_secret|encrypted|api_key|private/i;

function jsonSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  if (typeof value === "object") return value;
  return value;
}

console.error("connecting…");
const client = new pg.Client({
  connectionString: url,
  ssl: false,
  connectionTimeoutMillis: 8000,
});
await client.connect();
console.error("connected");

const out = {};
for (const [schema, table] of tables) {
  console.error("table", `${schema}.${table}`);
  const cols = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  );
  if (cols.rows.length === 0) {
    out[`${schema}.${table}`] = { missing: true, columns: [], sample: null };
    continue;
  }
  const names = cols.rows.map((c) => c.column_name);
  const selectList = names
    .map((n) => (SECRET.test(n) ? `NULL::text AS ${n}` : `"${n}"`))
    .join(", ");
  let sample = null;
  try {
    const rowRes = await client.query(
      `SELECT ${selectList} FROM ${schema}."${table}" LIMIT 1`,
    );
    if (rowRes.rows[0]) {
      sample = {};
      for (const [k, v] of Object.entries(rowRes.rows[0])) {
        sample[k] = jsonSafe(v);
      }
    }
  } catch (err) {
    sample = { _error: String(err.message || err) };
  }
  out[`${schema}.${table}`] = {
    missing: false,
    columns: cols.rows,
    sample,
  };
}

await client.end();
const dest = new URL("./reports-schema-live.json", import.meta.url);
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log("wrote", dest.pathname, "tables", Object.keys(out).length);
