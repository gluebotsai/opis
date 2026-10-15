/**
 * CTA / wt= helpers for launch HTML (no test runner required).
 * Run: npx tsx scripts/test-email-track-cta.ts
 */
import assert from "node:assert/strict";
import {
  emailHtmlHasOutboundCtaHref,
  htmlContainsWtToken,
  pushCampaignDataPayload,
  resolvePushClickDest,
} from "../src/helpers/email-track.js";

assert.equal(
  emailHtmlHasOutboundCtaHref(
    `<a href="https://rebuild-campaign-api.worktual.com/api/campaigns/track/unsubscribe/1">Unsub</a>`,
  ),
  false,
);
assert.equal(
  emailHtmlHasOutboundCtaHref(
    `<a href="https://rebuild-campaign-api.worktual.com/api/campaigns/track/click/1?u=https%3A%2F%2Fshop.example.com%2Fsale%3Fwt%3Dabc">CTA</a>`,
  ),
  true,
);
assert.equal(htmlContainsWtToken("https://x.test/?utm_medium=email&wt=abc"), true);
assert.equal(htmlContainsWtToken("https://x.test/api/track/click/1?u=wt%3Dabc"), true);
assert.equal(htmlContainsWtToken("https://x.test/unsubscribe/1"), false);

const app = "https://rebuild-campaign.worktual.com";
assert.equal(
  resolvePushClickDest({
    ctaUrl: app,
    campaignUrl: app,
    defaultClickUrl: "",
    appUrl: app,
  }),
  null,
);
assert.equal(
  resolvePushClickDest({
    ctaUrl: "{{campaign_url}}",
    campaignUrl: app,
    defaultClickUrl: "https://shop.example/sale",
    appUrl: app,
  }),
  "https://shop.example/sale",
);
assert.equal(
  resolvePushClickDest({
    ctaUrl: "https://brand.example/offer",
    campaignUrl: app,
    defaultClickUrl: "https://shop.example/sale",
    appUrl: app,
  }),
  "https://brand.example/offer",
);
const track = pushCampaignDataPayload({
  apiBase: "https://rebuild-campaign-api.worktual.com",
  recipientId: "r1",
  campaignId: "c1",
  channel: "web",
  destUrl: resolvePushClickDest({
    ctaUrl: app,
    defaultClickUrl: "",
    appUrl: app,
  }),
});
assert.equal(
  track.click_url,
  "https://rebuild-campaign-api.worktual.com/api/campaigns/track/push-click/r1",
);
assert.equal(track.click_url.includes("?u="), false);
console.log("email-track-cta: ok");
