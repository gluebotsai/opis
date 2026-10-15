import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceConversation } from "@/features/workspace/types";
import {
  clearPendingVoiceConsultWorkspace,
  getPendingVoiceConsultWorkspace,
  rememberInboundVoiceConsultSession,
  rememberVoiceConsultOffer,
} from "./voice-consult-workspace.ts";

const conversation = { id: "113544" } as WorkspaceConversation;

test("consult workspace links socket-first offers to the later SIP session", () => {
  clearPendingVoiceConsultWorkspace();
  rememberVoiceConsultOffer(conversation);
  const pending = rememberInboundVoiceConsultSession("acd-session-1");
  assert.equal(pending?.conversation.id, conversation.id);
  assert.equal(pending?.sessionId, "acd-session-1");
});

test("consult workspace links SIP-first sessions to the later socket offer", () => {
  clearPendingVoiceConsultWorkspace();
  rememberInboundVoiceConsultSession("acd-session-2");
  const pending = rememberVoiceConsultOffer(conversation);
  assert.equal(pending.sessionId, "acd-session-2");
  clearPendingVoiceConsultWorkspace(conversation.id);
  assert.equal(getPendingVoiceConsultWorkspace(), null);
});
