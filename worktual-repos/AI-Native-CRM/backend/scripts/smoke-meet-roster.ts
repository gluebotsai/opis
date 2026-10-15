/**
 * Print the emails Google returns for one live Meet, using an organizer token.
 * Does not write CRM state and does not turn on MEET_CHANNEL_BINDINGS=1.
 *
 * From backend/:
 *   npx tsx --tsconfig tsconfig.json scripts/smoke-meet-roster.ts <meet-code> <access-token>
 *
 * The token may also come from GOOGLE_ACCESS_TOKEN, and the code from MEET_CODE.
 */
import { resolveMeetRoster } from "@/service/transcripts/meet-roster";

const meetCode = (process.argv[2] || process.env.MEET_CODE || "").trim();
const accessToken = (process.argv[3] || process.env.GOOGLE_ACCESS_TOKEN || "").trim();

if (!meetCode || !accessToken) {
  console.error("Usage: npx tsx --tsconfig tsconfig.json scripts/smoke-meet-roster.ts <meet-code> <access-token>");
  process.exit(1);
}

const roster = await resolveMeetRoster({ accessToken, meetCode });
if (!roster.ok) {
  console.log(JSON.stringify({ ok: false, error: roster.error, lookups: roster.lookups }, null, 2));
  process.exit(2);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      emails: roster.entries.map((row) => ({
        email: row.email,
        userId: row.userId,
        earliestStartMs: row.earliestStartMs,
        latestEndMs: row.latestEndMs,
      })),
      lookups: roster.lookups,
    },
    null,
    2,
  ),
);
