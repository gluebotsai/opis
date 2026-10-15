import type { CoreSipSession } from "./sip-session.js";

const CC_CORE_URL = (process.env.CC_CORE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

export async function fetchCoreSipSession(
  organizationId: string,
  userId: string,
): Promise<{ status: number; session: CoreSipSession | null; message?: string }> {
  const url = new URL("/internal/v1/sip-session", CC_CORE_URL);
  url.searchParams.set("userId", userId);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-tenant-id": organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }

  const response = await fetch(url, { headers });
  if (response.status === 404) {
    return { status: 404, session: null, message: "SIP credentials are not configured for this user" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return {
      status: response.status,
      session: null,
      message: body.message ?? "Unable to load SIP session",
    };
  }

  const session = (await response.json()) as CoreSipSession;
  return { status: 200, session };
}

export async function restoreCoreSipSession(
  organizationId: string,
  userId: string,
): Promise<{ status: number; ok: boolean; message?: string }> {
  const url = new URL("/internal/v1/sip-session/restore", CC_CORE_URL);
  url.searchParams.set("userId", userId);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-tenant-id": organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }

  const response = await fetch(url, { method: "POST", headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return {
      status: response.status,
      ok: false,
      message: body.message ?? "Unable to restore SIP registrar payload",
    };
  }
  return { status: 200, ok: true };
}
