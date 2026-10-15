/**
 * Data-access layer registry for Worktual Accounts.
 *
 * Layers:
 * - raw-query     → parameterized SQL in repositories/raw (simple CRUD/reads)
 * - pg-function   → fn_* in database/routines.sql (reusable DB logic)
 * - pg-procedure  → sp_* in database/routines.sql (atomic multi-step DB writes)
 * - js-domain     → server/*.js orchestration (Stripe, email, OAuth, business rules)
 *
 * Rule of thumb:
 * - Side effects outside Postgres → js-domain
 * - Same query used 3+ times or heavy aggregation → pg-function
 * - Stable multi-table atomic write, no external APIs → pg-function or pg-procedure
 * - Everything else → raw-query repository
 */

export const DATA_ACCESS_REGISTRY = {
  "db.pool": { layer: "js-domain", note: "Connection pool + withTransaction" },
  "db.migrate": { layer: "js-domain", note: "Schema orchestration + seed scripts" },

  sessions: {
    layer: "raw-query",
    repo: "repositories/raw/sessions.repo.js",
    note: "Token crypto stays in sessions.js",
  },
  users: {
    layer: "js-domain",
    repo: "repositories/raw/users.repo.js",
    note: "bcrypt + session invalidation",
  },
  pricingCatalog: {
    layer: "raw-query",
    repo: "repositories/raw/pricingCatalog.repo.js",
    note: "Catalog merge/validation stays JS",
  },
  webhookEvents: {
    layer: "pg-function",
    repo: "repositories/functions/webhookEvents.repo.js",
    functions: ["fn_webhook_event_exists", "fn_record_webhook_event"],
  },
  customerProductRequests: {
    layer: "raw-query",
    repo: "repositories/raw/customerProductRequests.repo.js",
  },
  quoteSessions: {
    layer: "raw-query",
    repo: "repositories/raw/quoteSessions.repo.js",
    note: "JSONB draft upsert; branch sync is JS",
  },
  leads: {
    layer: "js-domain",
    repo: "repositories/raw/leads.repo.js",
    note: "Hydration, branch/address sync, domain ID generation stay JS",
  },
  quotations: {
    layer: "js-domain",
    repo: "repositories/raw/quotations.repo.js",
    functions: ["fn_transition_quotation_status", "fn_update_lead_status"],
    note: "Approve/reject via PG functions; Stripe + active_products sync stay JS",
  },
  duplicatePurchase: {
    layer: "js-domain",
    repo: "repositories/functions/duplicatePurchase.repo.js",
    functions: ["fn_duplicate_purchase_context"],
    note: "Renewal date math + error messages stay JS",
  },
  supportTickets: {
    layer: "pg-function",
    repo: "repositories/raw/supportTickets.repo.js",
    functions: ["fn_create_support_ticket_with_message"],
    note: "Ticket create via PG function; list/reply/status via raw repo",
  },
  customerHub: {
    layer: "pg-function",
    repo: "repositories/raw/customerHub.repo.js",
    functions: ["fn_lead_status_counts"],
    note: "Portfolio assembly stays JS",
  },
  organizations: {
    layer: "js-domain",
    repo: "repositories/raw/organizations.repo.js",
    note: "Lead→org conversion + location copy",
  },
  subscriptions: {
    layer: "js-domain",
    repo: "repositories/raw/subscriptions.repo.js",
    note: "MRR math, billing hooks, org conversion orchestration",
  },
  customerAuth: {
    layer: "js-domain",
    repo: "repositories/raw/customerAuth.repo.js",
    note: "Password hashing + grant sync rules",
  },
  payments_fulfillment: {
    layer: "js-domain",
    repo: "repositories/raw/payments.repo.js",
    note: "Email, portal, org conversion hub",
  },
  payments_leadFulfillment: {
    layer: "js-domain",
    note: "Pure orchestration — delegates to quotations, fulfillment, customerAuth",
  },
  salesOversight: {
    layer: "pg-function",
    repo: "repositories/raw/salesOversight.repo.js",
    functions: [
      "fn_sales_oversight_period_summary",
      "fn_sales_oversight_pipeline_funnel",
      "fn_sales_oversight_dashboard_meta",
      "fn_sales_oversight_stale_leads",
    ],
    note: "Agent metrics and lead detail assembly stay JS",
  },
  renewals: {
    layer: "raw-query",
    repo: "repositories/raw/renewals.repo.js",
    note: "Schedule upserts and renewal workflow flags",
  },
  usageMetrics: {
    layer: "js-domain",
    repo: "repositories/raw/usageMetrics.repo.js",
    note: "Product metric definitions from JS config",
  },
  subscriptionInvoices: {
    layer: "js-domain",
    repo: "repositories/raw/subscriptionInvoices.repo.js",
    note: "Proration/GST calendar rules",
  },
  mailCache: {
    layer: "raw-query",
    repo: "repositories/raw/mailCache.repo.js",
    note: "In-memory TTL cache + JSONB folder persistence",
  },
  msGraphTokens: {
    layer: "js-domain",
    repo: "repositories/raw/mailOAuth.repo.js",
    note: "OAuth refresh + encryption",
  },
  msGraphOAuth: {
    layer: "js-domain",
    repo: "repositories/raw/mailOAuth.repo.js",
    note: "Microsoft OAuth + Graph verification",
  },
  userBulkUpload: {
    layer: "js-domain",
    repo: "repositories/raw/users.repo.js",
    note: "CSV parsing in src/lib; email dedup via users repo",
  },
};

export function describeDataAccess(moduleKey: any) {
  return (DATA_ACCESS_REGISTRY as Record<string, any>)[moduleKey] || { layer: "raw-query", note: "Not catalogued yet" };
}
