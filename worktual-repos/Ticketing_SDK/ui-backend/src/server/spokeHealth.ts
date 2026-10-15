import type { Express, Request, Response } from "express";
import { query } from "./db";

const SERVICE_NAME = "ticketing-backend";

export async function healthPayload(): Promise<Record<string, unknown>> {
  try {
    await query("SELECT 1");
    return { service: SERVICE_NAME, status: "ok", db: true };
  } catch {
    return { service: SERVICE_NAME, status: "degraded", db: false };
  }
}

export function registerSpokeHealthRoutes(app: Express): void {
  app.get("/health", async (_req: Request, res: Response) => {
    const body = await healthPayload();
    res.status(body.db ? 200 : 503).json(body);
  });

  app.get("/api/health", async (_req: Request, res: Response) => {
    const body = await healthPayload();
    res.status(body.db ? 200 : 503).json(body);
  });
}
