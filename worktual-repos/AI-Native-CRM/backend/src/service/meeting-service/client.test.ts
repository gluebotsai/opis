/**
 * run: npx tsx --tsconfig tsconfig.json src/service/meeting-service/client.test.ts
 */
import {
  isBotAlreadyActiveError,
  mapMeetingServiceStatus,
  meetingServiceErrorMeetingId,
} from "@/service/meeting-service/client";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  isBotAlreadyActiveError("bot already active on this meeting"),
  "string already active",
);
assert(
  isBotAlreadyActiveError('{"error_code":"capacity","error_message":"bot already active on this meeting"}'),
  "json string capacity",
);
assert(
  isBotAlreadyActiveError("x", {
    id: "abc",
    error_code: "capacity",
    error_message: "bot already active on this meeting",
  }),
  "detail object",
);
assert(
  meetingServiceErrorMeetingId({
    id: "8a89eccd-e412-4764-ade1-cb5750c19184",
    error_code: "capacity",
  }) === "8a89eccd-e412-4764-ade1-cb5750c19184",
  "extract meeting id",
);
assert(
  mapMeetingServiceStatus(
    "failed",
    "bot already active on this meeting",
  ) === "scheduled",
  "already-active failed maps to scheduled",
);
assert(mapMeetingServiceStatus("failed", "lobby timeout") === "failed", "real fail");
assert(mapMeetingServiceStatus("active") === "joined", "active");

console.log("meeting-service/client.test.ts ok");
