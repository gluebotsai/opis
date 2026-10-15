/**
 * Microsoft Graph calendar list helpers (inbound sync).
 */

const MS_GRAPH = "https://graph.microsoft.com/v1.0";

export type MicrosoftCalendarListedEvent = {
  id: string;
  subject: string;
  bodyPreview: string | null;
  startAt: string;
  endAt: string | null;
  isAllDay: boolean;
  webLink: string | null;
  onlineMeetingUrl: string | null;
  location: string | null;
  attendeeEmails: string[];
  organizerEmail: string | null;
};

function graphErrorMessage(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string };
    };
    const msg = parsed.error?.message;
    const code = parsed.error?.code;
    if (msg) detail = code ? `${code}: ${msg}` : msg;
  } catch {
    /* keep raw */
  }
  return `Microsoft Graph calendar ${status}: ${detail}`;
}

/** List calendar events in [start, end) (ISO instants). */
export async function listMicrosoftCalendarEvents(input: {
  accessToken: string;
  startDateTime: string;
  endDateTime: string;
}): Promise<MicrosoftCalendarListedEvent[]> {
  const params = new URLSearchParams({
    startDateTime: input.startDateTime,
    endDateTime: input.endDateTime,
    $top: "250",
    $orderby: "start/dateTime",
    $select:
      "id,subject,bodyPreview,start,end,isAllDay,webLink,onlineMeeting,location,attendees,organizer,isCancelled",
  });
  const url = `${MS_GRAPH}/me/calendarView?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(graphErrorMessage(res.status, text));
  }

  const data = (await res.json()) as {
    value?: Array<{
      id?: string;
      subject?: string | null;
      bodyPreview?: string | null;
      isAllDay?: boolean;
      isCancelled?: boolean;
      webLink?: string | null;
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
      location?: { displayName?: string | null };
      onlineMeeting?: { joinUrl?: string | null };
      organizer?: {
        emailAddress?: { address?: string | null; name?: string | null };
      };
      attendees?: Array<{
        emailAddress?: { address?: string | null };
        type?: string;
      }>;
    }>;
  };

  const out: MicrosoftCalendarListedEvent[] = [];
  for (const item of data.value ?? []) {
    if (!item.id || item.isCancelled) continue;
    const startAt = item.start?.dateTime;
    if (!startAt) continue;
    // Graph returns local-naive datetime with Prefer UTC — append Z if missing.
    const startIso = /Z$|[+-]\d{2}:\d{2}$/.test(startAt)
      ? startAt
      : `${startAt}Z`;
    const endRaw = item.end?.dateTime ?? null;
    const endAt = endRaw
      ? /Z$|[+-]\d{2}:\d{2}$/.test(endRaw)
        ? endRaw
        : `${endRaw}Z`
      : null;
    const organizerEmail =
      item.organizer?.emailAddress?.address?.trim().toLowerCase() || null;
    const attendeeEmails = [
      ...new Set(
        (item.attendees ?? [])
          .map((a) => a.emailAddress?.address?.trim().toLowerCase() || "")
          .filter((e) => e.includes("@")),
      ),
    ];
    out.push({
      id: item.id,
      subject: item.subject?.trim() || "(No title)",
      bodyPreview: item.bodyPreview?.trim() || null,
      startAt: startIso,
      endAt,
      isAllDay: Boolean(item.isAllDay),
      webLink: item.webLink ?? null,
      onlineMeetingUrl: item.onlineMeeting?.joinUrl ?? null,
      location: item.location?.displayName?.trim() || null,
      attendeeEmails,
      organizerEmail,
    });
  }
  return out;
}
