/**
 * Sent Campaign runs for one contact. Reads the Campaign API, not campaign_db.
 */

import { issueCrmAccessJwt } from "@/service/account/crm-access-jwt";
import { getServerUserId } from "@/service/account/session-cookie";
import { getCurrentUserRole } from "@/service/auth/require-role";
import {
  listPersonalisedCrmRecipients,
  listPersonalisedCrmRuns,
  type PersonalisedCrmRecipient,
  type PersonalisedCrmRun,
} from "@/service/integrations/marketing-ms";

export type Customer360Campaign = {
  runId: string;
  title: string;
  channel: string;
  status: string;
  sentAt: string | null;
};

const RUN_LIMIT = 12;
const ROW_LIMIT = 20;

function samePerson(
  recipient: PersonalisedCrmRecipient,
  contactId: string,
  email: string | null,
): boolean {
  const id = recipient.contactId?.trim();
  if (id) return id === contactId;
  const theirs = recipient.email?.trim().toLowerCase();
  const ours = email?.trim().toLowerCase();
  return Boolean(ours && theirs && ours === theirs);
}

function statusFor(channel: {
  outcome: string | null;
  opened: boolean;
  clicked: boolean;
}): string {
  if (channel.clicked) return "Clicked";
  if (channel.opened) return "Opened";
  const outcome = channel.outcome?.trim();
  if (!outcome) return "Sent";
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export function campaignsForContact(
  runs: PersonalisedCrmRun[],
  recipientsByRun: Map<string, PersonalisedCrmRecipient[]>,
  contactId: string,
  email: string | null,
): Customer360Campaign[] {
  const rows: Customer360Campaign[] = [];
  for (const run of runs) {
    const recipients = recipientsByRun.get(run.id) ?? [];
    for (const recipient of recipients) {
      if (!samePerson(recipient, contactId, email)) continue;
      const channels = recipient.channels.length
        ? recipient.channels
        : run.channels.map((channel) => ({
            channel,
            outcome: run.status,
            opened: false,
            clicked: false,
            sentAt: run.sendAt,
          }));
      for (const channel of channels) {
        rows.push({
          runId: run.id,
          title: run.title,
          channel: channel.channel,
          status: statusFor(channel),
          sentAt: channel.sentAt ?? run.sendAt,
        });
      }
    }
  }
  rows.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  return rows.slice(0, ROW_LIMIT);
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

export async function loadContactCampaigns(
  organizationId: string,
  contactId: string,
  email: string | null,
): Promise<Customer360Campaign[]> {
  if (!process.env.JWT_ACCESS_SECRET?.trim()) return [];
  const userId = await getServerUserId();
  if (!userId) return [];
  const role = await getCurrentUserRole().catch(() => null);
  if (!role) return [];
  const jwt = issueCrmAccessJwt({
    userId,
    organizationId,
    role,
  });
  if (!jwt) return [];

  const listed = await listPersonalisedCrmRuns(jwt);
  if (!listed.ok) return [];
  const runs = [...listed.data]
    .sort((a, b) => (b.sendAt ?? "").localeCompare(a.sendAt ?? ""))
    .slice(0, RUN_LIMIT);
  if (!runs.length) return [];

  const recipientLists = await mapPool(runs, 4, async (run) => {
    const result = await listPersonalisedCrmRecipients(jwt, run.id);
    return result.ok ? result.data : [];
  });
  const byRun = new Map<string, PersonalisedCrmRecipient[]>();
  runs.forEach((run, index) => {
    byRun.set(run.id, recipientLists[index] ?? []);
  });
  return campaignsForContact(runs, byRun, contactId, email);
}
