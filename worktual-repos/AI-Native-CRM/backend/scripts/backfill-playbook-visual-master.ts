/**
 * Re-clone uploaded winning proposal PDFs into playbook blueprint/assets
 * when pattern learning succeeded but visual master step failed.
 *
 * Run: npx tsx scripts/backfill-playbook-visual-master.ts [organizationId] [playbookId]
 */
import { prisma } from "../src/dao/db/prisma.js";
import { readCorpusFile } from "../src/lib/proposal-corpus-storage.js";
import {
  buildVisualMasterFromPdfDetailed,
  playbookHasRasterOnlyVisualMaster,
  playbookHasVisualMaster,
  playbookAssetsHaveVectorText,
} from "../src/lib/proposal-playbook-visual-master.js";
import { loadSellerOrganization } from "../src/service/ai/seller-org.js";

const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const organizationId = cliArgs[0] || process.env.DEFAULT_ORGANIZATION_ID || "1003";
const playbookIdFilter = cliArgs[1]?.trim() || null;
const forceReclone =
  process.argv.includes("--force") || process.argv.includes("--force-raster");

async function main() {
  const playbooks = await prisma.proposalPlaybook.findMany({
    where: {
      organizationId: BigInt(organizationId),
      status: "approved",
      ...(playbookIdFilter ? { id: playbookIdFilter } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!playbooks.length) {
    console.log("No approved playbooks for org", organizationId);
    return;
  }

  const seller = await loadSellerOrganization(String(organizationId));
  let updated = 0;

  for (const pb of playbooks) {
    const hasMaster = playbookHasVisualMaster(pb);
    const rasterOnly = playbookHasRasterOnlyVisualMaster(pb);
    const hasVector = playbookAssetsHaveVectorText(pb.assets);

    if (hasMaster && hasVector && !forceReclone) {
      console.log("skip (vector visual master):", pb.id, pb.name);
      continue;
    }
    if (hasMaster && !rasterOnly && !forceReclone) {
      console.log("skip (has visual master):", pb.id, pb.name);
      continue;
    }
    if (rasterOnly) {
      console.log("re-clone (raster-only visual master):", pb.id, pb.name);
    }

    const tags =
      pb.tagsJson && typeof pb.tagsJson === "object" && !Array.isArray(pb.tagsJson)
        ? (pb.tagsJson as Record<string, unknown>)
        : {};
    const itemId =
      typeof tags.visualMasterItemId === "string"
        ? tags.visualMasterItemId
        : null;

    let proposalItem = itemId
      ? await prisma.proposalCorpusItem.findFirst({
          where: { id: itemId, organizationId: BigInt(organizationId) },
        })
      : null;

    if (!proposalItem && pb.sourceBatchId) {
      proposalItem = await prisma.proposalCorpusItem.findFirst({
        where: {
          batchId: pb.sourceBatchId,
          organizationId: BigInt(organizationId),
          kind: "proposal",
        },
        orderBy: { createdAt: "asc" },
      });
    }

    if (!proposalItem?.storagePath) {
      console.log("skip (no proposal PDF):", pb.id, pb.name);
      continue;
    }

    console.log(
      "cloning visual master:",
      pb.id,
      pb.name,
      "from",
      proposalItem.filename,
    );

    const buf = await readCorpusFile(proposalItem.storagePath);
    const master = await buildVisualMasterFromPdfDetailed({
      contentBase64: buf.toString("base64"),
      filename: proposalItem.filename || "proposal.pdf",
      organizationId: String(organizationId),
      organizationName: seller?.companyName ?? "Vendor",
    });

    if (!master.ok) {
      console.log(
        "FAILED clone:",
        pb.id,
        proposalItem.filename,
        master.failure.reason,
        master.failure.warnings.slice(0, 3),
      );
      continue;
    }

    await prisma.proposalPlaybook.update({
      where: { id: pb.id },
      data: {
        blueprint: master.master.blueprint as object,
        assets: master.master.assets as object,
        tagsJson: {
          ...tags,
          visualMasterFilename: proposalItem.filename,
          visualMasterItemId: proposalItem.id,
          visualMasterBackfilledAt: new Date().toISOString(),
        },
      },
    });
    updated += 1;
    console.log(
      "OK",
      pb.id,
      "pages=",
      master.master.assets.length,
      master.master.warnings.slice(0, 2),
    );
  }

  console.log("done. updated", updated, "of", playbooks.length);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
