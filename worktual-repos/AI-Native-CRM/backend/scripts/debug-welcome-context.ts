import { getContact } from "../src/dao/contacts/contact-service";
import { buildWelcomeLeadContext } from "../src/service/ai/lead-assignment-welcome";
import { buildOwnerChangeNotifyContext } from "../src/service/contacts/owner-change-notify";
import { prisma } from "../src/dao/db/prisma.js";

const id = "cpf3d2cd4012544c4e932974d4693e6784";

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ profile_id: string; account_contact_id: string; email: string }>
  >(
    `
    SELECT cp.id as profile_id, cp.account_contact_id, lower(ik.key_value) as email
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    JOIN cdp.identity_keys ik ON ik.cdp_id = p.cdp_id AND ik.key_type = 'email'
    WHERE cp.id = $1
    `,
    id,
  );
  console.log("profile row", rows[0]);
  const accountId = rows[0]?.account_contact_id;
  if (!accountId) return;

  const c = await getContact(accountId);
  console.log(
    "getContact",
    c
      ? {
          id: c.id,
          email: c.person.email,
          org: c.person.organizationId,
          displayName: c.displayName,
        }
      : null,
  );

  const w = await buildWelcomeLeadContext({
    contactId: accountId,
    ownerUserId: "1006",
    scoreResult: {
      score: 72,
      fitScore: 40,
      intentScore: 32,
      band: "hot",
      grade: "A",
      salesReady: true,
      rationale: "x",
      scoreBreakdown: {},
      pillars: {},
      positiveReasons: [],
      negativeReasons: [],
      behaviouralPositiveReasons: [],
      behaviouralNegativeReasons: [],
      behaviouralReasons: [],
      factors: [],
      nextBestAction: "call",
    },
  });
  console.log("welcome ctx", w);

  const o = await buildOwnerChangeNotifyContext({
    contactId: accountId,
    newOwnerUserId: "1000",
    previousOwnerUserId: "1006",
    organizationId: "1000",
  });
  console.log("owner ctx", o);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
