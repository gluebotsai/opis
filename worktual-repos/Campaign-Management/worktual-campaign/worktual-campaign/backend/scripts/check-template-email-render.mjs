/** Quick sanity checks for template field merge + email image render. Run `npm run build` first. */
import assert from "node:assert/strict";
import { mergeTemplateFields } from "../dist/helpers/template-fields-merge.js";
import { renderCampaignEmail, ensureHeaderImageInHtml } from "../dist/helpers/email-render.js";

const prior = {
  subject: "Summer Sale",
  paragraphs: ["Hello", "Shop today"],
  cta_label: "Shop now",
};

const merged = mergeTemplateFields(prior, { header_image: "http://192.168.13.91:3001/api/media/1" });
assert.equal(merged.subject, "Summer Sale");
assert.deepEqual(merged.paragraphs, ["Hello", "Shop today"]);
assert.equal(merged.header_image, "http://192.168.13.91:3001/api/media/1");
assert.equal(merged.sections_patch, undefined);

const withSections = mergeTemplateFields(
  {
    subject: "Launch",
    sections: [
      { type: "headline", content: "News" },
      { type: "text", content: "Details" },
    ],
  },
  {
    header_image: "http://example/img.png",
    sections_patch: { type: "image", url: "http://example/img.png" },
  },
);
const sections = withSections.sections;
assert.equal(sections[0].content, "News");
assert.equal(sections[1].type, "image");
assert.equal(sections[2].content, "Details");

const replaceImage = mergeTemplateFields(
  {
    subject: "Launch",
    sections: [
      { type: "headline", content: "News" },
      { type: "image", url: "http://example/old.png" },
      { type: "text", content: "Details" },
    ],
  },
  {
    sections_patch: { type: "image", url: "http://example/new.png" },
  },
);
assert.equal(replaceImage.sections.filter((s) => s.type === "image").length, 1);
assert.equal(replaceImage.sections[1].url, "http://example/new.png");

const flat = renderCampaignEmail({
  subject: "Test",
  paragraphs: ["One"],
  header_image: "http://example/hero.png",
});
assert.match(flat.html, /hero\.png/);
assert.match(flat.html, /One/);

const semantic = renderCampaignEmail({
  subject: "Semantic",
  sections: [
    { type: "image", url: "http://example/hero.png" },
    { type: "headline", content: "Title" },
    { type: "text", content: "Body" },
  ],
});
assert.match(semantic.html, /hero\.png/);
assert.match(semantic.html, /Title/);

const mediaUrl =
  "https://rebuild-campaign-api.worktual.com/api/media/617de7ae-8585-4c19-9016-40efbc1b2d68";
const urlAsText = renderCampaignEmail({
  subject: "Scale Your Outreach",
  sections: [
    { type: "text", content: "Our seasonal promotion is ending soon." },
    { type: "headline", content: "Scale Your Outreach with Agentic AI" },
    { type: "text", content: mediaUrl },
    {
      type: "benefits",
      items: [
        "Automate multi-channel engagement across WhatsApp, SMS, and Email.",
      ],
    },
  ],
});
assert.match(urlAsText.html, /<img[^>]+src="[^"]*617de7ae[^"]*"/i);
assert.doesNotMatch(urlAsText.html, new RegExp(`<p[^>]*>${mediaUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));

const unsplash =
  "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&q=80&w=1000";
const unsplashAsText = renderCampaignEmail({
  subject: "Pricing update",
  sections: [
    { type: "headline", content: "More Power, Less Cost." },
    { type: "text", content: unsplash },
    { type: "text", content: "Hi {{first_name}}, great news." },
  ],
});
assert.match(unsplashAsText.html, /<img[^>]+src="[^"]*unsplash[^"]*"/i);
assert.doesNotMatch(
  unsplashAsText.html,
  new RegExp(`<p[^>]*>${unsplash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`),
);

const headerOnly = renderCampaignEmail({
  subject: "Hero from flat field",
  sections: [
    { type: "headline", content: "Title" },
    { type: "benefits", items: ["One benefit"] },
  ],
  header_image: mediaUrl,
});
assert.match(headerOnly.html, /<img[^>]+src="[^"]*617de7ae[^"]*"/i);

const missing = renderCampaignEmail({
  subject: "No img in render",
  greeting: "Hi",
  paragraphs: ["Body only"],
  header_image: "https://rebuild-campaign-api.worktual.com/api/media/test-hero.png",
});
const patched = ensureHeaderImageInHtml(missing.html.replace(/<img[^>]*test-hero[^>]*>/gi, ""), {
  header_image: "https://rebuild-campaign-api.worktual.com/api/media/test-hero.png",
  paragraphs: ["Body only"],
});
assert.match(patched, /test-hero\.png/);

console.log("template-fields-merge + email-render checks passed");
