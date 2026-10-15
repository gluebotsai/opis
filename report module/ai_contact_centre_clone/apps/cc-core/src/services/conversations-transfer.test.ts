import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  completeTransferSchema,
  transferConversationSchema,
  transferTargetsQuerySchema,
} from "./conversations.js";
import { isPresenceEligibleForChannel } from "./presence-cache.js";

const here = dirname(fileURLToPath(import.meta.url));

test("transfer schema accepts preferred agent without disposition", () => {
  const parsed = transferConversationSchema.parse({
    queueId: "1002",
    agentId: "2001",
    notes: "handoff to specialist",
  });
  assert.equal(parsed.queueId, "1002");
  assert.equal(parsed.agentId, "2001");
  assert.equal(parsed.disposition, undefined);
});

test("transfer schema still requires a queue (legacy contract)", () => {
  assert.equal(transferConversationSchema.safeParse({ agentId: "2001" }).success, false);
  assert.equal(transferConversationSchema.safeParse({ queueId: "1002" }).success, true);
});

test("available presence is eligible for transfer offers", () => {
  assert.equal(isPresenceEligibleForChannel("chat", "ready"), true);
  assert.equal(isPresenceEligibleForChannel("chat", "available"), true);
  assert.equal(isPresenceEligibleForChannel("chat", "busy"), false);
});

test("explicit realtime transfer preserves sender until target accepts", () => {
  const source = readFileSync(join(here, "conversations.ts"), "utf8");
  assert.match(source, /const explicitWarmTransfer = Boolean\(payload\.agentId && conversation\.channel !== "email"\)/);
  assert.match(source, /'warm_transfer'/);
  assert.match(source, /state = 'accepted'.*accepted_agent_id/s);
  assert.match(source, /reason = 'warm_transfer_accepted'/);
  assert.match(source, /state = 'rejected'.*outcome_reason = 'target_rejected'/s);
  assert.match(source, /state = 'expired'.*outcome_reason = 'offer_timeout'/s);
});

test("transfer target and completion contracts are bounded", () => {
  assert.deepEqual(
    transferTargetsQuerySchema.parse({ queueId: "1002", search: "sam", limit: "20" }),
    { queueId: "1002", search: "sam", offset: 0, limit: 20, voice: false },
  );
  assert.equal(transferTargetsQuerySchema.safeParse({ queueId: "1002", limit: 101 }).success, false);
  assert.equal(
    completeTransferSchema.safeParse({
      summary: "",
      dispositionCode: "transferred_to_specialist",
    }).success,
    false,
  );
  assert.equal(
    completeTransferSchema.parse({
      summary: "Transferred to billing",
      dispositionCode: "transferred_to_specialist",
    }).summary,
    "Transferred to billing",
  );
});

