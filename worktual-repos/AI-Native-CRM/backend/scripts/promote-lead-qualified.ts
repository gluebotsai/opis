/** One-off: promote qualifying lead after post-meeting for a contact. */
import { buildLifecycleContext } from "../src/service/ai/lead-lifecycle-context.js";
import { decideLifecycleHeuristic } from "../src/service/ai/lead-lifecycle-decide.js";
import { enforceEvidenceBar } from "../src/service/ai/lead-lifecycle-evidence.js";
import { applyLifecycleDecision } from "../src/service/ai/lead-lifecycle-apply.js";
import { getContact } from "../src/dao/contacts/contact-service.js";
import { prisma } from "../src/dao/db/prisma.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";

const ctx = await buildLifecycleContext(contactId, "1000");
if (!ctx) throw new Error("no ctx");

const heuristic = decideLifecycleHeuristic(ctx);
const decision =
  heuristic.action.kind === "lead_status" && heuristic.action.to === "qualified"
    ? heuristic
    : {
        action: { kind: "lead_status" as const, to: "qualified" as const },
        ladder: "lead_status" as const,
        from: ctx.leadStatus,
        to: "qualified",
        reason: "Manual promote after post-meeting",
      };

const gated = enforceEvidenceBar(ctx, decision);
console.log("gated", gated.action, gated.reason);
const outcome = await applyLifecycleDecision(ctx, gated);
console.log("outcome", outcome);

const contact = await getContact(contactId);
console.log("leadStatus now", contact?.person.leadStatus);
await prisma.$disconnect();
