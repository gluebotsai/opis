/**
 * End-to-end queue integration test (setup APIs + ccass publish + runtime).
 * Usage: npx tsx scripts/test-queues-integration.ts
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const BASE = process.env.CC_CORE_URL ?? "http://localhost:3000";

type Json = Record<string, unknown>;

async function api<T>(
  method: string,
  path: string,
  orgId: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    "x-tenant-id": orgId,
    "x-user-id": "00000000-0000-0000-0000-000000000002",
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return { status: res.status, data };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  const results: { name: string; ok: boolean; detail?: string }[] = [];
  const pass = (name: string, detail?: string) => results.push({ name, ok: true, detail });
  const fail = (name: string, detail: string) => {
    results.push({ name, ok: false, detail });
    console.error(`✗ ${name}: ${detail}`);
  };

  let orgId = "";
  let teamId = "";
  let hoursId = "";
  let agentUserId = "";
  let queueId = "";
  const testName = `E2E Test Queue ${Date.now()}`;

  try {
    const grant = await ccPrisma.setup_user_product_access.findFirst({
      where: { product_id: "contact-center" },
      select: { organization_id: true },
    });
    assert(grant, "No org with contact-center entitlement");
    orgId = grant.organization_id;

    const team = await ccPrisma.setup_teams.findFirst({
      where: { organization_id: orgId },
      select: { id: true, business_hours_id: true, name: true },
    });
    assert(team, "No team for org");

    const assignedRows = await ccPrisma.setup_ccaas_queue_agents.findMany({
      where: { setup_ccaas_queues: { organization_id: orgId } },
      select: { user_id: true },
    });
    const assignedUserIds = assignedRows.map((row) => row.user_id);

    const agent = await ccPrisma.setup_users.findFirst({
      where: {
        organization_id: orgId,
        status: "active",
        ...(assignedUserIds.length > 0 ? { id: { notIn: assignedUserIds } } : {}),
      },
      select: { id: true, team_id: true },
      orderBy: { created_at: "asc" },
    });
    assert(agent, "No unassigned active agent in org");

    teamId = agent.team_id ?? team.id;
    if (!agent.team_id) {
      await ccPrisma.setup_users.update({
        where: { id: agent.id },
        data: { team_id: teamId },
      });
    }

    const teamRow = await ccPrisma.setup_teams.findFirst({
      where: { id: teamId },
      select: { id: true, business_hours_id: true },
    });
    assert(teamRow, "Agent team not found");
    teamId = teamRow.id;
    hoursId = teamRow.business_hours_id ?? "";
    if (!hoursId) {
      const hours = await ccPrisma.setup_business_hours.findFirst({
        where: { organization_id: orgId, status: "active" },
        select: { id: true },
      });
      hoursId = hours?.id ?? "";
    }
    assert(hoursId, "No business hours for org");
    agentUserId = agent.id;

    pass("DB fixtures", `org=${orgId.slice(0, 8)}… team=${teamId.slice(0, 8)}…`);
  } catch (e) {
    fail("DB fixtures", e instanceof Error ? e.message : String(e));
    printResults(results);
    process.exit(1);
  }

  try {
    await api("GET", "/health", orgId);
    pass("Health check");
  } catch (e) {
    fail("Health check", e instanceof Error ? e.message : String(e));
  }

  try {
    const { data } = await api<{ teams: { id: string }[] }>(
      "GET",
      "/api/v1/setup/ccaas/teams",
      orgId,
    );
    assert(data.teams.length > 0, "teams empty");
    pass("List teams", `${data.teams.length} teams`);
  } catch (e) {
    fail("List teams", e instanceof Error ? e.message : String(e));
  }

  try {
    const { data } = await api<{ schedules: unknown[] }>(
      "GET",
      "/api/v1/setup/ccaas/business-hours",
      orgId,
    );
    pass("List business hours", `${data.schedules.length} schedules`);
  } catch (e) {
    fail("List business hours", e instanceof Error ? e.message : String(e));
  }

  try {
    const { data } = await api<{ agents: unknown[] }>(
      "GET",
      "/api/v1/setup/ccaas/eligible-agents",
      orgId,
    );
    pass("List eligible agents", `${data.agents.length} agents`);
  } catch (e) {
    fail("List eligible agents", e instanceof Error ? e.message : String(e));
  }

  try {
    const { status, data } = await api<{ queue: Json }>("POST", "/api/v1/setup/ccaas/queues", orgId, {
      name: testName,
      description: "Integration test queue",
      teamId,
      businessHoursId: hoursId,
      shiftTypes: ["Regular"],
      skills: [],
      status: "active",
    });
    assert(status === 201, "expected 201");
    queueId = String(data.queue.id);
    assert(data.queue.businessHoursId === hoursId, "businessHoursId not persisted");
    const shiftTypes = data.queue.shiftTypes as string[];
    assert(shiftTypes.includes("Regular"), "shiftTypes not persisted");
    pass("Create queue", `id=${queueId.slice(0, 8)}…`);
  } catch (e) {
    fail("Create queue", e instanceof Error ? e.message : String(e));
  }

  if (queueId) {
    try {
      const { data } = await api<{ queue: Json }>(
        "GET",
        `/api/v1/setup/ccaas/queues/${queueId}`,
        orgId,
      );
      assert(data.queue.name === testName, "name mismatch on reload");
      pass("Get queue (setup)", "round-trip name OK");
    } catch (e) {
      fail("Get queue (setup)", e instanceof Error ? e.message : String(e));
    }

    try {
      await api("PUT", `/api/v1/setup/ccaas/queues/${queueId}/agents`, orgId, {
        agents: [
          {
            userId: agentUserId,
            shiftType: "Regular",
            handlesCalls: true,
            handlesEmail: false,
            handlesChat: true,
            handlesWhatsapp: false,
            handlesInstagram: false,
            handlesFacebook: false,
            chatConcurrency: 2,
            emailConcurrency: 1,
            socialConcurrency: 1,
            whatsappConcurrency: 1,
            instagramConcurrency: 1,
            facebookConcurrency: 1,
            callType: "both",
          },
        ],
      });
      const { data } = await api<{ queue: Json }>(
        "GET",
        `/api/v1/setup/ccaas/queues/${queueId}`,
        orgId,
      );
      const agents = data.queue.agents as { userId: string; shiftType: string }[];
      assert(agents.length === 1, "expected 1 agent row");
      assert(agents[0]?.shiftType === "Regular", "shiftType not persisted");
      pass("Replace queue agents", "1 agent on Regular shift");
    } catch (e) {
      fail("Replace queue agents", e instanceof Error ? e.message : String(e));
    }

    try {
      const routing = await ccPrisma.routing_queues.findUnique({
        where: { setup_queue_id: queueId },
        include: { routing_queue_members: true },
      });
      assert(routing, "routing_queues row missing after publish");
      assert(routing.name === testName, "routing name mismatch");
      assert(routing.routing_queue_members.length >= 1, "routing members missing");
      pass(
        "ccass publish",
        `queue + ${routing.routing_queue_members.length} member(s) in ccass`,
      );
    } catch (e) {
      fail("ccass publish", e instanceof Error ? e.message : String(e));
    }

    try {
      const { data } = await api<{ queue: Json }>(
        "GET",
        `/api/v1/runtime/queues/${queueId}`,
        orgId,
      );
      const agents = data.queue.agents as { userId: string; handlesChat: boolean }[];
      assert(agents.length >= 1, "runtime agents empty");
      assert(agents[0]?.handlesChat === true, "runtime channel flags missing");
      pass("Runtime queue API", `${agents.length} routable agent(s)`);
    } catch (e) {
      fail("Runtime queue API", e instanceof Error ? e.message : String(e));
    }

    try {
      const { data } = await api<{ queues: unknown[] }>("GET", "/api/v1/runtime/queues", orgId);
      const found = data.queues.some((q) => (q as { id: string }).id === queueId);
      assert(found, "queue not in runtime list");
      pass("Runtime queues list", `includes test queue`);
    } catch (e) {
      fail("Runtime queues list", e instanceof Error ? e.message : String(e));
    }

    try {
      await api("PATCH", `/api/v1/setup/ccaas/queues/${queueId}`, orgId, {
        skills: ["billing"],
      });
      const { data } = await api<{ queue: Json }>(
        "GET",
        `/api/v1/setup/ccaas/queues/${queueId}`,
        orgId,
      );
      const skills = data.queue.skills as string[];
      assert(skills.includes("billing"), "skills not persisted");
      pass("Update queue skills", "billing skill saved");
    } catch (e) {
      fail("Update queue skills", e instanceof Error ? e.message : String(e));
    }

    try {
      await api("PATCH", `/api/v1/setup/ccaas/queues/${queueId}`, orgId, {
        status: "inactive",
      });
      const routing = await ccPrisma.routing_queues.findUnique({
        where: { setup_queue_id: queueId },
      });
      assert(!routing, "inactive queue should be unpublished from ccass");
      pass("Deactivate unpublishes", "removed from ccass");
    } catch (e) {
      fail("Deactivate unpublishes", e instanceof Error ? e.message : String(e));
    }

    try {
      await api("DELETE", `/api/v1/setup/ccaas/queues/${queueId}`, orgId);
      const setup = await ccPrisma.setup_ccaas_queues.findUnique({ where: { id: queueId } });
      assert(!setup, "setup queue still exists");
      pass("Delete queue", "removed from accounts");
    } catch (e) {
      fail("Delete queue", e instanceof Error ? e.message : String(e));
    }
  }

  try {
    const { data } = await api<{ queues: unknown[]; pagination: { total: number } }>(
      "GET",
      "/api/v1/setup/ccaas/queues?page=1&pageSize=10&sort=name&order=asc",
      orgId,
    );
    assert(data.pagination.total >= 0, "pagination missing");
    pass("List queues with pagination", `total=${data.pagination.total}`);
  } catch (e) {
    fail("List queues with pagination", e instanceof Error ? e.message : String(e));
  }

  printResults(results);
  await ccPrisma.$disconnect();
  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed > 0 ? 1 : 0);
}

function printResults(results: { name: string; ok: boolean; detail?: string }[]) {
  console.log("\n=== Queue integration test results ===\n");
  for (const r of results) {
    const icon = r.ok ? "✓" : "✗";
    console.log(`${icon} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed\n`);
}

main().catch((err) => {
  console.error(err);
  void ccPrisma.$disconnect();
  process.exit(1);
});
