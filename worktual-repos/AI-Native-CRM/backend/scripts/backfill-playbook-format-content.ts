/**
 * Mark existing playbooks as Format + Content patterns and visual-master reference-only.
 * Does not clone PDFs. Generate already ignores playbook assets.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/backfill-playbook-format-content.ts [organizationId]
 */
import { prisma } from "../src/dao/db/prisma.js";
import {
  buildPlaybookTagsJson,
  splitPlaybookPattern,
} from "../src/lib/proposal-playbook-pattern.js";

const organizationId = process.argv[2]?.trim() || null;

async function main() {
  const playbooks = await prisma.proposalPlaybook.findMany({
    where: {
      status: "approved",
      ...(organizationId ? { organizationId: BigInt(organizationId) } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  let updated = 0;
  for (const pb of playbooks) {
    const split = splitPlaybookPattern({
      tagsJson: pb.tagsJson,
      sectionsJson: pb.sectionsJson,
    });
    const existing = asRecord(pb.tagsJson);
    const tags = buildPlaybookTagsJson({
      tags: Array.isArray(existing.tags)
        ? existing.tags.map(String)
        : split.content.matchTags,
      format: split.format,
      content: split.content,
      visualMasterMode: pb.blueprint || pb.assets ? "reference" : "none",
      visualMasterItemId:
        typeof existing.visualMasterItemId === "string"
          ? existing.visualMasterItemId
          : null,
      visualMasterFilename:
        typeof existing.visualMasterFilename === "string"
          ? existing.visualMasterFilename
          : null,
    });
    await prisma.proposalPlaybook.update({
      where: { id: pb.id },
      data: { tagsJson: tags },
    });
    updated += 1;
    console.log(
      "ok",
      pb.id,
      pb.name,
      "mode=",
      tags.visualMasterMode,
      "cover=",
      split.format.coverStyle,
      "sections=",
      split.content.sections.length,
    );
  }
  console.log("done. updated", updated, "of", playbooks.length);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
