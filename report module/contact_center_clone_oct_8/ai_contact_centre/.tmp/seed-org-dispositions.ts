import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = "1003";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  await ccPrisma.$executeRaw`
    INSERT INTO ccass.dispositions (
      organization_id, code, label, description, category, outcome,
      requires_note, requires_resolution, sort_order, is_active
    )
    VALUES
      (${ORG_ID}::bigint, 'issue_resolved', 'Issue resolved',
       'The customer issue was resolved during this interaction.',
       'resolution', 'resolved', FALSE, TRUE, 10, TRUE),
      (${ORG_ID}::bigint, 'follow_up_required', 'Follow-up required',
       'Additional work or customer follow-up is required.',
       'follow_up', 'unresolved', TRUE, TRUE, 20, TRUE),
      (${ORG_ID}::bigint, 'transferred_to_specialist', 'Transferred to specialist',
       'The interaction was transferred to another queue or agent.',
       'transfer', 'transferred', TRUE, TRUE, 30, TRUE),
      (${ORG_ID}::bigint, 'customer_disconnected', 'Customer disconnected',
       'The customer ended or left the interaction.',
       'closure', 'unresolved', FALSE, TRUE, 40, TRUE)
    ON CONFLICT (organization_id, code) DO UPDATE
      SET is_active = TRUE, updated_at = NOW()
  `;

  const rows = await ccPrisma.$queryRaw`
    SELECT code, label, is_active
    FROM ccass.dispositions
    WHERE organization_id = ${ORG_ID}::bigint
    ORDER BY sort_order
  `;
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
