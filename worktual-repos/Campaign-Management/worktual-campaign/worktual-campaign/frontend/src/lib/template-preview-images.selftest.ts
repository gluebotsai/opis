/**
 * Run: npx tsx --tsconfig tsconfig.json src/lib/template-preview-images.selftest.ts
 */
import {
  injectSrcDocBaseHref,
  normalizeTemplateMediaUrl,
  rewriteHtmlMediaUrlsForPreview,
} from "./template-preview-images";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const publicMedia =
  "https://rebuild-campaign-api.worktual.com/api/media/ba9663ca-b303-431e-a69d-6e0c316e9620";
const lanMedia = "http://192.168.13.91:3001/api/media/ba9663ca-b303-431e-a69d-6e0c316e9620";

assert(
  normalizeTemplateMediaUrl(publicMedia) === publicMedia,
  "public rebuild media stays absolute for srcDoc",
);
assert(
  normalizeTemplateMediaUrl(lanMedia) ===
    "/api/media/ba9663ca-b303-431e-a69d-6e0c316e9620",
  "LAN media still rewrites to same-origin for the SPA",
);

const html = `<html><head></head><body><img src="${publicMedia}" alt=""></body></html>`;
const rewritten = rewriteHtmlMediaUrlsForPreview(html);
assert(
  rewritten.includes(publicMedia),
  "preview HTML keeps the public media host",
);
assert(
  !rewritten.includes('src="/api/media/ba9663ca-b303-431e-a69d-6e0c316e9620"'),
  "preview HTML must not collapse public media to a relative src",
);

const withBase = injectSrcDocBaseHref(
  '<html><head></head><body><img src="/api/media/x"></body></html>',
  "http://192.168.13.91:5173",
);
assert(
  withBase.includes('<base href="http://192.168.13.91:5173/">'),
  "srcDoc preview injects a base href so relative /api/media loads",
);

console.log("template-preview-images.selftest ok");
