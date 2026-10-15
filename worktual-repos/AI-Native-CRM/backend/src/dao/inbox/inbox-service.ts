import type {
  ActivityType,
  EmailDirection,
  InboxFolder,
} from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { formatContactDisplayName } from "@/lib/contact-name";
import { effectiveContactType } from "@/lib/contact-lifecycle";

export type { InboxFolder };

export type InboxThreadMessage = {
  id: string;
  contactId: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
  folder: InboxFolder;
  threadId: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  emailDirection: EmailDirection | null;
  /** Auto-reply agent flagged this message as one a human must answer. */
  needsManualResponse: boolean;
};

export type InboxItem = {
  id: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactTitle: string | null;
  companyName: string | null;
  companyIndustry: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  contactType: string | null;
  leadSource: string | null;
  ownerUserId: string | null;
  type: ActivityType;
  subject: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
  /** Latest message folder (preview) */
  folder: InboxFolder;
  /** All folders that contain messages in this conversation */
  folders: InboxFolder[];
  threadId: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  emailDirection: EmailDirection | null;
  /** True when any message in the conversation is awaiting a human reply. */
  needsManualResponse: boolean;
  messageCount: number;
  messages: InboxThreadMessage[];
};

function conversationKey(row: {
  id: string;
  threadId: string | null;
  gmailThreadId?: string | null;
  providerThreadId?: string | null;
}): string {
  // Prefer provider conversation ids so replies stay one list row even when
  // CRM thread_id drifted (drafts / earlier send bugs).
  if (row.gmailThreadId?.trim()) return `g:${row.gmailThreadId.trim()}`;
  if (row.providerThreadId?.trim()) return `p:${row.providerThreadId.trim()}`;
  if (row.threadId?.trim()) return `t:${row.threadId.trim()}`;
  return `i:${row.id}`;
}

/** Strip Re:/Fwd: and mojibake so related emails can share a soft list key. */
function normalizedSubjectKey(subject: string | null | undefined): string {
  let s = (subject || "").trim().toLowerCase();
  // Repeat to handle "Re: Re: …"
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/^(re|fw|fwd)\s*:\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/Ã¢[\s\S]{0,6}/g, " ")
    .replace(/â€[^\s]*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, 96);
}

/** List-row grouping key (may differ from stored CRM thread_id). */
function listConversationKey(row: {
  id: string;
  contactId: string;
  type: string;
  subject: string;
  folder?: string | null;
  threadId: string | null;
  gmailThreadId?: string | null;
  providerThreadId?: string | null;
}): string {
  // Never soft-merge trash into live conversations — discarded drafts after
  // send would otherwise reappear as a second "Sent" bubble.
  if (row.folder === "trash") return `i:${row.id}`;

  const provider = conversationKey(row);
  if (provider.startsWith("g:") || provider.startsWith("p:")) return provider;
  if (row.type === "email") {
    const subj = normalizedSubjectKey(row.subject);
    if (subj.length >= 8) return `s:${row.contactId}:${subj}`;
  }
  return provider;
}

