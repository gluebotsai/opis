import { prisma } from "../src/dao/db/prisma.js";
import { getContact } from "../src/dao/contacts/contact-service.js";
import {
  checkAppointmentAvailability,
  resolveUpcomingMeetingForContact,
} from "../src/service/appointments/appointment-service.js";

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ account_contact_id: string; organization_id: bigint }>
  >(
    `SELECT cp.account_contact_id, cp.organization_id
     FROM crm.contact_profiles cp
     JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
     JOIN cdp.identity_keys ik ON ik.cdp_id = p.cdp_id AND ik.key_type = 'email'
     WHERE cp.organization_id = 1000::bigint
     LIMIT 5`,
  );

  for (const row of rows) {
    const orgId = String(row.organization_id);
    const contactId = row.account_contact_id;
    const contact = await getContact(contactId);
    if (!contact?.person.email) continue;

    console.log("---");
    console.log("contact", contactId, contact.displayName, contact.person.email);
    console.log(
      "upcoming",
      (await resolveUpcomingMeetingForContact(orgId, contactId))?.id ?? "none",
    );

    const startsAt = new Date(Date.now() + 7 * 86400000);
    startsAt.setUTCHours(15, 0, 0, 0);
    const availability = await checkAppointmentAvailability({
      organizationId: orgId,
      contactId,
      startsAt,
      timezone: "UTC",
      durationMinutes: 30,
    });
    console.log("availability", availability);
    return;
  }

  console.log("no org-1000 contact with CDP email found");
}

main().finally(() => prisma.$disconnect());
