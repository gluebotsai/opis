/**
 * Peek JWT `sub` (or common user claims) without verification.
 * Used only to scope sessionStorage soft-nav keys per signed-in user.
 */
import { getToken } from "@/services/api";

export function peekJwtUserId(token?: string | null): string | null {
  const raw = String(token ?? getToken() ?? "").trim();
  if (!raw) return null;
  try {
    const parts = raw.split(".");
    if (parts.length < 2) return null;
    const json = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = json.length % 4 === 0 ? "" : "=".repeat(4 - (json.length % 4));
    const payload = JSON.parse(atob(json + pad)) as Record<string, unknown>;
    for (const key of ["sub", "user_id", "userId", "uid", "id"]) {
      const v = payload[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function currentAuthUserId(): string | null {
  return peekJwtUserId(getToken());
}
