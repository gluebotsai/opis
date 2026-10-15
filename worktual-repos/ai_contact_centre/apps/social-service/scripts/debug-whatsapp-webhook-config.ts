/**
 * Diagnose / fix WhatsApp webhook credential lookup by phone_number_id.
 *
 * Usage:
 *   npx tsx apps/social-service/scripts/debug-whatsapp-webhook-config.ts
 *   npx tsx apps/social-service/scripts/debug-whatsapp-webhook-config.ts --phone-number-id 1140103312524386
 *   npx tsx apps/social-service/scripts/debug-whatsapp-webhook-config.ts --phone-number-id 1140103312524386 --channel-id <uuid> --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

type Row = {
  channel_config_id: string;
  organization_id: string;
  provider: string;
  meta_connection_status: string;
  phone_number_id: string | null;
  waba_id: string | null;
  display_number: string | null;
  has_token: boolean;
  channel_status: string;
};

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const phoneArgIndex = process.argv.indexOf("--phone-number-id");
const channelArgIndex = process.argv.indexOf("--channel-id");
const phoneNumberId =
  phoneArgIndex >= 0 ? process.argv[phoneArgIndex + 1]?.trim() : undefined;
const channelConfigId =
  channelArgIndex >= 0 ? process.argv[channelArgIndex + 1]?.trim() : undefined;

await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

const rows = await ccPrisma.$queryRaw<Row[]>`
  SELECT
    sc.channel_config_id,
    cc.organization_id,
    sc.provider,
    sc.meta_connection_status,
    sc.phone_number_id,
    sc.waba_id,
    sc.display_number,
    (sc.access_token_encrypted IS NOT NULL) AS has_token,
    cc.status AS channel_status
  FROM accounts.setup_social_configs sc
  INNER JOIN accounts.setup_channel_configs cc
    ON cc.id = sc.channel_config_id
  WHERE sc.provider = 'whatsapp'
  ORDER BY sc.updated_at DESC
`;

console.log(
  JSON.stringify(
    {
      webhookPhoneNumberId: phoneNumberId ?? null,
      whatsappConfigs: rows,
      match:
        phoneNumberId != null
          ? rows.some((row) => row.phone_number_id === phoneNumberId)
          : null,
    },
    null,
    2,
  ),
);

if (!phoneNumberId || !channelConfigId) {
  await ccPrisma.$disconnect();
  process.exit(rows.length === 0 ? 1 : 0);
}

const target = rows.find((row) => row.channel_config_id === channelConfigId);
if (!target) {
  console.error("channel-id not found among WhatsApp configs");
  await ccPrisma.$disconnect();
  process.exit(1);
}

if (target.phone_number_id === phoneNumberId) {
  console.log("phone_number_id already matches; no update needed.");
  await ccPrisma.$disconnect();
  process.exit(0);
}

console.log(
  JSON.stringify(
    {
      action: live ? "update" : "dry_run",
      channelConfigId,
      fromPhoneNumberId: target.phone_number_id,
      toPhoneNumberId: phoneNumberId,
    },
    null,
    2,
  ),
);

if (!live) {
  console.log("Re-run with --live to apply the phone_number_id update.");
  await ccPrisma.$disconnect();
  process.exit(0);
}

await ccPrisma.$executeRaw`
  UPDATE accounts.setup_social_configs
  SET phone_number_id = ${phoneNumberId}, updated_at = NOW()
  WHERE channel_config_id = ${channelConfigId}::bigint
    AND provider = 'whatsapp'
`;

console.log("Updated phone_number_id.");
await ccPrisma.$disconnect();
