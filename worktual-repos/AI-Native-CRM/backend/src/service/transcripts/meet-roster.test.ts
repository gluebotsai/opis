/**
 * Run: npx tsx --tsconfig tsconfig.json src/service/transcripts/meet-roster.test.ts
 */
import assert from "node:assert/strict";
import { GOOGLE_SCOPES } from "@/service/google/calendar";
import {
  conferenceRecordsFilter,
  participantsListFilter,
  peopleResourceFromMeetUser,
  readConferenceRecordNames,
  readPeopleEmail,
  readSignedInParticipants,
  resolveMeetRoster,
} from "./meet-roster";

assert.equal(
  conferenceRecordsFilter("AbC-Mnop-Xyz"),
  'space.meeting_code = "abc-mnop-xyz" AND end_time IS NULL',
);
assert.equal(participantsListFilter(), "latest_end_time IS NULL");
assert.equal(peopleResourceFromMeetUser("users/123"), "people/123");
assert.equal(peopleResourceFromMeetUser("conferenceRecords/abc/participants/123"), null);
assert.ok(GOOGLE_SCOPES.includes("https://www.googleapis.com/auth/meetings.space.readonly"));
assert.ok(GOOGLE_SCOPES.includes("https://www.googleapis.com/auth/directory.readonly"));

const signedIn = readSignedInParticipants({
  participants: [
    {
      signedinUser: { user: "users/99", displayName: "Alice" },
      earliestStartTime: "2026-09-27T12:00:00.000Z",
    },
    { anonymousUser: { displayName: "Guest" }, earliestStartTime: "2026-09-27T12:01:00.000Z" },
  ],
});
assert.equal(signedIn.length, 1);
assert.equal(signedIn[0]?.peopleResource, "people/99");
assert.equal(readPeopleEmail({ emailAddresses: [{ value: "Alice@Co.com" }] }), "alice@co.com");
assert.equal(readPeopleEmail({ emailAddresses: [] }), null);
assert.deepEqual(
  readConferenceRecordNames({ conferenceRecords: [{ name: "conferenceRecords/abc" }, { name: "nope" }] }),
  ["conferenceRecords/abc"],
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const urls: string[] = [];
const roster = await resolveMeetRoster({
  accessToken: "token",
  meetCode: "abc-mnop-xyz",
  fetchImpl: async (url) => {
    const href = String(url);
    urls.push(href);
    if (href.includes("/conferenceRecords?")) {
      return json({ conferenceRecords: [{ name: "conferenceRecords/rec-1" }] });
    }
    if (href.includes("/participants?")) {
      return json({
        participants: [
          {
            signedinUser: { user: "users/99" },
            earliestStartTime: "2026-09-27T12:00:00.000Z",
          },
        ],
      });
    }
    if (href.includes("people.googleapis.com/v1/people/99")) {
      return json({ emailAddresses: [{ value: "alice@co.com" }] });
    }
    return json({}, 404);
  },
});
assert.equal(roster.ok, true);
if (roster.ok) {
  assert.equal(roster.entries.length, 1);
  assert.equal(roster.entries[0]?.email, "alice@co.com");
  assert.equal(roster.entries[0]?.userId, "users/99");
}
assert.ok(urls[0]?.includes(encodeURIComponent(conferenceRecordsFilter("abc-mnop-xyz"))));
assert.ok(urls[1]?.includes(encodeURIComponent(participantsListFilter())));
assert.ok(urls[2]?.includes("personFields=emailAddresses"));

const ambiguous = await resolveMeetRoster({
  accessToken: "token",
  meetCode: "abc-mnop-xyz",
  fetchImpl: async (url) => {
    if (String(url).includes("/conferenceRecords?")) {
      return json({
        conferenceRecords: [{ name: "conferenceRecords/a" }, { name: "conferenceRecords/b" }],
      });
    }
    throw new Error("must not fetch participants when two conferences match");
  },
});
assert.equal(ambiguous.ok, false);
if (!ambiguous.ok) assert.equal(ambiguous.error, "ambiguous_conference");

const noEmail = await resolveMeetRoster({
  accessToken: "token",
  meetCode: "abc-mnop-xyz",
  fetchImpl: async (url) => {
    const href = String(url);
    if (href.includes("/conferenceRecords?")) {
      return json({ conferenceRecords: [{ name: "conferenceRecords/rec-1" }] });
    }
    if (href.includes("/participants?")) {
      return json({
        participants: [
          { signedinUser: { user: "users/99" }, earliestStartTime: "2026-09-27T12:00:00.000Z" },
        ],
      });
    }
    return json({ emailAddresses: [] });
  },
});
assert.equal(noEmail.ok, false);
if (!noEmail.ok) {
  assert.equal(noEmail.error, "no_employee_emails");
  assert.deepEqual(noEmail.lookups, [
    { userId: "users/99", displayName: "", email: null, error: "no_email" },
  ]);
}

const recognized = await resolveMeetRoster({
  accessToken: "other-employee-token",
  meetCode: "abc-mnop-xyz",
  employeeMailboxes: [
    { accountEmail: "sample151102@gmail.com", accessToken: "other-employee-token" },
    { accountEmail: "yaswanthmg1@gmail.com", accessToken: "creator-token" },
  ],
  fetchImpl: async (url, init) => {
    const href = String(url);
    const auth = String(
      (init?.headers as { Authorization?: string } | undefined)?.Authorization || "",
    );
    if (href.includes("/conferenceRecords?")) {
      return json({ conferenceRecords: [{ name: "conferenceRecords/rec-1" }] });
    }
    if (href.includes("/participants?")) {
      return json({
        participants: [
          {
            signedinUser: { user: "users/creator", displayName: "Yaswanth M G" },
            earliestStartTime: "2026-09-28T05:49:22.000Z",
          },
          {
            signedinUser: { user: "users/sample", displayName: "Sample" },
            earliestStartTime: "2026-09-28T05:52:44.000Z",
          },
          {
            signedinUser: { user: "users/customer", displayName: "lucifer" },
            earliestStartTime: "2026-09-28T05:50:15.000Z",
          },
          {
            anonymousUser: { displayName: "Worktual Notetaker" },
            earliestStartTime: "2026-09-28T05:49:28.000Z",
          },
        ],
      });
    }
    if (href.includes("/people/creator") && auth.includes("creator-token")) {
      return json({ emailAddresses: [{ value: "yaswanthmg1@gmail.com" }] });
    }
    if (href.includes("/people/sample") && auth.includes("other-employee-token")) {
      return json({ emailAddresses: [{ value: "sample151102@gmail.com" }] });
    }
    return json({ emailAddresses: [] });
  },
});
assert.equal(recognized.ok, true);
if (recognized.ok) {
  assert.deepEqual(
    recognized.entries.map((row) => row.email).sort(),
    ["sample151102@gmail.com", "yaswanthmg1@gmail.com"],
  );
  assert.deepEqual(
    recognized.customers.map((row) => row.displayName),
    ["lucifer"],
  );
}

console.log("meet-roster.test.ts ok");
