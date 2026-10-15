/**
 * Org proposal playbook = Format (how it looks) + Content (how it is written).
 * Historical PDFs are training input only — never copied into generated output.
 */

import {
  parsePlaybookLayoutStyle,
  type PlaybookLayoutStyle,
} from "@/lib/proposal-playbook-layout";

const STRIP_PROSE_KEYS = new Set([
  "body",
  "sampleText",
  "sample",
  "verbatim",
  "excerpt",
  "pageText",
  "fullText",
  "text",
]);

const LEAK_FAMILIES: Array<{ family: string; re: RegExp; labels: string[] }> = [
  {
    family: "cvm",
    re: /\bcustomer value management\b|\bcvm\b/gi,
    labels: ["Customer Value Management", "CVM"],
  },
  {
    family: "cdp",
    re: /\bcognitive customer data platform\b|\bcustomer data platform\b|\bcognitive cdp\b|\bcdp\b/gi,
    labels: ["Cognitive Customer Data Platform", "Customer Data Platform", "CDP"],
  },
  {
    family: "ticketing",
    re: /\bticketing\b|\bservice desk\b|\bitsm\b/gi,
    labels: ["Ticketing", "ITSM"],
  },
  {
    family: "campaign",
    re: /\bcampaign management\b|\bai native campaign\b/gi,
    labels: ["AI Native Campaign Management", "Campaign Management"],
  },
];

export type PlaybookFormat = PlaybookLayoutStyle & {
  pageCountTypical?: { min?: number; max?: number };
  pageArchetypes?: Record<string, string> | unknown;
  cover?: {
    archetype?: "banner" | "centered" | "left" | string;
    slots?: string[];
  };
  source?: string;
  confidence?: number;
};

export type PlaybookContentSection = {
  key: string;
  title: string;
  intent?: string;
  tone?: string;
  typicalLength?: string;
  wordBand?: string;
  pricingHints?: string;
  contentPattern?: string;
  blocks?: unknown;
  tableSpec?: unknown;
};

export type PlaybookContent = {
  overallTone: string;
  pricingShape: string;
  sectionOrder: string[];
  sections: PlaybookContentSection[];
  matchTags: string[];
  featureSchema?: Record<string, unknown>;
};

export type SplitPlaybookPattern = {
  format: PlaybookFormat;
  content: PlaybookContent;
  visualMasterMode: "none" | "reference";
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const BLOCKED_LAYOUT_SOURCES = new Set([
  "",
  "heuristic",
  "pdf_geometry",
  "geometry_hint_fallback",
  "pdf_geometry_hint",
  "failed",
]);

/** True when design-geometry produced a renderer-usable Format (not a PDF clone). */
export function isUsableLearnedLayout(
  layout: Record<string, unknown> | null | undefined,
): boolean {
  if (!layout) return false;
  const source = String(layout.source || "").trim().toLowerCase();
  const blocked =
    BLOCKED_LAYOUT_SOURCES.has(source) ||
    source === "heuristic+hint" ||
    source.startsWith("geometry_hint_fallback");
  if (blocked) return false;
  return Boolean(
    String(layout.fontFamily || "").trim() &&
      String(layout.headingColor || "").includes("#") &&
      String(layout.coverStyle || "").trim(),
  );
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

/** Turn stored heading_pattern regex into a human section label. */
export function displayPlaybookSectionTitle(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^\^+/, "").replace(/\$+$/, "");
  s = s.replace(/\\([.^$*+?()[\]{}|])/g, "$1");
  s = s.replace(/\.\*+\s*$/, "").replace(/\.\+\s*$/, "");
  s = s.replace(/\(\?:[^)]*\)/g, "");
  s = s.replace(/[\[\](){}]/g, "");
  const cut = s.split(/\s+[—–]\s+/)[0]?.trim() || s;
  if (cut.length >= 3) s = cut;
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 80);
}

