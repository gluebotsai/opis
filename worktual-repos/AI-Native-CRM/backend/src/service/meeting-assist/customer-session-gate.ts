/**
 * Customer-meeting gate — live sales/presales Assist only on contact-linked sessions.
 */

import { prisma } from "@/dao/db/prisma";

export async function isCustomerMeetingAssistSession(
  sessionId: string,
): Promise<boolean> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId.trim() },
    select: { contactId: true, activityId: true },
  });
  return Boolean(session?.contactId?.trim() && session?.activityId?.trim());
}
