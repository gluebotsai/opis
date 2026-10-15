import assert from "node:assert/strict";
import test from "node:test";

import { formatCallDialogue } from "./omni-channel-summary.js";

test("call dialogue keeps customer, bot, and agent lines in order", () => {
  const text = formatCallDialogue([
    { senderType: "customer", body: "  can you help me " },
    { senderType: "bot", body: "I'd be happy to help!" },
    { senderType: "customer", body: "yes i would like to see menswear" },
    { senderType: "agent", body: "Can you hear me" },
  ]);
  assert.equal(
    text,
    [
      "Customer: can you help me",
      "Bot: I'd be happy to help!",
      "Customer: yes i would like to see menswear",
      "Agent: Can you hear me",
    ].join("\n"),
  );
});