function stripProse(section: unknown): PlaybookContentSection | null {
  if (!section || typeof section !== "object") return null;
  const row = { ...(section as Record<string, unknown>) };
  for (const key of STRIP_PROSE_KEYS) delete row[key];
  const key = String(row.key || "").trim();
  if (!key) return null;
  const rawTitle = String(row.title || row.heading_pattern || key).trim();
  return {
    key,
    title: displayPlaybookSectionTitle(rawTitle) || rawTitle.slice(0, 120),
    intent: String(row.intent || "").slice(0, 300),
    tone: String(row.tone || "formal").slice(0, 80),
    typicalLength: String(row.typicalLength || "medium").slice(0, 20),
    wordBand: row.wordBand ? String(row.wordBand).slice(0, 40) : undefined,
    pricingHints: String(row.pricingHints || "").slice(0, 200),
    contentPattern: String(row.contentPattern || "").slice(0, 1200),
    ...(Array.isArray(row.blocks) ? { blocks: row.blocks } : {}),
    ...(row.tableSpec && typeof row.tableSpec === "object"
      ? { tableSpec: row.tableSpec }
      : {}),
  };
}

function tagsFromPlaybook(playbook: {
  tags?: unknown;
  tagsJson?: unknown;
}): string[] {
  const tagsObj = asRecord(playbook.tagsJson);
  const raw = Array.isArray(playbook.tags)
    ? playbook.tags
    : Array.isArray(tagsObj.tags)
      ? tagsObj.tags
      : Array.isArray(playbook.tagsJson)
        ? playbook.tagsJson
        : [];
  return raw.map((t) => String(t).trim()).filter(Boolean);
}

export function parsePlaybookFormat(raw: unknown): PlaybookFormat {
  const o = asRecord(raw);
  const layout = parsePlaybookLayoutStyle(raw);
  const nestedCover = asRecord(o.cover);
  const pageCount = asRecord(o.pageCountTypical);
  const min = Number(pageCount.min);
  const max = Number(pageCount.max);
  const coverStyle = layout.coverStyle;
  return {
    ...layout,
    ...(o.source ? { source: String(o.source) } : {}),
    ...(o.confidence != null ? { confidence: Number(o.confidence) } : {}),
    ...(o.pageArchetypes != null ? { pageArchetypes: o.pageArchetypes } : {}),
    cover: {
      ...layout.cover,
      archetype:
        String(
          nestedCover.archetype ||
            layout.cover?.archetype ||
            coverStyle ||
            "banner",
        ) || "banner",
      ...(asStringList(nestedCover.slots).length
        ? { slots: asStringList(nestedCover.slots) }
        : layout.cover?.slots?.length
          ? { slots: layout.cover.slots }
          : {}),
    },
    ...(Number.isFinite(min) || Number.isFinite(max)
      ? {
          pageCountTypical: {
            ...(Number.isFinite(min) ? { min: Math.round(min) } : {}),
            ...(Number.isFinite(max) ? { max: Math.round(max) } : {}),
          },
        }
      : {}),
  };
}

export function splitPlaybookPattern(playbook: {
  tags?: unknown;
  tagsJson?: unknown;
  sections?: unknown;
  sectionsJson?: unknown;
  layoutStyle?: unknown;
  name?: string;
}): SplitPlaybookPattern {
  const tagsObj = asRecord(playbook.tagsJson);
  const storedFormat = tagsObj.format ?? playbook.layoutStyle ?? tagsObj.layoutStyle;
  const contentMeta = asRecord(tagsObj.content);
  const sectionsRaw = Array.isArray(playbook.sections)
    ? playbook.sections
    : Array.isArray(playbook.sectionsJson)
      ? playbook.sectionsJson
      : Array.isArray(contentMeta.sections)
        ? contentMeta.sections
        : [];
  const sections = sectionsRaw
    .map(stripProse)
    .filter((s): s is PlaybookContentSection => Boolean(s));
  const matchTags = asStringList(contentMeta.matchTags);
  const tags = tagsFromPlaybook(playbook);
  const visualMasterMode =
    tagsObj.visualMasterMode === "reference" ? "reference" : "none";
  return {
    format: parsePlaybookFormat(storedFormat),
    content: {
      overallTone: String(
        contentMeta.overallTone || tagsObj.overallTone || "formal",
      ).slice(0, 80),
      pricingShape: String(
        contentMeta.pricingShape || tagsObj.pricingShape || "line_items",
      ).slice(0, 40),
      sectionOrder: asStringList(contentMeta.sectionOrder).length
        ? asStringList(contentMeta.sectionOrder)
        : sections.map((s) => s.key),
      sections,
      matchTags: matchTags.length ? matchTags : tags,
      ...(contentMeta.featureSchema && typeof contentMeta.featureSchema === "object"
        ? { featureSchema: asRecord(contentMeta.featureSchema) }
        : {}),
    },
    visualMasterMode,
  };
}

