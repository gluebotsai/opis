/**
 * One-off login diagnostic — no secrets printed.
 * Usage: node scripts/debug-login.mjs <email> [password]
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: path.join(root, ".env") });

const email = process.argv[2];
const password = process.argv[3];
const WEB_TRACKING_PRODUCT_ID = "web-tracking";

if (!email) {
  console.error("Usage: node scripts/debug-login.mjs <email> [password]");
  process.exit(1);
}

const authSourceRaw = process.env.AUTH_SOURCE && process.env.AUTH_SOURCE.trim().toLowerCase();
const authSource =
  authSourceRaw ||
  ((process.env.DB_NAME && process.env.DB_NAME.includes("worktual_bigint")) ||
  process.env.DB_SCHEMA === "accounts"
    ? "my_accounts"
    : "legacy_admin");

console.log("AUTH_SOURCE (resolved):", authSource);
console.log("DB:", process.env.DB_HOST, process.env.DB_NAME, "schema:", process.env.DB_SCHEMA);

const prisma = new PrismaClient();

async function main() {
  if (authSource === "my_accounts") {
    let rows;
    try {
      rows = await prisma.$queryRaw`
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
        WHERE lower(u.work_email) = lower(${email})
        LIMIT 1
      `;
    } catch (err) {
      console.log("DB query error:", (err.message || String(err)).slice(0, 200));
      process.exit(1);
    }

    const row = rows[0];
    if (!row) {
      console.log("Result: user NOT FOUND in accounts.setup_users (work_email)");
      process.exit(0);
    }

    console.log("Result: user found in setup_users");
    console.log("  id:", String(row.id));
    console.log("  work_email:", row.email);
    console.log("  status:", row.status);
    console.log("  invite_status:", row.invite_status);
    console.log("  password_set_at:", row.password_set_at ? "set" : "missing");
    console.log("  organization_id:", row.organization_id != null ? String(row.organization_id) : null);
    console.log("  web_tracking_role:", row.role_name || "(none)");
    console.log("  hash_format:", row.password_hash && row.password_hash.startsWith("$2") ? "bcrypt" : "unknown/other");

    const accessRows = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM accounts.setup_user_product_access pa
        WHERE pa.user_id = ${typeof row.id === "bigint" ? Number(row.id) : row.id}
          AND pa.product_id = ${WEB_TRACKING_PRODUCT_ID}
      ) AS found
    `;
    console.log("  web_tracking_access:", Boolean(accessRows[0]?.found));

    if (password) {
      const ok = row.password_hash ? await bcrypt.compare(password, row.password_hash) : false;
      console.log("  password_match:", ok);
    } else {
      console.log("  (pass password as 2nd arg to test verify)");
    }

    if (row.organization_id != null) {
      const orgId = typeof row.organization_id === "bigint" ? Number(row.organization_id) : row.organization_id;
      const sites = await prisma.$queryRaw`
        WITH live AS (
          SELECT entitlement_config AS config
          FROM accounts.subscriptions
          WHERE organization_id = ${orgId}
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
          WHERE pgl.organization_id = ${orgId}
            AND ap.product_id = ${WEB_TRACKING_PRODUCT_ID}
          LIMIT 1
        ),
        chosen AS (
          SELECT COALESCE((SELECT config FROM live), (SELECT config FROM prelive)) AS config
        )
        SELECT slot.key AS website_id, slot.value->>'url' AS website_url
        FROM chosen,
        LATERAL jsonb_each(
          CASE
            WHEN jsonb_typeof(chosen.config->'visitorAllowanceBySlot') = 'object'
            THEN chosen.config->'visitorAllowanceBySlot'
            ELSE '{}'::jsonb
          END
        ) AS slot(key, value)
        WHERE slot.key ~ '^[0-9]+$'
      `;
      console.log("  web_tracking_websites:", sites.length);
      for (const s of sites.slice(0, 5)) {
        console.log(`    - id=${s.website_id} url=${s.website_url || "(empty)"}`);
      }
    }
  } else {
    console.log("Legacy mode — checking public.admin_accounts via Prisma");
    const row = await prisma.adminAccount.findFirst({ where: { email, isActive: true } });
    console.log("Result:", row ? "found" : "NOT FOUND");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
