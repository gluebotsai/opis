/**
 * Send one campaign email through the My Accounts mailbox (same path as launch).
 * Does not queue a batch — live ESP workers cannot steal this send.
 *
 *   npx tsx scripts/send-accounts-mailbox-test.ts --org 1012 --to you@example.com
 */
import { readFileSync } from "node:fs";
import { loadAccountsMailboxForSendDao } from "../src/dao/accounts-email-mailbox.js";
import { sendAccountsMailboxCampaignEmail } from "../src/services/accounts-email-send.js";
import {
  accountsLaunchFailReason,
  isAccountsLaunchReady,
} from "../src/helpers/email-launch-transport.js";
import type { CampaignSessionUser } from "../src/types/auth.js";
import { accountPool } from "../src/plugins/account-pool.js";

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return fallback;
}

async function main() {
  const organizationId = arg("org", process.env.CAMPAIGN_ORG_ID || "");
  const to = arg("to", process.env.CAMPAIGN_TEST_TO || "").toLowerCase();
  const subject = arg("subject", "Campaign launch mailbox check");
  const htmlFile = arg("html-file", "");
  if (!organizationId) {
    throw new Error("Pass --org <accounts organization id>");
  }
  if (!to || !to.includes("@")) {
    throw new Error("Pass --to recipient@domain");
  }
  const session = {
    id: "00000000-0000-4000-8000-000000000099",
    organizationId,
    branchId: "0",
    email: "worker@local",
    name: "Email worker",
    role: "system",
    initials: "EW",
    orgName: "system",
    mode: "b2b",
    industry: "generic-b2b",
    businessType: "b2b",
    industryType: null,
  } as CampaignSessionUser;

  const mailbox = await loadAccountsMailboxForSendDao(session);
  if (!isAccountsLaunchReady(mailbox) || !mailbox) {
    throw new Error(accountsLaunchFailReason(mailbox));
  }
  const html = htmlFile
    ? readFileSync(htmlFile, "utf8")
    : `<p>Sent via My Accounts mailbox <code>${mailbox.public.display_from}</code>.</p>`;
  const result = await sendAccountsMailboxCampaignEmail(
    mailbox,
    mailbox.public,
    {
      to,
      subject,
      html,
    },
  );
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await accountPool.end().catch(() => undefined);
  });
