import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TRANSFER_ACTION_TRANSFEREE_LEAVE,
  TRANSFER_ACTION_TRANSFEROR_CANCEL,
  TRANSFER_ACTION_TRANSFEROR_ENDALL,
  TRANSFER_ACTION_TRANSFEROR_LEAVE,
  TRANSFER_ACTION_TRANSFEROR_MERGE,
  TRANSFER_ACTION_TRANSFEROR_TRANSFER,
  TRANSFER_TYPE_AGENT,
  VOICE_CONSULT_OUTCOME_MERGED,
  VOICE_CONSULT_OUTCOME_TRANSFERRED,
  agentTransferPublishBody,
  transferActionPublishBody,
  voiceConsultStateAfterAction,
  voiceTransferActionSchema,
} from "./umn-voice-transfer.js";

const here = dirname(fileURLToPath(import.meta.url));

test("voice Transfer leaves consult accepted so sender can save wrap-up", () => {
  assert.equal(voiceConsultStateAfterAction(TRANSFER_ACTION_TRANSFEROR_TRANSFER), "accepted");
  assert.equal(voiceConsultStateAfterAction(TRANSFER_ACTION_TRANSFEROR_MERGE), "accepted");
  assert.equal(voiceConsultStateAfterAction(TRANSFER_ACTION_TRANSFEROR_CANCEL), "cancelled");
  assert.equal(voiceConsultStateAfterAction(TRANSFER_ACTION_TRANSFEROR_ENDALL), "completed");
});

test("voice Transfer and Merge retain distinct ownership outcomes", () => {
  assert.equal(VOICE_CONSULT_OUTCOME_TRANSFERRED, "voice_consult_transferred");
  assert.equal(VOICE_CONSULT_OUTCOME_MERGED, "voice_consult_merged");
});

test("voice invite reuses one open consult instead of inserting a second offered row", () => {
  const source = readFileSync(join(here, "umn-voice-transfer.ts"), "utf8");
  assert.match(source, /AND state IN \('offered', 'accepted'\)/);
  assert.match(source, /ON CONFLICT \(organization_id, conversation_id\)/);
  assert.match(source, /emitTransferOffered/);
  assert.match(source, /TRANSFER_ACTION_TRANSFEROR_CANCEL[\s\S]*?emitTransferCancelled/);
  assert.match(source, /markVoiceConsultAnswered/);
  assert.match(source, /emitVoiceCallOpened/);
  assert.match(source, /rejectVoiceConsultTransfer/);
  assert.match(source, /consult\?\.from_user_id && consult\.from_user_id === userId/);
});

test("merge gives the secondary agent independent assignment capacity", () => {
  const source = readFileSync(join(here, "umn-voice-transfer.ts"), "utf8");
  assert.match(source, /reason, offered_at, accepted_at[\s\S]*?'voice_merge'/);
  assert.match(source, /reason = 'voice_merge_left'/);
  assert.match(source, /active_count = active_count \+ 1/);
  assert.match(source, /active_count = GREATEST\(active_count - 1, 0\)/);
});

test("locked TRANSFER_ACTION integers match ACD samples", () => {
  assert.equal(TRANSFER_ACTION_TRANSFEROR_MERGE, 1);
  assert.equal(TRANSFER_ACTION_TRANSFEROR_TRANSFER, 2);
  assert.equal(TRANSFER_ACTION_TRANSFEROR_CANCEL, 3);
  assert.equal(TRANSFER_ACTION_TRANSFEROR_LEAVE, 4);
  assert.equal(TRANSFER_ACTION_TRANSFEREE_LEAVE, 6);
  assert.equal(TRANSFER_TYPE_AGENT, 1);
});

test("AGENT_TRANSFER payload uses B extension and identity", () => {
  assert.deepEqual(
    agentTransferPublishBody({
      sessionId: "+918056113197437435e7-2ee8-1240-548c-bc2411a168a2",
      ext: "208",
      email: "test@supervisor.com",
      name: "Test Supervisor",
      userId: "2567",
    }),
    {
      session_id: "+918056113197437435e7-2ee8-1240-548c-bc2411a168a2",
      req_type: "AGENT_TRANSFER",
      transfer_type: 1,
      ddi: 208,
      email: "test@supervisor.com",
      name: "Test Supervisor",
      userId: "2567",
    },
  );
});

test("TRANSFER_ACTION payloads match the locked samples", () => {
  assert.deepEqual(
    transferActionPublishBody({
      sessionId: "+918056113197437435e7-2ee8-1240-548c-bc2411a168a2",
      action: TRANSFER_ACTION_TRANSFEROR_TRANSFER,
    }),
    {
      session_id: "+918056113197437435e7-2ee8-1240-548c-bc2411a168a2",
      req_type: "TRANSFER_ACTION",
      action: 2,
      ddi: null,
    },
  );
  assert.deepEqual(
    transferActionPublishBody({
      sessionId: "+918056113197371caba8-2eea-1240-548c-bc2411a168a2",
      action: TRANSFER_ACTION_TRANSFEROR_MERGE,
    }),
    {
      session_id: "+918056113197371caba8-2eea-1240-548c-bc2411a168a2",
      req_type: "TRANSFER_ACTION",
      action: 1,
      ddi: null,
    },
  );
  assert.deepEqual(
    transferActionPublishBody({
      sessionId: "+918056113197371caba8-2eea-1240-548c-bc2411a168a2",
      action: TRANSFER_ACTION_TRANSFEROR_LEAVE,
      ext: "200",
      agentType: "PRIMARY",
    }),
    {
      session_id: "+918056113197371caba8-2eea-1240-548c-bc2411a168a2",
      req_type: "TRANSFER_ACTION",
      action: 4,
      ddi: 200,
      agentType: "PRIMARY",
    },
  );
  assert.deepEqual(
    transferActionPublishBody({
      sessionId: "+918056113197e3208f96-2eea-1240-548c-bc2411a168a2",
      action: TRANSFER_ACTION_TRANSFEREE_LEAVE,
      ext: "208",
      agentType: "SECONDARY",
    }),
    {
      session_id: "+918056113197e3208f96-2eea-1240-548c-bc2411a168a2",
      req_type: "TRANSFER_ACTION",
      action: 6,
      ddi: 208,
      agentType: "SECONDARY",
    },
  );
  assert.equal(voiceTransferActionSchema.parse({ action: 3 }).action, 3);
  assert.equal(voiceTransferActionSchema.safeParse({ action: 9 }).success, false);
});
