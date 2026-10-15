/**
 * run: npx tsx src/lib/internal-meeting.test.ts
 */
import assert from "node:assert/strict";
import {
  classifyInviteEmails,
  matchInternalSpeaker,
  planInternalDelivery,
  selectAnswerRecipients,
  type InternalPerson,
} from "./internal-meeting";
import { dayLabel, localDay } from "../service/ai/internal-meeting-context";

const people: InternalPerson[] = [
  { userId: "ceo", email: "ceo@gmail.com", name: "Asha Rao", role: "admin" },
  { userId: "mgr", email: "sam@worktual.com", name: "Sam Owner", role: "sales_manager" },
  { userId: "rep", email: "ravi@worktual.com", name: "Ravi Kumar", role: "sales_rep" },
  { userId: "pre", email: "pre@worktual.com", name: "Priya Nair", role: "presales" },
  { userId: "mkt", email: "mia@worktual.com", name: "Mia Chen", role: "marketing" },
  { userId: "fin", email: "lee@worktual.com", name: "Lee Shah", role: "finance" },
  { userId: "support", email: "support@worktual.com", name: "Sara Help", role: "sales_rep", team: "support" },
  { userId: "view", email: "view@worktual.com", name: "Viewer One", role: "viewer" },
];
const overrides = ["ceo@gmail.com"];

assert.equal(
  classifyInviteEmails({
    inviteEmails: ["ravi@worktual.com", "buyer@acme.com"],
    customerEmails: ["buyer@acme.com"],
    staffEmails: ["ravi@worktual.com"],
  }),
  "customer",
);
assert.equal(
  classifyInviteEmails({
    inviteEmails: ["ravi@worktual.com", "sam@worktual.com"],
    customerEmails: [],
    staffEmails: ["ravi@worktual.com", "sam@worktual.com"],
  }),
  "internal",
);
assert.equal(
  classifyInviteEmails({
    inviteEmails: ["ceo@gmail.com", "ravi@worktual.com"],
    customerEmails: ["ceo@gmail.com"],
    staffEmails: ["ceo@gmail.com", "ravi@worktual.com"],
  }),
  "internal",
  "CEO override address is staff, not a customer",
);
assert.equal(
  classifyInviteEmails({
    inviteEmails: ["ravi@worktual.com", "vendor@outside.com"],
    customerEmails: [],
    staffEmails: ["ravi@worktual.com"],
  }),
  "internal",
  "a non-customer outsider stays an internal meeting",
);

const named = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "person",
  addresseeName: "Ravi",
  topic: "sales",
});
assert.deepEqual(named.map((p) => p.userId), ["rep"]);

const sales = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "team",
  addresseeName: null,
  topic: "sales",
});
assert.deepEqual(sales.map((p) => p.userId), ["rep"]);

const presales = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "team",
  addresseeName: null,
  topic: "presales",
});
assert.deepEqual(presales.map((p) => p.userId), ["pre"]);

const marketing = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "team",
  addresseeName: null,
  topic: "marketing",
});
assert.deepEqual(marketing.map((p) => p.userId), ["mkt"]);

const finance = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "team",
  addresseeName: null,
  topic: "finance",
});
assert.deepEqual(finance.map((p) => p.userId), ["fin"]);

const viewerNamed = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "person",
  addresseeName: "Viewer One",
  topic: "sales",
});
assert.deepEqual(viewerNamed, []);

const support = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "team",
  addresseeName: null,
  topic: "support",
});
assert.deepEqual(support.map((p) => p.userId), ["support"]);

const all = selectAnswerRecipients({
  people,
  overrideEmails: overrides,
  targetType: "general",
  addresseeName: null,
  topic: "unclear",
});
assert.deepEqual(
  all.map((p) => p.userId).sort(),
  ["fin", "mkt", "pre", "rep", "support"],
);

const answer = planInternalDelivery({
  speaker: people[0]!,
  isQuestion: true,
  targetType: "person",
  addresseeName: "Mia",
  topic: "unclear",
  people,
  overrideEmails: overrides,
});
assert.equal(answer.kind, "answer");
if (answer.kind === "answer") {
  assert.deepEqual(answer.recipients.map((p) => p.userId), ["mkt"]);
}

const byGoogleEmail = matchInternalSpeaker(
  [{ ...people[2]!, emails: ["ravi.kumar@gmail.com"] }],
  "Ravi K",
  "ravi.kumar@gmail.com",
);
assert.equal(byGoogleEmail?.userId, "rep");
assert.equal(matchInternalSpeaker(people, "Ravi Kumar", null)?.userId, "rep");
assert.equal(matchInternalSpeaker(people, "Speaker", null), null);
assert.equal(
  matchInternalSpeaker(
    [{ userId: "raghu", email: "r.meenakshisundaram@worktual.com", name: "Raghuram Meenakshisundaram", role: "admin" }],
    "Raghuram M",
    null,
  )?.userId,
  "raghu",
);
assert.equal(
  matchInternalSpeaker(
    [{ userId: "yas", email: "y.gunasekaran@worktual.com", name: "Yaswanth MG", role: "sales_rep" }],
    "Yaswanth M G",
    null,
  )?.userId,
  "yas",
);
assert.equal(
  matchInternalSpeaker(
    [
      { userId: "a", email: "a@worktual.com", name: "Ravi Kumar", role: "sales_rep" },
      { userId: "b", email: "b@worktual.com", name: "Ravi Shah", role: "sales_rep" },
    ],
    "Ravi K",
    null,
  ),
  null,
);

const notAQuestion = planInternalDelivery({
  speaker: people[1]!,
  isQuestion: false,
  targetType: "team",
  addresseeName: null,
  topic: "sales",
  people,
  overrideEmails: overrides,
});
assert.equal(notAQuestion.kind, "none");

const fact = planInternalDelivery({
  speaker: people[2]!,
  isQuestion: false,
  targetType: "general",
  addresseeName: null,
  topic: "unclear",
  people,
  overrideEmails: overrides,
});
assert.equal(fact.kind, "fact");
if (fact.kind === "fact") {
  assert.deepEqual(fact.recipients.map((p) => p.userId).sort(), ["ceo", "mgr"]);
  assert.equal(fact.recipients.some((p) => p.userId === "rep"), false);
}

const managerSpeech = planInternalDelivery({
  speaker: people[0]!,
  isQuestion: false,
  targetType: "general",
  addresseeName: null,
  topic: "unclear",
  people,
  overrideEmails: overrides,
});
assert.notEqual(managerSpeech.kind, "fact");

const today = localDay(new Date(2026, 8, 22, 23, 30));
assert.equal(today, "2026-09-22");
assert.equal(dayLabel(new Date(2026, 8, 22, 9, 0), today), "today 2026-09-22");
assert.equal(dayLabel(new Date(2026, 8, 21, 9, 0), today), "2026-09-21");
assert.equal(dayLabel(null, today), "no date");

console.log("internal-meeting.test.ts ok");
