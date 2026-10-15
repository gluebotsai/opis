/**
 * run: npx tsx src/service/ai/internal-meeting-question-store.test.ts
 */
import assert from "node:assert/strict";
import {
  claimPendingInternalQuestion,
  clearPendingInternalQuestions,
  getPendingInternalQuestion,
  savePendingInternalQuestion,
} from "./internal-meeting-question-store";

async function main(): Promise<void> {
  const sessionId = `question-store-${Date.now()}`;
  await savePendingInternalQuestion({
    sessionId,
    askerUserId: "manager-1",
    askerName: "Manager One",
    question: "Sales team, how many deals did you convert?",
    employeeUserIds: ["rep-1", "rep-2"],
  });

  const peek = await getPendingInternalQuestion(sessionId, "rep-1");
  assert.equal(peek?.question, "Sales team, how many deals did you convert?");
  const first = await claimPendingInternalQuestion(sessionId, "rep-1");
  assert.equal(first?.askerUserId, "manager-1");
  assert.equal(first?.question, "Sales team, how many deals did you convert?");
  assert.equal(await claimPendingInternalQuestion(sessionId, "rep-1"), null);

  const second = await claimPendingInternalQuestion(sessionId, "rep-2");
  assert.equal(second?.employeeUserId, "rep-2");
  assert.equal(await claimPendingInternalQuestion(sessionId, "other"), null);
  clearPendingInternalQuestions(sessionId);

  console.log("internal-meeting-question-store.test.ts ok");
}

void main();
