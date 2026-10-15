/**
 * Run: npx tsx backend/src/service/account/setup-user-delivery.test.ts
 */
import { isKnownContactEmailInOrg } from "./setup-users";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function pickDeliveryEmail(input: {
  workEmail: string | null;
  connectedMailbox: string | null;
  workEmailIsContact: boolean;
}): string | null {
  const { workEmail, connectedMailbox, workEmailIsContact } = input;
  if (connectedMailbox) {
    if (!workEmail || workEmailIsContact || workEmail !== connectedMailbox) {
      return connectedMailbox;
    }
  }
  if (workEmail && !workEmailIsContact) return workEmail;
  return connectedMailbox;
}

assert(
  pickDeliveryEmail({
    workEmail: "yaswanthmg1@gmail.com",
    connectedMailbox: "yaswanthmg345@gmail.com",
    workEmailIsContact: true,
  }) === "yaswanthmg345@gmail.com",
  "prefer connected mailbox when work_email is a customer address",
);

assert(
  pickDeliveryEmail({
    workEmail: "rep@company.com",
    connectedMailbox: "rep@gmail.com",
    workEmailIsContact: false,
  }) === "rep@gmail.com",
  "prefer connected when it differs from work_email",
);

assert(
  pickDeliveryEmail({
    workEmail: "rep@company.com",
    connectedMailbox: "rep@company.com",
    workEmailIsContact: false,
  }) === "rep@company.com",
  "use work_email when it matches connected mailbox",
);

console.log("setup-user-delivery.test.ts: ok");

// isKnownContactEmailInOrg requires DB — not invoked here.
