/**
 * Remote DB integration test for appointments (service layer, no local API).
 */
import { prisma } from "../src/dao/db/prisma.js";
import { getContact } from "../src/dao/contacts/contact-service.js";
import { checkAppointmentAvailability } from "../src/service/appointments/appointment-service.js";
import { resolveUpcomingMeetingForContact } from "../src/service/appointments/appointment-service.js";

async function main() {
  const profile = await prisma.contactProfile.findFirst({
    select: { accountContactId: true, organizationId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!profile?.organizationId) {
    console.log("no contact_profiles on remote");
    return;
  }

  const orgId = String(profile.organizationId);
  const contactId = profile.accountContactId;
  const contact = await getContact(contactId);
  if (!contact) {
    console.log("contact not found in CDP:", contactId);
    return;
  }

  console.log("contact:", contactId, contact.displayName, contact.person.email ?? "(no email)");
  console.log("organizationId:", orgId);

  const upcoming = await resolveUpcomingMeetingForContact(orgId, contactId);
  console.log("resolveUpcomingMeetingForContact:", upcoming?.id ?? "none");

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  startsAt.setMinutes(0, 0, 0);
  const availability = await checkAppointmentAvailability({
    organizationId: orgId,
    contactId,
    startsAt,
    timezone: "America/New_York",
    durationMinutes: 30,
  });
  console.log("checkAppointmentAvailability (+7d):", availability);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
