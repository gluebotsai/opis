/** Default live-offer ringing timeout (seconds) for chat/social/call channels. */
export const DEFAULT_LIVE_OFFER_TIMEOUT_SECONDS = Number.parseInt(
  process.env.OFFER_TIMEOUT_SECONDS ??
    process.env.DEFAULT_LIVE_OFFER_TIMEOUT_SECONDS ??
    "20",
  10,
);

export function resolveLiveOfferTimeoutSeconds(policyValue: number | null | undefined): number {
  if (typeof policyValue === "number" && Number.isFinite(policyValue) && policyValue > 0) {
    return policyValue;
  }
  return DEFAULT_LIVE_OFFER_TIMEOUT_SECONDS;
}
