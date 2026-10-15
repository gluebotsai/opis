#!/usr/bin/env npx tsx
/**
 * Backfill ccass.conversations.channel_config_id for webchat and email rows.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/backfill-conversation-channel-config-ids.ts --dry-run
 *   npx tsx apps/cc-core/scripts/backfill-conversation-channel-config-ids.ts --apply
 *   npx tsx apps/cc-core/scripts/backfill-conversation-channel-config-ids.ts --apply --org-id 1000
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import {
  backfillEmailChannelConfigIds,
  backfillWebchatChannelConfigIds,
} from "../src/services/channel-config-id.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const orgArg = process.argv.find((arg) => arg.startsWith("--org-id="));
const orgId = orgArg?.split("=")[1] ?? process.argv[process.argv.indexOf("--org-id") + 1];

async function printStats() {
  const orgFilter = orgId ? `AND c.organization_id = ${orgId}::bigint` : "";
  const emailOrgFilter = orgId ? `AND organization_id = ${orgId}::bigint` : "";

  const [webchat] = await ccPrisma.$queryRawUnsafe<
    Array<{ total: bigint; can_backfill: bigint; orphans: bigint }>
  >(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE c.channel_config_id IS NULL AND wc.channel_config_id IS NOT NULL
      )::bigint AS can_backfill,
      COUNT(*) FILTER (
        WHERE c.channel_config_id IS NULL AND wc.channel_config_id IS NULL
      )::bigint AS orphans
    FROM ccass.conversations c
    LEFT JOIN accounts.setup_webchat_configs wc ON wc.webchat_id = c.webchat_id
    LEFT JOIN accounts.setup_channel_configs cc
      ON cc.id = wc.channel_config_id AND cc.organization_id = c.organization_id
    WHERE c.channel = 'webchat' ${orgFilter}
  `);

  const [email] = await ccPrisma.$queryRawUnsafe<
    Array<{ total: bigint; can_backfill: bigint; no_mailbox: bigint }>
  >(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE channel_config_id IS NULL AND mailbox_connection_id IS NOT NULL
      )::bigint AS can_backfill,
      COUNT(*) FILTER (
        WHERE channel_config_id IS NULL AND mailbox_connection_id IS NULL
      )::bigint AS no_mailbox
    FROM ccass.conversations
    WHERE channel = 'email' ${emailOrgFilter}
  `);

  console.log("Webchat:", {
    total: Number(webchat?.total ?? 0),
    canBackfill: Number(webchat?.can_backfill ?? 0),
    orphans: Number(webchat?.orphans ?? 0),
  });
  console.log("Email:", {
    total: Number(email?.total ?? 0),
    canBackfill: Number(email?.can_backfill ?? 0),
    noMailbox: Number(email?.no_mailbox ?? 0),
  });
}

async function main() {
  await printStats();

  if (dryRun) {
    console.log("\nDry run only. Pass --apply to update rows.");
    return;
  }

  const webchatUpdated = await backfillWebchatChannelConfigIds(ccPrisma, orgId);
  const emailUpdated = await backfillEmailChannelConfigIds(ccPrisma, orgId);
  console.log("\nApplied:", { webchatUpdated, emailUpdated });
  await printStats();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
