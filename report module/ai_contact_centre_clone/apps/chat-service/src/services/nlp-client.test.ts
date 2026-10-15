import assert from "node:assert/strict";
import test from "node:test";

import { extractContactEntities, runWebchatNlpTurn } from "./nlp-client.js";

test("maps the complete webchat NLP response contract", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(
      JSON.stringify({
        reply: "Hello",
        confidence: 0.91,
        intent: "greeting",
        candidate_skills: ["welcome"],
        summary: "Customer greeted the bot.",
        sentiment: "positive",
        important_facts: ["contact.display_name=Sam"],
        knowledge_used: ["companyName"],
        handoff_recommended: false,
        handoff_reason: null,
        contact_entities: {
          email: "sam@example.com",
          phone: null,
          display_name: "Sam",
          company: null,
          city: null,
          country: null,
        },
        trace_id: "trace-1",
        model_name: "chat-model",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await runWebchatNlpTurn({
    organizationId: "org-1",
    conversationId: "conversation-1",
    message: "Hello",
    tenantContext: { companyName: "Acme" },
    transcript: [],
  });

  assert.ok(result);
  assert.equal(result.contactEntities?.displayName, "Sam");
  assert.equal(result.contactEntities?.email, "sam@example.com");
  assert.deepEqual(result.candidateSkills, ["welcome"]);
  assert.deepEqual(result.knowledgeUsed, ["companyName"]);
  assert.equal(result.traceId, "trace-1");
  assert.equal(result.modelName, "chat-model");
  assert.equal((request?.headers as Record<string, string>)["x-tenant-id"], "org-1");
});

test("sends from and agent_name on live-agent webchat turns", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let payload: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        reply: "",
        confidence: 1,
        intent: null,
        candidate_skills: [],
        handoff_recommended: false,
        handoff_reason: null,
        model_name: "agent-ingest",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await runWebchatNlpTurn({
    organizationId: "org-1",
    conversationId: "conversation-1",
    message: "Hi there, I'm Bharathi",
    tenantContext: {},
    transcript: [],
    from: "agent",
    agentName: "Bharathi Sivakumar",
  });

  assert.equal(payload.from, "agent");
  assert.equal(payload.agent_name, "Bharathi Sivakumar");
  assert.equal(payload.message, "Hi there, I'm Bharathi");
});

test("returns null when webchat NLP is unavailable", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };

  const result = await runWebchatNlpTurn({
    organizationId: "org-1",
    conversationId: "conversation-1",
    message: "Hello",
    tenantContext: {},
    transcript: [],
  });

  assert.equal(result, null);
});

test("extracts contact entities through the non-replying endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let url = "";
  let payload: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    url = String(input);
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        contact_entities: {
          email: "sam@example.com",
          phone: null,
          display_name: "Sam",
          company: null,
          city: null,
          country: null,
        },
        trace_id: "trace-extract",
        model_name: "chat-model",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const entities = await extractContactEntities({
    organizationId: "org-1",
    conversationId: "conversation-1",
    message: "I'm Sam, sam@example.com",
    channel: "webchat",
  });

  assert.match(url, /\/api\/v1\/contact-entities\/extract$/);
  assert.equal(payload.conversation_id, "conversation-1");
  assert.equal(entities?.displayName, "Sam");
});
