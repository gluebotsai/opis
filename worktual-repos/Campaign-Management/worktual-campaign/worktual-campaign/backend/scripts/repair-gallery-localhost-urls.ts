/**
 * Clear localhost gallery hero URLs for all orgs so bootstrap can regenerate images.
 * Run: tsx scripts/repair-gallery-localhost-urls.ts
 * Docker: docker compose exec backend npx tsx scripts/repair-gallery-localhost-urls.ts
 */
import { prisma } from "../src/plugins/prisma.js";
import { isLocalOnlyMediaUrl } from "../src/helpers/gallery-template-images.js";

function asObj(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function hasLocalMediaUrl(row: {
  previewImage: string | null;
  fields: unknown;
}): boolean {
  const preview = String(row.previewImage || "");
  if (isLocalOnlyMediaUrl(preview)) return true;
  const fields = asObj(row.fields);
  for (const key of ["image_url", "header_image", "header_media_url"]) {
    if (isLocalOnlyMediaUrl(String(fields[key] || ""))) return true;
  }
  return false;
}

async function main() {
  const rows = await prisma.campaignLibraryTemplate.findMany({
    where: { source: "generated" },
    select: {
      id: true,
      organizationId: true,
      previewImage: true,
      fields: true,
      metadata: true,
    },
  });

  let updated = 0;
  const orgs = new Set<string>();

  for (const row of rows) {
    if (!hasLocalMediaUrl(row)) continue;

    const fields = asObj(row.fields);
    const meta = asObj(row.metadata);
    const preview = String(row.previewImage || "");

    for (const key of ["image_url", "header_image", "header_media_url"]) {
      if (isLocalOnlyMediaUrl(String(fields[key] || ""))) {
        delete fields[key];
      }
    }
    meta.galleryHeroAttached = false;
    meta.hasImage = false;

    await prisma.campaignLibraryTemplate.update({
      where: { id: row.id },
      data: {
        previewImage: isLocalOnlyMediaUrl(preview) ? null : row.previewImage,
        fields,
        metadata: meta,
      },
    });

    updated += 1;
    orgs.add(String(row.organizationId));
  }

  console.log("repaired rows", updated);
  console.log("affected orgs", [...orgs].sort());
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
