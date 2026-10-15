/**
 * run: npx tsx src/service/meeting-assist/persona.test.ts
 */
import assert from "node:assert/strict";
import { normalizeRole } from "@/service/auth/rbac";
import { assistPersonaForRole } from "./persona";

assert.equal(assistPersonaForRole("presales"), "presales");
assert.equal(assistPersonaForRole("sales_rep"), "sales");
assert.equal(assistPersonaForRole("sales_manager"), "sales");
assert.equal(assistPersonaForRole("admin"), "sales");
assert.equal(assistPersonaForRole("finance"), null);
assert.equal(assistPersonaForRole("marketing"), null);
assert.equal(assistPersonaForRole(normalizeRole("pre-sales")), "presales");

console.log("persona.test.ts ok");
