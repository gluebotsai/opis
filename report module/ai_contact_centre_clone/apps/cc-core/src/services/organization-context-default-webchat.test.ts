import assert from "node:assert/strict";
import test from "node:test";

import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { resolveDefaultActiveWebchatId } from "./organization-context.js";

test("resolveDefaultActiveWebchatId returns first active webchat for org", async () => {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const resolved = await resolveDefaultActiveWebchatId(ccPrisma, "1003");
  assert.ok(resolved);
  assert.match(resolved.webchatId, /^wc_[a-f0-9]{32}$/i);
  assert.equal(resolved.title, "Lola");
  assert.ok(resolved.channelConfigId);
});

test("resolveDefaultActiveWebchatId returns null when org has no active webchat", async () => {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const resolved = await resolveDefaultActiveWebchatId(ccPrisma, "999999999");
  assert.equal(resolved, null);
});

test.after(async () => {
  await ccPrisma.$disconnect();
});
