const ZOOM_TOKEN = "https://zoom.us/oauth/token";
const ZOOM_MEETINGS = "https://api.zoom.us/v2/users/me/meetings";

export function isZoomConfigured(): boolean {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID?.trim() &&
      process.env.ZOOM_CLIENT_ID?.trim() &&
      process.env.ZOOM_CLIENT_SECRET?.trim(),
  );
}

type ZoomTokenResponse = {
  access_token: string;
  expires_in?: number;
};

async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID!.trim();
  const clientId = process.env.ZOOM_CLIENT_ID!.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!.trim();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const res = await fetch(
    `${ZOOM_TOKEN}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom token request failed: ${text}`);
  }

  const data = (await res.json()) as ZoomTokenResponse;
  if (!data.access_token) {
    throw new Error("Zoom token response missing access_token.");
  }
  return data.access_token;
}

function formatZoomStartTime(dateTimeLocal: string): string {
  const raw = dateTimeLocal.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) {
    return raw.slice(0, 19);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    return `${raw}:00`;
  }
  throw new Error("Invalid start date/time for Zoom.");
}

export type CreatedZoomMeeting = {
  id: string;
  joinUrl: string;
  startUrl: string | null;
};

export async function createZoomMeeting(input: {
  topic: string;
  startDateTime: string;
  timeZone: string;
  durationMinutes?: number;
}): Promise<CreatedZoomMeeting> {
  if (!isZoomConfigured()) {
    throw new Error(
      "Zoom is not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET.",
    );
  }

  const accessToken = await getZoomAccessToken();
  const res = await fetch(ZOOM_MEETINGS, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: input.topic,
      type: 2,
      start_time: formatZoomStartTime(input.startDateTime),
      duration: input.durationMinutes ?? 30,
      timezone: input.timeZone.trim() || "UTC",
      settings: {
        join_before_host: true,
        waiting_room: false,
        // Helps post-meeting transcript archive when account allows cloud recording.
        auto_recording: "cloud",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom meeting create failed: ${text}`);
  }

  const data = (await res.json()) as {
    id?: number | string;
    join_url?: string;
    start_url?: string;
  };

  if (!data.join_url) {
    throw new Error("Zoom meeting create response missing join_url.");
  }

  return {
    id: String(data.id ?? ""),
    joinUrl: data.join_url,
    startUrl: data.start_url ?? null,
  };
}
