/**
 * Backfill omni_channel_summary for contacts with existing conversations.
 * Calls NLP POST /api/v1/omnichannel/summary/refresh and stores the result on cdp.customer_profile.custom_fields.
 *
 * Prerequisites:
 *   - cc-core running (internal channel-summary routes)
 *   - nlp service running with CHAT_OPENAI_API_KEY
 *   - migration cdp_omni_channel_summary_v1.sql applied
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/backfill-omni-channel-summaries.ts
 *   npx tsx apps/cc-core/scripts/backfill-omni-channel-summaries.ts --org-id <uuid>
 *   npx tsx apps/cc-core/scripts/backfill-omni-channel-summaries.ts --org-id <uuid> --contact-id <uuid>
 *   npx tsx apps/cc-core/scripts/backfill-omni-channel-summaries.ts --org-id <uuid> --limit 25
 *   npx tsx apps/cc-core/scripts/backfill-omni-channel-summaries.ts --all
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import {
  ensureOmniChannelSummarySchema,
  getContactOmniChannelSummary,
  listContactChannelSummaries,
  listContactsNeedingOmniChannelSummary,
  refreshOmniChannelSummary,
} from "../src/services/omni-channel-summary.js";

const WORKTUAL1_ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = readArg("org-id") ?? process.env.ORGANIZATION_ID ?? WORKTUAL1_ORG_ID;
const contactId = readArg("contact-id");
const limitRaw = readArg("limit");
const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
const missingOnly = !process.argv.includes("--all");
const dryRun = process.argv.includes("--dry-run");

const contacts = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`
    SELECT set_config('app.organization_id', ${organizationId}, true)
  `;
  await ensureOmniChannelSummarySchema(db);
  return listContactsNeedingOmniChannelSummary(db, {
    organizationId,
    contactId,
    missingOnly,
  });
});

const targets =
  typeof limit === "number" && Number.isFinite(limit) ? contacts.slice(0, limit) : contacts;

console.log(
  JSON.stringify(
    {
      organizationId,
      contactId: contactId ?? null,
      missingOnly,
      dryRun,
      nlpServiceUrl: process.env.NLP_SERVICE_URL ?? "http://localhost:8000",
      candidates: targets.length,
    },
    null,
    2,
  ),
);

let succeeded = 0;
let skipped = 0;
let failed = 0;

for (const contact of targets) {
  const channelSummaries = await ccPrisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    await db.$executeRaw`
      SELECT set_config('app.organization_id', ${contact.organizationId}, true)
    `;
    return listContactChannelSummaries(db, contact.organizationId, contact.contactId);
  });

  if (channelSummaries.length === 0) {
    skipped += 1;
    console.warn(
      `[skip] ${contact.contactId} — no channel summaries to merge (${channelSummaries.length})`,
    );
    continue;
  }

  if (dryRun) {
    console.log(
      `[dry-run] ${contact.contactId} — would refresh from ${channelSummaries.length} conversation summaries`,
    );
    succeeded += 1;
    continue;
  }

  try {
    const result = await refreshOmniChannelSummary(contact.organizationId, contact.contactId);
    const stored = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      await db.$executeRaw`
        SELECT set_config('app.organization_id', ${contact.organizationId}, true)
      `;
      return getContactOmniChannelSummary(db, contact.organizationId, contact.contactId);
    });

    if (!result.omniChannelSummary && !stored.omniChannelSummary) {
      skipped += 1;
      console.warn(
        `[skip] ${contact.contactId} — NLP returned no summary (${result.channelCount} channels)`,
      );
      continue;
    }

    succeeded += 1;
    const preview = (stored.omniChannelSummary ?? result.omniChannelSummary ?? "").slice(0, 120);
    console.log(
      `[ok] ${contact.contactId} — ${result.channelCount} channels → ${preview}${preview.length >= 120 ? "…" : ""}`,
    );
  } catch (error) {
    failed += 1;
    console.error(
      `[fail] ${contact.contactId}`,
      error instanceof Error ? error.message : error,
    );
  }
}

console.log(
  JSON.stringify(
    {
      total: targets.length,
      succeeded,
      skipped,
      failed,
      organizationId,
    },
    null,
    2,
  ),
);

await ccPrisma.$disconnect();

if (failed > 0) {
  process.exitCode = 1;
}
