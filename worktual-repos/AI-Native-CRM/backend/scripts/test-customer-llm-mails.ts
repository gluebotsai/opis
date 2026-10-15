import { sendLeadAssignmentWelcome } from "../src/service/ai/lead-assignment-welcome";
import { sendOwnerChangeCustomerNotice } from "../src/service/contacts/owner-change-notify";
import { prisma } from "../src/dao/db/prisma.js";

const CONTACT_ID = "723c9f6a-4b90-4221-9411-3d17835144e0";
const ORG_ID = "1000";

async function main() {
  const welcome = await sendLeadAssignmentWelcome({
    contactId: CONTACT_ID,
    organizationId: ORG_ID,
    ownerUserId: "1006",
    scoreResult: {
      score: 72,
      fitScore: 40,
      intentScore: 32,
      band: "hot",
      grade: "A",
      salesReady: true,
      rationale: "Smoke test",
      scoreBreakdown: {},
      pillars: {},
      positiveReasons: [],
      negativeReasons: [],
      behaviouralPositiveReasons: [],
      behaviouralNegativeReasons: [],
      behaviouralReasons: [],
      factors: [],
      nextBestAction: "Schedule discovery call",
      source: "heuristic",
    },
  });
  console.log("welcome", welcome);

  const ownerChange = await sendOwnerChangeCustomerNotice({
    contactId: CONTACT_ID,
    organizationId: ORG_ID,
    newOwnerUserId: "1000",
    previousOwnerUserId: "1006",
  });
  console.log("ownerChange", ownerChange);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
