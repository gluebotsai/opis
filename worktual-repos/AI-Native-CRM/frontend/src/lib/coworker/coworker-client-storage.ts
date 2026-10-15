/** Legacy global thread key (pre user-scoping) — must not be reused across logins. */
export const LEGACY_COWORKER_THREAD_KEY = "crm-coworker-thread";

export const COWORKER_RAIL_OPEN_KEY = "crm-coworker-rail-open";

export const COWORKER_FROM_CONTACT_KEY = "crm-coworker-from-contact";

export const COWORKER_STM_PREFIX = "crm-coworker-stm:";

export function coworkerThreadStorageKey(
  organizationId: string,
  userId: string,
): string {
  const org = organizationId.trim();
  const user = userId.trim();
  if (!org || !user) return LEGACY_COWORKER_THREAD_KEY;
  return `crm-coworker-thread:${org}:${user}`;
}

/** Drop coworker UI state from this tab (call on logout). */
export function clearCoworkerClientStorage(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(LEGACY_COWORKER_THREAD_KEY);
    sessionStorage.removeItem(COWORKER_RAIL_OPEN_KEY);
    sessionStorage.removeItem(COWORKER_FROM_CONTACT_KEY);
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (
        key &&
        (key.startsWith(COWORKER_STM_PREFIX) ||
          key.startsWith("crm-coworker-thread:"))
      ) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

/** Remove abandoned global thread so it cannot attach to the next login. */
export function discardLegacyCoworkerThread(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(LEGACY_COWORKER_THREAD_KEY);
  } catch {
    /* private mode */
  }
}
