import {
  repairPageCloneTextOverlap,
  syncPageCloneBlueprintFromAssets,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";

export type TemplateSectionRow = {
  id: string;
  key?: string;
  title: string;
  body: string;
  sortOrder?: number;
};

export type TemplateSectionUpdate = {
  key: string;
  title?: string;
  body?: string;
};

export type TemplateTextReplacement = {
  find: string;
  replace: string;
};

/** Markdown **bold** in a replacement string must become HTML, not visible asterisks. */
export function markdownEmphasisToHtml(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>");
}

export function repairMarkdownEmphasisInHtml(html: string): string {
  return html
    .replace(/\*\*(<(?:strong|b)>)([\s\S]*?)(<\/(?:strong|b)>)\*\*/gi, "$1$2$3")
    .replace(/\*\*([^*<>]+)\*\*/g, "<strong>$1</strong>");
}

export type TemplateEditPayload = {
  sectionUpdates?: TemplateSectionUpdate[];
  textReplacements?: TemplateTextReplacement[];
  rename?: string;
  makeActive?: boolean;
};

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain text from blueprint HTML for LLM context (no base64). */
export function extractBlueprintVisibleText(
  blueprint: DocumentBlueprint | null | undefined,
  limit = 4000,
): string {
  const html = blueprint?.html?.trim() ?? "";
  if (!html) return "";
  const plain = stripHtml(html);
  if (plain.length <= limit) return plain;
  return `${plain.slice(0, limit - 3)}...`;
}

function resolveSectionKey(
  sections: TemplateSectionRow[],
  key: string,
): TemplateSectionRow | undefined {
  const norm = key.trim().toLowerCase();
  return sections.find(
    (s) =>
      (s.key ?? "").trim().toLowerCase() === norm ||
      s.title.trim().toLowerCase() === norm,
  );
}

export function applySectionUpdates(
  sections: TemplateSectionRow[],
  updates: TemplateSectionUpdate[],
): { sections: TemplateSectionRow[]; applied: string[] } {
  const applied: string[] = [];
  if (!updates.length) return { sections, applied };
  const next = sections.map((s) => ({ ...s }));
  for (const patch of updates) {
    const key = (patch.key ?? "").trim();
    if (!key) continue;
    const row = resolveSectionKey(next, key);
    if (!row) continue;
    if (typeof patch.title === "string" && patch.title.trim()) {
      row.title = patch.title.trim();
    }
    if (typeof patch.body === "string") {
      row.body = patch.body;
    }
    applied.push(key);
  }
  return { sections: next, applied };
}

function applyReplacementsToHtml(
  html: string,
  replacements: TemplateTextReplacement[],
): { html: string; count: number } {
  let out = html;
  let count = 0;
  const lockLength = /pdf-text/i.test(html);
  for (const rep of replacements) {
    const find = rep.find ?? "";
    let replace = rep.replace ?? "";
    if (!find || !out.includes(find)) continue;
    replace = markdownEmphasisToHtml(replace);
    // Page-clone spans are width-locked; keep replacements from blowing past the box.
    if (lockLength) {
      const maxLen = Math.max(8, Math.ceil(find.length * 1.12));
      if (replace.length > maxLen) {
        const clipped = replace.slice(0, maxLen);
        const cut = clipped.lastIndexOf(" ");
        replace = (cut > maxLen * 0.6 ? clipped.slice(0, cut) : clipped).trimEnd();
      }
    }
    out = out.split(find).join(replace);
    count += 1;
  }
  out = repairMarkdownEmphasisInHtml(out);
  return { html: out, count };
}

export function applyTemplateEditPatches(input: {
  sections: TemplateSectionRow[];
  blueprint: DocumentBlueprint | null | undefined;
  assets: BlueprintAsset[];
  edits: TemplateEditPayload;
}): {
  sections: TemplateSectionRow[];
  blueprint: DocumentBlueprint | null | undefined;
  assets: BlueprintAsset[];
  applied: string[];
} {
  const applied: string[] = [];
  let sections = input.sections;
  let blueprint = input.blueprint ?? null;
  let assets = input.assets;

  const sectionResult = applySectionUpdates(
    sections,
    input.edits.sectionUpdates ?? [],
  );
  sections = sectionResult.sections;
  applied.push(...sectionResult.applied.map((k) => `section:${k}`));

  const replacements = (input.edits.textReplacements ?? []).filter(
    (r) => (r.find ?? "").length > 0,
  );
  if (replacements.length && blueprint) {
    const bp = applyReplacementsToHtml(blueprint.html, replacements);
    if (bp.count > 0) {
      blueprint = { ...blueprint, html: bp.html };
      applied.push(`text:${bp.count}`);
    }
    if (typeof blueprint.fillHtml === "string" && blueprint.fillHtml.trim()) {
      const fill = applyReplacementsToHtml(blueprint.fillHtml, replacements);
      if (fill.count > 0) {
        blueprint = { ...blueprint, fillHtml: fill.html };
        applied.push(`fill:${fill.count}`);
      }
    }
  }

  if (replacements.length && assets.length) {
    assets = assets.map((asset) => {
      const pageHtml = (asset as BlueprintAsset & { pageHtml?: string }).pageHtml;
      if (!pageHtml?.trim()) return asset;
      const patched = applyReplacementsToHtml(pageHtml, replacements);
      if (patched.count === 0) return asset;
      applied.push(`asset:${asset.id}`);
      return {
        ...asset,
        pageHtml: repairPageCloneTextOverlap(patched.html),
      };
    });
  }

  if (typeof input.edits.rename === "string" && input.edits.rename.trim()) {
    applied.push("rename");
  }
  if (typeof input.edits.makeActive === "boolean") {
    applied.push(input.edits.makeActive ? "makeActive" : "clearActive");
  }

  if (blueprint && assets.some((asset) => asset.pageHtml?.trim())) {
    const synced = syncPageCloneBlueprintFromAssets(blueprint, assets);
    blueprint = synced.blueprint;
    assets = synced.assets;
  }

  return { sections, blueprint, assets, applied };
}
