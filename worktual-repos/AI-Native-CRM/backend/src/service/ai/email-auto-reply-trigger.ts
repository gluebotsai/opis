/**
 * Entry point for inbound mail sync → auto-reply.
 * Prefer awaiting this from sync so the job row is always persisted before the
 * request ends (fire-and-forget often dies in Next.js before upsert runs).
 */

export async function triggerEmailAutoReply(input: {
  activityId: string;
  contactId: string;
  mailboxUserId?: string | null;
  organizationId?: string | null;
  /** Default false from sync; cron / batch drain runs the agent. */
  processImmediately?: boolean;
}): Promise<void> {
  const activityId = input.activityId?.trim();
  if (!activityId) return;

  try {
    const mod = await import("@/service/ai/email-auto-reply-job");
    await mod.enqueueEmailAutoReply({
      activityId,
      contactId: input.contactId,
      mailboxUserId: input.mailboxUserId ?? null,
      organizationId: input.organizationId ?? null,
      processImmediately: input.processImmediately ?? false,
    });
  } catch (err) {
    console.error("email auto-reply trigger failed", activityId, err);
  }
}
