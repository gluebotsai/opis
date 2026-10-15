import type { Request, Response, NextFunction } from "express";

export function extractInternalServiceKey(req: Request): string {
  return String(req.headers["x-internal-service-key"] || "").trim();
}

export function isValidInternalServiceKey(key: string): boolean {
  const expected = String(process.env.INTERNAL_SERVICE_KEY || "").trim();
  return Boolean(expected && key && key === expected);
}

/** Gate spoke-to-spoke routes that require INTERNAL_SERVICE_KEY. */
export function requireInternalServiceKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = String(process.env.INTERNAL_SERVICE_KEY || "").trim();
  if (!expected) {
    res.status(503).json({ error: "Internal service auth is not configured" });
    return;
  }
  const key = extractInternalServiceKey(req);
  if (!isValidInternalServiceKey(key)) {
    res.status(401).json({ error: "Invalid internal service key" });
    return;
  }
  next();
}

/**
 * Resolve tenant org id for intake when authenticated via internal service key.
 * Org must be supplied by the caller — never inferred from body alone without key.
 */
export function resolveInternalServiceOrgId(req: Request): string | null {
  if (!isValidInternalServiceKey(extractInternalServiceKey(req))) {
    return null;
  }
  const orgId = String(
    req.headers["x-ticketing-org-id"] ||
      req.headers["x-coworker-org-id"] ||
      ""
  ).trim();
  return orgId || null;
}
