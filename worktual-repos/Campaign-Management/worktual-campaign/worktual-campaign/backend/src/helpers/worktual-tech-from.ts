/** @worktual.tech From addresses are not valid campaign send identities. */

const BLOCKED_DOMAIN = "worktual.tech";

export function isWorktualTechDomain(domain: string | null | undefined): boolean {
  const host = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return host === BLOCKED_DOMAIN;
}

export function isWorktualTechEmail(email: string | null | undefined): boolean {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 1) return false;
  return isWorktualTechDomain(raw.slice(at + 1));
}

export const WORKTUAL_TECH_FROM_BLOCKED =
  "This mailbox cannot be used for campaign send. Connect a Google, Microsoft, or SMTP mailbox in Setup.";
