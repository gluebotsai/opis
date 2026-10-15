/**
 * Run: npx tsx src/lib/campaign-channel-template-count.selftest.ts
 */
import {
  formatChannelTemplateSummary,
  templateCountsByChannelFromTimeline,
  totalTimelineTemplateCount,
} from "@/lib/campaign-channel-template-count";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const moments = [
  {
    id: "m1",
    cards: [{ template_id: "e1", channel: "email" }],
    afterMessageIndex: 1,
  },
];

const counts = templateCountsByChannelFromTimeline(moments);
assert(counts.email === 1, "email count");
assert(totalTimelineTemplateCount(moments) === 1, "total");

const label = formatChannelTemplateSummary(counts, ["email", "web"]);
assert(label.includes("Email: 1"), "email label");
assert(label.includes("Web push: 0"), "web zero");

const webCounts = templateCountsByChannelFromTimeline([
  {
    id: "m2",
    cards: [{ template_id: "w1", channel: "web" }],
    afterMessageIndex: 2,
  },
]);
const webPushLabel = formatChannelTemplateSummary(webCounts, ["web_push"]);
assert(webPushLabel.includes("Web push: 1"), "web_push id maps to web cards");

console.log("campaign-channel-template-count.selftest: ok");
