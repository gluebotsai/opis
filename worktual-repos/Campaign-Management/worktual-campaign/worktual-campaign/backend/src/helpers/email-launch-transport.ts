/** Campaign launch mail: My Accounts mailbox only. */

import {
  isWorktualTechEmail,
  WORKTUAL_TECH_FROM_BLOCKED,
} from "./worktual-tech-from.js";

export const EMAIL_MAILBOX_NOT_READY = "email_mailbox_not_ready";

export type LaunchMailboxGate = {
  send_ready?: boolean;
  block_reason?: string | null;
  display_from?: string | null;
  sender_email?: string | null;
  oauth_account_email?: string | null;
  transport?: string | null;
};

export function isAccountsLaunchReady<
  T extends { public?: LaunchMailboxGate } | LaunchMailboxGate,
>(mailbox: T | null | undefined): mailbox is T {
  if (!mailbox || typeof mailbox !== "object") return false;
  const pub =
    "public" in mailbox && mailbox.public && typeof mailbox.public === "object"
      ? mailbox.public
      : (mailbox as LaunchMailboxGate);
  if (pub.send_ready !== true) return false;
  if (
    isWorktualTechEmail(pub.display_from) ||
    isWorktualTechEmail(pub.sender_email) ||
    isWorktualTechEmail(pub.oauth_account_email)
  ) {
    return false;
  }
  return true;
}

export function accountsLaunchFailReason(
  mailbox: { public?: LaunchMailboxGate } | LaunchMailboxGate | null | undefined,
): string {
  if (!mailbox || typeof mailbox !== "object") {
    return (
      "No My Accounts campaign email mailbox (accounts.setup_channel_configs " +
      "email + product campaign, joined to setup_email_configs)."
    );
  }
  const pub =
    "public" in mailbox && mailbox.public && typeof mailbox.public === "object"
      ? mailbox.public
      : (mailbox as LaunchMailboxGate);
  const reason = String(pub.block_reason || "").trim();
  if (reason) return reason;
  if (
    isWorktualTechEmail(pub.display_from) ||
    isWorktualTechEmail(pub.sender_email) ||
    isWorktualTechEmail(pub.oauth_account_email)
  ) {
    return WORKTUAL_TECH_FROM_BLOCKED;
  }
  return (
    "My Accounts campaign mailbox is not send-ready. " +
    "Reconnect Email in Setup. Campaign mail uses the org My Accounts mailbox only."
  );
}
