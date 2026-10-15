/** Meet REST helpers for Media API signaling. */

export async function connectActiveConference(input: {
  accessToken: string;
  meetCode: string;
  offerSdp: string;
}): Promise<{ answer: string; traceId?: string }> {
  const space = encodeURIComponent(input.meetCode.trim());
  const res = await fetch(
    `https://meet.googleapis.com/v2beta/spaces/${space}:connectActiveConference`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ offer: input.offerSdp }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    let detail = body.slice(0, 500);
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; status?: string };
      };
      detail = parsed.error?.message || parsed.error?.status || detail;
    } catch {
      /* keep */
    }
    throw new Error(`connectActiveConference failed (${res.status}): ${detail}`);
  }
  const data = JSON.parse(body) as { answer?: string; traceId?: string };
  if (!data.answer) throw new Error("connectActiveConference returned no SDP answer");
  return { answer: data.answer, traceId: data.traceId };
}

export async function getMeetSpace(input: {
  accessToken: string;
  meetCode: string;
}): Promise<{ name: string; meetingUri?: string } | null> {
  const space = encodeURIComponent(input.meetCode.trim());
  const res = await fetch(`https://meet.googleapis.com/v2/spaces/${space}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as { name: string; meetingUri?: string };
}
