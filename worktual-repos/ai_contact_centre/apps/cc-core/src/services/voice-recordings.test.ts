import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlayableRecordingUrl,
  mapVoiceRecordingRow,
  normalizeRecordingListQuery,
  recordingCustomerNumber,
  voiceRecordingPage,
} from "./voice-recordings.js";

test("normalizeRecordingListQuery keeps search and drops blank filters", () => {
  assert.deepEqual(normalizeRecordingListQuery({ search: "  alex ", direction: "inbound", queue: " ", agent: "Bharathi S" }), {
    limit: 10,
    offset: 0,
    search: "alex",
    direction: "inbound",
    queue: "all",
    agent: "Bharathi S",
    from: null,
    to: null,
  });
  assert.equal(normalizeRecordingListQuery({ direction: "sideways" }).direction, "all");
});

test("voiceRecordingPage defaults to 10 and clamps the window", () => {
  assert.deepEqual(voiceRecordingPage(), { limit: 10, offset: 0 });
  assert.deepEqual(voiceRecordingPage(10, 20), { limit: 10, offset: 20 });
  assert.deepEqual(voiceRecordingPage(0, -4), { limit: 1, offset: 0 });
  assert.deepEqual(voiceRecordingPage(500, 10.8), { limit: 50, offset: 10 });
});

test("recording customer number is the caller inbound and the dialed number outbound", () => {
  assert.equal(recordingCustomerNumber(1, "+918883369379", "919500231206"), "+918883369379");
  assert.equal(recordingCustomerNumber(0, "+919500231206", "918428224590", "0"), "918428224590");
  assert.equal(recordingCustomerNumber(0, "916383132225", "100", "100"), "916383132225");
  assert.equal(recordingCustomerNumber(0, "917904812618", "102", "102"), "917904812618");
});

test("isPlayableRecordingUrl accepts only http links", () => {
  assert.equal(isPlayableRecordingUrl(null), false);
  assert.equal(isPlayableRecordingUrl("0"), false);
  assert.equal(isPlayableRecordingUrl("  "), false);
  assert.equal(
    isPlayableRecordingUrl("https://recording.worktual.co.uk/ccaas/1000/call.mp3"),
    true,
  );
});

test("mapVoiceRecordingRow keeps a playable call and fills display names", () => {
  const mapped = mapVoiceRecordingRow({
    id: 2252n,
    session_start_time: 1790225267763n,
    created_at: new Date("2026-09-24T09:25:48.848Z"),
    is_inbound: 1,
    customer_number: "+918056113197",
    agent_ext: "101",
    agent_name: "Bharathi S",
    queue_name: "Support",
    recording_duration: 18264n,
    recording_url: " https://recording.worktual.co.uk/ccaas/1000/call.mp3 ",
    customer_name: "Alex",
  });
  assert.equal(mapped?.customerName, "Alex");
  assert.equal(mapped?.agentName, "Bharathi S");
  assert.equal(mapped?.agentExt, "101");
  assert.equal(mapped?.queueName, "Support");
  assert.equal(mapped?.direction, "inbound");
  assert.equal(mapped?.recordingDurationMs, 18264);
  assert.equal(mapped?.recordingUrl, "https://recording.worktual.co.uk/ccaas/1000/call.mp3");
  assert.equal(mapped?.startedAt, new Date(1790225267763).toISOString());
});

test("mapVoiceRecordingRow drops rows without a file and ignores extension 0", () => {
  assert.equal(
    mapVoiceRecordingRow({
      id: 1,
      session_start_time: null,
      created_at: new Date("2026-09-24T09:25:48.848Z"),
      is_inbound: 1,
      customer_number: "+910000000000",
      agent_ext: "0",
      agent_name: null,
      queue_name: null,
      recording_duration: 0,
      recording_url: null,
      customer_name: null,
    }),
    null,
  );
  const mapped = mapVoiceRecordingRow({
    id: 2,
    session_start_time: 0,
    created_at: new Date("2026-09-24T09:25:48.848Z"),
    is_inbound: 0,
    customer_number: "+910000000000",
    agent_ext: "0",
    agent_name: " ",
    queue_name: null,
    recording_duration: 1000,
    recording_url: "https://recording.example/a.mp3",
    customer_name: null,
  });
  assert.equal(mapped?.customerName, "+910000000000");
  assert.equal(mapped?.agentName, null);
  assert.equal(mapped?.agentExt, null);
  assert.equal(mapped?.direction, "outbound");
  assert.equal(mapped?.startedAt, "2026-09-24T09:25:48.848Z");
});
