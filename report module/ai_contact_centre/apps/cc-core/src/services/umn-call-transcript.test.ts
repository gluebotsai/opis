import assert from "node:assert/strict";
import test from "node:test";

import {
  callTranscriptStreamName,
  classifyTranscriptSpeaker,
  matchTranscriptAgent,
  extractCallSessionKey,
  isRealAcdTranscriptSession,
  matchCallSessionIds,
  matchesLiveVoiceConversation,
  orderCallTranscripts,
  shouldNotifyWorkspaceOfCallTranscript,
  parseInboundCallTranscript,
  phoneDigitsMatch,
  rememberPendingCallTranscript,
  redisStreamTranscriptPayload,
  shouldApplyCallTranscript,
  takePendingCallTranscripts,
  transcriptMessageExternalId,
  transcriptRedisUrl,
  transcriptOccurredAt,
  transcriptStreamResumeId,
} from "./umn-call-transcript.js";
import { redisStreamMessage } from "./umn-call-session.js";

const sample = {
  session_id: "+91949231713662d2693c-2c36-1240-7397-bc2411477a90",
  is_bot: 0,
  speaker: "919492317136",
  domain_id: "7853",
  ccaas_number: "917200462856",
  text: "My favorite TV is the one in the 4K in the best number",
  transcriptTm: "0:0:28",
  emotion: "neutral",
  campaign_id: 0,
  bot_type: 0,
  customer_first_name: "",
  customer_last_name: "",
  customer_number: "919492317136",
  agent: [
    {
      name: "john cena",
      ext: "202",
      userId: "11499",
      email: "homap39943@fandoe.com",
    },
  ],
};

test("parses live call transcript payload", () => {
  const parsed = parseInboundCallTranscript(JSON.stringify(sample));
  assert.equal(parsed?.sessionId, sample.session_id);
  assert.equal(parsed?.organizationId, "7853");
  assert.equal(parsed?.speaker, "919492317136");
  assert.equal(parsed?.text, sample.text);
  assert.equal(parsed?.isBot, false);
  assert.equal(parsed?.transcriptPhase, "live_agent");
  assert.equal(parsed?.customerNumber, "919492317136");
  assert.equal(parsed?.agents[0]?.ext, "202");
});

test("skips bot transcripts", () => {
  const parsed = parseInboundCallTranscript(JSON.stringify({ ...sample, is_bot: 1 }));
  assert.equal(parsed?.isBot, true);
  assert.equal(parsed?.transcriptPhase, "bot");
});

test("bot_type keeps a customer line in the bot phase", () => {
  const parsed = parseInboundCallTranscript(
    JSON.stringify({ ...sample, is_bot: 0, bot_type: 2 }),
  );
  assert.equal(parsed?.isBot, true);
  assert.equal(parsed?.transcriptPhase, "bot");
});

test("missing bot flags leave the transcript phase unset", () => {
  const { is_bot: _isBot, bot_type: _botType, ...withoutFlags } = sample;
  const parsed = parseInboundCallTranscript(JSON.stringify(withoutFlags));
  assert.equal(parsed?.isBot, false);
  assert.equal(parsed?.transcriptPhase, null);
});

test("classifies customer and agent speakers", () => {
  const customer = parseInboundCallTranscript(JSON.stringify(sample))!;
  assert.equal(classifyTranscriptSpeaker(customer), "customer");
  assert.equal(matchTranscriptAgent(customer), null);
  const agent = parseInboundCallTranscript(
    JSON.stringify({ ...sample, speaker: "202" }),
  )!;
  assert.equal(classifyTranscriptSpeaker(agent), "agent");
  assert.equal(matchTranscriptAgent(agent)?.name, "john cena");
  assert.equal(matchTranscriptAgent(agent)?.userId, "11499");
});

