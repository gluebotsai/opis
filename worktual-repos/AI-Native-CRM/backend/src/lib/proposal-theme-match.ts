export function normalizeRequirementThemes(themes: unknown): string[] {
  const list = Array.isArray(themes) ? themes : [];
  return [
    ...new Set(
      list
        .map((theme) => String(theme || "").trim().toLowerCase())
        .filter((theme) => theme.length >= 2),
    ),
  ].sort();
}

export function readStoredRequirementThemes(blueprint: unknown): string[] {
  const rec =
    blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)
      ? (blueprint as Record<string, unknown>)
      : {};
  return normalizeRequirementThemes(rec.requirementThemes);
}

/** True when a previous draft stored themes and the new profile differs. */
export function requirementThemesChanged(
  stored: unknown,
  incoming: unknown,
): boolean {
  const previous = normalizeRequirementThemes(stored);
  if (!previous.length) return false;
  const next = normalizeRequirementThemes(incoming);
  if (previous.length !== next.length) return true;
  return previous.some((theme, i) => theme !== next[i]);
}
