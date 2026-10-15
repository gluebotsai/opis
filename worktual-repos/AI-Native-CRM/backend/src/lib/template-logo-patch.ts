import type { BlueprintAsset, DocumentBlueprint } from "@/lib/document-blueprint";

export type LogoUpload = {
  mime: string;
  dataBase64: string;
};

const HEADER_TOP_MAX_PCT = 22;
const MIN_HEADER_HEIGHT_PCT = 2;

function normalizeLogoBase64(dataBase64: string): string {
  return dataBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
}

function logoDataUri(logo: LogoUpload): string {
  return `data:${logo.mime};base64,${normalizeLogoBase64(logo.dataBase64)}`;
}

function parseStylePercent(style: string, prop: string): number | null {
  const m = style.match(new RegExp(`${prop}\\s*:\\s*([\\d.]+)%`, "i"));
  return m ? parseFloat(m[1]) : null;
}

/** Header-region images from uploaded page-clone HTML (pdf-image / bp-logo). */
export function extractHeaderLogoAssetIds(html: string): string[] {
  const ids = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const tag = match[0];
    if (!/\b(?:pdf-image|bp-logo|bp-inv-logo)\b/i.test(tag)) continue;
    const style = /\bstyle="([^"]*)"/i.exec(tag)?.[1] ?? "";
    const top = parseStylePercent(style, "top");
    const height = parseStylePercent(style, "height");
    if (top !== null && top > HEADER_TOP_MAX_PCT) continue;
    if (height !== null && height < MIN_HEADER_HEIGHT_PCT) continue;
    const src = /\bsrc="([^"]+)"/i.exec(tag)?.[1] ?? "";
    const assetMatch = /^asset:([a-zA-Z0-9_-]+)$/.exec(src);
    if (assetMatch) ids.add(assetMatch[1]);
  }
  return [...ids];
}

function collectHeaderLogoAssetIds(
  blueprintHtml: string,
  rawAssets: unknown,
): string[] {
  const ids = new Set(extractHeaderLogoAssetIds(blueprintHtml));
  if (Array.isArray(rawAssets)) {
    for (const item of rawAssets) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { pageHtml?: string }).pageHtml === "string"
      ) {
        for (const id of extractHeaderLogoAssetIds(
          (item as { pageHtml: string }).pageHtml,
        )) {
          ids.add(id);
        }
      }
    }
  }
  return [...ids];
}

function applyLogoToAssetIds(
  rawAssets: unknown,
  logo: LogoUpload,
  ids: string[],
): unknown[] {
  const idSet = new Set(ids);
  const b64 = normalizeLogoBase64(logo.dataBase64);
  const merged = mergeLogoIntoRawAssets(rawAssets, logo);
  return merged.map((item) => {
    if (!item || typeof item !== "object") return item;
    const id = String((item as { id?: string }).id ?? "");
    if (!idSet.has(id)) return item;
    return {
      ...(item as Record<string, unknown>),
      kind: "logo",
      mime: logo.mime,
      dataBase64: b64,
    };
  });
}

/** Replace logo placeholders; standard templates inline all header logo imgs. */
export function patchBlueprintLogoHtml(
  blueprint: DocumentBlueprint,
  logo: LogoUpload,
): DocumentBlueprint {
  const dataUri = logoDataUri(logo);
  let html = blueprint.html.split("asset:logo").join(dataUri);
  const headerIds = extractHeaderLogoAssetIds(html);
  if (headerIds.length === 0) {
    html = html.replace(
      /(<img\b(?=[^>]*\bclass="[^"]*(?:pdf-image|bp-logo|bp-inv-logo)[^"]*")[^>]*\bsrc=")[^"]*(")/gi,
      `$1${dataUri}$2`,
    );
  }
  return { ...blueprint, html };
}

export function mergeLogoAsset(
  assets: BlueprintAsset[],
  logo: LogoUpload,
): BlueprintAsset[] {
  const b64 = normalizeLogoBase64(logo.dataBase64);
  const out = assets.filter((a) => a.id !== "logo");
  out.push({
    id: "logo",
    kind: "logo",
    mime: logo.mime,
    dataBase64: b64,
  });
  return out;
}

/** Merge logo into raw JSON assets (preserves pageHtml on page-* assets). */
export function mergeLogoIntoRawAssets(
  raw: unknown,
  logo: LogoUpload,
): unknown[] {
  const b64 = normalizeLogoBase64(logo.dataBase64);
  const list = Array.isArray(raw)
    ? raw.filter((a) => a && typeof a === "object")
    : [];
  const next = list.filter(
    (a) => String((a as { id?: string }).id ?? "").toLowerCase() !== "logo",
  );
  next.push({
    id: "logo",
    kind: "logo",
    mime: logo.mime,
    dataBase64: b64,
  });
  return next;
}

/** Update header logos on every page-clone page via shared pimg asset rows. */
export function patchTemplateLogo(
  blueprint: DocumentBlueprint,
  rawAssets: unknown,
  logo: LogoUpload,
): { blueprint: DocumentBlueprint; assets: unknown[] } {
  const headerIds = collectHeaderLogoAssetIds(blueprint.html, rawAssets);
  const nextBlueprint = patchBlueprintLogoHtml(blueprint, logo);
  if (headerIds.length > 0) {
    return {
      blueprint: nextBlueprint,
      assets: applyLogoToAssetIds(rawAssets, logo, headerIds),
    };
  }
  return {
    blueprint: nextBlueprint,
    assets: mergeLogoIntoRawAssets(rawAssets, logo),
  };
}

/** Copy page-1 header logo bytes onto every other header logo asset. */
export function propagateHeaderLogoAcrossPages(
  blueprint: DocumentBlueprint,
  rawAssets: unknown,
): { blueprint: DocumentBlueprint; assets: unknown[] } | null {
  const headerIds = collectHeaderLogoAssetIds(blueprint.html, rawAssets);
  if (headerIds.length < 2) return null;
  const list = Array.isArray(rawAssets) ? rawAssets : [];
  const byId = new Map<string, LogoUpload>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as { id?: string }).id ?? "");
    if (!headerIds.includes(id)) continue;
    const mime = String((item as { mime?: string }).mime ?? "");
    const dataBase64 = String((item as { dataBase64?: string }).dataBase64 ?? "");
    if (mime && dataBase64) byId.set(id, { mime, dataBase64 });
  }
  const sourceId =
    headerIds.find((id) => /^pimg-1-/i.test(id)) ??
    headerIds.find((id) => byId.has(id));
  const source = sourceId ? byId.get(sourceId) : undefined;
  if (!source) return null;
  return patchTemplateLogo(blueprint, rawAssets, source);
}