test("customer wins when ccaas_number repeats customer_number", () => {
  const customer = parseInboundCallTranscript(
    JSON.stringify({
      ...sample,
      speaker: "919150911820",
      customer_number: "919150911820",
      ccaas_number: "919150911820",
      agent: [{ ...sample.agent[0], ext: "103" }],
    }),
  )!;
  assert.equal(classifyTranscriptSpeaker(customer), "customer");

  const agent = parseInboundCallTranscript(
    JSON.stringify({
      ...sample,
      speaker: "103",
      customer_number: "919150911820",
      ccaas_number: "919150911820",
      agent: [{ ...sample.agent[0], ext: "103" }],
    }),
  )!;
  assert.equal(classifyTranscriptSpeaker(agent), "agent");
});

test("classifies outbound user speech when customer_number is missing", () => {
  const parsed = parseInboundCallTranscript(
    JSON.stringify({ ...sample, customer_number: "", speaker: "919150911820" }),
  )!;
  assert.equal(classifyTranscriptSpeaker(parsed), "customer");
  assert.equal(
    classifyTranscriptSpeaker(parsed, { visitorId: "919150911820" }),
    "customer",
  );
});

test("classifies speaker labels and trunk CLI", () => {
  const labeled = parseInboundCallTranscript(
    JSON.stringify({ ...sample, speaker: "user", customer_number: "" }),
  )!;
  assert.equal(classifyTranscriptSpeaker(labeled), "customer");
  const trunk = parseInboundCallTranscript(
    JSON.stringify({ ...sample, speaker: "917200462856" }),
  )!;
  assert.equal(classifyTranscriptSpeaker(trunk), "agent");
  const roleOnly = parseInboundCallTranscript(
    JSON.stringify({ ...sample, speaker: "", role: "caller" }),
  )!;
  assert.equal(roleOnly?.speaker, "caller");
  assert.equal(classifyTranscriptSpeaker(roleOnly!), "customer");
});

test("does not attach transcripts to a sip-inbound thread by phone number", () => {
  assert.equal(phoneDigitsMatch("91915009118200", "sip-inbound:91915009118200"), true);
  assert.equal(
    matchesLiveVoiceConversation(
      {
        ext: "200",
        external_thread_id: "sip-inbound:91915009118200",
        provider_thread_id: "sip-inbound:91915009118200",
        visitor_id: "91915009118200",
      },
      {
        sessionId: "62d2693c-2c36-1240-7397-bc2411477a90",
        customerNumber: "91915009118200",
        agents: [{ ext: "200" }],
      },
    ),
    false,
  );
  assert.equal(
    matchesLiveVoiceConversation(
      {
        ext: "200",
        external_thread_id: sample.session_id,
        provider_thread_id: sample.session_id,
        visitor_id: "919492317136",
      },
      {
        sessionId: "62d2693c-2c36-1240-7397-bc2411477a90",
        customerNumber: "919492317136",
        agents: [{ ext: "200" }],
      },
    ),
    true,
  );
});

