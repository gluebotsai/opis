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
  assets: Array<{ id: string; pageHtml?: string }> | undefined,
): string[] {
  const ids = new Set(extractHeaderLogoAssetIds(blueprintHtml));
  for (const asset of assets ?? []) {
    if (asset.pageHtml?.trim()) {
      for (const id of extractHeaderLogoAssetIds(asset.pageHtml)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

function applyLogoToAssets<
  T extends { id: string; kind: "logo" | "image"; mime: string; dataBase64: string; pageHtml?: string },
>(assets: T[] | undefined, logo: LogoUpload, ids: string[]): T[] {
  const idSet = new Set(ids);
  const b64 = normalizeLogoBase64(logo.dataBase64);
  const merged = mergeLogoAsset(assets, logo);
  return merged.map((asset) => {
    if (!idSet.has(asset.id)) return asset;
    return { ...asset, kind: "logo" as const, mime: logo.mime, dataBase64: b64 };
  });
}

export function patchBlueprintLogoHtml<T extends { html: string }>(
  blueprint: T,
  logo: LogoUpload,
): T {
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

export function mergeLogoAsset<
  T extends { id: string; kind: "logo" | "image"; mime: string; dataBase64: string },
>(assets: T[] | undefined, logo: LogoUpload): T[] {
  const b64 = normalizeLogoBase64(logo.dataBase64);
  const out = (assets ?? []).filter((a) => a.id !== "logo");
  out.push({
    id: "logo",
    kind: "logo",
    mime: logo.mime,
    dataBase64: b64,
  } as T);
  return out;
}

export function patchTemplateLogo<
  TBlueprint extends { html: string },
  TAsset extends {
    id: string;
    kind: "logo" | "image";
    mime: string;
    dataBase64: string;
    pageHtml?: string;
  },
>(
  blueprint: TBlueprint,
  assets: TAsset[] | undefined,
  logo: LogoUpload,
): { blueprint: TBlueprint; assets: TAsset[] } {
  const headerIds = collectHeaderLogoAssetIds(blueprint.html, assets);
  const nextBlueprint = patchBlueprintLogoHtml(blueprint, logo);
  if (headerIds.length > 0) {
    return {
      blueprint: nextBlueprint,
      assets: applyLogoToAssets(assets, logo, headerIds),
    };
  }
  return {
    blueprint: nextBlueprint,
    assets: mergeLogoAsset(assets, logo),
  };
}

export function propagateHeaderLogoAcrossPages<
  TBlueprint extends { html: string },
  TAsset extends {
    id: string;
    kind: "logo" | "image";
    mime: string;
    dataBase64: string;
    pageHtml?: string;
  },
>(
  blueprint: TBlueprint,
  assets: TAsset[] | undefined,
): { blueprint: TBlueprint; assets: TAsset[] } | null {
  const headerIds = collectHeaderLogoAssetIds(blueprint.html, assets);
  if (headerIds.length < 2) return null;
  const byId = new Map<string, LogoUpload>();
  for (const asset of assets ?? []) {
    if (!headerIds.includes(asset.id)) continue;
    if (asset.mime && asset.dataBase64) {
      byId.set(asset.id, { mime: asset.mime, dataBase64: asset.dataBase64 });
    }
  }
  const sourceId =
    headerIds.find((id) => /^pimg-1-/i.test(id)) ??
    headerIds.find((id) => byId.has(id));
  const source = sourceId ? byId.get(sourceId) : undefined;
  if (!source) return null;
  return patchTemplateLogo(blueprint, assets, source);
}
