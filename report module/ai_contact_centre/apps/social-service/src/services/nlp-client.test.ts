import assert from "node:assert/strict";
import test from "node:test";

import { extractContactEntities, runSocialNlpTurn } from "./nlp-client.js";

test("maps social NLP fields and selects the social endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let url = "";
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        reply: "Hi from Instagram",
        confidence: 0.8,
        intent: "greeting",
        candidate_skills: [],
        summary: null,
        sentiment: "positive",
        important_facts: [],
        knowledge_used: ["companyName"],
        handoff_recommended: false,
        handoff_reason: null,
        contact_entities: {
          email: null,
          phone: null,
          display_name: "Sam",
          company: null,
          city: null,
          country: null,
        },
        trace_id: "trace-social",
        model_name: "chat-model",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await runSocialNlpTurn({
    organizationId: "org-1",
    conversationId: "conversation-1",
    message: "Hello",
    channel: "instagram",
    tenantContext: { companyName: "Acme" },
  });

  assert.ok(url.endsWith("/api/v1/social/turn"));
  assert.equal((body.tenant_context as Record<string, unknown>).channel, "instagram");
  assert.equal(result?.contactEntities?.displayName, "Sam");
  assert.equal(result?.traceId, "trace-social");
});

test("returns null for unsuccessful social NLP responses", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });

  const result = await runSocialNlpTurn({
    organizationId: "org-1",
    conversationId: "conversation-1",
    message: "Hello",
    channel: "whatsapp",
  });

  assert.equal(result, null);
});

test("extracts live-agent contact entities without requesting a bot turn", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let url = "";
  globalThis.fetch = async (input) => {
    url = String(input);
    return new Response(
      JSON.stringify({
        contact_entities: {
          email: null,
          phone: "+447700900123",
          display_name: null,
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
    message: "Call me on +447700900123",
    channel: "whatsapp",
  });

  assert.ok(url.endsWith("/api/v1/contact-entities/extract"));
  assert.equal(entities?.phone, "+447700900123");
});
