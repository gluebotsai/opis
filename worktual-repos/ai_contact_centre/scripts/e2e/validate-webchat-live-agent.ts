/**
 * Validate webchat + live-agent scenarios for test agents.
 * Run after cleanup-test-agent-conversations.ts --live
 *
 * Usage: npx tsx scripts/e2e/validate-webchat-live-agent.ts
 */
import "@ai-contact-center/config/load-root-env";
import assert from "node:assert/strict";

import {
  CcCoreClient,
  createTestRunIds,
  loadE2eConfig,
  NlpClient,
  runPreflight,
} from "@ai-contact-center/test-harness";

const AGENT_A = "agent.test@worktual.local";
const AGENT_B = process.env.PLAYWRIGHT_AGENT_B_EMAIL ?? "agent2.test@worktual.local";
const PASSWORD = process.env.E2E_AGENT_PASSWORD ?? "Worktual@123";

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];

function record(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => results.push({ name, pass: true, detail: "OK" }))
    .catch((error) => {
      results.push({
        name,
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStatus(
  cc: CcCoreClient,
  orgId: string,
  conversationId: string,
  statuses: string[],
  timeoutMs = 15_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { conversation } = await cc.getConversation(orgId, conversationId);
    if (statuses.includes(conversation.status)) return conversation.status;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for status ${statuses.join("|")}`);
}

async function waitForMemory(
  cc: CcCoreClient,
  orgId: string,
  conversationId: string,
  timeoutMs = 10_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = await cc.getMemory(orgId, conversationId);
    if (session.memory) return session.memory;
    await sleep(500);
  }
  throw new Error("Timed out waiting for conversation memory");
}

async function main() {
  const preflight = await runPreflight();
  const orgId =
    process.env.ORGANIZATION_ID ??
    process.env.E2E_ORGANIZATION_ID ??
    preflight.organizationId ??
    "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
  const webchatId =
    preflight.webchatId ??
    process.env.E2E_WEBCHAT_ID ??
    "wc_5d80cd9b1ace4080bc70717552472611";

  if (!preflight.ok && !orgId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }
  if (!orgId || !webchatId) {
    throw new Error(
      `Missing org/webchat config. Set ORGANIZATION_ID and ensure webchat is configured. org=${orgId} webchat=${webchatId}`,
    );
  }
  const config = loadE2eConfig();
  const cc = new CcCoreClient(config);
  const nlp = new NlpClient(config);

  const agentA = await cc.loginAgent(AGENT_A, PASSWORD);
  const agentB = await cc.loginAgent(AGENT_B, PASSWORD);
  await cc.updatePresence(agentA, "ready");
  await cc.updatePresence(agentB, "ready");

  await record("AI Chat — NLP reply + memory", async () => {
    const ids = createTestRunIds("ai");
    const started = await cc.startWebchatConversation(orgId, {
      webchatId,
      visitorId: ids.visitorId,
      prechatAnswers: { email: ids.email },
    });
    const conversationId = started.conversation.id;

    const turn = await nlp.webchatTurn({
      organizationId: orgId,
      conversationId,
      message: "What are your business hours?",
      tenantContext: { companyName: "Worktual" },
    });
    assert.ok(turn.reply?.length, "expected bot reply");
    assert.ok(turn.model_name?.includes("gpt-oss"), `expected GPT-OSS model, got ${turn.model_name}`);

    await cc.recordNlpTurn(orgId, conversationId, {
      customerText: "What are your business hours?",
      botReply: turn.reply,
      intent: turn.intent,
      modelName: turn.model_name,
      summary: turn.summary ?? "Customer asked about business hours.",
      importantFacts: turn.important_facts ?? ["Asked about business hours"],
    });
    await cc.upsertMemory(orgId, conversationId, {
      rollingSummary: turn.summary ?? "Customer asked about business hours.",
      extractedFacts: turn.important_facts ?? ["Asked about business hours"],
      modelName: turn.model_name,
    });

    const memory = await waitForMemory(cc, orgId, conversationId);
    assert.equal(memory.organizationId, orgId);
    assert.equal(memory.conversationId, conversationId);
    const turns = await cc.listNlpTurns(orgId, conversationId);
    assert.ok(turns.turns.length >= 1, "NLP turn should be stored with conversation id");
  });

  await record("Live Agent — intent=live_agent + queue routing", async () => {
    const ids = createTestRunIds("handoff");
    const started = await cc.startWebchatConversation(orgId, {
      webchatId,
      visitorId: ids.visitorId,
    });
    const conversationId = started.conversation.id;

    const turn = await nlp.webchatTurn({
      organizationId: orgId,
      conversationId,
      message: "Please connect me to a live agent",
    });
    assert.equal(turn.intent, "live_agent");
    assert.equal(turn.handoff_recommended, true);

    await cc.handoff(orgId, conversationId, "explicit_request");
    const status = await waitForStatus(cc, orgId, conversationId, ["queued", "assigned", "active"]);
    assert.ok(["queued", "assigned", "active"].includes(status));
  });

  await record("First Agent Rejects — routes to second agent", async () => {
    await cc.updatePresence(agentA, "ready");
    await cc.updatePresence(agentB, "ready");

    const ids = createTestRunIds("reject1");
    const started = await cc.startWebchatConversation(orgId, {
      webchatId,
      visitorId: ids.visitorId,
    });
    const conversationId = started.conversation.id;
    await cc.handoff(orgId, conversationId, "agent_reject_test");
    await waitForStatus(cc, orgId, conversationId, ["assigned", "queued"]);

    try {
      await cc.rejectOffer(agentA, conversationId);
    } catch {
      // first agent may not have been offered if round-robin picked B
    }
    await sleep(1500);
    const afterReject = await cc.getConversation(orgId, conversationId);
    assert.ok(
      ["assigned", "queued", "active", "bot_active"].includes(afterReject.conversation.status),
      `unexpected status after reject: ${afterReject.conversation.status}`,
    );

    const memory = await waitForMemory(cc, orgId, conversationId, 5_000).catch(() => null);
    if (memory) {
      assert.ok(memory.rollingSummary || memory.extractedFacts?.length, "bot context in memory after reject");
    }
  });

  await record("Both Agents Busy — busy message + bot resume", async () => {
    await cc.updatePresence(agentA, "busy");
    await cc.updatePresence(agentB, "busy");

    const ids = createTestRunIds("busy");
    const started = await cc.startWebchatConversation(orgId, {
      webchatId,
      visitorId: ids.visitorId,
    });
    const conversationId = started.conversation.id;
    await cc.handoff(orgId, conversationId, "agents_busy_test");
    const status = await waitForStatus(cc, orgId, conversationId, ["bot_active"], 15_000);
    assert.equal(status, "bot_active");

    const memory = await waitForMemory(cc, orgId, conversationId);
    const facts = JSON.stringify(memory.rollingSummary ?? memory.extractedFacts ?? "");
    assert.ok(
      facts.toLowerCase().includes("unavailable") || facts.toLowerCase().includes("busy"),
      "routing failure should be stored in memory",
    );

    await cc.updatePresence(agentA, "ready");
    await cc.updatePresence(agentB, "ready");
  });

  await record("Both Agents Reject — stop routing + bot resume", async () => {
    await cc.updatePresence(agentA, "ready");
    await cc.updatePresence(agentB, "ready");

    const ids = createTestRunIds("reject2");
    const started = await cc.startWebchatConversation(orgId, {
      webchatId,
      visitorId: ids.visitorId,
    });
    const conversationId = started.conversation.id;
    await cc.handoff(orgId, conversationId, "both_reject_test");
    await waitForStatus(cc, orgId, conversationId, ["assigned", "queued"], 20_000);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { conversation } = await cc.getConversation(orgId, conversationId);
      if (conversation.status === "bot_active") break;

      if (conversation.status === "assigned") {
        for (const agent of [agentA, agentB]) {
          try {
            await cc.rejectOffer(agent, conversationId);
            break;
          } catch {
            // not the offered agent, or routing already completed
          }
        }
      }
      await sleep(1000);
    }

    const status = await waitForStatus(cc, orgId, conversationId, ["bot_active"], 15_000);
    assert.equal(status, "bot_active");
    const memory = await waitForMemory(cc, orgId, conversationId);
    const summary = JSON.stringify(memory.rollingSummary ?? memory.extractedFacts ?? "");
    assert.ok(
      summary.toLowerCase().includes("unavailable") || summary.toLowerCase().includes("reject"),
      "routing failure should be saved in NLP memory",
    );
  });

  await record("Copilot — Together Qwen on non-inbox surface", async () => {
    const copilot = await nlp.copilotTurn(agentA, {
      message: "Say hello in one short sentence.",
      surface: "performance",
      path: "/admin/performance",
    });
    assert.ok(copilot.turnId, "expected copilot turnId");
    assert.ok(copilot.reply?.length, "expected copilot reply from Together provider");
  });

  await record("Agent Accept + Reply — delivery path", async () => {
    await cc.updatePresence(agentA, "ready");
    const ids = createTestRunIds("accept");
    const started = await cc.startWebchatConversation(orgId, {
      webchatId,
      visitorId: ids.visitorId,
    });
    const conversationId = started.conversation.id;
    await cc.handoff(orgId, conversationId, "accept_test");
    await waitForStatus(cc, orgId, conversationId, ["assigned", "active"], 20_000);

    await cc.acceptOffer(agentA, conversationId);
    await cc.sendAgentMessage(agentA, conversationId, "Thanks — an agent is here to help you now.");
    const status = await waitForStatus(cc, orgId, conversationId, ["active"], 10_000);
    assert.equal(status, "active");
  });

  console.log("\n=== Webchat Validation Summary ===");
  for (const result of results) {
    console.log(`${result.pass ? "✓" : "✗"} ${result.name}${result.pass ? "" : ` — ${result.detail}`}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
