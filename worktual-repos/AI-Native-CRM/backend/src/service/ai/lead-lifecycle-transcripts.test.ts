/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/lead-lifecycle-transcripts.test.ts
 */
import { triggerPostMeetingAgentsForActivity } from "./lead-lifecycle-transcripts";

if (typeof triggerPostMeetingAgentsForActivity !== "function") {
  throw new Error("triggerPostMeetingAgentsForActivity must be exported");
}

console.log("lead-lifecycle-transcripts exports ok");
