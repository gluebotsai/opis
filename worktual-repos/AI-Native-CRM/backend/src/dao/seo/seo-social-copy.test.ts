/**
 * run: npx tsx src/dao/seo/seo-social-copy.test.ts
 */
import { mergeSocialCopy } from "./seo-store";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const existing = {
  caption: "Old",
  imageDataUrl: "data:image/png;base64,abc",
  hashtags: ["crm"],
};

const merged = mergeSocialCopy(existing, { caption: "New" }) as Record<
  string,
  unknown
>;
assert(merged.caption === "New", "caption patches");
assert(merged.imageDataUrl === existing.imageDataUrl, "keeps image bytes");
assert(Array.isArray(merged.hashtags), "keeps other copy fields");

const replaced = mergeSocialCopy(existing, {
  caption: "X",
  imageDataUrl: "data:image/png;base64,zzz",
}) as Record<string, unknown>;
assert(replaced.imageDataUrl === "data:image/png;base64,zzz", "explicit image wins");

console.log("seo-social-copy.test.ts ok");
