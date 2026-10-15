import assert from "node:assert/strict";
import test from "node:test";

import { buildSocialBotMemoryContext } from "./social-bot-memory.js";

test("buildSocialBotMemoryContext passes long-term summary to tenant context", () => {
  const result = buildSocialBotMemoryContext(
    {
      conversationId: "conv-1",
      turns: [],
      memory: null,
      transcript: [{ role: "user", content: "try again" }],
      longTermSummary: "Customer previously requested a live agent but agents were busy.",
      extractedFacts: ["live_agent_unavailable"],
    },
    { channel: "whatsapp" },
  );

  assert.equal(result.transcript.length, 1);
  assert.match(String(result.tenantContext.rolling_summary), /live agent/i);
  assert.deepEqual(result.tenantContext.extracted_facts, ["live_agent_unavailable"]);
  assert.equal(result.tenantContext.channel, "whatsapp");
});
