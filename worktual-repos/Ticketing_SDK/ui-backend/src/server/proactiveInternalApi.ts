/**
 * Proactive agent persistence via Ticketing API (Phase 3 — no direct SQL from Python).
 */
import type { Express, Response } from "express";
import { query } from "./db";
import {
  requireCoworkerTasksOrg,
  requireCoworkerTasksKey,
  type CoworkerOrgRequest,
} from "./coworkerTasksOrg";

function orgFromReq(req: CoworkerOrgRequest, bodyOrg?: string): string {
  return String(bodyOrg || req.coworkerOrgId || "").trim();
}

export type PendingApproval = {
  id: string;
  agent_id: string;
  ticket_id?: string | null;
  ticket_number?: string | null;
  summary: string;
  tool_name?: string | null;
  tool_args?: unknown;
  payload?: unknown;
  created_at?: unknown;
  status?: string;
};

function asJsonRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function normalizeTicketNumber(raw: unknown): string {
  const s = String(raw || "").trim();
  const m = s.match(/(\d{1,20})/);
  return m ? m[1] : s.replace(/^#+/, "").toLowerCase();
}

export function approvalDraftText(row: PendingApproval): string {
  const args = asJsonRecord(row.tool_args);
  const payload = asJsonRecord(row.payload);
  return String(
    args.text || args.body || payload.draft || row.summary || ""
  ).trim();
}

export function isReplyDraftApproval(row: PendingApproval): boolean {
  const agent = String(row.agent_id || "").trim().toLowerCase();
  const tool = String(row.tool_name || "").trim().toLowerCase();
  return agent === "crda" || agent === "rqa" || tool === "add_ticket_note";
}

export function approvalMatchesTicket(
  row: PendingApproval,
  ticketNumber: string,
  ticketUuid: string
): boolean {
  const want = normalizeTicketNumber(ticketNumber);
  if (!want) return false;
  const args = asJsonRecord(row.tool_args);
  const payload = asJsonRecord(row.payload);
  const candidates = [
    row.ticket_number,
    row.ticket_id,
    args.ticket_number,
    args.ticketNumber,
    args.id,
    payload.ticket_number,
    payload.ticketNumber,
  ];
  if (candidates.some((c) => normalizeTicketNumber(c) === want)) return true;
  const tid = String(row.ticket_id || "").trim();
  return tid === String(ticketUuid || "") || tid === String(ticketNumber || "");
}

export async function listPendingApprovals(
  orgId: string
): Promise<PendingApproval[]> {
  let rows: PendingApproval[] = [];
  try {
    const found = await query(
      `SELECT id::text AS id, agent_id, ticket_id, ticket_number, summary, tool_name,
              tool_args, payload, status, created_at
         FROM proactive_approvals
        WHERE organization_id = $1::bigint AND status = 'pending'
        ORDER BY created_at ASC`,
      [orgId]
    );
    rows = found.rows.map((r) => ({
      id: String(r.id),
      agent_id: String(r.agent_id || ""),
      ticket_id: r.ticket_id != null ? String(r.ticket_id) : null,
      ticket_number: r.ticket_number != null ? String(r.ticket_number) : null,
      summary: String(r.summary || ""),
      tool_name: r.tool_name != null ? String(r.tool_name) : null,
      tool_args: r.tool_args,
      payload: r.payload,
      status: r.status != null ? String(r.status) : "pending",
      created_at: r.created_at,
    }));
  } catch {
    rows = [];
  }
  if (rows.length) return rows;
  try {
    const agentsUrl = (
      process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
    ).replace(/\/$/, "");
    const secret =
      process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
    const r = await fetch(
      `${agentsUrl}/proactive/approvals?organization_id=${encodeURIComponent(orgId)}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Coworker-Tasks-Key": secret,
        },
      }
    );
    if (!r.ok) return [];
    const body = (await r.json()) as { items?: PendingApproval[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

export function registerProactiveInternalRoutes(app: Express): void {
  app.get(
    "/api/internal/organizations",
    requireCoworkerTasksKey,
    async (_req, res: Response) => {
      try {
        const { rows } = await query<{ id: string }>(
          `SELECT organization_id::text AS id FROM org_settings ORDER BY created_at LIMIT 50`
        );
        res.json({ items: rows.map((r) => r.id) });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to list organizations" });
      }
    }
  );

  app.post(
    "/api/internal/proactive/outbox/:eventId/processed",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const eventId = String(req.params.eventId || "").trim();
        if (!eventId) return res.status(400).json({ error: "eventId required" });
        if (!/^\d+$/.test(eventId)) {
          return res.json({ firstTime: true });
        }
        const { rows } = await query<{ id: string }>(
          `UPDATE proactive_outbox
             SET processed_at = NOW()
           WHERE id = $1::bigint AND processed_at IS NULL
           RETURNING id::text AS id`,
          [eventId]
        );
        if (rows[0]) return res.json({ firstTime: true });
        const existing = await query(
          `SELECT id FROM proactive_outbox WHERE id = $1::bigint`,
          [eventId]
        );
        res.json({ firstTime: !existing.rows[0] });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to mark outbox event" });
      }
    }
  );

  app.post(
    "/api/internal/proactive/recommendations",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, req.body?.organization_id);
        const row = req.body || {};
        if (!orgId || !row.agent_id) {
          return res.status(400).json({ error: "organization_id and agent_id required" });
        }
        const inserted = await query<{ id: string }>(
          `INSERT INTO proactive_recommendations
             (organization_id, agent_id, ticket_id, ticket_number, summary, payload, status)
           VALUES ($1::bigint, $2, $3, $4, $5, $6::jsonb, 'open')
           RETURNING id::text AS id`,
          [
            orgId,
            row.agent_id,
            row.ticket_id || null,
            row.ticket_number || null,
            String(row.summary || ""),
            JSON.stringify(row.payload || {}),
          ]
        );
        const id = inserted.rows[0]?.id;
        res.status(201).json({ id, ...row, organization_id: orgId, status: "open" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to insert recommendation" });
      }
    }
  );

  app.get(
    "/api/internal/proactive/recommendations",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, String(req.query.organization_id || ""));
        const ticketNumber = String(req.query.ticket_number || "").trim();
        if (!orgId) return res.status(400).json({ error: "organization_id required" });
        const { rows } = ticketNumber
          ? await query(
              `SELECT id::text AS id, agent_id, ticket_number, summary, payload, status,
                      created_at::text AS created_at
               FROM proactive_recommendations
               WHERE organization_id = $1::bigint AND ticket_number = $2
               ORDER BY created_at DESC`,
              [orgId, ticketNumber]
            )
          : await query(
              `SELECT id::text AS id, agent_id, ticket_number, summary, payload, status,
                      created_at::text AS created_at
               FROM proactive_recommendations
               WHERE organization_id = $1::bigint
               ORDER BY created_at DESC
               LIMIT 100`,
              [orgId]
            );
        res.json({ items: rows });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to list recommendations" });
      }
    }
  );

  app.get(
    "/api/internal/proactive/recommendations/similar",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, String(req.query.organization_id || ""));
        const agentId = String(req.query.agent_id || "").trim();
        const summary = String(req.query.summary || "").trim().toLowerCase();
        const dedupeKey = String(req.query.dedupe_key || "").trim().toLowerCase();
        const ticketNumber = String(req.query.ticket_number || "").trim();
        const hours = Number(req.query.hours || 24);
        if (!orgId || !agentId || (!summary && !dedupeKey)) {
          return res.json({ exists: false });
        }
        const { rows } = await query(
          `SELECT id FROM proactive_recommendations
           WHERE organization_id = $1::bigint
             AND agent_id = $2
             AND created_at > NOW() - ($3 * INTERVAL '1 hour')
             AND ($4 = '' OR COALESCE(ticket_number, '') = $4)
             AND (
                   lower(regexp_replace(trim(summary), '\\s+', ' ', 'g')) = $5
                OR ($6 <> '' AND payload->>'dedupe_key' = $6)
             )
           LIMIT 1`,
          [orgId, agentId, hours, ticketNumber, summary, dedupeKey]
        );
        res.json({ exists: Boolean(rows[0]) });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to check recommendation" });
      }
    }
  );

  app.post(
    "/api/internal/proactive/approvals",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, req.body?.organization_id);
        const row = req.body || {};
        if (!orgId || !row.agent_id) {
          return res.status(400).json({ error: "organization_id and agent_id required" });
        }
        const inserted = await query<{ id: string }>(
          `INSERT INTO proactive_approvals
             (organization_id, agent_id, ticket_id, ticket_number, summary,
              tool_name, tool_args, payload, status)
           VALUES ($1::bigint, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'pending')
           RETURNING id::text AS id`,
          [
            orgId,
            row.agent_id,
            row.ticket_id || null,
            row.ticket_number || null,
            String(row.summary || ""),
            row.tool_name || null,
            JSON.stringify(row.tool_args || {}),
            JSON.stringify(row.payload || {}),
          ]
        );
        const id = inserted.rows[0]?.id;
        res.status(201).json({ id, ...row, organization_id: orgId, status: "pending" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to insert approval" });
      }
    }
  );

  app.get(
    "/api/internal/proactive/approvals",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, String(req.query.organization_id || ""));
        const status = String(req.query.status || "pending");
        if (!orgId) return res.status(400).json({ error: "organization_id required" });
        const { rows } = await query(
          `SELECT id::text AS id, organization_id::text AS organization_id, agent_id,
                  ticket_id, ticket_number, summary, tool_name, tool_args, payload, status,
                  created_at::text AS created_at
           FROM proactive_approvals
           WHERE organization_id = $1::bigint AND status = $2
           ORDER BY created_at DESC`,
          [orgId, status]
        );
        res.json({ items: rows });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to list approvals" });
      }
    }
  );

  app.get(
    "/api/internal/proactive/approvals/:approvalId",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, String(req.query.organization_id || ""));
        const approvalId = String(req.params.approvalId || "").trim();
        if (!orgId || !approvalId) {
          return res.status(400).json({ error: "organization_id and approvalId required" });
        }
        const { rows } = await query(
          `SELECT id::text AS id, organization_id::text AS organization_id, agent_id,
                  ticket_id, ticket_number, summary, tool_name, tool_args, payload, status
           FROM proactive_approvals
           WHERE organization_id = $1::bigint AND id = $2::bigint`,
          [orgId, approvalId]
        );
        res.json(rows[0] || null);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load approval" });
      }
    }
  );

  app.patch(
    "/api/internal/proactive/approvals/:approvalId/status",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, req.body?.organization_id);
        const approvalId = String(req.params.approvalId || "").trim();
        const status = String(req.body?.status || "").trim();
        if (!orgId || !approvalId || !status) {
          return res.status(400).json({ error: "organization_id, approvalId, status required" });
        }
        await query(
          `UPDATE proactive_approvals
           SET status = $3, decided_at = NOW()
           WHERE organization_id = $1::bigint AND id = $2::bigint`,
          [orgId, approvalId, status]
        );
        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update approval" });
      }
    }
  );

  app.post(
    "/api/internal/proactive/audit",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const row = req.body || {};
        const orgId = orgFromReq(req, row.organization_id);
        if (!orgId || !row.agent_id) {
          return res.status(400).json({ error: "organization_id and agent_id required" });
        }
        await query(
          `INSERT INTO proactive_audit
             (organization_id, agent_id, ticket_id, event_id, decision, reason, tool_name, payload)
           VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            orgId,
            row.agent_id,
            row.ticket_id || null,
            row.event_id || null,
            row.decision || null,
            row.reason || null,
            row.tool_name || null,
            JSON.stringify(row.payload || {}),
          ]
        );
        res.status(201).json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to write audit" });
      }
    }
  );

  app.get(
    "/api/internal/proactive/audit/exists",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const agentId = String(req.query.agent_id || "").trim();
        const eventId = String(req.query.event_id || "").trim();
        if (!agentId || !eventId) return res.json({ exists: false });
        const { rows } = await query(
          `SELECT id FROM proactive_audit
           WHERE agent_id = $1 AND event_id = $2
           LIMIT 1`,
          [agentId, eventId]
        );
        res.json({ exists: Boolean(rows[0]) });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to check audit" });
      }
    }
  );

  app.get(
    "/api/internal/proactive/routing-weights",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, String(req.query.organization_id || ""));
        if (!orgId) return res.status(400).json({ error: "organization_id required" });
        const { rows } = await query(
          `SELECT weights FROM proactive_routing_weights
           WHERE organization_id = $1::bigint
           LIMIT 1`,
          [orgId]
        );
        res.json({ weights: rows[0]?.weights || {} });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load routing weights" });
      }
    }
  );

  app.put(
    "/api/internal/proactive/routing-weights",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = orgFromReq(req, req.body?.organization_id);
        if (!orgId) return res.status(400).json({ error: "organization_id required" });
        const weights = req.body?.weights || {};
        await query(
          `INSERT INTO proactive_routing_weights (organization_id, weights, updated_at)
           VALUES ($1::bigint, $2::jsonb, NOW())
           ON CONFLICT (organization_id)
           DO UPDATE SET weights = EXCLUDED.weights, updated_at = NOW()`,
          [orgId, JSON.stringify(weights)]
        );
        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save routing weights" });
      }
    }
  );

  app.get(
    "/api/internal/proactive/outbox/pending",
    requireCoworkerTasksKey,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const limit = Math.min(100, Number(req.query.limit || 25));
        const { rows } = await query(
          `SELECT id::text AS id, organization_id::text AS organization_id,
                  event_type, payload, created_at::text AS created_at
           FROM proactive_outbox
           WHERE processed_at IS NULL
           ORDER BY created_at ASC
           LIMIT $1`,
          [limit]
        );
        res.json({ items: rows });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to list outbox" });
      }
    }
  );
}
