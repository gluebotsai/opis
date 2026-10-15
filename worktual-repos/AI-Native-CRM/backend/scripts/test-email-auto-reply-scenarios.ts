/**
 * Simulate two auto-reply scenarios without relying on live Gmail webhooks:
 *
 * 1) CRM bot mailbox inbox user receives an inbound email → auto-reply
 * 2) Admin / sales rep inbox user receives an inbound email → auto-reply
 *
 * We insert a synthetic inbound contact_activity (folder=inbox,
 * emailDirection=inbound, createdByUserId=mailbox user) and then run the
 * ai-service agent `auto-reply-email` for that inbound activityId.
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/test-email-auto-reply-scenarios.ts
 */
import pg from "pg";
import { randomBytes } from "node:crypto";
import { resolveCrmBotMailbox } from "../src/dao/account/crm-bot-mailbox.ts";
import {
  enqueueEmailAutoReply,
  processEmailAutoReplyJob,
} from "../src/service/ai/email-auto-reply-job.ts";

const ORG_ID = process.env.E2E_ORG_ID || "1000";

// We drive the backend job processor directly (no raw ai-service calls).

const INBOUND_SUBJECT = "Demo request";
const INBOUND_BODY =
  "Yes, we'd like to book a demo next week. What times are available?";

type MailboxScenario = {
  name: string;
  mailboxUserId: string | null;
};

