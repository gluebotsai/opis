/** Shared config for the external meeting-service (Vexa notetaker). */

export function meetingServiceBaseUrl(): string {
  return (
    process.env.MEETING_SERVICE_URL?.trim() ||
    process.env.MEETING_SERVICE_BASE_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}

export function meetingServiceJwtSecret(): string {
  return (
    process.env.CRM_SERVICE_JWT_SECRET?.trim() ||
    process.env.MEETING_SERVICE_JWT_SECRET?.trim() ||
    ""
  );
}

export function meetingServiceWebhookSecret(): string {
  return (
    process.env.MEETING_SERVICE_WEBHOOK_SECRET?.trim() ||
    process.env.WEBHOOK_SECRET?.trim() ||
    ""
  );
}

export function meetingServiceBotApiKey(): string {
  return (
    process.env.CRM_BOT_API_KEY?.trim() ||
    process.env.MEETING_SERVICE_CRM_BOT_KEY?.trim() ||
    ""
  );
}

export function meetingServiceUsersApiKey(): string {
  return (
    process.env.CRM_USERS_API_KEY?.trim() ||
    meetingServiceBotApiKey()
  );
}

export function isMeetingServiceConfigured(): boolean {
  return Boolean(meetingServiceBaseUrl() && meetingServiceJwtSecret());
}

export function notetakerProvider(): "vexa" | "recall" {
  const raw = (process.env.NOTETAKER_PROVIDER || "").trim().toLowerCase();
  if (raw === "recall") return "recall";
  if (isMeetingServiceConfigured()) return "vexa";
  return "recall";
}

export function meetingServiceBotDisplayName(): string {
  return (
    process.env.MEETING_CAPTURE_BOT_DISPLAY_NAME?.trim() ||
    process.env.MEETING_BOT_DISPLAY_NAME?.trim() ||
    "Worktual Notetaker"
  );
}

function normalizePublicOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

/** CRM SPA origins where Path B Meet add-on is served (production + configured dev). */
export function crmSpaPublicOrigins(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [
    process.env.MEETING_SERVICE_PUBLIC_URL,
    process.env.MEETING_SERVICE_ADDON_PUBLIC_URL,
    process.env.FRONTEND_ORIGIN,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VITE_PUBLIC_APP_URL,
  ]) {
    const o = normalizePublicOrigin(raw || "");
    if (o && !seen.has(o)) {
      seen.add(o);
      out.push(o);
    }
  }
  return out;
}

/** Browser Origin header allowed for Meet iframe SSE / credentialed calls. */
export function isMeetAssistBrowserOrigin(origin: string): boolean {
  const trimmed = origin.trim();
  if (!trimmed) return false;
  const norm = normalizePublicOrigin(trimmed);
  if (crmSpaPublicOrigins().some((o) => o === norm)) return true;
  return (
    /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(norm) ||
    /^https:\/\/[a-z0-9-]+\.ngrok-free\.(dev|app)$/i.test(norm) ||
    /^http:\/\/(localhost|127\.0\.0\.1):5173$/i.test(norm) ||
    /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:5173$/i.test(norm)
  );
}

/** Public HTTPS origin for Meet Assist add-on (CRM SPA — same as deployment.json host). */
export function meetingServicePublicUrl(): string {
  const raw =
    process.env.MEETING_SERVICE_PUBLIC_URL?.trim() ||
    process.env.MEETING_SERVICE_ADDON_PUBLIC_URL?.trim() ||
    process.env.FRONTEND_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "";
  return raw.replace(/\/$/, "");
}

export function vexaNotetakerAutoDispatch(): boolean {
  return notetakerProvider() === "vexa" && isMeetingServiceConfigured();
}
