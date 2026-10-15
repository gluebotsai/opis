import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ccaasEmailSpEnabled,
  mapCcassTableMessages,
} from "./ccaasEmailConversation.js";

describe("ccaasEmailSpEnabled", () => {
  it("defaults on so the MySQL SP path stays current", () => {
    const prev = process.env.CCAAS_EMAIL_SP;
    delete process.env.CCAAS_EMAIL_SP;
    try {
      assert.equal(ccaasEmailSpEnabled(), true);
    } finally {
      if (prev == null) delete process.env.CCAAS_EMAIL_SP;
      else process.env.CCAAS_EMAIL_SP = prev;
    }
  });

  it("treats off as tables mode", () => {
    const prev = process.env.CCAAS_EMAIL_SP;
    process.env.CCAAS_EMAIL_SP = "off";
    try {
      assert.equal(ccaasEmailSpEnabled(), false);
    } finally {
      if (prev == null) delete process.env.CCAAS_EMAIL_SP;
      else process.env.CCAAS_EMAIL_SP = prev;
    }
  });
});

describe("mapCcassTableMessages", () => {
  it("maps the documented org-1000 sample into the Email-tab shape", () => {
    const messages = mapCcassTableMessages(
      [
        {
          id: "120953",
          subject: "How about we close deals faster with Starter Suite?",
          visitor_id: "email@mail.salesforce.com",
        },
      ],
      [
        {
          id: "10006",
          conversation_id: "120953",
          sender_type: "customer",
          direction: "inbound",
          body: "See how your deals are progressing.",
          created_at: "2026-09-23T04:06:38.350Z",
        },
        {
          id: "10029",
          conversation_id: "120953",
          sender_type: "agent",
          direction: "outbound",
          body: "Thank you for sharing the details about Starter Suite.",
          created_at: "2026-09-23T07:50:20.053Z",
        },
      ]
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[0].lane, "in");
    assert.equal(messages[0].author, "Customer");
    assert.equal(messages[0].fromEmail, "email@mail.salesforce.com");
    assert.equal(
      messages[0].subject,
      "How about we close deals faster with Starter Suite?"
    );
    assert.equal(messages[1].role, "agent");
    assert.equal(messages[1].lane, "out");
    assert.equal(messages[1].author, "Agent");
  });

  it("skips empty bodies and unknown sender types", () => {
    const messages = mapCcassTableMessages(
      [{ id: "1", subject: "Hi" }],
      [
        {
          id: "a",
          conversation_id: "1",
          sender_type: "queue",
          direction: "outbound",
          body: "ignored",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "b",
          conversation_id: "1",
          sender_type: "bot",
          direction: "outbound",
          body: "  ",
          created_at: "2026-01-01T00:00:01.000Z",
        },
        {
          id: "c",
          conversation_id: "1",
          sender_type: "bot",
          direction: "outbound",
          body: "Email bot reply",
          created_at: "2026-01-01T00:00:02.000Z",
        },
      ]
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "bot");
    assert.equal(messages[0].author, "Email bot");
  });

  it("keeps only the new inbound text and leaves the bot body intact", () => {
    const bot =
      "Hi there, I'm sorry to hear that your sweatshirt arrived torn.";
    const messages = mapCcassTableMessages(
      [{ id: "1", subject: "Complaint" }],
      [
        {
          id: "out-1",
          conversation_id: "1",
          sender_type: "bot",
          direction: "outbound",
          body: bot,
          created_at: "2026-09-29T08:53:00.000Z",
        },
        {
          id: "in-1",
          conversation_id: "1",
          sender_type: "customer",
          direction: "inbound",
          body: [
            "my order number is BXUK-20260929-84562BB2",
            "",
            "On Tuesday, Sep 29, 2026 at 2:23 PM Support Booxoo wrote:",
            `> ${bot}`,
          ].join("\n"),
          created_at: "2026-09-29T09:26:00.000Z",
        },
      ]
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0].lane, "out");
    assert.equal(messages[0].text, bot);
    assert.equal(messages[1].lane, "in");
    assert.equal(
      messages[1].text,
      "my order number is BXUK-20260929-84562BB2"
    );
    assert.equal(messages[1].text.includes("wrote:"), false);
    assert.equal(messages[1].text.includes(bot), false);
  });
});
