import type { Express, Response } from "express";
import { query } from "./db";
import { listAssignableAgents } from "./accountsSync";
import {
  requireCoworkerTasksOrg,
  type CoworkerOrgRequest,
} from "./coworkerTasksOrg";

export function registerTriageDataRoutes(app: Express): void {
  app.get(
    "/api/coworker/triage-data",
    requireCoworkerTasksOrg,
    async (req: CoworkerOrgRequest, res: Response) => {
      try {
        const orgId = String(req.coworkerOrgId || "").trim();
        if (!orgId) {
          return res.status(400).json({ error: "organization id required" });
        }

        const agents = await listAssignableAgents(orgId);
        const agentRows = agents
          .filter((a) => ["agent", "resolver", "admin"].includes(a.role))
          .map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            role: a.role,
            status: "Active",
            skills: a.skills || [],
          }));

        const skillsByUser: Record<string, string[]> = {};
        for (const a of agentRows) {
          skillsByUser[a.id] = a.skills?.length ? a.skills : ["General"];
        }

        const { rows: teamRows } = await query<{
          id: string;
          name: string;
          description: string;
        }>(
          `SELECT id::text AS id,
                  queue_name AS name,
                  COALESCE(description, '') AS description
           FROM agent_queues
           WHERE organization_id = $1::bigint
           ORDER BY queue_name`,
          [orgId]
        );

        const { rows: memberRows } = await query<{
          queue_id: string;
          user_id: string;
        }>(
          `SELECT queue_id::text AS queue_id, user_id::text AS user_id
           FROM agent_queue_members
           WHERE organization_id = $1::bigint`,
          [orgId]
        );

        const membersByQueue = new Map<string, string[]>();
        for (const m of memberRows) {
          const qid = String(m.queue_id);
          const uid = String(m.user_id);
          if (!membersByQueue.has(qid)) membersByQueue.set(qid, []);
          membersByQueue.get(qid)!.push(uid);
        }

        const teams = teamRows.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          status: "active",
          member_ids: membersByQueue.get(t.id) || [],
        }));

        const { rows: assigneeLoad } = await query<{
          assignee_name: string;
          open_count: number;
        }>(
          `SELECT COALESCE(assignee_name, '') AS assignee_name,
                  COUNT(*)::int AS open_count
           FROM tickets
           WHERE organization_id = $1::bigint
             AND status IN ('Open', 'Pending', 'In Progress', 'Reopened', 'Overdue')
             AND assignee_name IS NOT NULL
             AND assignee_name <> ''
             AND assignee_name <> 'Unassigned'
           GROUP BY assignee_name`,
          [orgId]
        );

        const { rows: resolverLoad } = await query<{
          resolver_name: string;
          open_count: number;
        }>(
          `SELECT COALESCE(resolver_name, '') AS resolver_name,
                  COUNT(*)::int AS open_count
           FROM tickets
           WHERE organization_id = $1::bigint
             AND status IN ('Open', 'Pending', 'In Progress', 'Reopened', 'Overdue')
             AND resolver_name IS NOT NULL
             AND resolver_name <> ''
           GROUP BY resolver_name`,
          [orgId]
        );

        const workloadAssignee: Record<string, number> = {};
        for (const r of assigneeLoad) {
          workloadAssignee[String(r.assignee_name)] = Number(r.open_count || 0);
        }

        const workloadResolver: Record<string, number> = {};
        for (const r of resolverLoad) {
          workloadResolver[String(r.resolver_name)] = Number(r.open_count || 0);
        }

        res.json({
          teams,
          agents: agentRows.map(({ skills: _s, ...rest }) => rest),
          skillsByUser,
          workloadAssignee,
          workloadResolver,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load triage data" });
      }
    }
  );
}
