/**
 * Retrieve top-K playbook cards for match (not full playbooks into the writer).
 */

export type PlaybookCard = {
  id: string;
  name: string;
  tags: string[];
  sectionKeys: string[];
  blurb: string;
  score: number;
};

export type PlaybookLike = {
  id: string;
  name: string;
  tags?: unknown;
  tagsJson?: unknown;
  sections?: unknown;
  sectionsJson?: unknown;
  sourceBatchId?: string | null;
  layoutStyle?: unknown;
  updatedAt?: Date | string | null;
  blueprint?: unknown;
  assets?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function tagsOf(playbook: PlaybookLike): string[] {
  const tagsObj = asRecord(playbook.tagsJson);
  const content = asRecord(tagsObj.content);
  const raw = Array.isArray(playbook.tags)
    ? playbook.tags
    : Array.isArray(content.matchTags)
      ? content.matchTags
      : Array.isArray(tagsObj.tags)
        ? tagsObj.tags
        : Array.isArray(playbook.tagsJson)
          ? playbook.tagsJson
          : [];
  return raw.map((t) => String(t).toLowerCase()).filter(Boolean);
}

function sectionKeysOf(playbook: PlaybookLike): string[] {
  const sections = Array.isArray(playbook.sections)
    ? playbook.sections
    : Array.isArray(playbook.sectionsJson)
      ? playbook.sectionsJson
      : [];
  return sections
    .map((s) => {
      const rec = asRecord(s);
      return String(rec.key || rec.title || "").trim();
    })
    .filter(Boolean)
    .slice(0, 16);
}

function blurbOf(playbook: PlaybookLike): string {
  const tagsObj = asRecord(playbook.tagsJson);
  const stored = String(tagsObj.retrievalBlurb || "").trim();
  if (stored) return stored.slice(0, 280);
  return sectionKeysOf(playbook).join(" · ").slice(0, 280);
}

function profileTokens(profile: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const key of ["themes", "products", "industries", "keywords"] as const) {
    const arr = profile[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const t = String(item || "")
        .toLowerCase()
        .trim();
      if (t.length >= 2) out.add(t);
    }
  }
  const summary = String(profile.summary || profile.requirement || "").toLowerCase();
  for (const part of summary.split(/[^a-z0-9]+/)) {
    if (part.length >= 4) out.add(part);
  }
  return out;
}

function layoutSourceOf(playbook: PlaybookLike): string {
  const tagsObj = asRecord(playbook.tagsJson);
  const nested = asRecord(
    playbook.layoutStyle || tagsObj.format || tagsObj.layoutStyle,
  );
  return String(nested.source || "").toLowerCase();
}

function scorePlaybook(
  profile: Record<string, unknown>,
  playbook: PlaybookLike,
): number {
  const tokens = profileTokens(profile);
  const tags = new Set(tagsOf(playbook));
  const keys = sectionKeysOf(playbook).map((k) => k.toLowerCase());
  let score = 0.05;
  for (const tag of tags) {
    if (tokens.has(tag)) score += 0.35;
    for (const t of tokens) {
      if (t.includes(tag) || tag.includes(t)) score += 0.08;
    }
  }
  const name = playbook.name.toLowerCase();
  for (const t of tokens) {
    if (t.length > 3 && name.includes(t)) score += 0.12;
    if (keys.some((k) => k.includes(t))) score += 0.04;
  }
  if (tags.has("general") || name.includes("general")) score += 0.02;
  // Prefer corpus-linked, LLM-designed playbooks over legacy heuristics.
  if (playbook.sourceBatchId) score += 0.18;
  const layoutSource = layoutSourceOf(playbook);
  if (
    layoutSource.includes("gemma") ||
    layoutSource.includes("minimax") ||
    layoutSource.startsWith("llm")
  ) {
    score += 0.12;
  } else if (layoutSource.includes("pdf_geometry")) score += 0.04;
  // Soft recency bias so newer learned batches win ties.
  if (playbook.updatedAt) {
    const ts = new Date(playbook.updatedAt).getTime();
    if (Number.isFinite(ts)) {
      const ageDays = Math.max(0, (Date.now() - ts) / 86_400_000);
      score += Math.max(0, 0.1 - ageDays * 0.01);
    }
  }
  return Math.min(1, score);
}

/** Rank approved playbooks and return top K slim cards for the match LLM. */
export function retrieveTopPlaybooks(
  profile: Record<string, unknown>,
  playbooks: PlaybookLike[],
  topK = 5,
): PlaybookCard[] {
  const scored = playbooks
    .filter((p) => p?.id)
    .map((p) => {
      const score = scorePlaybook(profile, p);
      return {
        id: p.id,
        name: p.name,
        tags: tagsOf(p),
        sectionKeys: sectionKeysOf(p),
        blurb: blurbOf(p),
        score,
      } satisfies PlaybookCard;
    })
    .sort((a, b) => b.score - a.score);

  const k = Math.max(1, Math.min(topK, scored.length));
  return scored.slice(0, k);
}
