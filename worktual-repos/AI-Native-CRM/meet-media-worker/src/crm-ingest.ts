/** Push customer transcript chunks into CRM Assist webhook. */

export async function ingestCustomerChunk(input: {
  crmBaseUrl: string;
  secret: string;
  meetingId: string;
  activityId?: string | null;
  text: string;
  speaker: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = input.crmBaseUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/webhooks/google-meet/transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": input.secret,
      },
      body: JSON.stringify({
        meetingId: input.meetingId,
        activityId: input.activityId || undefined,
        chunks: [
          {
            text: input.text,
            speaker: input.speaker,
            spokenAt: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `ingest ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "ingest failed",
    };
  }
}

export async function reportMediaStatusToCrm(input: {
  crmBaseUrl: string;
  secret: string;
  sessionId: string;
  status: string;
  error?: string | null;
  traceId?: string | null;
}): Promise<void> {
  const base = input.crmBaseUrl.replace(/\/$/, "");
  try {
    await fetch(
      `${base}/api/internal/meeting-assist/sessions/${encodeURIComponent(input.sessionId)}/media-status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": input.secret,
        },
        body: JSON.stringify({
          status: input.status,
          error: input.error || null,
          traceId: input.traceId || null,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    /* best-effort */
  }
}
