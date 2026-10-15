/**
 * run: npx tsx src/service/contacts/customer-360-campaigns.test.ts
 */
import assert from "node:assert/strict";
import { campaignsForContact } from "./customer-360-campaigns";
import {
  parsePersonalisedCrmRecipients,
  parsePersonalisedCrmRuns,
} from "../integrations/marketing-ms";

const runs = parsePersonalisedCrmRuns({
  runs: [
    { id: 9001, title: "Post-demo follow-up", status: "completed", send_at: "2026-09-29T10:00:00.000Z" },
    { run_id: "9002", name: "Other", status: "sent" },
  ],
});
assert.equal(runs.length, 2);
assert.equal(runs[0]?.id, "9001");
assert.equal(runs[0]?.title, "Post-demo follow-up");

const recipients = parsePersonalisedCrmRecipients({
  recipients: [
    {
      contact_id: "12345",
      email: "ada@example.com",
      channels: [
        { channel: "email", outcome: "sent", opened: true, clicked: false, sent_at: "2026-09-29T10:05:00.000Z" },
      ],
    },
    {
      contact_id: "999",
      email: "other@example.com",
      channels: [{ channel: "email", outcome: "sent" }],
    },
  ],
});

const rows = campaignsForContact(
  runs,
  new Map([
    ["9001", recipients],
    ["9002", recipients],
  ]),
  "12345",
  null,
);
assert.equal(rows.length, 2);
assert.equal(rows[0]?.title, "Post-demo follow-up");
assert.equal(rows[0]?.status, "Opened");
assert.equal(rows[0]?.channel, "email");
assert.equal(rows.every((row) => row.title !== "Other" || row.runId === "9002"), true);
assert.equal(rows.filter((row) => row.runId === "9002").length, 1);

const byEmail = campaignsForContact(
  [runs[0]!],
  new Map([
    [
      "9001",
      [
        {
          contactId: null,
          email: "ada@example.com",
          channels: [
            {
              channel: "email",
              outcome: "sent",
              opened: true,
              clicked: false,
              sentAt: "2026-09-29T10:05:00.000Z",
            },
          ],
        },
      ],
    ],
  ]),
  "missing",
  "Ada@Example.com",
);
assert.equal(byEmail.length, 1);
assert.equal(byEmail[0]?.status, "Opened");

console.log("customer-360-campaigns.test.ts ok");
