/**
 * CI smoke test: sales_admin role, oversight APIs, and lead assignment.
 */
import "../server/load-env.js";
import crypto from "node:crypto";
import { migrateDatabase } from "../server/db/migrate.js";
import { pool, query } from "../server/db/pool.js";
import { loginUser } from "../server/auth.js";
import { createLead, canUserModifyLead, getLeadOwnership } from "../server/leads.js";
import {
  getOversightAgentDetail,
  getOversightDashboard,
  listOversightAgents,
  reassignLead,
} from "../server/salesOversight.js";

const marker = `sales-admin-smoke-${Date.now()}`;
const salesAdminEmail = `sales-admin-${marker}@example.com`;
const salesAgentEmail = `sales-agent-${marker}@example.com`;
const password = "smoke-test-password";

async function cleanup(ids) {
  const client = await pool.connect();
  try {
    for (const leadId of ids.leadIds || []) {
      await client.query(`DELETE FROM lead_assignments WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
    for (const userId of ids.userIds || []) {
      await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  } finally {
    client.release();
  }
}

async function ensureUser({ email, role, displayName }) {
  const { rows } = await query(
    `INSERT INTO users (email, password, role, display_name, department, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, TRUE, 'smoke-test', 'smoke-test')
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, is_active = TRUE
     RETURNING id, email, role`,
    [email.toLowerCase(), password, role, displayName, role === "sales" ? "Sales" : "Sales Management"],
  );
  return rows[0];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-sales-admin] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const ids = { userIds: [], leadIds: [] };
  let leadId;

  try {
    const salesAdmin = await ensureUser({
      email: salesAdminEmail,
      role: "sales_admin",
      displayName: "Smoke Sales Admin",
    });
    const salesAgent = await ensureUser({
      email: salesAgentEmail,
      role: "sales",
      displayName: "Smoke Sales Agent",
    });
    const salesAgent2 = await ensureUser({
      email: `sales-agent-2-${marker}@example.com`,
      role: "sales",
      displayName: "Smoke Sales Agent 2",
    });
    ids.userIds.push(salesAdmin.id, salesAgent.id, salesAgent2.id);

    const login = await loginUser(salesAdminEmail, password);
    if (login.role !== "sales_admin") {
      throw new Error(`Expected sales_admin role, got ${login.role}`);
    }

    const adminLead = await createLead(
      {
        companyName: `Smoke Admin Lead ${marker}`,
        billingAddress: "2 Admin Street",
        workEmail: `admin-${marker}@example.com`,
      },
      { createdByUserId: salesAdmin.id },
    );
    ids.leadIds.push(adminLead.id);

    if (adminLead.assignedUserId !== salesAdmin.id) {
      throw new Error("Sales admin lead was not auto-assigned to creator.");
    }

    const adminOwnership = await getLeadOwnership(adminLead.id);
    if (
      !canUserModifyLead(
        { userId: salesAdmin.id, role: "sales_admin" },
        adminOwnership,
      )
    ) {
      throw new Error("Sales admin cannot modify own lead.");
    }

    const lead = await createLead(
      {
        companyName: `Smoke Oversight ${marker}`,
        billingAddress: "1 Oversight Street",
        workEmail: `${marker}@example.com`,
      },
      { createdByUserId: salesAgent.id },
    );
    leadId = lead.id;
    ids.leadIds.push(leadId);

    if (lead.assignedUserId !== salesAgent.id) {
      throw new Error("Lead was not auto-assigned to creating sales agent.");
    }

    const dashboard = await getOversightDashboard({ days: 30 });
    if (!dashboard?.summary || typeof dashboard.summary.salesAgents !== "number") {
      throw new Error("Oversight dashboard summary is invalid.");
    }

    const agents = await listOversightAgents({ days: 30 });
    const matchedAgent = agents.find((agent) => agent.id === salesAgent.id);
    if (!matchedAgent) {
      throw new Error("Sales agent not found in oversight agents list.");
    }

    const detail = await getOversightAgentDetail(salesAgent.id, { days: 30 });
    if (!detail?.leads?.some((entry) => entry.id === leadId)) {
      throw new Error("Assigned lead missing from agent detail.");
    }

    const reassigned = await reassignLead(leadId, salesAgent2.id, {
      assignedByUserId: salesAdmin.id,
      reason: "Smoke test reassignment",
    });
    if (reassigned.assignedUserId !== salesAgent2.id) {
      throw new Error("Lead reassignment did not update assigned_user_id.");
    }

    console.log("[smoke-test-sales-admin] PASS");
  } catch (error) {
    console.error("[smoke-test-sales-admin] FAIL:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await cleanup(ids);
    await pool.end();
  }
}

main();