test("matches mashed transcript session ids to ACD uuid", () => {
  assert.equal(
    matchCallSessionIds(
      sample.session_id,
      "62d2693c-2c36-1240-7397-bc2411477a90",
    ),
    true,
  );
  assert.equal(extractCallSessionKey(sample.session_id), "62d2693c-2c36-1240-7397-bc2411477a90");
  assert.equal(
    matchCallSessionIds(sample.session_id, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    false,
  );
  assert.equal(matchCallSessionIds(sample.session_id, "919492317136"), false);
  assert.equal(isRealAcdTranscriptSession(sample.session_id), true);
  assert.equal(isRealAcdTranscriptSession("sip-inbound:919492317136"), false);
});

test("builds a stable transcript external id", () => {
  const parsed = parseInboundCallTranscript(JSON.stringify(sample))!;
  assert.equal(transcriptMessageExternalId(parsed), transcriptMessageExternalId(parsed));
  assert.match(transcriptMessageExternalId(parsed), /^call-transcript:/);
});

test("reads transcript JSON from the Redis Stream transcript_data field", () => {
  assert.equal(
    redisStreamTranscriptPayload(["transcript_data", JSON.stringify(sample)]),
    JSON.stringify(sample),
  );
  assert.equal(
    redisStreamMessage(["transcript_data", JSON.stringify(sample)]),
    null,
  );
});

test("does not let a non-transcript message field hide transcript_data", () => {
  const raw = JSON.stringify(sample);
  assert.equal(
    redisStreamTranscriptPayload(["message", "connected", "transcript_data", raw]),
    raw,
  );
});

test("ignores routing and call-state payloads on colliding Redis fields", () => {
  assert.equal(
    redisStreamTranscriptPayload([
      "message",
      JSON.stringify({
        session_id: sample.session_id,
        domain_id: "7853",
        event_id: 1,
        cli: "918778429069",
        ddi: "917338833821",
      }),
    ]),
    null,
  );
  assert.equal(
    parseInboundCallTranscript(
      JSON.stringify({
        session_id: sample.session_id,
        domain_id: "7853",
        event_id: 5,
        text: "I'm Worktual's customer support bot",
        speaker: "bot",
      }),
    ),
    null,
  );
  const bot = parseInboundCallTranscript(JSON.stringify({ ...sample, is_bot: 1 }))!;
  assert.equal(shouldApplyCallTranscript(bot), true);
  assert.equal(classifyTranscriptSpeaker(bot), "customer");
  const botVoice = parseInboundCallTranscript(
    JSON.stringify({ ...sample, is_bot: 1, speaker: "bot", agent: [] }),
  )!;
  assert.equal(classifyTranscriptSpeaker(botVoice), "bot");
  const virtual = parseInboundCallTranscript(JSON.stringify({ ...sample, virtual_agent: 1 }))!;
  assert.equal(shouldApplyCallTranscript(virtual), true);
  const attendant = parseInboundCallTranscript(JSON.stringify({ ...sample, auto_attendant: 1 }))!;
  assert.equal(shouldApplyCallTranscript(attendant), false);
  assert.equal(shouldApplyCallTranscript(parseInboundCallTranscript(JSON.stringify(sample))!), true);
});

test("parses flat Redis Stream fields without a JSON blob", () => {
  const raw = redisStreamTranscriptPayload([
    "session_id",
    sample.session_id,
    "domain_id",
    sample.domain_id,
    "text",
    sample.text,
    "speaker",
    sample.speaker,
    "customer_number",
    sample.customer_number,
    "agent",
    JSON.stringify(sample.agent),
  ]);
  const parsed = parseInboundCallTranscript(raw!);
  assert.equal(parsed?.sessionId, sample.session_id);
  assert.equal(parsed?.text, sample.text);
  assert.equal(parsed?.agents[0]?.ext, "202");
});

test("parses a single agent object", () => {
  const parsed = parseInboundCallTranscript(
    JSON.stringify({ ...sample, agent: sample.agent[0] }),
  );
  assert.equal(parsed?.agents[0]?.ext, "202");
});

test("call transcript stream name comes from env", () => {
  const previous = process.env.CCAAS_AUDIO_CC_CALL_STREAM;
  delete process.env.CCAAS_AUDIO_CC_CALL_STREAM;
  assert.equal(callTranscriptStreamName(), "CCAAS_AUDIO_CC_CALL_STREAM_QA");
  process.env.CCAAS_AUDIO_CC_CALL_STREAM = "CCAAS_AUDIO_CC_CALL_STREAM_PROD";
  assert.equal(callTranscriptStreamName(), "CCAAS_AUDIO_CC_CALL_STREAM_PROD");
  if (previous === undefined) {
    delete process.env.CCAAS_AUDIO_CC_CALL_STREAM;
  } else {
    process.env.CCAAS_AUDIO_CC_CALL_STREAM = previous;
  }
});

test("a voicebot transcript is stored without opening the agent workspace", () => {
  assert.equal(shouldNotifyWorkspaceOfCallTranscript("bot_active"), false);
  assert.equal(shouldNotifyWorkspaceOfCallTranscript("active"), true);
});

test("orders buffered voicebot lines by when they were spoken", () => {
  const later = parseInboundCallTranscript(JSON.stringify(sample))!;
  const earlier = parseInboundCallTranscript(
    JSON.stringify({ ...sample, text: "Hello, this is the voice bot", speaker: "bot" }),
  )!;
  later.occurredAt = "2026-10-02T02:00:10.000Z";
  earlier.occurredAt = "2026-10-02T02:00:02.000Z";
  const ordered = orderCallTranscripts([later, earlier]);
  assert.deepEqual(
    ordered.map((payload) => payload.text),
    ["Hello, this is the voice bot", sample.text],
  );
});

test("buffers transcripts until the accepted ACD conversation exists", () => {
  const parsed = parseInboundCallTranscript(JSON.stringify(sample))!;
  rememberPendingCallTranscript(parsed);
  const flushed = takePendingCallTranscripts(extractCallSessionKey(parsed.sessionId));
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0]?.text, sample.text);
  assert.equal(takePendingCallTranscripts(parsed.sessionId).length, 0);
});

