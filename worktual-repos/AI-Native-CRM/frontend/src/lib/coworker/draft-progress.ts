/**
 * Shared required-field progress for co-worker draft panes.
 */

export type DraftProgress = {
  filled: number;
  total: number;
  ready: boolean;
  ratio: number;
};

export function requiredProgress(
  checks: boolean[],
): DraftProgress {
  const total = checks.length;
  const filled = checks.filter(Boolean).length;
  return {
    filled,
    total,
    ready: total > 0 && filled === total,
    ratio: total === 0 ? 0 : filled / total,
  };
}

export function isDraftDirty<T extends Record<string, unknown>>(
  draft: T,
  baseline: T,
  keys?: Array<keyof T>,
): boolean {
  const list = keys ?? (Object.keys(draft) as Array<keyof T>);
  return list.some((k) => {
    const a = draft[k];
    const b = baseline[k];
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    }
    return a !== b;
  });
}

export function newCoworkerMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
