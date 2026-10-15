import {
  cancelAppointmentBooking,
  createAppointmentBooking,
  findLiveAppointmentForContactApi,
} from "../src/service/appointments/appointment-service.js";
import { prisma } from "../src/dao/db/prisma.js";

const ORG = "1000";
const CONTACT = "9";

async function main() {
  const existing = await findLiveAppointmentForContactApi(ORG, CONTACT);
  if (existing) {
    console.log("canceling pre-existing live appointment", existing.id);
    const canceled = await cancelAppointmentBooking({
      organizationId: ORG,
      appointmentId: existing.id,
    });
    console.log("cancel result", canceled.ok ? "ok" : canceled);
  }

  const startsAt = new Date(Date.now() + 8 * 86400000);
  startsAt.setUTCHours(16, 0, 0, 0);

  console.log("creating test appointment at", startsAt.toISOString());
  const created = await createAppointmentBooking({
    organizationId: ORG,
    contactId: CONTACT,
    title: "TEST appointment (safe to delete)",
    startsAt,
    timezone: "UTC",
    source: "ccaas_webchat",
    durationMinutes: 30,
  });

  console.log("create:", created.ok ? "ok" : created);
  if (!created.ok) return;

  console.log("appointment id:", created.appointment.id);
  console.log("activity id:", created.activityId);

  const live = await findLiveAppointmentForContactApi(ORG, CONTACT);
  console.log("live after create:", live?.id, live?.activityId);

  const canceled = await cancelAppointmentBooking({
    organizationId: ORG,
    appointmentId: created.appointment.id,
  });
  console.log("cancel:", canceled.ok ? "ok" : canceled);

  const after = await findLiveAppointmentForContactApi(ORG, CONTACT);
  console.log("live after cancel:", after?.id ?? "none");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
