/** Run: npx tsx src/lib/email-delivery-error.test.ts */
import { formatEmailDeliveryFailure } from "./email-delivery-error";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const gmail401 =
  'Gmail send failed: { "error": { "code": 401, "message": "Invalid Credentials", "status": "UNAUTHENTICATED" } }';
const formatted = formatEmailDeliveryFailure(gmail401);
assert(formatted.needsConnect, "401 maps to needsConnect");
assert(
  !formatted.message.includes("{"),
  "no raw JSON in user message",
);
assert(
  formatted.message.includes("Configuration"),
  "points user to Configuration",
);

const gmailApiOff =
  'Gmail send failed: { "error": { "code": 403, "message": "Gmail API has not been used in project 672189196887 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=672189196887", "status": "PERMISSION_DENIED" } }';
const apiOff = formatEmailDeliveryFailure(gmailApiOff);
assert(!apiOff.needsConnect, "API-disabled is not a reconnect issue");
assert(
  apiOff.message.includes("Gmail API is not enabled"),
  "mentions Gmail API enable",
);

console.log("email-delivery-error.test.ts ok");
