import assert from "node:assert/strict";
import test from "node:test";

import { sentimentAlertCopy, sentimentChannelLabel } from "./monitoring-sentiment-alerts.js";

test("customer sentiment alert names the customer, agent, and channel", () => {
  assert.deepEqual(
    sentimentAlertCopy({
      side: "customer",
      customerName: "Priya Moorthy",
      agentName: "Angela",
      channelLabel: "Email",
    }),
    {
      title: "customer Priya Moorthy's sentiment score went very negative",
      detail: "Agent Angela is handling this Email conversation.",
    },
  );
});

test("agent sentiment alert names the agent, customer, and channel", () => {
  assert.deepEqual(
    sentimentAlertCopy({
      side: "agent",
      customerName: "Priya Moorthy",
      agentName: "Angela",
      channelLabel: "Voice",
    }),
    {
      title: "Agent Angela's sentiment score went very negative",
      detail: "While handling customer Priya Moorthy on Voice.",
    },
  );
});

test("sentiment alerts use Live Monitoring channel names", () => {
  assert.equal(sentimentChannelLabel("whatsapp"), "WhatsApp");
  assert.equal(sentimentChannelLabel("webchat"), "Web Chat");
  assert.equal(sentimentChannelLabel("email"), "Email");
});
