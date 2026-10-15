/**
 * Resolve blueprint + assets for document preview/PDF.
 * Page-clone documents keep deal-personalized HTML; only logo/footer refresh from template.
 */

import {
  parseBlueprintAssets,
  parseDocumentBlueprint,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";
import { isPageCloneBlueprint } from "@/service/sales/document-clone-personalize";

export function resolveDocumentBlueprintForPreview(input: {
  storedBlueprint: unknown;
  storedAssets: unknown;
  templateBlueprint?: unknown | null;
  templateAssets?: unknown | null;
}): {
  blueprint: DocumentBlueprint | null;
  assets: BlueprintAsset[];
  pageClone: boolean;
} {
  const storedBp = parseDocumentBlueprint(input.storedBlueprint);
  const templateBp = parseDocumentBlueprint(input.templateBlueprint);
  let blueprint = storedBp ?? templateBp;
  let assets = parseBlueprintAssets(input.storedAssets);
  const pageClone =
    isPageCloneBlueprint(storedBp) || isPageCloneBlueprint(templateBp);

  if (!pageClone && templateBp) {
    blueprint = templateBp;
  }

  const templateAssets = parseBlueprintAssets(input.templateAssets);
  if (templateAssets.length) {
    const byId = new Map(assets.map((a) => [a.id, a]));
    for (const asset of templateAssets) {
      if (asset.id === "logo" || asset.id === "footer") {
        byId.set(asset.id, asset);
      } else if (!pageClone && !byId.has(asset.id)) {
        byId.set(asset.id, asset);
      }
    }
    assets = [...byId.values()];
  }

  return { blueprint, assets, pageClone };
}
