/**
 * Run: npx tsx --tsconfig tsconfig.json src/lib/meeting-participants.test.ts
 */
import assert from "node:assert/strict";
import {
  meetingInviteEmail,
  meetingTeamRoleLabel,
  teamMemberMatchesQuery,
} from "./meeting-participants";

assert.equal(
  meetingInviteEmail({
    workEmail: "y.gunasekaran@worktual.com",
    configuredEmail: "yaswanthmg1@gmail.com",
  }),
  "yaswanthmg1@gmail.com",
);
assert.equal(
  meetingInviteEmail({ workEmail: "a.antonydavidselvam@worktual.com" }),
  "a.antonydavidselvam@worktual.com",
);
assert.equal(meetingTeamRoleLabel("presales"), "Pre-sales");
assert.equal(meetingTeamRoleLabel("sales_rep"), "Sales");
assert.equal(meetingTeamRoleLabel("marketing"), "Marketing");
assert.equal(meetingTeamRoleLabel("finance"), "Finance");
assert.equal(meetingTeamRoleLabel("viewer"), "Viewer");
assert.equal(
  teamMemberMatchesQuery({
    name: "Ashika A",
    workEmail: "a.antonydavidselvam@worktual.com",
    inviteEmail: "a.antonydavidselvam@worktual.com",
    query: "pre",
  }),
  false,
);
assert.equal(
  teamMemberMatchesQuery({
    name: "Ashika A",
    workEmail: "a.antonydavidselvam@worktual.com",
    inviteEmail: "a.antonydavidselvam@worktual.com",
    query: "ashika",
  }),
  true,
);

console.log("meeting-participants.test.ts ok");
