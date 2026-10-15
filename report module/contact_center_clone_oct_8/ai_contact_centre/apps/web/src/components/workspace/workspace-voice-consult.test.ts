import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("voice consult popup submits Invite, not Transfer or Merge", () => {
  const dialog = readFileSync(join(here, "workspace-action-dialogs.tsx"), "utf8");
  assert.match(dialog, /mode\?: "transfer" \| "voice-invite"/);
  assert.match(dialog, /title=\{mode === "voice-invite" \? "Invite agent"/);
  assert.match(dialog, /submitLabel=\{mode === "voice-invite" \? "Invite" : "Transfer"\}/);
  assert.match(dialog, /\{mode === "voice-invite" \? null : \(/);
  assert.doesNotMatch(
    dialog.slice(dialog.indexOf('mode === "voice-invite" ? "Invite agent"')),
    /submitLabel=\{mode === "voice-invite" \? "Merge"/,
  );
});

test("sender disposition defaults a transferred conversation summary", () => {
  const dialog = readFileSync(join(here, "workspace-action-dialogs.tsx"), "utf8");
  assert.match(dialog, /TRANSFERRED_WRAP_UP_SUMMARY/);
  assert.match(dialog, /defaultResolution === "transferred"/);
  assert.match(dialog, /Record your disposition as transferred/);
  assert.match(dialog, /Save disposition/);
  assert.doesNotMatch(dialog, /title=\{defaultResolution === "transferred" \? "Transfer wrap-up"/);
});

test("voice bar hides Transfer/Merge until consult is answered", () => {
  const bar = readFileSync(join(here, "workspace-voice-call-bar.tsx"), "utf8");
  assert.match(bar, /canShowVoiceConsultCompleteActions\(sip\.consultState\)/);
  assert.match(bar, /consultActive && !sip\.merged/);
  assert.match(bar, /consultRinging \? \(/);
  assert.match(bar, /Cancel invite/);
  assert.match(bar, /TRANSFER_ACTION_TRANSFEROR_TRANSFER/);
  assert.match(bar, /TRANSFER_ACTION_TRANSFEROR_MERGE/);
  assert.match(bar, /hangupOutboundCall/);
  assert.match(bar, /TRANSFER_ACTION_TRANSFEREE_LEAVE/);
});

test("transfer wrap-up completes the transfer and does not end the conversation", () => {
  const sipUa = readFileSync(join(here, "../../features/voice/sip-ua.ts"), "utf8");
  const transferStart = sipUa.indexOf("export function completeConsultTransfer");
  const transferEnd = sipUa.indexOf("export function completeConsultMerge");
  const transfer = sipUa.slice(transferStart, transferEnd);
  assert.equal(transfer.includes("finishCall("), false);
  assert.match(transfer, /awaitingTransferredDisposition: needsDisposition/);
  assert.match(transfer, /terminateSession\(consult\)/);
  assert.equal(transfer.includes("setCallPresence("), false);

  const state = readFileSync(
    join(here, "../../features/workspace/use-workspace-state.ts"),
    "utf8",
  );
  const branchStart = state.indexOf("if (sip.awaitingTransferredDisposition)");
  const branchEnd = state.indexOf("sip.awaitingMergeDisposition");
  const branch = state.slice(branchStart, branchEnd);
  assert.match(branch, /completeTransfer/);
  assert.match(branch, /publishVoiceWrapUpReady\(\)/);
  assert.equal(branch.includes("resolveConversation"), false);
  assert.match(state, /openedVoiceDispositionIdRef\.current === sip\.conversationId/);
});

test("voice transfer and merge use one disposition path per agent", () => {
  const state = readFileSync(
    join(here, "../../features/workspace/use-workspace-state.ts"),
    "utf8",
  );
  assert.match(state, /!isVoiceChannel\(item\.channel\)/);
  assert.match(state, /sip\.transferredDispositionCompletesTransfer/);
  assert.match(state, /sip\.awaitingMergeDisposition/);
  assert.match(state, /source: "merge",\s*isFinal: false/);
  assert.match(state, /const pendingVoiceDisposition =[\s\S]*?sipCallRef\.current\.awaitingDisposition/);
  assert.match(state, /if \(!pendingVoiceDisposition\) \{[\s\S]*?setDispositionDialogOpen\(false\)/);
});

test("voice consult offer is shown to B even when ACD has already changed presence", () => {
  const offer = readFileSync(join(here, "workspace-global-offer.tsx"), "utf8");
  assert.match(offer, /allowWhenNotReady/);
  assert.match(offer, /onConversationTransferOffered/);
  assert.match(offer, /isVoiceTransferOffer\(current\) \? current : null/);
  assert.match(offer, /rememberVoiceConsultOffer/);
  assert.match(offer, /sipInboundOffer \|\|/);
});

test("failed consult legs cancel their durable offered transfer", () => {
  const sipUa = readFileSync(join(here, "../../features/voice/sip-ua.ts"), "utf8");
  assert.match(sipUa, /publishConsultActionOnce/);
  assert.match(
    sipUa,
    /session\.on\("failed"[\s\S]*?TRANSFER_ACTION_TRANSFEROR_CANCEL/,
  );
});

test("merge marks its ACD action before topology events can close the old consult leg", () => {
  const bar = readFileSync(join(here, "workspace-voice-call-bar.tsx"), "utf8");
  const sipUa = readFileSync(join(here, "../../features/voice/sip-ua.ts"), "utf8");
  assert.match(
    bar,
    /beginConsultTransferAction\(action\)[\s\S]*?await workspaceApi\.voiceTransferAction/,
  );
  assert.match(
    sipUa,
    /pendingConsultAction === TRANSFER_ACTION_TRANSFEROR_MERGE[\s\S]*?old consult leg ended during conference merge/,
  );
  assert.doesNotMatch(
    sipUa,
    /if \(status\.merged\) \{\s*finishCall\(false\)/,
  );
});
