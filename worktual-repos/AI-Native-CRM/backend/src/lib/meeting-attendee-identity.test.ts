/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/meeting-attendee-identity.test.ts
 */
import assert from "node:assert/strict";
import { classifyAttendeeTurn } from "./meeting-attendee-identity";

const people = [
  { email: "sam@company.com", name: "Sam Owner", role: "host" as const },
  { email: "ravi@customer.com", name: "Ravi Kumar", role: "customer" as const },
];

const host = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-0:1",
  displayName: "Sam Owner",
  people,
  hostMeetName: "Sam Owner",
  hostEmail: "sam@company.com",
});
assert.equal(host.role, "host");
assert.equal(host.email, "sam@company.com");
assert.equal(host.id, "meet:sess-1:ch-0");

// A customer speaking on a fresh channel with zero established context (no
// host lock yet, no hostMeetName even passed) is NOT granted "customer"
// just because their resolved name happens to match the CRM contact's
// stored name — that is exactly the name-matching this system must not do.
// It stays "unknown" until the host has been resolved (near-instant in any
// real call — the rep almost always speaks first) or an explicit tap.
const customerBeforeAnyContext = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-1:1",
  displayName: "Ravi Kumar",
  people,
  hostEmail: "sam@company.com",
});
assert.equal(customerBeforeAnyContext.role, "unknown");
assert.equal(customerBeforeAnyContext.email, null);

// Once the host is genuinely locked (from a verified panel identity match),
// the customer's channel resolves by process-of-elimination alone — no
// name/email comparison against the customer needed at all, even for their
// very first line.
const customerViaElimination = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-1:1",
  displayName: "Ravi Kumar",
  people,
  hostEmail: "sam@company.com",
  locks: [host],
});
assert.equal(customerViaElimination.role, "customer");
assert.equal(customerViaElimination.email, "ravi@customer.com");

// Once the owner channel is known, an unresolved glow on the other channel
// can be assigned to the remaining customer seat (not a rep's real name).
const nickname = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-1:1",
  displayName: "Speaker",
  people,
  hostMeetName: "Sam Owner",
  hostEmail: "sam@company.com",
  locks: [host],
});
assert.equal(nickname.role, "customer");
assert.equal(nickname.email, "ravi@customer.com");

// Rep speech with a resolved name must not inherit the customer seat.
const repOnOpenChannel = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-1:1",
  displayName: "Sam Owner",
  people,
  hostMeetName: "Sam Owner",
  hostEmail: "sam@company.com",
  locks: [host],
});
assert.equal(repOnOpenChannel.role, "host");
assert.equal(repOnOpenChannel.email, "sam@company.com");

// Same display name on both people does not pick a side.
const collision = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-0:1",
  displayName: "Sam",
  people: [
    { email: "sam@company.com", name: "Sam", role: "host" },
    { email: "ravi@customer.com", name: "Sam", role: "customer" },
  ],
  hostMeetName: "Sam",
  hostEmail: "sam@company.com",
});
assert.equal(collision.role, "unknown");
assert.equal(collision.email, null);

// A locked channel keeps its email when the glow flickers.
const held = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-1:2",
  displayName: "Sam Owner",
  people,
  existing: customerViaElimination,
});
assert.equal(held.role, "customer");
assert.equal(held.email, "ravi@customer.com");

// No name yet (overlap) and zero established context does not coach.
const overlap = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-2:1",
  displayName: "Speaker",
  people,
});
assert.equal(overlap.role, "unknown");

// A third person is not assumed to be the customer.
const guest = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-2:1",
  displayName: "Alex",
  people: [
    ...people,
    { email: "pre@company.com", name: "Pre Sales", role: "host" },
  ],
  locks: [host],
});
assert.equal(guest.role, "unknown");

// Production regression: the meeting owner had a work email plus a connected
// calendar Gmail, while a different rep actually opened the panel and joined
// the call. The two owner aliases are metadata for one organizer, not two
// additional physical seats. Once the exact panel-verified rep channel is
// locked, the sole external invitee must resolve as the customer.
const luciferPeople = [
  {
    email: "lucifer543666@gmail.com",
    name: "Lucifer S",
    role: "customer" as const,
    source: "contact" as const,
  },
  {
    email: "r.meenakshisundaram@worktual.com",
    name: "Raghuram M",
    role: "host" as const,
    source: "host" as const,
  },
  {
    email: "yaswanthmg1@gmail.com",
    name: "Raghuram M",
    role: "host" as const,
    source: "host" as const,
  },
  {
    email: "y.gunasekaran@worktual.com",
    name: "Yaswanth M G",
    role: "host" as const,
    source: "verified" as const,
  },
];
const verifiedYaswanthLock = classifyAttendeeTurn({
  sessionId: "sess-lucifer",
  speakerKey: "ch-1:1",
  displayName: "Yaswanth M G",
  people: luciferPeople,
  hostMeetName: "Yaswanth M G",
  hostEmail: "y.gunasekaran@worktual.com",
});
assert.equal(verifiedYaswanthLock.role, "host");
const luciferAfterVerifiedHost = classifyAttendeeTurn({
  sessionId: "sess-lucifer",
  speakerKey: "ch-0:2",
  displayName: "lucifer",
  people: luciferPeople,
  hostMeetName: "Yaswanth M G",
  hostEmail: "y.gunasekaran@worktual.com",
  locks: [verifiedYaswanthLock],
});
assert.equal(luciferAfterVerifiedHost.role, "customer");
assert.equal(luciferAfterVerifiedHost.email, "lucifer543666@gmail.com");

