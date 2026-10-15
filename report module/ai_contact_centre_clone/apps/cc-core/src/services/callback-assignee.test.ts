import assert from "node:assert/strict";
import test from "node:test";

import { contactCenterRoleIsAdmin } from "./callback-assignee.js";

test("admin roles cannot receive a callback", () => {
  assert.equal(contactCenterRoleIsAdmin("Admin"), true);
  assert.equal(contactCenterRoleIsAdmin("administrator"), true);
  assert.equal(contactCenterRoleIsAdmin("Supervisor"), true);
  assert.equal(contactCenterRoleIsAdmin("Manager"), true);
});

test("agent roles can receive a callback", () => {
  assert.equal(contactCenterRoleIsAdmin("Agent"), false);
  assert.equal(contactCenterRoleIsAdmin("agent"), false);
  assert.equal(contactCenterRoleIsAdmin(null), false);
});
