/**
 * Lazy one-variant section library derived from synthesize + freeze.
 * Never rewrite playbook sectionsJson or blueprint.mode.
 */

import { canonicalizeSectionKey } from "@/lib/proposal-content-playbook";

export type SectionLibraryEntry = {
  key: string;
  title: string;
  purpose?: string;
  kind?: string;
  targetWordRange?: [number, number] | null;
};

export function deriveSectionLibrary(input: {
  sectionsJson?: unknown;
  sectionSpecsJson?: unknown;
}): { schemaVersion: 1; variants: "one"; sections: SectionLibraryEntry[] } {
  const sections: SectionLibraryEntry[] = [];
  const seen = new Set<string>();
  const specs = input.sectionSpecsJson;
  const specList = Array.isArray(specs)
    ? specs
    : specs && typeof specs === "object"
      ? Object.entries(specs as Record<string, unknown>).map(([key, value]) => ({
          key,
          ...(value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : {}),
        }))
      : [];
  for (const raw of specList) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const key = canonicalizeSectionKey(String(rec.key || rec.sectionKey || ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const range = Array.isArray(rec.targetWordRange)
      ? ([Number(rec.targetWordRange[0]), Number(rec.targetWordRange[1])] as [
          number,
          number,
        ])
      : null;
    sections.push({
      key,
      title: String(rec.title || rec.heading || key),
      purpose: rec.purpose ? String(rec.purpose) : undefined,
      kind: rec.kind ? String(rec.kind) : "prose",
      targetWordRange:
        range && Number.isFinite(range[0]) && Number.isFinite(range[1])
          ? range
          : null,
    });
  }
  const frozen = Array.isArray(input.sectionsJson) ? input.sectionsJson : [];
  for (const raw of frozen) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const key = canonicalizeSectionKey(String(rec.key || rec.id || ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sections.push({
      key,
      title: String(rec.title || key),
      purpose: rec.intent ? String(rec.intent) : undefined,
      kind: "prose",
    });
  }
  return { schemaVersion: 1, variants: "one", sections };
}