// A real internal invitee is still a possible physical seat and is never
// discarded as an organizer alias. Until that invitee is accounted for, an
// unmatched channel stays unknown and can be mapped explicitly in the panel.
const invitedPreSalesStillBlocks = classifyAttendeeTurn({
  sessionId: "sess-lucifer",
  speakerKey: "ch-2:1",
  displayName: "Alex",
  people: [
    ...luciferPeople,
    {
      email: "presales@worktual.com",
      name: "Pre Sales",
      role: "host",
      source: "invitee",
    },
  ],
  hostMeetName: "Yaswanth M G",
  hostEmail: "y.gunasekaran@worktual.com",
  locks: [verifiedYaswanthLock],
});
assert.equal(invitedPreSalesStillBlocks.role, "unknown");

// Some capture paths omit speaker_key; once the host is established,
// elimination still resolves the customer's seat without a channel key and
// without matching the resolved glow name against anything.
const noChannel = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "",
  displayName: "Ravi Kumar",
  people,
  hostEmail: "sam@company.com",
  locks: [host],
});
assert.equal(noChannel.role, "customer");
assert.equal(noChannel.email, "ravi@customer.com");

// Elimination-by-exclusion is meeting-scoped, not org-wide: once every
// *other* seat on this call (host + pre-sales) is locked, the one channel
// left over must be the customer — the bug this fixes was the roster
// including every assignable rep in the org, so "one seat left" never
// happened for orgs with more than a couple of users.
const preSalesLock = {
  id: "meet:sess-1:ch-2",
  role: "host" as const,
  name: "Pre Sales",
  email: "pre@company.com",
};
const eliminatedCustomer = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-3:1",
  displayName: "Speaker",
  people: [...people, { email: "pre@company.com", name: "Pre Sales", role: "host" }],
  locks: [host, preSalesLock],
});
assert.equal(eliminatedCustomer.role, "customer");
assert.equal(eliminatedCustomer.email, "ravi@customer.com");

// A customer's own colleague (guest, external domain) is a valid
// elimination target too — not just the primary contact.
const customerGuestLock = {
  id: "meet:sess-1:ch-4",
  role: "customer" as const,
  name: "Ravi Kumar",
  email: "ravi@customer.com",
};
const eliminatedGuest = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-5:1",
  displayName: "Priya",
  people: [...people, { email: "priya@customer.com", name: "Priya Guest", role: "customer" }],
  locks: [host, customerGuestLock],
});
assert.equal(eliminatedGuest.role, "customer");
assert.equal(eliminatedGuest.email, "priya@customer.com");

// Sticky customer lock from "Speaker" is reclaimed when the rep's name appears.
const stickyCustomer = {
  id: "meet:sess-1:ch-1",
  role: "customer" as const,
  name: "Speaker",
  email: "ravi@customer.com",
};
const reclaimedHost = classifyAttendeeTurn({
  sessionId: "sess-1",
  speakerKey: "ch-1:2",
  displayName: "Sam Owner",
  people,
  hostMeetName: "Sam Owner",
  hostEmail: "sam@company.com",
  existing: stickyCustomer,
});
assert.equal(reclaimedHost.role, "host");
assert.equal(reclaimedHost.email, "sam@company.com");

// --- The real-world regression this fix targets -----------------------
//
// A CRM contact ("ravi r") whose stored email is literally the same
// mailbox the rep uses to sign into the Sales Assist panel/Google Meet
// (misconfigured test contact, or a rep testing solo). Because the emails
// are identical, buildAttendeePeople collapses this to a single seat —
// but even if it did NOT collapse (a distinct contact record that merely
// shares a name/email fragment with the rep), name/email string matching
// must never be the reason "customer" gets granted.
const sharedIdentityPeople = [
  { email: "yaswanthmg345@gmail.com", name: "Yaswanth M G", role: "host" as const },
];
const repSolo1 = classifyAttendeeTurn({
  sessionId: "sess-2",
  speakerKey: "ch-0:1",
  displayName: "Yaswanth M G",
  people: sharedIdentityPeople,
  hostMeetName: "Yaswanth M G",
  hostEmail: "yaswanthmg345@gmail.com",
});
assert.equal(repSolo1.role, "host");
// Repeated lines on the same channel stay host (sticky lock).
const repSolo2 = classifyAttendeeTurn({
  sessionId: "sess-2",
  speakerKey: "ch-0:2",
  displayName: "Yaswanth M G",
  people: sharedIdentityPeople,
  hostMeetName: "Yaswanth M G",
  hostEmail: "yaswanthmg345@gmail.com",
  existing: repSolo1,
});
assert.equal(repSolo2.role, "host");

console.log("meeting-attendee-identity.test.ts ok");
