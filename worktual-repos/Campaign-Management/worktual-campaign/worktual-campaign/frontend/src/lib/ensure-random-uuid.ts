/** UUID v4 without crypto.randomUUID (e.g. HTTP on a LAN IP is not a secure context). */
function fallbackRandomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Patch `crypto.randomUUID` when missing (common on http://192.168.x.x during LAN dev).
 * Safe to call multiple times.
 */
export function ensureRandomUuid(): void {
  const cryptoObj = globalThis.crypto as Crypto & {
    randomUUID?: () => string;
  };
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return;

  const randomUUID = fallbackRandomUuid;

  if (cryptoObj) {
    try {
      Object.defineProperty(cryptoObj, "randomUUID", {
        value: randomUUID,
        configurable: true,
        writable: true,
      });
      return;
    } catch {
      /* read-only crypto — assign below */
    }
  }

  Object.defineProperty(globalThis, "crypto", {
    value: { ...(cryptoObj ?? {}), randomUUID },
    configurable: true,
    writable: true,
  });
}
