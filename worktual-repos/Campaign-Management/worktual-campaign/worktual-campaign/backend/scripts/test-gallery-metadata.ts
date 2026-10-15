/**
 * Lightweight gallery metadata tests.
 * Run: tsx scripts/test-gallery-metadata.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isLegacyStaticLibraryRow,
  shouldShowInGalleryList,
} from "../src/helpers/gallery-metadata.js";
import {
  expectedGalleryTemplateCount,
  galleryKeysForIdea,
  ideaSortOrderHasImage,
  templateSpecsForIdea,
} from "../src/helpers/gallery-template-specs.js";

function testLegacyHidden() {
  assert.equal(
    isLegacyStaticLibraryRow({ source: "system", metadata: {} }),
    true,
  );
  assert.equal(
    shouldShowInGalleryList({ source: "system", metadata: {} }),
    false,
  );
  assert.equal(
    shouldShowInGalleryList({
      source: "generated",
      metadata: { galleryStatus: "active", campaignIdeaKey: "idea_a" },
      seedSlug: "idea_a:email:img:01",
    }),
    true,
  );
  assert.equal(
    shouldShowInGalleryList({
      source: "generated",
      metadata: { galleryStatus: "active" },
      seedSlug: "idea_a:email:img:01",
    }),
    false,
  );
  assert.equal(
    shouldShowInGalleryList({
      source: "generated",
      metadata: { galleryStatus: "active", campaignIdeaKey: "legacy" },
      seedSlug: "legacy:email:01",
    }),
    false,
  );
  assert.equal(
    shouldShowInGalleryList({
      source: "generated",
      metadata: {
        galleryStatus: "locked",
        campaignIdeaKey: "idea_a",
      },
      seedSlug: "idea_a:email:img:01",
    }),
    false,
  );
  assert.equal(
    shouldShowInGalleryList({
      source: "generated",
      metadata: {
        galleryStatus: "locked",
        campaignIdeaKey: "idea_a",
      },
      seedSlug: "idea_a:email:img:01",
      includeLocked: true,
    }),
    true,
  );
}

function testNoStaticSeeds() {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../src/dao/library-template.ts",
  );
  const src = readFileSync(path, "utf8");
  assert.doesNotMatch(src, /ensureSystemSeeds/);
  assert.doesNotMatch(src, /library-template-seeds\.json/);
}

function testTemplateSpecs() {
  const channels = ["email", "web_push", "whatsapp", "app_push"];
  assert.equal(expectedGalleryTemplateCount(channels), 20);

  const imgIdea = templateSpecsForIdea("idea_a", 0, ["email", "web_push"]);
  assert.equal(imgIdea.length, 2);
  assert.equal(imgIdea[0].gallery_key, "idea_a:email:txt:01");
  assert.equal(imgIdea[0].has_image, false);
  assert.equal(imgIdea[0].primary_channel, "email");
  assert.equal(imgIdea[1].gallery_key, "idea_a:web_push:img:01");
  assert.equal(imgIdea[1].has_image, true);

  const txtIdea = templateSpecsForIdea("idea_b", 7, ["email"]);
  assert.equal(txtIdea[0].gallery_key, "idea_b:email:txt:01");
  assert.equal(txtIdea[0].has_image, false);

  assert.equal(ideaSortOrderHasImage(4), true);
  assert.equal(ideaSortOrderHasImage(5), false);

  const keys = galleryKeysForIdea("idea_c", 2, ["email", "app_push"]);
  assert.deepEqual(keys, ["idea_c:email:txt:01"]);
}

testLegacyHidden();
testNoStaticSeeds();
testTemplateSpecs();
console.log("gallery-metadata tests passed");
