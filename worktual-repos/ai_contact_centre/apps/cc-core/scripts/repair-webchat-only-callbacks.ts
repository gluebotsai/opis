import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG = process.env.ORGANIZATION_ID ?? "1000";
const dryRun = process.argv.includes("--dry-run");

/**
 * Dismiss open coworker callbacks that were created for contacts with no
 * reachable outreach identity (webchat-only visitors incorrectly mapped to WhatsApp).
 */
async function main(): Promise<void> {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const invalid = await ccPrisma.$queryRaw<
    Array<{
      id: string;
      contact_id: string | null;
      channel: string;
      source: string;
      status: string;
    }>
  >`
    SELECT t.id::text AS id,
           t.contact_id::text AS contact_id,
           t.channel,
           t.source,
           t.status
    FROM ccass.agent_tasks t
    WHERE t.organization_id = ${ORG}::bigint
      AND t.task_type = 'callback'
      AND t.status = 'open'
      AND t.contact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM cdp.identity_keys ik
        WHERE ik.organization_id = t.organization_id
          AND ik.cdp_id = t.contact_id::text
          AND ik.key_type IN (
            'whatsapp_phone', 'phone', 'phone_secondary',
            'instagram_user', 'facebook_user',
            'email', 'email_secondary'
          )
      )
    ORDER BY t.id
  `;

  console.log(`Invalid open callbacks (no outreach identity): ${invalid.length}`);
  console.log(JSON.stringify(invalid, null, 2));

  if (dryRun || invalid.length === 0) {
    return;
  }

  const ids = invalid.map((row) => row.id);
  const dismissed = await ccPrisma.$executeRaw`
    UPDATE ccass.agent_tasks
    SET status = 'dismissed',
        notes = CONCAT(
          COALESCE(notes, ''),
          E'\nDismissed: webchat-only contact has no reachable callback channel.'
        ),
        updated_at = NOW()
    WHERE organization_id = ${ORG}::bigint
      AND id = ANY(${ids}::bigint[])
      AND status = 'open'
  `;

  console.log(`Dismissed: ${Number(dismissed)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
