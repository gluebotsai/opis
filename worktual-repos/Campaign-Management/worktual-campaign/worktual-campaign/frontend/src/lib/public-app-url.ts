/**
 * Public app origin for shareable links (forms, etc.).
 * Set VITE_PUBLIC_APP_URL when testing on LAN (e.g. http://192.168.11.31:5173).
 */
export function publicAppOrigin(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function publicAppPath(path: string): string {
  const base = publicAppOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}
