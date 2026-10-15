/**
 * Remote regression: demo book + CRM schedule meeting (service layer).
 * Uses org 1000 / rep 1006 on 10.180.0.126 — not local.
 *
 * Run: npx tsx backend/scripts/verify-legacy-meeting-flows-remote.ts
 */
import { prisma } from "../src/dao/db/prisma.js";
import { runWithRequestContext } from "../src/service/account/request-context.js";
import { bookDemoMeeting } from "../src/service/ai/demo-booking.js";
import { scheduleMeetingCommand } from "../src/service/calendar/schedule-meeting-command.js";
import {
  cancelAppointmentBooking,
  findLiveAppointmentForContactApi,
} from "../src/service/appointments/appointment-service.js";
import { toLocalDateTimeString } from "../src/service/ai/demo-booking.js";

const ORG = "1000";
const REP = "1006";

async function contactsWithEmail(limit = 2): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ account_contact_id: string }>>(
    `SELECT cp.account_contact_id
     FROM crm.contact_profiles cp
     JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
     JOIN cdp.identity_keys ik ON ik.cdp_id = p.cdp_id AND ik.key_type = 'email'
     WHERE cp.organization_id = $1::bigint
       AND ik.key_value NOT LIKE '%noreply%'
     LIMIT $2`,
    ORG,
    limit,
  );
  if (rows.length >= limit) return rows.map((r) => r.account_contact_id);
  const fallback = await prisma.$queryRawUnsafe<Array<{ account_contact_id: string }>>(
    `SELECT cp.account_contact_id
     FROM crm.contact_profiles cp
     JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
     JOIN cdp.identity_keys ik ON ik.cdp_id = p.cdp_id AND ik.key_type = 'email'
     WHERE cp.organization_id = $1::bigint
     LIMIT $2`,
    ORG,
    limit,
  );
  return fallback.map((r) => r.account_contact_id);
}

async function cleanupContact(contactId: string) {
  const live = await findLiveAppointmentForContactApi(ORG, contactId);
  if (live) {
    await cancelAppointmentBooking({
      organizationId: ORG,
      appointmentId: live.id,
    });
  }
}

async function verifyRows(contactId: string, label: string) {
  const appt = await findLiveAppointmentForContactApi(ORG, contactId);
  const activity = appt?.activityId
    ? await prisma.contactActivity.findUnique({
        where: { id: appt.activityId },
        select: { id: true, type: true, subject: true, body: true, dueAt: true },
      })
    : null;

  const fullBody = Boolean(activity?.body?.includes("Topic:"));
  const slimOnly =
    Boolean(activity?.body?.includes("When:")) &&
    !Boolean(activity?.body?.includes("Topic:"));

  console.log(`\n[${label}] verification`);
  console.log("  appointment:", appt?.id ?? "MISSING", appt?.source ?? "");
  console.log("  activity:", activity?.id ?? "MISSING", activity?.subject ?? "");
  console.log("  full meeting body (legacy):", fullBody);
  console.log("  slim body only:", slimOnly);

  return {
    ok: Boolean(appt && activity && fullBody && !slimOnly),
    appointmentId: appt?.id ?? null,
    activityId: activity?.id ?? null,
  };
}

async function testDemoBook(contactId: string) {
  await cleanupContact(contactId);
  const start = new Date(Date.now() + 9 * 86400000);
  start.setUTCHours(14, 0, 0, 0);

  console.log("\n=== demo book (email auto-reply path) ===");
  console.log("contact:", contactId, "start:", start.toISOString());

  const result = await bookDemoMeeting({
    mailboxUserId: REP,
    contactId,
    start,
    timeZone: "UTC",
    organizationId: ORG,
  });

  if (!result.ok) {
    console.log("FAIL demo book:", result.error, result.needsConnect ? "(needsConnect)" : "");
    return false;
  }

  console.log("OK demo book activity:", result.meetingActivityId);
  const v = await verifyRows(contactId, "demo book");
  if (v.appointmentId) {
    await cancelAppointmentBooking({
      organizationId: ORG,
      appointmentId: v.appointmentId,
    });
    console.log("  cleaned up appointment");
  }
  return v.ok;
}

async function testCrmSchedule(contactId: string) {
  await cleanupContact(contactId);
  const start = new Date(Date.now() + 10 * 86400000);
  start.setUTCHours(15, 0, 0, 0);
  const whenLocal = toLocalDateTimeString(start, "UTC");

  console.log("\n=== CRM UI schedule meeting ===");
  console.log("contact:", contactId, "when:", whenLocal);

  const result = await runWithRequestContext(
    { userId: REP },
    () =>
      scheduleMeetingCommand({
        contactId,
        when: whenLocal,
        whenIso: start.toISOString(),
        timeZone: "UTC",
        topic: "TEST CRM meeting (safe to delete)",
        durationMinutes: 30,
        meetingProvider: "google_meet",
      }),
  );

  if (!result.ok) {
    console.log("FAIL CRM schedule:", result.error, result.needsConnect ? "(needsConnect)" : "");
    return false;
  }

  console.log("OK CRM schedule activity:", result.id, "confirmationSent:", result.confirmationSent);
  const v = await verifyRows(contactId, "CRM schedule");
  if (v.appointmentId) {
    await cancelAppointmentBooking({
      organizationId: ORG,
      appointmentId: v.appointmentId,
    });
    console.log("  cleaned up appointment");
  }
  return v.ok;
}

async function main() {
  const contacts = await contactsWithEmail(2);
  if (contacts.length === 0) {
    console.error("no contacts with email in org", ORG);
    process.exitCode = 1;
    return;
  }

  const demoContact = contacts[0]!;
  const crmContact = contacts[1] ?? contacts[0]!;

  const demoOk = await testDemoBook(demoContact);
  const crmOk = await testCrmSchedule(crmContact);

  console.log("\n=== summary ===");
  console.log("demo book (email auto-reply):", demoOk ? "PASS" : "FAIL");
  console.log("CRM UI schedule meeting:", crmOk ? "PASS" : "FAIL");

  if (!demoOk || !crmOk) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
