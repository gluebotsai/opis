/**
 * Register Google Calendar events.watch for all connected users (after migration).
 * run: npx tsx --tsconfig tsconfig.json scripts/bootstrap-calendar-watches.ts
 */
import "./load-repo-env.ts";
import { bootstrapGoogleCalendarWatches } from "@/service/calendar/google-calendar-push";

const result = await bootstrapGoogleCalendarWatches();
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length > 0 ? 1 : 0);
