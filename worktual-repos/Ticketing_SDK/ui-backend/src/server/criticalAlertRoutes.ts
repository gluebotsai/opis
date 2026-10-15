import type { Express, Request, RequestHandler, Response } from "express";
import type { AuthUser } from "../types";
import {
  acknowledgeCriticalAlert,
  addCriticalAlertSseClient,
  listPendingCriticalAlerts,
} from "./criticalAlerts";

type AuthedRequest = Request & { user?: AuthUser };

function fail(res: Response, err: unknown) {
  console.error(err);
  return res.status(500).json({ error: "Critical alert request failed." });
}

export function registerCriticalAlertRoutes(
  app: Express,
  requireAuth: RequestHandler
): void {
  app.get(
    "/api/critical-alerts/pending",
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        const user = req.user!;
        const rows = await listPendingCriticalAlerts({
          orgId: user.organizationId,
          userId: user.id,
        });
        res.json(rows);
      } catch (err) {
        fail(res, err);
      }
    }
  );

  app.patch(
    "/api/critical-alerts/:id/ack",
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        const user = req.user!;
        const ok = await acknowledgeCriticalAlert({
          orgId: user.organizationId,
          userId: user.id,
          alertId: String(req.params.id),
        });
        if (!ok) {
          return res.status(404).json({ error: "Alert not found." });
        }
        res.json({ ok: true });
      } catch (err) {
        fail(res, err);
      }
    }
  );

  app.get(
    "/api/critical-alerts/stream",
    requireAuth,
    async (req: AuthedRequest, res) => {
      try {
        const user = req.user!;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        const remove = addCriticalAlertSseClient(
          user.organizationId,
          user.id,
          res
        );
        const ping = setInterval(() => {
          try {
            res.write(
              `event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`
            );
          } catch {
            /* closed */
          }
        }, 25_000);
        req.on("close", () => {
          clearInterval(ping);
          remove();
        });
      } catch (err) {
        fail(res, err);
      }
    }
  );
}
