/**
 * Canonical CRM thread_id for email activities on a contact.
 * Gmail sometimes splits replies into new provider threads; we unify by
 * contact + normalized subject (and reuse nurture outbound thread when present).
 */

import { prisma } from "@/dao/db/prisma";

export function normalizeEmailSubject(subject: string): string {
  return subject.replace(/^(re|fwd):\s*/gi, "").trim().toLowerCase();
}

type ThreadRow = {
  id: string;
  thread_id: string | null;
  subject: string | null;
};

/**
 * Resolve the CRM thread id to attach a new email activity to.
 * Returns null when no prior thread exists (caller may use activity id).
 */
export async function resolveCanonicalEmailThreadForContact(
  contactId: string,
  subject: string,
  gmailThreadId: string | null,
): Promise<string | null> {
  if (gmailThreadId) {
    const sameGmail = await prisma.contactActivity.findFirst({
      where: { contactId, gmailThreadId },
      orderBy: { createdAt: "asc" },
      select: { threadId: true, id: true },
    });
    if (sameGmail?.threadId) return sameGmail.threadId;
    if (sameGmail) return sameGmail.id;
  }

  const stem = normalizeEmailSubject(subject);
  if (stem) {
    const related = await prisma.$queryRawUnsafe<ThreadRow[]>(
      `
      SELECT id, thread_id, subject
      FROM contact_activities
      WHERE contact_id = $1::text
        AND type = 'email'
      ORDER BY created_at ASC
      `,
      contactId,
    );
    for (const row of related) {
      if (normalizeEmailSubject(row.subject ?? "") !== stem) continue;
      if (row.thread_id) return row.thread_id;
    }
    for (const row of related) {
      if (normalizeEmailSubject(row.subject ?? "") === stem) {
        return row.thread_id ?? row.id;
      }
    }
  }

  const nurture = await prisma.contactActivity.findFirst({
    where: {
      contactId,
      type: "email",
      emailDirection: "outbound",
    },
    orderBy: { createdAt: "desc" },
    select: { threadId: true, id: true },
  });
  if (nurture?.threadId) return nurture.threadId;
  if (nurture) return nurture.id;

  return gmailThreadId;
}

/** Align all same-subject email rows on a contact to one CRM thread id. */
export async function backfillContactEmailThread(
  contactId: string,
  subject: string,
  canonicalThreadId: string,
): Promise<void> {
  const stem = normalizeEmailSubject(subject);
  if (!stem || !canonicalThreadId) return;

  const rows = await prisma.$queryRawUnsafe<ThreadRow[]>(
    `
    SELECT id, thread_id, subject
    FROM contact_activities
    WHERE contact_id = $1::text
      AND type = 'email'
    `,
    contactId,
  );

  const ids = rows
    .filter((r) => normalizeEmailSubject(r.subject ?? "") === stem)
    .map((r) => r.id);
  if (ids.length === 0) return;

  await prisma.$executeRawUnsafe(
    `
    UPDATE contact_activities
    SET thread_id = $1, updated_at = NOW()
    WHERE id = ANY($2::text[])
      AND (thread_id IS DISTINCT FROM $1)
    `,
    canonicalThreadId,
    ids,
  );
}
