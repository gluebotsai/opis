/** Shared App Push token / platform helpers (campaign + Configuration test). */

/** FCM/APNs token from register body (app field pushNotificationId → endpoint). */
export function readAppPushDeviceTokenFromBody(
  body: Record<string, unknown>,
): string {
  const pick = (key: string) => {
    const v = body[key];
    return typeof v === "string" ? v.trim() : "";
  };
  return (
    pick("endpoint") ||
    pick("token") ||
    pick("pushNotificationId") ||
    pick("push_notification_id") ||
    ""
  );
}

export function isStubPushDestination(destination: string): boolean {
  return String(destination || "")
    .trim()
    .toLowerCase()
    .startsWith("stub://");
}

/**
 * FCM registration tokens are long and typically contain a colon
 * (e.g. InstanceID:checksum). Reject URLs and stub://.
 */
export function looksLikeFcmToken(token: string): boolean {
  const t = String(token || "").trim();
  if (!t || isStubPushDestination(t) || /^https?:\/\//i.test(t)) return false;
  return t.length >= 80 && t.includes(":");
}

/**
 * Campaign + test: FCM-looking tokens labeled web/missing → android.
 * iOS / APNs labels stay iOS.
 */
export function normalizeAppPushPlatform(
  platform: string | null | undefined,
  destination: string,
): string | null {
  const dest = String(destination || "").trim();
  const p = String(platform || "")
    .trim()
    .toLowerCase();
  if (p.includes("ios") || p.includes("apns") || p === "iphone") return "ios";
  if (p.includes("android") || p.includes("fcm")) return "android";
  if (looksLikeFcmToken(dest)) return "android";
  return p || null;
}
