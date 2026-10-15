import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "@ai-contact-center/observability";
import { WebchatConnectionRegistry } from "../websocket/webchat-connection-registry.js";
import { WebchatSessionStore } from "../services/webchat-session-store.js";
import { triggerWebchatBot } from "../services/webchat-trigger-bot.js";
import type { OrchestratedBotResponder } from "../services/webchat-orchestrator.js";
import type { AccountsConfigClient } from "../services/accounts-config-client.js";
import type { WebSocket } from "ws";

const logger = createLogger({ service: "webchat-trigger-bot-test" });

function createMockWs(): WebSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    sent,
    send(payload: string) {
      sent.push(payload);
    },
  } as unknown as WebSocket & { sent: string[] };
}

test("triggerWebchatBot returns 404 when visitor socket is offline", async () => {
  const registry = new WebchatConnectionRegistry();
  const sessionStore = new WebchatSessionStore();
  const bot = {
    onSessionStart: async () => null,
    onMessage: async () => ({ text: null, stub: false }),
  } as unknown as OrchestratedBotResponder;
  const accountsClient = {
    fetchWebchatConfig: async () => null,
  } as unknown as AccountsConfigClient;

  const result = await triggerWebchatBot(
    { registry, sessionStore, bot, accountsClient, logger },
    {
      webchatId: "wc_5d80cd9b1ace4080bc70717552472611",
      visitorId: "visitor_1",
      autoSessionStart: false,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test("triggerWebchatBot pushes widget.popup without starting session", async () => {
  const ws = createMockWs();
  const registry = new WebchatConnectionRegistry();
  registry.registerPresence({
    webchatId: "wc_5d80cd9b1ace4080bc70717552472611",
    visitorId: "visitor_1",
    ws,
  });

  const result = await triggerWebchatBot(
    {
      registry,
      sessionStore: new WebchatSessionStore(),
      bot: {} as OrchestratedBotResponder,
      accountsClient: {} as AccountsConfigClient,
      logger,
    },
    {
      webchatId: "wc_5d80cd9b1ace4080bc70717552472611",
      visitorId: "visitor_1",
      text: "Need help?",
      openPanel: true,
      autoSessionStart: false,
      reason: "api_trigger",
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sessionStarted, false);
  assert.equal(ws.sent.length, 1);
  const frame = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
  assert.equal(frame.type, "widget.popup");
  assert.equal(frame.openMode, "panel");
  assert.equal(frame.text, "Need help?");
  assert.equal(frame.autoSessionStart, false);
});

test("hub popup replaces the welcome line when the visitor has not spoken", async () => {
  const ws = createMockWs();
  const registry = new WebchatConnectionRegistry();
  const sessionStore = new WebchatSessionStore();
  const webchatId = "wc_5d80cd9b1ace4080bc70717552472611";
  const visitorId = "visitor_1";
  const welcome = "<p>Hello! Welcome to Booxoo. How can I help you today?</p>";
  const hubGreeting =
    "<p>Good morning! I noticed you had been looking at our Straight Fit Jeans. How can I help you today?</p>";
  registry.registerPresence({ webchatId, visitorId, ws });
  const session = sessionStore.getOrCreate(webchatId, visitorId, "147199");
  session.messages.push({ from: "bot", text: welcome, at: new Date().toISOString() });
  sessionStore.markStartupComplete(webchatId, visitorId);

  const result = await triggerWebchatBot(
    {
      registry,
      sessionStore,
      bot: {
        onSessionStart: async () => {
          throw new Error("popup must not generate a second greeting");
        },
        onMessage: async () => ({ text: null, stub: false }),
      } as unknown as OrchestratedBotResponder,
      accountsClient: {
        fetchWebchatConfig: async () => {
          throw new Error("popup must not load the configured greeting");
        },
      } as unknown as AccountsConfigClient,
      logger,
    },
    { webchatId, visitorId, text: hubGreeting, autoSessionStart: true },
  );

  assert.equal(result.ok, true);
  const frames = ws.sent.map((payload) => JSON.parse(payload) as { type: string; text?: string; messages?: Array<{ text: string }> });
  const ready = frames.find((frame) => frame.type === "session.ready");
  const messageTexts = frames.filter((frame) => frame.type === "message").map((frame) => frame.text);
  assert.deepEqual(messageTexts, [hubGreeting]);
  assert.equal(ready?.messages?.some((message) => message.text === welcome), false);
  assert.deepEqual(
    sessionStore.get(webchatId, visitorId)?.messages.map((message) => message.text),
    [hubGreeting],
  );
});

test("registry keeps conversation id when presence is rebound", () => {
  const registry = new WebchatConnectionRegistry();
  const ws = createMockWs();
  registry.register({
    webchatId: "wc_1",
    visitorId: "visitor_1",
    conversationId: "conv-1",
    ws,
  });
  registry.registerPresence({
    webchatId: "wc_1",
    visitorId: "visitor_1",
    ws,
  });
  assert.equal(registry.getBySession("wc_1", "visitor_1")?.conversationId, "conv-1");
});