test("transcript consumer resumes from checkpoint so old lines are not replayed", () => {
  assert.equal(transcriptStreamResumeId(null), "$");
  assert.equal(transcriptStreamResumeId("1773480209033-0"), "1773480209033-0");
});

test("transcript redis url is separate from ACD redis", () => {
  const previousUrl = process.env.TRANSCRIPT_REDIS_URL;
  const previousHost = process.env.TRANSCRIPT_REDIS_HOST;
  const previousPassword = process.env.TRANSCRIPT_REDIS_PASSWORD;
  const previousPort = process.env.TRANSCRIPT_REDIS_PORT;
  delete process.env.TRANSCRIPT_REDIS_URL;
  delete process.env.CCAAS_AUDIO_REDIS_URL;
  delete process.env.TRANSCRIPT_REDIS_HOST;
  assert.equal(transcriptRedisUrl(), null);
  process.env.TRANSCRIPT_REDIS_HOST = "10.0.0.8";
  process.env.TRANSCRIPT_REDIS_PORT = "6379";
  process.env.TRANSCRIPT_REDIS_PASSWORD = "secret@pw";
  assert.equal(transcriptRedisUrl(), "redis://:secret%40pw@10.0.0.8:6379");
  process.env.TRANSCRIPT_REDIS_URL = "redis://transcript-host:6379";
  assert.equal(transcriptRedisUrl(), "redis://transcript-host:6379");
  if (previousUrl === undefined) delete process.env.TRANSCRIPT_REDIS_URL;
  else process.env.TRANSCRIPT_REDIS_URL = previousUrl;
  if (previousHost === undefined) delete process.env.TRANSCRIPT_REDIS_HOST;
  else process.env.TRANSCRIPT_REDIS_HOST = previousHost;
  if (previousPassword === undefined) delete process.env.TRANSCRIPT_REDIS_PASSWORD;
  else process.env.TRANSCRIPT_REDIS_PASSWORD = previousPassword;
  if (previousPort === undefined) delete process.env.TRANSCRIPT_REDIS_PORT;
  else process.env.TRANSCRIPT_REDIS_PORT = previousPort;
});

test("transcript stream time keeps a same-millisecond bot line after the customer", () => {
  assert.equal(transcriptOccurredAt("1790502793710-0"), "2026-09-27T09:53:13.710Z");
  assert.equal(transcriptOccurredAt("1790502793710-1"), "2026-09-27T09:53:13.711Z");
  assert.equal(transcriptOccurredAt("not-a-time"), null);
});
