/**
 * One-time copy: my_account_qa.user_calendar_connections → crm_qa.user_integration_connections
 * Does not drop or alter the account-side table.
 *
 * Usage: npx tsx scripts/migrate-integration-connections.ts
 */
import pg from "pg";
import { prisma } from "../backend/src/dao/db/prisma";

type AccountRow = {
  user_id: string;
  provider: string;
  account_email: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: Date | null;
  scope: string | null;
};

const PROVIDERS = new Set(["google", "microsoft", "zoom"]);

async function main() {
  const accountUrl = process.env.ACCOUNT_DATABASE_URL;
  if (!accountUrl) {
    throw new Error("ACCOUNT_DATABASE_URL is not set");
  }

  const pool = new pg.Pool({ connectionString: accountUrl });
  try {
    const { rows } = await pool.query<AccountRow>(
      `SELECT user_id::text AS user_id, provider, account_email, access_token,
              refresh_token, token_expires_at, scope
       FROM public.user_calendar_connections`,
    );

    let copied = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!PROVIDERS.has(row.provider)) {
        skipped += 1;
        continue;
      }

      const orgRows = await pool.query<{ organization_id: string | null }>(
        `SELECT organization_id::text AS organization_id
         FROM accounts.setup_users WHERE id = $1::uuid LIMIT 1`,
        [row.user_id],
      );
      const organizationId = orgRows.rows[0]?.organization_id?.trim();
      if (!organizationId) {
        skipped += 1;
        continue;
      }

      await prisma.userIntegrationConnection.upsert({
        where: {
          userId_provider: {
            userId: row.user_id,
            provider: row.provider as "google" | "microsoft" | "zoom",
          },
        },
        create: {
          organizationId,
          userId: row.user_id,
          provider: row.provider as "google" | "microsoft" | "zoom",
          accountEmail: row.account_email,
          accessToken: row.access_token,
          refreshToken: row.refresh_token,
          tokenExpiresAt: row.token_expires_at,
          scope: row.scope,
        },
        update: {
          organizationId,
          accountEmail: row.account_email,
          accessToken: row.access_token,
          refreshToken: row.refresh_token ?? undefined,
          tokenExpiresAt: row.token_expires_at,
          scope: row.scope,
        },
      });
      copied += 1;
    }

    console.log(
      `Migrated ${copied} connection(s) into crm_qa.user_integration_connections (${skipped} skipped).`,
    );
  } finally {
    await pool.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
