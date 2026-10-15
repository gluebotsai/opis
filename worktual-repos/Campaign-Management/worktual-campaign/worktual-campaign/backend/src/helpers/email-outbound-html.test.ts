import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compiledHtmlHasEditorArtifacts,
  sanitizeCompiledHtmlForStorageAndSend,
  sanitizeEmailTemplateFields,
} from "./email-outbound-html.js";

describe("sanitizeCompiledHtmlForStorageAndSend", () => {
  it("removes base href and contenteditable", () => {
    const dirty = `<!DOCTYPE html><html><head><base href="https://rebuild-campaign.worktual.com/"></head>
<body contenteditable="true"><p>Hello</p></body></html>`;
    const clean = sanitizeCompiledHtmlForStorageAndSend(dirty);
    assert.equal(compiledHtmlHasEditorArtifacts(clean), false);
    assert.match(clean, /Hello/);
    assert.doesNotMatch(clean, /<base\b/i);
    assert.doesNotMatch(clean, /contenteditable/i);
  });

  it("fixes invalid slash CSS comments in style blocks", () => {
    const dirty = `<style>.x { color: #7c3aed; / tint / }</style><p>Hi</p>`;
    const clean = sanitizeCompiledHtmlForStorageAndSend(dirty);
    assert.match(clean, /\/\*\s*tint\s*\*\//);
    assert.doesNotMatch(clean, /; \/ tint \//);
  });

  it("normalizes preview unsubscribe href", () => {
    const dirty = `<a href="#unsubscribe">Unsubscribe</a>`;
    const clean = sanitizeCompiledHtmlForStorageAndSend(dirty);
    assert.match(clean, /\{\{unsubscribe_url\}\}/);
  });

  it("sanitizes variant fields", () => {
    const fields = sanitizeEmailTemplateFields({
      compiled_html: '<base href="x"><body contenteditable="true">A</body>',
      variant_a: { compiled_html: '<base href="y">' },
    });
    assert.doesNotMatch(String(fields.compiled_html), /<base/i);
    const variantA = fields.variant_a as Record<string, unknown> | undefined;
    assert.doesNotMatch(String(variantA?.compiled_html ?? ""), /<base/i);
  });
});
