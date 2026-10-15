/**
 * run: npx tsx src/service/sales/commercial-document-fill.test.ts
 */

import assert from "node:assert/strict";
import { pageImagesFromTemplateAssets } from "./commercial-document-fill";

const fromPages = pageImagesFromTemplateAssets([
  { id: "page-1", kind: "image", mime: "image/png", dataBase64: "x".repeat(64) },
  { id: "page-2", kind: "image", mime: "image/png", dataBase64: "y".repeat(64) },
]);
assert.equal(fromPages.length, 2);
assert.equal(fromPages[0]?.page, 1);

const nested = pageImagesFromTemplateAssets({
  pageImages: [{ page: 3, mime: "image/png", dataBase64: "z".repeat(64) }],
});
assert.equal(nested.length, 1);
assert.equal(nested[0]?.page, 3);

console.log("commercial-document-fill.test.ts ok");
