/**
 * Align a learned proposal playbook against an existing layout template
 * so reviewers can see what matches, what was renamed, and what is new.
 */

export type PlaybookSection = {
  key: string;
  title: string;
  intent?: string;
  tone?: string;
  typicalLength?: string;
  pricingHints?: string;
};

export type TemplateSectionLike = {
  key?: string;
  title: string;
  body?: string;
  sortOrder?: number;
};

export type PlaybookMeta = {
  tags: string[];
  pricingShape: string | null;
  overallTone: string | null;
};

export type AlignKind = "same" | "renamed" | "playbook_only" | "template_only";

export type AlignRow = {
  kind: AlignKind;
  playbook?: PlaybookSection & { index: number };
  template?: TemplateSectionLike & { index: number };
};

export type AlignSummary = {
  playbookCount: number;
  templateCount: number;
  matched: number;
  renamed: number;
  playbookOnly: number;
  templateOnly: number;
  rows: AlignRow[];
};

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "with",
  "vs",
  "versus",
]);

const GROUPS: string[][] = [
  [
    "introduction",
    "intro",
    "overview",
    "executive summary",
    "cover letter",
    "about us",
  ],
  [
    "requested solution",
    "requested",
    "requirements",
    "scope",
    "scope of work",
    "statement of work",
  ],
  [
    "current approach",
    "considerations with the current approach",
    "as is",
    "current state",
  ],
  [
    "recommended solution",
    "proposed solution",
    "solution",
    "features",
    "solution features",
    "key product features",
    "product features",
  ],
  [
    "requested vs recommended comparison",
    "requested vs recommended",
    "comparison",
    "gap analysis",
  ],
  [
    "commercials",
    "commercial terms",
    "pricing",
    "investment",
    "fees",
    "pricing and commercials",
  ],
  ["assumptions", "exclusions", "dependencies", "assumptions and exclusions"],
  ["conclusion", "next steps", "close", "closing", "call to action"],
  ["onboarding", "implementation", "plan of action", "delivery"],
  ["support", "sla", "maintenance", "managed services"],
];

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^\d+\s+/, "")
    .replace(/\s+/g, " ");
}

function tokens(raw: string): string[] {
  return normalize(raw)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function groupId(raw: string): number {
  const n = normalize(raw);
  return GROUPS.findIndex((g) =>
    g.some((alias) => {
      if (n === alias) return true;
      return alias.includes(" ") && n.includes(alias);
    }),
  );
}

function scoreTitles(
  playbook: Pick<PlaybookSection, "key" | "title">,
  template: Pick<TemplateSectionLike, "key" | "title">,
): number {
  const pk = normalize(playbook.key || "");
  const tk = normalize(template.key || "");
  const pt = normalize(playbook.title || "");
  const tt = normalize(template.title || "");
  if (pt && tt && pt === tt) return 95;
  if (pk && tk && pk === tk) return pt === tt ? 100 : 82;
  if (pk && pk === tt) return 90;

  const pg = groupId(playbook.title || playbook.key);
  const tg = groupId(template.title || template.key || "");
  if (pg >= 0 && pg === tg) return 80;

  const a = new Set(tokens(`${playbook.key} ${playbook.title}`));
  const b = new Set(tokens(`${template.key ?? ""} ${template.title}`));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap += 1;
  const jaccard = overlap / (a.size + b.size - overlap);
  if (overlap >= 2 && jaccard >= 0.4) return Math.round(50 + jaccard * 30);
  if (overlap === 1 && (a.size === 1 || b.size === 1) && jaccard >= 0.5) {
    return 55;
  }
  return 0;
}

export function parsePlaybookSections(raw: unknown): PlaybookSection[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { sections?: unknown }).sections)
      ? (raw as { sections: unknown[] }).sections
      : [];
  const out: PlaybookSection[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title || row.key || "").trim();
    const key = String(row.key || title || "").trim();
    if (!title && !key) continue;
    out.push({
      key,
      title: title || key,
      intent: row.intent != null ? String(row.intent) : undefined,
      tone: row.tone != null ? String(row.tone) : undefined,
      typicalLength:
        row.typicalLength != null ? String(row.typicalLength) : undefined,
      pricingHints:
        row.pricingHints != null ? String(row.pricingHints) : undefined,
    });
  }
  return out;
}

