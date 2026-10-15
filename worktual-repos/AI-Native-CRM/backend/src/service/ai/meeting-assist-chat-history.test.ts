/**
 * run: npx tsx src/service/ai/meeting-assist-chat-history.test.ts
 */
import assert from "node:assert/strict";
import {
  appendMeetingAssistChatHistory,
  getMeetingAssistChatHistory,
} from "./meeting-assist-chat-history";

async function main(): Promise<void> {
  const sessionId = `chat-history-${Date.now()}`;
  await appendMeetingAssistChatHistory(sessionId, "*", {
    type: "chunk",
    text: "Customer question",
  });
  await appendMeetingAssistChatHistory(sessionId, "employee-1", {
    type: "assist",
    result: { internal: true, answer: "Private answer" },
  });

  const employee = await getMeetingAssistChatHistory(sessionId, "employee-1");
  const other = await getMeetingAssistChatHistory(sessionId, "employee-2");
  assert.equal(employee.length, 2);
  assert.equal(other.length, 1);
  assert.equal(
    (employee[1]?.event as { result?: { answer?: string } }).result?.answer,
    "Private answer",
  );

  console.log("meeting-assist-chat-history.test.ts ok");
}

void main();
