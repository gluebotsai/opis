import type { DomainOwnership } from "./types.js";

export const routeOwnershipManifest = [
  {
    domain: "health",
    prefixes: ["/api/health"],
    owner: "platform",
    state: "fastify",
    notes: "Readiness owned by Fastify.",
  },
  {
    domain: "auth",
    prefixes: ["/api/auth", "/api/v1/customer/login"],
    owner: "identity",
    state: "hybrid",
    notes:
      "JWT principal endpoint migrated; sign-in and password reset remain legacy.",
  },
  {
    domain: "sessions-access",
    prefixes: ["/api/sessions", "/api/access"],
    owner: "identity",
    state: "legacy",
    notes: "Session concurrency, TTL, and role-based access control.",
  },
  {
    domain: "users-organizations",
    prefixes: ["/api/users", "/api/organizations", "/api/customer/account"],
    owner: "accounts",
    state: "legacy",
    notes: "Includes customer profile and portal access.",
  },
  {
    domain: "customer-lifecycle",
    prefixes: ["/api/customer", "/api/customers"],
    owner: "accounts",
    state: "legacy",
    notes: "Customer contact, deletion, portal users, and account lifecycle.",
  },
  {
    domain: "leads",
    prefixes: ["/api/leads", "/api/quote-sessions"],
    owner: "sales",
    state: "legacy",
    notes: "Lead lifecycle, contact validation, and quote sessions.",
  },
  {
    domain: "quotations-pricing",
    prefixes: [
      "/api/quotations",
      "/api/pricing-catalog",
      "/api/admin/pricing-catalog",
    ],
    owner: "sales",
    state: "legacy",
    notes: "Catalog, quotations, and approvals.",
  },
  {
    domain: "subscriptions-products",
    prefixes: [
      "/api/subscriptions",
      "/api/v1/me/subscriptions",
      "/api/v1/me/product-requests",
    ],
    owner: "accounts",
    state: "legacy",
    notes: "Entitlements, products, usage, and changes.",
  },
  {
    domain: "billing-payments",
    prefixes: [
      "/api/payments",
      "/api/billing",
      "/api/invoices",
      "/api/finance",
    ],
    owner: "finance",
    state: "legacy",
    notes: "Stripe/Razorpay webhooks require raw body.",
  },
  {
    domain: "renewals-commissions",
    prefixes: ["/api/renewals", "/api/commissions"],
    owner: "finance",
    state: "legacy",
    notes: "Renewal invoicing, partner commissions, and finance review.",
  },
  {
    domain: "partners-resellers",
    prefixes: [
      "/api/partner",
      "/api/partners",
      "/api/reseller",
      "/api/resellers",
      "/api/admin/resellers",
    ],
    owner: "sales",
    state: "legacy",
    notes: "Partner and reseller portals, leads, renewals, and commissions.",
  },
  {
    domain: "mail",
    prefixes: ["/api/mail"],
    owner: "operations",
    state: "legacy",
    notes: "Mailbox, templates, OAuth, sync, and Graph subscriptions.",
  },
  {
    domain: "support",
    prefixes: ["/api/support"],
    owner: "operations",
    state: "legacy",
    notes: "Customer and sales support tickets.",
  },
  {
    domain: "notifications",
    prefixes: ["/api/notifications"],
    owner: "operations",
    state: "legacy",
    notes: "Transactional notifications and outbox delivery.",
  },
  {
    domain: "number-management",
    prefixes: ["/api/number-management"],
    owner: "operations",
    state: "legacy",
    notes: "Number mappings and DID usage.",
  },
  {
    domain: "usage-analytics",
    prefixes: ["/api/usage", "/api/analytics"],
    owner: "operations",
    state: "legacy",
    notes: "Usage metrics, monthly aggregation, and dashboards.",
  },
  {
    domain: "validation-reference",
    prefixes: ["/api/v1/tax", "/api/statuses"],
    owner: "accounts",
    state: "legacy",
    notes: "GSTIN, email/mobile validation, and shared statuses.",
  },
  {
    domain: "branches-go-live",
    prefixes: ["/api/branches", "/api/customer/go-live"],
    owner: "operations",
    state: "legacy",
    notes: "Branch lifecycle, additions, cancellation, and UAT.",
  },
  {
    domain: "administration",
    prefixes: ["/api/admin"],
    owner: "accounts",
    state: "legacy",
    notes: "Administrative customers, agents, queues, and policy.",
  },
  {
    domain: "events",
    prefixes: ["/api/events"],
    owner: "platform",
    state: "legacy",
    notes: "SSE remains legacy; new realtime work uses Socket.IO.",
  },
] as const satisfies readonly DomainOwnership[];

export function getRouteOwnership(): readonly DomainOwnership[] {
  return routeOwnershipManifest;
}
