/**
 * Accounts-only launch gate (no test runner required).
 * Run: npx tsx scripts/test-email-launch-transport.ts
 */
import assert from "node:assert/strict";
import {
  EMAIL_MAILBOX_NOT_READY,
  accountsLaunchFailReason,
  isAccountsLaunchReady,
} from "../src/helpers/email-launch-transport.js";

assert.equal(EMAIL_MAILBOX_NOT_READY, "email_mailbox_not_ready");
assert.equal(isAccountsLaunchReady(null), false);
assert.equal(isAccountsLaunchReady({ public: { send_ready: true } }), true);
assert.equal(isAccountsLaunchReady({ send_ready: true }), true);
assert.equal(
  isAccountsLaunchReady({
    public: { send_ready: true, display_from: "noreply@worktual.tech" },
  }),
  false,
);
assert.equal(
  isAccountsLaunchReady({
    public: {
      send_ready: true,
      display_from: "shop@example.com",
      oauth_account_email: "noreply@worktual.tech",
    },
  }),
  false,
);
assert.equal(isAccountsLaunchReady({ public: { send_ready: false } }), false);
assert.match(
  accountsLaunchFailReason(null),
  /setup_channel_configs/,
);
assert.equal(
  accountsLaunchFailReason({
    public: { send_ready: false, block_reason: "reconnect Google" },
  }),
  "reconnect Google",
);
console.log("email-launch-transport: ok");
