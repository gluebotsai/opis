import { addMinutesToLocalDateTime } from "@/service/google/calendar";

const MS_TOKEN = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const MS_GRAPH = "https://graph.microsoft.com/v1.0";

export function isTeamsConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_TENANT_ID?.trim() &&
      process.env.MICROSOFT_CLIENT_ID?.trim() &&
      process.env.MICROSOFT_CLIENT_SECRET?.trim() &&
      process.env.MICROSOFT_ORGANIZER_USER_ID?.trim(),
  );
}

function organizerUserId(): string {
  const id = process.env.MICROSOFT_ORGANIZER_USER_ID?.trim();
  if (!id) {
    throw new Error(
      "Teams is not configured. Add MICROSOFT_ORGANIZER_USER_ID (Azure user id or UPN).",
    );
  }
  return id;
}

async function getGraphAccessToken(): Promise<string> {
  const { microsoftAppTenant } = await import("@/service/microsoft/oauth");
  const tenant = microsoftAppTenant();
  const clientId = process.env.MICROSOFT_CLIENT_ID!.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!.trim();

  const res = await fetch(MS_TOKEN(tenant), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token request failed: ${text}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Microsoft token response missing access_token.");
  }
  return data.access_token;
}

/** Convert local datetime + IANA zone to UTC ISO for Microsoft Graph. */
function localDateTimeToUtcIso(
  dateTimeLocal: string,
  timeZone: string,
): string {
  const normalized = addMinutesToLocalDateTime(dateTimeLocal, 0).slice(0, 19);
  const [datePart, timePart] = normalized.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = timePart.split(":").map(Number);

  const utcGuess = Date.UTC(y, mo - 1, d, hh, mm, ss ?? 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  for (let offsetMin = -12 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const candidate = new Date(utcGuess + offsetMin * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((p) => [p.type, p.value]),
    );
    const py = Number(parts.year);
    const pmo = Number(parts.month);
    const pd = Number(parts.day);
    const ph = Number(parts.hour);
    const pm = Number(parts.minute);
    const ps = Number(parts.second);
    if (py === y && pmo === mo && pd === d && ph === hh && pm === mm && ps === (ss ?? 0)) {
      return candidate.toISOString();
    }
  }

  return new Date(utcGuess).toISOString();
}

export type CreatedTeamsMeeting = {
  id: string;
  joinUrl: string;
};

export async function createTeamsMeeting(input: {
  topic: string;
  startDateTime: string;
  timeZone: string;
  durationMinutes?: number;
}): Promise<CreatedTeamsMeeting> {
  if (!isTeamsConfigured()) {
    throw new Error(
      "Microsoft Teams is not configured. Add MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_ORGANIZER_USER_ID.",
    );
  }

  const accessToken = await getGraphAccessToken();
  const userId = encodeURIComponent(organizerUserId());
  const duration = input.durationMinutes ?? 30;
  const startIso = localDateTimeToUtcIso(input.startDateTime, input.timeZone);
  const endLocal = addMinutesToLocalDateTime(input.startDateTime, duration);
  const endIso = localDateTimeToUtcIso(endLocal, input.timeZone);

  const res = await fetch(`${MS_GRAPH}/users/${userId}/onlineMeetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDateTime: startIso,
      endDateTime: endIso,
      subject: input.topic,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Teams meeting create failed: ${text}`);
  }

  const data = (await res.json()) as {
    id?: string;
    joinWebUrl?: string;
  };

  if (!data.joinWebUrl) {
    throw new Error("Teams meeting create response missing joinWebUrl.");
  }

  return {
    id: data.id ?? "",
    joinUrl: data.joinWebUrl,
  };
}
