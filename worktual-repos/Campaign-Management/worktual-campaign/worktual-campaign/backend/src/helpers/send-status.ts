/** Local / demo provider ids — must not count as real delivery. */
export function isStubProviderMessageId(id?: string | null): boolean {
  const s = String(id || "").trim().toLowerCase();
  return s.startsWith("stub-") || s.startsWith("stub://");
}

export function recipientDeliveryOutcome(input: {
  status?: string | null;
  providerMessageId?: string | null;
}): "sent" | "stub" | "failed" | "skipped" | "pending" {
  const st = String(input.status || "").trim().toLowerCase();
  if (st === "failed" || st === "cancelled") return "failed";
  if (st === "skipped") return "skipped";
  if (st === "stub" || st === "stub_sent") return "stub";
  if (
    st === "pending" ||
    st === "queued" ||
    st === "queued_accounts" ||
    st === "sending" ||
    !st
  ) {
    return "pending";
  }
  if (st === "sent" || st === "delivered") {
    return isStubProviderMessageId(input.providerMessageId) ? "stub" : "sent";
  }
  return isStubProviderMessageId(input.providerMessageId) ? "stub" : "pending";
}
