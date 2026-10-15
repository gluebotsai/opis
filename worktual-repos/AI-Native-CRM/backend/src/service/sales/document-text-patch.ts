/**
 * Apply exact text replacements to proposal blueprint HTML (playbook or page-clone)
 * and pageHtml assets.
 */

import {
  parseBlueprintAssets,
  parseDocumentBlueprint,
  syncPageCloneBlueprintFromAssets,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";
import {
  applyTemplateEditPatches,
  markdownEmphasisToHtml,
  repairMarkdownEmphasisInHtml,
  type TemplateTextReplacement,
} from "@/lib/template-edit-patch";
import { isPageCloneBlueprint } from "@/service/sales/document-clone-personalize";

function applyReplacementsToHtml(
  html: string,
  replacements: TemplateTextReplacement[],
): { html: string; count: number } {
  let out = html;
  let count = 0;
  for (const rep of replacements) {
    const find = rep.find ?? "";
    const replace = rep.replace ?? "";
    if (!find || !out.includes(find)) continue;
    out = out.split(find).join(markdownEmphasisToHtml(replace));
    count += 1;
  }
  out = repairMarkdownEmphasisInHtml(out);
  return { html: out, count };
}

function stripImageRefs(html: string, assetIds: string[]): { html: string; count: number } {
  if (!assetIds.length) return { html, count: 0 };
  let out = html;
  let count = 0;
  for (const assetId of assetIds) {
    const re = new RegExp(
      `<img\\b[^>]*\\bsrc="asset:${assetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/?>`,
      "gi",
    );
    const next = out.replace(re, "");
    if (next !== out) count += 1;
    out = next;
  }
  return { html: out, count };
}

export const TABLE_BORDER_MARKER = "worktual-table-borders";
export const TABLE_BORDER_OFF_MARKER = "worktual-table-borders-off";
const TABLE_BORDER_ON_CLASS = "table-borders-on";
const TABLE_BORDER_OFF_CLASS = "table-borders-off";

export const TABLE_BORDER_CSS = `
.proposal-doc.table-borders-on table:not(.cover-meta),
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta) {
  border-collapse: collapse !important;
}
.proposal-doc.table-borders-on table:not(.cover-meta) th,
.proposal-doc.table-borders-on table:not(.cover-meta) td,
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta) th,
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta) td {
  border: 1px solid #808080 !important;
}
`.trim();

export const TABLE_BORDER_OFF_CSS = `
.proposal-doc.table-borders-off table:not(.cover-meta),
.proposal-doc.table-borders-off table:not(.cover-meta) th,
.proposal-doc.table-borders-off table:not(.cover-meta) td,
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta),
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta) th,
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta) td {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}
`.trim();

function stripMarkedRegion(source: string, marker: string): string {
  const token = `/* ${marker} */`;
  let out = source;
  while (out.includes(token)) {
    const start = out.indexOf(token);
    const rest = out.slice(start + token.length);
    const next = rest.search(/\/\*|<\/style>/i);
    const end = next >= 0 ? start + token.length + next : out.length;
    out = `${out.slice(0, start)}${out.slice(end)}`;
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

function setProposalDocBorderClass(html: string, mode: "on" | "off"): string {
  const add = mode === "on" ? TABLE_BORDER_ON_CLASS : TABLE_BORDER_OFF_CLASS;
  const remove = mode === "on" ? TABLE_BORDER_OFF_CLASS : TABLE_BORDER_ON_CLASS;
  if (/<article\b[^>]*class="/i.test(html)) {
    return html.replace(
      /<article\b([^>]*class=")([^"]*)(")/i,
      (_m, pre: string, classes: string, post: string) => {
        const next = classes
          .split(/\s+/)
          .filter((cls) => cls && cls !== add && cls !== remove);
        next.push(add);
        return `<article${pre}${next.join(" ")}${post}`;
      },
    );
  }
  return html.replace(/<article\b/i, `<article class="${add}"`);
}

export function applyTableBorderMode(
  blueprint: DocumentBlueprint,
  mode: "on" | "off",
): { blueprint: DocumentBlueprint; changed: boolean } {
  const marker = mode === "on" ? TABLE_BORDER_MARKER : TABLE_BORDER_OFF_MARKER;
  const block = mode === "on" ? TABLE_BORDER_CSS : TABLE_BORDER_OFF_CSS;
  let css = stripMarkedRegion(
    stripMarkedRegion(blueprint.css || "", TABLE_BORDER_MARKER),
    TABLE_BORDER_OFF_MARKER,
  );
  let html = stripMarkedRegion(
    stripMarkedRegion(blueprint.html || "", TABLE_BORDER_MARKER),
    TABLE_BORDER_OFF_MARKER,
  );
  const wrapped = `/* ${marker} */\n${block}\n`;
  css = `${css.trim()}\n${wrapped}`.trim();
  if (/<style[\s>]/i.test(html)) {
    html = html.replace(/<style\b[^>]*>/i, (open) => `${open}\n${wrapped}`);
  }
  html = setProposalDocBorderClass(html, mode);
  return { blueprint: { ...blueprint, css, html }, changed: true };
}

/** @deprecated Use applyTableBorderMode(..., "on") */
export function applyTableBordersToBlueprint(
  blueprint: DocumentBlueprint,
): { blueprint: DocumentBlueprint; changed: boolean } {
  return applyTableBorderMode(blueprint, "on");
}

export function applyDocumentTextReplacements(input: {
  blueprint: unknown;
  assets: unknown;
  textReplacements: TemplateTextReplacement[];
  pageId?: string | null;
  removeImageAssetIds?: string[] | null;
  tableBorders?: boolean | null;
}): {
  blueprint: DocumentBlueprint | null;
  assets: BlueprintAsset[];
  applied: number;
} {
  const blueprint = parseDocumentBlueprint(input.blueprint);
  const assets = parseBlueprintAssets(input.assets);
  const replacements = (input.textReplacements ?? []).filter(
    (r) => (r.find ?? "").length > 0,
  );
  const pageId = input.pageId?.trim() || null;
  const removeImageAssetIds = (input.removeImageAssetIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
  const hasTableBorderAction = typeof input.tableBorders === "boolean";
  const tableBorderMode = hasTableBorderAction
    ? input.tableBorders
      ? "on"
      : "off"
    : null;

  if (!replacements.length && !removeImageAssetIds.length && !hasTableBorderAction) {
    return { blueprint, assets, applied: 0 };
  }

  const finish = (
    nextBlueprint: DocumentBlueprint | null,
    nextAssets: BlueprintAsset[],
    applied: number,
  ) => {
    let blueprintOut = nextBlueprint;
    let appliedOut = applied;
    if (tableBorderMode && blueprintOut) {
      const bordered = applyTableBorderMode(blueprintOut, tableBorderMode);
      blueprintOut = bordered.blueprint;
      appliedOut += 1;
    }
    return {
      blueprint: blueprintOut,
      assets: nextAssets,
      applied: appliedOut,
    };
  };

  if (pageId) {
    let applied = 0;
    const nextAssets = assets.map((asset) => {
      if (asset.id !== pageId || !asset.pageHtml?.trim()) return asset;
      let pageHtml = asset.pageHtml;
      if (replacements.length) {
        const patched = applyReplacementsToHtml(pageHtml, replacements);
        pageHtml = patched.html;
        applied += patched.count;
      }
      const stripped = stripImageRefs(pageHtml, removeImageAssetIds);
      pageHtml = stripped.html;
      applied += stripped.count;
      if (pageHtml === asset.pageHtml) return asset;
      return { ...asset, pageHtml };
    });
    if (applied > 0) {
      if (!blueprint) {
        return { blueprint, assets: nextAssets, applied };
      }
      const synced = syncPageCloneBlueprintFromAssets(blueprint, nextAssets);
      return finish(synced.blueprint, synced.assets, applied);
    }
    // Playbook / frozen HTML has no pageHtml assets — fall through to blueprint.html.
  }

  let applied = 0;
  let nextBlueprint = blueprint;
  let nextAssets = assets;

  if (replacements.length) {
    const patched = applyTemplateEditPatches({
      sections: [],
      blueprint,
      assets,
      edits: { textReplacements: replacements },
    });
    nextBlueprint = patched.blueprint ?? blueprint;
    nextAssets = patched.assets;
    applied +=
      patched.applied.filter((row) => row.startsWith("text:")).length +
      patched.applied.filter((row) => row.startsWith("asset:")).length;
  }

  if (removeImageAssetIds.length) {
    nextAssets = nextAssets.map((asset) => {
      const pageHtml = asset.pageHtml?.trim();
      if (!pageHtml) return asset;
      const stripped = stripImageRefs(pageHtml, removeImageAssetIds);
      if (stripped.count === 0) return asset;
      applied += stripped.count;
      return { ...asset, pageHtml: stripped.html };
    });
  }

  if (nextBlueprint) {
    const synced = syncPageCloneBlueprintFromAssets(nextBlueprint, nextAssets);
    nextBlueprint = synced.blueprint;
    nextAssets = synced.assets;
  }

  return finish(nextBlueprint, nextAssets, applied);
}

export function assertDocumentTextEditable(
  blueprint: unknown,
): { ok: true } | { ok: false; error: string } {
  const parsed = parseDocumentBlueprint(blueprint);
  if (!parsed || !String(parsed.html || "").trim()) {
    return {
      ok: false,
      error: "This proposal has no document HTML to edit.",
    };
  }
  return { ok: true };
}

/** @deprecated Use assertDocumentTextEditable — playbook HTML is also editable. */
export function assertPageCloneDocumentEditable(
  blueprint: unknown,
): { ok: true } | { ok: false; error: string } {
  if (isPageCloneBlueprint(parseDocumentBlueprint(blueprint))) {
    return { ok: true };
  }
  return assertDocumentTextEditable(blueprint);
}
