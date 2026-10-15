/**
 * run: npx tsx src/lib/outbound-email-subject.test.ts
 */
import {
  encodeMimeHeaderValue,
  normalizeEmailSubject,
} from "./outbound-email";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const dirty = "Welcome to Worktual Ã¢Â€Â“ Overview of Our AIÃ¢Â€Â™Native Solutions";
const clean = normalizeEmailSubject(dirty);
assert(
  clean === "Welcome to Worktual - Overview of Our AI'Native Solutions" ||
    clean === "Welcome to Worktual - Overview of Our AI-Native Solutions",
  `normalize dashes/mojibake: got ${clean}`,
);
assert(!/Ã¢/.test(clean), "no mojibake left");

const fancy = normalizeEmailSubject("Hello — world… “quoted”");
assert(
  fancy === 'Hello - world... "quoted"',
  `normalize fancy: got ${fancy}`,
);

const ascii = encodeMimeHeaderValue("Hello world");
assert(ascii === "Hello world", "ascii subject unchanged");

const encoded = encodeMimeHeaderValue("Café - menu");
assert(encoded.startsWith("=?UTF-8?B?"), `rfc2047: got ${encoded}`);
// Each base64 body must be multiple of 4 chars
for (const part of encoded.split(" ")) {
  const m = part.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);
  assert(m, `encoded-word shape: ${part}`);
  assert(m![1]!.length % 4 === 0, `base64 len multiple of 4: ${m![1]!.length}`);
}

// Long non-ASCII subject must not garble when split across encoded-words
const long = encodeMimeHeaderValue("Re: Welcome to Worktual - Overview of Our Café Native Solutions and more");
const b64Parts = long.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g) ?? [];
if (b64Parts.length > 0) {
  const joined = Buffer.concat(
    b64Parts.map((p) => {
      const inner = p.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "");
      return Buffer.from(inner, "base64");
    }),
  ).toString("utf8");
  assert(joined.includes("Café"), `roundtrip: got ${joined}`);
}

console.log("outbound-email-subject.test.ts: ok");