/** Stable CRM thread id to pass back to clients / reply APIs. */
function pickCanonicalCrmThreadId(
  msgs: Array<{
    id: string;
    threadId: string | null;
    gmailThreadId: string | null;
    providerThreadId?: string | null;
    createdAt: Date;
  }>,
): string {
  const sorted = [...msgs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const withProvider = sorted.filter(
    (m) => m.gmailThreadId || m.providerThreadId,
  );
  const pool = withProvider.length > 0 ? withProvider : sorted;
  const counts = new Map<string, number>();
  for (const m of pool) {
    const k = m.threadId || m.id;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = pool[0]?.threadId || pool[0]?.id || sorted[0]!.id;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/** Communications only — notes / meetings / tasks live on contact activity. */
const INBOX_ACTIVITY_TYPES: ActivityType[] = ["email", "sms", "call"];

export async function listThreadMessages(
  threadId: string,
  options?: { userId?: string | null },
): Promise<InboxThreadMessage[]> {
  const userId = options?.userId?.trim();
  const seed = await prisma.contactActivity.findMany({
    where: {
      OR: [{ threadId }, { id: threadId }],
      type: { in: INBOX_ACTIVITY_TYPES },
      ...(userId ? { createdByUserId: userId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const gmailIds = [
    ...new Set(
      seed
        .map((r) => r.gmailThreadId?.trim())
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const providerIds = [
    ...new Set(
      seed
        .map((r) => r.providerThreadId?.trim())
        .filter((v): v is string => Boolean(v)),
    ),
  ];

  let rows = seed;
  if (gmailIds.length > 0 || providerIds.length > 0) {
    const extra = await prisma.contactActivity.findMany({
      where: {
        type: { in: INBOX_ACTIVITY_TYPES },
        ...(userId ? { createdByUserId: userId } : {}),
        OR: [
          ...(gmailIds.length > 0
            ? [{ gmailThreadId: { in: gmailIds } }]
            : []),
          ...(providerIds.length > 0
            ? [{ providerThreadId: { in: providerIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    const byId = new Map(seed.map((r) => [r.id, r]));
    for (const r of extra) byId.set(r.id, r);
    rows = [...byId.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  // Also pull orphan emails that match contact + normalized subject.
  const emailSeed = rows.find((r) => r.type === "email");
  if (emailSeed) {
    const soft = normalizedSubjectKey(emailSeed.subject);
    if (soft.length >= 8) {
      const candidates = await prisma.contactActivity.findMany({
        where: {
          contactId: emailSeed.contactId,
          type: "email",
          ...(userId ? { createdByUserId: userId } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: 80,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const r of candidates) {
        if (normalizedSubjectKey(r.subject) === soft) byId.set(r.id, r);
      }
      rows = [...byId.values()].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
    }
  }

  const canonical = pickCanonicalCrmThreadId(rows);
  return rows.map((row) => ({
    id: row.id,
    contactId: row.contactId,
    type: row.type,
    subject: row.subject,
    body: row.body,
    dueAt: row.dueAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    folder: row.folder,
    threadId: canonical,
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    rfcMessageId: row.rfcMessageId,
    emailDirection: row.emailDirection,
    needsManualResponse: row.needsManualResponse,
  }));
}

/** One conversation, including nurture/bot mail that is not in the personal mailbox list. */
export async function getInboxItemForThread(
  threadId: string,
  options?: { userId?: string | null },
): Promise<InboxItem | null> {
  const id = threadId.trim();
  if (!id) return null;
  const messages = await listThreadMessages(id, options);
  if (messages.length === 0) return null;

  const contactId = messages[0]!.contactId;
  const { getPeopleByIds } = await import("@/dao/account/account-repository");
  const people = await getPeopleByIds([contactId]);
  const { getContactProfilesByAccountIds } = await import(
    "@/dao/contacts/contact-profile-repository"
  );
  const profiles = await getContactProfilesByAccountIds([contactId]);
  const person = people.find((row) => row.id === contactId);
  const profile = profiles.get(contactId);
  const latest = messages[messages.length - 1]!;
  const folders = [...new Set(messages.map((message) => message.folder))];
  const gmailThreadId =
    messages.map((message) => message.gmailThreadId).find((value) => Boolean(value)) ??
    null;

  return {
    id: latest.id,
    contactId,
    contactName: person
      ? formatContactDisplayName(person.firstName, person.lastName)
      : "Unknown",
    contactEmail: person?.email || null,
    contactPhone: person?.phone ?? null,
    contactTitle: person?.title ?? null,
    companyName: person?.company?.name ?? null,
    companyIndustry: person?.company?.industry ?? null,
    addressLine: person?.addressLine ?? null,
    city: person?.city ?? null,
    country: person?.country ?? null,
    contactType: effectiveContactType(person?.contactType),
    leadSource: profile?.leadSource ?? null,
    ownerUserId: profile?.ownerUserId ?? null,
    type: latest.type,
    subject: latest.subject,
    body: latest.body,
    dueAt: latest.dueAt,
    createdAt: latest.createdAt,
    folder: latest.folder,
    folders,
    threadId: latest.threadId || latest.id,
    gmailMessageId: latest.gmailMessageId,
    gmailThreadId,
    rfcMessageId: latest.rfcMessageId,
    emailDirection: latest.emailDirection,
    needsManualResponse: messages.some((message) => message.needsManualResponse),
    messageCount: messages.length,
    messages,
  };
}

/**
 * One list row per conversation (latest message).
 * Always scoped to the signed-in user's mailbox (`createdByUserId`).
 * Excludes CRM timeline noise (notes, meetings, tasks).
 */
export async function listInboxItems(options?: {
  limit?: number;
  /** Required — inbox is personal, never org-wide. */
  userId: string;
}): Promise<InboxItem[]> {
  const limit = Math.min(options?.limit ?? 80, 100);
  const userId = options?.userId?.trim();
  if (!userId) return [];

  const rows = await prisma.contactActivity.findMany({
    where: {
      createdByUserId: userId,
      type: { in: INBOX_ACTIVITY_TYPES },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit * 3, 300),
  });

  if (rows.length === 0) return [];

  const byThread = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = listConversationKey(row);
    const list = byThread.get(key) ?? [];
    list.push(row);
    byThread.set(key, list);
  }

  // Soft-key groups (orphan drafts / missing gmail_thread_id) stay separate from
  // g:/p: groups even when they are the same conversation. Merge them when the
  // contact + normalized subject match a provider-backed group.
  const softSubjectOf = (msgs: typeof rows): string | null => {
    const email = msgs.find((m) => m.type === "email");
    if (!email) return null;
    const subj = normalizedSubjectKey(email.subject);
    if (subj.length < 8) return null;
    return `${email.contactId}:${subj}`;
  };

  const providerGroups = [...byThread.entries()].filter(
    ([k]) => k.startsWith("g:") || k.startsWith("p:"),
  );
  const softToProvider = new Map<string, string>();
  for (const [pkey, msgs] of providerGroups) {
    const soft = softSubjectOf(msgs);
    if (soft && !softToProvider.has(soft)) softToProvider.set(soft, pkey);
  }
  for (const [key, msgs] of [...byThread.entries()]) {
    if (!key.startsWith("s:")) continue;
    const soft = softSubjectOf(msgs);
    if (!soft) continue;
    const target = softToProvider.get(soft);
    if (!target || target === key) continue;
    const dest = byThread.get(target) ?? [];
    dest.push(...msgs);
    byThread.set(target, dest);
    byThread.delete(key);
  }

  const heads = [...byThread.values()]
    .map((msgs) => {
      const sorted = [...msgs].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return { latest: sorted[0], all: msgs };
    })
    .sort(
      (a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime(),
    )
    .slice(0, limit);

  const contactIds = [...new Set(heads.map((h) => h.latest.contactId))];
  const { getPeopleByIds } = await import("@/dao/account/account-repository");
  const people = await getPeopleByIds(contactIds);
  const { getContactProfilesByAccountIds } = await import(
    "@/dao/contacts/contact-profile-repository"
  );
  const profiles = await getContactProfilesByAccountIds(contactIds);

  const byId = new Map(people.map((p) => [p.id, p]));

  return heads.map(({ latest: row, all }) => {
    const person = byId.get(row.contactId);
    const profile = profiles.get(row.contactId);
    const folders = [...new Set(all.map((m) => m.folder))];
    const canonicalThreadId = pickCanonicalCrmThreadId(all);
    const messages: InboxThreadMessage[] = [...all]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => ({
        id: m.id,
        contactId: m.contactId,
        type: m.type,
        subject: m.subject,
        body: m.body,
        dueAt: m.dueAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        folder: m.folder,
        threadId: canonicalThreadId,
        gmailMessageId: m.gmailMessageId,
        gmailThreadId: m.gmailThreadId,
        rfcMessageId: m.rfcMessageId,
        emailDirection: m.emailDirection,
        needsManualResponse: m.needsManualResponse,
      }));

    const gmailThreadId =
      all.map((m) => m.gmailThreadId).find((v) => Boolean(v)) ?? null;

    return {
      id: row.id,
      contactId: row.contactId,
      contactName: person
        ? formatContactDisplayName(person.firstName, person.lastName)
        : "Unknown",
      contactEmail: person?.email || null,
      contactPhone: person?.phone ?? null,
      contactTitle: person?.title ?? null,
      companyName: person?.company?.name ?? null,
      companyIndustry: person?.company?.industry ?? null,
      addressLine: person?.addressLine ?? null,
      city: person?.city ?? null,
      country: person?.country ?? null,
      contactType: effectiveContactType(person?.contactType),
      leadSource: profile?.leadSource ?? null,
      ownerUserId: profile?.ownerUserId ?? null,
      type: row.type,
      subject: row.subject,
      body: row.body,
      dueAt: row.dueAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      folder: row.folder,
      folders,
      threadId: canonicalThreadId,
      gmailMessageId: row.gmailMessageId,
      gmailThreadId,
      rfcMessageId: row.rfcMessageId,
      emailDirection: row.emailDirection,
      needsManualResponse: all.some((m) => m.needsManualResponse),
      messageCount: all.length,
      messages,
    };
  });
}

/** Drop "Manual response needed" after a human replies on the same thread. */
export async function clearManualResponseNeededForThread(input: {
  contactId: string;
  threadId?: string | null;
  gmailThreadId?: string | null;
  providerThreadId?: string | null;
}): Promise<void> {
  const crmThread = input.threadId?.trim() || null;
  const gmailThread = input.gmailThreadId?.trim() || null;
  const providerThread = input.providerThreadId?.trim() || null;
  if (!crmThread && !gmailThread && !providerThread) return;

  try {
    await prisma.$executeRawUnsafe(
      `
      UPDATE contact_activities
      SET needs_manual_response = false, updated_at = NOW()
      WHERE contact_id::text = $1::text
        AND needs_manual_response = true
        AND (
          ($2::text IS NOT NULL AND (thread_id = $2 OR id = $2))
          OR ($3::text IS NOT NULL AND (
            gmail_thread_id = $3 OR provider_thread_id = $3
          ))
          OR ($4::text IS NOT NULL AND (
            gmail_thread_id = $4 OR provider_thread_id = $4
          ))
        )
      `,
      input.contactId,
      crmThread,
      gmailThread,
      providerThread,
    );
  } catch {
    // best-effort — badge may linger until next successful clear
  }
}
