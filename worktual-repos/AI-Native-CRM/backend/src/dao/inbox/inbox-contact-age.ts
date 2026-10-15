import { prisma } from "@/dao/db/prisma";

/** CRM profile birth time — inbox sync must not attach older Gmail mail. */
export async function getContactProfileCreatedAt(
  contactId: string,
  organizationId: string,
): Promise<Date | null> {
  const id = contactId.trim();
  const orgId = organizationId.trim();
  if (!id || !orgId) return null;

  const profile = await prisma.contactProfile.findFirst({
    where: { accountContactId: id, organizationId: orgId },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return profile?.createdAt ?? null;
}

/** Skip Gmail rows that predate the current CRM contact record (re-import after delete+recreate). */
export function isGmailMessageBeforeContactCreation(
  messageDate: Date,
  contactCreatedAt: Date | null,
  graceMs = 60_000,
): boolean {
  if (!contactCreatedAt) return false;
  return messageDate.getTime() < contactCreatedAt.getTime() - graceMs;
}
