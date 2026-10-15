/**
 * Fire-and-forget entry point for signal producers (activities, inbox sync,
 * scoring, nurture). The job module is imported lazily so producers that the
 * lifecycle context itself reads from — scoring in particular — do not form a
 * static import cycle.
 */

export function triggerLeadLifecycle(input: {
  contactId: string;
  organizationId?: string | null;
  triggerReason?: string;
  processImmediately?: boolean;
}): void {
  const contactId = input.contactId?.trim();
  if (!contactId) return;

  void (async () => {
    const mod = await import("@/service/ai/lead-lifecycle-job");
    await mod.enqueueLeadLifecycle({
      contactId,
      organizationId: input.organizationId ?? null,
      triggerReason: input.triggerReason,
      processImmediately: input.processImmediately ?? true,
    });
  })().catch((err) => {
    console.error("lead lifecycle trigger failed", contactId, err);
  });
}
