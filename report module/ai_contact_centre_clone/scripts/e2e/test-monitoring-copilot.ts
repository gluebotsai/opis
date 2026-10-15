/**
 * E2E: Live Monitoring snapshot read + copilot routing + callback assign API.
 *
 * Usage: npx tsx scripts/e2e/test-monitoring-copilot.ts
 */
import "@ai-contact-center/config/load-root-env";
import assert from "node:assert/strict";

import {
  CcCoreClient,
  loadE2eConfig,
  runPreflight,
  type AgentSession,
} from "@ai-contact-center/test-harness";

const ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL ??
  process.env.PLAYWRIGHT_AGENT_EMAIL ??
  "admin.test@worktual.local";
const PASSWORD = process.env.E2E_AGENT_PASSWORD ?? "Worktual@123";

async function ensureAdminAccount() {
  const { execSync } = await import("node:child_process");
  execSync("npm run seed:worktual-test-accounts -w cc-core", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

type MonitoringSnapshot = {
  generatedAt: string;
  summary: {
    waiting: number;
    active: number;
    readyAgents: number;
  };
  agents: Array<{
    id: string;
    agentId: string;
    name: string;
    presence: string;
    capacity: Array<{ channel: string; active: number; max: number }>;
  }>;
  waiting: Array<{
    contactId: string | null;
    conversationId: string;
    customerName: string;
    channel: string;
  }>;
  missed: Array<{
    id: string;
    contactId: string | null;
    conversationId: string | null;
    customerName: string;
    channel: string;
    callbackAssigned: boolean;
  }>;
  callbacks: Array<{ id: string; taskId: string; customerName: string }>;
};

type CallbackChannels = {
  availableChannels: string[];
  preferredChannel: string | null;
};

function step(label: string) {
  console.log(`→ ${label}`);
}

async function loginAdmin(cc: CcCoreClient): Promise<AgentSession> {
  try {
    return await cc.loginAgent(ADMIN_EMAIL, PASSWORD);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("401")) {
      step("admin account missing — seeding worktual test accounts");
      await ensureAdminAccount();
      return cc.loginAgent(ADMIN_EMAIL, PASSWORD);
    }
    if (!message.includes("409")) throw error;
    throw new Error(
      `${ADMIN_EMAIL} is already signed in elsewhere. Sign out in the UI or set AUTH_SINGLE_SESSION=false, then rerun.`,
    );
  }
}

async function getMonitoringSnapshot(cc: CcCoreClient, session: AgentSession) {
  return cc.requestWorkspace<MonitoringSnapshot>(session, "GET", "/api/v1/monitoring/snapshot");
}

async function getCallbackChannels(
  cc: CcCoreClient,
  session: AgentSession,
  contactId: string,
  hintChannel?: string,
) {
  const params = hintChannel ? `?hintChannel=${encodeURIComponent(hintChannel)}` : "";
  return cc.requestWorkspace<CallbackChannels>(
    session,
    "GET",
    `/api/v1/monitoring/contacts/${encodeURIComponent(contactId)}/callback-channels${params}`,
  );
}

async function createCallbackTask(
  cc: CcCoreClient,
  session: AgentSession,
  body: Record<string, unknown>,
) {
  return cc.requestWorkspace<{ task: { id: string } }>(
    session,
    "POST",
    "/api/v1/monitoring/callback-tasks",
    body,
  );
}

async function copilotMonitoringTurn(
  config: ReturnType<typeof loadE2eConfig>,
  session: AgentSession,
  message: string,
) {
  const response = await fetch(`${config.nlpUrl}/api/v1/copilot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({
      message,
      role: "admin",
      context: {
        path: "/admin/monitoring",
        surface: "monitoring",
      },
      history: [],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`NLP copilot failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload as { turnId?: string; route?: string; reply?: string };
}

function pickCallbackTarget(snapshot: MonitoringSnapshot) {
  const missed = snapshot.missed.find(
    (row) => !row.callbackAssigned && row.contactId?.trim(),
  );
  if (missed?.contactId) {
    return {
      contactId: missed.contactId,
      conversationId: missed.conversationId ?? undefined,
      channel: missed.channel,
      customerName: missed.customerName,
      source: "missed" as const,
    };
  }
  const waiting = snapshot.waiting.find((row) => row.contactId?.trim());
  if (waiting?.contactId) {
    return {
      contactId: waiting.contactId,
      conversationId: waiting.conversationId,
      channel: waiting.channel,
      customerName: waiting.customerName,
      source: "waiting" as const,
    };
  }
  return null;
}

function pickCallbackAssignee(snapshot: MonitoringSnapshot, channel: string) {
  const eligible = snapshot.agents.filter((agent) => {
    if (agent.presence === "offline") return false;
    return agent.capacity.some(
      (row) => row.channel === channel && row.active < row.max,
    );
  });
  return eligible[0] ?? null;
}

async function main() {
  const preflight = await runPreflight();
  if (!preflight.ok) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const config = loadE2eConfig();
  const cc = new CcCoreClient(config);

  step("admin login");
  const admin = await loginAdmin(cc);

  step("monitoring snapshot read");
  const snapshot = await getMonitoringSnapshot(cc, admin);
  assert.ok(snapshot.generatedAt, "expected generatedAt");
  assert.equal(typeof snapshot.summary.waiting, "number", "expected waiting count");

  step("copilot monitoring route");
  const copilot = await copilotMonitoringTurn(
    config,
    admin,
    "How many contacts are waiting right now? Reply with the number only.",
  );
  assert.equal(copilot.route, "monitoring", `expected monitoring route, got ${copilot.route}`);
  assert.ok(copilot.reply?.trim().length, "expected copilot reply");
  console.log(`  copilot route=${copilot.route} reply=${copilot.reply?.slice(0, 120)}`);

  const target = pickCallbackTarget(snapshot);
  if (!target) {
    console.log("SKIP callback assign — no contact with callback-eligible row in snapshot");
    console.log("PASS monitoring-copilot-e2e (snapshot + copilot)");
    return;
  }

  step(`callback channels for ${target.source} contact ${target.customerName}`);
  const channels = await getCallbackChannels(cc, admin, target.contactId, target.channel);
  const channel =
    channels.preferredChannel ??
    channels.availableChannels.find((value) =>
      ["whatsapp", "instagram", "facebook", "email"].includes(value),
    );
  if (!channel) {
    console.log("SKIP callback assign — no outreach channel on contact");
    console.log("PASS monitoring-copilot-e2e (snapshot + copilot)");
    return;
  }

  const assignee = pickCallbackAssignee(snapshot, channel);
  if (!assignee) {
    console.log("SKIP callback assign — no logged-in agent with channel capacity");
    console.log("PASS monitoring-copilot-e2e (snapshot + copilot)");
    return;
  }

  const beforeCallbacks = snapshot.callbacks.length;
  step(`assign callback to ${assignee.name} via ${channel}`);
  const created = await createCallbackTask(cc, admin, {
    assignedUserId: assignee.id,
    contactId: target.contactId,
    conversationId: target.conversationId,
    channel,
    title: `E2E callback · ${target.customerName}`,
    summary: "Automated monitoring E2E callback assignment",
    notes: "Created by scripts/e2e/test-monitoring-copilot.ts",
  });
  assert.ok(created.task?.id, "expected callback task id");
  console.log(`  taskId=${created.task.id}`);

  step("verify callback appears in refreshed snapshot");
  const refreshed = await getMonitoringSnapshot(cc, admin);
  assert.ok(
    refreshed.callbacks.length >= beforeCallbacks,
    "expected callbacks list to include new assignment",
  );
  assert.ok(
    refreshed.callbacks.some((row) => row.taskId === created.task.id),
    "expected assigned task in monitoring callbacks",
  );

  console.log("PASS monitoring-copilot-e2e");
}

main().catch((error) => {
  console.error("FAIL monitoring-copilot-e2e", error instanceof Error ? error.message : error);
  process.exit(1);
});
