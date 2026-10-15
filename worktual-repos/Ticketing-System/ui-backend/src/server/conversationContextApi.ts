import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import type { AuthUser } from "../types";
import { query } from "./db";

type AuthedRequest = Request & { user?: AuthUser };

export function registerConversationContextRoutes(
  app: Express,
  requireAuthOrServiceActor: RequestHandler
): void {
  app.get(
    "/api/coworker/conversation-context",
    requireAuthOrServiceActor,
    async (req: AuthedRequest, res: Response) => {
      try {
        const orgId = String(req.user?.organizationId || "").trim();
        const userId = String(req.user?.id || "anonymous");
        const sessionId = String(req.query.sessionId || req.query.session_id || "").trim();
        if (!orgId || !sessionId) {
          return res.status(400).json({ error: "sessionId is required" });
        }

        const { rows } = await query<{ context: Record<string, unknown>; version: number }>(
          `SELECT context, version
           FROM conversation_contexts
           WHERE organization_id = $1::bigint
             AND user_key = $2
             AND session_key = $3
             AND (expires_at IS NULL OR expires_at > NOW())`,
          [orgId, userId, sessionId]
        );
        const row = rows[0];
        if (!row) {
          return res.json({ context: null, version: 0 });
        }
        res.json({
          context: row.context || null,
          version: Number(row.version || 0),
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load conversation context" });
      }
    }
  );

  app.put(
    "/api/coworker/conversation-context",
    requireAuthOrServiceActor,
    async (req: AuthedRequest, res: Response) => {
      try {
        const orgId = String(req.user?.organizationId || "").trim();
        const userId = String(req.user?.id || "anonymous");
        const sessionId = String(req.body?.sessionId || req.body?.session_id || "").trim();
        const context = req.body?.context;
        const expectedVersion = Number(req.body?.expectedVersion ?? req.body?.expected_version ?? 0);

        if (!orgId || !sessionId || !context || typeof context !== "object") {
          return res.status(400).json({ error: "sessionId and context object are required" });
        }

        const { rows } = await query<{ version: number }>(
          `INSERT INTO conversation_contexts
             (organization_id, user_key, session_key, context, version, expires_at)
           VALUES ($1::bigint, $2, $3, $4::jsonb, 1, NOW() + INTERVAL '30 days')
           ON CONFLICT (organization_id, user_key, session_key)
           DO UPDATE SET
             context = EXCLUDED.context,
             version = conversation_contexts.version + 1,
             updated_at = NOW(),
             expires_at = EXCLUDED.expires_at
           WHERE conversation_contexts.version = $5
           RETURNING version`,
          [orgId, userId, sessionId, JSON.stringify(context), Math.max(0, expectedVersion)]
        );

        if (!rows[0]) {
          return res.status(409).json({ error: "conversation_context was updated by another turn" });
        }

        res.json({ version: Number(rows[0].version || 0) });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save conversation context" });
      }
    }
  );

  app.post(
    "/api/coworker/workflow-events",
    requireAuthOrServiceActor,
    async (req: AuthedRequest, res: Response) => {
      try {
        const orgId = String(req.user?.organizationId || "").trim();
        const userId = String(req.user?.id || "anonymous");
        const sessionId = String(req.body?.sessionId || req.body?.session_id || "").trim();
        const requestId = String(req.body?.requestId || req.body?.request_id || "").trim();
        const events = Array.isArray(req.body?.events) ? req.body.events : [];

        if (!orgId || !sessionId || !requestId || events.length === 0) {
          return res.status(400).json({ error: "sessionId, requestId, and events are required" });
        }

        for (const event of events) {
          const details = event?.details && typeof event.details === "object" ? event.details : {};
          const workflowId =
            String(details.workflow || details.workflow_id || "").trim() || null;
          const workflowType =
            String(
              details.workflow_type ||
                details.workflowType ||
                details.workflow ||
                ""
            ).trim() || "general";
          const versionRaw =
            event?.version ??
            details.state_version ??
            details.stateVersion ??
            details.version;
          const version = Number(versionRaw);
          await query(
            `INSERT INTO workflow_events
               (organization_id, user_key, session_key, request_id,
                conversation_context_id, workflow_id, workflow_type,
                event_type, event_data, version, created_at, expires_at)
             VALUES (
               $1::bigint, $2, $3, $4,
               (SELECT id FROM conversation_contexts
                WHERE organization_id = $1::bigint AND user_key = $2 AND session_key = $3),
               $5, $6, $7, $8::jsonb, $9, NOW(), NOW() + INTERVAL '30 days'
             )`,
            [
              orgId,
              userId,
              sessionId,
              requestId,
              workflowId,
              workflowType,
              String(event?.type || event?.event_type || "").toLowerCase(),
              JSON.stringify(details),
              Number.isFinite(version) && version > 0 ? version : 1,
            ]
          );
        }

        res.json({ ok: true, count: events.length });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to persist workflow events" });
      }
    }
  );
}