export function buildPlaybookTagsJson(input: {
  name?: string;
  tags?: string[];
  format: PlaybookFormat;
  content: PlaybookContent;
  visualMasterMode?: "none" | "reference";
  visualMasterItemId?: string | null;
  visualMasterFilename?: string | null;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const tags = (input.tags?.length ? input.tags : input.content.matchTags).slice(
    0,
    20,
  );
  const sectionTitles = input.content.sections
    .map((s) => s.title || s.key)
    .filter(Boolean)
    .slice(0, 6);
  return {
    tags,
    pricingShape: input.content.pricingShape,
    overallTone: input.content.overallTone,
    layoutStyle: input.format,
    format: input.format,
    content: {
      overallTone: input.content.overallTone,
      pricingShape: input.content.pricingShape,
      sectionOrder: input.content.sectionOrder,
      matchTags: input.content.matchTags.length ? input.content.matchTags : tags,
      ...(input.content.featureSchema
        ? { featureSchema: input.content.featureSchema }
        : {}),
    },
    retrievalBlurb: sectionTitles.join(" · ").slice(0, 280),
    visualMasterMode: input.visualMasterMode ?? "none",
    ...(input.visualMasterItemId
      ? { visualMasterItemId: input.visualMasterItemId }
      : {}),
    ...(input.visualMasterFilename
      ? { visualMasterFilename: input.visualMasterFilename }
      : {}),
    ...(input.extra ?? {}),
  };
}

export function playbookPatternForAgent(playbook: {
  id: string;
  name: string;
  tags?: unknown;
  tagsJson?: unknown;
  sections?: unknown;
  sectionsJson?: unknown;
  layoutStyle?: unknown;
  sourceBatchId?: string | null;
}) {
  const { format, content, visualMasterMode } = splitPlaybookPattern(playbook);
  return {
    id: playbook.id,
    name: playbook.name,
    tags: content.matchTags,
    pricingShape: content.pricingShape,
    overallTone: content.overallTone,
    layoutStyle: format,
    format,
    content,
    sections: content.sections,
    sourceBatchId: playbook.sourceBatchId ?? null,
    visualMasterMode,
  };
}

export type ProposalStyleCluster = {
  name: string;
  tags: string[];
  proposalItemIds: string[];
};

export type ClusterableProposal = {
  itemId: string;
  filename?: string;
  coverStyle?: string;
  pricingShape?: string;
  sectionOrder?: string[];
  headingColor?: string;
  overallTone?: string;
};

function styleKey(item: ClusterableProposal): string {
  const cover = String(item.coverStyle || "banner").toLowerCase();
  const pricing = String(item.pricingShape || "line_items").toLowerCase();
  return `${cover}|${pricing}`;
}

/** Deterministic clustering used when the LLM is unavailable. */
export function heuristicClusterProposals(
  proposals: ClusterableProposal[],
): ProposalStyleCluster[] {
  const byKey = new Map<string, ClusterableProposal[]>();
  for (const item of proposals) {
    if (!item?.itemId) continue;
    const key = styleKey(item);
    const list = byKey.get(key) ?? [];
    list.push(item);
    byKey.set(key, list);
  }
  const clusters: ProposalStyleCluster[] = [];
  for (const [key, items] of byKey) {
    const [cover, pricing] = key.split("|");
    const nameBits = [
      cover === "left" ? "Consultative" : cover === "centered" ? "Centered" : "Standard",
      pricing.includes("tier") ? "Tiered" : pricing.includes("phase") ? "Phased" : null,
    ].filter(Boolean);
    clusters.push({
      name: `${nameBits.join(" ")} proposal pattern`.slice(0, 120),
      tags: [cover, pricing].filter(Boolean),
      proposalItemIds: items.map((i) => i.itemId),
    });
  }
  if (clusters.length === 0 && proposals.length) {
    return [
      {
        name: "Learned proposal pattern",
        tags: ["general"],
        proposalItemIds: proposals.map((p) => p.itemId),
      },
    ];
  }
  return clusters;
}

export function normalizeClusters(
  clusters: ProposalStyleCluster[],
  proposalIds: string[],
): ProposalStyleCluster[] {
  const known = new Set(proposalIds);
  const assigned = new Set<string>();
  const out: ProposalStyleCluster[] = [];
  for (const cluster of clusters) {
    const ids = (cluster.proposalItemIds || []).filter((id) => {
      if (!known.has(id) || assigned.has(id)) return false;
      assigned.add(id);
      return true;
    });
    if (!ids.length) continue;
    out.push({
      name: String(cluster.name || "Learned proposal pattern").slice(0, 120),
      tags: (cluster.tags || []).map((t) => String(t).slice(0, 80)).filter(Boolean),
      proposalItemIds: ids,
    });
  }
  const leftover = proposalIds.filter((id) => !assigned.has(id));
  if (leftover.length) {
    if (out[0]) {
      out[0].proposalItemIds.push(...leftover);
    } else {
      out.push({
        name: "Learned proposal pattern",
        tags: ["general"],
        proposalItemIds: leftover,
      });
    }
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allowedBlob(allowedProducts: string[]): string {
  return allowedProducts.join(" ").toLowerCase();
}

function familyAllowed(family: string, allowed: string[]): boolean {
  const blob = allowedBlob(allowed);
  if (family === "cvm") return /\bcvm\b|customer value/.test(blob);
  if (family === "cdp") return /\bcdp\b|customer data platform/.test(blob);
  if (family === "ticketing") return /\bticket|itsm|service desk/.test(blob);
  if (family === "campaign") return /\bcampaign/.test(blob);
  return true;
}

/**
 * Strip catalog / family names that were not in the meeting-scoped product list.
 * Returns rewritten section bodies plus whether any leak remained.
 */
export function gateProposalSectionsAgainstAllowedProducts(input: {
  sections: Array<{ key?: string; title?: string; body?: string }>;
  allowedProducts: string[];
  catalogNames?: string[];
}): {
  sections: Array<{ key?: string; title?: string; body?: string }>;
  stripped: string[];
  leaked: boolean;
} {
  const allowed = input.allowedProducts.map((n) => n.trim()).filter(Boolean);
  if (!allowed.length) {
    return { sections: input.sections, stripped: [], leaked: false };
  }
  const allowedLower = new Set(allowed.map((n) => n.toLowerCase()));
  const stripped: string[] = [];
  const outOfScopeCatalog = (input.catalogNames ?? []).filter(
    (name) => name.trim() && !allowedLower.has(name.trim().toLowerCase()),
  );

  const sections = input.sections.map((section) => {
    let body = String(section.body || "");
    for (const name of outOfScopeCatalog) {
      const re = new RegExp(escapeRegExp(name), "gi");
      if (re.test(body)) {
        stripped.push(name);
        body = body.replace(re, allowed[0] || "");
      }
    }
    for (const leak of LEAK_FAMILIES) {
      if (familyAllowed(leak.family, allowed)) continue;
      leak.re.lastIndex = 0;
      if (leak.re.test(body)) {
        stripped.push(leak.family);
        leak.re.lastIndex = 0;
        body = body.replace(leak.re, allowed[0] || "");
      }
    }
    const tableRows = Array.isArray(
      (section as { tableRows?: unknown }).tableRows,
    )
      ? (section as { tableRows: Array<{ cells?: unknown }> }).tableRows.map(
          (row) => {
            const cells = Array.isArray(row?.cells) ? row.cells : [];
            return {
              cells: cells.map((cell) => {
                let next = String(cell || "");
                for (const name of outOfScopeCatalog) {
                  const re = new RegExp(escapeRegExp(name), "gi");
                  if (re.test(next)) {
                    stripped.push(name);
                    next = next.replace(re, allowed[0] || "");
                  }
                }
                for (const leak of LEAK_FAMILIES) {
                  if (familyAllowed(leak.family, allowed)) continue;
                  leak.re.lastIndex = 0;
                  if (leak.re.test(next)) {
                    stripped.push(leak.family);
                    leak.re.lastIndex = 0;
                    next = next.replace(leak.re, allowed[0] || "");
                  }
                }
                return next;
              }),
            };
          },
        )
      : undefined;
    return {
      ...section,
      body,
      ...(tableRows ? { tableRows } : {}),
    };
  });

  const leaked = sections.some((section) => {
    const body = String(section.body || "");
    return LEAK_FAMILIES.some((leak) => {
      if (familyAllowed(leak.family, allowed)) return false;
      leak.re.lastIndex = 0;
      return leak.re.test(body);
    });
  });

  return { sections, stripped: [...new Set(stripped)], leaked };
}
