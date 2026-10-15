import { describe, expect, it } from "vitest";
import { buildSlimMeetingActivityBody } from "@/lib/meeting-body";

describe("buildSlimMeetingActivityBody", () => {
  it("writes when label and optional join link", () => {
    const body = buildSlimMeetingActivityBody({
      whenLabel: "Mon, Aug 25, 3:00 PM EDT",
      meetingLink: "https://meet.google.com/abc-defg-hij",
      provider: "google_meet",
    });
    expect(body).toContain("When: Mon, Aug 25, 3:00 PM EDT");
    expect(body).toContain("Join: https://meet.google.com/abc-defg-hij");
    expect(body).toContain("Provider: google_meet");
  });
});
