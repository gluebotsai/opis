/**
 * Keeps the last rendered page of a module list.
 *
 * Leaving a list unmounts it, so coming back used to start from empty state:
 * skeleton first, rows only after the request landed. Seeding from here paints
 * the rows the user already had, and the refetch happens behind them.
 *
 * Keyed by the search and filter signature, so each distinct view keeps its
 * own rows. Bounded, because filter combinations are unbounded. In memory for
 * the session only — a reload starts clean.
 */
export type ListCache<T> = {
  read: (key: string) => T | undefined;
  write: (key: string, value: T) => void;
  clear: () => void;
};

const registry = new Set<{ clear: () => void }>();

/** Signing out must not leave the next user looking at these rows. */
export function clearAllListCaches(): void {
  for (const cache of registry) cache.clear();
}

export function createListCache<T>(limit = 8): ListCache<T> {
  const entries = new Map<string, T>();
  const cache: ListCache<T> = {
    read: (key) => entries.get(key),
    write: (key, value) => {
      // Re-insert so the most recently used key is last.
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear: () => entries.clear(),
  };
  registry.add(cache);
  return cache;
}
