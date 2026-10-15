/**
 * Remove org email suppression + campaign engagement unsubscribe for one address.
 *
 *   npx tsx scripts/clear-email-suppression.ts --org 1012 --email h.sivayam@worktual.com
 *   npx tsx scripts/clear-email-suppression.ts --org 1012 --email user@example.com --contact-id <campaign_contact_id>
 */
import "dotenv/config";
import { prisma } from "../src/plugins/prisma.js";
import { campaignContactIdFromCdp } from "../src/helpers/id-schema.js";
import { accountPool } from "../src/plugins/account-pool.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return undefined;
}

async function resolveContactIds(
  orgId: string,
  email: string,
  explicit?: string,
): Promise<string[]> {
  const out = new Set<string>();
  if (explicit) out.add(explicit);

  const recs = await prisma.campaignSendRecipient.findMany({
    where: {
      organizationId: orgId,
      email: { equals: email, mode: "insensitive" },
    },
    select: { contactId: true },
    take: 20,
  });
  for (const r of recs) {
    if (r.contactId) out.add(String(r.contactId));
  }

  const { rows } = await accountPool.query<{ cdp_id: string }>(
    `SELECT DISTINCT ik.cdp_id::text AS cdp_id
     FROM cdp.identity_keys ik
     WHERE ik.organization_id::text = $1::text
       AND lower(ik.key_type) IN ('email', 'primary_email')
       AND lower(trim(ik.key_value)) = lower(trim($2::text))
     LIMIT 10`,
    [orgId, email],
  );
  for (const row of rows) {
    const cdp = String(row.cdp_id || "").trim();
    if (!cdp) continue;
    out.add(campaignContactIdFromCdp(cdp));
  }

  return [...out];
}

async function main() {
  const orgId = arg("org");
  const emailRaw = arg("email");
  if (!orgId || !emailRaw) {
    throw new Error("Pass --org <id> --email <address>");
  }
  const email = emailRaw.trim().toLowerCase();
  const contactOverride = arg("contact-id");

  const deleted = await prisma.emailSuppression.deleteMany({
    where: { organizationId: orgId, email },
  });

  const contactIds = await resolveContactIds(orgId, email, contactOverride);
  let engagementUpdates = 0;
  for (const contactId of contactIds) {
    const row = await prisma.campaignContactEngagement.findUnique({
      where: {
        organizationId_contactId: { organizationId: orgId, contactId },
      },
    });
    if (!row?.emailUnsubscribed) continue;
    await prisma.campaignContactEngagement.update({
      where: {
        organizationId_contactId: { organizationId: orgId, contactId },
      },
      data: {
        emailUnsubscribed: false,
        emailUnsubscribedAt: null,
        emailUnsubscribeReason: null,
      },
    });
    engagementUpdates += 1;
  }

  console.log(
    JSON.stringify({
      orgId,
      email,
      suppressionsRemoved: deleted.count,
      contactIds,
      engagementUnsubscribeCleared: engagementUpdates,
    }),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await accountPool.end().catch(() => undefined);
  });
