import fs from "node:fs";
import { execFileSync } from "node:child_process";

const parsed = JSON.parse(
  execFileSync(process.execPath, [
    new URL("./prisma-enum-columns.mjs", import.meta.url).pathname,
  ]),
);

/** Varchar / text codes written by CRM or Accounts. Not Prisma enums. */
const VARCHAR_CODES = [
  {
    key: "accounts.organizations.business_type",
    values: ["b2b", "b2c", "b2b2c"],
    note: "Case in the row may be B2B. Empty string means unset. B2C must not see finance metrics.",
  },
  {
    key: "accounts.setup_users.status",
    values: ["active"],
    note: "CRM only assigns work to active users. Other Accounts statuses may exist; do not invent them.",
  },
  {
    key: "accounts.setup_user_product_access.product_id",
    values: ["crm"],
    note: "CRM reads only product_id = crm. Other Worktual products have their own grants.",
  },
  {
    key: "accounts.auth_sessions.product_id",
    values: ["crm"],
    note: "CRM login sessions use product_id = crm.",
  },
  {
    key: "cdp.customer_profile.contact_type",
    values: ["contact", "lead", "prospect", "customer", "churned"],
    note: "CDP person class. Not a deal stage. converted CRM leads align to customer or churned.",
  },
  {
    key: "cdp.identity_keys.key_type",
    values: ["email", "phone", "email_secondary", "phone_secondary"],
    note: "Values CRM writes. Other systems may also write cdp_id or similar. Do not invent types in SQL.",
  },
  {
    key: "crm.contact_profiles.lead_status",
    values: [
      "new",
      "contacted",
      "qualifying",
      "qualified",
      "disqualified",
      "converted",
    ],
    note: "Sales lead pipeline on the CRM overlay.",
  },
  {
    key: "crm.contact_profiles.crm_status",
    values: ["active", "inactive", "archived"],
    note: "Soft state of the overlay. Current-contact reports filter crm_status = active.",
  },
  {
    key: "crm.organization_profiles.internal_domains_mode",
    values: ["derived", "manual", "needs_manual"],
    note: "How internal email domains were set for meeting routing.",
  },
  {
    key: "crm.contact_profiles.assignment_followup_stage",
    values: [
      "owner_notified",
      "owner_reminded",
      "manager_notified",
      "admin_notified",
      "acted",
    ],
    note: "Assignment follow-up ladder. Null until assignment starts.",
  },
  {
    key: "crm.proposals.approval_status",
    values: [
      "drafting",
      "pending_approval",
      "pending_finance_approval",
      "finance_rejected",
      "sent",
    ],
    note: "Human / finance gate on the proposal document. Separate from proposals.status.",
  },
  {
    key: "crm.quotes.approval_status",
    values: [
      "drafting",
      "pending_approval",
      "pending_finance_approval",
      "finance_rejected",
      "sent",
    ],
    note: "Finance discount gate on the quote. Separate from quotes.status.",
  },
  {
    key: "crm.invoices.approval_status",
    values: ["drafting", "pending_approval", "finance_rejected"],
    note: "Finance approval before send. pending_approval means waiting on finance.",
  },
];

export function enumerationsMarkdown() {
  const prismaLines = parsed.enums.map(
    (e) => `- \`${e.key}\` — (${e.values.join(", ")})`,
  );
  const varcharLines = VARCHAR_CODES.map((e) => {
    const extra = e.note ? ` ${e.note}` : "";
    return `- \`${e.key}\` — (${e.values.join(", ")}).${extra}`;
  });
  return `## Enumerations

Allowed values are listed as \`schema.table.column\` — (value, value). A filter that uses any other spelling will not match rows. Prisma enums live in the \`crm\` type namespace even when the column is on \`inventory.products\`.

### Prisma enum columns

${prismaLines.join("\n")}

### Varchar / text codes CRM writes

These are not Prisma enums. Use only the codes below.

${varcharLines.join("\n")}

\`crm.contact_profiles.disqualify_reason\` and \`crm.contact_profiles.assignment_reason\` are free short codes written by jobs. Group by the stored value. Do not invent a closed list.
`;
}

export const PRISMA_TABLES = parsed.models;
