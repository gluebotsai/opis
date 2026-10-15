export const DEFAULT_API_V1_BASE = "/api/v1";

export function getApiV1Bases(): string[] {
  const bases = [process.env.API_V1_BASE?.trim() || DEFAULT_API_V1_BASE];
  const publicBase = process.env.API_V1_PUBLIC_BASE?.trim();
  if (publicBase && !bases.includes(publicBase)) {
    bases.push(publicBase);
  }
  return bases;
}

export function joinApiV1(base: string, suffix: string): string {
  const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${base.replace(/\/$/, "")}${normalized}`;
}

export type SocialWebhookChannel = "whatsapp" | "facebook" | "instagram";

/** Nginx public prefix for social-service (QA: `/social-api`). */
export function getPublicPathPrefix(): string | null {
  const publicPrefix = process.env.WEBHOOK_PUBLIC_PREFIX?.trim();
  if (!publicPrefix) return null;
  return publicPrefix.replace(/\/$/, "");
}

/** Local + public-prefixed paths, e.g. `/internal/v1/whatsapp/templates` and `/social-api/internal/v1/whatsapp/templates`. */
export function getSocialInternalPaths(path: string): string[] {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const paths = [normalized];
  const prefix = getPublicPathPrefix();
  if (prefix) {
    paths.push(`${prefix}${normalized}`);
  }
  return paths;
}

export function getWebhookPaths(channel: SocialWebhookChannel = "whatsapp"): string[] {
  return getSocialInternalPaths(`/webhooks/${channel}`);
}
