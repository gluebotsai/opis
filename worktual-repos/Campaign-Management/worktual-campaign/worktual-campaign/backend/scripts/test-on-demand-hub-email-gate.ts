/**
 * Hub on-demand email gate — org 1012 webtracking contact + request email.
 *
 *   npx tsx scripts/test-on-demand-hub-email-gate.ts
 *   npx tsx scripts/test-on-demand-hub-email-gate.ts --http   # POST /campaigns/on-demand (live backend)
 *   npx tsx scripts/test-on-demand-hub-email-gate.ts --launch # full createOnDemandLaunchDao (creates campaign)
 */
import "dotenv/config";
import { createSigner } from "fast-jwt";
import { env } from "../src/config/env.js";
import { getSessionUserById } from "../src/dao/auth.js";
import { accountQuery, accountPool } from "../src/plugins/account-pool.js";
import {
  resolveOnDemandContacts,
  requireEmailDestinations,
  createOnDemandLaunchDao,
  listOnDemandRunsDao,
  type OnDemandLaunchInput,
} from "../src/dao/on-demand-launch.js";
import {
  listContactEmailsByIdsDao,
  ON_DEMAND_CONTACT_LOOKUP_OPTS,
} from "../src/dao/contact.js";
import type { CampaignSessionUser } from "../src/types/auth.js";

const ORG = "1012";
const CDP_ID = "CDP-webtracking-org1012-cmumoop6800iqms01evg9qyjq";
const EMAIL = "h.sivayam@worktual.com";

