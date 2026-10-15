import type { Request, Response, NextFunction } from "express";

export type CoworkerOrgRequest = Request & { coworkerOrgId?: string };

export function tasksSecretExpected(): string {
  return (
    String(process.env.COWORKER_TASKS_SECRET || "").trim() ||
    "worktual-tasks-dev-secret"
  );
}

/** LangGraph service routes scoped by org (tasks key + org header). */
export function requireCoworkerTasksOrg(
  req: CoworkerOrgRequest,
  res: Response,
  next: NextFunction
): void {
  const key = String(req.headers["x-coworker-tasks-key"] || "").trim();
  const orgId = String(req.headers["x-coworker-org-id"] || "").trim();
  if (!key || key !== tasksSecretExpected() || !orgId) {
    res.status(401).json({
      error: "X-Coworker-Tasks-Key and X-Coworker-Org-Id required",
    });
    return;
  }
  req.coworkerOrgId = orgId;
  next();
}

/** Tasks key only (global agent worker routes). */
export function requireCoworkerTasksKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = String(req.headers["x-coworker-tasks-key"] || "").trim();
  if (!key || key !== tasksSecretExpected()) {
    res.status(401).json({ error: "X-Coworker-Tasks-Key required" });
    return;
  }
  next();
}
