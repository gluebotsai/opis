/**
 * Regenerate a draft proposal with an explicit playbook + product scope.
 *
 * Run (Docker):
 *   docker compose ... run --rm api \
 *     npx tsx --tsconfig tsconfig.json scripts/regenerate-proposal.ts \
 *     cmtsmse10001b1aimcwfgavv6 cmtsm9all000spd0udgtc6m5r \
 *     --product-hint "CCaaS and CRM only — no CDP or Campaign"
 */
import { prisma } from "../src/dao/db/prisma.js";
import { runWithRequestContext } from "../src/service/account/request-context.js";
import { loadMeetingNotesForDeal } from "../src/service/ai/proposal-brief.js";
import {
  createProposalFromPlaybookCommand,
  readStoredProposalRequirement,
} from "../src/service/sales/proposal-from-playbook-commands.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const proposalId = args[0]?.trim();
const playbookId = args[1]?.trim() || null;
const productHintIdx = process.argv.indexOf("--product-hint");
const productHint =
  productHintIdx >= 0 ? process.argv[productHintIdx + 1]?.trim() || null : null;

async function main() {
  if (!proposalId) {
    console.error(
      "Usage: regenerate-proposal.ts <proposalId> [playbookId] [--product-hint \"...\"]",
    );
    process.exit(1);
  }

  const row = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      deal: {
        select: {
          id: true,
          title: true,
          notes: true,
          ownerUserId: true,
          organizationId: true,
          company: { select: { name: true } },
        },
      },
    },
  });
  if (!row) {
    console.error("Proposal not found:", proposalId);
    process.exit(1);
  }
  if (row.status !== "draft") {
    console.error("Only draft proposals can be regenerated. status=", row.status);
    process.exit(1);
  }

  const bp =
    row.blueprint && typeof row.blueprint === "object" && !Array.isArray(row.blueprint)
      ? (row.blueprint as Record<string, unknown>)
      : null;
  const storedPlaybook =
    typeof bp?.playbookId === "string" ? bp.playbookId.trim() : null;
  const usePlaybook = playbookId || storedPlaybook;

  console.log("regenerate:", row.number || row.id);
  console.log("playbook:", usePlaybook || "(rematch — not recommended)");
  if (productHint) console.log("productHint:", productHint);

  const meetingNotes = await loadMeetingNotesForDeal(row.dealId);
  const storedBrd = readStoredProposalRequirement(row.blueprint);

  const orgId = String(row.deal.organizationId);
  const ownerUserId = row.deal.ownerUserId;

  const result = await runWithRequestContext(
    {
      userId: ownerUserId,
      apiKeyAuth: {
        keyId: "script-regenerate-proposal",
        organizationId: orgId,
        scopes: ["deals"],
      },
    },
    () =>
      createProposalFromPlaybookCommand({
        dealId: row.dealId,
        requirementText: storedBrd || "",
        productHint,
        playbookId: usePlaybook,
        replaceProposalId: proposalId,
        sync: true,
        requirementSource: storedBrd
          ? meetingNotes?.trim()
            ? "meeting+brd"
            : "brd"
          : meetingNotes?.trim()
            ? "meeting"
            : "manual",
      }),
  );

  if (!result.ok) {
    console.error("FAILED:", result.error);
    process.exit(1);
  }

  const updated = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { blueprint: true, sections: true },
  });
  const newBp =
    updated?.blueprint &&
    typeof updated.blueprint === "object" &&
    !Array.isArray(updated.blueprint)
      ? (updated.blueprint as Record<string, unknown>)
      : null;
  console.log("OK", proposalId);
  console.log("playbookId:", newBp?.playbookId ?? result.playbookId ?? "?");
  console.log("rasterHybrid:", newBp?.rasterHybrid ?? false);
  if (result.warnings?.length) {
    for (const w of result.warnings) console.log("warning:", w);
  }
  const sections = Array.isArray(updated?.sections) ? updated.sections : [];
  for (const s of sections.slice(0, 5)) {
    if (!s || typeof s !== "object") continue;
    const body = String((s as { body?: string }).body || "").slice(0, 140);
    console.log(
      "section:",
      (s as { key?: string }).key,
      body.replace(/\s+/g, " "),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