test("transfer insert returns text ids so BigInt JSON serialization cannot break offers", () => {
  const source = readFileSync(join(here, "conversations.ts"), "utf8");
  assert.match(source, /RETURNING id::text,\s*offered_agent_id::text/);
  const projection = readFileSync(join(here, "cdp-projection.ts"), "utf8");
  assert.match(projection, /jsonStringifyEntityPayload\(input\.metadata/);
  assert.doesNotMatch(projection, /JSON\.stringify\(input\.metadata/);
});

test("transfer target query mirrors routing gates", () => {
  const source = readFileSync(join(here, "routing.ts"), "utf8");
  assert.match(source, /listEligibleTransferTargets/);
  assert.match(source, /QUEUE_MEMBER_ACTIVE_SHIFT_SQL/);
  assert.match(source, /queue\.business_hours_id IS NULL/);
  assert.match(source, /queue_skill\.requirement_type = 'required'/);
  assert.match(source, /active_count.*reserved_count/s);
  assert.match(source, /isPresenceEligibleForChannel/);
  assert.match(source, /requireVoice.*presence_state.*= 'ready'/s);
  assert.match(source, /requireVoice.*su\.ext IS NOT NULL/s);
  assert.match(source, /Voice invite still skips business hours, skills, and free capacity/);
  assert.match(source, /Two overlapping shifts still return one agent/);
});

test("workspace exposes explicit transfer lifecycle endpoints and events", () => {
  const routes = readFileSync(join(here, "../routes/workspace.ts"), "utf8");
  assert.match(routes, /conversations\/:id\/transfer-targets/);
  assert.match(routes, /conversations\/:id\/transfer\/cancel/);
  assert.match(routes, /conversations\/:id\/transfer\/complete/);
  assert.match(routes, /conversations\/:id\/voice\/transfer-invite/);
  assert.match(routes, /conversations\/:id\/voice\/transfer-action/);
  assert.match(routes, /conversations\/:id\/voice\/consult-answered/);
  assert.match(routes, /conversations\/:id\/voice\/consult-reject/);

  const realtime = readFileSync(join(here, "realtime.ts"), "utf8");
  for (const event of ["offered", "accepted", "rejected", "expired", "cancelled", "completed"]) {
    assert.match(realtime, new RegExp(`conversation\\.transfer\\.${event}`));
  }
  assert.match(realtime, /voice\.consult\.updated/);
});

test("warm transfer migration is additive and guards open explicit transfers", () => {
  const migration = readFileSync(
    join(here, "../../../../packages/db-cc/prisma/migrations/warm_agent_transfer_v1.sql"),
    "utf8",
  );
  assert.match(migration, /accepted_agent_id/);
  assert.match(migration, /accepted_user_id/);
  assert.match(migration, /rejected_at/);
  assert.match(migration, /expired_at/);
  assert.match(migration, /transfer_id/);
  assert.match(migration, /uq_ccass_conversation_transfers_open_explicit/);
  assert.match(migration, /chk_ccass_conversation_transfers_state/);
  assert.match(migration, /WHERE requested_agent_id IS NOT NULL\s+AND state = 'offered'/);
});

test("warm transfer terminal actions are conditional and capacity-safe", () => {
  const source = readFileSync(join(here, "conversations.ts"), "utf8");
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /reserved_count = GREATEST\(reserved_count - 1, 0\)/);
  assert.match(source, /active_count = GREATEST\(active_count - 1, 0\)/);
  assert.match(source, /WHERE id = \$\{warmTransfer\.id\}::bigint AND state = 'offered'/);
  assert.match(source, /Cancel the pending transfer before ending the conversation/);
  assert.match(source, /conversation_ended:\$\{payload\.reason\}/);
});

test("transfer tracking records attribution, history, disposition, and metrics", () => {
  const conversations = readFileSync(join(here, "conversations.ts"), "utf8");
  assert.match(conversations, /accepted_agent_id = \$\{agent\.id\}::bigint/);
  assert.match(conversations, /transferHistory/);
  assert.match(conversations, /transfer_id/);
  assert.match(conversations, /eventType: "transfer\.requested"/);
  assert.match(conversations, /eventType: "transfer\.completed"/);

  const reporting = readFileSync(join(here, "reporting.ts"), "utf8");
  assert.match(reporting, /loadTransferMetrics/);
  assert.match(reporting, /outbound_accepted/);
  assert.match(reporting, /inbound_accepted/);
  assert.match(reporting, /avg_ring_to_accept_seconds/);
});

test("sender and merge participant dispositions are non-final", () => {
  const conversations = readFileSync(join(here, "conversations.ts"), "utf8");
  assert.match(
    conversations,
    /'transferred',[\s\S]*?FALSE, \$\{accepted\.id\}::bigint/,
  );
  assert.match(conversations, /"agent", "transfer", "merge", "customer", "system"/);
  assert.match(conversations, /AND \$\{payload\.isFinal\}/);
  assert.match(conversations, /outcome_reason = 'voice_consult_merged'/);
});

test("open inbox includes the consulted target without creating a queue offer", () => {
  const conversations = readFileSync(join(here, "conversations.ts"), "utf8");
  assert.match(
    conversations,
    /transfer\.requested_agent_id = \$2::bigint[\s\S]*?transfer\.offered_agent_id = \$2::bigint/,
  );
  assert.match(conversations, /consultParticipant/);
  assert.match(
    conversations,
    /transfer\.state === "offered" \|\| transfer\.state === "accepted"/,
  );
});

test("an ended call still accepts the assigned agent's required final disposition", () => {
  const conversations = readFileSync(join(here, "conversations.ts"), "utf8");
  assert.match(
    conversations,
    /isEndedConversationStatus\(conversation\.status\)[\s\S]*?existingFinalRows[\s\S]*?saveConversationDisposition/,
  );
  assert.match(conversations, /Only the assigned agent can disposition this conversation/);
  assert.match(conversations, /saveVoiceMergeParticipantDisposition/);
  assert.match(conversations, /source: "merge"/);
  assert.match(conversations, /isFinal: false/);
});