function quoteLiteral(v: string) {
  return v.replaceAll("'", "''");
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const organizationIdBigint = Number(ORG_ID);

  // Find a lead contact id to attach the inbound email to.
  const lead = await client.query<{
    id: string;
  }>(
    `
    SELECT cp.account_contact_id::text AS id
    FROM crm.contact_profiles cp
    WHERE cp.organization_id = $1::bigint
      AND cp.crm_status = 'active'
      AND cp.contact_type = 'lead'
      AND EXISTS (
        SELECT 1
        FROM cdp.identity_keys k
        WHERE k.cdp_id = cp.account_contact_id::text
          AND k.key_type = 'email'
          AND k.key_value IS NOT NULL
          AND btrim(k.key_value) <> ''
      )
    ORDER BY cp.updated_at DESC
    LIMIT 1
    `,
    [organizationIdBigint],
  );
  if (!lead.rows[0]?.id) {
    console.error("No active lead contact_profile found for org", ORG_ID);
    process.exit(1);
  }
  const contactId = lead.rows[0]!.id;

  const botMailbox = await resolveCrmBotMailbox(ORG_ID).catch(() => null);
  const botEmail = (botMailbox?.accountEmail || botMailbox?.senderEmail || "").trim();

  // Discover mailbox users from recent inbound activities in this CRM DB.
  // Inbound activities already encode who received the mail (created_by_user_id).
  const inboundMailboxUsers = await client.query<{ mailbox_user_id: string }>(
    `
    SELECT DISTINCT created_by_user_id::text AS mailbox_user_id
    FROM crm.contact_activities
    WHERE type = 'email'
      AND folder = 'inbox'
      AND email_direction = 'inbound'
      AND created_by_user_id IS NOT NULL
      AND organization_id = $1::bigint
      AND created_at >= NOW() - INTERVAL '14 days'
    ORDER BY created_by_user_id::text DESC
    LIMIT 20
    `,
    [organizationIdBigint],
  );

  const mailboxUserIds = inboundMailboxUsers.rows.map((r) => r.mailbox_user_id);
  if (mailboxUserIds.length === 0) {
    console.log("No recent inbound email activities found; cannot infer mailbox users from DB.");
  }

  // Map candidate mailbox users to their integration account_email (best-effort).
  const userIntegrationByUserId: Record<
    string,
    { account_email: string | null; provider: string | null; scope: string | null }[]
  > = {};

  for (const uid of mailboxUserIds) {
    const uic = await client.query<{
      account_email: string | null;
      provider: string | null;
      scope: string | null;
    }>(
      `
      SELECT account_email, provider::text AS provider, scope
      FROM crm.user_integration_connections
      WHERE user_id = $1::bigint
      ORDER BY updated_at DESC
      LIMIT 5
      `,
      [uid],
    );
    userIntegrationByUserId[uid] = uic.rows.map((r) => ({
      account_email: r.account_email,
      provider: r.provider,
      scope: r.scope,
    }));
  }

  const botMailboxUserId = botEmail
    ? mailboxUserIds.find((uid) =>
        (userIntegrationByUserId[uid] ?? []).some(
          (x) => (x.account_email ?? "").toLowerCase() === botEmail.toLowerCase(),
        ),
      ) ?? null
    : null;

  // If we can't map bot inbox user via account_email (sometimes integrations
  // have account_email = NULL), fall back to inferring by provider.
  const botProvider = botMailbox?.oauthProvider ?? null;
  const botMailboxUserIdFallback = botMailboxUserId
    ? botMailboxUserId
    : botProvider
      ? mailboxUserIds.find((uid) =>
          (userIntegrationByUserId[uid] ?? []).some(
            (x) => (x.provider ?? null) === botProvider,
          ),
        ) ?? null
      : null;

  const nonBotMailboxUserId = mailboxUserIds.find((uid) => uid !== botMailboxUserIdFallback) ?? null;

  const scenarios: MailboxScenario[] = [
    { name: "crm_bot_mailbox_user (inferred from DB)", mailboxUserId: botMailboxUserIdFallback },
    { name: "admin_sales_rep_mailbox_user (non-bot mailbox user inferred)", mailboxUserId: nonBotMailboxUserId },
  ];

  for (const scenario of scenarios) {
    console.log(`\n=== Scenario: ${scenario.name} ===`);
    if (!scenario.mailboxUserId) {
      console.log("SKIP: mailboxUserId not found for this scenario.");
      continue;
    }

    const syntheticActivityId = `e2e_inbound_${randomBytes(10).toString("hex")}`;

    // Insert synthetic inbound activity row.
    const inserted = await client.query<{
      activity_id: string;
    }>(
      `
      INSERT INTO crm.contact_activities (
        id,
        organization_id,
        contact_id,
        type,
        folder,
        email_direction,
        subject,
        body,
        created_by_user_id,
        created_at,
        updated_at
      ) VALUES (
        $1::text,
        $2::bigint,
        $3::text,
        'email',
        'inbox',
        'inbound',
        $4::text,
        $5::text,
        $6::bigint,
        NOW(),
        NOW()
      )
      RETURNING id::text AS activity_id
      `,
      [
        syntheticActivityId,
        organizationIdBigint,
        contactId,
        INBOUND_SUBJECT,
        INBOUND_BODY,
        scenario.mailboxUserId,
      ],
    );

    const inboundActivityId = inserted.rows[0]!.activity_id;
    console.log("Inserted inbound activity:", inboundActivityId);

    const job = await enqueueEmailAutoReply({
      activityId: inboundActivityId,
      contactId,
      mailboxUserId: scenario.mailboxUserId,
      organizationId: ORG_ID,
      processImmediately: false,
    });

    if (!job) {
      console.log("enqueueEmailAutoReply returned null; skipping processing.");
      continue;
    }

    const processed = await processEmailAutoReplyJob(job);
    console.log("processed job:", {
      status: processed?.status ?? null,
      decision: processed?.decision ?? null,
      sensitivity: processed?.sensitivity ?? null,
      category: processed?.category ?? null,
      reason: processed?.reason ?? null,
      lastError: processed?.lastError ?? null,
      replyActivityId: processed?.replyActivityId ?? null,
    });

    // Read job status from CRM DB.
    const jobRow = await client.query<{
      status: string | null;
      decision: string | null;
      sensitivity: string | null;
      category: string | null;
      reason: string | null;
      last_error: string | null;
      reply_activity_id: string | null;
    }>(
      `
      SELECT status::text AS status,
             decision::text AS decision,
             sensitivity::text AS sensitivity,
             category::text AS category,
             reason::text AS reason,
             last_error::text AS last_error,
             reply_activity_id::text AS reply_activity_id
      FROM crm.email_auto_reply_jobs
      WHERE inbound_activity_id = $1::text
      LIMIT 1
      `,
      [inboundActivityId],
    );

    const j = jobRow.rows[0] ?? null;
    console.log("job row:", j);

    const sentCount = await client.query<{ n: string }>(
      `
      SELECT count(*)::text AS n
      FROM crm.contact_activities
      WHERE contact_id = $1::text
        AND type = 'email'
        AND folder = 'sent'
        AND email_direction = 'outbound'
        AND created_by_user_id = $2::bigint
        AND created_at >= NOW() - INTERVAL '2 minutes'
      `,
      [contactId, scenario.mailboxUserId],
    );
    console.log("outbound sent activities (last 2m):", sentCount.rows[0]?.n ?? "0");
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

