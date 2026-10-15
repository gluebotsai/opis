/** Shared auth for /api/internal/* agent endpoints (Python ai-service). */

export function isInternalAgentAuthorized(request: Request): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  return request.headers.get("x-internal-secret") === secret;
}
