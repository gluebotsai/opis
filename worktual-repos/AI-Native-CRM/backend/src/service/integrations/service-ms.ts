/**
 * Service is a separate microservice with its own database.
 * CRM must not own tickets as system-of-record — only emit handoff events.
 *
 * Env:
 *   SERVICE_MS_URL   — base URL, e.g. https://service.internal
 *   SERVICE_MS_TOKEN — optional bearer token
 */

export type ServiceOnboardingPayload = {
  organizationId: string;
  companyId: string;
  dealId: string;
  contactId: string | null;
  subject: string;
  amount?: string | null;
};

export function isServiceMsConfigured(): boolean {
  return Boolean(process.env.SERVICE_MS_URL?.trim());
}

export async function requestServiceOnboarding(
  payload: ServiceOnboardingPayload,
): Promise<{ ok: boolean; externalId?: string; skipped?: boolean; error?: string }> {
  const base = process.env.SERVICE_MS_URL?.trim();
  if (!base) {
    return { ok: true, skipped: true };
  }

  const url = `${base.replace(/\/$/, "")}/api/v1/tickets/onboarding`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.SERVICE_MS_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("service ms onboarding failed", res.status, text);
      return { ok: false, error: `Service MS HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, externalId: data.id };
  } catch (err) {
    console.error("service ms onboarding error", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Service MS unreachable",
    };
  }
}

/** List tickets from Service MS (read-through; never from crm_qa). */
export async function listServiceTicketsFromMs(organizationId: string) {
  const base = process.env.SERVICE_MS_URL?.trim();
  if (!base) return { configured: false as const, items: [] as never[] };

  const url = new URL(`${base.replace(/\/$/, "")}/api/v1/tickets`);
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("limit", "50");

  const headers: Record<string, string> = {};
  const token = process.env.SERVICE_MS_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Service MS list failed (${res.status})`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      subject: string;
      status: string;
      companyName?: string | null;
      dealId?: string | null;
      createdAt?: string;
    }>;
  };
  return { configured: true as const, items: data.items ?? [] };
}