export function parsePlaybookMeta(raw: unknown): PlaybookMeta {
  if (Array.isArray(raw)) {
    return {
      tags: raw.map((t) => String(t)).filter(Boolean),
      pricingShape: null,
      overallTone: null,
    };
  }
  if (!raw || typeof raw !== "object") {
    return { tags: [], pricingShape: null, overallTone: null };
  }
  const row = raw as Record<string, unknown>;
  const tags = Array.isArray(row.tags)
    ? row.tags.map((t) => String(t)).filter(Boolean)
    : [];
  return {
    tags,
    pricingShape: row.pricingShape != null ? String(row.pricingShape) : null,
    overallTone: row.overallTone != null ? String(row.overallTone) : null,
  };
}

export function snippetPlain(htmlOrText: string | undefined, max = 180): string {
  if (!htmlOrText) return "";
  const plain = htmlOrText
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).trim()}…`;
}

export function alignPlaybookToTemplate(
  playbook: PlaybookSection[],
  template: TemplateSectionLike[],
): AlignSummary {
  const pairs: Array<{ p: number; t: number; score: number }> = [];
  playbook.forEach((section, p) => {
    template.forEach((t, tIndex) => {
      const score = scoreTitles(section, t);
      if (score >= 50) pairs.push({ p, t: tIndex, score });
    });
  });
  pairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Math.abs(a.p - a.t) - Math.abs(b.p - b.t);
  });

  const playbookMatch = new Map<number, { t: number; score: number }>();
  const usedTemplate = new Set<number>();
  for (const pair of pairs) {
    if (playbookMatch.has(pair.p) || usedTemplate.has(pair.t)) continue;
    playbookMatch.set(pair.p, { t: pair.t, score: pair.score });
    usedTemplate.add(pair.t);
  }

  const playbookRows: AlignRow[] = playbook.map((section, index) => {
    const hit = playbookMatch.get(index);
    if (!hit) {
      return { kind: "playbook_only" as const, playbook: { ...section, index } };
    }
    const t = template[hit.t];
    return {
      kind: hit.score >= 90 ? ("same" as const) : ("renamed" as const),
      playbook: { ...section, index },
      template: { ...t, index: hit.t },
    };
  });

  const leftover = template
    .map((t, index) => ({ t, index }))
    .filter((row) => !usedTemplate.has(row.index));

  const rows: AlignRow[] = [];
  let leftoverCursor = 0;
  for (const row of playbookRows) {
    const templateIndex = row.template?.index;
    if (templateIndex != null) {
      while (
        leftoverCursor < leftover.length &&
        leftover[leftoverCursor].index < templateIndex
      ) {
        const left = leftover[leftoverCursor];
        rows.push({
          kind: "template_only",
          template: { ...left.t, index: left.index },
        });
        leftoverCursor += 1;
      }
    }
    rows.push(row);
  }
  while (leftoverCursor < leftover.length) {
    const left = leftover[leftoverCursor];
    rows.push({
      kind: "template_only",
      template: { ...left.t, index: left.index },
    });
    leftoverCursor += 1;
  }

  const same = playbookRows.filter((r) => r.kind === "same").length;
  const renamed = playbookRows.filter((r) => r.kind === "renamed").length;
  return {
    playbookCount: playbook.length,
    templateCount: template.length,
    matched: same + renamed,
    renamed,
    playbookOnly: playbookRows.filter((r) => r.kind === "playbook_only").length,
    templateOnly: leftover.length,
    rows,
  };
}

export function alignLabel(kind: AlignKind): string {
  switch (kind) {
    case "same":
      return "Matches template";
    case "renamed":
      return "Similar heading";
    case "playbook_only":
      return "New in playbook";
    case "template_only":
      return "Only in old template";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending_review":
    case "draft":
    case "approved":
    case "completed":
      return "Ready";
    case "rejected":
      return "Disabled";
    case "failed":
      return "Failed";
    case "processing":
    case "ingesting":
    case "structuring":
    case "pairing":
    case "synthesizing":
    case "uploading":
      return "Learning";
    default:
      return status.replace(/_/g, " ");
  }
}