function arg(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function sessionForOrg(orgId: string): Promise<CampaignSessionUser> {
  const { rows } = await accountQuery<{ id: string }>(
    `SELECT id::text AS id FROM accounts.setup_users
     WHERE organization_id::text = $1 AND lower(status) = 'active'
     ORDER BY id ASC LIMIT 1`,
    [orgId],
  );
  const userId = rows[0]?.id?.trim();
  if (!userId) throw new Error(`No active setup_users for org ${orgId}`);
  const session = await getSessionUserById(userId);
  if (!session) throw new Error(`getSessionUserById failed for ${userId}`);
  return session;
}

async function jwtForSession(session: CampaignSessionUser): Promise<string> {
  const sign = createSigner({
    key: env.jwtSecret,
    expiresIn: 60 * 60 * 1000,
  });
  return sign({
    sub: session.id,
    email: session.email,
    role: session.role,
    organizationId: session.organizationId,
    branchId: session.branchId,
    mode: session.mode,
    industry: session.industry,
  });
}

async function cdpProfileCheck(orgId: string, cdpId: string) {
  const { rows } = await accountQuery<{
    cdp_id: string;
    email_keys: string | null;
  }>(
    `SELECT p.cdp_id::text AS cdp_id,
            (SELECT string_agg(lower(ik.key_value), ',')
             FROM cdp.identity_keys ik
             WHERE ik.cdp_id::text = p.cdp_id::text
               AND ik.organization_id::text = $1::text
               AND lower(ik.key_type) IN ('email', 'primary_email')
            ) AS email_keys
     FROM cdp.customer_profile p
     WHERE p.organization_id::text = $1::text
       AND p.cdp_id::text = $2::text
     LIMIT 1`,
    [orgId, cdpId],
  );
  return rows[0] || null;
}

async function runGate(session: CampaignSessionUser) {
  const input: OnDemandLaunchInput = {
    request_text: `Follow up with ${EMAIL}`,
    emails: [EMAIL],
    customer_ids: [CDP_ID],
    contact_ids: [CDP_ID],
    channels: ["email"],
    source: "hub",
  };
  const identities = {
    emails: [EMAIL],
    phones: [] as string[],
    customerIds: [CDP_ID],
  };

  console.log("\n=== CDP profile ===");
  const prof = await cdpProfileCheck(session.organizationId, CDP_ID);
  console.log(prof ? JSON.stringify(prof, null, 2) : "NOT FOUND");

  console.log("\n=== resolveOnDemandContacts ===");
  const resolved = await resolveOnDemandContacts(session, identities);
  console.log(
    JSON.stringify(
      {
        contactIds: resolved.contactIds,
        cdpIds: resolved.cdpIds,
        hints: resolved.resolvedHints,
      },
      null,
      2,
    ),
  );

  console.log("\n=== requireEmailDestinations (hub gate) ===");
  const gate = await requireEmailDestinations(
    session,
    resolved.contactIds,
    ["email"],
    resolved.resolvedHints,
    ON_DEMAND_CONTACT_LOOKUP_OPTS,
    undefined,
    {
      cdpLookupIds: resolved.cdpIds,
      requestEmails: [EMAIL],
      trustRequestEmails: true,
    },
  );
  console.log(JSON.stringify(gate, null, 2));

  if (!gate.emailsOnFile.length) {
    throw new Error("Email gate failed — emailsOnFile empty");
  }
  if (!gate.emailsOnFile.includes(EMAIL.toLowerCase())) {
    console.warn(
      "WARN: request email not in emailsOnFile; got",
      gate.emailsOnFile,
    );
  }

  console.log("\n=== CDP after gate ===");
  console.log(JSON.stringify(await cdpProfileCheck(session.organizationId, CDP_ID), null, 2));

  console.log("\n=== batch lookup (hashed id only) ===");
  const hashedOnly = await listContactEmailsByIdsDao(
    session,
    resolved.contactIds,
    { skipOpaqueFallback: true },
  );
  console.log("rows", hashedOnly.length);

  console.log("\n=== batch lookup (audience_cdp_ids path) ===");
  const withCdp = await listContactEmailsByIdsDao(session, [
    CDP_ID,
    ...resolved.contactIds,
  ]);
  console.log(JSON.stringify(withCdp, null, 2));

  if (!withCdp.length) {
    throw new Error("Batch email lookup failed with audience_cdp_ids");
  }

  return { input, gate };
}

async function runHttp(session: CampaignSessionUser, input: OnDemandLaunchInput) {
  const token = await jwtForSession(session);
  const base = `http://127.0.0.1:${env.port || 3001}`;
  const body = {
    request_text: input.request_text,
    emails: input.emails,
    customer_ids: input.customer_ids,
    contact_ids: input.contact_ids,
    channels: input.channels,
    source: "hub",
    name: `Hub gate test ${new Date().toISOString()}`,
  };
  console.log("\n=== POST /api/campaigns/on-demand ===");
  const res = await fetch(`${base}/api/campaigns/on-demand`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  console.log("status", res.status);
  console.log(JSON.stringify(data, null, 2).slice(0, 8000));
  if (res.status >= 400) {
    throw new Error(`HTTP on-demand failed: ${res.status}`);
  }
  return data;
}

async function main() {
  const session = await sessionForOrg(ORG);
  if (arg("list")) {
    const t0 = Date.now();
    const runs = await listOnDemandRunsDao(session);
    console.log("\n=== listOnDemandRunsDao ===");
    console.log("count", runs.length, "ms", Date.now() - t0);
    console.log(
      runs.slice(0, 5).map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        hint: r.audienceHint,
      })),
    );
    const { prisma } = await import("../src/plugins/prisma.js");
    const batch = await prisma.campaignSendBatch.findFirst({
      where: { campaignId: "1465", channel: "email" },
      select: {
        id: true,
        status: true,
        size: true,
        scheduledFor: true,
      },
    });
    const rec = await prisma.campaignSendRecipient.findFirst({
      where: { campaignId: "1465" },
      select: {
        email: true,
        status: true,
        updatedAt: true,
        skipFailReason: true,
        providerMessageId: true,
      },
    });
    console.log("campaign 1465 batch", batch, "recipient", rec);
    return;
  }
  console.log("session", {
    userId: session.id,
    org: session.organizationId,
    branch: session.branchId,
    email: session.email,
  });

  const { input } = await runGate(session);

  if (arg("launch")) {
    console.log("\n=== createOnDemandLaunchDao (full) ===");
    const result = await createOnDemandLaunchDao(session, {
      ...input,
      name: `Hub gate E2E ${new Date().toISOString()}`,
    });
    console.log(JSON.stringify(result, null, 2).slice(0, 12000));
    const { prisma } = await import("../src/plugins/prisma.js");
    const batches = await prisma.campaignSendBatch.findMany({
      where: { campaignId: String(result.run?.id || result.campaign?.id || "") },
      select: { id: true, status: true, size: true, channel: true },
    });
    console.log("\n=== email batches ===", batches);
  }

  if (arg("http") || arg("launch")) {
    if (!arg("launch")) {
      await runHttp(session, input);
    }
  }
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await accountPool.end().catch(() => undefined);
    const { prisma } = await import("../src/plugins/prisma.js");
    await prisma.$disconnect().catch(() => undefined);
  });
