/**
 * Lightweight unit checks (run: npx tsx src/lib/coworker/assistant-message-html.test.ts)
 */
import assert from "node:assert/strict";
import { plainSpeechToChatHtml } from "./assistant-message-html";
import { sanitizeAssistantTextForUser } from "./sanitize-assistant-text";

const recap = [
  "Perfect — that's everything I need for Pooja. Here's what I have:",
  "**Name:** Pooja",
  "**Email:** pooja09090@gmail.com",
  "**Title:** Sales Manager",
  "**Company:** Accenture",
  "**Location:** Chennai, India",
  "",
  "Shall I save her as a new contact?",
].join("\n");

const cleaned = sanitizeAssistantTextForUser(recap);
assert.equal(cleaned.includes("**"), false);
assert.match(cleaned, /Name: Pooja/);
assert.match(cleaned, /Email: pooja09090@gmail.com/);

const html = plainSpeechToChatHtml(recap);
assert.equal(html.includes("**"), false);
assert.match(html, /<strong>Name<\/strong>/);
assert.match(html, /pooja09090@gmail.com/);
assert.match(html, /<strong>Location<\/strong>/);
assert.match(html, /Chennai, India/);

const alreadyBroken = plainSpeechToChatHtml(
  "Perfect — that's everything I need for Pooja. Here's what I have:\nName:** Pooja\nEmail:** pooja09090@gmail.com\nTitle:** Sales Manager\nCompany:** Accenture\nLocation:** Chennai, India",
);
assert.equal(alreadyBroken.includes("**"), false);
assert.match(alreadyBroken, /<strong>Name<\/strong>/);
assert.match(alreadyBroken, /<strong>Email<\/strong>/);

assert.equal(
  sanitizeAssistantTextForUser("* Added TCS as the company name."),
  "Added TCS as the company name.",
);
assert.equal(
  sanitizeAssistantTextForUser("- Got it — phone added."),
  "Got it — phone added.",
);

console.log("assistant-message-html.test.ts ok");
