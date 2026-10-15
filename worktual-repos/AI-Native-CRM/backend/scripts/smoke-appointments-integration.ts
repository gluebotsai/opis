/**
 * Smoke check for appointments integration (no DB writes).
 * Run: npx tsx backend/scripts/smoke-appointments-integration.ts
 */
import { buildApp } from "../src/server.js";
import { isApiKeyScope } from "../src/lib/api-key-scopes.js";
import { buildSlimMeetingActivityBody } from "../src/lib/meeting-body.js";
import { isAppointmentExistsError } from "../src/dao/appointments/appointment-store.js";

async function main() {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  checks.push({
    name: "appointments API key scope",
    ok: isApiKeyScope("appointments"),
  });

  checks.push({
    name: "slim meeting body builder",
    ok: buildSlimMeetingActivityBody({
      whenLabel: "Mon 3pm",
      meetingLink: "https://meet.google.com/x",
    }).includes("When: Mon 3pm"),
  });

  checks.push({
    name: "unique constraint helper",
    ok: isAppointmentExistsError({ code: "P2002" }),
  });

  const app = await buildApp();
  const routes = app.printRoutes();
  checks.push({
    name: "Fastify registers /api/appointments",
    ok: routes.includes("appointments"),
    detail: routes.includes("appointments") ? undefined : "route tree missing appointments",
  });
  await app.close();

  // Module import chain for refactored meeting flows
  const { resolveUpcomingMeetingForContact, syncAppointmentForMeetingActivity } =
    await import("../src/service/appointments/appointment-service.js");
  checks.push({
    name: "appointment-service exports for CRM flows",
    ok:
      typeof resolveUpcomingMeetingForContact === "function" &&
      typeof syncAppointmentForMeetingActivity === "function",
  });

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(c.ok ? "OK" : "FAIL", c.name, c.detail ?? "");
  }

  if (failed.length > 0) {
    process.exitCode = 1;
    console.error("\nSmoke checks failed:", failed.length);
  } else {
    console.log("\nAll smoke checks passed (static / boot only — no live booking exercised).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
